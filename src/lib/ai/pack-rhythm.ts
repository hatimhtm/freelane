import "server-only";
import { Type } from "@google/genai";
import { gemini, hasGemini } from "./gemini";
import { HEAVY_MODEL } from "./models";
import { phtDateString } from "@/lib/utils";
import type { Spend, SpendCategory, SpendCategoryLink } from "@/lib/supabase/types";

// Pack Rhythm (#23) — Hatim wants to cut cigarettes. This is MIRROR,
// not LECTURE. Reads 12 weeks of Cigarettes-tagged spends, surfaces the
// sparkline + a one-line read of the rhythm. NEVER preachy.

const DAY_MS = 86_400_000;
const WEEKS = 12;

export interface PackRhythmRead {
  weeklyTotals: number[];                // length = WEEKS, oldest → newest
  weeklySpends: number[];                // count per week
  thisWeekTotal: number;
  lastWeekTotal: number;
  fourWeekAvg: number;
  twelveWeekAvg: number;
  // 'rising' if last 4 weeks > prior 8 by ≥ 15%; 'falling' if ≤ -15%; else 'steady'.
  trend: "rising" | "falling" | "steady";
  daysSinceLast: number | null;
  // The one-line read. AI-written when Gemini is on, deterministic otherwise.
  line: string;
  fromAi: boolean;
}

const SYSTEM_PROMPT = `You write ONE line about Hatim's cigarette rhythm. He wants to cut. Mirror, NEVER preach.

HARD RULES (NON-NEGOTIABLE):
- 10-22 words.
- FORBIDDEN PHRASES: "try to", "should", "consider", "you might want to", "quit", "stop", "cut down", "remember", "make sure", "stay strong", "you got this", "well done", "great job", "keep it up", "addiction", "habit you should".
- Cite the REAL number from the snapshot.
- Voice: dry, observational. Mirror, never moralize.
- Acceptable shapes:
  - "Eleven packs over the last twelve weeks. Last week — two."
  - "Three days since the last Cigarettes spend. Quiet stretch."
  - "Cigarettes 1.4× last month's pace."

Return JSON: { "line": "<sentence>" }`;

const SCHEMA = {
  type: Type.OBJECT,
  properties: { line: { type: Type.STRING } },
  required: ["line"],
};

export async function generatePackRhythm(args: {
  spends: Spend[];
  spendCategories: SpendCategory[];
  spendCategoryLinks: SpendCategoryLink[];
  now?: Date;
}): Promise<PackRhythmRead> {
  const now = args.now ?? new Date();
  const cigCat = args.spendCategories.find((c) => /cigarettes?/i.test(c.name));
  if (!cigCat) {
    return {
      weeklyTotals: new Array(WEEKS).fill(0),
      weeklySpends: new Array(WEEKS).fill(0),
      thisWeekTotal: 0,
      lastWeekTotal: 0,
      fourWeekAvg: 0,
      twelveWeekAvg: 0,
      trend: "steady",
      daysSinceLast: null,
      line: "",
      fromAi: false,
    };
  }
  const linkIds = new Set(args.spendCategoryLinks.filter((l) => l.category_id === cigCat.id).map((l) => l.spend_id));
  const cigSpends = args.spends.filter((s) => linkIds.has(s.id));

  const today = new Date(phtDateString(now));
  // Anchor: this week's Monday in PHT.
  const dow = today.getDay() || 7;
  const thisMon = new Date(today.getTime() - (dow - 1) * DAY_MS);
  const weeklyTotals = new Array(WEEKS).fill(0);
  const weeklySpends = new Array(WEEKS).fill(0);
  for (const sp of cigSpends) {
    const d = new Date(sp.spent_at);
    const weeksBack = Math.floor((thisMon.getTime() - d.getTime()) / (7 * DAY_MS));
    if (weeksBack < 0 || weeksBack >= WEEKS) continue;
    const idx = WEEKS - 1 - weeksBack;
    weeklyTotals[idx] += Number(sp.amount_base ?? 0);
    weeklySpends[idx] += 1;
  }
  const thisWeekTotal = weeklyTotals[WEEKS - 1];
  const lastWeekTotal = WEEKS >= 2 ? weeklyTotals[WEEKS - 2] : 0;
  const fourWeekAvg = avg(weeklyTotals.slice(-4));
  const twelveWeekAvg = avg(weeklyTotals);
  const priorEight = avg(weeklyTotals.slice(0, 8));
  const lastFour = avg(weeklyTotals.slice(-4));
  let trend: PackRhythmRead["trend"] = "steady";
  if (priorEight > 0) {
    const delta = (lastFour - priorEight) / priorEight;
    if (delta >= 0.15) trend = "rising";
    else if (delta <= -0.15) trend = "falling";
  } else if (lastFour > 0) {
    trend = "rising";
  }
  const sortedDesc = [...cigSpends].sort((a, b) => b.spent_at.localeCompare(a.spent_at));
  const daysSinceLast = sortedDesc.length
    ? Math.floor((today.getTime() - new Date(sortedDesc[0].spent_at).getTime()) / DAY_MS)
    : null;

  let line = fallbackPackLine({ thisWeekTotal, lastWeekTotal, fourWeekAvg, twelveWeekAvg, trend, daysSinceLast });
  let fromAi = false;

  if (hasGemini() && cigSpends.length > 0) {
    try {
      const snapshot = `weekly_totals_php=${weeklyTotals.map((n) => Math.round(n)).join(",")}\nweekly_spends=${weeklySpends.join(",")}\nthis_week_php=${Math.round(thisWeekTotal)}\nlast_week_php=${Math.round(lastWeekTotal)}\nfour_week_avg=${Math.round(fourWeekAvg)}\ntwelve_week_avg=${Math.round(twelveWeekAvg)}\ntrend=${trend}\ndays_since_last=${daysSinceLast ?? "(n/a)"}`;
      const res = await gemini().models.generateContent({
        model: HEAVY_MODEL,
        contents: `Pack rhythm snapshot:\n${snapshot}\n\nReturn JSON.`,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          temperature: 0.45,
          responseMimeType: "application/json",
          responseSchema: SCHEMA,
        },
      });
      const parsed = JSON.parse((res.text ?? "{}").trim()) as { line?: string };
      if (parsed.line?.trim()) {
        line = parsed.line.trim();
        fromAi = true;
      }
    } catch {
      // keep fallback
    }
  }

  return {
    weeklyTotals,
    weeklySpends,
    thisWeekTotal,
    lastWeekTotal,
    fourWeekAvg,
    twelveWeekAvg,
    trend,
    daysSinceLast,
    line,
    fromAi,
  };
}

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, n) => s + n, 0) / arr.length;
}

function fallbackPackLine(args: {
  thisWeekTotal: number;
  lastWeekTotal: number;
  fourWeekAvg: number;
  twelveWeekAvg: number;
  trend: PackRhythmRead["trend"];
  daysSinceLast: number | null;
}): string {
  if (args.daysSinceLast === null) return "";
  if (args.daysSinceLast >= 7) {
    return `${args.daysSinceLast} days since the last Cigarettes spend — quiet stretch.`;
  }
  if (args.trend === "rising") {
    return `Last four weeks ₱${args.fourWeekAvg.toFixed(0)}/wk on Cigarettes, up from ₱${args.twelveWeekAvg.toFixed(0)} twelve-week avg.`;
  }
  if (args.trend === "falling") {
    return `Last four weeks ₱${args.fourWeekAvg.toFixed(0)}/wk on Cigarettes, down from ₱${args.twelveWeekAvg.toFixed(0)} twelve-week avg.`;
  }
  return `Cigarettes this week ₱${args.thisWeekTotal.toFixed(0)}, twelve-week average ₱${args.twelveWeekAvg.toFixed(0)}/wk.`;
}

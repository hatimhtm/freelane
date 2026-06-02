import "server-only";
import { Type } from "@google/genai";
import { gemini, hasGemini } from "./gemini";
import { HEAVY_MODEL } from "./models";
import {
  fingerprintFromIds,
  readBrainCache,
  withBrainCache,
  type CachedBrainPayload,
} from "./cache";
import { BRAIN_KEYS } from "./cache-keys";
import { formatMoney } from "@/lib/money";
import type {
  Payment,
  Spend,
  SpendCategory,
  SpendCategoryLink,
} from "@/lib/supabase/types";

// Sadaka Rhythm — observes the rhythm of giving (not a target, NOT a goal).
// Reads Sadaka-tagged spends + recent landings and writes a quiet
// observational line. Used on Today + Year Letter later.
//
// Voice: warm. Religious practice. Hatim picks the amounts; the AI just
// mirrors the rhythm back.

const DAY_MS = 86_400_000;
const RHYTHM_WINDOW_DAYS = 180;
const RECENT_INCOME_DAYS = 90;

export interface SadakaRhythmRead {
  totalGivenBase: number;        // last 180 days
  givenCount: number;
  avgGivenBase: number;
  averagePercentOfIncome: number; // sadaka_total / income_total (last 90d)
  lastGivenAt: string | null;
  daysSinceLast: number | null;
  line: string;
  fromAi: boolean;
}

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    line: { type: Type.STRING },
  },
  required: ["line"],
};

const SYSTEM_PROMPT = `You write the Sadaka Rhythm observation for Hatim, a Muslim SOLO freelancer in San Pablo, Philippines.

You receive: total Sadaka given in last 180 days + visit count + last given date + average percentage of recent income that went to Sadaka.

Write ONE line, 10-22 words, that MIRRORS the rhythm. Never a directive. Never a goal.

HARD RULES (NON-NEGOTIABLE):
- This is a religious practice. NEVER quantify it as ROI, NEVER suggest "increase your giving", NEVER label it as a budget item.
- FORBIDDEN PHRASES: "should", "try to", "consider", "increase", "more often", "you might want to", "target", "goal", "budget".
- Observational only. "₱4,200 of Sadaka in the last 90 days, averaging 2.1% of landings."
- If the last Sadaka is recent (≤ 30d), warm. If it's been a long time (> 90d), gently noticeable: "Last Sadaka 137 days ago." NEVER preachy.

GOOD EXAMPLES:
- "₱4,200 of Sadaka in the last 90 days, averaging 2.1% of landings."
- "Last Sadaka 9 days ago — small steady rhythm of giving this quarter."
- "Last Sadaka 137 days ago. The rhythm has been quiet."

Return JSON: { "line": "<sentence>" }`;

export async function getSadakaRhythmCached(): Promise<CachedBrainPayload<SadakaRhythmRead> | null> {
  return readBrainCache<SadakaRhythmRead>(BRAIN_KEYS.SADAKA_RHYTHM);
}

export async function generateSadakaRhythm(
  args: {
    spends: Spend[];
    payments: Payment[];
    spendCategories: SpendCategory[];
    spendCategoryLinks: SpendCategoryLink[];
    now?: Date;
  },
  opts: { force?: boolean } = {},
): Promise<SadakaRhythmRead> {
  // Fingerprint = last sadaka-tagged spend ids + last payment id. The
  // rhythm only moves when one of those changes.
  const sadakaCatForFingerprint = args.spendCategories.find((c) => /sadaka/i.test(c.name));
  const sadakaLinkIds = sadakaCatForFingerprint
    ? new Set(
        args.spendCategoryLinks
          .filter((l) => l.category_id === sadakaCatForFingerprint.id)
          .map((l) => l.spend_id),
      )
    : new Set<string>();
  const recentSadakaIds = args.spends
    .filter((s) => sadakaLinkIds.has(s.id))
    .sort((a, b) => b.spent_at.localeCompare(a.spent_at))
    .slice(0, 5)
    .map((s) => s.id);
  const lastPaymentId = [...args.payments]
    .sort((a, b) => b.paid_at.localeCompare(a.paid_at))[0]?.id ?? null;
  const fingerprint = await fingerprintFromIds([
    ...recentSadakaIds,
    lastPaymentId,
  ]);
  const result = await withBrainCache<SadakaRhythmRead>({
    brainKey: BRAIN_KEYS.SADAKA_RHYTHM,
    fingerprint,
    force: opts.force,
    regen: () => generateSadakaRhythmRegen(args),
  });
  if (result) return result.payload;
  return generateSadakaRhythmRegen(args);
}

async function generateSadakaRhythmRegen(args: {
  spends: Spend[];
  payments: Payment[];
  spendCategories: SpendCategory[];
  spendCategoryLinks: SpendCategoryLink[];
  now?: Date;
}): Promise<SadakaRhythmRead> {
  const now = args.now ?? new Date();
  const sadakaCat = args.spendCategories.find((c) => /sadaka/i.test(c.name));
  if (!sadakaCat) {
    return {
      totalGivenBase: 0,
      givenCount: 0,
      avgGivenBase: 0,
      averagePercentOfIncome: 0,
      lastGivenAt: null,
      daysSinceLast: null,
      line: "",
      fromAi: false,
    };
  }
  const linkIds = new Set(args.spendCategoryLinks.filter((l) => l.category_id === sadakaCat.id).map((l) => l.spend_id));
  const windowStart = new Date(now.getTime() - RHYTHM_WINDOW_DAYS * DAY_MS);
  const sadakaSpends = args.spends
    .filter((s) => linkIds.has(s.id))
    .filter((s) => new Date(s.spent_at) >= windowStart && new Date(s.spent_at) <= now)
    .sort((a, b) => b.spent_at.localeCompare(a.spent_at));
  const totalGivenBase = sadakaSpends.reduce((sum, s) => sum + Number(s.amount_base ?? 0), 0);
  const givenCount = sadakaSpends.length;
  const avgGivenBase = givenCount > 0 ? totalGivenBase / givenCount : 0;
  const incomeStart = new Date(now.getTime() - RECENT_INCOME_DAYS * DAY_MS);
  const incomeBase = args.payments
    .filter((p) => {
      const d = new Date(p.paid_at);
      return d >= incomeStart && d <= now;
    })
    .reduce((sum, p) => sum + Number(p.net_amount_base ?? 0), 0);
  const sadakaBaseRecent = sadakaSpends
    .filter((s) => new Date(s.spent_at) >= incomeStart)
    .reduce((sum, s) => sum + Number(s.amount_base ?? 0), 0);
  const averagePercentOfIncome = incomeBase > 0 ? sadakaBaseRecent / incomeBase : 0;
  const lastGivenAt = sadakaSpends[0]?.spent_at ?? null;
  const daysSinceLast = lastGivenAt
    ? Math.round((now.getTime() - new Date(lastGivenAt).getTime()) / DAY_MS)
    : null;

  // Deterministic fallback line.
  let line = fallbackSadakaLine({
    totalGivenBase,
    givenCount,
    averagePercentOfIncome,
    daysSinceLast,
  });
  let fromAi = false;

  if (hasGemini() && givenCount > 0) {
    try {
      const snapshot = `total_given_php=${totalGivenBase.toFixed(0)} given_count=${givenCount} avg_given_php=${avgGivenBase.toFixed(0)} avg_percent_of_income=${(averagePercentOfIncome * 100).toFixed(2)} last_given_at=${lastGivenAt ?? "(never)"} days_since_last=${daysSinceLast ?? "(n/a)"}`;
      const res = await gemini().models.generateContent({
        model: HEAVY_MODEL,
        contents: `Sadaka rhythm snapshot:\n${snapshot}\n\nReturn JSON.`,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          temperature: 0.4,
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
        },
      });
      const parsed = JSON.parse((res.text ?? "{}").trim()) as { line?: string };
      if (parsed.line?.trim()) {
        line = parsed.line.trim();
        fromAi = true;
      }
    } catch {
      // Keep deterministic.
    }
  }

  return {
    totalGivenBase,
    givenCount,
    avgGivenBase,
    averagePercentOfIncome,
    lastGivenAt,
    daysSinceLast,
    line,
    fromAi,
  };
}

function fallbackSadakaLine(args: {
  totalGivenBase: number;
  givenCount: number;
  averagePercentOfIncome: number;
  daysSinceLast: number | null;
}): string {
  if (args.givenCount === 0) return "";
  const pct = args.averagePercentOfIncome > 0 ? ` (≈ ${(args.averagePercentOfIncome * 100).toFixed(1)}% of last 90d landings)` : "";
  if (args.daysSinceLast === null) {
    return `${args.givenCount} Sadaka entries totaling ${formatMoney(args.totalGivenBase, "PHP", { compact: true })} in the last 180 days${pct}.`;
  }
  if (args.daysSinceLast <= 14) {
    return `Last Sadaka ${args.daysSinceLast}d ago — ${args.givenCount} entries totaling ${formatMoney(args.totalGivenBase, "PHP", { compact: true })} this stretch${pct}.`;
  }
  return `Last Sadaka ${args.daysSinceLast}d ago — ${args.givenCount} entries totaling ${formatMoney(args.totalGivenBase, "PHP", { compact: true })} in the last 180 days${pct}.`;
}

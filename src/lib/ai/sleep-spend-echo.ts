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
import { phtToday } from "@/lib/utils";
import type { MorningLog, Spend, SpendCategory, SpendCategoryLink } from "@/lib/supabase/types";

// Sleep × Spend Echo (#4) — ship as a NOTIFICATION → tap → small center
// modal (Hatim 2026-06-01). The data captured is the morning log row;
// the echo brain writes the quiet line after the day has run.
//
// Pattern detected: short sleep + many small ordering or fast-food spends,
// OR low mood + cluster of cigarettes, OR scattered mind + late-night
// cluster. The echo is OBSERVATIONAL — never causal. ("Slept 5h, ordered
// three times — possibly tied" rather than "you ordered because tired").

const SYSTEM_PROMPT = `You write ONE line that ECHOES the day's sleep / mood / mind against the day's spend pattern, for Hatim — solo freelancer, San Pablo PHT.

The echo is OBSERVATIONAL, never causal. Suggest the link without claiming it. "Slept 5h. Three Ordering spends — possibly tied." NOT "you ordered because you were tired."

HARD RULES (NON-NEGOTIABLE):
- 12-22 words.
- FORBIDDEN PHRASES: "you should", "consider", "try to", "remember", "make sure", "rest more", "go to bed", "stop", "you were tired because", "this caused", "no wonder", "watch out".
- Hedge causality: "possibly tied", "might be linked", "could be the shape".
- Voice: dry, observational. Mirror, never advise.
- Cite REAL numbers from the snapshot.
- Acceptable shapes:
  - "Slept 5h, mood 2. Three Fast food spends — possibly tied."
  - "Calm rest, calm logging. Nothing unusual today."
  - "Mind scattered, late-night Cigarettes ₱180 — might be linked."

Return JSON: { "line": "<sentence>" }`;

const SCHEMA = {
  type: Type.OBJECT,
  properties: { line: { type: Type.STRING } },
  required: ["line"],
};

export interface SleepSpendEcho {
  morning: MorningLog | null;
  line: string;
  fromAi: boolean;
}

export async function getSleepSpendEchoCached(): Promise<CachedBrainPayload<SleepSpendEcho> | null> {
  return readBrainCache<SleepSpendEcho>(BRAIN_KEYS.SLEEP_ECHO);
}

export async function generateSleepSpendEcho(
  args: {
    morning: MorningLog | null;
    spends: Spend[];
    spendCategories: SpendCategory[];
    spendCategoryLinks: SpendCategoryLink[];
    now?: Date;
  },
  opts: { force?: boolean } = {},
): Promise<SleepSpendEcho> {
  // Fingerprint = morning log identity + today's spend ids. If there's no
  // morning log there's nothing to echo, so we let the cache return an empty
  // payload rather than re-rendering Gemini on every read.
  const todaySpendIds = args.morning
    ? args.spends
        .filter((s) => s.spent_at === args.morning!.recorded_at)
        .sort((a, b) => b.id.localeCompare(a.id))
        .slice(0, 10)
        .map((s) => s.id)
    : [];
  const fingerprint = await fingerprintFromIds([
    args.morning?.recorded_at ?? null,
    args.morning?.user_id ?? null,
    String(args.morning?.slept_hours ?? ""),
    String(args.morning?.mood_band ?? ""),
    args.morning?.mind_state ?? "",
    ...todaySpendIds,
  ]);
  const result = await withBrainCache<SleepSpendEcho>({
    brainKey: BRAIN_KEYS.SLEEP_ECHO,
    fingerprint,
    force: opts.force,
    regen: () => generateSleepSpendEchoRegen(args),
  });
  if (result) return result.payload;
  return generateSleepSpendEchoRegen(args);
}

async function generateSleepSpendEchoRegen(args: {
  morning: MorningLog | null;
  spends: Spend[];
  spendCategories: SpendCategory[];
  spendCategoryLinks: SpendCategoryLink[];
  now?: Date;
}): Promise<SleepSpendEcho> {
  if (!args.morning) {
    return { morning: null, line: "", fromAi: false };
  }
  const today = args.morning.recorded_at;
  const todaySpends = args.spends.filter((s) => s.spent_at === today);

  // Build a compact category summary for the day.
  const categoryById = new Map(args.spendCategories.map((c) => [c.id, c]));
  const counts = new Map<string, { count: number; totalPhp: number }>();
  for (const sp of todaySpends) {
    const links = args.spendCategoryLinks.filter((l) => l.spend_id === sp.id);
    if (links.length === 0) {
      const e = counts.get("untagged") ?? { count: 0, totalPhp: 0 };
      e.count += 1;
      e.totalPhp += Number(sp.amount_base ?? 0);
      counts.set("untagged", e);
    } else {
      for (const l of links) {
        const name = categoryById.get(l.category_id)?.name ?? "untagged";
        const e = counts.get(name) ?? { count: 0, totalPhp: 0 };
        e.count += 1;
        e.totalPhp += Number(sp.amount_base ?? 0);
        counts.set(name, e);
      }
    }
  }
  const categoryLines = Array.from(counts.entries())
    .sort((a, b) => b[1].totalPhp - a[1].totalPhp)
    .map(([name, e]) => `${name}: ${e.count} (₱${e.totalPhp.toFixed(0)})`)
    .join("; ");

  let line = fallbackEchoLine(args.morning, todaySpends, categoryLines);
  let fromAi = false;

  if (hasGemini()) {
    try {
      const snapshot = `recorded_at=${args.morning.recorded_at}\nslept_hours=${args.morning.slept_hours ?? "(n/a)"}\nmood_band=${args.morning.mood_band ?? "(n/a)"}\nmind_state="${args.morning.mind_state ?? ""}"\nnotes="${args.morning.notes ?? ""}"\nspends_today=${todaySpends.length}\ncategories_today=${categoryLines || "(none)"}`;
      const res = await gemini().models.generateContent({
        model: HEAVY_MODEL,
        contents: `Sleep × Spend echo snapshot:\n${snapshot}\n\nReturn JSON.`,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          temperature: 0.5,
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

  return { morning: args.morning, line, fromAi };
}

function fallbackEchoLine(morning: MorningLog, spends: Spend[], categoryLines: string): string {
  const sleep = morning.slept_hours != null ? `Slept ${morning.slept_hours}h` : "Sleep unlogged";
  const mood = morning.mood_band != null ? `mood ${morning.mood_band}` : "";
  const spendCount = spends.length;
  const total = spends.reduce((sum, s) => sum + Number(s.amount_base ?? 0), 0);
  if (spendCount === 0) {
    return `${sleep}${mood ? `, ${mood}` : ""}. No spends logged today.`;
  }
  return `${sleep}${mood ? `, ${mood}` : ""}. ${spendCount} spend${spendCount === 1 ? "" : "s"} (${formatMoney(total, "PHP", { compact: true })})${categoryLines ? ` — ${categoryLines.slice(0, 60)}` : ""}.`;
}

// Returns today's morning log row for the active user (server-side).
export async function getTodayMorningLog(): Promise<MorningLog | null> {
  void phtToday;
  // Caller fetches this separately; kept for symmetry with other brains.
  return null;
}

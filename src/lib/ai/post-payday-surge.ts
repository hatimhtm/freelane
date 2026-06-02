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
import type { Payment, Spend } from "@/lib/supabase/types";

// Post-Payday Surge Window (#35) — Hatim has this pattern: "post-landing
// days run 1.8× typical."  Detect across the last 6 landings: the per-day
// spend in days 1-7 after a landing vs the all-time daily baseline.
//
// Voice: factual mirror. NEVER advise.

const DAY_MS = 86_400_000;
const POST_LANDING_WINDOW_DAYS = 7;
const BASELINE_DAYS = 90;
const SURGE_THRESHOLD = 1.4;

export interface PostPaydaySurgeRead {
  // Average daily spend in the 7d after a landing across the last 6 landings.
  postLandingDailyBase: number;
  // All-time daily spend baseline (last 90 days).
  baselineDailyBase: number;
  // Ratio of post-landing to baseline.
  ratio: number;
  // True if user is currently inside a post-landing window AND the ratio
  // crosses the SURGE_THRESHOLD.
  surface: boolean;
  // Days since the most recent landing (if any, else null).
  daysSinceLastLanding: number | null;
  line: string;
  fromAi: boolean;
}

const SYSTEM_PROMPT = `You write ONE line about Hatim's post-landing spending pattern. (Income is unstable — he has landings, not paychecks.)

HARD RULES (NON-NEGOTIABLE):
- 10-22 words.
- FORBIDDEN PHRASES: "try to", "should", "consider", "be careful", "watch out", "remember", "make sure", "save more", "spend less", "budget", "your salary", "monthly paycheck", "payday".
- REPLACEMENT FRAMING: "post-landing days", "first week after a landing", "this stretch".
- Voice: dry, observational. Mirror, never advise.
- Cite the REAL ratio + ₱ from the snapshot.
- Acceptable shapes:
  - "First week after each landing runs 1.6× the 90-day baseline — about ₱520/day."
  - "Post-landing days quiet this round — ratio holds near 1.0×."

Return JSON: { "line": "<sentence>" }`;

const SCHEMA = {
  type: Type.OBJECT,
  properties: { line: { type: Type.STRING } },
  required: ["line"],
};

export async function getPostPaydaySurgeCached(): Promise<CachedBrainPayload<PostPaydaySurgeRead> | null> {
  return readBrainCache<PostPaydaySurgeRead>(BRAIN_KEYS.POST_PAYDAY);
}

export async function generatePostPaydaySurge(
  args: {
    payments: Payment[];
    spends: Spend[];
    now?: Date;
  },
  opts: { force?: boolean } = {},
): Promise<PostPaydaySurgeRead> {
  // Fingerprint = last landing id + last 5 post-landing spend ids. The brain
  // only moves when a new landing happens or post-landing spends shift.
  const lastLandingId = [...args.payments]
    .sort((a, b) => b.paid_at.localeCompare(a.paid_at))[0]?.id ?? null;
  const recentSpendIds = [...args.spends]
    .sort((a, b) => b.spent_at.localeCompare(a.spent_at))
    .slice(0, 5)
    .map((s) => s.id);
  const fingerprint = await fingerprintFromIds([
    lastLandingId,
    ...recentSpendIds,
  ]);
  const result = await withBrainCache<PostPaydaySurgeRead>({
    brainKey: BRAIN_KEYS.POST_PAYDAY,
    fingerprint,
    force: opts.force,
    regen: () => generatePostPaydaySurgeRegen(args),
  });
  if (result) return result.payload;
  return generatePostPaydaySurgeRegen(args);
}

async function generatePostPaydaySurgeRegen(args: {
  payments: Payment[];
  spends: Spend[];
  now?: Date;
}): Promise<PostPaydaySurgeRead> {
  const now = args.now ?? new Date();
  const baselineStart = new Date(now.getTime() - BASELINE_DAYS * DAY_MS);
  const baselineSpend = args.spends
    .filter((s) => new Date(s.spent_at) >= baselineStart && new Date(s.spent_at) <= now)
    .reduce((sum, s) => sum + Number(s.amount_base ?? 0), 0);
  const baselineDailyBase = baselineSpend / BASELINE_DAYS;

  // Find last 6 landings.
  const landings = [...args.payments]
    .sort((a, b) => b.paid_at.localeCompare(a.paid_at))
    .slice(0, 6);

  if (landings.length === 0) {
    return {
      postLandingDailyBase: 0,
      baselineDailyBase,
      ratio: 0,
      surface: false,
      daysSinceLastLanding: null,
      line: "",
      fromAi: false,
    };
  }

  let totalPostLandingSpend = 0;
  let totalPostLandingDays = 0;
  for (const p of landings) {
    const landingDate = new Date(p.paid_at);
    const windowEnd = new Date(landingDate.getTime() + POST_LANDING_WINDOW_DAYS * DAY_MS);
    if (windowEnd > now) continue;
    const windowSpend = args.spends
      .filter((s) => {
        const d = new Date(s.spent_at);
        return d >= landingDate && d < windowEnd;
      })
      .reduce((sum, s) => sum + Number(s.amount_base ?? 0), 0);
    totalPostLandingSpend += windowSpend;
    totalPostLandingDays += POST_LANDING_WINDOW_DAYS;
  }
  const postLandingDailyBase = totalPostLandingDays > 0 ? totalPostLandingSpend / totalPostLandingDays : 0;
  const ratio = baselineDailyBase > 0 ? postLandingDailyBase / baselineDailyBase : 0;

  // Inside current post-landing window?
  const mostRecent = landings[0];
  const daysSinceLastLanding = Math.floor(
    (now.getTime() - new Date(mostRecent.paid_at).getTime()) / DAY_MS,
  );
  const insideWindow = daysSinceLastLanding >= 0 && daysSinceLastLanding < POST_LANDING_WINDOW_DAYS;
  const surface = ratio >= SURGE_THRESHOLD && insideWindow;

  let line = "";
  if (ratio > 0) {
    line = `First week after each landing runs ${ratio.toFixed(2)}× the 90-day baseline — about ₱${Math.round(postLandingDailyBase)}/day.`;
  }
  let fromAi = false;

  if (hasGemini() && ratio > 0 && surface) {
    try {
      const snapshot = `post_landing_daily_php=${Math.round(postLandingDailyBase)}\nbaseline_daily_php=${Math.round(baselineDailyBase)}\nratio=${ratio.toFixed(2)}\ndays_since_last_landing=${daysSinceLastLanding}\ninside_window=${insideWindow}`;
      const res = await gemini().models.generateContent({
        model: HEAVY_MODEL,
        contents: `Post-landing surge snapshot:\n${snapshot}\n\nReturn JSON.`,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          temperature: 0.4,
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
    postLandingDailyBase,
    baselineDailyBase,
    ratio,
    surface,
    daysSinceLastLanding,
    line,
    fromAi,
  };
}

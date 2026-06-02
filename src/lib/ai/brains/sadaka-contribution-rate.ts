import "server-only";

import { Type } from "@google/genai";
import { gemini, hasGemini, pickModel } from "../models";
import { scrubForbiddenPhrases } from "../voice-scrub";

// Pro brain — sadaka_contribution_rate.
//
// Decides the contribution percentage for THIS income event. Anchored at the
// user's base_contribution_pct (2.5% — Islamic zakat). The brain dampens
// toward 0 in harsh periods, stays small in recovery, or lifts toward 5% on
// surplus windfalls — grounded in: pool balance, period stage, days in the
// current period so far, upcoming committed outflows, and recent income
// cadence (volatility proxy). Never returns null; falls back to the base
// rate when Gemini is unavailable or the model output is malformed.
//
// NO cache wrapper here — per-event freshness matters more than dedup. The
// BRAIN_KEYS.SADAKA_CONTRIBUTION_RATE entry exists in the catalog for
// invalidation parity only (TTL = 0 by convention; see BRAIN_TTL comment).

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    rate: { type: Type.NUMBER },
    reasoning: { type: Type.STRING },
  },
  required: ["rate", "reasoning"],
} as const;

const SYSTEM_PROMPT = `You decide a single contribution percentage for a one-time freelance income event.

Anchor: the user's base rate (anchored at 2.5% — Islamic zakat).
You may modestly dampen (toward 0) in harsh periods, keep small during recovery, or lift (toward 5%) on a clean windfall.

Hard rules:
- Return a single rate between 0 and 10. Honour the anchor — never wander far.
- Reasoning is ONE short flat sentence. Plain, warm, sharp.
- NEVER use: "you should", "consider", "save more", "stay positive", "well done", "great job", "amazing"
- Never imperative. Statement, not advice.

Return ONLY {"rate": number, "reasoning": string} JSON.`;

export type SadakaContributionRateInput = {
  netAmountBase: number;
  paidAt: string;
  baseRate: number;
  // Context signals the brain grounds the dampen/lift decision in. All
  // optional so the brain stays callable even when the caller doesn't have
  // every signal cached, but the wider the bundle the smarter the call.
  poolBase?: number;
  periodStage?: "harsh" | "recovery" | "surplus" | "neutral";
  daysIntoPeriod?: number;
  upcomingOutflows7dBase?: number;
  // ms between this income event and the user's previous income event;
  // proxy for cadence/volatility. Null when there is no prior income on
  // record (first payment).
  msSinceLastIncome?: number | null;
};

export type SadakaContributionRateDecision = {
  rate: number;
  reasoning: string;
};

// Unified clamp: both the fallback and the success path bound to [0, 10]
// so a misconfigured baseRate can never write a 50% contribution row.
function clampRate(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(10, n);
}

function fallback(baseRate: number): SadakaContributionRateDecision {
  return {
    rate: clampRate(Number(baseRate) || 0),
    reasoning: "base rate",
  };
}

export async function decideSadakaContributionRate(
  input: SadakaContributionRateInput,
): Promise<SadakaContributionRateDecision> {
  if (!hasGemini()) return fallback(input.baseRate);
  try {
    const lines: string[] = [
      `INCOME (net, base currency): ${Math.round(input.netAmountBase)}`,
      `PAID AT (PHT date assumed): ${input.paidAt}`,
      `USER BASE RATE %: ${input.baseRate}`,
    ];
    if (input.poolBase !== undefined) {
      lines.push(`SADAKA POOL (base): ${Math.round(input.poolBase)}`);
    }
    if (input.periodStage) {
      lines.push(`PERIOD STAGE: ${input.periodStage}`);
    }
    if (input.daysIntoPeriod !== undefined) {
      lines.push(`DAYS INTO PERIOD: ${Math.max(0, Math.floor(input.daysIntoPeriod))}`);
    }
    if (input.upcomingOutflows7dBase !== undefined) {
      lines.push(
        `UPCOMING OUTFLOWS NEXT 7D (base): ${Math.round(input.upcomingOutflows7dBase)}`,
      );
    }
    if (input.msSinceLastIncome !== undefined && input.msSinceLastIncome !== null) {
      const days = Math.round(input.msSinceLastIncome / 86_400_000);
      lines.push(`DAYS SINCE LAST INCOME: ${days}`);
    }
    lines.push("", "Pick the rate for THIS contribution.");
    const prompt = lines.join("\n");
    const res = await gemini().models.generateContent({
      model: pickModel("heavy"),
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        temperature: 0.2,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
      },
    });
    const parsed = JSON.parse((res.text ?? "{}").trim()) as Partial<
      SadakaContributionRateDecision
    >;
    const rate = Number(parsed.rate);
    if (!Number.isFinite(rate) || rate < 0) return fallback(input.baseRate);
    const reasoning = scrubForbiddenPhrases(
      String(parsed.reasoning ?? "base rate").trim(),
    );
    return {
      rate: clampRate(rate),
      reasoning: reasoning || "base rate",
    };
  } catch {
    return fallback(input.baseRate);
  }
}

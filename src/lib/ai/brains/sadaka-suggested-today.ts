import "server-only";

import { Type } from "@google/genai";
import { gemini, hasGemini, pickModel } from "../models";
import { scrubForbiddenPhrases } from "../voice-scrub";

// Pro brain — sadaka_suggested_today.
//
// Decides the daily nudge amount + whether to surface it on Today. Grounded
// in: pool balance, today's liquidity (cash on hand), period stage, days
// since last payment, and upcoming 7d committed outflows. Returns
// suggested_amount in base currency, a short flat reasoning blurb, and
// surface_today: bool. All context signals are optional so the caller can
// invoke even when one source is unavailable; the brain dials confidence
// down accordingly.
//
// Caching is handled by the lib/sadaka/suggestion.ts wrapper around
// withBrainCache (24h TTL, PHT-day anchored). The fingerprint includes the
// signals listed above so the 24h cache invalidates when period stage flips
// or liquidity moves materially.

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    suggested_amount: { type: Type.NUMBER },
    reasoning: { type: Type.STRING },
    surface_today: { type: Type.BOOLEAN },
  },
  required: ["suggested_amount", "reasoning", "surface_today"],
} as const;

const SYSTEM_PROMPT = `You decide one small voluntary-charity nudge amount per day.

Voice: flat statements, plain, warm. Statement, never imperative.

Hard rules:
- suggested_amount is in base currency (PHP). Between 0 and the pool balance.
- 0 means hide the nudge today. Honest "nothing to surface" is a valid answer.
- reasoning is ONE short sentence. ≤ 14 words.
- surface_today=false hides the widget entirely; only set true when there's a real prompt.
- NEVER use: "you should", "consider", "save more", "stay positive", "well done", "great job", "amazing"
- No "let's", no second-person commands. State the situation; don't tell the user what to do.

Return ONLY {"suggested_amount": number, "reasoning": string, "surface_today": boolean} JSON.`;

export type SadakaSuggestedInput = {
  poolBase: number;
  liquidityBase?: number;
  periodStage?: "harsh" | "recovery" | "surplus" | "neutral";
  daysSinceLastPayment?: number | null;
  upcomingOutflows7dBase?: number;
};

export type SadakaSuggestedDecision = {
  suggested_amount: number;
  reasoning: string;
  surface_today: boolean;
};

function fallback(): SadakaSuggestedDecision {
  return {
    suggested_amount: 0,
    reasoning: "",
    surface_today: false,
  };
}

// Length safety net — the prompt asks for ≤ 14 words but model output can
// drift. Trim to ~100 chars at the first sentence boundary (period / line
// break) so a leaked imperative doesn't bypass voice tone.
function capReasoning(s: string): string {
  if (!s) return "";
  if (s.length <= 100) return s;
  const head = s.slice(0, 100);
  const sentenceEnd = head.search(/[.\n]/);
  if (sentenceEnd > 20) return head.slice(0, sentenceEnd).trim();
  return head.trim();
}

export async function decideSadakaSuggestedToday(
  input: SadakaSuggestedInput,
): Promise<SadakaSuggestedDecision> {
  if (!hasGemini()) return fallback();
  try {
    const lines: string[] = [
      `POOL BALANCE: ${Math.round(input.poolBase)}`,
    ];
    if (input.liquidityBase !== undefined) {
      lines.push(`CASH ON HAND: ${Math.round(input.liquidityBase)}`);
    }
    if (input.periodStage) {
      lines.push(`PERIOD STAGE: ${input.periodStage}`);
    }
    if (
      input.daysSinceLastPayment !== undefined &&
      input.daysSinceLastPayment !== null
    ) {
      lines.push(`DAYS SINCE LAST GIVEN: ${Math.max(0, input.daysSinceLastPayment)}`);
    }
    if (input.upcomingOutflows7dBase !== undefined) {
      lines.push(
        `UPCOMING OUTFLOWS NEXT 7D: ${Math.round(input.upcomingOutflows7dBase)}`,
      );
    }
    lines.push("", "Decide a small voluntary-charity nudge amount for TODAY.");
    const prompt = lines.join("\n");
    const res = await gemini().models.generateContent({
      model: pickModel("heavy"),
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        temperature: 0.3,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
      },
    });
    const parsed = JSON.parse((res.text ?? "{}").trim()) as Partial<
      SadakaSuggestedDecision
    >;
    const amount = Number(parsed.suggested_amount);
    if (!Number.isFinite(amount) || amount < 0) return fallback();
    const reasoning = capReasoning(
      scrubForbiddenPhrases(String(parsed.reasoning ?? "").trim()),
    );
    const surfaceToday = !!parsed.surface_today && amount > 0;
    return {
      suggested_amount: Math.round(amount * 100) / 100,
      reasoning,
      surface_today: surfaceToday,
    };
  } catch {
    return fallback();
  }
}

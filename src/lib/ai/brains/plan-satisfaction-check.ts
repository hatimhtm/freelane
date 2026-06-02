import "server-only";

import { Type } from "@google/genai";
import { gemini, hasGemini, pickModel } from "../models";
import { withBrainCache, fingerprintFromIds, scopedBrainKey } from "../cache";
import { BRAIN_KEYS } from "../cache-keys";
import { scrubForbiddenPhrases } from "../voice-scrub";

// Flash Lite brain — plan_satisfaction_check.
//
// Fired ~14d after bought_at via the plan_satisfaction_check notification.
// Generates the question text + 2-3 quick suggested follow-ups for the
// rating modal. Write-once per plan: re-running for the same plan_id is
// always a cache hit until the row is dropped.
//
// The 1-5 star rating itself is captured by the rateSatisfaction action —
// this brain only produces the prompt.

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    question_text: { type: Type.STRING },
    suggested_followups: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
  },
  required: ["question_text", "suggested_followups"],
} as const;

const SYSTEM_PROMPT = `You write ONE short question asking how a purchase has worked out, plus 2-3 suggested follow-ups.

Voice: plain, warm, observational. Two weeks have passed since the buy.

Hard rules:
- question_text is ONE sentence, ≤ 100 chars. Plain question. Never starts
  with "Hey" / "Hi". Refers to the item by name when natural.
- suggested_followups: 2-3 short noun phrases the user might want to add
  alongside a star rating (e.g. "use it daily", "buyer's remorse",
  "happy with it"). Each ≤ 40 chars.
- NEVER use: "you should", "consider", "save more", "stay positive",
  "well done", "great job", "amazing"

Return ONLY {"question_text": string, "suggested_followups": string[]} JSON.`;

export type PlanSatisfactionCheckInput = {
  planId: string;
  name: string;
  daysSinceBought: number;
};

export type PlanSatisfactionCheckResult = {
  question_text: string;
  suggested_followups: string[];
};

function fallback(name: string): PlanSatisfactionCheckResult {
  return {
    question_text: `How is the ${name || "purchase"} working out?`,
    suggested_followups: ["use it daily", "happy with it", "regret it"],
  };
}

export async function generatePlanSatisfactionPrompt(
  input: PlanSatisfactionCheckInput,
): Promise<PlanSatisfactionCheckResult> {
  if (!hasGemini()) return fallback(input.name);
  const name = (input.name ?? "").trim();
  if (!name) return fallback(name);

  const fp = await fingerprintFromIds([
    "plan_satisfaction_check",
    input.planId,
    name,
  ]);

  const cached = await withBrainCache<PlanSatisfactionCheckResult>({
    brainKey: scopedBrainKey(BRAIN_KEYS.PLAN_SATISFACTION_CHECK, "plan", input.planId),
    fingerprint: fp,
    phtDayAnchored: false,
    regen: async () => {
      const prompt = [
        `ITEM: ${name}`,
        `DAYS SINCE BOUGHT: ${Math.max(0, Math.round(input.daysSinceBought))}`,
        "",
        "Write the satisfaction-check question + suggested follow-ups. Return JSON.",
      ].join("\n");

      const res = await gemini().models.generateContent({
        model: pickModel("fast"),
        contents: prompt,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          temperature: 0.3,
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
        },
      });
      const parsed = JSON.parse((res.text ?? "{}").trim()) as Partial<PlanSatisfactionCheckResult>;
      const question = scrubForbiddenPhrases(
        String(parsed.question_text ?? "").trim(),
      ).slice(0, 140);
      const suggestions = (parsed.suggested_followups ?? [])
        .filter((s) => typeof s === "string")
        .map((s) => scrubForbiddenPhrases(String(s).trim()).slice(0, 60))
        .filter((s) => s.length > 0)
        .slice(0, 3);
      if (!question) return fallback(name);
      return {
        question_text: question,
        suggested_followups: suggestions.length > 0 ? suggestions : fallback(name).suggested_followups,
      };
    },
  });

  return cached?.payload ?? fallback(name);
}

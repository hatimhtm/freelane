import "server-only";

import { Type } from "@google/genai";
import { gemini, hasGemini, pickModel } from "../models";
import { withBrainCache, fingerprintFromIds } from "../cache";
import { BRAIN_KEYS } from "../cache-keys";
import { scrubForbiddenPhrases } from "../voice-scrub";

// Pro brain — spend_sadaka_classifier.
//
// Classifies a spend note as "this looks like voluntary charity". Inputs:
// note + optional vendor name + amount + confidence threshold. The brain
// enforces its own guards so any caller (auto-detect hook, future
// re-classify action, plan-driven backfill) is safe:
//   - note shorter than 8 chars after trim → no model call, returns fallback
//   - is_sadaka_likely is only true when confidence ≥ confidenceThreshold
//
// Returns { is_sadaka_likely, confidence (0-1), reasoning }.
//
// Cached per-input fingerprint: spendId + a stable hash of note + amount +
// vendor name. If the user later edits the note, the fingerprint changes
// and the cache naturally re-evaluates instead of returning the stale
// verdict. The auto-detect hook only fires once per spend anyway (the
// partial unique on the ledger enforces that), so cache hits mostly
// absorb developer re-runs or re-classification paths.

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    is_sadaka_likely: { type: Type.BOOLEAN },
    confidence: { type: Type.NUMBER },
    reasoning: { type: Type.STRING },
  },
  required: ["is_sadaka_likely", "confidence", "reasoning"],
} as const;

const SYSTEM_PROMPT = `You classify a spend note as voluntary charity (sadaka) or not.

Voluntary charity: giving money/food/help to a person, beggar, neighbour, mosque, kid, etc., with no commercial exchange.
NOT sadaka: groceries, bills, transport, dining out, entertainment, work expenses.

Hard rules:
- confidence is between 0 and 1. Be honest about uncertainty.
- reasoning is ONE short flat sentence.
- NEVER use: "you should", "consider", "save more", "stay positive", "well done", "great job", "amazing"

Return ONLY {"is_sadaka_likely": boolean, "confidence": number, "reasoning": string} JSON.`;

export type SpendSadakaClassifierInput = {
  spendId: string;
  note: string;
  amountBase: number;
  vendorName?: string | null;
  // Threshold the caller wants the brain to apply. is_sadaka_likely is
  // FALSE when the model's confidence drops below this. Caller-supplied so
  // a future surface can experiment without forking the brain.
  confidenceThreshold: number;
};

export type SpendSadakaClassifierDecision = {
  is_sadaka_likely: boolean;
  confidence: number;
  reasoning: string;
};

function fallback(): SpendSadakaClassifierDecision {
  return {
    is_sadaka_likely: false,
    confidence: 0,
    reasoning: "no signal",
  };
}

// Stable, short hash so the fingerprint changes when note/amount/vendor
// change but stays compact for cache key storage. Plain non-cryptographic
// hash — collisions are fine because they only mean a single brain re-run.
function inputHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
  }
  return (h >>> 0).toString(36);
}

export async function classifySpendForSadaka(
  input: SpendSadakaClassifierInput,
): Promise<SpendSadakaClassifierDecision> {
  // Defence-in-depth guards. The auto-detect hook also enforces these but
  // re-enforcing here means any future caller — re-classify action, plan
  // backfill, settings reclassify — is safe by default.
  const trimmedNote = (input.note ?? "").trim();
  if (trimmedNote.length < 8) return fallback();
  if (!hasGemini()) return fallback();
  try {
    const vendorName = input.vendorName ?? "";
    const inputSig = inputHash(
      `${trimmedNote}|${Math.round(input.amountBase)}|${vendorName}`,
    );
    const fp = await fingerprintFromIds([input.spendId, inputSig]);
    const threshold = Math.max(0, Math.min(1, Number(input.confidenceThreshold) || 0));
    const cached = await withBrainCache<SpendSadakaClassifierDecision>({
      brainKey: BRAIN_KEYS.SPEND_SADAKA_CLASSIFIER,
      fingerprint: fp,
      phtDayAnchored: false,
      regen: async () => {
        try {
          const prompt = `NOTE: ${trimmedNote}
AMOUNT (base): ${Math.round(input.amountBase)}
VENDOR: ${vendorName || "—"}

Classify.`;
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
            SpendSadakaClassifierDecision
          >;
          const confidence = Number(parsed.confidence);
          if (!Number.isFinite(confidence)) return fallback();
          const reasoning = scrubForbiddenPhrases(
            String(parsed.reasoning ?? "no signal").trim(),
          );
          const boundedConfidence = Math.max(0, Math.min(1, confidence));
          // Threshold is enforced INSIDE the brain so callers don't have
          // to re-derive the gate.
          const meetsThreshold =
            !!parsed.is_sadaka_likely && boundedConfidence >= threshold;
          return {
            is_sadaka_likely: meetsThreshold,
            confidence: boundedConfidence,
            reasoning: reasoning || "no signal",
          };
        } catch {
          return fallback();
        }
      },
    });
    return cached?.payload ?? fallback();
  } catch {
    return fallback();
  }
}

import "server-only";

import { Type } from "@google/genai";
import { gemini, hasGemini, pickModel } from "../models";
import { withBrainCache, fingerprintFromIds, scopedBrainKey } from "../cache";
import { BRAIN_KEYS } from "../cache-keys";
import { hasForbidden } from "../voice-scrub";

// Flash Lite brain — plan_price_lookup.
//
// Estimates a PHP price range for a planned purchase given the plan label
// (and an optional category hint). Output is a {range_low, range_high,
// sources, confidence} bundle that feeds the create-plan modal's "AI
// estimate" chip when the user leaves the price blank.
//
// Cache: per-plan_id slot (scopedBrainKey) so re-opening the same plan is
// always a hit. 7d TTL is a shelf marker — the result is persisted into
// finance.planned_spends.ai_price_range_low/high/sources/at and that row
// IS the source of truth at read time. Regen only on explicit refresh
// via the requestAiPriceLookup action.
//
// Voice scrub passes over the "sources" list defensively (model
// occasionally writes "you should look at Shopee" instead of a vendor
// name) and over any narrative field if added in future.

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    range_low: { type: Type.NUMBER },
    range_high: { type: Type.NUMBER },
    sources: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    confidence: { type: Type.NUMBER },
  },
  required: ["range_low", "range_high", "sources", "confidence"],
} as const;

const SYSTEM_PROMPT = `You estimate the PHP price range for a planned purchase in the Philippines.

Hard rules:
- range_low and range_high are PHP whole numbers. range_low ≤ range_high.
- sources is 1-4 vendor / marketplace names where the price would be checked
  (e.g. "Shopee", "Lazada", "Carousell", "Power Mac Center", "Apple PH").
  Plain names only. No URLs. No sentences.
- confidence is in [0, 1]:
    0.85+ for common, standard items with stable prices
    0.5-0.8 for variable items where range matters more than midpoint
    below 0.5 only when the label is too vague to estimate honestly
- NEVER use: "you should", "consider", "save more", "stay positive",
  "well done", "great job", "amazing"
- If you cannot estimate honestly, return { range_low: 0, range_high: 0,
  sources: [], confidence: 0 }. Honest "I don't know" is a valid answer.

Return ONLY {"range_low": number, "range_high": number, "sources": string[],
"confidence": number} JSON.`;

export type PlanPriceLookupInput = {
  planId: string;
  name: string;
  categoryHint?: string | null;
};

export type PlanPriceLookupResult = {
  range_low: number;
  range_high: number;
  sources: string[];
  confidence: number;
};

function emptyResult(): PlanPriceLookupResult {
  return { range_low: 0, range_high: 0, sources: [], confidence: 0 };
}

export async function lookupPlanPrice(
  input: PlanPriceLookupInput,
): Promise<PlanPriceLookupResult> {
  if (!hasGemini()) return emptyResult();
  const name = (input.name ?? "").trim();
  if (!name) return emptyResult();

  // Fingerprint includes the name + optional category hint so retitling
  // a plan ("MacBook" -> "MacBook M3 Pro") busts the cache and we re-
  // estimate against the new label.
  const fp = await fingerprintFromIds([
    "plan_price_lookup",
    input.planId,
    name,
    input.categoryHint ?? "",
  ]);

  const cached = await withBrainCache<PlanPriceLookupResult>({
    brainKey: scopedBrainKey(BRAIN_KEYS.PLAN_PRICE_LOOKUP, "plan", input.planId),
    fingerprint: fp,
    phtDayAnchored: false,
    regen: async () => {
      const prompt = [
        `PURCHASE: ${name}`,
        input.categoryHint ? `CATEGORY HINT: ${input.categoryHint}` : null,
        "",
        "Estimate the PHP price range for this purchase in the Philippines. Return JSON.",
      ]
        .filter(Boolean)
        .join("\n");

      const res = await gemini().models.generateContent({
        model: pickModel("fast"),
        contents: prompt,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          temperature: 0.2,
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
        },
      });
      const parsed = JSON.parse((res.text ?? "{}").trim()) as Partial<PlanPriceLookupResult>;
      const lo = Math.max(0, Math.round(Number(parsed.range_low) || 0));
      const hi = Math.max(lo, Math.round(Number(parsed.range_high) || 0));
      // sources are label-shaped identifiers (vendor / marketplace
      // names) with no sentence delimiters. scrubForbiddenPhrases is
      // sentence-level and would either blank a whole label or no-op
      // via the empty-out guard. hasForbidden rejects forbidden labels
      // outright — cleaner semantics for identifier-shaped fields.
      const sources = (parsed.sources ?? [])
        .filter((s) => typeof s === "string")
        .map((s) => String(s).trim().slice(0, 60))
        .filter((s) => s.length > 0 && !hasForbidden(s))
        .slice(0, 4);
      const confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0));
      return {
        range_low: lo,
        range_high: hi,
        sources,
        confidence,
      };
    },
  });

  return cached?.payload ?? emptyResult();
}

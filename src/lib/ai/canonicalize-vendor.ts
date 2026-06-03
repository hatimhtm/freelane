import "server-only";

import { Type } from "@google/genai";
import { gemini, hasGemini, pickModel } from "./models";
import { withBrainCache, fingerprintFromIds, scopedBrainKey } from "./cache";
import { BRAIN_KEYS } from "./cache-keys";
import { scrubForbiddenPhrases } from "./voice-scrub";

// Pro brain — canonicalize a vendor name the user just typed.
//
// Always-ask design (locked 2026-06-02 freelane-vendors-design):
// EVERY vendor creation fires a vendor_clarify notification regardless of
// confidence, so this brain's output is the seed for the chat modal's
// suggested chips. The brain itself never decides whether to ask — it
// only proposes the canonical_name + alternatives the user picks from.
//
// Why Pro: Philippine vendor names are heavily ambiguous (sari-sari
// stores, untitled local eateries, OFW slang, Taglish, abbreviations).
// Flash Lite hallucinates chain matches on ambiguous text; the user
// then has to correct each one. Pro reasoning + the spend_context
// (amount, wallet, time, location_hint, tags) costs more per call but
// converges in one round instead of three.

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    canonical_name: { type: Type.STRING },
    brand_match: { type: Type.STRING },
    category_hint: { type: Type.STRING },
    location_hint: { type: Type.STRING },
    confidence: { type: Type.NUMBER },
    alternatives: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          canonical_name: { type: Type.STRING },
          reasoning: { type: Type.STRING },
        },
        required: ["canonical_name"],
      },
    },
  },
  required: ["confidence"],
} as const;

const SYSTEM_PROMPT = `You canonicalize a Philippine vendor name a user just typed when logging a spend.

You speak Filipino, English, and Taglish fluently. Treat slang, abbreviations, and locally-known places as first-class. Examples:
- "JTC" near a Tagaytay area → likely "Jollibee Town Center" or a local cafe.
- "Maeve's" (apostrophe variations: "Maeves", "maeve's") → same place.
- "yung tindahan sa kanto" → "Local sari-sari store" — unidentifiable chain; mark low confidence.
- "Mcdo" → "McDonald's"; "Mercury" → "Mercury Drug" (when context matches).
- "7-11", "7eleven", "seveneleven" → "7-Eleven".
- "sm mayapa" → "SM City Mayapa" (if confident on the branch).

Output JSON ONLY with this shape (no prose elsewhere):
- canonical_name: cleanest display form (1-40 chars). Omit if you would only be guessing wildly.
- brand_match: the canonical chain/brand key if you matched a known PH brand. Empty string when no chain match.
- category_hint: one short word (food, drug, grocery, transit, fuel, telco, bank, service, sari_sari, other). ≤ 16 chars.
- location_hint: one short phrase like "San Pablo", "Tagaytay area". Empty if unknown.
- confidence ∈ [0, 1]. 0.85+ means you're confident enough to suggest as the top chip; 0.4-0.85 means propose but offer alternatives; < 0.4 means it's a guess.
- alternatives: up to 3 alternate canonical_name guesses, each with a 1-line reasoning string. Reasoning is for the user — short, plain, no marketing prose. Empty array when confidence is high.

HARD RULES:
- NEVER fabricate a brand match. If the typed name doesn't clearly map to a known PH chain, brand_match must be empty.
- NEVER write coaching prose like "great question", "I'd love to help", "of course". Just the canonical form + reasoning.
- Reasoning strings must be ≤ 80 chars.
- canonical_name + alternatives must read as nouns, not sentences.
`;

const FORBIDDEN_LIST = [
  "great question",
  "i'd love to help",
  "of course",
  "absolutely",
  "let me explain",
  "i understand",
  "i totally get",
];

function scrub(text: string | null | undefined, max = 80): string {
  if (!text) return "";
  let out = String(text).trim();
  for (const phrase of FORBIDDEN_LIST) {
    out = out.replace(new RegExp(phrase, "ig"), "");
  }
  out = scrubForbiddenPhrases(out).trim();
  return out.slice(0, max);
}

export type CanonicalizeVendorInput = {
  userTypedName: string;
  spendContext?: {
    amount?: number | null;
    walletName?: string | null;
    timeOfDay?: string | null;
    locationHint?: string | null;
    tags?: string[];
  } | null;
  knownVendors?: string[];
  brandRegistry?: string[];
};

export type CanonicalizeVendorAlternative = {
  canonical_name: string;
  reasoning: string;
};

export type CanonicalizeVendorResult = {
  canonical_name: string | null;
  brand_match: string | null;
  category_hint: string | null;
  location_hint: string | null;
  confidence: number;
  alternatives: CanonicalizeVendorAlternative[];
};

function emptyResult(): CanonicalizeVendorResult {
  return {
    canonical_name: null,
    brand_match: null,
    category_hint: null,
    location_hint: null,
    confidence: 0,
    alternatives: [],
  };
}

// Brain that maps user_typed_name + spend_context onto a structured
// canonicalization proposal. NEVER throws — Gemini outages, missing API
// keys, schema drift all degrade to emptyResult(). Cache row is keyed
// per-vendor (scopedBrainKey('vendor', vendorId)) so a vendor is asked
// once and the brain answer stays on file until the user clarifies via
// the chatbot.
export async function canonicalizeVendor(
  vendorId: string,
  input: CanonicalizeVendorInput,
): Promise<CanonicalizeVendorResult> {
  if (!hasGemini()) return emptyResult();
  const typed = (input.userTypedName ?? "").trim();
  if (!typed) return emptyResult();

  const spendCtxFP = [
    input.spendContext?.amount ?? null,
    input.spendContext?.walletName ?? null,
    input.spendContext?.timeOfDay ?? null,
    input.spendContext?.locationHint ?? null,
    ...(input.spendContext?.tags ?? []),
  ]
    .filter((v) => v != null)
    .map((v) => String(v))
    .join("|");

  const fp = await fingerprintFromIds([
    "canonicalize_vendor",
    typed.toLowerCase(),
    spendCtxFP,
  ]);

  const cached = await withBrainCache<CanonicalizeVendorResult>({
    brainKey: scopedBrainKey(BRAIN_KEYS.CANONICALIZE_VENDOR, "vendor", vendorId),
    fingerprint: fp,
    phtDayAnchored: false,
    regen: async () => {
      try {
        const prompt = JSON.stringify({
          user_typed_name: typed,
          spend_context: input.spendContext ?? null,
          known_vendors: (input.knownVendors ?? []).slice(0, 80),
          brand_registry: (input.brandRegistry ?? []).slice(0, 120),
        });
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
        const parsed = JSON.parse((res.text ?? "{}").trim()) as Partial<{
          canonical_name: string;
          brand_match: string;
          category_hint: string;
          location_hint: string;
          confidence: number;
          alternatives: Array<{ canonical_name?: string; reasoning?: string }>;
        }>;
        const confidence = Math.max(0, Math.min(1, Number(parsed.confidence ?? 0)));
        const alts: CanonicalizeVendorAlternative[] = (parsed.alternatives ?? [])
          .map((a) => ({
            canonical_name: scrub(a.canonical_name, 40),
            reasoning: scrub(a.reasoning, 80),
          }))
          .filter((a) => !!a.canonical_name)
          .slice(0, 3);
        const result: CanonicalizeVendorResult = {
          canonical_name: scrub(parsed.canonical_name, 40) || null,
          brand_match: scrub(parsed.brand_match, 40) || null,
          category_hint: scrub(parsed.category_hint, 16) || null,
          location_hint: scrub(parsed.location_hint, 40) || null,
          confidence,
          alternatives: alts,
        };
        return result;
      } catch {
        // Brain failure must never throw — the always-ask flow still
        // dispatches a vendor_clarify with empty suggestions so the
        // user can clarify by hand.
        return emptyResult();
      }
    },
  });

  return cached?.payload ?? emptyResult();
}

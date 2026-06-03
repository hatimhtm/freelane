import "server-only";

import { Type } from "@google/genai";
import { gemini, hasGemini, pickModel } from "../models";
import { withBrainCache, fingerprintFromIds, scopedBrainKey } from "../cache";
import { BRAIN_KEYS } from "../cache-keys";
import { scrubForbiddenPhrases } from "../voice-scrub";

// Pro brain — GATE 2 (entity_clarify).
//
// Always-ask design (locked 2026-06-03 freelane-entities-design):
// EVERY entity creation fires an entity_clarify notification regardless
// of confidence, so this brain's output is the seed for the chatbot
// modal's suggested chips. The brain itself never decides whether to ask
// — it only proposes the canonical_name + relationship + alternatives
// the user picks from.
//
// Why Pro: Philippine relationship terms are heavily context-dependent
// (Kuya can be a brother OR a respectful term for any older male; Lola
// can be a grandmother OR a beloved elderly woman in the neighbourhood;
// "Tito Boy" is uniquely PH naming). Flash Lite hallucinates
// relationship labels on ambiguous text; the user then has to correct
// each one. Pro reasoning + the relationship_context (recent
// interaction kinds, money direction, source signal) costs more per
// call but converges in one round instead of three.

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    canonical_name: { type: Type.STRING },
    relationship: { type: Type.STRING },
    confidence: { type: Type.NUMBER },
    alternatives: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          canonical_name: { type: Type.STRING },
          relationship: { type: Type.STRING },
          reasoning: { type: Type.STRING },
        },
        required: ["canonical_name"],
      },
    },
    reasoning: { type: Type.STRING },
  },
  required: ["confidence"],
} as const;

const SYSTEM_PROMPT = `You canonicalize a Philippine entity name (a person, pet, place, or concept the user just added) and propose the social/role relationship.

You speak Filipino, English, and Taglish fluently. Treat family terms ("Kuya", "Ate", "Lola", "Tito", "Nanay", "Tatay", "Inay", "Itay") as first-class. "Tito" + a personal name almost always means "uncle" or "elder family friend"; "Ate Ana" → older sister or older female peer; "Lola Maria" → grandmother.

Inputs you receive:
- user_typed_name: the literal string the user (or AI inference) entered.
- relationship_context: recent interactions involving this entity — list of {kind, amount?, note?} items. Empty list means brand-new.
- discovered_from: where the entity originated ("manual_add", "spend_note", "chat_message", "sadaka_payment", "gate1_confirmed").
- known_relationships: PH-canonical relationship labels you should prefer when matching.

Output JSON ONLY:
- canonical_name: cleanest display form (1-40 chars). Title case. Omit if you'd be guessing wildly.
- relationship: ONE short word from this catalogue when confident: wife, sibling, parent, child, cousin, uncle, aunt, grandparent, grandchild, neighbour, friend, colleague, mentor, vendor_owner, sadaka_recipient, pet, household, place, ritual, other. Empty string when unsure.
- confidence ∈ [0, 1]. 0.85+ when the typed name + context is unambiguous; 0.4-0.85 when there's a reasonable guess but alternatives exist; < 0.4 means it's a stab.
- alternatives: up to 3 alternate {canonical_name, relationship, reasoning} guesses. Each reasoning ≤ 80 chars. Empty when confidence is high.
- reasoning: ≤ 80 chars overall justification for the primary guess.

HARD RULES:
- NEVER fabricate a relationship the context doesn't support. If the input is "Junjun" with no context, propose canonical_name="Junjun", relationship="" (empty), confidence ≈ 0.3.
- NEVER write coaching prose ("great", "amazing", "I'd love to help"). Just labels + short reasoning.
- canonical_name + alternatives read as proper nouns, not sentences.
- Reasoning strings ≤ 80 chars.
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

export type CanonicalizeEntityInput = {
  userTypedName: string;
  discoveredFrom?: string | null;
  relationshipContext?: Array<{
    kind: string;
    amount?: number | null;
    note?: string | null;
  }> | null;
  knownRelationships?: string[];
};

export type CanonicalizeEntityAlternative = {
  canonical_name: string;
  relationship: string;
  reasoning: string;
};

export type CanonicalizeEntityResult = {
  canonical_name: string | null;
  relationship: string | null;
  confidence: number;
  alternatives: CanonicalizeEntityAlternative[];
  reasoning: string;
};

function emptyResult(): CanonicalizeEntityResult {
  return {
    canonical_name: null,
    relationship: null,
    confidence: 0,
    alternatives: [],
    reasoning: "",
  };
}

// The default catalogue passed to the brain — overridable per call so
// future relationship taxonomies can extend without a code change here.
const DEFAULT_KNOWN_RELATIONSHIPS = [
  "wife",
  "sibling",
  "parent",
  "child",
  "cousin",
  "uncle",
  "aunt",
  "grandparent",
  "grandchild",
  "neighbour",
  "friend",
  "colleague",
  "mentor",
  "vendor_owner",
  "sadaka_recipient",
  "pet",
  "household",
  "place",
  "ritual",
  "other",
];

// Pro brain that maps user_typed_name + relationship_context onto a
// structured canonicalization proposal. NEVER throws — Gemini outages,
// missing API keys, schema drift all degrade to emptyResult(). Cache row
// is keyed per-entity (scopedBrainKey('entity', entityId)) so an entity
// is asked once and the brain answer stays on file until the user
// clarifies via the chatbot.
export async function canonicalizeEntity(
  entityId: string,
  input: CanonicalizeEntityInput,
): Promise<CanonicalizeEntityResult> {
  if (!hasGemini()) return emptyResult();
  const typed = (input.userTypedName ?? "").trim();
  if (!typed) return emptyResult();

  const ctxFingerprint = (input.relationshipContext ?? [])
    .map((c) => `${c.kind}:${c.amount ?? ""}:${(c.note ?? "").slice(0, 24)}`)
    .join("|");

  const fp = await fingerprintFromIds([
    "canonicalize_entity",
    typed.toLowerCase(),
    input.discoveredFrom ?? "",
    ctxFingerprint,
  ]);

  const cached = await withBrainCache<CanonicalizeEntityResult>({
    brainKey: scopedBrainKey(BRAIN_KEYS.CANONICALIZE_ENTITY, "entity", entityId),
    fingerprint: fp,
    phtDayAnchored: false,
    regen: async () => {
      try {
        const prompt = JSON.stringify({
          user_typed_name: typed,
          discovered_from: input.discoveredFrom ?? null,
          relationship_context: (input.relationshipContext ?? []).slice(0, 20),
          known_relationships:
            input.knownRelationships ?? DEFAULT_KNOWN_RELATIONSHIPS,
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
          relationship: string;
          confidence: number;
          alternatives: Array<{
            canonical_name?: string;
            relationship?: string;
            reasoning?: string;
          }>;
          reasoning: string;
        }>;
        const confidence = Math.max(
          0,
          Math.min(1, Number(parsed.confidence ?? 0)),
        );
        const alts: CanonicalizeEntityAlternative[] = (parsed.alternatives ?? [])
          .map((a) => ({
            canonical_name: scrub(a.canonical_name, 40),
            relationship: scrub(a.relationship, 24),
            reasoning: scrub(a.reasoning, 80),
          }))
          .filter((a) => !!a.canonical_name)
          .slice(0, 3);
        const result: CanonicalizeEntityResult = {
          canonical_name: scrub(parsed.canonical_name, 40) || null,
          relationship: scrub(parsed.relationship, 24) || null,
          confidence,
          alternatives: alts,
          reasoning: scrub(parsed.reasoning, 80),
        };
        return result;
      } catch {
        // Brain failure must never throw — the always-ask flow still
        // dispatches an entity_clarify with empty suggestions so the
        // user can clarify by hand.
        return emptyResult();
      }
    },
  });

  return cached?.payload ?? emptyResult();
}

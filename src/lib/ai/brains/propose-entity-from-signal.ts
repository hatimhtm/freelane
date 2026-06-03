import "server-only";

import { Type } from "@google/genai";
import { gemini, hasGemini, pickModel } from "../models";
import { withBrainCache, fingerprintFromIds, scopedBrainKey } from "../cache";
import { BRAIN_KEYS } from "../cache-keys";
import { scrubForbiddenPhrases } from "../voice-scrub";
import { normalizeEntityName } from "@/lib/entities/normalize";

// Flash Lite brain — GATE 1 (entity_discovery_request).
//
// Reads a signal (spend note, chat message, sadaka_payment recipient,
// transfer target) plus a candidate name extracted from that signal and
// decides whether the name LOOKS like an entity worth proposing. The
// brain NEVER auto-creates the entity — its output is the seed for the
// entity_discovery_request notification the user then accepts / edits /
// rejects.
//
// Inputs the dispatcher passes through:
//   - source_kind      "spend_note" | "chat_message" | "sadaka_payment" | "transfer_target"
//   - source_text      the surrounding context (≤ 300 chars)
//   - candidate_name   the name the regex / NER lift extracted
//   - existing_entities  up to 80 known canonical_names so the brain can
//                        flag "this is probably an existing entity"
//   - denylist         names the user has explicitly rejected via
//                      entity_discovery_denylist
//
// Output:
//   - is_potential_entity      bool — the dispatcher gates on this
//   - match_existing           string|null — existing canonical_name the
//                              signal is more likely about (avoids dupes)
//   - suggested_name           clean display form (cap 40 chars)
//   - suggested_relationship   one short word ("wife", "sibling",
//                              "uncle", "neighbour", "friend", "pet",
//                              "colleague", "vendor_owner", "other")
//   - confidence ∈ [0, 1]
//   - reasoning                ≤ 80 chars, plain user-facing line
//
// Cache slot is per-signal-fingerprint (scopedBrainKey('signal',
// signalFingerprint)) so a chat message that re-mentions the same name
// hits the cache instead of burning another Gemini call. Write-once per
// question (30-day TTL acts as a shelf marker).

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    is_potential_entity: { type: Type.BOOLEAN },
    match_existing: { type: Type.STRING },
    suggested_name: { type: Type.STRING },
    suggested_relationship: { type: Type.STRING },
    confidence: { type: Type.NUMBER },
    reasoning: { type: Type.STRING },
  },
  required: ["is_potential_entity", "confidence"],
} as const;

const SYSTEM_PROMPT = `You decide whether a candidate name extracted from a freelancer's signal looks like a real person/entity worth tracking.

The user (a freelance dev in the Philippines) flows money to people across his network — wife, siblings, uncles, neighbours, sadaka recipients, friends. Speak Filipino, English, and Taglish. Treat slang and family terms ("Kuya", "Ate", "Lola", "Tito", "Nanay", "Tatay") as first-class.

You see:
- source_kind: where the candidate name came from (spend note / chat message / sadaka recipient / transfer target).
- source_text: ≤ 300 chars of surrounding context. Treat as the user's literal words.
- candidate_name: what the regex / lift pulled out — may be slightly noisy.
- existing_entities: list of names the user already tracks. If the candidate is a clear variant ("Jun" vs "Junjun"), set match_existing to the existing canonical and is_potential_entity=false.
- denylist: names the user has explicitly rejected before. NEVER propose a name from this list (set is_potential_entity=false).

Output JSON ONLY:
- is_potential_entity: true ONLY when the name looks like a real person/entity worth asking the user about AND it's not on the denylist AND not a clear duplicate of an existing entity.
- match_existing: existing canonical_name when the candidate is a variant; empty string otherwise.
- suggested_name: cleanest display form (1-40 chars). Title case. Empty when is_potential_entity=false.
- suggested_relationship: ONE short word — wife, sibling, uncle, aunt, parent, child, cousin, neighbour, friend, colleague, vendor_owner, sadaka_recipient, pet, other. Empty when unknown.
- confidence ∈ [0, 1]. 0.8+ when the source_text strongly implies a relationship; 0.4-0.8 when the name appears but context is thin; < 0.4 means you're guessing.
- reasoning: ≤ 80 chars, plain user-facing line. No marketing prose.

HARD RULES:
- NEVER propose generic words ("food", "gift", "store") as entities — those are objects, not people/entities.
- NEVER propose names from the denylist.
- NEVER write coaching language ("great", "amazing", "I'd love to help").
- When source_text reads like a vendor/place ("Maeve's", "Jollibee"), set is_potential_entity=false — those are vendors, not entities.
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

export type ProposeEntitySignalKind =
  | "spend_note"
  | "chat_message"
  | "sadaka_payment"
  | "transfer_target";

export type ProposeEntityFromSignalInput = {
  signalFingerprint: string;
  sourceKind: ProposeEntitySignalKind;
  sourceText: string;
  candidateName: string;
  existingEntities: string[];
  denylist: string[];
};

export type ProposeEntityFromSignalResult = {
  is_potential_entity: boolean;
  match_existing: string | null;
  suggested_name: string | null;
  suggested_relationship: string | null;
  confidence: number;
  reasoning: string;
};

function emptyResult(): ProposeEntityFromSignalResult {
  return {
    is_potential_entity: false,
    match_existing: null,
    suggested_name: null,
    suggested_relationship: null,
    confidence: 0,
    reasoning: "",
  };
}

export async function proposeEntityFromSignal(
  input: ProposeEntityFromSignalInput,
): Promise<ProposeEntityFromSignalResult> {
  if (!hasGemini()) return emptyResult();
  const candidate = (input.candidateName ?? "").trim();
  if (!candidate) return emptyResult();
  // Use the shared normalizer so the denylist key stays byte-aligned
  // with the discovery + discovery-actions writers (migration 0098).
  const denyNormalized = new Set(
    (input.denylist ?? []).map((s) => normalizeEntityName(s)),
  );
  const candidateNorm = normalizeEntityName(candidate);
  if (denyNormalized.has(candidateNorm)) {
    // Short-circuit: the user has already explicitly rejected this
    // exact name — don't pay Gemini to confirm the same answer.
    return emptyResult();
  }

  const fp = await fingerprintFromIds([
    "propose_entity_from_signal",
    input.signalFingerprint,
    candidate.toLowerCase(),
    input.sourceKind,
  ]);

  const cached = await withBrainCache<ProposeEntityFromSignalResult>({
    brainKey: scopedBrainKey(
      BRAIN_KEYS.PROPOSE_ENTITY_FROM_SIGNAL,
      "signal",
      input.signalFingerprint,
    ),
    fingerprint: fp,
    phtDayAnchored: false,
    regen: async () => {
      try {
        const prompt = JSON.stringify({
          source_kind: input.sourceKind,
          source_text: (input.sourceText ?? "").slice(0, 300),
          candidate_name: candidate,
          existing_entities: (input.existingEntities ?? []).slice(0, 80),
          denylist: (input.denylist ?? []).slice(0, 120),
        });
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
        const parsed = JSON.parse((res.text ?? "{}").trim()) as Partial<{
          is_potential_entity: boolean;
          match_existing: string;
          suggested_name: string;
          suggested_relationship: string;
          confidence: number;
          reasoning: string;
        }>;
        const confidence = Math.max(
          0,
          Math.min(1, Number(parsed.confidence ?? 0)),
        );
        const result: ProposeEntityFromSignalResult = {
          is_potential_entity: !!parsed.is_potential_entity,
          match_existing: scrub(parsed.match_existing, 40) || null,
          suggested_name: scrub(parsed.suggested_name, 40) || null,
          suggested_relationship:
            scrub(parsed.suggested_relationship, 24) || null,
          confidence,
          reasoning: scrub(parsed.reasoning, 80),
        };
        return result;
      } catch {
        // Brain failure must never throw — the dispatcher swallows
        // empty results and the user simply doesn't see a discovery
        // request for this signal. Next cron sweep gets another shot.
        return emptyResult();
      }
    },
  });

  return cached?.payload ?? emptyResult();
}

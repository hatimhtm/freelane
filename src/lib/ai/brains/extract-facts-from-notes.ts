import "server-only";

import { Type } from "@google/genai";
import { gemini, hasGemini, pickModel } from "../models";
import { withBrainCache, fingerprintFromIds, scopedBrainKey } from "../cache";
import { BRAIN_KEYS } from "../cache-keys";
import { scrubForbiddenPhrases } from "../voice-scrub";
import type { FactProjection, FactSubjectKind } from "../facts";

// Single source of truth for the confidence floor. Plugged into both the
// system-prompt template AND the post-filter so a future tweak (e.g.
// surfacing 0.4 soft inferences as low-confidence pending suggestions)
// can't silently drift between sides.
const MIN_FACT_CONFIDENCE = 0.5;

// Flash Lite brain — turn free-form notes into structured facts.
//
// Triggered (debounced 30s) on every save of a client's notes textarea.
// Output is UPSERTed into ai_user_facts (subject_kind+subject_id scoped),
// so the AI keeps learning as Hatim writes. removed_facts is the diff:
// facts the old notes implied but the new notes no longer support — the
// caller archives those rows so the AI's view converges with the writing.
//
// Voice scrub runs on every value string to keep coaching language out.
// Cache key: client_id + sha-stable hash of notes_text, so re-saving the
// exact same notes is a cache hit (no model call). Sanity-test prompt at
// the bottom of the file documents the expected output for a fixed input.

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    facts: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          key: { type: Type.STRING },
          value: { type: Type.STRING },
          confidence: { type: Type.NUMBER },
          evidence_excerpt: { type: Type.STRING },
        },
        required: ["key", "value", "confidence", "evidence_excerpt"],
      },
    },
    removed_facts: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
  },
  required: ["facts", "removed_facts"],
} as const;

// evidence_excerpt is a VERBATIM substring of the user's own notes, so the
// forbidden-phrase rule below explicitly carves it out — the user may well
// have written "I should consider …" themselves and the panel needs to show
// what they wrote. The runtime sweep (scrubForbiddenPhrases at the bottom)
// applies to BOTH `value` and `evidence_excerpt` for defence in depth, but
// the prompt only enforces it on `value` so the model doesn't paraphrase
// evidence away from the source.
const SYSTEM_PROMPT = `You read a freelance dev's private notes about ONE client and extract structured facts.

Hard rules:
- One fact per concept. "Prefers Wise" is ONE fact (payment_preference=wise), not two.
- key uses snake_case. Examples: payment_preference, timezone, deliverable_style, communication_cadence, payment_terms, pricing_anchor, rate_currency.
- value is a short string. ≤ 60 chars. Plain words.
- confidence ∈ [0,1]. 0.9+ only when the note states it outright; 0.5–0.7 for soft inferences; below ${MIN_FACT_CONFIDENCE} never appears in output.
- evidence_excerpt: the exact substring of the notes that supports the fact, ≤ 80 chars. Use the user's literal words — even if they contain phrases the value rule below bans.
- removed_facts: KEYS (from the previously_extracted_facts list) that the CURRENT notes no longer support. Empty array if the note adds to the picture without contradicting anything.
- NEVER fabricate. If the note is ambiguous, do NOT emit a fact.
- NEVER use "you should", "consider", "save more", "stay positive", "well done", "great job", "amazing" in the value field (evidence_excerpt is exempt — it's verbatim).

Return ONLY {"facts": [...], "removed_facts": [...]} JSON.`;

export type ExtractedFact = {
  key: string;
  value: string;
  confidence: number;
  evidence_excerpt: string;
};

export type ExtractFactsResult = {
  facts: ExtractedFact[];
  removed_facts: string[];
};

export type ExtractFactsInput = {
  subjectKind: FactSubjectKind;
  subjectId: string;
  fullNotesText: string;
  previouslyExtractedFacts: FactProjection[];
};

function emptyResult(): ExtractFactsResult {
  return { facts: [], removed_facts: [] };
}

export async function extractFactsFromNotes(
  input: ExtractFactsInput,
): Promise<ExtractFactsResult> {
  if (!hasGemini()) return emptyResult();
  const notes = (input.fullNotesText ?? "").trim();
  if (!notes) return emptyResult();

  // Hash the FULL notes content (FNV-1a inside fingerprintFromIds). The
  // prompt itself truncates to 4000 chars just before the model call;
  // hashing the whole string here means edits past char 4000 still bust
  // the cache instead of colliding onto a stale row.
  const fp = await fingerprintFromIds([
    "extract_facts",
    input.subjectKind,
    input.subjectId,
    notes,
  ]);

  // Per-subject cache slot: ai_brain_cache is keyed by (user_id, brain_key)
  // so a bare EXTRACT_FACTS_FROM_NOTES key would mean a single row per
  // user — editing client B would overwrite client A's row, and re-saving
  // client A unchanged would fingerprint-mismatch and force a regen.
  // scopedBrainKey gives each (subjectKind, subjectId) its own slot.
  const cached = await withBrainCache<ExtractFactsResult>({
    brainKey: scopedBrainKey(
      BRAIN_KEYS.EXTRACT_FACTS_FROM_NOTES,
      input.subjectKind,
      input.subjectId,
    ),
    fingerprint: fp,
    phtDayAnchored: false,
    regen: async () => {
      // No catch here: any parse / model failure propagates so
      // withBrainCache returns the prior cached payload instead of
      // writing emptyResult() into the cache. A transient hiccup would
      // otherwise poison the slot for the TTL window.
      const priorBlock = input.previouslyExtractedFacts.length
        ? input.previouslyExtractedFacts
            .map((f) => {
              // Unwrap the {answer: "..."} storage envelope upsertFact
              // wraps plain strings in. Showing the raw envelope to the
              // model wastes tokens and risks the model echoing the
              // {answer: ...} shape back in new fact values.
              const v = (f.value ?? {}) as { answer?: unknown };
              const display =
                typeof v.answer === "string"
                  ? v.answer
                  : JSON.stringify(f.value);
              return `- ${f.key}: ${display} (confidence=${f.confidence.toFixed(2)})`;
            })
            .join("\n")
        : "(none yet)";

      const prompt = `SUBJECT: ${input.subjectKind} (id=${input.subjectId})

PREVIOUSLY EXTRACTED FACTS:
${priorBlock}

CURRENT NOTES (verbatim):
"""
${notes.slice(0, 4000)}
"""

Extract structured facts from the CURRENT notes. List removed_facts for any prior keys the current notes no longer support. Return JSON.`;

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
        facts: ExtractedFact[];
        removed_facts: string[];
      }>;

      const cleanedFacts: ExtractedFact[] = (parsed.facts ?? [])
        .filter(
          (f) =>
            f &&
            typeof f.key === "string" &&
            typeof f.value === "string" &&
            typeof f.confidence === "number",
        )
        .map((f) => {
          const confidence = Math.max(0, Math.min(1, Number(f.confidence)));
          const value = scrubForbiddenPhrases(String(f.value).trim()).slice(
            0,
            80,
          );
          // Defence-in-depth: the prompt exempts evidence from the
          // forbidden-phrase rule (so the verbatim excerpt is preserved),
          // but the user's own writing may itself contain banned phrases
          // — scrub here so a coaching string can't surface in the UI
          // via the evidence line.
          const evidence = scrubForbiddenPhrases(
            String(f.evidence_excerpt ?? "").trim(),
          ).slice(0, 120);
          return {
            key: String(f.key).trim().slice(0, 80),
            value,
            confidence,
            evidence_excerpt: evidence,
          };
        })
        .filter(
          (f) =>
            f.key.length > 0 &&
            f.value.length > 0 &&
            f.confidence >= MIN_FACT_CONFIDENCE &&
            // The model occasionally emits keys with whitespace —
            // canonicalise to snake_case so the UPSERT conflict target
            // collapses duplicates.
            /^[a-z0-9_]+$/.test(f.key),
        );

      const removed = (parsed.removed_facts ?? [])
        .filter((s) => typeof s === "string" && s.length > 0)
        .map((s) => String(s).trim().slice(0, 80))
        .filter((s) => /^[a-z0-9_]+$/.test(s));

      return { facts: cleanedFacts, removed_facts: removed };
    },
  });

  return cached?.payload ?? emptyResult();
}

// Sanity-test reference for the brain. Document, not regression test —
// Flash Lite is probabilistic and asserting exact keys here would flake
// in CI. The expected output for the input below is roughly:
//
// Input notes: "JoTel prefers Wise, EST timezone, likes detailed weekly reports"
// Expected facts (≥ 3 with confidence > 0.5):
//   { key: "payment_preference", value: "wise", confidence: ≥ 0.9 }
//   { key: "timezone", value: "EST", confidence: ≥ 0.9 }
//   { key: "deliverable_style", value: "detailed weekly reports", confidence: ≥ 0.8 }
//
// To verify manually:
//   pnpm tsx --eval "import('./src/lib/ai/brains/extract-facts-from-notes').then(async ({extractFactsFromNotes}) => console.log(JSON.stringify(await extractFactsFromNotes({subjectKind:'client',subjectId:'00000000-0000-0000-0000-000000000000',fullNotesText:'JoTel prefers Wise, EST timezone, likes detailed weekly reports',previouslyExtractedFacts:[]}), null, 2)))"

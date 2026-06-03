import "server-only";

import { Type } from "@google/genai";
import { gemini, hasGemini, pickModel } from "../models";
import { withBrainCache, scopedBrainKey } from "../cache";
import { BRAIN_KEYS } from "../cache-keys";
import { scrubForbiddenPhrases } from "../voice-scrub";
import { phtDateString } from "@/lib/utils";
import type { EditorialLetterKind } from "@/lib/supabase/types";
import type { LetterEngagementStats } from "@/lib/data/queries";

// Worth-Saying Quality Gate Brain (Flash Lite).
//
// Sits BEFORE every Tier 3 auto-trigger emission path. The job: hold the
// editorial voice's bar. A letter that didn't earn its space erodes the
// surface; better to skip than to drone.
//
// Hard skip rules (deterministic, run before the model):
//   1. A similar-theme letter was generated in the trailing 14 days
//      (Sunday letters: same kind; quiet-receipt letters: same trigger_kind
//      in the payload). The shelf is too fresh to add to.
//   2. The user did not open ANY of the last 3 letters. The signal here is
//      stronger than the model's verdict — silence the surface until the
//      user re-engages.
//
// When neither skip rule fires the brain is consulted. Without Gemini
// configured the deterministic fallback is proceed=true (skip rules already
// caught the egregious cases; the editorial brain itself does another pass
// of voice scrubbing).
//
// Cache slot: scopedBrainKey(LETTER_WORTH_SAYING, "trigger_day",
// `${trigger_kind}:${phtDayKey}`) — write-once per (trigger_kind, PHT day)
// so repeat fires inside one day land on the same verdict instead of
// re-billing Flash Lite.
//
// Voice: the brain explains itself in `reasoning` for the audit log; that
// string runs through scrubForbiddenPhrases before persistence so a hot
// take from the model can't leak coaching language into the audit trail.

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    proceed: { type: Type.BOOLEAN },
    reasoning: { type: Type.STRING },
    theme_hint: { type: Type.STRING },
  },
  required: ["proceed", "reasoning"],
  propertyOrdering: ["proceed", "reasoning", "theme_hint"],
} as const;

const SYSTEM_PROMPT = `You are the editorial quality gate for Hatim's Freelane letters.

You decide whether a proposed auto-triggered letter is WORTH SAYING. The bar is HIGH — Hatim's editorial surface only stays valuable if the letters that land are letters he wants to read.

Inputs:
- trigger_kind: the Tier 3 hook that fired (recurring_paused, recurring_changed, recurring_lowered, loan_repaid, plan_done, generic_quiet_receipt, etc.)
- trigger_payload: structured details from the source event
- recent_letters: the slim list of letters generated in the trailing 30 days
- user_engagement: open-rate signals (last_letter_opened_at, count in 30d, last_3_opened boolean array)
- current_user_state: a short freeform summary of what the user is in right now

Rules:
- proceed=true ONLY when the trigger has REAL substance — a meaningful number, a structural change, or a moment that won't recur soon. A ₱20 utility lowering by ₱2 is NOT worth a letter. A rent shift IS.
- If recent_letters already contains 2+ letters in the trailing 7 days, default to proceed=false unless the trigger has structural weight.
- If the user has NOT opened the last 3 letters, default to proceed=false.
- reasoning: one short sentence (≤ 100 chars), dry observation, no coaching language. "Two letters this week already" or "Loan close worth holding up." Never "you should" / "I recommend" / "stay positive".
- theme_hint: an optional short string (≤ 40 chars) the editorial writer can use to anchor the letter ("loan close · 142 days", "rent shift", "quiet plan landed"). Null if you don't have one.

Return JSON: { proceed, reasoning, theme_hint? }`;

export type LetterWorthSayingInput = {
  trigger_kind: string;
  trigger_payload: Record<string, unknown>;
  recent_letters: Array<{
    id: string;
    kind: EditorialLetterKind;
    period_key: string;
    headline: string;
    generated_at: string;
  }>;
  user_engagement: LetterEngagementStats;
  current_user_state: string;
};

export type LetterWorthSayingResult = {
  proceed: boolean;
  reasoning: string;
  theme_hint: string | null;
};

const DAY_MS = 86_400_000;

function fourteenDayThemeBlocked(
  triggerKind: string,
  recentLetters: LetterWorthSayingInput["recent_letters"],
): boolean {
  // Theme = trigger_kind on Tier 3 receipts. The auto-trigger layer
  // derives a per-receipt periodKey shaped as
  //   `${letterKind}-${triggerKind}-${stableId|day}`
  // so we can lift the trigger_kind back out of the letter row's
  // period_key WITHOUT a schema change. That keeps each receipt-driven
  // theme (loan_repaid, plan_done, recurring_paused, etc.) on its own
  // 14-day clock instead of collapsing all 5 into a single bucket.
  //
  // Sunday + end_of_month time-keyed letters still use periodKeyFor()
  // (no triggerKind embedded); we keep the kind-based pairing for those.
  const isReceiptTrigger =
    triggerKind.startsWith("recurring_") ||
    triggerKind.startsWith("loan_") ||
    triggerKind.startsWith("plan_");
  return recentLetters.some((l) => {
    const ageMs = Date.now() - new Date(l.generated_at).getTime();
    if (ageMs > 14 * DAY_MS) return false;
    if (isReceiptTrigger) {
      // Only the SAME triggerKind blocks itself — a loan_repaid letter 8
      // days back does not gate a plan_done letter today. The receipt-
      // derived period_key carries `-${triggerKind}-` in its middle
      // segment, so a substring match is enough to read it back. Fall
      // back to the old kind-bucket behaviour for legacy rows that
      // pre-date the per-trigger periodKey derivation.
      if (l.kind !== "spotlight" && l.kind !== "regret_mark") return false;
      if (l.period_key.includes(`-${triggerKind}-`)) return true;
      // Legacy row (period_key looks like a YYYY-MM month bucket from
      // periodKeyFor('spotlight') / ('regret_mark')) — no trigger_kind
      // tag embedded. Fall back to the old bucket behaviour so the
      // safety net doesn't disappear for letters written before the
      // periodKey derivation landed.
      const isLegacyMonthKey = /^\d{4}-\d{2}$/.test(l.period_key);
      return isLegacyMonthKey;
    }
    if (triggerKind === "sunday") return l.kind === "sunday";
    if (triggerKind === "end_of_month") return l.kind === "end_of_month";
    return false;
  });
}

// Cheap, stable fingerprint over the discriminating ids in a trigger
// payload. Used as the per-payload backstop on the cache slot so a
// recurring_lowered with rule A and rule B on the same day don't share
// a verdict (and theme_hint). FNV-1a-ish over the known id keys; if no
// ids are present we fall back to a JSON-shape hash so the cache still
// busts when the payload structure changes.
function stablePayloadFingerprint(payload: Record<string, unknown>): string {
  const keys = [
    "loan_id",
    "planned_spend_id",
    "recurring_spend_id",
    "spend_id",
    "payment_id",
    "milestone_id",
    "quiet_receipt_id",
    "life_shift_id",
    "subject_id",
    "id",
  ];
  const parts: string[] = [];
  for (const k of keys) {
    const v = payload[k];
    if (typeof v === "string" && v.length > 0) parts.push(`${k}=${v}`);
  }
  const seed = parts.length ? parts.join("|") : JSON.stringify(payload).slice(0, 240);
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

function disengaged(stats: LetterEngagementStats): boolean {
  // Skip when we have 3+ data points AND every one is unread. Fewer than
  // 3 letters in the shelf? Not enough signal to call disengagement.
  if (stats.last_3_opened.length < 3) return false;
  return stats.last_3_opened.every((opened) => !opened);
}

export async function generateLetterWorthSaying(
  input: LetterWorthSayingInput,
): Promise<LetterWorthSayingResult> {
  // Hard deterministic skip rules — these always run, even before the cache
  // lookup, so the cache slot never holds a stale "proceed=true" against a
  // shelf that just filled up. The skip-rule outcome is the cached payload
  // (so a repeat trigger same-day hits the cache, not the model).
  if (fourteenDayThemeBlocked(input.trigger_kind, input.recent_letters)) {
    return {
      proceed: false,
      reasoning: scrubForbiddenPhrases(
        "Similar-theme letter already on the shelf within 14 days.",
      ),
      theme_hint: null,
    };
  }
  if (disengaged(input.user_engagement)) {
    return {
      proceed: false,
      reasoning: scrubForbiddenPhrases(
        "Last three letters unopened — silencing this surface.",
      ),
      theme_hint: null,
    };
  }

  // Without Gemini configured we proceed by default (deterministic skip
  // rules already caught the dangerous cases).
  if (!hasGemini()) {
    return {
      proceed: true,
      reasoning: "Deterministic pass — no model available.",
      theme_hint: null,
    };
  }

  const phtDayKey = phtDateString(new Date());
  // Cache key scopes the brain's verdict to (trigger_kind, PHT day) so a
  // repeat fire of the SAME trigger same-day shares the verdict (and
  // theme_hint). Two DIFFERENT recurring_lowered events on the same day
  // (different recurring rule ids) need separate slots — otherwise the
  // second event reads the first event's theme_hint and the editorial
  // brain prepends a hint about the wrong rule. The payload fingerprint
  // captures the discriminating ids from the trigger payload so the
  // wrapper busts cache when they disagree.
  const payloadFingerprint = stablePayloadFingerprint(input.trigger_payload);
  const cached = await withBrainCache<LetterWorthSayingResult>({
    brainKey: scopedBrainKey(
      BRAIN_KEYS.LETTER_WORTH_SAYING,
      "trigger_day",
      `${input.trigger_kind}:${phtDayKey}`,
    ),
    fingerprint: payloadFingerprint,
    phtDayAnchored: true,
    regen: async () => {
      const recentBlock = input.recent_letters.length
        ? input.recent_letters
            .slice(0, 8)
            .map(
              (l) =>
                `- ${l.generated_at.slice(0, 10)} · ${l.kind} (${l.period_key}): ${l.headline}`,
            )
            .join("\n")
        : "(none in the last 30 days)";

      const eng = input.user_engagement;
      const engagementBlock = [
        `last_letter_opened_at: ${eng.last_letter_opened_at ?? "(none)"}`,
        `letters_opened_count_30d: ${eng.letters_opened_count_30d}`,
        `last_3_opened: [${eng.last_3_opened
          .map((b) => (b ? "true" : "false"))
          .join(", ")}]`,
      ].join("\n");

      const prompt = `TRIGGER KIND: ${input.trigger_kind}

TRIGGER PAYLOAD:
${JSON.stringify(input.trigger_payload).slice(0, 1500)}

RECENT LETTERS (last 30d):
${recentBlock}

USER ENGAGEMENT:
${engagementBlock}

CURRENT USER STATE:
${input.current_user_state.slice(0, 800)}

Decide whether to PROCEED with generating a letter for this trigger. Return JSON.`;

      try {
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
          proceed: boolean;
          reasoning: string;
          theme_hint: string | null;
        }>;
        const proceed = parsed.proceed === true;
        const reasoning = scrubForbiddenPhrases(
          String(parsed.reasoning ?? "").trim(),
        ).slice(0, 200);
        const theme_hint =
          typeof parsed.theme_hint === "string" && parsed.theme_hint.trim()
            ? scrubForbiddenPhrases(parsed.theme_hint.trim()).slice(0, 60)
            : null;
        return {
          proceed,
          reasoning:
            reasoning ||
            (proceed
              ? `Trigger '${input.trigger_kind}' holds substance.`
              : `Trigger '${input.trigger_kind}' too thin to justify a letter.`),
          theme_hint,
        };
      } catch {
        // Parse / network failure — fall through to a conservative proceed
        // (deterministic skips already caught the worst cases).
        return {
          proceed: true,
          reasoning: "Model unreachable — default proceed.",
          theme_hint: null,
        };
      }
    },
  });

  return (
    cached?.payload ?? {
      proceed: true,
      reasoning: "Cache miss with no payload — default proceed.",
      theme_hint: null,
    }
  );
}

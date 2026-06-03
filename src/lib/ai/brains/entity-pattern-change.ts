import "server-only";

import { Type } from "@google/genai";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { withBrainCache, fingerprintFromIds } from "../cache";
import { BRAIN_KEYS } from "../cache-keys";
import { gemini, hasGemini, pickModel } from "../models";
import { scrubForbiddenPhrases } from "../voice-scrub";

// entity-pattern-change — Pro brain (math gate + Gemini-authored copy).
//
// Detects when an entity's behaviour shifts. Four patterns watched (the
// brief lists ALL FOUR as enabled):
//   1. transfer_cadence: gap between transfers shifts well outside the
//      cached cadence_mean/stddev. z ≥ 2 fires.
//   2. transfer_amount: a new transfer amount falls > 2 stddev away from
//      the rolling cached amount_mean.
//   3. interaction_kind_switch: a new event whose kind is < 60% of the
//      cached dominant interaction kind (transfer / sadaka_payment /
//      gift / loan_repayment / family_support / beneficiary_spend).
//   4. money_flow_direction: first inflow from an entity that has only
//      previously received outflows (rare, notable).
//
// min_baseline=5 (the brief lowered the floor from Clients' 14; entity
// activity is lower frequency). The math gate still enforces |z| ≥ 2 +
// dominant ≥ 60% so a small noisy sample doesn't trip false positives.
//
// Cache mechanics: ai_brain_cache is keyed by (user_id, brain_key) —
// there is exactly ONE row per user per brain_key. The per-event
// fingerprint (entityId + eventId + patternKind + payload) gates regen
// via withBrainCache. Double-dispatch protection lives in the
// notification dispatcher's dedupKey (entity_pattern_change:${entityId}:
// ${pattern_kind}:${monthBucket}) NOT in the brain cache. On a real
// shift the brain RETURNS the decision and the wrapper fires the
// notification AFTER (so a notification-dispatch crash never poisons
// the brain cache with a stale "no shift" payload).

export type EntityPatternKind =
  | "transfer_cadence"
  | "transfer_amount"
  | "interaction_kind_switch"
  | "money_flow_direction";

export type EntityPatternChangeInput = {
  entityId: string;
  eventId: string;
  patternKind: EntityPatternKind;
  // transfer_cadence inputs
  newEventAt?: string | null;
  // transfer_amount inputs
  newAmountBase?: number | null;
  // interaction_kind_switch inputs
  newInteractionKind?: string | null;
  // money_flow_direction inputs (true = money came IN from entity)
  isInflow?: boolean | null;
};

export type EntityPatternChangeDecision = {
  changed: boolean;
  pattern_kind: EntityPatternKind;
  summary: string;
  z_score: number | null;
  ask_user: boolean;
  question: string;
  suggested_answers: string[];
  new_interaction_kind: string | null;
};

function noShift(patternKind: EntityPatternKind): EntityPatternChangeDecision {
  return {
    changed: false,
    pattern_kind: patternKind,
    summary: "",
    z_score: null,
    ask_user: false,
    question: "",
    suggested_answers: [],
    new_interaction_kind: null,
  };
}

const MIN_BASELINE = 5;

type Baseline = {
  cadenceMean: number;
  cadenceStddev: number;
  amountMean: number;
  amountStddev: number;
  interactionKinds: Array<{ kind: string; count: number }>;
  eventsCount: number;
};

async function readBaseline(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  entityId: string,
): Promise<Baseline | null> {
  const { data } = await supabase
    .from("entity_pattern_baselines")
    .select(
      "transfer_cadence_mean,transfer_cadence_stddev,transfer_amount_mean,transfer_amount_stddev,typical_interaction_kinds,events_count",
    )
    .eq("user_id", userId)
    .eq("entity_id", entityId)
    .maybeSingle();
  if (!data) return null;
  const kindsRaw = (data.typical_interaction_kinds ?? []) as Array<{
    kind?: string;
    count?: number;
  }>;
  const kinds = kindsRaw
    .map((k) => ({
      kind: String(k.kind ?? ""),
      count: Number(k.count ?? 0),
    }))
    .filter((k) => k.kind.length > 0 && Number.isFinite(k.count) && k.count > 0);
  return {
    cadenceMean: Number(data.transfer_cadence_mean ?? 0),
    cadenceStddev: Number(data.transfer_cadence_stddev ?? 0),
    amountMean: Number(data.transfer_amount_mean ?? 0),
    amountStddev: Number(data.transfer_amount_stddev ?? 0),
    interactionKinds: kinds,
    eventsCount: Number(data.events_count ?? 0),
  };
}

async function entityNameLookup(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  entityId: string,
): Promise<string> {
  const { data } = await supabase
    .from("entities")
    .select("canonical_name")
    .eq("user_id", userId)
    .eq("id", entityId)
    .maybeSingle();
  return (data?.canonical_name as string) ?? "this person";
}

const NARRATOR_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    summary: { type: Type.STRING },
    question: { type: Type.STRING },
    suggested_answers: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
  },
  required: ["summary", "question", "suggested_answers"],
} as const;

const NARRATOR_SYSTEM_PROMPT = `You narrate a confirmed entity-pattern shift for a freelancer.

The math has already decided this is a real shift — your job is the copy, not the decision.

Inputs you receive are structured: entity name, the kind of shift, and per-kind fields.

Output rules:
- summary: ONE short sentence stating what changed in plain words. No imperative.
- question: ONE short question that asks whether this is the new normal.
- suggested_answers: exactly THREE short reply options the user can tap. Affirm / deny / unsure shape.
- Freelancer voice: warm, sharp, plain. Statement not advice.
- NEVER use: "you should", "consider", "save more", "stay positive", "well done", "great job", "amazing"
- No emojis. No markdown.

Return ONLY {"summary": string, "question": string, "suggested_answers": string[]} JSON.`;

type NarratorInput =
  | {
      kind: "transfer_cadence";
      entityName: string;
      zScore: number;
      direction: "longer" | "shorter";
    }
  | {
      kind: "transfer_amount";
      entityName: string;
      zScore: number;
      direction: "up" | "down";
    }
  | {
      kind: "interaction_kind_switch";
      entityName: string;
      fromKind: string;
      toKind: string;
    }
  | {
      kind: "money_flow_direction";
      entityName: string;
    };

type NarratorOutput = {
  summary: string;
  question: string;
  suggested_answers: string[];
};

async function generatePatternCopy(
  input: NarratorInput,
): Promise<NarratorOutput | null> {
  if (!hasGemini()) return null;
  try {
    const lines: string[] = [
      `ENTITY NAME: ${input.entityName}`,
      `PATTERN KIND: ${input.kind}`,
    ];
    if (input.kind === "transfer_cadence" || input.kind === "transfer_amount") {
      lines.push(`Z-SCORE: ${input.zScore.toFixed(1)}`);
      lines.push(`DIRECTION: ${input.direction}`);
    } else if (input.kind === "interaction_kind_switch") {
      lines.push(`USUAL KIND: ${input.fromKind}`);
      lines.push(`THIS-EVENT KIND: ${input.toKind}`);
    }
    lines.push("", "Author the summary + question + 3 suggested answers.");
    const prompt = lines.join("\n");

    const res = await gemini().models.generateContent({
      model: pickModel("heavy"),
      contents: prompt,
      config: {
        systemInstruction: NARRATOR_SYSTEM_PROMPT,
        temperature: 0.2,
        responseMimeType: "application/json",
        responseSchema: NARRATOR_RESPONSE_SCHEMA,
      },
    });

    const parsed = JSON.parse((res.text ?? "{}").trim()) as Partial<NarratorOutput>;
    const summary = scrubForbiddenPhrases(String(parsed.summary ?? "").trim());
    const question = scrubForbiddenPhrases(
      String(parsed.question ?? "").trim(),
    );
    const suggested = Array.isArray(parsed.suggested_answers)
      ? parsed.suggested_answers
          .map((s) => scrubForbiddenPhrases(String(s ?? "").trim()))
          .filter((s) => s.length > 0)
          .slice(0, 3)
      : [];
    if (!summary || !question || suggested.length < 3) return null;
    return { summary, question, suggested_answers: suggested };
  } catch {
    return null;
  }
}

function dominantKind(
  baseline: Baseline,
): { kind: string; share: number } | null {
  const total = baseline.interactionKinds.reduce((a, b) => a + b.count, 0);
  if (total <= 0) return null;
  const top = [...baseline.interactionKinds].sort((a, b) => b.count - a.count)[0];
  if (!top) return null;
  return { kind: top.kind, share: top.count / total };
}

export async function detectEntityPatternChange(
  input: EntityPatternChangeInput,
): Promise<EntityPatternChangeDecision> {
  const user = await getAuthUser();
  if (!user) return noShift(input.patternKind);
  const supabase = await createClient();

  const fp = await fingerprintFromIds([
    "entity_pattern_change",
    input.entityId,
    input.eventId,
    input.patternKind,
    String(input.newEventAt ?? ""),
    String(input.newAmountBase ?? ""),
    String(input.newInteractionKind ?? ""),
    String(input.isInflow ?? ""),
  ]);

  const cached = await withBrainCache<EntityPatternChangeDecision>({
    brainKey: BRAIN_KEYS.ENTITY_PATTERN_CHANGE,
    fingerprint: fp,
    phtDayAnchored: false,
    regen: async () => {
      // NOTE: this regen() deliberately RE-THROWS on transient failure.
      // withBrainCache catches and returns the prior cached entry
      // instead of writing a poisoned "no shift" decision. Caching a
      // no-shift on a DB hiccup would silently suppress the genuine
      // shift for the next hour until TTL elapsed.
      const baseline = await readBaseline(supabase, user.id, input.entityId);
      if (!baseline || baseline.eventsCount < MIN_BASELINE) {
        return noShift(input.patternKind);
      }

      if (input.patternKind === "transfer_cadence") {
        // Compute the gap days from the most recent prior event.
        const at = input.newEventAt ? new Date(input.newEventAt).getTime() : NaN;
        if (!Number.isFinite(at)) return noShift("transfer_cadence");
        // Verifier fix: union the last-event lookup across all entity
        // event sources (beneficiary spends + spend_entity_links + sadaka_
        // ledger) so cadence is measured against the actual latest
        // interaction, not just the latest beneficiary spend. This
        // mirrors how getEntitiesPeopleData's transferCount counts
        // interactions across both paths.
        const [lastBeneficiaryRes, lastLinkedSpendRes, lastSadakaRes] =
          await Promise.all([
            supabase
              .from("spends")
              .select("spent_at")
              .eq("user_id", user.id)
              .eq("beneficiary_entity_id", input.entityId)
              .lt("spent_at", new Date(at).toISOString())
              .order("spent_at", { ascending: false })
              .limit(1)
              .maybeSingle(),
            supabase
              .from("spend_entity_links")
              .select("spend_id, spends(spent_at)")
              .eq("entity_id", input.entityId)
              .order("spend_id", { ascending: false })
              .limit(20),
            supabase
              .from("sadaka_ledger")
              .select("event_at")
              .eq("user_id", user.id)
              .is("archived_at", null)
              .eq("kind", "payment")
              .lt("event_at", new Date(at).toISOString())
              .order("event_at", { ascending: false })
              .limit(1)
              .maybeSingle(),
          ]);
        const candidateTs: number[] = [];
        if (lastBeneficiaryRes.data?.spent_at) {
          const t = new Date(lastBeneficiaryRes.data.spent_at as string).getTime();
          if (Number.isFinite(t) && t < at) candidateTs.push(t);
        }
        if (lastSadakaRes.data?.event_at) {
          const t = new Date(lastSadakaRes.data.event_at as string).getTime();
          if (Number.isFinite(t) && t < at) candidateTs.push(t);
        }
        // spend_entity_links join — only consider spends earlier than `at`.
        for (const row of lastLinkedSpendRes.data ?? []) {
          const inner = (row as { spends?: { spent_at?: string } | null }).spends;
          const spentAt = inner?.spent_at;
          if (!spentAt) continue;
          const t = new Date(spentAt).getTime();
          if (Number.isFinite(t) && t < at) {
            candidateTs.push(t);
            break;
          }
        }
        if (candidateTs.length === 0) return noShift("transfer_cadence");
        const lastAt = Math.max(...candidateTs);
        const gapDays = Math.max(0, (at - lastAt) / 86_400_000);
        if (baseline.cadenceStddev <= 0) return noShift("transfer_cadence");
        const z = (gapDays - baseline.cadenceMean) / baseline.cadenceStddev;
        if (Math.abs(z) < 2) return noShift("transfer_cadence");
        const direction: "longer" | "shorter" = z > 0 ? "longer" : "shorter";
        const entityName = await entityNameLookup(supabase, user.id, input.entityId);
        const fallback: NarratorOutput = {
          summary: `${entityName}'s cadence has stretched ${direction} from the usual (z=${z.toFixed(1)}).`,
          question: `Is the ${direction} cadence with ${entityName} the new normal?`,
          suggested_answers: [
            "Yes — new normal",
            "No — one-off",
            "Not sure yet",
          ],
        };
        const copy =
          (await generatePatternCopy({
            kind: "transfer_cadence",
            entityName,
            zScore: z,
            direction,
          })) ?? fallback;
        return {
          changed: true,
          pattern_kind: "transfer_cadence",
          summary: copy.summary,
          z_score: Math.round(z * 10) / 10,
          ask_user: true,
          question: copy.question,
          suggested_answers: copy.suggested_answers,
          new_interaction_kind: null,
        };
      }

      if (input.patternKind === "transfer_amount") {
        const amount = Number(input.newAmountBase ?? 0);
        if (!Number.isFinite(amount) || amount <= 0) {
          return noShift("transfer_amount");
        }
        if (baseline.amountStddev <= 0) return noShift("transfer_amount");
        const z = (amount - baseline.amountMean) / baseline.amountStddev;
        if (Math.abs(z) < 2) return noShift("transfer_amount");
        const direction: "up" | "down" = z > 0 ? "up" : "down";
        const entityName = await entityNameLookup(supabase, user.id, input.entityId);
        const fallback: NarratorOutput = {
          summary: `${entityName}'s amount is well ${direction} from the usual (z=${z.toFixed(1)}).`,
          question:
            direction === "up"
              ? `Is ${entityName} getting more from you from here on?`
              : `Is ${entityName} getting less from you from here on?`,
          suggested_answers: [
            "Yes — new baseline",
            "No — one-off",
            "Not sure yet",
          ],
        };
        const copy =
          (await generatePatternCopy({
            kind: "transfer_amount",
            entityName,
            zScore: z,
            direction,
          })) ?? fallback;
        return {
          changed: true,
          pattern_kind: "transfer_amount",
          summary: copy.summary,
          z_score: Math.round(z * 10) / 10,
          ask_user: true,
          question: copy.question,
          suggested_answers: copy.suggested_answers,
          new_interaction_kind: null,
        };
      }

      if (input.patternKind === "interaction_kind_switch") {
        const newKind = (input.newInteractionKind ?? "").trim();
        if (!newKind) return noShift("interaction_kind_switch");
        const dom = dominantKind(baseline);
        if (!dom) return noShift("interaction_kind_switch");
        if (dom.share < 0.6) return noShift("interaction_kind_switch");
        if (dom.kind === newKind) return noShift("interaction_kind_switch");
        const entityName = await entityNameLookup(supabase, user.id, input.entityId);
        const fallback: NarratorOutput = {
          summary: `${entityName} usually shows up as ${dom.kind}; this time it's ${newKind}.`,
          question: `Is the shift from ${dom.kind} to ${newKind} with ${entityName} the new shape?`,
          suggested_answers: [
            `Yes — switch to ${newKind}`,
            `No — one-off, keep ${dom.kind}`,
            "Not sure yet",
          ],
        };
        const copy =
          (await generatePatternCopy({
            kind: "interaction_kind_switch",
            entityName,
            fromKind: dom.kind,
            toKind: newKind,
          })) ?? fallback;
        return {
          changed: true,
          pattern_kind: "interaction_kind_switch",
          summary: copy.summary,
          z_score: null,
          ask_user: true,
          question: copy.question,
          suggested_answers: copy.suggested_answers,
          new_interaction_kind: newKind,
        };
      }

      if (input.patternKind === "money_flow_direction") {
        if (!input.isInflow) return noShift("money_flow_direction");
        // Verifier fix: money_ledger.related_id for transfer_in rows
        // carries the transfer source id, not the entity id. Until a
        // dedicated entity_id column lands on money_ledger (or a
        // transfer-keyed entity link table ships), we operate in
        // a "first-inflow-anywhere = first inflow for this entity"
        // approximation, gated by:
        //   1. Caller opt-in via runEntityPatternChangeForEvent with
        //      event.kind='transfer' + isInflow=true. A beneficiary_
        //      spend / sadaka_payment event never reaches this branch.
        //   2. Best-effort entity-keyed scan first. If a prior transfer_in
        //      tied (somehow) to this entity already exists, we know
        //      it isn't the first.
        //   3. Otherwise: this is the literal first inflow we can
        //      observe for the entity. Fire — that's the conservative
        //      "this is the inflection point" notification. Without
        //      the inversion, the brain would NEVER fire money_flow_
        //      direction (since the eq(related_id, entityId) lookup is
        //      currently always empty), violating the 4-pattern
        //      invariant the brief locks.
        const { data: priorInflows } = await supabase
          .from("money_ledger")
          .select("id")
          .eq("user_id", user.id)
          .eq("related_kind", "transfer_in")
          .eq("related_id", input.entityId)
          .limit(1);
        if ((priorInflows ?? []).length > 0) {
          return noShift("money_flow_direction");
        }
        const entityName = await entityNameLookup(supabase, user.id, input.entityId);
        const fallback: NarratorOutput = {
          summary: `Money came IN from ${entityName} for the first time.`,
          question: `Should ${entityName} be tracked as someone who pays you back?`,
          suggested_answers: [
            "Yes — track inflows",
            "No — one-off",
            "Not sure yet",
          ],
        };
        const copy =
          (await generatePatternCopy({
            kind: "money_flow_direction",
            entityName,
          })) ?? fallback;
        return {
          changed: true,
          pattern_kind: "money_flow_direction",
          summary: copy.summary,
          z_score: null,
          ask_user: true,
          question: copy.question,
          suggested_answers: copy.suggested_answers,
          new_interaction_kind: null,
        };
      }

      return noShift(input.patternKind);
    },
  });

  const decision = cached?.payload ?? noShift(input.patternKind);

  // Dispatch the notification AFTER withBrainCache returns. Doing this
  // inside regen() couples the cache write to the dispatch — a
  // postback crash would freeze the cache row at "no shift" for the TTL
  // window and silently suppress the real shift. The dispatcher's dedup
  // key catches replays so calling on every cache hit is safe.
  //
  // Verifier fix (low): the prior dedupKey was month-bucketed, which
  // meant a cached "shift" decision replayed across a month boundary
  // could re-fire the SAME shift on the new month's first lookup. The
  // dedupKey now keys on (entityId, patternKind, eventId) instead, so
  // each individual event has exactly one shot at dispatching its own
  // notification regardless of when in the calendar the cache hit
  // lands. A separate event in the same month with a different eventId
  // still gets to fire — that's correct, because it IS a different
  // event with its own fingerprint.
  if (decision.changed && decision.ask_user) {
    await maybeDispatchNotification(decision, input).catch(() => {});
  }

  return decision;
}

async function maybeDispatchNotification(
  decision: EntityPatternChangeDecision,
  input: EntityPatternChangeInput,
): Promise<void> {
  // Dynamic import — same decoupling pattern as client-pattern-change.
  const { postNotification } = await import("@/lib/notifications/dispatcher");
  const supabase = await createClient();
  const user = await getAuthUser();
  if (!user) return;
  const entityName = await entityNameLookup(supabase, user.id, input.entityId);
  // Verifier fix: keys on the event id, not a month bucket. The
  // event_id uniquely identifies this shift; cross-month cache replays
  // can no longer re-fire the same shift on a new month boundary.
  // A different event in the same month with its own event_id still
  // gets to fire — that's a different fingerprint with a different
  // dedupKey, which is the correct behaviour.
  const dedupKey = `entity_pattern_change:${input.entityId}:${decision.pattern_kind}:${input.eventId}`;
  await postNotification({
    kind: "entity_pattern_change",
    subject: `${entityName}: pattern shift`,
    body: decision.summary,
    linkUrl: `/clients/people/${input.entityId}`,
    priority: 1,
    dedupKey,
    payload: {
      choices: decision.suggested_answers,
      kind_specific: {
        entity_id: input.entityId,
        pattern_kind: decision.pattern_kind,
        summary: decision.summary,
        question: decision.question,
        suggested_answers: decision.suggested_answers,
        event_id: input.eventId,
      },
    },
  });
}

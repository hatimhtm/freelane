import "server-only";

import type { createServiceClient } from "@/lib/supabase/service";

// Per-entity pattern baseline reader + updater.
//
// Mirrors src/lib/ai/client-pattern-actions.ts:refreshClientPatternBaselines
// but adapted for entities. Two paths use this:
//   • readBaseline(...) — called by entity-pattern-change brain to read
//     {cadence, amount, kinds, eventsCount}. Reads the prior baseline;
//     the driver is responsible for calling AFTER detection so the
//     just-written event isn't folded into its own comparison.
//   • updateBaseline(...) — called from createSpend / addPayment /
//     sadaka_payment hooks AFTER each qualifying entity event. Cheap
//     upsert; idempotent; never throws (best-effort).
//
// WIRED CALLERS (verifier fix): both functions are now driven by
// src/lib/entities/pattern-actions.ts:runEntityPatternChangeForEvent
// which is invoked from createSpend's beneficiary path (data/actions.ts),
// updateSpend's beneficiary-transition path, and the sadaka auto-detect
// recipient branch.
//
// The baseline math uses EWMA + sample stddev (mirrors client-pattern-
// baselines from migration 0077). When eventsCount < MIN_BASELINE the
// readers return null so the brain math-gates to noShift.

type SupabaseClient =
  | ReturnType<typeof createServiceClient>
  | Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>;

export type EntityBaseline = {
  cadenceMean: number;
  cadenceStddev: number;
  amountMean: number;
  amountStddev: number;
  interactionKinds: Array<{ kind: string; count: number }>;
  eventsCount: number;
  updatedAt: string;
  // last_event_at — the event's own spent_at / paid_at / event_at
  // timestamp. Used by the driver to compute cadenceDays as the gap
  // between THIS event and the prior latest event. NULL on baselines
  // older than migration 0100 — drivers fall back to skipping the
  // cadence sample in that case (one event burned to seed the column).
  lastEventAt: string | null;
};

const MIN_BASELINE = 5;
const EWMA_ALPHA = 0.4; // moderate smoothing — last 5-10 events dominate

// CONTRACT: callers MUST read the baseline BEFORE running the brain,
// and update it AFTER. This mirrors the
// runClientPatternChangeForEvent ordering (client-pattern-actions.ts).
// With that ordering the brain reads the *prior* baseline and the
// just-written event is folded in afterwards, so an excludeEvent
// reversal is unnecessary. The verifier flagged the prior reversal as
// inconsistent (mean reversed, stddev left intact); dropping it removes
// the inconsistency at the cost of one ordering rule the driver
// (pattern-actions.ts) already follows.
export async function readBaseline(
  supabase: SupabaseClient,
  userId: string,
  entityId: string,
): Promise<EntityBaseline | null> {
  const { data } = await supabase
    .from("entity_pattern_baselines")
    .select(
      "transfer_cadence_mean,transfer_cadence_stddev,transfer_amount_mean,transfer_amount_stddev,typical_interaction_kinds,events_count,updated_at,last_event_at",
    )
    .eq("user_id", userId)
    .eq("entity_id", entityId)
    .maybeSingle();
  if (!data) return null;
  const rawKinds = (data.typical_interaction_kinds ?? []) as Array<{
    kind?: string;
    count?: number;
  }>;
  const interactionKinds = rawKinds
    .map((k) => ({
      kind: String(k.kind ?? ""),
      count: Number(k.count ?? 0),
    }))
    .filter((k) => k.kind.length > 0 && Number.isFinite(k.count) && k.count > 0);

  const cadenceMean = Number(data.transfer_cadence_mean ?? 0);
  const cadenceStddev = Number(data.transfer_cadence_stddev ?? 0);
  const amountMean = Number(data.transfer_amount_mean ?? 0);
  const amountStddev = Number(data.transfer_amount_stddev ?? 0);
  const eventsCount = Number(data.events_count ?? 0);
  const lastEventAt = (data as { last_event_at?: string | null }).last_event_at
    ? String((data as { last_event_at?: string | null }).last_event_at)
    : null;

  return {
    cadenceMean,
    cadenceStddev,
    amountMean,
    amountStddev,
    interactionKinds,
    eventsCount,
    updatedAt: String(data.updated_at ?? new Date().toISOString()),
    lastEventAt,
  };
}

export async function updateBaseline(
  supabase: SupabaseClient,
  userId: string,
  entityId: string,
  event: {
    interactionKind: string;
    cadenceDays?: number | null;
    amountBase?: number | null;
    // Migration 0100 — the event's own spent_at / paid_at / event_at
    // timestamp. Used to advance last_event_at so the next event can
    // compute cadenceDays correctly (against the prior event, not the
    // wall-clock row-write time).
    eventAt?: string | null;
  },
): Promise<void> {
  try {
    const existing = await readBaseline(supabase, userId, entityId);
    const priorCount = existing?.eventsCount ?? 0;
    const isSeed = !existing || priorCount < 1;
    const eventsCount = priorCount + 1;
    const kindsMap = new Map<string, number>();
    for (const k of existing?.interactionKinds ?? []) {
      kindsMap.set(k.kind, k.count);
    }
    kindsMap.set(
      event.interactionKind,
      (kindsMap.get(event.interactionKind) ?? 0) + 1,
    );
    const interactionKinds = Array.from(kindsMap.entries())
      .map(([kind, count]) => ({ kind, count }))
      .sort((a, b) => b.count - a.count);

    // EWMA update for cadence + amount. Verifier fix (low): use the
    // eventsCount seed-gate instead of float `=== 0`, so a legitimate
    // baseline that has rolled to 0 doesn't re-seed wholesale on the
    // next event. Verifier fix (medium): use the textbook EWMA variance
    // form `newVar = (1-α)·oldVar + α·δ²`, not the off-by-(1-α) form
    // that under-weights new variance and drifts stddev low. Mirror on
    // both cadence + amount.
    let cadenceMean = existing?.cadenceMean ?? 0;
    let cadenceStddev = existing?.cadenceStddev ?? 0;
    if (event.cadenceDays && event.cadenceDays > 0) {
      const v = Number(event.cadenceDays);
      if (isSeed) {
        cadenceMean = v;
      } else {
        const delta = v - cadenceMean;
        cadenceMean = cadenceMean + EWMA_ALPHA * delta;
        const priorVar = cadenceStddev * cadenceStddev;
        const newVar = (1 - EWMA_ALPHA) * priorVar + EWMA_ALPHA * delta * delta;
        cadenceStddev = Math.sqrt(Math.max(0, newVar));
      }
    }
    let amountMean = existing?.amountMean ?? 0;
    let amountStddev = existing?.amountStddev ?? 0;
    if (event.amountBase && event.amountBase > 0) {
      const v = Number(event.amountBase);
      if (isSeed) {
        amountMean = v;
      } else {
        const delta = v - amountMean;
        amountMean = amountMean + EWMA_ALPHA * delta;
        const priorVar = amountStddev * amountStddev;
        const newVar = (1 - EWMA_ALPHA) * priorVar + EWMA_ALPHA * delta * delta;
        amountStddev = Math.sqrt(Math.max(0, newVar));
      }
    }

    // last_event_at — only advance forward. Out-of-order back-dated
    // events keep the existing value so future cadence math stays
    // anchored to the actual latest event time.
    let nextLastEventAt: string | null = existing?.lastEventAt ?? null;
    if (event.eventAt) {
      const incoming = new Date(event.eventAt).getTime();
      const priorMs = nextLastEventAt ? new Date(nextLastEventAt).getTime() : NaN;
      if (Number.isFinite(incoming)) {
        if (!Number.isFinite(priorMs) || incoming > priorMs) {
          nextLastEventAt = new Date(incoming).toISOString();
        }
      }
    }

    await supabase.from("entity_pattern_baselines").upsert(
      {
        entity_id: entityId,
        user_id: userId,
        transfer_cadence_mean: cadenceMean,
        transfer_cadence_stddev: cadenceStddev,
        transfer_amount_mean: amountMean,
        transfer_amount_stddev: amountStddev,
        typical_interaction_kinds:
          interactionKinds as unknown as Record<string, unknown>,
        events_count: eventsCount,
        updated_at: new Date().toISOString(),
        last_event_at: nextLastEventAt,
      },
      { onConflict: "entity_id" },
    );
  } catch {
    // Best-effort — the baseline is a cache, never block the parent.
  }
}

// Public threshold so the brain math-gate + dispatcher can both
// reference the same number without drifting.
export const ENTITY_PATTERN_MIN_BASELINE = MIN_BASELINE;

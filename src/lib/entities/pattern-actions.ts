"use server";

import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { safeRunLabeled, type ActionResult } from "@/lib/data/actions";
import {
  detectEntityPatternChange,
  type EntityPatternKind,
} from "@/lib/ai/brains/entity-pattern-change";
import {
  readBaseline,
  updateBaseline,
} from "@/lib/entities/pattern-baselines";

// Entity-pattern driver. Mirrors src/lib/ai/client-pattern-actions.ts.
//
// Hooked into every entity-affecting write path (createSpend beneficiary
// branch, addPaymentWithChain for entity-attached payments, sadaka
// payment recording). The brain reads the PRIOR baseline (so the
// just-written event isn't folded into its own comparison) THEN we
// refresh so the next event sees a baseline that includes today.
//
// All four patterns are checked per event. detectEntityPatternChange
// gates each math check internally (z >= 2 / dominant >= 60% / first
// inflow), so calling on every event is cheap when nothing has shifted.
//
// Fire-and-forget at the call site. safeRun-wrapped so a brain failure
// (Gemini outage, missing baseline row, anything) never blocks the
// primary mutation.

export type EntityPatternEvent =
  | {
      kind: "beneficiary_spend";
      spendId: string;
      entityId: string;
      amountBase: number;
      spentAt: string;
    }
  | {
      kind: "sadaka_payment";
      paymentId: string;
      entityId: string;
      amountBase: number;
      paidAt: string;
    }
  | {
      kind: "transfer";
      transferId: string;
      entityId: string;
      amountBase: number;
      atIso: string;
      isInflow: boolean;
    };

function interactionKindFor(event: EntityPatternEvent): string {
  switch (event.kind) {
    case "beneficiary_spend":
      return "beneficiary_spend";
    case "sadaka_payment":
      return "sadaka_payment";
    case "transfer":
      return event.isInflow ? "transfer_in" : "transfer";
  }
}

export async function runEntityPatternChangeForEvent(
  event: EntityPatternEvent,
): Promise<ActionResult<null>> {
  return safeRunLabeled("freelane-entity-pattern", "run", async () => {
    const user = await getAuthUser();
    if (!user) return null;
    const supabase = await createClient();

    const eventId =
      event.kind === "beneficiary_spend"
        ? event.spendId
        : event.kind === "sadaka_payment"
          ? event.paymentId
          : event.transferId;
    const eventAt =
      event.kind === "beneficiary_spend"
        ? event.spentAt
        : event.kind === "sadaka_payment"
          ? event.paidAt
          : event.atIso;
    const interactionKind = interactionKindFor(event);

    // Each pattern detection is independent; the brain math-gates the
    // result. We swallow every error so the primary mutation never sees
    // a thrown brain.
    await detectEntityPatternChange({
      entityId: event.entityId,
      eventId,
      patternKind: "transfer_cadence" as EntityPatternKind,
      newEventAt: eventAt,
    }).catch(() => {});
    await detectEntityPatternChange({
      entityId: event.entityId,
      eventId,
      patternKind: "transfer_amount" as EntityPatternKind,
      newAmountBase: event.amountBase,
    }).catch(() => {});
    await detectEntityPatternChange({
      entityId: event.entityId,
      eventId,
      patternKind: "interaction_kind_switch" as EntityPatternKind,
      newInteractionKind: interactionKind,
    }).catch(() => {});
    if (event.kind === "transfer" && event.isInflow) {
      await detectEntityPatternChange({
        entityId: event.entityId,
        eventId,
        patternKind: "money_flow_direction" as EntityPatternKind,
        isInflow: true,
      }).catch(() => {});
    }

    // Refresh the baseline AFTER detection so the next event sees the
    // updated mean / stddev / kind histogram. Verifier fix: cadenceDays
    // is now computed against the PRIOR event's spent_at / paid_at
    // (last_event_at column from migration 0100), not the wall-clock
    // row write time. updated_at would silently break cadence sampling
    // when events arrived in the same wall-clock second or back-dated.
    try {
      let cadenceDays: number | null = null;
      const prior = await readBaseline(supabase, user.id, event.entityId);
      if (prior?.lastEventAt) {
        const priorMs = new Date(prior.lastEventAt).getTime();
        const nowMs = new Date(eventAt).getTime();
        if (
          Number.isFinite(priorMs) &&
          Number.isFinite(nowMs) &&
          nowMs > priorMs
        ) {
          cadenceDays = (nowMs - priorMs) / 86_400_000;
        }
      }
      await updateBaseline(supabase, user.id, event.entityId, {
        interactionKind,
        cadenceDays,
        amountBase: event.amountBase,
        eventAt,
      });
    } catch {
      // Best-effort — next event reads slightly stale stats.
    }

    return null;
  });
}

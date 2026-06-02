"use server";

import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { safeRunLabeled, type ActionResult } from "@/lib/data/actions";
import {
  detectClientPatternChange,
  type ClientPatternKind,
} from "./brains/client-pattern-change";

// Cost-discipline aggregator + entry point for the pattern-change brain.
//
// refreshClientPatternBaselines recomputes the per-client cache rows
// (typical_payment_wallets, typical_project_amount_mean/stddev/count) on
// every triggering event. The query is small (one client at a time,
// joins onto already-indexed columns) so refreshing on every payment
// landing is cheap — re-aggregating on every brain call would be the
// expensive path.
//
// runClientPatternChangeForEvent is the fire-and-forget hook the data
// actions call after a successful write. Refreshes the baseline first
// so the brain reads the freshest aggregates. Catches and swallows
// everything — a brain failure must NEVER block the primary mutation.

export type PatternEvent =
  | {
      kind: "payment";
      paymentId: string;
      walletId: string | null;
    }
  | {
      kind: "project_status_change";
      projectId: string;
      amount: number | null;
    };

export async function refreshClientPatternBaselines(
  clientId: string,
): Promise<ActionResult<null>> {
  return safeRunLabeled("freelane-client-pattern", "refresh", async () => {
    const user = await getAuthUser();
    if (!user) throw new Error("Unauthenticated");
    const supabase = await createClient();

    // Projects fed into the mean: the most-recent N=20 completed projects
    // for this client (paid OR archived-as-paid). The window cap stops
    // ancient history from dominating once a client's scope has clearly
    // grown — a steadily-growing client should see their "new normal"
    // flagged once last year's small projects roll out of the window.
    // The stddev/mean is over the native currency amount; the
    // pattern-change brain inputs amounts in the same native currency to
    // keep the z-score comparable.
    const PROJECT_WINDOW = 20;
    const { data: projects } = await supabase
      .from("projects")
      .select("id,amount,status,completed_at,created_at")
      .eq("user_id", user.id)
      .eq("client_id", clientId)
      .order("completed_at", { ascending: false, nullsFirst: false });
    const completed = (projects ?? [])
      .filter((p) => (p.status as string) === "paid")
      .slice(0, PROJECT_WINDOW);
    const amounts = completed
      .map((p) => Number(p.amount))
      .filter((n) => Number.isFinite(n) && n > 0);

    const count = amounts.length;
    let mean = 0;
    let stddev = 0;
    if (count > 0) {
      const sum = amounts.reduce((s, v) => s + v, 0);
      mean = sum / count;
      if (count > 1) {
        const variance =
          amounts.reduce((s, v) => s + (v - mean) ** 2, 0) / (count - 1);
        stddev = Math.sqrt(variance);
      }
    }

    // typical_payment_wallets — histogram of landing wallets over the
    // most-recent N=5 payments for this client. The brain reads this row
    // instead of re-running the projects → payments → payment_steps join,
    // so the per-event cost is one cached read instead of three joins on
    // every shift evaluation. The window MUST match the brain's lookback
    // (PATTERN_WALLET_WINDOW = 5) or the dominant-wallet decision would
    // disagree with the cache the next event reads.
    //
    // Excluding the triggering payment is the brain's job (it knows the
    // excludePaymentId per event); the baseline row stays event-agnostic.
    const PATTERN_WALLET_WINDOW = 5;
    const projectIds = (projects ?? []).map((p) => p.id as string);
    let typicalPaymentWallets: Array<{ wallet_id: string; count: number }> = [];
    if (projectIds.length > 0) {
      const { data: recentPayments } = await supabase
        .from("payments")
        .select("id,paid_at")
        .eq("user_id", user.id)
        .in("project_id", projectIds)
        .not("paid_at", "is", null)
        .order("paid_at", { ascending: false, nullsFirst: false })
        .limit(PATTERN_WALLET_WINDOW);
      const paymentIds = (recentPayments ?? []).map((p) => p.id as string);
      if (paymentIds.length > 0) {
        const { data: steps } = await supabase
          .from("payment_steps")
          .select("payment_id,method_id,is_final")
          .in("payment_id", paymentIds);
        const finalByPayment = new Map<string, string | null>();
        for (const s of steps ?? []) {
          if (!s.is_final) continue;
          finalByPayment.set(
            s.payment_id as string,
            (s.method_id as string | null) ?? null,
          );
        }
        const histogram = new Map<string, number>();
        for (const id of paymentIds) {
          const wallet = finalByPayment.get(id);
          if (!wallet) continue;
          histogram.set(wallet, (histogram.get(wallet) ?? 0) + 1);
        }
        typicalPaymentWallets = Array.from(histogram.entries())
          .map(([wallet_id, c]) => ({ wallet_id, count: c }))
          .sort((a, b) => b.count - a.count);
      }
    }

    await supabase.from("client_pattern_baselines").upsert(
      {
        client_id: clientId,
        user_id: user.id,
        typical_payment_wallets: typicalPaymentWallets,
        typical_project_amount_mean: Math.round(mean * 100) / 100,
        typical_project_amount_stddev: Math.round(stddev * 100) / 100,
        typical_project_count: count,
      },
      { onConflict: "client_id" },
    );

    return null;
  });
}

// Drives the brain for a single event. We deliberately do NOT refresh the
// baseline BEFORE the brain runs — the just-written event is already in
// the source tables, and pre-refreshing would fold it into mean/stddev/
// wallet-histogram, deflating |z| and silencing legitimate shifts. The
// brain reads the prior baseline (the event the previous run wrote) and
// compares against the event that just happened. After detection we
// refresh so the NEXT event sees a baseline that includes today.
export async function runClientPatternChangeForEvent(
  clientId: string,
  event: PatternEvent,
): Promise<ActionResult<null>> {
  return safeRunLabeled("freelane-client-pattern", "run", async () => {
    if (event.kind === "payment") {
      // Compare the new payment's landing wallet against the historical
      // dominant wallet. eventId = paymentId so the brain-cache dedup
      // catches replays. The brain reads dominantWalletForClient EXCLUDING
      // this payment id so the baseline isn't self-polluted.
      await detectClientPatternChange({
        clientId,
        eventId: event.paymentId,
        patternKind: "payment_method" as ClientPatternKind,
        newPaymentWalletId: event.walletId,
        excludePaymentId: event.paymentId,
      }).catch(() => {});
    } else if (event.kind === "project_status_change") {
      // Only run the size-shift check when an amount is in play. The
      // brain reads the baseline EXCLUDING this project id so the just-
      // flipped project doesn't poison the mean/stddev it compares to.
      if (event.amount && event.amount > 0) {
        await detectClientPatternChange({
          clientId,
          eventId: event.projectId,
          patternKind: "project_size_shift" as ClientPatternKind,
          newProjectAmount: event.amount,
          excludeProjectId: event.projectId,
        }).catch(() => {});
      }
    }

    // Refresh AFTER detection so the next event compares against an
    // updated baseline that includes today's event. Best-effort — a
    // failure here just means the next event reads slightly stale stats.
    await refreshClientPatternBaselines(clientId).catch(() => {});

    return null;
  });
}

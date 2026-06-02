import "server-only";

import { createClient } from "@/lib/supabase/server";
import { insertSadakaLedgerRow, readPoolBalance } from "./ledger";
import { getSadakaConfig } from "./config";
import { decideSadakaContributionRate } from "@/lib/ai/brains/sadaka-contribution-rate";
import { logLedgerReadFailure } from "@/lib/data/money-ledger";

// Freelane Sadaka — on-income contribution hook.
//
// Invoked from addPaymentWithChain (and any future income path) AFTER the
// money_ledger income row lands. Never blocks the payment: any failure is
// swallowed so the user's paycheck never silently rolls back because the
// Sadaka brain timed out. Failures are written to the money_ledger
// write-failure latch so a silent classifier outage stays observable.
//
// Flow:
//   1. Read the user's sadaka_config (base 2.5%).
//   2. Gather lightweight signals: pool balance, days since last income,
//      upcoming 7d outflows. Wider context = better dampen/lift decision.
//   3. Call sadaka_contribution_rate brain. Pro model — falls back to the
//      base rate when Gemini is missing.
//   4. Compute contribution = netAmountBase * (rate / 100).
//   5. Insert a sadaka_ledger contribution row with rate_used + reasoning.

async function gatherSignals(paidAt: string): Promise<{
  poolBase?: number;
  msSinceLastIncome?: number | null;
  upcomingOutflows7dBase?: number;
}> {
  try {
    const supabase = await createClient();
    const [pool, lastIncomeRes, upcomingRes] = await Promise.all([
      readPoolBalance(),
      supabase
        .from("payments")
        .select("paid_at")
        .order("paid_at", { ascending: false })
        .limit(2),
      // Upcoming 7d outflows: planned spends with planned_for in [paidAt,
      // paidAt + 7d]. Treats expected_base as the headline magnitude.
      (async () => {
        const fromIso = paidAt;
        const toIso = new Date(
          new Date(paidAt).getTime() + 7 * 86_400_000,
        ).toISOString();
        return supabase
          .from("planned_spends")
          .select("expected_base,planned_for,status")
          .in("status", ["planned", "committed"])
          .gte("planned_for", fromIso)
          .lte("planned_for", toIso);
      })(),
    ]);
    const paidAtMs = new Date(paidAt).getTime();
    const prior = (lastIncomeRes.data ?? [])
      .map((r) => new Date((r as { paid_at: string }).paid_at).getTime())
      .filter((t) => t < paidAtMs);
    const msSinceLastIncome =
      prior.length > 0 ? paidAtMs - Math.max(...prior) : null;
    const upcoming = (upcomingRes.data ?? []).reduce(
      (s, r) => s + Number((r as { expected_base: number | string }).expected_base ?? 0),
      0,
    );
    return {
      poolBase: pool.displayBase,
      msSinceLastIncome,
      upcomingOutflows7dBase: upcoming,
    };
  } catch {
    return {};
  }
}

export async function onIncomeContribution(input: {
  paymentId: string;
  netAmountBase: number;
  paidAt: string;
}): Promise<void> {
  try {
    if (!(input.netAmountBase > 0)) return;
    const cfg = await getSadakaConfig();
    const signals = await gatherSignals(input.paidAt);
    const decision = await decideSadakaContributionRate({
      netAmountBase: input.netAmountBase,
      paidAt: input.paidAt,
      baseRate: cfg.base_contribution_pct,
      poolBase: signals.poolBase,
      msSinceLastIncome: signals.msSinceLastIncome ?? null,
      upcomingOutflows7dBase: signals.upcomingOutflows7dBase,
    });
    // Brain already clamps to [0, 10]. Re-clamp here as belt + braces in
    // case the call path ever bypasses the brain (it doesn't today).
    const rate = Math.max(0, Math.min(10, Number(decision.rate)));
    if (rate <= 0) return;
    // Single round at the writer (insertSadakaLedgerRow); leave the math
    // unrounded here so the cents settle deterministically downstream.
    const amount = (input.netAmountBase * rate) / 100;
    if (!(amount > 0)) return;
    await insertSadakaLedgerRow({
      kind: "contribution",
      amount_base: amount,
      source_kind: "payment",
      source_id: input.paymentId,
      rate_used: rate,
      reasoning: decision.reasoning,
      event_at: input.paidAt,
    });
  } catch (err) {
    // Best-effort. The payment has already landed; reserve accounting is
    // recoverable through reconcile. Log the failure so a silent decay of
    // contributions is observable on the dashboard's degraded banner.
    await logLedgerReadFailure(
      `sadaka contribution hook failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

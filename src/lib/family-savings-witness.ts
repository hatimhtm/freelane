import type {
  ExchangeRate,
  Payment,
  PaymentMethod,
  PaymentStep,
  Spend,
  Withdrawal,
} from "@/lib/supabase/types";
import { holdingBalances } from "@/lib/payment-chain";

// Family Savings Witness (C) — quiet running number of what's parked.
// Hatim 2026-06-01: "Witness, not goal. Surface as 11px under safe-to-spend."
// "Grows when withdrawal rate is low."
//
// Definition: holding-wallet total MINUS a rolling 30-day spend baseline.
// The number that survives the everyday burn is what's "parked toward
// building a family". NEVER a target. NEVER a budget.

const DAY_MS = 86_400_000;
const RUNWAY_BUFFER_DAYS = 30;

export interface FamilySavingsWitness {
  totalWalletsBase: number;
  rolling30dSpendBase: number;
  parkedBase: number;          // max(0, totalWallets - rolling30dSpend)
  // Trend over 8 weeks: 'growing' if last 4w parked > prior 4w by ≥ 10%,
  // 'shrinking' if ≤ -10%, else 'steady'. Pure heuristic.
  trend: "growing" | "steady" | "shrinking";
  // Bullet detail for tooltip: "₱18,400 above the rolling 30d burn".
  detail: string;
}

export interface FamilySavingsInputs {
  payments: Payment[];
  withdrawals: Withdrawal[];
  spends: Spend[];
  methods: PaymentMethod[];
  stepsByPayment: Map<string, PaymentStep[]>;
  rates: ExchangeRate[];
  now?: Date;
}

export function computeFamilySavings(inputs: FamilySavingsInputs): FamilySavingsWitness {
  const now = inputs.now ?? new Date();
  const holdings = holdingBalances(
    inputs.methods,
    inputs.payments,
    inputs.stepsByPayment,
    inputs.withdrawals,
    inputs.spends,
  );
  const totalWallets = holdings.reduce((s, h) => s + h.balance, 0);

  const cutoff = new Date(now.getTime() - RUNWAY_BUFFER_DAYS * DAY_MS);
  const rolling30dSpend = inputs.spends
    .filter((s) => new Date(s.spent_at) >= cutoff)
    .reduce((sum, s) => sum + Number(s.amount_base ?? 0), 0);

  const parked = Math.max(0, totalWallets - rolling30dSpend);

  // Trend: compare last 4w parked vs prior 4w. Use a simple cursor.
  const last4Start = new Date(now.getTime() - 4 * 7 * DAY_MS);
  const prior4Start = new Date(now.getTime() - 8 * 7 * DAY_MS);
  const last4Spend = inputs.spends
    .filter((s) => {
      const d = new Date(s.spent_at);
      return d >= last4Start && d <= now;
    })
    .reduce((sum, s) => sum + Number(s.amount_base ?? 0), 0);
  const prior4Spend = inputs.spends
    .filter((s) => {
      const d = new Date(s.spent_at);
      return d >= prior4Start && d < last4Start;
    })
    .reduce((sum, s) => sum + Number(s.amount_base ?? 0), 0);
  const last4Income = inputs.payments
    .filter((p) => {
      const d = new Date(p.paid_at);
      return d >= last4Start && d <= now;
    })
    .reduce((sum, p) => sum + Number(p.net_amount_base ?? 0), 0);
  const prior4Income = inputs.payments
    .filter((p) => {
      const d = new Date(p.paid_at);
      return d >= prior4Start && d < last4Start;
    })
    .reduce((sum, p) => sum + Number(p.net_amount_base ?? 0), 0);
  const last4Surplus = last4Income - last4Spend;
  const prior4Surplus = prior4Income - prior4Spend;
  let trend: FamilySavingsWitness["trend"] = "steady";
  if (Math.abs(prior4Surplus) > 100) {
    const ratio = (last4Surplus - prior4Surplus) / Math.abs(prior4Surplus);
    if (ratio >= 0.1) trend = "growing";
    else if (ratio <= -0.1) trend = "shrinking";
  } else if (last4Surplus > 100) {
    trend = "growing";
  }

  const detail = parked > 0
    ? `₱${Math.round(parked).toLocaleString()} above the rolling 30d burn`
    : "Wallets currently track at-or-below the 30d burn";

  return {
    totalWalletsBase: totalWallets,
    rolling30dSpendBase: rolling30dSpend,
    parkedBase: parked,
    trend,
    detail,
  };
}

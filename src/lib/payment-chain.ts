import type {
  CurrencyCode,
  ExchangeRate,
  Payment,
  PaymentMethod,
  PaymentStep,
} from "@/lib/supabase/types";
import { toBase } from "@/lib/money";

// ───────────────────────────────────────── Per-payment fee ──
//
// At mark-paid time we snapshot:
//   gross_at_market_base = project-currency amount × mid-market rate that day
//   net_amount_base      = the PHP that actually landed (final chain step)
//   implied_fee_base     = gross − net   (everything the rails + FX markup ate)
//
// So the fee is already computed and frozen. These helpers just read it back
// safely for payments that may predate the lock (net_amount_base null).

export function paymentFee(payment: Pick<Payment, "gross_at_market_base" | "net_amount_base" | "implied_fee_base">) {
  const gross = payment.gross_at_market_base ?? 0;
  const net = payment.net_amount_base ?? 0;
  const fee = payment.implied_fee_base ?? Math.max(0, gross - net);
  const pct = gross > 0 ? fee / gross : 0;
  return { gross, net, fee, pct };
}

// ───────────────────────────────────────── Chain helpers ──

export function sortedSteps(steps: PaymentStep[]): PaymentStep[] {
  return [...steps].sort((a, b) => a.step_order - b.step_order);
}

export function finalStep(steps: PaymentStep[]): PaymentStep | null {
  const ordered = sortedSteps(steps);
  return ordered.find((s) => s.is_final) ?? ordered[ordered.length - 1] ?? null;
}

// Human-readable label for a chain — the thing the leaderboard groups on.
//   1 hop  → "Wise"
//   3 hops → "Bank wire — primary → RedDot → GCash"
export function chainSignature(
  steps: PaymentStep[],
  methodsById: Map<string, PaymentMethod>,
): string {
  const ordered = sortedSteps(steps);
  if (ordered.length === 0) return "Untagged";
  return ordered
    .map((s) => (s.method_id ? methodsById.get(s.method_id)?.name ?? "Untagged" : "Untagged"))
    .join(" → ");
}

// Per-step fee in base currency, using current rates for cross-currency hops.
// The final hop is already base (PHP) so its conversion is a no-op. This is an
// estimate for intermediate hops (we don't snapshot per-step FX), but the
// SUM across the chain reconciles to the frozen implied_fee_base on the payment.
export function stepFeeBase(
  step: PaymentStep,
  rates: Pick<ExchangeRate, "code" | "rate_to_base">[],
): number {
  const inBase = toBase(Number(step.amount_in), step.currency_in as CurrencyCode, rates);
  const outBase = toBase(Number(step.amount_out), step.currency_out as CurrencyCode, rates);
  return Math.max(0, inBase - outBase);
}

// ───────────────────────────────────────── Leaderboard ──
//
// "Which way of getting paid costs me the least?" Group every payment by its
// chain signature, then rank by effective fee %. This is the data behind the
// Settings → Methods leaderboard and the weekly Gemini routing insight.

export interface MethodLeaderboardRow {
  signature: string;
  count: number;
  volumeBase: number; // total gross routed through this chain
  feeBase: number;    // total fee paid (absolute)
  avgFeeBase: number; // average fee per payment (absolute)
  effectivePct: number; // volume-weighted: total fee / total gross (not a mean of %s)
  monthlyFeesBase: number; // recurring method fees attributable to this chain
}

export function methodLeaderboard(
  payments: Payment[],
  stepsByPayment: Map<string, PaymentStep[]>,
  methodsById: Map<string, PaymentMethod>,
): MethodLeaderboardRow[] {
  const rows = new Map<string, MethodLeaderboardRow>();
  // distinct method ids per signature → for summing recurring monthly fees
  const methodsBySignature = new Map<string, Set<string>>();

  for (const payment of payments) {
    // Unknown-fee payments are ignored entirely — counting them (even as 0)
    // would inflate a route's volume and drag its effective fee % down.
    if (payment.fee_unknown) continue;
    const steps = stepsByPayment.get(payment.id) ?? [];
    const signature = chainSignature(steps, methodsById);
    const { gross, fee } = paymentFee(payment);
    if (gross <= 0) continue;

    const row = rows.get(signature) ?? {
      signature,
      count: 0,
      volumeBase: 0,
      feeBase: 0,
      avgFeeBase: 0,
      effectivePct: 0,
      monthlyFeesBase: 0,
    };
    row.count += 1;
    row.volumeBase += gross;
    row.feeBase += fee;
    rows.set(signature, row);

    const ids = methodsBySignature.get(signature) ?? new Set<string>();
    steps.forEach((s) => s.method_id && ids.add(s.method_id));
    methodsBySignature.set(signature, ids);
  }

  for (const [signature, row] of rows) {
    row.effectivePct = row.volumeBase > 0 ? row.feeBase / row.volumeBase : 0;
    row.avgFeeBase = row.count > 0 ? row.feeBase / row.count : 0;
    // Recurring monthly fees of the distinct rails this chain uses — a chain
    // can look cheap per-transaction yet carry a fixed monthly cost.
    const ids = methodsBySignature.get(signature) ?? new Set<string>();
    row.monthlyFeesBase = Array.from(ids).reduce(
      (s, id) => s + Number(methodsById.get(id)?.monthly_fee_php ?? 0),
      0,
    );
  }

  // Cheapest first — that's the recommendation order.
  return Array.from(rows.values()).sort((a, b) => a.effectivePct - b.effectivePct);
}

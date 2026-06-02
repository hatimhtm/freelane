import type {
  CurrencyCode,
  ExchangeRate,
  Payment,
  PaymentMethod,
  PaymentStep,
  Spend,
  Withdrawal,
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

// A method's recurring monthly fee, converted to base currency. The amount is
// stored in monthly_fee_php and denominated in monthly_fee_currency (null =
// already base). Pass rates to convert; without them it's treated as base.
export function monthlyFeeBase(
  method: Pick<PaymentMethod, "monthly_fee_php" | "monthly_fee_currency">,
  rates?: Pick<ExchangeRate, "code" | "rate_to_base">[],
): number {
  const amount = Number(method.monthly_fee_php ?? 0);
  if (amount <= 0) return 0;
  const cur = method.monthly_fee_currency;
  if (!cur || !rates) return amount;
  return toBase(amount, cur as CurrencyCode, rates);
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
// Each hop is a FROM → TO transfer, so we walk the path of nodes and collapse
// consecutive duplicates (a hop's destination is usually the next hop's source):
//   1 hop  → "Wise → coin.ph"
//   2 hops → "Bank wire — primary → RedDot → GCash"
// Legacy rows (no from) fall back to just the destination name.
export function chainSignature(
  steps: PaymentStep[],
  methodsById: Map<string, PaymentMethod>,
): string {
  const ordered = sortedSteps(steps);
  if (ordered.length === 0) return "Untagged";
  const name = (id: string | null) => (id ? methodsById.get(id)?.name ?? "Untagged" : null);
  const path: string[] = [];
  for (const s of ordered) {
    const from = name(s.from_method_id);
    const to = name(s.method_id);
    for (const node of [from, to]) {
      if (node && path[path.length - 1] !== node) path.push(node);
    }
  }
  return path.length ? path.join(" → ") : "Untagged";
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
  rates?: Pick<ExchangeRate, "code" | "rate_to_base">[],
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
    steps.forEach((s) => {
      if (s.from_method_id) ids.add(s.from_method_id);
      if (s.method_id) ids.add(s.method_id);
    });
    methodsBySignature.set(signature, ids);
  }

  for (const [signature, row] of rows) {
    row.effectivePct = row.volumeBase > 0 ? row.feeBase / row.volumeBase : 0;
    row.avgFeeBase = row.count > 0 ? row.feeBase / row.count : 0;
    // Recurring monthly fees of the distinct rails this chain uses — a chain
    // can look cheap per-transaction yet carry a fixed monthly cost.
    const ids = methodsBySignature.get(signature) ?? new Set<string>();
    row.monthlyFeesBase = Array.from(ids).reduce((s, id) => {
      const method = methodsById.get(id);
      return s + (method ? monthlyFeeBase(method, rates) : 0);
    }, 0);
  }

  // Cheapest first — that's the recommendation order.
  return Array.from(rows.values()).sort((a, b) => a.effectivePct - b.effectivePct);
}

// ───────────────────────────────────────── Holding wallets ──
//
// A holding wallet (Cash, coin.ph, GCash, Wise, Bank account) carries a running
// PHP-equivalent balance:
//   balance = received  (sum of net of payments whose FINAL step lands here)
//           − withdrawn (sum of gross of withdrawals out of this wallet)
//           − spent     (sum of amount_base of spends drawn from this wallet)

export interface HoldingBalanceRow {
  methodId: string;
  name: string;
  opening: number;
  received: number;
  withdrawn: number;
  spent: number;
  balance: number;
  // T13 — per-wallet overdraft tolerance (₱ base). Display + alarm threshold
  // only — safe-to-spend treats the wallet at its actual balance.
  overdraftToleranceBase: number;
  status: WalletStatus;
}

export type WalletStatus = "positive" | "within_tolerance" | "over_overdraft";

// One canonical helper for the tri-state. Used by every wallet renderer so
// the semantics never drift between Today widget, Dashboard wallet stack,
// spend modal balance preview, NegativeWalletAlarm, and wallet pickers.
export function walletStatus(balance: number, toleranceBase: number): WalletStatus {
  if (balance >= 0) return "positive";
  const tolerance = Math.max(0, toleranceBase);
  return balance + tolerance >= 0 ? "within_tolerance" : "over_overdraft";
}

// The method a payment ultimately landed on = its final step's method.
export function landingMethodId(steps: PaymentStep[]): string | null {
  return finalStep(steps)?.method_id ?? null;
}

export function holdingBalances(
  methods: PaymentMethod[],
  payments: Payment[],
  stepsByPayment: Map<string, PaymentStep[]>,
  withdrawals: Withdrawal[],
  spends: Spend[] = [],
): HoldingBalanceRow[] {
  const holding = methods.filter((m) => m.is_holding);
  if (holding.length === 0) return [];
  const holdingIds = new Set(holding.map((m) => m.id));

  // Anchor on payment_methods is two columns:
  //   - opening_balance_set_at (TIMESTAMPTZ, migration 0049) — the moment the
  //     user clicked Save. Activity rows created BEFORE this instant are
  //     pre-anchor history and excluded.
  //   - opening_balance_at (DATE) — legacy / user-picked calibration date.
  //     Used as a fallback when the timestamp column is null.
  // Activity rows carry a created_at timestamp from the DB; we prefer that
  // comparison when both sides have a timestamp, falling back to date-only
  // comparison on legacy data.
  const anchorTs = new Map<string, string | null>(
    holding.map((m) => [m.id, m.opening_balance_set_at ?? null]),
  );
  const anchorDate = new Map<string, string | null>(
    holding.map((m) => [m.id, m.opening_balance_at ?? null]),
  );
  function isAfterAnchor(methodId: string, fallbackDate: string, rowCreatedAt?: string | null): boolean {
    const ts = anchorTs.get(methodId);
    if (ts && rowCreatedAt) {
      // Precise: compare ISO timestamps. Activity at-or-after the save
      // instant counts forward.
      return rowCreatedAt >= ts;
    }
    const anchor = anchorDate.get(methodId);
    if (!anchor) return true;
    // Fallback: date-only. Strict > so the anchor day itself is treated as
    // a fresh calibration (any spends recorded that day are folded in).
    return fallbackDate.slice(0, 10) > anchor.slice(0, 10);
  }

  const received = new Map<string, number>();
  for (const p of payments) {
    const landedOn = landingMethodId(stepsByPayment.get(p.id) ?? []);
    if (!landedOn || !holdingIds.has(landedOn)) continue;
    if (!isAfterAnchor(landedOn, p.paid_at, p.created_at)) continue;
    received.set(landedOn, (received.get(landedOn) ?? 0) + Number(p.net_amount_base ?? 0));
  }

  const withdrawn = new Map<string, number>();
  for (const w of withdrawals) {
    if (!w.from_method_id || !holdingIds.has(w.from_method_id)) continue;
    if (!isAfterAnchor(w.from_method_id, w.withdrawn_at, w.created_at)) continue;
    withdrawn.set(w.from_method_id, (withdrawn.get(w.from_method_id) ?? 0) + Number(w.gross_base ?? 0));
  }

  const spent = new Map<string, number>();
  for (const sp of spends) {
    if (!holdingIds.has(sp.wallet_id)) continue;
    if (!isAfterAnchor(sp.wallet_id, sp.spent_at, sp.created_at)) continue;
    spent.set(sp.wallet_id, (spent.get(sp.wallet_id) ?? 0) + Number(sp.amount_base ?? 0));
  }

  return holding
    .map((m) => {
      const opening = Number(m.opening_balance_base ?? 0);
      const r = received.get(m.id) ?? 0;
      const out = withdrawn.get(m.id) ?? 0;
      const sp = spent.get(m.id) ?? 0;
      const balance = opening + r - out - sp;
      const tolerance = Number(m.overdraft_tolerance_base ?? 0);
      return {
        methodId: m.id,
        name: m.name,
        opening,
        received: r,
        withdrawn: out,
        spent: sp,
        balance,
        overdraftToleranceBase: tolerance,
        status: walletStatus(balance, tolerance),
      };
    })
    // Show wallets the user has anchored OR that have seen money. Hide pure
    // empties so the picker doesn't fill with dormant rows.
    .filter((row) => {
      const m = methods.find((x) => x.id === row.methodId);
      if (m?.opening_balance_at) return true;
      return row.opening !== 0 || row.received !== 0 || row.withdrawn !== 0 || row.spent !== 0;
    });
}

import type {
  ExchangeRate,
  LoanInstallment,
  Payment,
  PaymentMethod,
  PaymentStep,
  PlannedSpend,
  PlanStrategy,
  RecurringSpend,
  RecurringSpendSkip,
  Spend,
  Withdrawal,
} from "@/lib/supabase/types";
import {
  landedInRange,
  loanInstallmentsDueInRange,
  recurringExpectedInRange,
  spendsInRange,
  withdrawalFeesInRange,
} from "@/lib/dashboard-calc";
import { holdingBalances } from "@/lib/payment-chain";
import { PH_DAILY_FLOOR_BASE } from "@/lib/ph-col";
import { plannedInRange } from "@/lib/planned-spends";

const DAY_MS = 86_400_000;

// Rolling horizon — the formula is CONTINUOUS, not calendar-month-bound.
// "What can I spend today?" looks at the past N days + projects the next N days
// from any starting instant, so the answer at midnight on the 1st is the same
// shape as the answer at 3pm on the 17th. Defaults are 30/30; tune per caller.
const DEFAULT_HORIZON_DAYS = 30;
const TRAILING_LOOKBACK_DAYS = 30;
const STABILITY_LOOKBACK_DAYS = 90;

// Recovery from overspending is distributed over 2× horizon so the daily
// reduction is gentle. Brutal one-week cuts erode the user's relationship
// with the number — gradual recovery keeps the floor reachable.
const RECOVERY_SPREAD_FACTOR = 2;

// Cold-start safety net in PHP — never recommend spending literally everything.
// Distinct from PH_DAILY_FLOOR_BASE which is the per-day minimum (essentials).
const FEE_RESERVE_FLOOR_BASE = 500;

export interface SafeToSpendInputs {
  payments: Payment[];
  withdrawals: Withdrawal[];
  spends: Spend[];
  recurring: RecurringSpend[];
  recurringSkips: RecurringSpendSkip[];
  loanInstallments: LoanInstallment[];
  methods: PaymentMethod[];
  stepsByPayment: Map<string, PaymentStep[]>;
  rates: ExchangeRate[];
  // Tier 1 — planned_spends. Optional so existing callers still type-check.
  // When provided, the discretionary pool is reduced by:
  //   - committed plans: full committed_base (locked, can't be spent)
  //   - planned-in-horizon: expected_base for planned (not committed/done/cancelled)
  // The brain treats these as commitments the user has already made to
  // their future self.
  plannedSpends?: PlannedSpend[];
  // Phase 1.5: optional precomputed ledger-derived wallet balance map.
  // When provided, holdingBalances() short-circuits to ledger truth for
  // covered wallets. Undefined → legacy source-table math (unchanged).
  ledgerBalances?: Map<string, number> | null;
  // Migration 0089 — active plan strategies. When supplied, each
  // strategy's monthly_save_estimate / 30 is subtracted from the daily
  // safe (applyStrategy below). Pluggable so future workflows can
  // introduce more user-activated reductions without re-wiring.
  activePlanStrategies?: PlanStrategy[];
  now?: Date;
  horizonDays?: number;
}

export interface SafeToSpendBreakdown {
  horizonDays: number;
  walletBalancesBase: number;
  trailingIncomeBase: number;
  trailingSpendBase: number;
  forwardIncomeProjectionBase: number;
  recurringForwardBase: number;
  loanForwardBase: number;
  feeFloorBase: number;
  // Tier 1 additions — planned + locked obligations bundled into committedPool.
  plannedForwardBase: number;
  committedLockedBase: number;
  committedPoolBase: number;
  // Recovery: when trailing spend > trailing income, excess is spread forward.
  trailingOverspendBase: number;
  recoveryDailyTaxBase: number;
  inRecovery: boolean;
  discretionaryPoolBase: number;
  dailyAllowanceBase: number;
  stabilityScore: number;        // raw [0, 1.5]
  stabilityMultiplier: number;   // clamped [0.7, 1.2]
  patternMultiplier: number;     // 1.0 in v1; AI-tuned in Phase 3
  colFloorBase: number;          // PH absolute daily minimum
  safeTodayBase: number;
  notes: string[];
  isLearning: boolean;
  // T32 additions — the number ALWAYS exists; this tag tells the UI whether
  // to render a small "rough" stamp underneath. observationDays tracks how
  // many days of history fed the formula.
  observationDays: number;
  confidenceTag: "rough" | "calibrating" | "steady";
}

// Cross-surface helper — call this when you have a generic DashboardData /
// SpendingData / PlansData shape. It re-asserts that plannedSpends always
// participates (the headline number drifts surface-to-surface if any caller
// forgets to pass them). Today, Dashboard, Spending, and Plans all use this
// so the safe-to-spend headline can never disagree.
export interface SafeToSpendDataLike {
  payments: Payment[];
  withdrawals: Withdrawal[];
  spends: Spend[];
  recurring: RecurringSpend[];
  recurringSkips: RecurringSpendSkip[];
  loanInstallments: LoanInstallment[];
  methods: PaymentMethod[];
  stepsByPayment: Map<string, PaymentStep[]>;
  rates: ExchangeRate[];
  plannedSpends?: PlannedSpend[];
  // Phase 1.5: optional ledger-derived balance map threaded through to
  // holdingBalances(). Callers that have already computed it (Today,
  // Dashboard, Spending, Plans loaders) pass it in so the safe-to-spend
  // headline reads the same canonical wallet truth.
  ledgerBalances?: Map<string, number> | null;
  // Migration 0089 — see SafeToSpendInputs.activePlanStrategies.
  activePlanStrategies?: PlanStrategy[];
}

export function computeSafeToSpendFromData(
  data: SafeToSpendDataLike,
  now?: Date,
): SafeToSpendBreakdown {
  return safeToSpend({
    payments: data.payments,
    withdrawals: data.withdrawals,
    spends: data.spends,
    recurring: data.recurring,
    recurringSkips: data.recurringSkips,
    loanInstallments: data.loanInstallments,
    methods: data.methods,
    stepsByPayment: data.stepsByPayment,
    rates: data.rates,
    plannedSpends: data.plannedSpends ?? [],
    ledgerBalances: data.ledgerBalances,
    activePlanStrategies: data.activePlanStrategies ?? [],
    now,
  });
}

// ─────────────────────────── Plan strategy hooks (migration 0089) ──
//
// Active plan strategies reduce the live daily safe by their daily
// equivalent (monthly_save_estimate / 30). Plans is the FIRST external
// consumer of this hook; future workflows can supply their own strategy
// rows that share the shape.
//
// Pure transformer — no DB, no IO. The reducer is applied INSIDE
// safeToSpend() so every surface that reads computeSafeToSpendFromData
// inherits the reduction automatically when the caller passes
// activePlanStrategies through.

export interface DailySafeReductionStrategy {
  strategy_id: string;
  plan_id: string;
  kind: string;
  monthly_save_estimate: number | null;
  active: boolean;
}

// Daily reduction contribution from a single active strategy.
// Returns 0 for inactive strategies or non-numeric estimates so callers
// can safely .map / .reduce without guards.
//
// The /30 divisor is intentional and DOES NOT scale with horizonDays.
// The strategy's monthly_save_estimate is a per-month commitment the
// user has opted into; the daily equivalent is m/30 regardless of how
// many days the caller is projecting over. Other commitments (recurring
// forward, loan forward, planned horizon, recovery tax) ARE scaled to
// horizonDays in safeToSpend() because they represent windowed totals,
// not per-month rates. Don't unify these without rethinking the model
// — at horizonDays=60 the surplus must absorb 60 days of strategy
// reduction (m/30 * 60 = 2m) which already happens because the daily
// safe is per-day, not per-window.
export function strategyDailyReductionBase(s: DailySafeReductionStrategy): number {
  if (!s.active) return 0;
  const m = Number(s.monthly_save_estimate ?? 0);
  if (!Number.isFinite(m) || m <= 0) return 0;
  return m / 30;
}

// Total daily reduction across an array of strategies. The sum is
// already in base currency / day.
export function totalStrategyDailyReductionBase(
  strategies: DailySafeReductionStrategy[],
): number {
  return strategies.reduce((s, st) => s + strategyDailyReductionBase(st), 0);
}

// applyStrategiesToLive / removeStrategiesFromLive used to exist here as
// public composers that layered the daily reduction on top of a
// previously-computed SafeToSpendLive. They were never called —
// activePlanStrategies is now threaded through safeToSpend() directly,
// so the reduction is baked into safeTodayBase (and therefore
// initialForToday) before computeSafeToSpend ever sees it. Dropped to
// avoid two-source-of-truth drift; the underlying clamping asymmetry
// (apply clamped at 0 while remove did not) made them unsafe as
// general inverses anyway.

// ─────────────────────────── LIVE DAILY SAFE (Spendings workflow) ──
// computeSafeToSpend exposes the two-number contract the Spend modal,
// Today widget, and Spending top hero all use post-0085. See migration
// 0085_daily_safe_snapshots.sql for the model.
//
//   initialForToday — PHT-day-anchored snapshot of the day's starting
//                     safe-to-spend. STABLE across the PHT day. Stored
//                     in finance.daily_safe_snapshots, written on first
//                     read of the day.
//   liveRemaining   — initialForToday MINUS the sum of today's spends
//                     (PHT-bounded base amounts). RECOMPUTED on every
//                     render and every spend-log mutation.
//   isRough         — mirrors the existing baseline.confidenceTag ===
//                     'rough' flag so the dial / widget can render a
//                     small stamp.
//   currency        — base currency, threaded through for NumberFlow.
//
// This is a PURE function — it does not touch supabase. The caller
// passes in:
//   baseline       — full SafeToSpendBreakdown from computeSafeToSpendFromData
//   snapshotBase   — the persisted initial_safe_base for today's PHT date
//                    (or null on first read; the caller upserts when null)
//   todaySpendsBase— sum of today's PHT-bounded spend.amount_base values
//   currency       — base currency

export interface SafeToSpendLive {
  initialForToday: number;
  liveRemaining: number;
  // Magnitude of today's overshoot (todaySpendsBase - initialForToday)
  // when positive, else 0. `liveRemaining` stays clamped at 0 for the
  // calm-by-default headline; UI surfaces that want to show "₱X past
  // safe" read overshootBase instead. Keeps the recovery-mode framing
  // (which preserves overshoot signal elsewhere in this file) honest.
  overshootBase: number;
  isRough: boolean;
  currency: string;
}

export function computeSafeToSpend(args: {
  baseline: SafeToSpendBreakdown;
  snapshotBase: number | null;
  todaySpendsBase: number;
  currency: string;
}): SafeToSpendLive {
  // If we already have a persisted snapshot for today, use it. Otherwise
  // fall back to the breakdown's safeTodayBase — the caller is expected
  // to upsert the snapshot on the same render so the next read becomes
  // stable. Both branches round identically so the SafeToSpendLive
  // contract is dimensionally consistent and downstream subtraction
  // can't show e.g. live=412 initial=413 because of float dust.
  const rawInitial =
    args.snapshotBase != null
      ? Math.max(0, args.snapshotBase)
      : Math.max(0, args.baseline.safeTodayBase);
  const initialForToday = Math.round(rawInitial);
  const spentToday = Math.max(0, Math.round(args.todaySpendsBase));
  const signedRemaining = initialForToday - spentToday;
  const liveRemaining = Math.max(0, signedRemaining);
  const overshootBase = signedRemaining < 0 ? -signedRemaining : 0;
  return {
    initialForToday,
    liveRemaining,
    overshootBase,
    isRough: args.baseline.confidenceTag === "rough",
    currency: args.currency,
  };
}

export function safeToSpend(inputs: SafeToSpendInputs): SafeToSpendBreakdown {
  const now = inputs.now ?? new Date();
  const horizonDays = inputs.horizonDays ?? DEFAULT_HORIZON_DAYS;
  const horizonEnd = new Date(now.getTime() + horizonDays * DAY_MS);
  const lookbackStart = new Date(now.getTime() - TRAILING_LOOKBACK_DAYS * DAY_MS);
  const stabilityStart = new Date(now.getTime() - STABILITY_LOOKBACK_DAYS * DAY_MS);
  const notes: string[] = [];
  let isLearning = false;

  // ── Trailing analysis ──
  // 30d window for behavior + recovery; 90d window for the stability baseline.
  const trailingIncome = landedInRange(inputs.payments, lookbackStart, now);
  const trailingSpend = spendsInRange(inputs.spends, lookbackStart, now);
  const stabilityIncome = landedInRange(inputs.payments, stabilityStart, now);

  const recentDailyIncome = trailingIncome / TRAILING_LOOKBACK_DAYS;
  const longRunDailyIncome = stabilityIncome / STABILITY_LOOKBACK_DAYS;

  let stabilityScore = 1.0;
  if (longRunDailyIncome <= 0) {
    isLearning = true;
    notes.push("Still learning income patterns — using conservative defaults.");
  } else {
    stabilityScore = Math.max(0, Math.min(1.5, recentDailyIncome / longRunDailyIncome));
  }
  const stabilityMultiplier = Math.max(0.7, Math.min(1.2, stabilityScore));

  // ── Recovery mode ──
  // Trailing spend > trailing income → excess is "owed" to the forward window.
  // We distribute it over 2× horizon so a ₱6k overspend trims ~₱100/day for
  // 60 days rather than ₱200/day for 30 — gentle, sustainable.
  const trailingOverspend = Math.max(0, trailingSpend - trailingIncome);
  const recoverySpreadDays = horizonDays * RECOVERY_SPREAD_FACTOR;
  const recoveryDailyTax = recoverySpreadDays > 0 ? trailingOverspend / recoverySpreadDays : 0;
  const inRecovery = trailingOverspend > 0;
  if (inRecovery) {
    notes.push(
      `Recovery: trailing ${TRAILING_LOOKBACK_DAYS}d spend exceeded income by ${trailingOverspend.toFixed(0)} — spreading over ${recoverySpreadDays}d (≈ ${recoveryDailyTax.toFixed(0)}/day gentler).`,
    );
  }

  // ── Forward commitments ──
  // Recurring + loans due in [now, now+horizon] — rolling, not "rest of month".
  const recurringForward = recurringExpectedInRange(
    inputs.recurring,
    inputs.recurringSkips,
    inputs.rates,
    now,
    horizonEnd,
  );
  const loanForward = loanInstallmentsDueInRange(
    inputs.loanInstallments,
    inputs.rates,
    now,
    horizonEnd,
  );

  // Fee floor scaled to horizon — trailing 30d fees pro-rated to the window.
  const lookbackPaymentFees = inputs.payments
    .filter((p) => {
      if (p.fee_unknown) return false;
      const d = new Date(p.paid_at);
      return d >= lookbackStart && d <= now;
    })
    .reduce((s, p) => s + Number(p.implied_fee_base ?? 0), 0);
  const lookbackWithdrawalFees = withdrawalFeesInRange(inputs.withdrawals, lookbackStart, now);
  const trailingFeesTotal = lookbackPaymentFees + lookbackWithdrawalFees;
  const feeFloor = Math.max(
    FEE_RESERVE_FLOOR_BASE,
    (trailingFeesTotal * horizonDays) / TRAILING_LOOKBACK_DAYS,
  );

  // Planned spends inside [now, horizonEnd]. Migration 0088 collapsed
  // the lock mechanism; "committed plans" no longer exist. The daily
  // pressure of a plan is governed by active plan_strategies via the
  // strategy reduction below.
  const planned = inputs.plannedSpends ?? [];
  const plannedHorizon = plannedInRange(planned, now, horizonEnd).total;
  const committed = 0;
  if (plannedHorizon > 0) {
    notes.push(`Planned spends in window: ${plannedHorizon.toFixed(0)} (subtracted before allowance).`);
  }

  const committedPool = recurringForward + loanForward + feeFloor + plannedHorizon + committed;

  // ── Wallets ──
  // Sum across all holding wallets without per-wallet clamp — a negative
  // wallet (over-logged spend / missing payment) drags the total down rather
  // than being hidden. Outer max prevents the formula from going negative.
  const holdings = holdingBalances(
    inputs.methods,
    inputs.payments,
    inputs.stepsByPayment,
    inputs.withdrawals,
    inputs.spends,
    inputs.ledgerBalances,
  );
  const rawWalletBalances = holdings.reduce((s, h) => s + h.balance, 0);
  const walletBalances = Math.max(0, rawWalletBalances);
  // Per migration 0054: a wallet within its overdraft tolerance is rendered
  // terracotta as a soft signal but does not surface here as an alarm note.
  // Only over_overdraft wallets push a "log a payment" prompt; within-
  // tolerance wallets stay quiet so the same number doesn't shout from
  // every surface.
  const overOverdraft = holdings.filter((h) => h.status === "over_overdraft");
  if (overOverdraft.length > 0) {
    notes.push(
      `${overOverdraft.length} wallet${overOverdraft.length > 1 ? "s" : ""} past overdraft (${overOverdraft.map((h) => h.name).join(", ")}) — log a payment or fix the data.`,
    );
  }

  // ── Forward income projection ──
  // Trailing 30d velocity projected over the horizon. Conservative: cold start
  // projects zero income (better to under-promise than over-spend).
  const forwardIncomeProjection = isLearning ? 0 : recentDailyIncome * horizonDays;
  if (!isLearning && recentDailyIncome === 0) {
    notes.push(`No income in the past ${TRAILING_LOOKBACK_DAYS}d — projecting zero new income forward.`);
  }

  // ── Discretionary pool ──
  const discretionaryRaw = walletBalances + forwardIncomeProjection - committedPool;
  const discretionaryPool = Math.max(0, discretionaryRaw - recoveryDailyTax * horizonDays);

  // ── Daily allowance + COL floor + multipliers ──
  // Conceptual separation: essentials are essentials (always at least the
  // floor); only the SURPLUS above the floor gets dampened by stability +
  // pattern multipliers. This preserves the "never below COL" invariant
  // even in lean windows where stabilityMultiplier = 0.7.
  const dailyAllowanceRaw = discretionaryPool / horizonDays;
  const colFloor = PH_DAILY_FLOOR_BASE;
  const dailyAllowance = Math.max(colFloor, dailyAllowanceRaw);
  const patternMultiplier = 1.0;  // Phase 3: AI replaces with learned per-you value
  const surplus = Math.max(0, dailyAllowanceRaw - colFloor);
  // Migration 0089 — active plan strategies subtract their daily
  // equivalent from the surplus. The COL floor is never breached: if
  // the reduction would push below the floor, the floor wins and the
  // remaining reduction is absorbed by the "we'll get there a bit
  // slower" reality. Plans is the first external consumer; future
  // strategy sources plug in via the same input list.
  const strategyReduction = totalStrategyDailyReductionBase(
    (inputs.activePlanStrategies ?? []).map((s) => ({
      strategy_id: s.id,
      plan_id: s.plan_id,
      kind: s.strategy_kind,
      monthly_save_estimate: s.monthly_save_estimate,
      active: s.active,
    })),
  );
  if (strategyReduction > 0) {
    notes.push(
      `Active plan strategies trim ${strategyReduction.toFixed(0)}/day from surplus.`,
    );
  }
  const adjustedSurplus = Math.max(0, surplus * stabilityMultiplier * patternMultiplier - strategyReduction);
  const safeToday = colFloor + adjustedSurplus;

  if (dailyAllowanceRaw < colFloor) {
    notes.push(
      `Discretionary below the ₱${colFloor}/day cost-of-living floor — commitments are crowding essentials. Log income or revisit recurring rules.`,
    );
  }

  notes.unshift(
    `Wallets ${walletBalances.toFixed(0)} + forward income ${forwardIncomeProjection.toFixed(0)} − committed ${committedPool.toFixed(0)}${inRecovery ? ` − recovery ${(recoveryDailyTax * horizonDays).toFixed(0)}` : ""} = ${discretionaryPool.toFixed(0)} over ${horizonDays}d.`,
  );
  notes.push(`Stability ×${stabilityMultiplier.toFixed(2)} (raw ${stabilityScore.toFixed(2)})`);

  // T32 — observation horizon + confidence tag. Pure read-only — the number
  // above is already the user-facing answer. The tag tells the widget how
  // confident to look (small "rough" stamp below 14d data).
  //
  // We fold the min into the row iteration to avoid Math.min(...allTs) — for
  // long-running freelancers with thousands of spends, spreading every
  // timestamp as argv risks "Maximum call stack size exceeded" and is slower
  // than a single linear scan.
  let oldest = now.getTime();
  let sawAny = false;
  for (const p of inputs.payments) {
    const t = new Date(p.paid_at).getTime();
    if (Number.isFinite(t)) {
      sawAny = true;
      if (t < oldest) oldest = t;
    }
  }
  for (const s of inputs.spends) {
    const t = new Date(s.spent_at).getTime();
    if (Number.isFinite(t)) {
      sawAny = true;
      if (t < oldest) oldest = t;
    }
  }
  if (!sawAny) oldest = now.getTime();
  const observationDays = Math.max(0, Math.round((now.getTime() - oldest) / DAY_MS));
  const confidenceTag: SafeToSpendBreakdown["confidenceTag"] =
    observationDays < 14 ? "rough" : observationDays < 21 ? "calibrating" : "steady";

  return {
    horizonDays,
    walletBalancesBase: walletBalances,
    trailingIncomeBase: trailingIncome,
    trailingSpendBase: trailingSpend,
    forwardIncomeProjectionBase: forwardIncomeProjection,
    recurringForwardBase: recurringForward,
    loanForwardBase: loanForward,
    feeFloorBase: feeFloor,
    plannedForwardBase: plannedHorizon,
    committedLockedBase: committed,
    committedPoolBase: committedPool,
    trailingOverspendBase: trailingOverspend,
    recoveryDailyTaxBase: recoveryDailyTax,
    inRecovery,
    discretionaryPoolBase: discretionaryPool,
    dailyAllowanceBase: dailyAllowance,
    stabilityScore,
    stabilityMultiplier,
    patternMultiplier,
    colFloorBase: colFloor,
    safeTodayBase: safeToday,
    notes,
    isLearning,
    observationDays,
    confidenceTag,
  };
}

// ─────────────────────────── Sadaka suggestion at income event ──
// Contextual percentage of just-landed net, scaled to current stability +
// recovery state. Conservative tiers for v1; Phase 3 AI overlay replaces
// with per-user learned function.

export interface SadakaSuggestion {
  suggestedBase: number;
  percent: number;
  reason: string;
  isLearning: boolean;
}

export function suggestSadakaForIncome(
  netBase: number,
  inputs: SafeToSpendInputs,
): SadakaSuggestion {
  const safe = safeToSpend(inputs);
  let percent: number;
  let reason: string;
  if (safe.isLearning) {
    percent = 0.02;
    reason = "Conservative 2% while learning your income patterns.";
  } else if (safe.inRecovery) {
    percent = 0.015;
    reason = "Recovery mode — small portion while you rebuild.";
  } else if (safe.stabilityScore < 0.8) {
    percent = 0.02;
    reason = "Lean window — small portion suggested.";
  } else if (safe.stabilityScore < 1.1) {
    percent = 0.03;
    reason = "Stable window — modest portion suggested.";
  } else {
    percent = 0.05;
    reason = "Strong window — room for a larger portion.";
  }
  return {
    suggestedBase: Math.round(netBase * percent),
    percent,
    reason,
    isLearning: safe.isLearning,
  };
}

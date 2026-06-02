import type {
  ExchangeRate,
  LoanInstallment,
  Payment,
  PaymentMethod,
  PaymentStep,
  PlannedSpend,
  RecurringSpend,
  RecurringSpendSkip,
  Spend,
  Withdrawal,
} from "@/lib/supabase/types";
import { anchorDate, expectedBase as recurringExpectedBase, periodKey } from "@/lib/recurring";
import { holdingBalances } from "@/lib/payment-chain";
import { landedInRange, spendsInRange } from "@/lib/dashboard-calc";

const DAY_MS = 86_400_000;
const DEFAULT_HORIZON_DAYS = 90;
const INCOME_LOOKBACK_DAYS = 30;

export interface AtlasDay {
  date: Date;          // local midnight
  dayKey: string;      // "YYYY-MM-DD"
  // Per-day deltas.
  expectedIncome: number;
  expectedSpend: number;       // baseline pace (trailing 30d daily)
  recurringDue: number;
  loanDue: number;
  plannedSpend: number;
  // Running PHP balance projection (all wallets summed).
  endOfDayBalance: number;
  // Annotations the chart surfaces.
  events: AtlasEvent[];
}

export interface AtlasEvent {
  kind: "recurring" | "loan" | "planned" | "income_pulse";
  label: string;
  amount: number;     // positive = outflow, negative = inflow
}

export interface CashflowAtlasInputs {
  payments: Payment[];
  withdrawals: Withdrawal[];
  spends: Spend[];
  recurring: RecurringSpend[];
  recurringSkips: RecurringSpendSkip[];
  loanInstallments: LoanInstallment[];
  plannedSpends: PlannedSpend[];
  methods: PaymentMethod[];
  stepsByPayment: Map<string, PaymentStep[]>;
  rates: ExchangeRate[];
  // Phase 1.5: optional precomputed ledger-derived balance map. When
  // provided, holdingBalances() short-circuits to ledger truth for covered
  // wallets. Undefined → source-table math (unchanged).
  ledgerBalances?: Map<string, number> | null;
  now?: Date;
  horizonDays?: number;
}

export interface CashflowAtlas {
  days: AtlasDay[];
  horizonDays: number;
  startingBalance: number;
  // Statistics for headline.
  minBalance: number;
  minBalanceDate: Date | null;
  maxOutflowDay: AtlasDay | null;
  // The day balance crosses zero (if any) — drives runway language.
  zeroCrossingDate: Date | null;
}

// Build a 90-day daily atlas of cash, projecting forward from today using:
//   trailing 30d income velocity (per day)
//   trailing 30d spend velocity (per day)
//   recurring rules' anchored due dates (precise day)
//   loan installments by due_date (precise day)
//   planned_spends by planned_for (precise day)
//
// The result feeds:
//   - 90-Day Cashflow Atlas chart (dashboard)
//   - Pre-Mortem narrative around big plans
//   - Calm Weather brain (looks at min balance + zero crossings)
export function buildCashflowAtlas(inputs: CashflowAtlasInputs): CashflowAtlas {
  const now = inputs.now ?? new Date();
  const horizonDays = inputs.horizonDays ?? DEFAULT_HORIZON_DAYS;
  const start = startOfLocalDay(now);

  // Starting balance = sum of holding wallets right now.
  const holdings = holdingBalances(
    inputs.methods,
    inputs.payments,
    inputs.stepsByPayment,
    inputs.withdrawals,
    inputs.spends,
    inputs.ledgerBalances,
  );
  const startingBalance = holdings.reduce((s, h) => s + h.balance, 0);

  // Trailing-30d velocities (per-day baseline). The DAILY SPEND baseline is
  // DISCRETIONARY ONLY — exclude the trailing-window spends already tied to
  // recurring rules or loan installments, otherwise we'd double-count when we
  // add their precise next-30d due-date events on top below.
  const lookbackStart = new Date(start.getTime() - INCOME_LOOKBACK_DAYS * DAY_MS);
  const trailingIncome = landedInRange(inputs.payments, lookbackStart, start);
  const trailingSpend = spendsInRange(inputs.spends, lookbackStart, start);
  const trailingRecurringLoan = inputs.spends
    .filter((s) => {
      if (!s.recurring_spend_id && !s.loan_id && !s.loan_installment_id) return false;
      const d = new Date(s.spent_at);
      return d >= lookbackStart && d <= start;
    })
    .reduce((sum, s) => sum + Number(s.amount_base ?? 0), 0);
  const trailingDiscretionary = Math.max(0, trailingSpend - trailingRecurringLoan);
  const dailyIncome = trailingIncome / INCOME_LOOKBACK_DAYS;
  const dailySpend = trailingDiscretionary / INCOME_LOOKBACK_DAYS;

  // Pre-bucket each day's events.
  const days: AtlasDay[] = [];
  for (let i = 0; i < horizonDays; i++) {
    const d = new Date(start.getTime() + i * DAY_MS);
    days.push({
      date: d,
      dayKey: keyForDay(d),
      expectedIncome: dailyIncome,
      expectedSpend: dailySpend,
      recurringDue: 0,
      loanDue: 0,
      plannedSpend: 0,
      endOfDayBalance: 0,
      events: [],
    });
  }
  const byKey = new Map(days.map((d) => [d.dayKey, d] as const));

  // Recurring: walk every rule, every anchor that falls in horizon, deduct.
  const skipsByRule = new Map<string, Set<string>>();
  for (const s of inputs.recurringSkips) {
    const set = skipsByRule.get(s.recurring_spend_id) ?? new Set<string>();
    set.add(s.period_key);
    skipsByRule.set(s.recurring_spend_id, set);
  }
  for (const r of inputs.recurring) {
    if (!r.active) continue;
    const ruleSkips = skipsByRule.get(r.id) ?? new Set<string>();
    const expected = recurringExpectedBase(r, inputs.rates);
    // Walk forward in 1-day steps, computing each day's anchor; when anchor
    // lands inside horizon and isn't skipped, deduct it.
    const seen = new Set<string>();
    for (let i = 0; i < horizonDays; i++) {
      const day = new Date(start.getTime() + i * DAY_MS);
      const anchor = anchorDate(r, day);
      anchor.setHours(0, 0, 0, 0);
      const anchorKey = keyForDay(anchor);
      if (anchor < start || anchor >= new Date(start.getTime() + horizonDays * DAY_MS)) continue;
      if (seen.has(anchorKey)) continue;
      const pKey = periodKey(r, anchor);
      if (ruleSkips.has(pKey)) {
        seen.add(anchorKey);
        continue;
      }
      const slot = byKey.get(anchorKey);
      if (slot) {
        slot.recurringDue += expected;
        slot.events.push({ kind: "recurring", label: r.label, amount: expected });
      }
      seen.add(anchorKey);
    }
  }

  // Loan installments — pending ones with due_date inside horizon.
  for (const inst of inputs.loanInstallments) {
    if (inst.status !== "pending") continue;
    const due = parseLocalDate(inst.due_date);
    if (due < start) continue;
    const dueKey = keyForDay(due);
    const slot = byKey.get(dueKey);
    if (!slot) continue;
    const amt = toBaseSafe(Number(inst.expected_amount), inst.expected_currency, inputs.rates);
    slot.loanDue += amt;
    slot.events.push({ kind: "loan", label: "Loan installment", amount: amt });
  }

  // Planned + committed spends — count at planned_for date. Cancelled + done
  // are EXCLUDED. Committed plans show on the atlas because the spend still
  // physically happens on the planned date (the lock just earmarks the money
  // ahead of time, it doesn't fast-forward the outflow).
  for (const plan of inputs.plannedSpends) {
    if (plan.status === "cancelled" || plan.status === "done") continue;
    const due = parseLocalDate(plan.planned_for);
    if (due < start) continue;
    const dueKey = keyForDay(due);
    const slot = byKey.get(dueKey);
    if (!slot) continue;
    const amt = Number(plan.committed_base ?? plan.expected_base ?? 0);
    slot.plannedSpend += amt;
    slot.events.push({ kind: "planned", label: plan.label, amount: amt });
  }

  // Roll forward the balance.
  let running = startingBalance;
  let minBalance = startingBalance;
  let minBalanceDate: Date | null = null;
  let zeroCrossingDate: Date | null = null;
  let maxOutflowDay: AtlasDay | null = null;

  for (const day of days) {
    const dayOutflow = day.expectedSpend + day.recurringDue + day.loanDue + day.plannedSpend;
    running = running + day.expectedIncome - dayOutflow;
    day.endOfDayBalance = running;
    if (running < minBalance) {
      minBalance = running;
      minBalanceDate = day.date;
    }
    if (zeroCrossingDate === null && running < 0) {
      zeroCrossingDate = day.date;
    }
    const realOutflow = dayOutflow;
    if (!maxOutflowDay || realOutflow > (maxOutflowDay.expectedSpend + maxOutflowDay.recurringDue + maxOutflowDay.loanDue + maxOutflowDay.plannedSpend)) {
      maxOutflowDay = day;
    }
  }

  return {
    days,
    horizonDays,
    startingBalance,
    minBalance,
    minBalanceDate,
    maxOutflowDay,
    zeroCrossingDate,
  };
}

function startOfLocalDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function keyForDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseLocalDate(yyyymmdd: string): Date {
  const [y, m, d] = yyyymmdd.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function toBaseSafe(amount: number, code: string, rates: ExchangeRate[]): number {
  if (!amount) return 0;
  const rate = rates.find((r) => r.code === code)?.rate_to_base;
  return amount * (rate ?? 1);
}

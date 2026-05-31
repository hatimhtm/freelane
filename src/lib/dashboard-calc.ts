import type {
  Client,
  CurrencyCode,
  ExchangeRate,
  LoanInstallment,
  Payment,
  Project,
  RecurringSpend,
  RecurringSpendSkip,
  Spend,
  Withdrawal,
} from "@/lib/supabase/types";
import { toBase } from "@/lib/money";

const DAY_MS = 86_400_000;

function landed(p: Payment): number {
  return Number(p.net_amount_base ?? 0);
}

export function landedInRange(payments: Payment[], start: Date, end?: Date): number {
  return payments
    .filter((p) => {
      const d = new Date(p.paid_at);
      return d >= start && (!end || d <= end);
    })
    .reduce((s, p) => s + landed(p), 0);
}

// fee_unknown payments are EXCLUDED — counting them (even as 0) would understate
// the route's effective cost and violate the project's "unknown ≠ zero" rule.
export function feesInRange(payments: Payment[], start: Date, end?: Date): number {
  return payments
    .filter((p) => {
      if (p.fee_unknown) return false;
      const d = new Date(p.paid_at);
      return d >= start && (!end || d <= end);
    })
    .reduce((s, p) => s + Number(p.implied_fee_base ?? 0), 0);
}

export function withdrawalFeesInRange(withdrawals: Withdrawal[], start: Date, end?: Date): number {
  return withdrawals
    .filter((w) => {
      const d = new Date(w.withdrawn_at);
      return d >= start && (!end || d <= end);
    })
    .reduce((s, w) => s + Number(w.fee_base ?? 0), 0);
}

// ───────────────────────────────────────── Spending ──

export function spendsInRange(spends: Spend[], start: Date, end?: Date): number {
  return spends
    .filter((s) => {
      const d = new Date(s.spent_at);
      return d >= start && (!end || d <= end);
    })
    .reduce((s, sp) => s + Number(sp.amount_base ?? 0), 0);
}

export interface SpendCategoryTotal {
  categoryId: string;
  total: number;
}

// Per-category breakdown. Multi-tag spends contribute their FULL amount_base
// to each category they're tagged with — by design. The headline total (above)
// is the no-double-count number.
export function spendsByCategoryInRange(
  spends: Spend[],
  linksBySpend: Map<string, string[]>,
  start: Date,
  end?: Date,
): SpendCategoryTotal[] {
  const totals = new Map<string, number>();
  for (const sp of spends) {
    const d = new Date(sp.spent_at);
    if (d < start || (end && d > end)) continue;
    const cats = linksBySpend.get(sp.id) ?? [];
    for (const cat of cats) {
      totals.set(cat, (totals.get(cat) ?? 0) + Number(sp.amount_base ?? 0));
    }
  }
  return Array.from(totals, ([categoryId, total]) => ({ categoryId, total }))
    .sort((a, b) => b.total - a.total);
}

// Expected outflow from active recurring rules in [start, end], minus periods
// explicitly settled (user_skip or covered_by_prepay). Emits a period key ONLY
// when the rule's true anchor for that period falls inside the range —
// partial-month ranges no longer over-count, yearly subs no longer inflate
// every month's forecast, half_monthly no longer emits both halves unconditionally.
export function recurringExpectedInRange(
  recurring: RecurringSpend[],
  skips: RecurringSpendSkip[],
  rates: Pick<ExchangeRate, "code" | "rate_to_base">[],
  start: Date,
  end: Date,
): number {
  const skipsByRule = new Map<string, Set<string>>();
  for (const s of skips) {
    const set = skipsByRule.get(s.recurring_spend_id) ?? new Set<string>();
    set.add(s.period_key);
    skipsByRule.set(s.recurring_spend_id, set);
  }

  let total = 0;
  for (const r of recurring) {
    if (!r.active) continue;
    const ruleSkips = skipsByRule.get(r.id) ?? new Set<string>();
    const periodsInRange = expectedPeriodKeysInRange(r, start, end);
    const livePeriods = periodsInRange.filter((k) => !ruleSkips.has(k));
    if (livePeriods.length === 0) continue;
    const expected = toBase(Number(r.expected_amount), r.expected_currency as CurrencyCode, rates);
    total += livePeriods.length * expected;
  }
  return total;
}

// Period-keys a rule WOULD generate inside [start, end] — emits a key ONLY
// when the period's true anchor falls in range. Must match the format
// documented in migration 0020 and computed by lib/recurring.ts.
function expectedPeriodKeysInRange(r: RecurringSpend, start: Date, end: Date): string[] {
  const out: string[] = [];
  switch (r.schedule_kind) {
    case "monthly": {
      const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
      while (cursor <= end) {
        const y = cursor.getFullYear();
        const m = cursor.getMonth();
        const lastDay = new Date(y, m + 1, 0).getDate();
        const anchor = new Date(y, m, Math.min(r.day_of_month ?? 1, lastDay));
        if (anchor >= start && anchor <= end) {
          out.push(`${y}-${pad2(m + 1)}`);
        }
        cursor.setMonth(m + 1);
      }
      break;
    }
    case "every_n_months": {
      // Use created_at as the cadence anchor — a rule created in March with
      // step=3 fires Mar/Jun/Sep/Dec regardless of the range's first month.
      const step = r.every_n_value ?? 1;
      const ruleCreated = new Date(r.created_at);
      const anchorMonth = ruleCreated.getMonth();
      const anchorYear = ruleCreated.getFullYear();
      const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
      while (cursor <= end) {
        const monthsSinceAnchor =
          (cursor.getFullYear() - anchorYear) * 12 +
          (cursor.getMonth() - anchorMonth);
        if (monthsSinceAnchor >= 0 && monthsSinceAnchor % step === 0) {
          const y = cursor.getFullYear();
          const m = cursor.getMonth();
          const lastDay = new Date(y, m + 1, 0).getDate();
          const anchor = new Date(y, m, Math.min(r.day_of_month ?? 1, lastDay));
          if (anchor >= start && anchor <= end) {
            out.push(`${y}-${pad2(m + 1)}`);
          }
        }
        cursor.setMonth(cursor.getMonth() + 1);
      }
      break;
    }
    case "half_monthly": {
      const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
      while (cursor <= end) {
        const y = cursor.getFullYear();
        const m = cursor.getMonth();
        const h1Start = new Date(y, m, 1);
        const h1End = new Date(y, m, 15, 23, 59, 59, 999);
        const h2Start = new Date(y, m, 16);
        const h2End = new Date(y, m + 1, 0, 23, 59, 59, 999);
        if (h1End >= start && h1Start <= end) out.push(`${y}-${pad2(m + 1)}-H1`);
        if (h2End >= start && h2Start <= end) out.push(`${y}-${pad2(m + 1)}-H2`);
        cursor.setMonth(m + 1);
      }
      break;
    }
    case "weekly": {
      const step = (r.every_n_value ?? 1) * 7;
      const target = r.day_of_week ?? 1;
      const cur = new Date(start);
      cur.setHours(0, 0, 0, 0);
      // Snap to Monday of start's ISO week, then offset to the rule's target day.
      const jsDay = cur.getDay();
      const daysFromMonday = (jsDay + 6) % 7;
      cur.setDate(cur.getDate() - daysFromMonday);
      const targetOffset = (target + 6) % 7;
      cur.setDate(cur.getDate() + targetOffset);
      // If that day is before start, advance by one cadence.
      if (cur < start) cur.setDate(cur.getDate() + step);
      while (cur <= end) {
        out.push(isoWeekKey(cur));
        cur.setDate(cur.getDate() + step);
      }
      break;
    }
    case "yearly": {
      // v1: yearly anchor is day_of_month of January (schema doesn't store
      // a month-of-year yet). Apple Developer in November would model as
      // every_n_months with step=12 + anchor set via the rule's created_at.
      for (let y = start.getFullYear(); y <= end.getFullYear(); y++) {
        const anchor = new Date(y, 0, r.day_of_month ?? 1);
        if (anchor >= start && anchor <= end) out.push(`${y}`);
      }
      break;
    }
  }
  return out;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function isoWeekKey(d: Date): string {
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayNum = t.getDay() || 7;
  t.setDate(t.getDate() + 4 - dayNum);
  const yearStart = new Date(t.getFullYear(), 0, 1);
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7);
  return `${t.getFullYear()}-W${pad2(week)}`;
}

export function loanInstallmentsDueInRange(
  installments: LoanInstallment[],
  rates: Pick<ExchangeRate, "code" | "rate_to_base">[],
  start: Date,
  end: Date,
): number {
  return installments
    .filter((i) => {
      if (i.status !== "pending") return false;
      const d = parseLocalDate(i.due_date);
      return d >= start && d <= end;
    })
    .reduce((s, i) => s + toBase(Number(i.expected_amount), i.expected_currency as CurrencyCode, rates), 0);
}

// Postgres `date` columns serialize as "YYYY-MM-DD". `new Date("YYYY-MM-DD")`
// parses as UTC midnight, which becomes 08:00 PHT for Manila users — fine for
// month-range filters but wrong for "is this overdue at 11pm Manila on the
// due date" comparisons (would mis-bucket as overdue 16 hours early).
function parseLocalDate(yyyymmdd: string): Date {
  const [y, m, d] = yyyymmdd.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function startOfWeek(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

// Headline cashflow figures. Monthly is the hero; weekly + yearly ride along.
// Spending is reported separately (NOT subtracted from landed) — landed = income,
// spent = outflow; safe-to-spend is the formula that combines them.
export function cashflowMetrics(
  payments: Payment[],
  now = new Date(),
  recurringMonthlyFeePhp = 0,
  withdrawals: Withdrawal[] = [],
  spends: Spend[] = [],
) {
  const startMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const endLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
  const startYear = new Date(now.getFullYear(), 0, 1);
  const startWeek = startOfWeek(now);
  const startLastWeek = new Date(startWeek.getTime() - 7 * DAY_MS);
  const endLastWeek = new Date(startWeek.getTime() - 1);

  const wfMonth = withdrawalFeesInRange(withdrawals, startMonth);
  const wfLastMonth = withdrawalFeesInRange(withdrawals, startLastMonth, endLastMonth);
  const wfWeek = withdrawalFeesInRange(withdrawals, startWeek);
  const wfLastWeek = withdrawalFeesInRange(withdrawals, startLastWeek, endLastWeek);
  const wfYear = withdrawalFeesInRange(withdrawals, startYear);

  const mtd = Math.max(0, landedInRange(payments, startMonth) - recurringMonthlyFeePhp - wfMonth);
  const lastMonth = Math.max(0, landedInRange(payments, startLastMonth, endLastMonth) - recurringMonthlyFeePhp - wfLastMonth);
  const wtd = Math.max(0, landedInRange(payments, startWeek) - wfWeek);
  const lastWeek = Math.max(0, landedInRange(payments, startLastWeek, endLastWeek) - wfLastWeek);
  const ytd = Math.max(0, landedInRange(payments, startYear) - wfYear);
  const feesMtd = feesInRange(payments, startMonth) + wfMonth;

  const spentMtd = spendsInRange(spends, startMonth);
  const spentLastMonth = spendsInRange(spends, startLastMonth, endLastMonth);
  const spentWtd = spendsInRange(spends, startWeek);
  const spentYtd = spendsInRange(spends, startYear);

  return {
    mtd,
    lastMonth,
    momDelta: lastMonth > 0 ? (mtd - lastMonth) / lastMonth : null,
    wtd,
    lastWeek,
    wowDelta: lastWeek > 0 ? (wtd - lastWeek) / lastWeek : null,
    ytd,
    feesMtd,
    spentMtd,
    spentLastMonth,
    spentWtd,
    spentYtd,
  };
}

export interface OutstandingRow {
  project: Project;
  client?: Client;
  outstandingNative: number;
  outstandingBase: number;
  daysAged: number;
  urgency: number;
}

export function outstanding(
  projects: Project[],
  payments: Payment[],
  clients: Client[],
  rates: ExchangeRate[],
  now = new Date(),
): OutstandingRow[] {
  const clientsById = new Map(clients.map((c) => [c.id, c]));
  return projects
    .filter((p) => p.status === "unpaid" || p.status === "partially_paid")
    .map((project) => {
      const paid = payments
        .filter((p) => p.project_id === project.id && p.currency === project.currency)
        .reduce((s, p) => s + Number(p.amount), 0);
      const outstandingNative = Math.max(0, Number(project.amount) - paid);
      const outstandingBase = toBase(outstandingNative, project.currency as CurrencyCode, rates);
      const aged = project.quoted_at
        ? Math.max(0, Math.floor((now.getTime() - new Date(project.quoted_at).getTime()) / DAY_MS))
        : 0;
      const urgency = outstandingBase * Math.max(1, aged) * (project.flagged_overdue ? 1.5 : 1);
      return {
        project,
        client: clientsById.get(project.client_id),
        outstandingNative,
        outstandingBase,
        daysAged: aged,
        urgency,
      };
    })
    .filter((r) => r.outstandingBase > 0)
    .sort((a, b) => b.urgency - a.urgency);
}

export function outstandingTotalBase(rows: OutstandingRow[]): number {
  return rows.reduce((s, r) => s + r.outstandingBase, 0);
}

export function topClients(
  payments: Payment[],
  projects: Project[],
  clients: Client[],
  limit = 5,
) {
  const projectsById = new Map(projects.map((p) => [p.id, p]));
  const clientsById = new Map(clients.map((c) => [c.id, c]));
  const byClient = new Map<string, { name: string; value: number }>();
  for (const p of payments) {
    const project = projectsById.get(p.project_id);
    if (!project) continue;
    const name = clientsById.get(project.client_id)?.name ?? "Unknown";
    const entry = byClient.get(project.client_id) ?? { name, value: 0 };
    entry.value += Number(p.net_amount_base ?? 0);
    byClient.set(project.client_id, entry);
  }
  return Array.from(byClient.values())
    .filter((c) => c.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, limit)
    .map((c) => ({ ...c, value: Math.round(c.value) }));
}

export function revenueSeries(payments: Payment[], months = 6, now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
  const buckets = new Map<string, number>();
  for (let i = 0; i < months; i++) {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
    buckets.set(d.toLocaleString("en", { month: "short" }), 0);
  }
  for (const p of payments) {
    const d = new Date(p.paid_at);
    if (d < start) continue;
    const key = d.toLocaleString("en", { month: "short" });
    buckets.set(key, (buckets.get(key) ?? 0) + Number(p.net_amount_base ?? 0));
  }
  return Array.from(buckets, ([month, total]) => ({ month, total: Math.round(total) }));
}

export function dailySeries(payments: Payment[], days = 30, now = new Date()): number[] {
  const out = new Array(days).fill(0);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  for (const p of payments) {
    const d = new Date(p.paid_at);
    const idx = Math.floor((d.getTime() - start.getTime()) / DAY_MS);
    if (idx >= 0 && idx < days) out[idx] += Number(p.net_amount_base ?? 0);
  }
  return out;
}

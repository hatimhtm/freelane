import type { Client, CurrencyCode, ExchangeRate, Payment, Project } from "@/lib/supabase/types";
import { toBase } from "@/lib/money";

const DAY_MS = 86_400_000;

// Landed PHP is locked at payment time (net_amount_base). No FX recompute.
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

export function feesInRange(payments: Payment[], start: Date, end?: Date): number {
  return payments
    .filter((p) => {
      const d = new Date(p.paid_at);
      return d >= start && (!end || d <= end);
    })
    .reduce((s, p) => s + Number(p.implied_fee_base ?? 0), 0);
}

function startOfWeek(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // Monday start
  return x;
}

// Headline cashflow figures. Monthly is the hero; weekly + yearly ride along.
export function cashflowMetrics(payments: Payment[], now = new Date(), recurringMonthlyFeePhp = 0) {
  const startMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const endLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
  const startYear = new Date(now.getFullYear(), 0, 1);
  const startWeek = startOfWeek(now);
  const startLastWeek = new Date(startWeek.getTime() - 7 * DAY_MS);
  const endLastWeek = new Date(startWeek.getTime() - 1);

  const mtdGross = landedInRange(payments, startMonth);
  const mtd = Math.max(0, mtdGross - recurringMonthlyFeePhp);
  const lastMonthGross = landedInRange(payments, startLastMonth, endLastMonth);
  const lastMonth = Math.max(0, lastMonthGross - recurringMonthlyFeePhp);
  const wtd = landedInRange(payments, startWeek);
  const lastWeek = landedInRange(payments, startLastWeek, endLastWeek);
  const ytd = landedInRange(payments, startYear);
  const feesMtd = feesInRange(payments, startMonth);

  return {
    mtd,
    lastMonth,
    momDelta: lastMonth > 0 ? (mtd - lastMonth) / lastMonth : null,
    wtd,
    lastWeek,
    wowDelta: lastWeek > 0 ? (wtd - lastWeek) / lastWeek : null,
    ytd,
    feesMtd,
  };
}

export interface OutstandingRow {
  project: Project;
  client?: Client;
  outstandingNative: number;
  outstandingBase: number;
  daysAged: number;
  urgency: number; // amount × days_aged × (flagged ? 1.5 : 1)
}

// Unpaid balances. These DO float with the market — they're what you're still
// owed, in the client's currency, valued at today's rate.
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

// Daily landed series for the masthead sparkline (last N days).
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

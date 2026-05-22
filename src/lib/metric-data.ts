import { getDashboardData } from "@/lib/data/queries";
import {
  cashflowMetrics,
  outstanding,
  outstandingTotalBase,
  topClients,
  revenueSeries,
} from "@/lib/dashboard-calc";
import { methodLeaderboard, chainSignature, paymentFee } from "@/lib/payment-chain";
import { BASE_CURRENCY_FALLBACK } from "@/lib/constants";
import type { CurrencyCode, PaymentMethod } from "@/lib/supabase/types";
import type { BlockedRow } from "@/components/app/blocked-money-list";
import type { MethodLeaderboardRow } from "@/lib/payment-chain";
import type { MetricData } from "@/app/(app)/metric/[key]/_components/metric-detail";

const DAY_MS = 86_400_000;

export const METRIC_KEYS = ["landed", "outstanding", "fees", "avg-days", "debtor"] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

export const METRIC_META: Record<MetricKey, { title: string; description: string }> = {
  landed: {
    title: "Landed this month",
    description: "Cash that actually arrived this month — locked at the rate it landed.",
  },
  outstanding: {
    title: "Outstanding",
    description: "Every open balance you're still owed, valued at today's rates.",
  },
  fees: {
    title: "Fees",
    description: "What the rails and FX markup ate — by month, by chain, and the worst offenders.",
  },
  "avg-days": {
    title: "Avg days to payment",
    description: "How long it takes a quote to turn into the first payment.",
  },
  debtor: {
    title: "Biggest debtor",
    description: "Clients ranked by how much they currently owe you.",
  },
};

export function isMetricKey(key: string): key is MetricKey {
  return (METRIC_KEYS as readonly string[]).includes(key);
}

export function metricMeta(key: MetricKey) {
  return METRIC_META[key];
}

export async function buildMetricData(key: MetricKey): Promise<MetricData> {
  const { settings, projects, payments, rates, clients, methods, stepsByPayment } =
    await getDashboardData();

  const currency = (settings?.base_currency ?? BASE_CURRENCY_FALLBACK) as CurrencyCode;
  const recurringFee = methods.reduce((s, m) => s + Number(m.monthly_fee_php ?? 0), 0);
  const now = new Date();
  const metrics = cashflowMetrics(payments, now, recurringFee);

  const projectsById = new Map(projects.map((p) => [p.id, p]));
  const clientsById = new Map(clients.map((c) => [c.id, c]));
  const methodsById = new Map<string, PaymentMethod>(methods.map((m) => [m.id, m]));

  const rows = outstanding(projects, payments, clients, rates);

  switch (key) {
    case "landed": {
      const startMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      const monthPayments = payments
        .filter((p) => new Date(p.paid_at) >= startMonth)
        .map((p) => {
          const proj = projectsById.get(p.project_id);
          const client = proj ? clientsById.get(proj.client_id) : undefined;
          return {
            id: p.id,
            net: Math.round(Number(p.net_amount_base ?? 0)),
            paidAt: p.paid_at,
            projectTitle: proj?.title ?? "—",
            clientName: client?.name ?? "—",
          };
        })
        .sort((a, b) => new Date(b.paidAt).getTime() - new Date(a.paidAt).getTime());

      const clientsTop = topClients(payments, projects, clients, 5);
      const landedTotalAll = payments.reduce((s, p) => s + Number(p.net_amount_base ?? 0), 0);
      const topSum = clientsTop.reduce((s, c) => s + c.value, 0);
      const otherVal = Math.max(0, Math.round(landedTotalAll - topSum));
      const incomeByClient = [
        ...clientsTop.map((c) => ({ name: c.name, value: c.value })),
        ...(otherVal > 0 && clients.length > 5 ? [{ name: "Other", value: otherVal }] : []),
      ];

      const curBuckets = new Map<string, number>();
      for (const p of payments) {
        if (new Date(p.paid_at) < startMonth) continue;
        const proj = projectsById.get(p.project_id);
        const cur = (proj?.currency ?? currency) as string;
        curBuckets.set(cur, (curBuckets.get(cur) ?? 0) + Number(p.net_amount_base ?? 0));
      }
      const incomeByCurrency = Array.from(curBuckets, ([code, value]) => ({
        code,
        value: Math.round(value),
      }))
        .filter((c) => c.value > 0)
        .sort((a, b) => b.value - a.value);

      return {
        key,
        currency,
        landed: {
          mtd: metrics.mtd,
          momDelta: metrics.momDelta,
          revenue: revenueSeries(payments, 6, now),
          incomeByClient,
          incomeByCurrency,
          payments: monthPayments,
        },
      };
    }

    case "outstanding": {
      const blocked: BlockedRow[] = rows.map((r) => ({
        projectId: r.project.id,
        projectTitle: r.project.title,
        clientName: r.client?.name ?? "—",
        outstandingNative: r.outstandingNative,
        currency: r.project.currency as CurrencyCode,
        outstandingBase: r.outstandingBase,
        daysAged: r.daysAged,
        status: r.project.status === "partially_paid" ? "partially_paid" : "unpaid",
        flagged: r.project.flagged_overdue,
      }));

      const byClient = new Map<string, number>();
      for (const r of rows) {
        const name = r.client?.name ?? "Unknown";
        byClient.set(name, (byClient.get(name) ?? 0) + r.outstandingBase);
      }
      const outstandingByClient = Array.from(byClient, ([name, value]) => ({
        name,
        value: Math.round(value),
      }))
        .filter((c) => c.value > 0)
        .sort((a, b) => b.value - a.value);

      const oldest = [...rows].sort((a, b) => b.daysAged - a.daysAged)[0] ?? null;

      return {
        key,
        currency,
        outstanding: {
          total: outstandingTotalBase(rows),
          count: rows.length,
          blocked,
          byClient: outstandingByClient,
          oldest: oldest
            ? {
                projectTitle: oldest.project.title,
                clientName: oldest.client?.name ?? "—",
                daysAged: oldest.daysAged,
                outstandingBase: oldest.outstandingBase,
                outstandingNative: oldest.outstandingNative,
                currency: oldest.project.currency as CurrencyCode,
              }
            : null,
        },
      };
    }

    case "fees": {
      const startYear = new Date(now.getFullYear(), 0, 1);

      const feesYtd = payments
        .filter((p) => new Date(p.paid_at) >= startYear)
        .reduce((s, p) => s + paymentFee(p).fee, 0);

      const monthsBack = 12;
      const feeStart = new Date(now.getFullYear(), now.getMonth() - (monthsBack - 1), 1);
      const feeBuckets = new Map<string, number>();
      const monthOrder: string[] = [];
      for (let i = 0; i < monthsBack; i++) {
        const d = new Date(feeStart.getFullYear(), feeStart.getMonth() + i, 1);
        const k = d.toLocaleString("en", { month: "short" });
        monthOrder.push(k);
        feeBuckets.set(k, 0);
      }
      for (const p of payments) {
        const d = new Date(p.paid_at);
        if (d < feeStart) continue;
        const k = d.toLocaleString("en", { month: "short" });
        if (!feeBuckets.has(k)) continue;
        feeBuckets.set(k, (feeBuckets.get(k) ?? 0) + paymentFee(p).fee);
      }
      const feesOverTime = monthOrder.map((m) => ({
        month: m,
        total: Math.round(feeBuckets.get(m) ?? 0),
      }));

      const leaderboard: MethodLeaderboardRow[] = methodLeaderboard(
        payments,
        stepsByPayment,
        methodsById,
      );

      const highestFee = payments
        .map((p) => {
          const { fee, gross, pct } = paymentFee(p);
          const proj = projectsById.get(p.project_id);
          const client = proj ? clientsById.get(proj.client_id) : undefined;
          return {
            id: p.id,
            fee: Math.round(fee),
            gross: Math.round(gross),
            pct,
            paidAt: p.paid_at,
            projectTitle: proj?.title ?? "—",
            clientName: client?.name ?? "—",
            chain: chainSignature(stepsByPayment.get(p.id) ?? [], methodsById),
          };
        })
        .filter((p) => p.fee > 0)
        .sort((a, b) => b.fee - a.fee)
        .slice(0, 8);

      return {
        key,
        currency,
        fees: {
          mtd: metrics.feesMtd,
          ytd: Math.round(feesYtd),
          overTime: feesOverTime,
          leaderboard,
          highestFee,
        },
      };
    }

    case "avg-days": {
      const perProject = projects
        .filter((p) => p.quoted_at && p.status === "paid")
        .map((p) => {
          const first = payments
            .filter((pay) => pay.project_id === p.id)
            .map((pay) => new Date(pay.paid_at).getTime())
            .sort((a, b) => a - b)[0];
          if (!first) return null;
          const days = Math.max(0, (first - new Date(p.quoted_at!).getTime()) / DAY_MS);
          const client = clientsById.get(p.client_id);
          return {
            projectId: p.id,
            projectTitle: p.title,
            clientId: p.client_id,
            clientName: client?.name ?? "—",
            days: Math.round(days * 10) / 10,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null)
        .sort((a, b) => b.days - a.days);

      const avg = perProject.length
        ? perProject.reduce((s, p) => s + p.days, 0) / perProject.length
        : null;

      const clientLag = new Map<string, { name: string; total: number; count: number }>();
      for (const p of perProject) {
        const e = clientLag.get(p.clientId) ?? { name: p.clientName, total: 0, count: 0 };
        e.total += p.days;
        e.count += 1;
        clientLag.set(p.clientId, e);
      }
      const slowestClients = Array.from(clientLag.values())
        .map((c) => ({
          name: c.name,
          avgDays: Math.round((c.total / c.count) * 10) / 10,
          count: c.count,
        }))
        .sort((a, b) => b.avgDays - a.avgDays)
        .slice(0, 6);

      return {
        key,
        currency,
        avgDays: {
          average: avg !== null ? Math.round(avg * 10) / 10 : null,
          sampleSize: perProject.length,
          perProject,
          slowestClients,
        },
      };
    }

    case "debtor": {
      const byClient = new Map<
        string,
        {
          clientId: string;
          name: string;
          total: number;
          projects: {
            projectId: string;
            projectTitle: string;
            outstandingNative: number;
            currency: CurrencyCode;
            outstandingBase: number;
            daysAged: number;
            flagged: boolean;
          }[];
        }
      >();
      for (const r of rows) {
        const id = r.project.client_id;
        const e =
          byClient.get(id) ??
          { clientId: id, name: r.client?.name ?? "Unknown", total: 0, projects: [] };
        e.total += r.outstandingBase;
        e.projects.push({
          projectId: r.project.id,
          projectTitle: r.project.title,
          outstandingNative: r.outstandingNative,
          currency: r.project.currency as CurrencyCode,
          outstandingBase: Math.round(r.outstandingBase),
          daysAged: r.daysAged,
          flagged: r.project.flagged_overdue,
        });
        byClient.set(id, e);
      }
      const debtors = Array.from(byClient.values())
        .map((d) => ({
          ...d,
          total: Math.round(d.total),
          projects: d.projects.sort((a, b) => b.outstandingBase - a.outstandingBase),
        }))
        .filter((d) => d.total > 0)
        .sort((a, b) => b.total - a.total);

      return { key, currency, debtor: { debtors } };
    }
  }
}

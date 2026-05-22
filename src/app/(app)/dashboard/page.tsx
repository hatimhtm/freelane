import { getDashboardData } from "@/lib/data/queries";
import {
  cashflowMetrics,
  outstanding,
  outstandingTotalBase,
  topClients,
  revenueSeries,
  dailySeries,
} from "@/lib/dashboard-calc";
import { methodLeaderboard, chainSignature, paymentFee, monthlyFeeBase } from "@/lib/payment-chain";
import { hasGemini } from "@/lib/ai/gemini";
import { BASE_CURRENCY_FALLBACK } from "@/lib/constants";
import type { CurrencyCode, PaymentMethod } from "@/lib/supabase/types";
import type { BlockedRow } from "@/components/app/blocked-money-list";
import { DashboardView } from "./_components/dashboard-view";

const DAY_MS = 86_400_000;

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const { settings, projects, payments, rates, clients, methods, stepsByPayment } =
    await getDashboardData();

  const currency = (settings?.base_currency ?? BASE_CURRENCY_FALLBACK) as CurrencyCode;
  const recurringFee = methods.reduce((s, m) => s + monthlyFeeBase(m, rates), 0);

  const metrics = cashflowMetrics(payments, new Date(), recurringFee);
  const rows = outstanding(projects, payments, clients, rates);
  const pendingTotal = outstandingTotalBase(rows);

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

  // Biggest debtor — client with the largest outstanding total.
  const debtById = new Map<string, { name: string; total: number }>();
  for (const r of rows) {
    const name = r.client?.name ?? "Unknown";
    const e = debtById.get(r.project.client_id) ?? { name, total: 0 };
    e.total += r.outstandingBase;
    debtById.set(r.project.client_id, e);
  }
  const biggestDebtor = Array.from(debtById.values()).sort((a, b) => b.total - a.total)[0] ?? null;

  // Avg quote → first payment, paid projects only.
  const lags = projects
    .filter((p) => p.quoted_at && p.status === "paid")
    .map((p) => {
      const first = payments
        .filter((pay) => pay.project_id === p.id)
        .map((pay) => new Date(pay.paid_at).getTime())
        .sort((a, b) => a - b)[0];
      if (!first) return null;
      return Math.max(0, (first - new Date(p.quoted_at!).getTime()) / DAY_MS);
    })
    .filter((n): n is number => n !== null);
  const avgDaysToPayment = lags.length ? lags.reduce((a, b) => a + b, 0) / lags.length : null;

  const methodsById = new Map<string, PaymentMethod>(methods.map((m) => [m.id, m]));
  const leaderboard = methodLeaderboard(payments, stepsByPayment, methodsById, rates);

  // ── Donut: landed income by client (top 5 + "Other") ──
  const clientsTop = topClients(payments, projects, clients, 5);
  const landedTotalAll = payments.reduce((s, p) => s + Number(p.net_amount_base ?? 0), 0);
  const topSum = clientsTop.reduce((s, c) => s + c.value, 0);
  const otherVal = Math.max(0, Math.round(landedTotalAll - topSum));
  const incomeByClient = [
    ...clientsTop.map((c) => ({ name: c.name, value: c.value })),
    ...(otherVal > 0 && clients.length > 5 ? [{ name: "Other", value: otherVal }] : []),
  ];

  // ── Bars: net landed vs fees, last 6 months ──
  const now = new Date();
  const barStart = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const monthKeys: { key: string; date: Date }[] = [];
  for (let i = 0; i < 6; i++) {
    const d = new Date(barStart.getFullYear(), barStart.getMonth() + i, 1);
    monthKeys.push({ key: d.toLocaleString("en", { month: "short" }), date: d });
  }
  const netFeeBuckets = new Map<string, { net: number; fee: number }>(
    monthKeys.map((m) => [m.key, { net: 0, fee: 0 }]),
  );
  for (const p of payments) {
    const d = new Date(p.paid_at);
    if (d < barStart) continue;
    const key = d.toLocaleString("en", { month: "short" });
    const b = netFeeBuckets.get(key);
    if (!b) continue;
    b.net += Number(p.net_amount_base ?? 0);
    b.fee += Number(p.implied_fee_base ?? 0);
  }
  const netVsFee = monthKeys.map((m) => {
    const b = netFeeBuckets.get(m.key)!;
    return { month: m.key, net: Math.round(b.net), fee: Math.round(b.fee) };
  });

  // ── Income by currency (landed gross, YTD) ──
  const startYear = new Date(now.getFullYear(), 0, 1);
  const projectsById = new Map(projects.map((p) => [p.id, p]));
  const currencyBuckets = new Map<string, number>();
  for (const p of payments) {
    if (new Date(p.paid_at) < startYear) continue;
    const proj = projectsById.get(p.project_id);
    const cur = (proj?.currency ?? currency) as string;
    currencyBuckets.set(cur, (currencyBuckets.get(cur) ?? 0) + Number(p.net_amount_base ?? 0));
  }
  const incomeByCurrency = Array.from(currencyBuckets, ([code, value]) => ({
    code,
    value: Math.round(value),
  }))
    .filter((c) => c.value > 0)
    .sort((a, b) => b.value - a.value);

  // ── Fees by method/chain (YTD), top 4 ──
  const feeByChain = new Map<string, number>();
  for (const p of payments) {
    if (new Date(p.paid_at) < startYear) continue;
    const sig = chainSignature(stepsByPayment.get(p.id) ?? [], methodsById);
    const { fee } = paymentFee(p);
    if (fee <= 0) continue;
    feeByChain.set(sig, (feeByChain.get(sig) ?? 0) + fee);
  }
  const feesByMethod = Array.from(feeByChain, ([name, value]) => ({ name, value: Math.round(value) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 4);

  // ── Longest outstanding callout ──
  const longestOutstanding = [...rows].sort((a, b) => b.daysAged - a.daysAged)[0] ?? null;

  const recent = payments.slice(0, 6).map((p) => {
    const project = projects.find((pr) => pr.id === p.project_id);
    const client = project ? clients.find((c) => c.id === project.client_id) : null;
    return {
      id: p.id,
      net: Number(p.net_amount_base ?? 0),
      paidAt: p.paid_at,
      projectTitle: project?.title ?? "—",
      clientName: client?.name ?? "—",
    };
  });

  return (
    <DashboardView
      firstName={settings?.issuer_name?.split(" ")[0] ?? null}
      currency={currency}
      hasClients={clients.length > 0}
      hasProjects={projects.length > 0}
      metrics={metrics}
      pendingTotal={pendingTotal}
      pendingCount={rows.length}
      biggestDebtor={biggestDebtor}
      avgDaysToPayment={avgDaysToPayment}
      blocked={blocked}
      topClients={clientsTop}
      revenue={revenueSeries(payments, 6)}
      series={dailySeries(payments, 30)}
      leaderboard={leaderboard}
      recent={recent}
      incomeByClient={incomeByClient}
      netVsFee={netVsFee}
      incomeByCurrency={incomeByCurrency}
      feesByMethod={feesByMethod}
      feesYtd={feesByMethod.reduce((s, f) => s + f.value, 0)}
      longestOutstanding={
        longestOutstanding
          ? {
              projectTitle: longestOutstanding.project.title,
              clientName: longestOutstanding.client?.name ?? "—",
              daysAged: longestOutstanding.daysAged,
              outstandingBase: longestOutstanding.outstandingBase,
            }
          : null
      }
      year={new Date().getFullYear()}
      aiEnabled={hasGemini()}
    />
  );
}

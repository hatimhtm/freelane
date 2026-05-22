import { getDashboardData } from "@/lib/data/queries";
import {
  cashflowMetrics,
  outstanding,
  outstandingTotalBase,
  topClients,
  dailySeries,
} from "@/lib/dashboard-calc";
import { hasGemini } from "@/lib/ai/gemini";
import { readFocusCache } from "@/lib/ai/actions";
import { BASE_CURRENCY_FALLBACK } from "@/lib/constants";
import type { CurrencyCode } from "@/lib/supabase/types";
import type { BlockedRow } from "@/components/app/blocked-money-list";
import { TodayView } from "./_components/today-view";

const DAY_MS = 86_400_000;

export const metadata = { title: "Today" };

export default async function TodayPage() {
  const aiEnabled = hasGemini();
  const [{ settings, projects, payments, rates, clients, methods }, focus] = await Promise.all([
    getDashboardData(),
    aiEnabled ? readFocusCache() : Promise.resolve({ insights: [], generatedAt: null }),
  ]);

  const currency = (settings?.base_currency ?? BASE_CURRENCY_FALLBACK) as CurrencyCode;
  const recurringFee = methods.reduce((s, m) => s + Number(m.monthly_fee_php ?? 0), 0);

  const metrics = cashflowMetrics(payments, new Date(), recurringFee);
  const rows = outstanding(projects, payments, clients, rates);
  const pendingTotal = outstandingTotalBase(rows);
  const series = dailySeries(payments, 30);

  // Blocked rows — the same shape the dashboard + projects pages consume.
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

  const recent = payments.slice(0, 5).map((p) => {
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

  // One sentence framing the morning — calm, specific.
  const oldest = rows[0] ?? null;
  let situation: string;
  if (clients.length === 0) {
    situation = "No clients yet. Add the first one and Freelane starts keeping score.";
  } else if (oldest) {
    const who = oldest.client?.name ?? "A client";
    const others = rows.length - 1;
    situation =
      `${who} owes the most right now` +
      (oldest.daysAged > 0 ? ` — waiting ${oldest.daysAged} ${oldest.daysAged === 1 ? "day" : "days"}` : "") +
      (others > 0 ? `, with ${others} other ${others === 1 ? "project" : "projects"} still open.` : ".");
  } else {
    situation = "Nothing's waiting on you. Every project is settled.";
  }

  return (
    <TodayView
      firstName={settings?.issuer_name?.split(" ")[0] ?? null}
      currency={currency}
      hasClients={clients.length > 0}
      metrics={metrics}
      series={series}
      pendingTotal={pendingTotal}
      pendingCount={rows.length}
      biggestDebtor={biggestDebtor}
      avgDaysToPayment={avgDaysToPayment}
      blocked={blocked}
      topClients={topClients(payments, projects, clients, 5)}
      recent={recent}
      situation={situation}
      year={new Date().getFullYear()}
      aiEnabled={aiEnabled}
      focusInsights={focus.insights}
      focusGeneratedAt={focus.generatedAt}
    />
  );
}

import { Plus, Sparkles, Users } from "lucide-react";
import { LinkButton } from "@/components/ui/link-button";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { getDashboardData } from "@/lib/data/queries";
import { toBase } from "@/lib/money";
import type { CurrencyCode } from "@/lib/supabase/types";
import { DashboardStats } from "./_components/dashboard-stats";
import { RemindersWidget } from "./_components/reminders-widget";
import { NextStepBanner } from "./_components/next-step-banner";
import { BASE_CURRENCY_FALLBACK } from "@/lib/constants";

const DAY_MS = 86_400_000;

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const { settings, projects, payments, rates, clients, invoices } = await getDashboardData();

  const baseCurrency = (settings?.base_currency ?? BASE_CURRENCY_FALLBACK) as CurrencyCode;
  const today = new Date();
  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const startOfLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const endOfLastMonth = new Date(today.getFullYear(), today.getMonth(), 0, 23, 59, 59);
  const startOfYear = new Date(today.getFullYear(), 0, 1);
  const in30Days = new Date(today.getTime() + 30 * DAY_MS);

  const hasClients = clients.length > 0;
  const hasProjects = projects.length > 0;

  // Totals (computed for everything, safe at zero)
  const paymentsInBase = payments.map((p) => ({
    ...p,
    base: toBase(Number(p.amount), p.currency as CurrencyCode, rates),
  }));

  // Monthly is the hero — that's how freelancers actually think about cashflow.
  const totalEarnedMTD = paymentsInBase
    .filter((p) => new Date(p.paid_at) >= startOfMonth)
    .reduce((s, p) => s + p.base, 0);

  const earnedLastMonth = paymentsInBase
    .filter((p) => {
      const d = new Date(p.paid_at);
      return d >= startOfLastMonth && d <= endOfLastMonth;
    })
    .reduce((s, p) => s + p.base, 0);

  // Null when no comparison baseline (avoids division-by-zero + meaningless "+∞" UI).
  const monthOverMonthDelta = earnedLastMonth > 0
    ? (totalEarnedMTD - earnedLastMonth) / earnedLastMonth
    : null;

  const totalEarnedYTD = paymentsInBase
    .filter((p) => new Date(p.paid_at) >= startOfYear)
    .reduce((s, p) => s + p.base, 0);

  // Average days from quote to first payment, across PAID projects only.
  // (Projects that are still open would skew the average toward "never".)
  const daysToPayment = projects
    .filter((p) => p.quoted_at && p.status === "paid")
    .map((p) => {
      const firstPayment = payments
        .filter((pay) => pay.project_id === p.id)
        .map((pay) => new Date(pay.paid_at).getTime())
        .sort((a, b) => a - b)[0];
      if (!firstPayment) return null;
      const start = new Date(p.quoted_at!).getTime();
      return Math.max(0, (firstPayment - start) / DAY_MS);
    })
    .filter((n): n is number => n !== null);

  const avgDaysToPayment = daysToPayment.length > 0
    ? daysToPayment.reduce((a, b) => a + b, 0) / daysToPayment.length
    : null;

  const outstandingByProject = projects.map((project) => {
    const paid = payments
      .filter((pay) => pay.project_id === project.id && pay.currency === project.currency)
      .reduce((s, p) => s + Number(p.amount), 0);
    const outstanding = Math.max(0, Number(project.amount) - paid);
    return { project, outstanding };
  });
  const outstandingBase = outstandingByProject.reduce(
    (sum, { project, outstanding }) =>
      sum + toBase(outstanding, project.currency as CurrencyCode, rates),
    0,
  );
  const overdueBase = outstandingByProject
    .filter(({ project }) => {
      if (!project.due_date) return false;
      if (project.status === "paid") return false;
      return new Date(project.due_date) < today;
    })
    .reduce(
      (s, { project, outstanding }) =>
        s + toBase(outstanding, project.currency as CurrencyCode, rates),
      0,
    );
  const next30Base = outstandingByProject
    .filter(({ project }) => {
      if (!project.due_date) return false;
      if (project.status === "paid") return false;
      const d = new Date(project.due_date);
      return d >= today && d <= in30Days;
    })
    .reduce(
      (s, { project, outstanding }) =>
        s + toBase(outstanding, project.currency as CurrencyCode, rates),
      0,
    );

  const monthlyRevenue = (() => {
    const buckets = new Map<string, number>();
    const start = new Date(today.getFullYear(), today.getMonth() - 5, 1);
    for (let i = 0; i < 6; i++) {
      const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
      buckets.set(d.toLocaleString("en", { month: "short" }), 0);
    }
    paymentsInBase.forEach((p) => {
      const d = new Date(p.paid_at);
      if (d < start) return;
      const key = d.toLocaleString("en", { month: "short" });
      buckets.set(key, (buckets.get(key) ?? 0) + p.base);
    });
    return Array.from(buckets, ([month, total]) => ({ month, total: Math.round(total) }));
  })();

  const clientDistribution = (() => {
    const map = new Map<string, { name: string; value: number }>();
    paymentsInBase.forEach((p) => {
      const project = projects.find((pr) => pr.id === p.project_id);
      if (!project) return;
      const client = clients.find((c) => c.id === project.client_id);
      const name = client?.name ?? "Unknown";
      const entry = map.get(project.client_id) ?? { name, value: 0 };
      entry.value += p.base;
      map.set(project.client_id, entry);
    });
    return Array.from(map.values())
      .sort((a, b) => b.value - a.value)
      .slice(0, 5)
      .map((x) => ({ ...x, value: Math.round(x.value) }));
  })();

  // Biggest debtor — the single client with the largest outstanding total
  // across all their unpaid projects. Most actionable view for chasing money.
  const biggestDebtor = (() => {
    const byClient = new Map<string, { name: string; outstanding: number }>();
    outstandingByProject.forEach(({ project, outstanding }) => {
      if (project.status === "paid" || outstanding <= 0) return;
      const client = clients.find((c) => c.id === project.client_id);
      const name = client?.name ?? "Unknown";
      const inBase = toBase(outstanding, project.currency as CurrencyCode, rates);
      const entry = byClient.get(project.client_id) ?? { name, outstanding: 0 };
      entry.outstanding += inBase;
      byClient.set(project.client_id, entry);
    });
    return Array.from(byClient.values()).sort((a, b) => b.outstanding - a.outstanding)[0] ?? null;
  })();

  const recentPayments = payments.slice(0, 6).map((p) => {
    const project = projects.find((pr) => pr.id === p.project_id);
    const client = project ? clients.find((c) => c.id === project.client_id) : null;
    return {
      id: p.id,
      amount: Number(p.amount),
      currency: p.currency as CurrencyCode,
      paid_at: p.paid_at,
      project_title: project?.title ?? "—",
      client_name: client?.name ?? "—",
    };
  });

  const firstName = settings?.issuer_name?.split(" ")[0];

  const reminderDays = settings?.invoice_reminder_days ?? 7;
  const reminders = invoices
    .filter((inv) => inv.status === "issued" || inv.status === "sent")
    .map((inv) => {
      const baseline = inv.last_reminded_at ?? inv.issue_date;
      const ageDays = Math.floor((today.getTime() - new Date(baseline).getTime()) / DAY_MS);
      return { invoice: inv, client: clients.find((c) => c.id === inv.client_id), ageDays };
    })
    .filter((r) => r.ageDays >= reminderDays)
    .sort((a, b) => b.ageDays - a.ageDays);

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-10">
      <PageHeader
        title={firstName ? `Welcome back, ${firstName}.` : "Dashboard"}
        description="Your ledger at a glance."
        actions={
          <div className="flex items-center gap-2">
            {hasProjects && (
              <LinkButton href={`/year/${today.getFullYear()}`} variant="ghost">
                <Sparkles className="mr-1.5 h-4 w-4 text-[var(--chart-3)]" />
                {today.getFullYear()} in review
              </LinkButton>
            )}
            {hasClients ? (
              <LinkButton href="/projects?new=1">
                <Plus className="mr-1.5 h-4 w-4" />
                New project
              </LinkButton>
            ) : (
              <LinkButton href="/clients?new=1">
                <Plus className="mr-1.5 h-4 w-4" />
                Add client
              </LinkButton>
            )}
          </div>
        }
      />

      {!hasClients ? (
        <div className="mt-8">
          <EmptyState
            icon={Users}
            title="Start by adding your first client"
            description="Once you add a client and a project, Freelane will track payments, compute totals, and keep your invoices in sync."
            action={
              <div className="flex gap-2">
                <LinkButton href="/clients?new=1">Add a client</LinkButton>
                <LinkButton href="/settings" variant="outline">
                  Set up profile
                </LinkButton>
              </div>
            }
          />
        </div>
      ) : (
        <>
          {!hasProjects && (
            <div className="mt-6">
              <NextStepBanner
                title="Create your first project"
                description="Projects hold the amount and the work. Once one exists, your dashboard starts filling in."
                href="/projects?new=1"
                cta="New project"
              />
            </div>
          )}

          {reminders.length > 0 && (
            <div className="mt-6">
              <RemindersWidget items={reminders} />
            </div>
          )}

          <div className="mt-6">
            <DashboardStats
              baseCurrency={baseCurrency}
              totalEarnedMTD={totalEarnedMTD}
              earnedLastMonth={earnedLastMonth}
              monthOverMonthDelta={monthOverMonthDelta}
              totalEarnedYTD={totalEarnedYTD}
              outstanding={outstandingBase}
              overdue={overdueBase}
              next30={next30Base}
              avgDaysToPayment={avgDaysToPayment}
              biggestDebtor={biggestDebtor}
              monthlyRevenue={monthlyRevenue}
              clientDistribution={clientDistribution}
              recentPayments={recentPayments}
            />
          </div>
        </>
      )}
    </div>
  );
}

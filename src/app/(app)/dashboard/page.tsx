import { Plus, Users } from "lucide-react";
import { LinkButton } from "@/components/ui/link-button";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { getDashboardData } from "@/lib/data/queries";
import { toBase } from "@/lib/money";
import type { CurrencyCode } from "@/lib/supabase/types";
import { DashboardStats } from "./_components/dashboard-stats";
import { BASE_CURRENCY_FALLBACK } from "@/lib/constants";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const { settings, projects, payments, rates, clients } = await getDashboardData();

  const baseCurrency = (settings?.base_currency ?? BASE_CURRENCY_FALLBACK) as CurrencyCode;
  const today = new Date();
  const startOfYear = new Date(today.getFullYear(), 0, 1);
  const in30Days = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);

  const paymentsInBase = payments.map((p) => ({
    ...p,
    base: toBase(Number(p.amount), p.currency as CurrencyCode, rates),
  }));

  const totalEarnedYTD = paymentsInBase
    .filter((p) => new Date(p.paid_at) >= startOfYear)
    .reduce((s, p) => s + p.base, 0);

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
      (sum, { project, outstanding }) =>
        sum + toBase(outstanding, project.currency as CurrencyCode, rates),
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
      (sum, { project, outstanding }) =>
        sum + toBase(outstanding, project.currency as CurrencyCode, rates),
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

  const recentPayments = payments
    .slice(0, 6)
    .map((p) => {
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

  const noData = projects.length === 0 && payments.length === 0;

  const firstName = settings?.issuer_name?.split(" ")[0];

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-10">
      <PageHeader
        title={firstName ? `Welcome back, ${firstName}.` : "Dashboard"}
        description="Your ledger at a glance."
        actions={
          <LinkButton href="/projects?new=1">
            <Plus className="mr-1.5 h-4 w-4" />
            New project
          </LinkButton>
        }
      />

      <div className="mt-8">
        {noData ? (
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
        ) : (
          <DashboardStats
            baseCurrency={baseCurrency}
            totalEarnedYTD={totalEarnedYTD}
            outstanding={outstandingBase}
            overdue={overdueBase}
            next30={next30Base}
            monthlyRevenue={monthlyRevenue}
            clientDistribution={clientDistribution}
            recentPayments={recentPayments}
          />
        )}
      </div>
    </div>
  );
}

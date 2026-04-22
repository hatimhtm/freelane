import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { toBase } from "@/lib/money";
import type {
  Client,
  CurrencyCode,
  ExchangeRate,
  Payment,
  Project,
  Settings,
} from "@/lib/supabase/types";
import { BASE_CURRENCY_FALLBACK } from "@/lib/constants";
import { YearInReview } from "../_components/year-in-review";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ year: string }>;
}) {
  const { year } = await params;
  return { title: `${year} in review` };
}

export default async function YearPage({
  params,
}: {
  params: Promise<{ year: string }>;
}) {
  const { year: rawYear } = await params;
  const year = Number(rawYear);
  const now = new Date();
  const currentYear = now.getFullYear();

  const user = await getAuthUser();
  const supabase = await createClient();

  const [settings, rates, payments, projects, clients] = await Promise.all([
    supabase.from("settings").select("*").eq("user_id", user!.id).maybeSingle(),
    supabase.from("exchange_rates").select("*").eq("user_id", user!.id),
    supabase.from("payments").select("*").eq("user_id", user!.id),
    supabase.from("projects").select("*").eq("user_id", user!.id),
    supabase.from("clients").select("*").eq("user_id", user!.id),
  ]);

  const base = (settings.data as Settings | null)?.base_currency ?? BASE_CURRENCY_FALLBACK;
  const rs = (rates.data ?? []) as ExchangeRate[];
  const ps = (payments.data ?? []) as Payment[];
  const prs = (projects.data ?? []) as Project[];
  const cs = (clients.data ?? []) as Client[];

  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year + 1, 0, 1);
  const prevStart = new Date(year - 1, 0, 1);
  const prevEnd = yearStart;

  const paymentsInYear = ps.filter((p) => {
    const d = new Date(p.paid_at);
    return d >= yearStart && d < yearEnd;
  });

  const paymentsPrev = ps.filter((p) => {
    const d = new Date(p.paid_at);
    return d >= prevStart && d < prevEnd;
  });

  const totalBase = paymentsInYear.reduce(
    (s, p) => s + toBase(Number(p.amount), p.currency as CurrencyCode, rs),
    0,
  );
  const totalPrev = paymentsPrev.reduce(
    (s, p) => s + toBase(Number(p.amount), p.currency as CurrencyCode, rs),
    0,
  );

  const projectsCompleted = prs.filter((p) => {
    if (p.status !== "paid" && p.status !== "archived") return false;
    if (!p.completed_at) {
      const u = new Date(p.updated_at);
      return u >= yearStart && u < yearEnd;
    }
    const d = new Date(p.completed_at);
    return d >= yearStart && d < yearEnd;
  }).length;

  const clientCount = new Set(
    paymentsInYear.map((p) => prs.find((pr) => pr.id === p.project_id)?.client_id).filter(Boolean),
  ).size;

  // Month totals
  const monthlyTotals = Array.from({ length: 12 }, (_, i) => {
    const monthStart = new Date(year, i, 1);
    const monthEnd = new Date(year, i + 1, 1);
    const total = paymentsInYear
      .filter((p) => {
        const d = new Date(p.paid_at);
        return d >= monthStart && d < monthEnd;
      })
      .reduce((s, p) => s + toBase(Number(p.amount), p.currency as CurrencyCode, rs), 0);
    return {
      month: monthStart.toLocaleString("en", { month: "short" }),
      total: Math.round(total),
    };
  });

  const busiestMonth = monthlyTotals.reduce(
    (max, m) => (m.total > max.total ? m : max),
    { month: "—", total: 0 },
  );

  // Top clients
  const clientTotals = new Map<string, number>();
  paymentsInYear.forEach((p) => {
    const project = prs.find((pr) => pr.id === p.project_id);
    if (!project) return;
    const base_amount = toBase(Number(p.amount), p.currency as CurrencyCode, rs);
    clientTotals.set(
      project.client_id,
      (clientTotals.get(project.client_id) ?? 0) + base_amount,
    );
  });
  const topClients = Array.from(clientTotals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([clientId, total]) => ({
      name: cs.find((c) => c.id === clientId)?.name ?? "—",
      total: Math.round(total),
    }));

  // Biggest single project (by total amount)
  const biggestProject = prs
    .filter((p) => {
      const d = new Date(p.updated_at);
      return d >= yearStart && d < yearEnd;
    })
    .sort((a, b) => Number(b.amount) - Number(a.amount))[0];
  const biggestProjectClient = biggestProject
    ? cs.find((c) => c.id === biggestProject.client_id)
    : null;

  const growthPct = totalPrev > 0 ? ((totalBase - totalPrev) / totalPrev) * 100 : null;

  return (
    <div className="mx-auto max-w-5xl p-6 lg:p-10">
      <div className="mb-10 flex items-center justify-between">
        <Link
          href={`/year/${year - 1}`}
          className="inline-flex h-9 items-center gap-1 rounded-lg border border-border/60 px-2.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          {year - 1}
        </Link>
        <div className="text-center">
          <div className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Year in review
          </div>
          <div className="mt-1 bg-gradient-to-br from-[#9d6bff] via-[var(--foreground)] to-[#5b9dff] bg-clip-text text-[56px] font-semibold leading-none tracking-tight text-transparent sm:text-[72px]">
            {year}
          </div>
        </div>
        {year < currentYear ? (
          <Link
            href={`/year/${year + 1}`}
            className="inline-flex h-9 items-center gap-1 rounded-lg border border-border/60 px-2.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {year + 1}
            <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        ) : (
          <span className="h-9 w-16" />
        )}
      </div>

      <YearInReview
        year={year}
        baseCurrency={base as CurrencyCode}
        totalEarned={totalBase}
        totalPrev={totalPrev}
        growthPct={growthPct}
        projectsCompleted={projectsCompleted}
        clientCount={clientCount}
        monthlyTotals={monthlyTotals}
        busiestMonth={busiestMonth}
        topClients={topClients}
        biggestProject={
          biggestProject
            ? {
                title: biggestProject.title,
                amount: Number(biggestProject.amount),
                currency: biggestProject.currency as CurrencyCode,
                client: biggestProjectClient?.name ?? "—",
              }
            : null
        }
      />
    </div>
  );
}

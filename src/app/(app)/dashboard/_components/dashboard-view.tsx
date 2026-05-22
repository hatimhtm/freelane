"use client";

import Link from "next/link";
import { ArrowUpRight, CalendarRange, Hourglass, Plus, Receipt, UserX, Users } from "lucide-react";
import { motion } from "motion/react";
import { Card } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/link-button";
import { EmptyState } from "@/components/app/empty-state";
import { MastheadStat, MetricTile, DeltaChip } from "@/components/stats/stat";
import { RevenueChart } from "@/components/stats/revenue-chart";
import { BlockedMoneyList, type BlockedRow } from "@/components/app/blocked-money-list";
import { MethodLeaderboard } from "@/components/app/method-leaderboard";
import { AiPanel } from "@/components/app/ai-panel";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { CurrencyCode } from "@/lib/supabase/types";
import type { MethodLeaderboardRow } from "@/lib/payment-chain";

type Metrics = {
  mtd: number; lastMonth: number; momDelta: number | null;
  wtd: number; lastWeek: number; wowDelta: number | null;
  ytd: number; feesMtd: number;
};

export function DashboardView({
  firstName,
  currency,
  hasClients,
  hasProjects,
  metrics,
  pendingTotal,
  pendingCount,
  biggestDebtor,
  avgDaysToPayment,
  blocked,
  topClients,
  revenue,
  series,
  leaderboard,
  recent,
  year,
  aiEnabled,
}: {
  firstName: string | null;
  currency: CurrencyCode;
  hasClients: boolean;
  hasProjects: boolean;
  metrics: Metrics;
  pendingTotal: number;
  pendingCount: number;
  biggestDebtor: { name: string; total: number } | null;
  avgDaysToPayment: number | null;
  blocked: BlockedRow[];
  topClients: { name: string; value: number }[];
  revenue: { month: string; total: number }[];
  series: number[];
  leaderboard: MethodLeaderboardRow[];
  recent: { id: string; net: number; paidAt: string; projectTitle: string; clientName: string }[];
  year: number;
  aiEnabled: boolean;
}) {
  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8 lg:px-10 lg:py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display-headline text-3xl md:text-4xl">
            {firstName ? `Hey, ${firstName}.` : "Dashboard"}
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">This month so far.</p>
        </div>
        <div className="flex items-center gap-2">
          <LinkButton href={`/year/${year}`} variant="ghost">
            <CalendarRange className="mr-1.5 h-4 w-4" />
            {year} in review
          </LinkButton>
          <LinkButton href={hasClients ? "/payments?new=1" : "/clients?new=1"}>
            <Plus className="mr-1.5 h-4 w-4" />
            {hasClients ? "Log payment" : "Add client"}
          </LinkButton>
        </div>
      </div>

      {!hasClients ? (
        <div className="mt-10">
          <EmptyState
            icon={Users}
            title="No clients yet."
            description="Add a client and a project. Payments show up here once they land."
            action={<LinkButton href="/clients?new=1">Add a client</LinkButton>}
          />
        </div>
      ) : (
        <div className="mt-10 space-y-10">
          {/* Hero: masthead + pending panel */}
          <section className="grid items-end gap-8 lg:grid-cols-[1.5fr_1fr]">
            <MastheadStat
              eyebrow="Landed this month"
              value={metrics.mtd}
              currency={currency}
              delta={metrics.momDelta}
              series={series}
              support={
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span>
                    <span className="font-medium text-foreground">{formatMoney(metrics.wtd, currency, { compact: true })}</span> this week
                  </span>
                  {metrics.wowDelta !== null && <DeltaChip delta={metrics.wowDelta} suffix="WoW" />}
                  <span className="text-muted-foreground/40">·</span>
                  <span>
                    <span className="font-medium text-foreground">{formatMoney(metrics.ytd, currency, { compact: true })}</span> in {year}
                  </span>
                </span>
              }
            />
            <PendingPanel total={pendingTotal} count={pendingCount} currency={currency} />
          </section>

          {/* Metric tiles */}
          <section className="grid gap-4 sm:grid-cols-3">
            <MetricTile
              label="Fees this month"
              value={metrics.feesMtd}
              currency={currency}
              icon={Receipt}
              hint="rails + FX markup"
              delay={0.02}
            />
            <MetricTile
              label="Avg days to payment"
              text={avgDaysToPayment !== null ? `${avgDaysToPayment.toFixed(1)} days` : "—"}
              icon={Hourglass}
              hint={avgDaysToPayment !== null ? "quote → first payment" : "no paid projects yet"}
              delay={0.06}
            />
            <MetricTile
              label="Biggest debtor"
              text={biggestDebtor?.name ?? "—"}
              icon={UserX}
              hint={biggestDebtor ? `${formatMoney(biggestDebtor.total, currency, { compact: true })} outstanding` : "nobody owes you"}
              delay={0.1}
            />
          </section>

          {/* Ask your money */}
          {aiEnabled && <AiPanel enabled={aiEnabled} />}

          {/* Revenue + top clients */}
          <section className="grid gap-4 lg:grid-cols-3">
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }} className="lg:col-span-2">
              <Card className="overflow-hidden p-6">
                <div className="text-sm font-medium">Revenue</div>
                <div className="text-xs text-muted-foreground">Last 6 months · landed {currency}</div>
                <div className="mt-4">
                  <RevenueChart data={revenue} currency={currency} />
                </div>
              </Card>
            </motion.div>
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.06, ease: [0.16, 1, 0.3, 1] }}>
              <Card className="h-full p-6">
                <div className="text-sm font-medium">Top clients</div>
                <div className="text-xs text-muted-foreground">{`By landed ${currency}`}</div>
                <TopClients data={topClients} currency={currency} />
              </Card>
            </motion.div>
          </section>

          {/* Blocked money + leaderboard */}
          {hasProjects && (
            <section className="grid gap-6 lg:grid-cols-2">
              <div>
                <SectionHead title="Blocked money" hint="Ranked by amount × days waiting" href="/projects" cta="See all" />
                <BlockedMoneyList rows={blocked} baseCurrency={currency} limit={5} />
              </div>
              <div>
                <SectionHead title="Cheapest ways to get paid" hint="Effective fee by chain" href="/payments" cta="Payments" />
                <MethodLeaderboard rows={leaderboard} baseCurrency={currency} limit={4} />
              </div>
            </section>
          )}

          {/* Recent payments */}
          <section>
            <SectionHead title="Recent payments" hint={`Last ${recent.length} landed`} />
            <Card className="overflow-hidden p-0">
              {recent.length === 0 ? (
                <div className="px-5 py-8 text-center text-sm text-muted-foreground">No payments logged yet.</div>
              ) : (
                <ul>
                  {recent.map((p, i) => (
                    <li key={p.id} className={cn("flex items-center justify-between px-5 py-3.5", i < recent.length - 1 && "border-b border-border/50")}>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{p.projectTitle}</div>
                        <div className="truncate text-xs text-muted-foreground">{p.clientName} · {new Date(p.paidAt).toLocaleDateString()}</div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1 text-sm font-semibold tabular">
                        <ArrowUpRight className="h-3.5 w-3.5 text-[var(--success)]" />
                        {formatMoney(p.net, currency)}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </section>
        </div>
      )}
    </div>
  );
}

function PendingPanel({ total, count, currency }: { total: number; count: number; currency: CurrencyCode }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.6, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
    >
      <Card className="border-border/70 p-6">
        <div className="display-eyebrow flex items-center gap-2 text-muted-foreground">
          <span className="size-1.5 rounded-full bg-[var(--overdue)] animate-breathe" />
          Outstanding
        </div>
        <div className="display-numeric mt-3 text-4xl tabular">
          {formatMoney(total, currency, { compact: true })}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Across {count} open {count === 1 ? "project" : "projects"}, valued at today&apos;s rates — moves with FX until paid.
        </p>
        <Link href="/projects" className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-foreground hover:underline">
          View outstanding <ArrowUpRight className="size-3" />
        </Link>
      </Card>
    </motion.div>
  );
}

function TopClients({ data, currency }: { data: { name: string; value: number }[]; currency: CurrencyCode }) {
  if (data.length === 0) {
    return <div className="mt-8 text-center text-sm text-muted-foreground">No payments yet.</div>;
  }
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <ol className="mt-4 space-y-3">
      {data.map((c, i) => (
        <li key={c.name}>
          <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
            <span className="flex items-center gap-2">
              <span className="inline-flex size-5 items-center justify-center rounded-full bg-muted font-mono text-[10px] text-muted-foreground">{i + 1}</span>
              <span className="truncate font-medium">{c.name}</span>
            </span>
            <span className="shrink-0 tabular text-muted-foreground">{formatMoney(c.value, currency, { compact: true })}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${(c.value / max) * 100}%` }}
              transition={{ duration: 0.8, delay: 0.3 + i * 0.08, ease: [0.16, 1, 0.3, 1] }}
              className="h-full rounded-full bg-[var(--chart-1)]"
            />
          </div>
        </li>
      ))}
    </ol>
  );
}

function SectionHead({ title, hint, href, cta }: { title: string; hint: string; href?: string; cta?: string }) {
  return (
    <div className="mb-3 flex items-end justify-between">
      <div>
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs text-muted-foreground">{hint}</div>
      </div>
      {href && cta && (
        <Link href={href} className="text-xs font-medium text-muted-foreground hover:text-foreground">
          {cta} →
        </Link>
      )}
    </div>
  );
}

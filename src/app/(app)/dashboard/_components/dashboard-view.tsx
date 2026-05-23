"use client";

import Link from "next/link";
import { AlarmClock, ArrowDownToLine, ArrowUpRight, CalendarRange, Hourglass, Plus, Receipt, TrendingDown, UserX, Users, Wallet } from "lucide-react";
import { motion } from "motion/react";
import { Card } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/link-button";
import { EmptyState } from "@/components/app/empty-state";
import { MastheadStat, MetricTile, DeltaChip } from "@/components/stats/stat";
import { TrendAreaChart } from "@/components/stats/trend-area-chart";
import { DonutChart } from "@/components/stats/donut-chart";
import { BarsChart } from "@/components/stats/bars-chart";
import { BlockedMoneyList, type BlockedRow } from "@/components/app/blocked-money-list";
import { MethodLeaderboard } from "@/components/app/method-leaderboard";
import { AiPanel } from "@/components/app/ai-panel";
import { MetricTrigger } from "@/components/app/metric-sheet";
import type { MetricKey } from "@/lib/metric-data";
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
  incomeByClient,
  netVsFee,
  incomeByCurrency,
  feesByMethod,
  feesYtd,
  holdings,
  longestOutstanding,
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
  incomeByClient: { name: string; value: number }[];
  netVsFee: { month: string; net: number; fee: number }[];
  incomeByCurrency: { code: string; value: number }[];
  feesByMethod: { name: string; value: number }[];
  feesYtd: number;
  holdings: { name: string; balance: number; received: number; withdrawn: number }[];
  longestOutstanding: { projectTitle: string; clientName: string; daysAged: number; outstandingBase: number } | null;
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
            <MetricTrigger metricKey="landed" className="lift -m-2 rounded-xl p-2">
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
            </MetricTrigger>
            <PendingPanel total={pendingTotal} count={pendingCount} currency={currency} />
          </section>

          {/* This month vs last comparison strip */}
          <ComparisonStrip metrics={metrics} feesYtd={feesYtd} currency={currency} />

          {/* Metric tiles */}
          <section className="grid gap-4 sm:grid-cols-3">
            <MetricTrigger metricKey="fees" className="h-full">
              <MetricTile
                label="Fees this month"
                value={metrics.feesMtd}
                currency={currency}
                icon={Receipt}
                hint="rails + FX markup"
                delay={0.02}
              />
            </MetricTrigger>
            <MetricTrigger metricKey="avg-days" className="h-full">
              <MetricTile
                label="Avg days to payment"
                text={avgDaysToPayment !== null ? `${avgDaysToPayment.toFixed(1)} days` : "—"}
                icon={Hourglass}
                hint={avgDaysToPayment !== null ? "quote → first payment" : "no paid projects yet"}
                delay={0.06}
              />
            </MetricTrigger>
            <MetricTrigger metricKey="debtor" className="h-full">
              <MetricTile
                label="Biggest debtor"
                text={biggestDebtor?.name ?? "—"}
                icon={UserX}
                hint={biggestDebtor ? `${formatMoney(biggestDebtor.total, currency, { compact: true })} outstanding` : "nobody owes you"}
                delay={0.1}
              />
            </MetricTrigger>
          </section>

          {/* Held in wallets — money parked in coin.ph / Cash vs. withdrawn */}
          {holdings.length > 0 && <HeldInWallets holdings={holdings} currency={currency} />}

          {/* Ask your money */}
          {aiEnabled && <AiPanel enabled={aiEnabled} />}

          {/* Revenue + top clients */}
          <section className="grid gap-4 lg:grid-cols-3">
            <ChartCard className="lg:col-span-2" metricKey="landed" title="Revenue" subtitle={`Last 6 months · landed ${currency}`}>
              <TrendAreaChart data={revenue} currency={currency} />
            </ChartCard>
            <ChartCard delay={0.06} metricKey="debtor" title="Top clients" subtitle={`By landed ${currency}`}>
              <TopClients data={topClients} currency={currency} />
            </ChartCard>
          </section>

          {/* Donut + net vs fee bars */}
          <section className="grid gap-4 lg:grid-cols-2">
            <ChartCard metricKey="landed" title="Income by client" subtitle="Top 5 + other · landed">
              <div className="mt-4">
                <DonutChart data={incomeByClient} currency={currency} />
              </div>
            </ChartCard>
            <ChartCard delay={0.06} metricKey="fees" title="Net vs fees" subtitle="Last 6 months · what you keep vs lose">
              <div className="mt-4">
                <BarsChart
                  data={netVsFee}
                  series={[
                    { key: "net", label: "Net", color: "var(--chart-1)" },
                    { key: "fee", label: "Fees", color: "var(--chart-4)" },
                  ]}
                  currency={currency}
                />
              </div>
            </ChartCard>
          </section>

          {/* Income by currency + fees by method + longest outstanding */}
          <section className="grid gap-4 lg:grid-cols-3">
            <ChartCard metricKey="landed" title="Income by currency" subtitle={`${year} · landed ${currency}`}>
              <CurrencyBreakdown data={incomeByCurrency} currency={currency} />
            </ChartCard>
            <ChartCard delay={0.05} metricKey="fees" title="Where fees went" subtitle={`${year} · by payment chain`}>
              <FeesByMethod data={feesByMethod} total={feesYtd} currency={currency} />
            </ChartCard>
            <ChartCard delay={0.1} metricKey="outstanding" title="Longest outstanding" subtitle="Oldest open balance">
              <LongestOutstanding row={longestOutstanding} currency={currency} />
            </ChartCard>
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
      <MetricTrigger metricKey="outstanding" className="lift rounded-xl">
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
          <span className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-foreground">
            View outstanding <ArrowUpRight className="size-3" />
          </span>
        </Card>
      </MetricTrigger>
    </motion.div>
  );
}

function HeldInWallets({
  holdings,
  currency,
}: {
  holdings: { name: string; balance: number; received: number; withdrawn: number }[];
  currency: CurrencyCode;
}) {
  const totalParked = holdings.reduce((s, h) => s + h.balance, 0);
  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: EASE }}
    >
      <div className="mb-3 flex items-end justify-between">
        <div>
          <div className="text-sm font-medium">Held in wallets</div>
          <div className="text-xs text-muted-foreground">
            {formatMoney(totalParked, currency, { compact: true })} parked, waiting to be withdrawn
          </div>
        </div>
        <LinkButton href="/payments?withdraw=1" variant="ghost" size="sm">
          <ArrowDownToLine className="mr-1.5 h-3.5 w-3.5" /> Log withdrawal
        </LinkButton>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {holdings.map((h, i) => (
          <motion.div
            key={h.name}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: i * 0.05, ease: EASE }}
          >
            <Card className="p-5">
              <div className="flex items-center gap-2">
                <Wallet className="size-4 text-[var(--chart-1)]" />
                <span className="text-sm font-medium">{h.name}</span>
              </div>
              <div className="mt-3 display-numeric text-3xl tabular">{formatMoney(h.balance, currency, { compact: true })}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">parked now</div>
              <div className="mt-3 flex items-center justify-between border-t border-border/50 pt-2 text-[11px] text-muted-foreground tabular">
                <span>received {formatMoney(h.received, currency, { compact: true })}</span>
                <span>withdrawn {formatMoney(h.withdrawn, currency, { compact: true })}</span>
              </div>
            </Card>
          </motion.div>
        ))}
      </div>
    </motion.section>
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

const EASE = [0.16, 1, 0.3, 1] as const;

function ChartCard({
  title,
  subtitle,
  children,
  className,
  delay = 0,
  metricKey,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  className?: string;
  delay?: number;
  metricKey?: MetricKey;
}) {
  const card = (
    <Card className="h-full overflow-hidden p-6">
      <div className="text-sm font-medium">{title}</div>
      <div className="text-xs text-muted-foreground">{subtitle}</div>
      {children}
    </Card>
  );
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: EASE }}
      className={className}
    >
      {metricKey ? (
        <MetricTrigger metricKey={metricKey} className="h-full lift rounded-xl">
          {card}
        </MetricTrigger>
      ) : (
        card
      )}
    </motion.div>
  );
}

function ComparisonStrip({
  metrics,
  feesYtd,
  currency,
}: {
  metrics: Metrics;
  feesYtd: number;
  currency: CurrencyCode;
}) {
  const items: { label: string; now: number; prev: number; delta: number | null; prevLabel: string }[] = [
    { label: "This month", now: metrics.mtd, prev: metrics.lastMonth, delta: metrics.momDelta, prevLabel: "last month" },
    { label: "This week", now: metrics.wtd, prev: metrics.lastWeek, delta: metrics.wowDelta, prevLabel: "last week" },
  ];
  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: EASE }}
      className="grid gap-4 sm:grid-cols-3"
    >
      {items.map((it) => (
        <MetricTrigger key={it.label} metricKey="landed" className="lift rounded-xl border border-border/70 bg-card p-5">
          <div className="display-eyebrow text-muted-foreground">{it.label}</div>
          <div className="mt-2 text-[22px] font-semibold tracking-tight tabular">
            {formatMoney(it.now, currency, { compact: true })}
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            {it.delta !== null ? <DeltaChip delta={it.delta} suffix={`vs ${it.prevLabel}`} /> : <span>no prior data</span>}
          </div>
          <div className="mt-1 text-xs text-muted-foreground tabular">
            {formatMoney(it.prev, currency, { compact: true })} {it.prevLabel}
          </div>
        </MetricTrigger>
      ))}
      <MetricTrigger metricKey="fees" className="lift rounded-xl border border-border/70 bg-card p-5">
        <div className="display-eyebrow flex items-center gap-1.5 text-muted-foreground">
          <TrendingDown className="size-3.5" /> Fees this year
        </div>
        <div className="mt-2 text-[22px] font-semibold tracking-tight tabular">
          {formatMoney(feesYtd, currency, { compact: true })}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">total rails + FX lost to date</div>
        <span className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-foreground">
          Trim your fees <ArrowUpRight className="size-3" />
        </span>
      </MetricTrigger>
    </motion.section>
  );
}

function CurrencyBreakdown({ data, currency }: { data: { code: string; value: number }[]; currency: CurrencyCode }) {
  if (data.length === 0) {
    return <div className="mt-8 text-center text-sm text-muted-foreground">No income yet this year.</div>;
  }
  const max = Math.max(...data.map((d) => d.value), 1);
  const palette = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];
  return (
    <ol className="mt-4 space-y-3">
      {data.map((c, i) => (
        <li key={c.code}>
          <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
            <span className="font-medium">{c.code}</span>
            <span className="shrink-0 tabular text-muted-foreground">{formatMoney(c.value, currency, { compact: true })}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${(c.value / max) * 100}%` }}
              transition={{ duration: 0.8, delay: 0.2 + i * 0.08, ease: EASE }}
              className="h-full rounded-full"
              style={{ background: palette[i % palette.length] }}
            />
          </div>
        </li>
      ))}
    </ol>
  );
}

function FeesByMethod({ data, total, currency }: { data: { name: string; value: number }[]; total: number; currency: CurrencyCode }) {
  if (data.length === 0) {
    return <div className="mt-8 text-center text-sm text-muted-foreground">No fees recorded this year.</div>;
  }
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <ol className="mt-4 space-y-3">
      {data.map((c, i) => (
        <li key={c.name}>
          <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
            <span className="min-w-0 truncate font-medium">{c.name}</span>
            <span className="shrink-0 tabular text-muted-foreground">
              {formatMoney(c.value, currency, { compact: true })}
              {total > 0 && <span className="ml-1 text-[11px]">· {((c.value / total) * 100).toFixed(0)}%</span>}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${(c.value / max) * 100}%` }}
              transition={{ duration: 0.8, delay: 0.2 + i * 0.08, ease: EASE }}
              className="h-full rounded-full bg-[var(--chart-4)]"
            />
          </div>
        </li>
      ))}
    </ol>
  );
}

function LongestOutstanding({
  row,
  currency,
}: {
  row: { projectTitle: string; clientName: string; daysAged: number; outstandingBase: number } | null;
  currency: CurrencyCode;
}) {
  if (!row) {
    return <div className="mt-8 text-center text-sm text-muted-foreground">Nothing outstanding. Clean slate.</div>;
  }
  return (
    <div className="mt-4">
      <div className="flex items-center gap-2 text-[var(--overdue)]">
        <AlarmClock className="size-4" />
        <span className="display-numeric tabular text-2xl">{row.daysAged}d</span>
        <span className="text-xs text-muted-foreground">waiting</span>
      </div>
      <div className="mt-3 truncate text-sm font-medium">{row.projectTitle}</div>
      <div className="truncate text-xs text-muted-foreground">{row.clientName}</div>
      <div className="mt-2 text-sm font-semibold tabular">
        {formatMoney(row.outstandingBase, currency, { compact: true })} <span className="text-xs font-normal text-muted-foreground">owed</span>
      </div>
    </div>
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

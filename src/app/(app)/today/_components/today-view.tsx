"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, CalendarRange, Hourglass, Receipt, Sparkles, UserX } from "lucide-react";
import { motion } from "motion/react";
import { Card } from "@/components/ui/card";
import { MastheadStat, MetricTile, DeltaChip } from "@/components/stats/stat";
import { AiPanel } from "@/components/app/ai-panel";
import { MetricTrigger } from "@/components/app/metric-sheet";
import { TodaysFocus } from "@/components/app/todays-focus";
import { BlockedMoneyList, type BlockedRow } from "@/components/app/blocked-money-list";
import { Reveal } from "@/components/motion/reveal";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { CurrencyCode } from "@/lib/supabase/types";
import type { MoneyInsight } from "@/lib/ai/actions";

const EASE = [0.16, 1, 0.3, 1] as const;

type Metrics = {
  mtd: number; lastMonth: number; momDelta: number | null;
  wtd: number; lastWeek: number; wowDelta: number | null;
  ytd: number; feesMtd: number;
};

function greetingFor(hour: number): string {
  if (hour < 5) return "Still up";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function TodayView({
  firstName,
  currency,
  hasClients,
  metrics,
  series,
  pendingTotal,
  pendingCount,
  biggestDebtor,
  avgDaysToPayment,
  blocked,
  topClients,
  recent,
  situation,
  year,
  aiEnabled,
  focusInsights,
  focusGeneratedAt,
}: {
  firstName: string | null;
  currency: CurrencyCode;
  hasClients: boolean;
  metrics: Metrics;
  series: number[];
  pendingTotal: number;
  pendingCount: number;
  biggestDebtor: { name: string; total: number } | null;
  avgDaysToPayment: number | null;
  blocked: BlockedRow[];
  topClients: { name: string; value: number }[];
  recent: { id: string; net: number; paidAt: string; projectTitle: string; clientName: string }[];
  situation: string;
  year: number;
  aiEnabled: boolean;
  focusInsights: MoneyInsight[];
  focusGeneratedAt: string | null;
}) {
  // Time-aware greeting computed on the client so it matches the user's clock.
  const [greeting, setGreeting] = useState("Welcome back");
  useEffect(() => {
    setGreeting(greetingFor(new Date().getHours()));
  }, []);

  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8 lg:px-10 lg:py-12">
      {/* Greeting + date */}
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE }}
        className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1"
      >
        <h1 className="display-headline text-3xl md:text-4xl">
          {greeting}{firstName ? `, ${firstName}.` : "."}
        </h1>
        <span className="text-xs text-muted-foreground tabular">{today}</span>
      </motion.div>

      <div className="mt-8 space-y-10">
        {/* Hero: masthead number with daily sparkline */}
        <section className="grid items-end gap-8 lg:grid-cols-[1.6fr_1fr]">
          <MetricTrigger metricKey="landed" className="lift -m-2 rounded-xl p-2">
            <MastheadStat
              eyebrow="Landed this month"
              value={metrics.mtd}
              currency={currency}
              delta={metrics.momDelta}
              series={series}
              support={
                <span className="text-base leading-snug text-foreground/80">{situation}</span>
              }
            />
          </MetricTrigger>
          <Reveal delay={0.2}>
            <Card className="border-border/70 p-6">
              <div className="display-eyebrow flex items-center gap-2 text-muted-foreground">
                <span className="size-1.5 rounded-full bg-[var(--overdue)] animate-breathe" />
                Outstanding
              </div>
              <div className="display-numeric mt-3 text-4xl tabular">
                {formatMoney(pendingTotal, currency, { compact: true })}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Across {pendingCount} open {pendingCount === 1 ? "project" : "projects"}, valued at
                today&apos;s rates — moves with FX until paid.
              </p>
              <MetricTrigger
                metricKey="outstanding"
                className="mt-4 inline-flex w-auto items-center gap-1 text-xs font-medium text-foreground hover:underline"
              >
                View outstanding <ArrowUpRight className="size-3" />
              </MetricTrigger>
            </Card>
          </Reveal>
        </section>

        {/* Today's Focus — proactive, cached, auto-refreshing */}
        {aiEnabled && (
          <Reveal delay={0.24}>
            <TodaysFocus initialInsights={focusInsights} initialGeneratedAt={focusGeneratedAt} enabled={aiEnabled} />
          </Reveal>
        )}

        {/* BIG Ask-your-money centerpiece */}
        {aiEnabled && (
          <Reveal delay={0.28}>
            <div className="relative overflow-hidden rounded-xl border border-foreground/15 bg-gradient-to-b from-muted/40 to-card p-1.5 sm:p-2">
              <div className="pointer-events-none absolute -right-10 -top-10 size-40 rounded-full bg-[var(--brand)]/10 blur-3xl" />
              <div className="mb-3 flex items-center gap-2 px-4 pt-3">
                <span className="grid size-7 place-items-center rounded-full bg-foreground text-background">
                  <Sparkles className="size-3.5" />
                </span>
                <div>
                  <div className="display-eyebrow text-muted-foreground">Your money, on demand</div>
                  <div className="text-sm font-medium">Ask anything, get insights</div>
                </div>
              </div>
              <AiPanel enabled={aiEnabled} />
            </div>
          </Reveal>
        )}

        {/* Richer metric grid */}
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <MetricTrigger metricKey="landed" className="h-full">
            <MetricTile
              label="This week"
              value={metrics.wtd}
              currency={currency}
              delta={metrics.wowDelta}
              hint="landed · WoW"
              icon={CalendarRange}
              delay={0.02}
            />
          </MetricTrigger>
          <MetricTrigger metricKey="outstanding" className="h-full">
            <MetricTile
              label="Outstanding"
              value={pendingTotal}
              currency={currency}
              hint={`${pendingCount} open ${pendingCount === 1 ? "project" : "projects"}`}
              icon={Hourglass}
              accent
              delay={0.05}
            />
          </MetricTrigger>
          <MetricTrigger metricKey="fees" className="h-full">
            <MetricTile
              label="Fees this month"
              value={metrics.feesMtd}
              currency={currency}
              hint="rails + FX markup"
              icon={Receipt}
              delay={0.08}
            />
          </MetricTrigger>
          <MetricTrigger metricKey="avg-days" className="h-full">
            <MetricTile
              label="Avg days to payment"
              text={avgDaysToPayment !== null ? `${avgDaysToPayment.toFixed(1)} days` : "—"}
              hint={avgDaysToPayment !== null ? "quote → first payment" : "no paid projects yet"}
              icon={Hourglass}
              delay={0.11}
            />
          </MetricTrigger>
          <MetricTrigger metricKey="debtor" className="h-full">
            <MetricTile
              label="Biggest debtor"
              text={biggestDebtor?.name ?? "—"}
              hint={biggestDebtor ? `${formatMoney(biggestDebtor.total, currency, { compact: true })} outstanding` : "nobody owes you"}
              icon={UserX}
              delay={0.14}
            />
          </MetricTrigger>
          <MetricTrigger metricKey="landed" className="h-full">
            <MetricTile
              label={`Year to date`}
              value={metrics.ytd}
              currency={currency}
              hint={`${year} so far`}
              icon={CalendarRange}
              delay={0.17}
            />
          </MetricTrigger>
        </section>

        {/* What needs you + recent payments */}
        <section className="grid gap-6 lg:grid-cols-2">
          <div>
            <SectionHead title="What needs you" hint="Top open balances, ranked" href="/projects" cta="See all" />
            <BlockedMoneyList rows={blocked} baseCurrency={currency} limit={3} />
          </div>
          <div>
            <SectionHead title="Recent payments" hint={`Last ${recent.length} landed`} href="/payments" cta="Payments" />
            <Card className="overflow-hidden p-0">
              {recent.length === 0 ? (
                <div className="px-5 py-8 text-center text-sm text-muted-foreground">
                  {hasClients ? "No payments logged yet." : "Add a client to get started."}
                </div>
              ) : (
                <ul>
                  {recent.map((p, i) => (
                    <motion.li
                      key={p.id}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.35, delay: i * 0.04, ease: EASE }}
                      className={cn(
                        "flex items-center justify-between px-5 py-3.5",
                        i < recent.length - 1 && "border-b border-border/50",
                      )}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{p.projectTitle}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {p.clientName} · {new Date(p.paidAt).toLocaleDateString()}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1 text-sm font-semibold tabular">
                        <ArrowUpRight className="h-3.5 w-3.5 text-[var(--success)]" />
                        {formatMoney(p.net, currency)}
                      </div>
                    </motion.li>
                  ))}
                </ul>
              )}
            </Card>

            {topClients.length > 0 && (
              <div className="mt-6">
                <SectionHead title="Top clients" hint={`By landed ${currency}`} />
                <Card className="p-5">
                  <TopClients data={topClients} currency={currency} />
                </Card>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function TopClients({ data, currency }: { data: { name: string; value: number }[]; currency: CurrencyCode }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <ol className="space-y-3">
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
              transition={{ duration: 0.8, delay: 0.3 + i * 0.08, ease: EASE }}
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

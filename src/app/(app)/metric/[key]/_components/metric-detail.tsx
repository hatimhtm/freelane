"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlarmClock, ArrowLeft, ArrowUpRight } from "lucide-react";
import { motion } from "motion/react";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/app/page-header";
import { Reveal } from "@/components/motion/reveal";
import { MastheadStat } from "@/components/stats/stat";
import { TrendAreaChart } from "@/components/stats/trend-area-chart";
import { DonutChart } from "@/components/stats/donut-chart";
import { BarsChart } from "@/components/stats/bars-chart";
import { BlockedMoneyList, type BlockedRow } from "@/components/app/blocked-money-list";
import { MethodLeaderboard } from "@/components/app/method-leaderboard";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { CurrencyCode } from "@/lib/supabase/types";
import type { MethodLeaderboardRow } from "@/lib/payment-chain";

const EASE = [0.16, 1, 0.3, 1] as const;

type PaymentRow = {
  id: string;
  net: number;
  paidAt: string;
  projectTitle: string;
  clientName: string;
};

export type MetricData =
  | {
      key: "landed";
      currency: CurrencyCode;
      landed: {
        mtd: number;
        momDelta: number | null;
        revenue: { month: string; total: number }[];
        incomeByClient: { name: string; value: number }[];
        incomeByCurrency: { code: string; value: number }[];
        payments: PaymentRow[];
      };
    }
  | {
      key: "outstanding";
      currency: CurrencyCode;
      outstanding: {
        total: number;
        count: number;
        blocked: BlockedRow[];
        byClient: { name: string; value: number }[];
        oldest: {
          projectTitle: string;
          clientName: string;
          daysAged: number;
          outstandingBase: number;
          outstandingNative: number;
          currency: CurrencyCode;
        } | null;
      };
    }
  | {
      key: "fees";
      currency: CurrencyCode;
      fees: {
        mtd: number;
        ytd: number;
        overTime: { month: string; total: number }[];
        leaderboard: MethodLeaderboardRow[];
        highestFee: {
          id: string;
          fee: number;
          gross: number;
          pct: number;
          paidAt: string;
          projectTitle: string;
          clientName: string;
          chain: string;
        }[];
      };
    }
  | {
      key: "avg-days";
      currency: CurrencyCode;
      avgDays: {
        average: number | null;
        sampleSize: number;
        perProject: {
          projectId: string;
          projectTitle: string;
          clientName: string;
          days: number;
        }[];
        slowestClients: { name: string; avgDays: number; count: number }[];
      };
    }
  | {
      key: "debtor";
      currency: CurrencyCode;
      debtor: {
        debtors: {
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
        }[];
      };
    };

// Just the per-metric breakdown — no page chrome. Reused by the full-page
// route (deep link) and the half-screen MetricSheet.
export function MetricDetailBody({ data, className }: { data: MetricData; className?: string }) {
  return (
    <div className={cn("space-y-10", className)}>
      {data.key === "landed" && <LandedDetail d={data.landed} currency={data.currency} />}
      {data.key === "outstanding" && (
        <OutstandingDetail d={data.outstanding} currency={data.currency} />
      )}
      {data.key === "fees" && <FeesDetail d={data.fees} currency={data.currency} />}
      {data.key === "avg-days" && <AvgDaysDetail d={data.avgDays} />}
      {data.key === "debtor" && <DebtorDetail d={data.debtor} currency={data.currency} />}
    </div>
  );
}

export function MetricDetail({
  data,
  title,
  description,
}: {
  data: MetricData;
  title: string;
  description: string;
}) {
  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6 py-8 lg:px-10 lg:py-12">
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Dashboard
      </Link>

      <div className="mt-5">
        <PageHeader title={title} description={description} />
      </div>

      <MetricDetailBody data={data} className="mt-10" />
    </div>
  );
}

// ───────────────────────────────────────── shared bits ──

function ChartCard({
  title,
  subtitle,
  children,
  className,
  delay = 0,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: EASE }}
      className={className}
    >
      <Card className="h-full overflow-hidden p-6">
        <div className="text-sm font-medium">{title}</div>
        {subtitle && <div className="text-xs text-muted-foreground">{subtitle}</div>}
        {children}
      </Card>
    </motion.div>
  );
}

function SectionHead({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-3">
      <div className="text-sm font-medium">{title}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

function BarList({
  data,
  currency,
  total,
  color = "var(--chart-1)",
  showCode = false,
}: {
  data: { name: string; value: number }[];
  currency: CurrencyCode;
  total?: number;
  color?: string;
  showCode?: boolean;
}) {
  if (data.length === 0) {
    return <div className="mt-8 text-center text-sm text-muted-foreground">Nothing here yet.</div>;
  }
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <ol className="mt-4 space-y-3">
      {data.map((c, i) => (
        <li key={c.name}>
          <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
            <span className={cn("min-w-0 truncate font-medium", showCode && "font-mono")}>{c.name}</span>
            <span className="shrink-0 tabular text-muted-foreground">
              {formatMoney(c.value, currency, { compact: true })}
              {total && total > 0 && (
                <span className="ml-1 text-[11px]">· {((c.value / total) * 100).toFixed(0)}%</span>
              )}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${(c.value / max) * 100}%` }}
              transition={{ duration: 0.8, delay: 0.2 + i * 0.06, ease: EASE }}
              className="h-full rounded-full"
              style={{ background: color }}
            />
          </div>
        </li>
      ))}
    </ol>
  );
}

function PaymentsList({ rows, currency }: { rows: PaymentRow[]; currency: CurrencyCode }) {
  return (
    <Card className="overflow-hidden p-0">
      {rows.length === 0 ? (
        <div className="px-5 py-8 text-center text-sm text-muted-foreground">
          No payments this month yet.
        </div>
      ) : (
        <ul>
          {rows.map((p, i) => (
            <motion.li
              key={p.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: i * 0.03, ease: EASE }}
              className={cn(
                "flex items-center justify-between px-5 py-3.5",
                i < rows.length - 1 && "border-b border-border/50",
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
  );
}

// ───────────────────────────────────────── landed ──

function LandedDetail({
  d,
  currency,
}: {
  d: Extract<MetricData, { key: "landed" }>["landed"];
  currency: CurrencyCode;
}) {
  return (
    <>
      <MastheadStat
        eyebrow="Landed this month"
        value={d.mtd}
        currency={currency}
        delta={d.momDelta}
        support={<span>Net cash that arrived since the 1st, locked at the rate it landed.</span>}
      />

      <ChartCard title="Revenue" subtitle={`Last 6 months · landed ${currency}`}>
        <div className="mt-3">
          <TrendAreaChart data={d.revenue} currency={currency} />
        </div>
      </ChartCard>

      <section className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Income by client" subtitle="Top 5 + other · landed">
          <div className="mt-4">
            <DonutChart data={d.incomeByClient} currency={currency} />
          </div>
        </ChartCard>
        <ChartCard delay={0.06} title="Income by currency" subtitle="This month · by project currency">
          <BarList data={d.incomeByCurrency.map((c) => ({ name: c.code, value: c.value }))} currency={currency} showCode />
        </ChartCard>
      </section>

      <section>
        <SectionHead title="This month's payments" hint={`${d.payments.length} landed`} />
        <PaymentsList rows={d.payments} currency={currency} />
      </section>
    </>
  );
}

// ───────────────────────────────────────── outstanding ──

function OutstandingDetail({
  d,
  currency,
}: {
  d: Extract<MetricData, { key: "outstanding" }>["outstanding"];
  currency: CurrencyCode;
}) {
  const router = useRouter();
  return (
    <>
      <section className="grid gap-4 sm:grid-cols-2">
        <Reveal>
          <Card className="border-border/70 p-6">
            <div className="display-eyebrow flex items-center gap-2 text-muted-foreground">
              <span className="size-1.5 rounded-full bg-[var(--overdue)] animate-breathe" />
              Outstanding
            </div>
            <div className="display-numeric mt-3 text-4xl tabular">
              {formatMoney(d.total, currency, { compact: true })}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Across {d.count} open {d.count === 1 ? "project" : "projects"}, valued at today&apos;s
              rates — moves with FX until paid.
            </p>
          </Card>
        </Reveal>
        {d.oldest && (
          <Reveal delay={0.06}>
            <Card className="border-border/70 p-6">
              <div className="display-eyebrow text-muted-foreground">Oldest balance</div>
              <div className="mt-3 flex items-center gap-2 text-[var(--overdue)]">
                <AlarmClock className="size-4" />
                <span className="display-numeric tabular text-2xl">{d.oldest.daysAged}d</span>
                <span className="text-xs text-muted-foreground">waiting</span>
              </div>
              <div className="mt-3 truncate text-sm font-medium">{d.oldest.projectTitle}</div>
              <div className="truncate text-xs text-muted-foreground">{d.oldest.clientName}</div>
              <div className="mt-2 text-sm font-semibold tabular">
                {formatMoney(d.oldest.outstandingNative, d.oldest.currency)}{" "}
                <span className="text-xs font-normal text-muted-foreground">owed</span>
              </div>
            </Card>
          </Reveal>
        )}
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <div>
          <SectionHead title="Open balances" hint="Ranked by amount × days waiting · flag to mark overdue" />
          <BlockedMoneyList
            rows={d.blocked}
            baseCurrency={currency}
            interactive
            onOpen={() => router.push("/projects")}
          />
        </div>
        <ChartCard title="Outstanding by client" subtitle={`Owed · ${currency}`}>
          <BarList data={d.byClient} currency={currency} total={d.total} color="var(--overdue)" />
        </ChartCard>
      </section>
    </>
  );
}

// ───────────────────────────────────────── fees ──

function FeesDetail({
  d,
  currency,
}: {
  d: Extract<MetricData, { key: "fees" }>["fees"];
  currency: CurrencyCode;
}) {
  return (
    <>
      <section className="grid gap-4 sm:grid-cols-2">
        <Reveal>
          <Card className="border-border/70 p-6">
            <div className="display-eyebrow text-muted-foreground">Fees this month</div>
            <div className="display-numeric mt-3 text-4xl tabular">
              {formatMoney(d.mtd, currency, { compact: true })}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Rails + FX markup eaten this month.</p>
          </Card>
        </Reveal>
        <Reveal delay={0.06}>
          <Card className="border-border/70 p-6">
            <div className="display-eyebrow text-muted-foreground">Fees year to date</div>
            <div className="display-numeric mt-3 text-4xl tabular">
              {formatMoney(d.ytd, currency, { compact: true })}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Total lost to date this year.</p>
          </Card>
        </Reveal>
      </section>

      <ChartCard title="Fees over time" subtitle={`Last 12 months · ${currency}`}>
        <div className="mt-4">
          <BarsChart
            data={d.overTime}
            series={[{ key: "total", label: "Fees", color: "var(--chart-4)" }]}
            currency={currency}
            stacked={false}
          />
        </div>
      </ChartCard>

      <section>
        <SectionHead title="Fees by payment chain" hint="Effective fee % + total fee · cheapest first" />
        <MethodLeaderboard rows={d.leaderboard} baseCurrency={currency} />
        <div className="mt-3 space-y-2">
          {d.leaderboard
            .filter((r) => r.feeBase > 0)
            .map((r) => (
              <div
                key={r.signature}
                className="flex items-center justify-between rounded-xl border border-border/60 bg-card px-4 py-2.5 text-sm"
              >
                <span className="min-w-0 truncate text-muted-foreground">{r.signature}</span>
                <span className="shrink-0 tabular font-medium">
                  {formatMoney(r.feeBase, currency, { compact: true })} fee
                </span>
              </div>
            ))}
        </div>
      </section>

      <section>
        <SectionHead title="Highest-fee payments" hint="The individual payments that cost you most" />
        <Card className="overflow-hidden p-0">
          {d.highestFee.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-muted-foreground">
              No fees recorded yet.
            </div>
          ) : (
            <ul>
              {d.highestFee.map((p, i) => (
                <li
                  key={p.id}
                  className={cn(
                    "flex items-center justify-between gap-3 px-5 py-3.5",
                    i < d.highestFee.length - 1 && "border-b border-border/50",
                  )}
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{p.projectTitle}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {p.clientName} · {p.chain} · {new Date(p.paidAt).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-semibold tabular text-[var(--overdue)]">
                      {formatMoney(p.fee, currency, { compact: true })}
                    </div>
                    <div className="text-[11px] text-muted-foreground tabular">
                      {(p.pct * 100).toFixed(1)}% of gross
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </>
  );
}

// ───────────────────────────────────────── avg-days ──

function AvgDaysDetail({
  d,
}: {
  d: Extract<MetricData, { key: "avg-days" }>["avgDays"];
}) {
  return (
    <>
      <Reveal>
        <div>
          <p className="display-eyebrow text-muted-foreground">Avg days to payment</p>
          <div className="mt-3 flex items-end gap-3">
            <span className="display-numeric tabular text-[clamp(2.75rem,8vw,5.5rem)] leading-none">
              {d.average !== null ? d.average : "—"}
            </span>
            {d.average !== null && (
              <span className="mb-2 text-lg text-muted-foreground">days</span>
            )}
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            {d.average !== null ? (
              <>
                On average from quote to first payment, across {d.sampleSize} paid{" "}
                {d.sampleSize === 1 ? "project" : "projects"}.
              </>
            ) : (
              "No paid projects with a quote date yet."
            )}
          </p>
        </div>
      </Reveal>

      <section className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <div>
          <SectionHead title="Per project" hint="Quote → first payment, slowest first" />
          <Card className="overflow-hidden p-0">
            {d.perProject.length === 0 ? (
              <div className="px-5 py-8 text-center text-sm text-muted-foreground">
                Nothing to measure yet.
              </div>
            ) : (
              <ul>
                {d.perProject.map((p, i) => (
                  <li
                    key={p.projectId}
                    className={cn(
                      "flex items-center justify-between gap-3 px-5 py-3.5",
                      i < d.perProject.length - 1 && "border-b border-border/50",
                    )}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{p.projectTitle}</div>
                      <div className="truncate text-xs text-muted-foreground">{p.clientName}</div>
                    </div>
                    <span className="shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-sm font-semibold tabular">
                      {p.days}d
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <ChartCard title="Slowest clients" subtitle="Average lag per client">
          {d.slowestClients.length === 0 ? (
            <div className="mt-8 text-center text-sm text-muted-foreground">No data yet.</div>
          ) : (
            <ol className="mt-4 space-y-3">
              {(() => {
                const max = Math.max(...d.slowestClients.map((c) => c.avgDays), 1);
                return d.slowestClients.map((c, i) => (
                  <li key={c.name}>
                    <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                      <span className="min-w-0 truncate font-medium">{c.name}</span>
                      <span className="shrink-0 tabular text-muted-foreground">
                        {c.avgDays}d · {c.count}
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${(c.avgDays / max) * 100}%` }}
                        transition={{ duration: 0.8, delay: 0.2 + i * 0.06, ease: EASE }}
                        className="h-full rounded-full bg-[var(--chart-3)]"
                      />
                    </div>
                  </li>
                ));
              })()}
            </ol>
          )}
        </ChartCard>
      </section>
    </>
  );
}

// ───────────────────────────────────────── debtor ──

function DebtorDetail({
  d,
  currency,
}: {
  d: Extract<MetricData, { key: "debtor" }>["debtor"];
  currency: CurrencyCode;
}) {
  if (d.debtors.length === 0) {
    return (
      <div className="rounded-xl border border-border/60 bg-card px-5 py-10 text-center text-sm text-muted-foreground">
        Nobody owes you. Clean slate.
      </div>
    );
  }
  return (
    <section className="space-y-4">
      {d.debtors.map((c, i) => (
        <motion.div
          key={c.clientId}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: i * 0.05, ease: EASE }}
        >
          <Card className="overflow-hidden p-0">
            <div className="flex items-center justify-between gap-3 px-5 py-4">
              <div className="flex min-w-0 items-center gap-3">
                <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-[11px] text-muted-foreground">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{c.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {c.projects.length} open {c.projects.length === 1 ? "project" : "projects"}
                  </div>
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-base font-semibold tabular">
                  {formatMoney(c.total, currency, { compact: true })}
                </div>
                <div className="text-[11px] text-muted-foreground">outstanding</div>
              </div>
            </div>
            <ul className="border-t border-border/50">
              {c.projects.map((p) => (
                <li
                  key={p.projectId}
                  className="flex items-center justify-between gap-3 border-b border-border/40 px-5 py-2.5 last:border-b-0"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    {p.flagged && <span className="size-1.5 shrink-0 rounded-full bg-[var(--overdue)]" />}
                    <span className="truncate text-sm">{p.projectTitle}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] tabular text-muted-foreground">
                      {p.daysAged}d
                    </span>
                    <span className="text-sm font-medium tabular">
                      {formatMoney(p.outstandingNative, p.currency)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </motion.div>
      ))}
    </section>
  );
}

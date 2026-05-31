"use client";

import Link from "next/link";
import { useMemo } from "react";
import { motion } from "motion/react";
import { ArrowLeft } from "lucide-react";
import NumberFlow from "@number-flow/react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { SpendAnomaliesPanel } from "@/components/spending/spend-anomalies-panel";
import { VendorIntelligence } from "@/components/spending/vendor-intelligence";
import { BarsChart } from "@/components/stats/bars-chart";
import { formatMoney } from "@/lib/money";
import type { SpendingAnomaly } from "@/lib/ai/spending-anomalies";
import type { CurrencyCode, Spend, SpendCategory } from "@/lib/supabase/types";

const EASE = [0.22, 1, 0.36, 1] as const;

export type CategorySpendRow = {
  id: string;
  spentAt: string;
  amount: number;
  currency: CurrencyCode;
  amountBase: number;
  description: string | null;
  walletId: string;
  walletName: string;
  businessRelevant: boolean;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function CategoryDetail({
  category,
  rows,
  spends,
  baseCurrency,
  anomalies,
}: {
  category: SpendCategory;
  rows: CategorySpendRow[];
  spends: Spend[];
  baseCurrency: CurrencyCode;
  anomalies: SpendingAnomaly[];
}) {
  // Lifetime stats — every row in this category, all time.
  const stats = useMemo(() => {
    if (rows.length === 0) {
      return {
        total: 0,
        count: 0,
        avg: 0,
        biggest: 0,
        firstSeenAt: null as string | null,
        lastSeenAt: null as string | null,
      };
    }
    let total = 0;
    let biggest = 0;
    let firstSeenAt = rows[0]!.spentAt;
    let lastSeenAt = rows[0]!.spentAt;
    for (const r of rows) {
      total += r.amountBase;
      if (r.amountBase > biggest) biggest = r.amountBase;
      if (r.spentAt < firstSeenAt) firstSeenAt = r.spentAt;
      if (r.spentAt > lastSeenAt) lastSeenAt = r.spentAt;
    }
    return {
      total,
      count: rows.length,
      avg: total / rows.length,
      biggest,
      firstSeenAt,
      lastSeenAt,
    };
  }, [rows]);

  // Trailing 12 months bucketed for the trend bars. amountBase already
  // FX-locked at entry, so a single sum per month is honest.
  const monthlyTrend = useMemo(() => {
    const now = new Date();
    const buckets: { key: string; month: string; total: number }[] = [];
    const start = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    for (let i = 0; i < 12; i++) {
      const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
      buckets.push({
        key: `${d.getFullYear()}-${d.getMonth()}`,
        month: MONTHS[d.getMonth()]!,
        total: 0,
      });
    }
    const idx = new Map(buckets.map((b, i) => [b.key, i] as const));
    for (const r of rows) {
      const d = new Date(r.spentAt);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      const i = idx.get(key);
      if (i === undefined) continue;
      buckets[i]!.total += r.amountBase;
    }
    return buckets;
  }, [rows]);

  // Sort newest → oldest for the spend list. Slice intentionally absent —
  // category detail is the *full* history.
  const sortedRows = useMemo(
    () => [...rows].sort((a, b) => (a.spentAt < b.spentAt ? 1 : -1)),
    [rows],
  );

  const anyTrend = monthlyTrend.some((b) => b.total > 0);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <div className="mb-4">
        <Link
          href="/spending"
          className="inline-flex items-center gap-1 text-[12px] text-muted-foreground transition-colors duration-200 hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" />
          Spending
        </Link>
      </div>

      <PageHeader
        title={category.name}
        description={`${stats.count} ${stats.count === 1 ? "spend" : "spends"} on file`}
      />

      {/* Lifetime stat strip — hero total + the supporting six. */}
      <section className="mt-6 grid gap-3 md:grid-cols-3">
        <div className="paper-grain rounded-[12px] border border-foreground/10 bg-card/40 p-4 md:col-span-1">
          <div className="display-eyebrow text-muted-foreground">Lifetime total</div>
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: EASE }}
            className="mt-2"
          >
            <NumberFlow
              value={Math.round(stats.total)}
              format={{
                style: "currency",
                currency: baseCurrency,
                maximumFractionDigits: 0,
              }}
              transformTiming={{
                duration: 600,
                easing: "cubic-bezier(0.22, 1, 0.36, 1)",
              }}
              className="font-fraunces display-numeric tabular text-[clamp(36px,5.5vw,52px)] leading-none text-foreground"
            />
          </motion.div>
          <div className="mt-3 text-[12px] text-muted-foreground">
            avg{" "}
            <span className="tabular text-foreground">
              {formatMoney(stats.avg, baseCurrency, { compact: true })}
            </span>{" "}
            per spend
          </div>
        </div>

        <div className="rounded-[12px] border border-foreground/10 bg-card/40 p-4 md:col-span-2">
          <div className="display-eyebrow text-muted-foreground">At a glance</div>
          <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2.5 text-[12px] sm:grid-cols-3">
            <StatLine label="Spends" value={String(stats.count)} />
            <StatLine
              label="Biggest"
              value={formatMoney(stats.biggest, baseCurrency, { compact: true })}
            />
            <StatLine
              label="Avg ticket"
              value={formatMoney(stats.avg, baseCurrency, { compact: true })}
            />
            <StatLine
              label="First seen"
              value={stats.firstSeenAt ? formatLongDate(stats.firstSeenAt) : "—"}
            />
            <StatLine
              label="Last seen"
              value={stats.lastSeenAt ? relativeDays(stats.lastSeenAt) : "—"}
            />
            <StatLine
              label="Active months"
              value={String(monthlyTrend.filter((b) => b.total > 0).length)}
            />
          </dl>
        </div>
      </section>

      {/* AI editorial note — no UI label, just sits at the top of the analytical zone. */}
      {anomalies.length > 0 && (
        <section className="mt-5">
          <SpendAnomaliesPanel anomalies={anomalies} />
        </section>
      )}

      {/* Trailing 12-month bars. Compact, no legend (single series). */}
      <section className="mt-5 rounded-[12px] border border-foreground/10 bg-card/40 p-4">
        <div className="flex items-baseline justify-between">
          <div className="display-eyebrow text-muted-foreground">Last 12 months</div>
          <span className="text-[11px] text-muted-foreground/70">monthly total</span>
        </div>
        {anyTrend ? (
          <div className="mt-2">
            <BarsChart
              data={monthlyTrend.map((b) => ({ month: b.month, total: b.total }))}
              series={[
                { key: "total", label: category.name, color: category.color ?? "var(--chart-1)" },
              ]}
              currency={baseCurrency}
              height={180}
              stacked={false}
            />
          </div>
        ) : (
          <p className="mt-4 py-6 text-center text-[12px] text-muted-foreground">
            No spends in the last 12 months.
          </p>
        )}
      </section>

      {/* Top vendors WITHIN this category — uses the global VendorIntelligence
          fed only the category's spends. */}
      <section className="mt-5 rounded-[12px] border border-foreground/10 bg-card/40">
        <div className="flex items-baseline justify-between border-b border-foreground/10 px-4 py-2.5">
          <div className="display-eyebrow text-muted-foreground">Top vendors here</div>
          <span className="text-[11px] text-muted-foreground/70">top 6</span>
        </div>
        <VendorIntelligence spends={spends} baseCurrency={baseCurrency} />
      </section>

      {/* Full spend history — newest first, hairline dividers. */}
      <section className="mt-6">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-[13px] font-medium tracking-tight text-foreground">
            All spends
          </h2>
          <span className="tabular text-[11px] text-muted-foreground">
            {sortedRows.length} {sortedRows.length === 1 ? "spend" : "spends"}
          </span>
        </div>

        {sortedRows.length === 0 ? (
          <EmptyState
            title="Nothing here yet."
            description="Spends tagged with this category will show up here as you log them."
          />
        ) : (
          <ul className="border-t border-foreground/10">
            {sortedRows.map((row, i) => (
              <SpendRow key={row.id} row={row} baseCurrency={baseCurrency} index={i} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function StatLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-dashed border-foreground/8 pb-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular text-foreground">{value}</dd>
    </div>
  );
}

function SpendRow({
  row,
  baseCurrency,
  index,
}: {
  row: CategorySpendRow;
  baseCurrency: CurrencyCode;
  index: number;
}) {
  return (
    <motion.li
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.28, delay: Math.min(index, 8) * 0.02, ease: EASE }}
      className="flex items-center gap-3 border-b border-foreground/10 py-2.5"
    >
      <div className="w-14 shrink-0 text-[11px] tabular text-muted-foreground">
        {formatShortDate(row.spentAt)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[13px] text-foreground">
            {row.description?.trim() || (
              <span className="text-muted-foreground/60">—</span>
            )}
          </span>
          {row.businessRelevant && (
            <span
              aria-label="Business-relevant"
              title="Business-relevant"
              className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand)]"
            />
          )}
        </div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">{row.walletName}</div>
      </div>
      <div className="shrink-0 text-right">
        <div className="text-[13px] tabular text-foreground">
          {formatMoney(row.amountBase, baseCurrency)}
        </div>
        {row.currency !== baseCurrency && (
          <div className="mt-0.5 text-[10px] tabular text-muted-foreground/70">
            {formatMoney(row.amount, row.currency, { compact: true })}
          </div>
        )}
      </div>
    </motion.li>
  );
}

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
}

function formatLongDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function relativeDays(iso: string): string {
  const t = new Date(iso).getTime();
  const days = Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

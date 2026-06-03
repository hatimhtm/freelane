"use client";

import { TrendingUp } from "lucide-react";
import { AiDot } from "@/components/widgets/ai-dot";
import { formatMoney } from "@/lib/money";
import type { CurrencyCode } from "@/lib/supabase/types";

// Spend vs income trend — Money/L widget. Renders a sparse monthly bar
// pair (income vs outflow) over the resolved scope. Relevance-gated
// upstream: parent page passes null data through getSpendVsIncomeTrend
// and skips this widget when nothing has moved in scope.

export type SpendVsIncomeTrendWidgetProps = {
  scope: string;
  data: {
    buckets: Array<{ phtMonth: string; income: number; outflow: number }>;
    totalIncome: number;
    totalOutflow: number;
  };
  baseCurrency: CurrencyCode;
};

export function SpendVsIncomeTrendWidget({
  scope,
  data,
  baseCurrency,
}: SpendVsIncomeTrendWidgetProps) {
  const cardKey = `stats.${scope}.spend_vs_income`;
  // Verifier fix (low): on wide scopes (Lifetime with 24+ months) the
  // monthly bars were compressed to ~28px each inside an overflow-x-auto
  // container that fought the parent grid's column width, making the
  // most useful trend in the system illegible. Two fixes:
  //   - When > 12 buckets, aggregate by quarter so the bar count drops
  //     to a readable density.
  //   - When the bucket count after that is > 6 we let the widget span
  //     2 grid columns on lg via a wrapper class hint (lg:col-span-2).
  const renderBuckets =
    data.buckets.length > 12 ? aggregateByQuarter(data.buckets) : data.buckets;
  const spansTwoCols = renderBuckets.length > 6;
  const max = Math.max(
    1,
    ...renderBuckets.map((b) => Math.max(b.income, b.outflow)),
  );
  const net = data.totalIncome - data.totalOutflow;
  const netPositive = net >= 0;
  return (
    <div
      className={`group relative flex min-h-[260px] w-full flex-col rounded-xl bg-card p-5 ring-1 ring-foreground/10 ${spansTwoCols ? "lg:col-span-2" : ""}`}
    >
      <div className="flex items-start gap-2">
        <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-foreground/[0.04] text-foreground/70">
          <TrendingUp className="h-4 w-4" />
        </div>
        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          Spend vs income
        </div>
      </div>
      <div className="mt-3">
        <div className="display-headline text-[28px] leading-none tabular-nums text-foreground">
          {netPositive ? "+" : ""}
          {formatMoney(net, baseCurrency, { compact: true })}
        </div>
        <div className="mt-1.5 text-[11.5px] leading-snug text-muted-foreground">
          {formatMoney(data.totalIncome, baseCurrency, { compact: true })} in ·{" "}
          {formatMoney(data.totalOutflow, baseCurrency, { compact: true })} out
        </div>
      </div>
      <div className="mt-4 flex flex-1 items-end gap-2 overflow-x-auto">
        {renderBuckets.map((b) => {
          const incomePct = (b.income / max) * 100;
          const outflowPct = (b.outflow / max) * 100;
          return (
            <div
              key={b.phtMonth}
              className="flex shrink-0 flex-col items-center gap-1"
              style={{ minWidth: 28 }}
            >
              <div className="flex h-[120px] items-end gap-0.5">
                <div
                  className="w-2.5 rounded-t-[2px] bg-[var(--brand-lime,oklch(0.85_0.18_120))]/70"
                  style={{ height: `${incomePct}%` }}
                  aria-label={`Income ${b.phtMonth}`}
                />
                <div
                  className="w-2.5 rounded-t-[2px] bg-foreground/30"
                  style={{ height: `${outflowPct}%` }}
                  aria-label={`Outflow ${b.phtMonth}`}
                />
              </div>
              <div className="text-[9px] tabular-nums text-muted-foreground">
                {/* Slice MM out of "YYYY-MM"; quarter buckets format as
                    "YYYY-QN", so the same slice (5..) keeps the Q1/Q4
                    suffix readable on the axis. */}
                {b.phtMonth.slice(5)}
              </div>
            </div>
          );
        })}
      </div>
      <AiDot
        card={{
          key: cardKey,
          label: "Spend vs income trend",
          data: {
            scope,
            total_income: data.totalIncome,
            total_outflow: data.totalOutflow,
          },
        }}
        question="Why is my net moving like this?"
      />
    </div>
  );
}

// Roll monthly buckets up to quarterly so wide scopes stay legible. The
// quarter label uses the QN format (Q1..Q4) prefixed by the calendar
// year so the x-axis stays scannable.
function aggregateByQuarter(
  monthly: Array<{ phtMonth: string; income: number; outflow: number }>,
): Array<{ phtMonth: string; income: number; outflow: number }> {
  const byQuarter = new Map<string, { income: number; outflow: number }>();
  for (const m of monthly) {
    const [y, mm] = m.phtMonth.split("-");
    const q = Math.floor((Number(mm) - 1) / 3) + 1;
    const key = `${y}-Q${q}`;
    const prev = byQuarter.get(key) ?? { income: 0, outflow: 0 };
    byQuarter.set(key, {
      income: prev.income + m.income,
      outflow: prev.outflow + m.outflow,
    });
  }
  return Array.from(byQuarter.entries())
    .map(([phtMonth, v]) => ({ phtMonth, ...v }))
    .sort((a, b) => a.phtMonth.localeCompare(b.phtMonth));
}

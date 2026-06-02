"use client";

import { useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatMoney } from "@/lib/money";
import type { CurrencyCode } from "@/lib/supabase/types";
import type { AtlasDay, CashflowAtlas } from "@/lib/cashflow-atlas";
import {
  CHART_MARGIN,
  CHART_XAXIS_MIN_TICK_GAP,
  CHART_YAXIS_WIDTH,
} from "@/lib/charts/chart-defaults";

type Series = {
  date: string;
  shortLabel: string;
  balance: number;
  events: AtlasDay["events"];
};

function buildSeries(atlas: CashflowAtlas): Series[] {
  return atlas.days.map((d) => ({
    date: d.dayKey,
    shortLabel: shortLabelFor(d.date),
    balance: Math.round(d.endOfDayBalance),
    events: d.events,
  }));
}

function shortLabelFor(d: Date): string {
  // "Jun 4" — short, dense, deterministic. Tick labels prune themselves below.
  const month = d.toLocaleString("en", { month: "short" });
  return `${month} ${d.getDate()}`;
}

export interface CashflowAtlasChartProps {
  atlas: CashflowAtlas;
  baseCurrency: CurrencyCode;
  // Optional "story headline" rendered above the chart.
  headline?: string;
  // Optional 2-4 sentence narrative under the headline.
  narrative?: string;
}

export function CashflowAtlasChart({
  atlas,
  baseCurrency,
  headline,
  narrative,
}: CashflowAtlasChartProps) {
  const series = useMemo(() => buildSeries(atlas), [atlas]);
  const lowPoint = useMemo(() => {
    if (!atlas.minBalanceDate) return null;
    const key = `${atlas.minBalanceDate.getFullYear()}-${pad(atlas.minBalanceDate.getMonth() + 1)}-${pad(atlas.minBalanceDate.getDate())}`;
    return series.find((s) => s.date === key) ?? null;
  }, [series, atlas.minBalanceDate]);

  const eventDays = useMemo(
    () => series.filter((s) => s.events.length > 0),
    [series],
  );

  const yMin = Math.min(0, atlas.minBalance);
  const yMax = Math.max(...series.map((s) => s.balance), atlas.startingBalance);

  return (
    <div className="rounded-[14px] border border-border/60 bg-card/40 p-4">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className="font-display text-sm font-medium leading-snug">
          90-Day Cashflow Atlas
        </h3>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Projected balance
        </span>
      </div>
      {headline && (
        <p className="mb-1 text-sm leading-snug text-foreground">{headline}</p>
      )}
      {narrative && (
        <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
          {narrative}
        </p>
      )}

      <div className="h-[200px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={series}
            margin={CHART_MARGIN}
          >
            <defs>
              <linearGradient id="atlas-balance" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--acid-lime)" stopOpacity={0.32} />
                <stop offset="100%" stopColor="var(--acid-lime)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid
              stroke="var(--foreground)"
              strokeOpacity={0.06}
              vertical={false}
            />
            <XAxis
              dataKey="shortLabel"
              tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
              interval={Math.floor(series.length / 6)}
              minTickGap={CHART_XAXIS_MIN_TICK_GAP}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              domain={[yMin, yMax]}
              tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => formatMoney(v, baseCurrency, { compact: true })}
              width={CHART_YAXIS_WIDTH}
            />
            <Tooltip
              cursor={{ stroke: "var(--foreground)", strokeOpacity: 0.16 }}
              content={({ active, payload }) => {
                if (!active || !payload?.[0]) return null;
                const point = payload[0].payload as Series;
                return (
                  <div className="rounded-md border border-border/70 bg-popover px-3 py-2 text-xs shadow-md">
                    <div className="font-medium">{point.shortLabel}</div>
                    <div className="tabular text-foreground">
                      {formatMoney(point.balance, baseCurrency, {
                        compact: true,
                      })}
                    </div>
                    {point.events.slice(0, 3).map((e, i) => (
                      <div
                        key={i}
                        className="mt-1 text-[10px] text-muted-foreground"
                      >
                        {e.label} ·{" "}
                        {formatMoney(e.amount, baseCurrency, { compact: true })}
                      </div>
                    ))}
                  </div>
                );
              }}
            />
            <ReferenceLine
              y={0}
              stroke="var(--overdue, #b65b3c)"
              strokeOpacity={0.45}
              strokeDasharray="3 3"
            />
            <Area
              type="monotone"
              dataKey="balance"
              stroke="var(--acid-lime)"
              strokeWidth={1.5}
              fill="url(#atlas-balance)"
            />
            {lowPoint && (
              <ReferenceDot
                x={lowPoint.shortLabel}
                y={lowPoint.balance}
                r={3}
                fill="var(--overdue, #b65b3c)"
                stroke="none"
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {eventDays.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {eventDays.slice(0, 6).map((d) => (
            <span
              key={d.date}
              className="rounded-full border border-border/70 bg-muted/40 px-2 py-0.5 text-[10px] text-foreground/80"
              title={d.events.map((e) => `${e.label}: ${e.amount}`).join(" · ")}
            >
              <span className="font-medium">{d.shortLabel}</span>{" "}
              <span className="text-muted-foreground">
                {d.events[0].label}
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

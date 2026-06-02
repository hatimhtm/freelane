"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatMoney } from "@/lib/money";
import type { CurrencyCode, Spend } from "@/lib/supabase/types";
import {
  CHART_MARGIN,
  CHART_XAXIS_MIN_TICK_GAP,
  CHART_YAXIS_WIDTH,
} from "@/lib/charts/chart-defaults";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Recharts clones this element with x/y/payload props injected; declaring them
// optional keeps the JSX call (<YTick … />) type-checking without ceremony.
function YTick({
  x,
  y,
  payload,
  baseCurrency,
}: {
  x?: number;
  y?: number;
  payload?: { value: number };
  baseCurrency: CurrencyCode;
}) {
  if (x === undefined || y === undefined || !payload) return null;
  return (
    <text
      x={x}
      y={y}
      dy={3}
      textAnchor="end"
      className="tabular"
      style={{ fontSize: 11, fill: "var(--muted-foreground)" }}
    >
      {formatMoney(payload.value, baseCurrency, { compact: true })}
    </text>
  );
}

// Trailing 6 months including `now`, bucketed by spent_at month-of-year.
// Uses amount_base so cross-currency spends already collapsed to PHP at entry.
function buildSeries(spends: Spend[], now: Date) {
  const months: { key: string; label: string; total: number }[] = [];
  const start = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  for (let i = 0; i < 6; i++) {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
    months.push({
      key: `${d.getFullYear()}-${d.getMonth()}`,
      label: MONTHS[d.getMonth()]!,
      total: 0,
    });
  }
  const idx = new Map(months.map((m, i) => [m.key, i] as const));
  for (const sp of spends) {
    const d = new Date(sp.spent_at);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    const i = idx.get(key);
    if (i === undefined) continue;
    months[i]!.total += Number(sp.amount_base ?? 0);
  }
  return months;
}

export function SpendOverTime({
  spends,
  now,
  baseCurrency,
  height = 140,
}: {
  spends: Spend[];
  now: Date;
  baseCurrency: CurrencyCode;
  height?: number;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  const reduced = useReducedMotion();

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const data = useMemo(() => buildSeries(spends, now), [spends, now]);

  return (
    <div ref={wrapRef} style={{ height }} className="overflow-visible">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={CHART_MARGIN}>
          <defs>
            <linearGradient id="spend-over-time-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.22} />
              <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--border)" strokeOpacity={0.35} vertical={false} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            minTickGap={CHART_XAXIS_MIN_TICK_GAP}
            dy={4}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={CHART_YAXIS_WIDTH}
            domain={[0, "auto"]}
            allowDataOverflow={false}
            tick={<YTick baseCurrency={baseCurrency} />}
          />
          <Tooltip
            cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <div className="rounded-[10px] border border-border/70 bg-popover px-3 py-2 text-xs shadow-lg">
                  <div className="font-medium">{label}</div>
                  <div className="mt-0.5 tabular text-muted-foreground">
                    {formatMoney(Number(payload[0].value), baseCurrency, { compact: true })}
                  </div>
                </div>
              ) : null
            }
          />
          <Area
            type="monotone"
            dataKey="total"
            stroke="var(--chart-1)"
            strokeWidth={2}
            fill="url(#spend-over-time-fill)"
            dot={false}
            activeDot={{ r: 4, fill: "var(--chart-1)", stroke: "var(--background)", strokeWidth: 2 }}
            isAnimationActive={inView && !reduced}
            animationDuration={900}
            animationEasing="ease"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

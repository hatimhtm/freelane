"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from "recharts";
import { formatMoney } from "@/lib/money";
import type { CurrencyCode } from "@/lib/supabase/types";
import {
  CHART_MARGIN,
  CHART_XAXIS_MIN_TICK_GAP,
} from "@/lib/charts/chart-defaults";

export type BarSeries = { key: string; label: string; color: string };
export type BarDatum = { month: string } & Record<string, number | string>;

// Animated stacked bars. Generic over series keys, so it does both "net vs fee"
// and any per-month breakdown. Bars grow up on scroll, respecting reduced motion.
export function BarsChart({
  data,
  series,
  currency,
  height = 240,
  stacked = true,
}: {
  data: BarDatum[];
  series: BarSeries[];
  currency: CurrencyCode;
  height?: number;
  stacked?: boolean;
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

  return (
    <div ref={wrapRef} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={CHART_MARGIN} barGap={2} barCategoryGap="22%">
          <CartesianGrid stroke="var(--border)" strokeOpacity={0.5} vertical={false} />
          <XAxis
            dataKey="month"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
            minTickGap={CHART_XAXIS_MIN_TICK_GAP}
            dy={6}
          />
          <Tooltip
            cursor={{ fill: "var(--muted)", fillOpacity: 0.4 }}
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <div className="rounded-[10px] border border-border/70 bg-popover px-3 py-2 text-xs shadow-lg">
                  <div className="font-medium">{label}</div>
                  {payload.map((p) => (
                    <div key={String(p.dataKey)} className="mt-0.5 flex items-center gap-2 tabular text-muted-foreground">
                      <span className="size-2 rounded-[2px]" style={{ background: p.color }} />
                      {series.find((s) => s.key === p.dataKey)?.label ?? String(p.dataKey)}:{" "}
                      {formatMoney(Number(p.value), currency, { compact: true })}
                    </div>
                  ))}
                </div>
              ) : null
            }
          />
          <Legend
            verticalAlign="top"
            align="right"
            height={28}
            iconType="circle"
            iconSize={8}
            formatter={(value) => (
              <span className="text-xs text-muted-foreground">
                {series.find((s) => s.key === value)?.label ?? value}
              </span>
            )}
          />
          {series.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              stackId={stacked ? "a" : undefined}
              fill={s.color}
              radius={stacked ? (i === series.length - 1 ? [12, 12, 0, 0] : [0, 0, 0, 0]) : [12, 12, 12, 12]}
              maxBarSize={44}
              isAnimationActive={inView && !reduced}
              animationDuration={900}
              animationBegin={i * 120}
              animationEasing="ease"
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

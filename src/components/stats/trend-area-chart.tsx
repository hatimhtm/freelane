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
} from "recharts";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/money";
import type { CurrencyCode } from "@/lib/supabase/types";
import {
  CHART_MARGIN,
  CHART_XAXIS_MIN_TICK_GAP,
} from "@/lib/charts/chart-defaults";

// Revenue area chart with a monthly/cumulative toggle. Re-keys the chart on
// toggle so recharts re-runs its smooth draw-in animation each time.
export function TrendAreaChart({
  data,
  currency,
  height = 260,
}: {
  data: { month: string; total: number }[];
  currency: CurrencyCode;
  height?: number;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  const [mode, setMode] = useState<"monthly" | "cumulative">("monthly");
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

  const shaped = useMemo(() => {
    if (mode === "monthly") return data;
    let run = 0;
    return data.map((d) => ({ month: d.month, total: (run += d.total) }));
  }, [data, mode]);

  return (
    <div ref={wrapRef}>
      <div className="mb-3 flex justify-end">
        <div className="inline-flex rounded-full border border-border/70 p-0.5 text-xs">
          {(["monthly", "cumulative"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn(
                "rounded-full px-2.5 py-1 font-medium capitalize transition-colors",
                mode === m ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {m}
            </button>
          ))}
        </div>
      </div>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart key={mode} data={shaped} margin={CHART_MARGIN}>
            <defs>
              <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.22} />
                <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
              </linearGradient>
            </defs>
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
              cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
              content={({ active, payload, label }) =>
                active && payload?.length ? (
                  <div className="rounded-[10px] border border-border/70 bg-popover px-3 py-2 text-xs shadow-lg">
                    <div className="font-medium">{label}</div>
                    <div className="mt-0.5 tabular text-muted-foreground">
                      {formatMoney(Number(payload[0].value), currency, { compact: true })}
                    </div>
                  </div>
                ) : null
              }
            />
            <Area
              type="natural"
              dataKey="total"
              stroke="var(--chart-1)"
              strokeWidth={2.25}
              fill="url(#trend-fill)"
              dot={false}
              activeDot={{ r: 4.5, fill: "var(--chart-1)", stroke: "var(--background)", strokeWidth: 2.5 }}
              isAnimationActive={inView && !reduced}
              animationDuration={1100}
              animationEasing="ease"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

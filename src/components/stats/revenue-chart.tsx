"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from "recharts";
import { formatMoney } from "@/lib/money";
import type { CurrencyCode } from "@/lib/supabase/types";

export function RevenueChart({
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
        <AreaChart data={data} margin={{ left: 12, right: 12, top: 8, bottom: 0 }}>
          <defs>
            <linearGradient id="rev-fill" x1="0" y1="0" x2="0" y2="1">
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
            type="monotone"
            dataKey="total"
            stroke="var(--chart-1)"
            strokeWidth={2.25}
            fill="url(#rev-fill)"
            dot={false}
            activeDot={{ r: 4.5, fill: "var(--chart-1)", stroke: "var(--background)", strokeWidth: 2.5 }}
            isAnimationActive={inView && !reduced}
            animationDuration={1100}
            animationEasing="ease"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

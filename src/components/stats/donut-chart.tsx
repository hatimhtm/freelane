"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { formatMoney } from "@/lib/money";
import type { CurrencyCode } from "@/lib/supabase/types";

export type DonutSlice = { name: string; value: number };

const PALETTE = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--muted-foreground)",
];

// Animated donut of income by client. Sweeps in on scroll; center holds the
// total. Legend lists each slice with its base-currency amount and share.
export function DonutChart({
  data,
  currency,
  height = 220,
}: {
  data: DonutSlice[];
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

  const total = data.reduce((s, d) => s + d.value, 0);

  if (data.length === 0 || total <= 0) {
    return (
      <div ref={wrapRef} className="grid place-items-center text-sm text-muted-foreground" style={{ height }}>
        No landed income yet.
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
      <div className="relative shrink-0" style={{ width: height, height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius="62%"
              outerRadius="98%"
              paddingAngle={1.5}
              stroke="var(--card)"
              strokeWidth={2}
              startAngle={90}
              endAngle={-270}
              isAnimationActive={inView && !reduced}
              animationDuration={1100}
              animationEasing="ease"
            >
              {data.map((_, i) => (
                <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }) =>
                active && payload?.length ? (
                  <div className="rounded-[10px] border border-border/70 bg-popover px-3 py-2 text-xs shadow-lg">
                    <div className="font-medium">{payload[0].name}</div>
                    <div className="mt-0.5 tabular text-muted-foreground">
                      {formatMoney(Number(payload[0].value), currency, { compact: true })} ·{" "}
                      {((Number(payload[0].value) / total) * 100).toFixed(0)}%
                    </div>
                  </div>
                ) : null
              }
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="text-center">
            <div className="display-eyebrow text-muted-foreground">Total</div>
            <div className="display-numeric tabular text-xl leading-tight">
              {formatMoney(total, currency, { compact: true })}
            </div>
          </div>
        </div>
      </div>
      <ul className="w-full min-w-0 space-y-2">
        {data.map((d, i) => (
          <li key={d.name} className="flex items-center gap-2 text-sm">
            <span
              className="size-2.5 shrink-0 rounded-[3px]"
              style={{ background: PALETTE[i % PALETTE.length] }}
            />
            <span className="min-w-0 flex-1 truncate">{d.name}</span>
            <span className="shrink-0 tabular text-muted-foreground">
              {formatMoney(d.value, currency, { compact: true })}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

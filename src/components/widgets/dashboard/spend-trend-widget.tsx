"use client";

import { MWidget } from "@/components/widgets/m-widget";
import type { CurrencyCode } from "@/lib/supabase/types";
import { formatMoney } from "@/lib/money";

// /dashboard/money — 30d daily-spend sparkline in the trailing slot.

type Props = {
  daily: number[];
  currency: CurrencyCode;
};

const TERRACOTTA = "oklch(0.7 0.13 45)";

function buildPath(values: number[]): string {
  if (values.length < 2) return "";
  const w = 200;
  const h = 36;
  const max = Math.max(1, ...values);
  const step = w / (values.length - 1);
  return values
    .map((v, i) => {
      const x = i * step;
      const y = h - (v / max) * h;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export function SpendTrendWidget({ daily, currency }: Props) {
  const total = daily.reduce((s, v) => s + v, 0);
  const path = buildPath(daily);
  return (
    <MWidget
      label="30-day spend trend"
      eyebrow="SPEND TREND"
      hero={<span className="text-[22px]">{formatMoney(total, currency, { compact: true })}</span>}
      sub={<span>last 30 days · {daily.length}d window</span>}
      trailing={
        <svg width={200} height={36} viewBox="0 0 200 36" aria-hidden className="block">
          <path d={path} fill="none" stroke={TERRACOTTA} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      }
      aiDot={{ key: "money.spend_trend", label: "Spend trend" }}
    />
  );
}

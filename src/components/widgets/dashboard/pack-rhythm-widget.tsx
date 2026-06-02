"use client";

import { useRouter } from "next/navigation";
import { MoneyFlow } from "@/components/ui/money-flow";
import { MWidget } from "@/components/widgets/m-widget";
import { Smoke } from "@/components/widgets/icons/smoke";
import type { CurrencyCode } from "@/lib/supabase/types";
import type { PackRhythmRead } from "@/lib/ai/pack-rhythm";

// T26 — Pack Rhythm M widget on Dashboard. 12-week sparkline + cost-per-week
// supporting + trend chip. Modular-relevance-gated (hides on no signal).
// Icon: canonical Freelane Smoke glyph (shared with CigarettesWidget so the
// same data type wears the same mark everywhere).

type Props = {
  read: PackRhythmRead | null;
  baseCurrency: CurrencyCode;
};

export function PackRhythmWidget({ read, baseCurrency }: Props) {
  const router = useRouter();
  if (!read || !read.line) return null;
  const series = read.weeklyTotals;
  const max = Math.max(1, ...series);
  const prev = series[series.length - 2] ?? 0;
  const current = series[series.length - 1] ?? 0;
  const trend = prev > 0 ? (current - prev) / prev : null;

  return (
    <MWidget
      label="Pack rhythm — 12 weeks"
      eyebrow="PACK RHYTHM"
      icon={<Smoke className="h-4 w-4" />}
      hero={<MoneyFlow value={read.thisWeekTotal} currency={baseCurrency} />}
      sub={
        <span className="flex items-center gap-2">
          this week
          {trend !== null && Math.abs(trend) > 0.05 && (
            <span
              className={
                "tabular-nums " +
                // Up = terracotta (warm attention); Down = acid-lime (good).
                (trend > 0
                  ? "text-[oklch(0.7_0.13_45)]"
                  : "text-[oklch(0.85_0.18_120)]")
              }
            >
              {trend > 0 ? "+" : "−"}
              {Math.round(Math.abs(trend) * 100)}%
            </span>
          )}
        </span>
      }
      supporting={read.line}
      trailing={<SparklinePath weekly={series} max={max} />}
      onOpen={() => router.push("/spending?category=cigarettes")}
    />
  );
}

function SparklinePath({ weekly, max }: { weekly: number[]; max: number }) {
  const width = 120;
  const height = 60;
  const dx = weekly.length > 1 ? width / (weekly.length - 1) : width;
  const points = weekly
    .map((v, i) => {
      const x = i * dx;
      const y = height - (v / max) * (height - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="text-foreground/70"
      aria-hidden
    >
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth={1.4} />
    </svg>
  );
}

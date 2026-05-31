"use client";

import { motion } from "motion/react";
import { Cigarette } from "lucide-react";
import { formatMoney } from "@/lib/money";
import type { CurrencyCode } from "@/lib/supabase/types";
import type { PackRhythmRead } from "@/lib/ai/pack-rhythm";

// Pack Rhythm card — sparkline + one-line read. Renders nothing when there
// are no cigarette spends in the trailing 12 weeks (the card stays calm for
// users who don't smoke).

export function PackRhythmCard({
  read,
  baseCurrency,
}: {
  read: PackRhythmRead;
  baseCurrency: CurrencyCode;
}) {
  if (!read || !read.line) return null;
  const max = Math.max(1, ...read.weeklyTotals);
  return (
    <motion.section
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className="rounded-[12px] border border-border/60 bg-card/30 px-3.5 py-3"
    >
      <header className="flex items-baseline justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Cigarette className="h-3 w-3 text-foreground/70" />
          <span className="text-[10px] uppercase tracking-[0.14em] text-foreground/70">
            Pack rhythm · 12 weeks
          </span>
        </div>
        <span className="font-display tabular text-xs">
          {formatMoney(read.thisWeekTotal, baseCurrency, { compact: true })}
        </span>
      </header>
      <p className="mt-1.5 text-sm leading-snug text-foreground">{read.line}</p>
      <Sparkline weekly={read.weeklyTotals} max={max} />
      {!read.fromAi && (
        <p className="mt-1 text-[10px] text-muted-foreground/70">
          Math-only read.
        </p>
      )}
    </motion.section>
  );
}

function Sparkline({ weekly, max }: { weekly: number[]; max: number }) {
  const width = 240;
  const height = 32;
  const w = weekly.length;
  const dx = w > 1 ? width / (w - 1) : width;
  const points = weekly
    .map((v, i) => {
      const x = i * dx;
      const y = height - (v / max) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="mt-2 h-8 w-full"
      aria-label="Weekly cigarette spend over the last 12 weeks"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        className="text-foreground/70"
      />
      {weekly.map((v, i) => {
        const x = i * dx;
        const y = height - (v / max) * height;
        return (
          <circle
            key={i}
            cx={x.toFixed(1)}
            cy={y.toFixed(1)}
            r={1.5}
            fill="currentColor"
            className="text-foreground/60"
          />
        );
      })}
    </svg>
  );
}

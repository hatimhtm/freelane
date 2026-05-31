"use client";

import { useMemo, useState } from "react";
import { formatMoney } from "@/lib/money";
import type { CurrencyCode, Spend } from "@/lib/supabase/types";

// Day-bucket the spends in O(n) once, then render a 7×N grid.
// Opacity uses a soft quantile-vs-max curve so a few big days don't bleach
// every other cell to invisibility — every spend day stays legible.
function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

interface DayCell {
  iso: string;
  day: number;
  total: number;
  count: number;
  // 0 if no spend; otherwise eased fraction of month max.
  intensity: number;
  hot: boolean;
}

const WEEKDAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];

export function SpendHeatmap({
  spends,
  year,
  month,
  baseCurrency,
}: {
  spends: Spend[];
  year: number;
  month: number;
  baseCurrency: CurrencyCode;
}) {
  const cells = useMemo<DayCell[]>(() => {
    const monthStart = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const totals = new Map<number, { total: number; count: number }>();

    for (const sp of spends) {
      const d = new Date(sp.spent_at);
      if (d.getFullYear() !== year || d.getMonth() !== month) continue;
      const day = d.getDate();
      const prev = totals.get(day) ?? { total: 0, count: 0 };
      prev.total += Number(sp.amount_base ?? 0);
      prev.count += 1;
      totals.set(day, prev);
    }

    const nonZero = Array.from(totals.values())
      .map((v) => v.total)
      .filter((t) => t > 0)
      .sort((a, b) => a - b);
    const max = nonZero[nonZero.length - 1] ?? 0;
    const p90 = quantile(nonZero, 0.9);

    const out: DayCell[] = [];
    // Leading blanks so the 1st lands on its weekday column (Mon=0).
    const leadJs = monthStart.getDay(); // 0=Sun
    const lead = (leadJs + 6) % 7;
    for (let i = 0; i < lead; i++) {
      out.push({ iso: `blank-${i}`, day: 0, total: 0, count: 0, intensity: 0, hot: false });
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const t = totals.get(day);
      const total = t?.total ?? 0;
      const count = t?.count ?? 0;
      // sqrt ease — keeps mid-range days visibly filled instead of flattening
      // toward zero next to a single outlier.
      const intensity = max > 0 && total > 0 ? Math.sqrt(total / max) : 0;
      const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      out.push({ iso, day, total, count, intensity, hot: total > 0 && total >= p90 && nonZero.length >= 4 });
    }
    return out;
  }, [spends, year, month]);

  const monthLabel = new Date(year, month, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="p-3">
      <div className="mb-2 grid grid-cols-7 gap-1.5 px-0.5 text-[10px] uppercase tracking-wide text-ink/40">
        {WEEKDAY_LABELS.map((l, i) => (
          <div key={i} className="text-center">{l}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {cells.map((c, i) =>
          c.day === 0 ? (
            <div key={c.iso + i} className="aspect-square" />
          ) : (
            <DayTile key={c.iso} cell={c} monthLabel={monthLabel} baseCurrency={baseCurrency} />
          ),
        )}
      </div>
    </div>
  );
}

function DayTile({
  cell,
  monthLabel,
  baseCurrency,
}: {
  cell: DayCell;
  monthLabel: string;
  baseCurrency: CurrencyCode;
}) {
  const [hover, setHover] = useState(false);
  const empty = cell.total === 0;
  // Map intensity → opacity in [0.08, 1.0]; hot days swap fill to terracotta.
  const opacity = empty ? 0 : 0.08 + cell.intensity * 0.92;
  const bg = cell.hot
    ? `color-mix(in oklab, var(--terracotta) ${Math.round(opacity * 100)}%, transparent)`
    : `color-mix(in oklab, var(--ink) ${Math.round(opacity * 100)}%, transparent)`;
  const dayNumColor = empty ? "text-ink/40" : opacity > 0.55 ? "text-paper/85" : "text-ink/70";
  const dateLabel = `${monthLabel.split(" ")[0]} ${cell.day}`;

  return (
    <div
      className="relative aspect-square"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div
        className={
          "h-full w-full rounded-[6px] transition-colors duration-300 " +
          (empty ? "border border-ink/10" : "")
        }
        style={empty ? undefined : { background: bg }}
      >
        <span
          className={`absolute left-1 top-0.5 text-[10px] tabular ${dayNumColor}`}
        >
          {cell.day}
        </span>
      </div>
      {hover && !empty && (
        <div
          className="pointer-events-none absolute left-1/2 top-full z-20 mt-1.5 -translate-x-1/2 whitespace-nowrap rounded-[8px] border border-ink/15 bg-paper px-2.5 py-1.5 text-[11px] shadow-lg"
          role="tooltip"
        >
          <div className="font-medium text-ink/90">{dateLabel}</div>
          <div className="tabular text-ink/70">
            {formatMoney(cell.total, baseCurrency, { compact: true })}
            <span className="ml-1.5 text-ink/45">
              · {cell.count} {cell.count === 1 ? "spend" : "spends"}
            </span>
          </div>
        </div>
      )}
      {hover && empty && (
        <div
          className="pointer-events-none absolute left-1/2 top-full z-20 mt-1.5 -translate-x-1/2 whitespace-nowrap rounded-[8px] border border-ink/15 bg-paper px-2.5 py-1.5 text-[11px] text-ink/55 shadow-lg"
          role="tooltip"
        >
          {dateLabel} · no spend
        </div>
      )}
    </div>
  );
}

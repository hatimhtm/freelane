"use client";

import { useMemo, useState } from "react";
import { formatMoney } from "@/lib/money";
import { phtDateString } from "@/lib/utils";
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

// ─────────────────────────── GitHub-style trailing-1y heatmap ──
//
// 53 weeks × 7 days grid. Weeks are columns, days are rows. Trailing 365
// days anchored to today's PHT date. Each cell is ~11px square with 2px
// gap so the whole grid fits in an M widget (~700px max width). Mobile
// falls back to horizontal scroll inside an overflow-x-auto container.
//
// 5 fill buckets (paper through ink) + an outlier swap to terracotta for
// days above the trailing-1y 99th percentile. Tooltip on hover; click
// drills into the day (not yet wired — placeholder onSelectDay callback).

const YEAR_DAYS = 365;
const WEEK_COUNT = 53;
const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

interface YearCell {
  iso: string;
  total: number;
  weekIndex: number;   // 0..52
  dayOfWeek: number;   // 0=Mon..6=Sun
  bucket: number;      // 0..5 (0=empty, 5=outlier terracotta)
  monthFirstWeek: boolean; // first week where this month begins (for label)
  month: number;
  ts: number;
}

export function SpendHeatmapYear({
  spends,
  baseCurrency,
  onSelectDay,
  selectedDay,
}: {
  spends: Spend[];
  baseCurrency: CurrencyCode;
  onSelectDay?: (isoDate: string) => void;
  // When set, the matching cell renders with an active outline so the
  // user sees what's filtering the dense list below.
  selectedDay?: string | null;
}) {
  const { cells, weeksWithMonthLabel } = useMemo(() => {
    const today = new Date();
    const todayPht = phtDateString(today);
    const todayMs = new Date(`${todayPht}T00:00:00+08:00`).getTime();
    // Walk back to the Monday >= 365 days ago. The first column is that
    // Monday's week. Each column = a Monday-anchored week.
    const dayOfWeek = (new Date(`${todayPht}T00:00:00+08:00`).getUTCDay() || 7) - 1; // 0=Mon..6=Sun
    // Today's column position is at WEEK_COUNT - 1; the day-row is dayOfWeek.
    const todayWeekIndex = WEEK_COUNT - 1;
    // Sum per-day base amounts keyed by ISO PHT date.
    const byDate = new Map<string, number>();
    const cutoffMs = todayMs - (YEAR_DAYS - 1) * DAY_MS_LOCAL;
    for (const sp of spends) {
      const d = new Date(sp.spent_at);
      const t = d.getTime();
      if (t < cutoffMs || t > todayMs + DAY_MS_LOCAL) continue;
      const iso = phtDateString(d);
      byDate.set(iso, (byDate.get(iso) ?? 0) + Number(sp.amount_base ?? 0));
    }

    // Build cells.
    const all: YearCell[] = [];
    for (let i = 0; i < YEAR_DAYS; i++) {
      const offset = YEAR_DAYS - 1 - i; // 364 at start, 0 at end (today)
      const ts = todayMs - offset * DAY_MS_LOCAL;
      const iso = phtDateString(new Date(ts));
      const total = byDate.get(iso) ?? 0;
      // Position math: day-of-week of this date.
      const localDow =
        (new Date(`${iso}T00:00:00+08:00`).getUTCDay() || 7) - 1;
      // Each Monday starts a new column. Days within a week stack rows 0..6.
      // The first column is rendered from offset=YEAR_DAYS-1 plus its
      // Monday-alignment leading nulls.
      // We compute weekIndex as: end-aligned, so today sits in
      // column todayWeekIndex.
      const dayOffsetFromToday = offset; // today=0
      // Days fall in the same column when they share the same Monday.
      // Today's Monday is `todayWeekIndex` column. Each Monday backwards
      // is `todayWeekIndex - n` weeks ago.
      const fromTodayMonday = dayOffsetFromToday + dayOfWeek - localDow;
      const weeksAgo = Math.floor(fromTodayMonday / 7);
      const weekIndex = todayWeekIndex - weeksAgo;
      if (weekIndex < 0 || weekIndex >= WEEK_COUNT) continue;
      const date = new Date(ts);
      const monthFirstWeek = date.getDate() <= 7; // any week containing day 1..7 of the month
      all.push({
        iso,
        total,
        weekIndex,
        dayOfWeek: localDow,
        bucket: 0,
        monthFirstWeek,
        month: date.getMonth(),
        ts,
      });
    }
    // Brief-locked fixed PHP thresholds (NOT quartiles). The earlier
    // quartile-of-non-zero derivation drifted across users — a user who
    // logged mostly small spends saw ₱200 fall in bucket 4 while a user
    // logging mostly large spends saw ₱2k fall in bucket 1, even though
    // the heat-map is supposed to read absolutely (₱200 is "warm", ₱2k
    // is "hot"). The brief locks the bands so the visual encoding is
    // comparable across users and across windows for the same user.
    //   0 → paper                    (no spend)
    //   1 → ink 20% (₱1..100)
    //   2 → ink 45% (₱101..300)
    //   3 → ink 60% (₱301..700)
    //   4 → ink 80% (₱701..1500)
    //   5 → ink 100% / terracotta    (₱1500+ — outlier swap)
    for (const c of all) {
      if (c.total === 0) {
        c.bucket = 0;
        continue;
      }
      if (c.total <= 100) c.bucket = 1;
      else if (c.total <= 300) c.bucket = 2;
      else if (c.total <= 700) c.bucket = 3;
      else if (c.total <= 1500) c.bucket = 4;
      else c.bucket = 5;
    }

    // Month labels — the first week of each month.
    const weeksWithMonthLabel: Map<number, string> = new Map();
    let lastMonthLabeled = -1;
    for (const c of all) {
      if (
        c.monthFirstWeek &&
        c.month !== lastMonthLabeled &&
        !weeksWithMonthLabel.has(c.weekIndex)
      ) {
        weeksWithMonthLabel.set(c.weekIndex, MONTH_LABELS[c.month]!);
        lastMonthLabeled = c.month;
      }
    }
    // If the trailing-1y window starts mid-month (e.g., today is the
    // 8th), no cell in week 0 will satisfy date <= 7, and the first
    // month label drops silently. Force-label week 0 with the month
    // of the earliest visible cell so every column header reads.
    if (all.length > 0 && !weeksWithMonthLabel.has(0)) {
      // Find the earliest cell that lives in week 0; first cell by
      // iteration order is the earliest because all[] was built
      // forward from the cutoff.
      const first = all.find((c) => c.weekIndex === 0) ?? all[0];
      weeksWithMonthLabel.set(0, MONTH_LABELS[first.month]!);
    }

    return { cells: all, weeksWithMonthLabel };
  }, [spends]);

  // Grid using CSS — fixed cell + gap so the math is honest.
  const CELL = 11;

  // Index cells by (weekIndex, dayOfWeek) for O(1) lookup during render.
  const cellByPos = useMemo(() => {
    const m = new Map<string, YearCell>();
    for (const c of cells) m.set(`${c.weekIndex}:${c.dayOfWeek}`, c);
    return m;
  }, [cells]);

  return (
    <div className="overflow-x-auto p-3">
      <div className="inline-block">
        {/* Month labels row */}
        <div
          className="grid grid-cols-[18px_repeat(53,minmax(0,11px))] gap-[2px] pb-1 text-[9px] uppercase tracking-wide text-ink/45"
        >
          <div />
          {Array.from({ length: WEEK_COUNT }).map((_, w) => (
            <div key={w} className="text-left">
              {weeksWithMonthLabel.get(w) ?? ""}
            </div>
          ))}
        </div>
        <div className="flex gap-[6px]">
          {/* Weekday labels column — Mon / Wed / Fri */}
          <div
            className="grid grid-rows-7 gap-[2px] text-[9px] uppercase tracking-wide text-ink/45"
            style={{ width: 18 }}
          >
            {["Mon", "", "Wed", "", "Fri", "", ""].map((l, i) => (
              <div
                key={i}
                className="flex items-center"
                style={{ height: CELL }}
              >
                {l}
              </div>
            ))}
          </div>
          {/* Cell grid */}
          <div
            className="grid grid-rows-7 gap-[2px]"
            style={{
              gridTemplateColumns: `repeat(${WEEK_COUNT}, ${CELL}px)`,
              gridAutoFlow: "column",
            }}
          >
            {Array.from({ length: WEEK_COUNT }).flatMap((_, w) =>
              Array.from({ length: 7 }).map((__, d) => {
                const c = cellByPos.get(`${w}:${d}`);
                if (!c) {
                  // "Not in window" — distinct from "no spend". Render
                  // a dashed hairline outline (no fill) so the grid keeps
                  // its shape but the user can tell pre-cutoff / future
                  // slots apart from real zero-spend days.
                  return (
                    <div
                      key={`${w}:${d}`}
                      className="rounded-[2px] border border-dashed border-foreground/[0.08]"
                      style={{ width: CELL, height: CELL }}
                      aria-hidden
                    />
                  );
                }
                return (
                  <YearCellTile
                    key={`${w}:${d}`}
                    cell={c}
                    cellSize={CELL}
                    baseCurrency={baseCurrency}
                    onSelectDay={onSelectDay}
                    isSelected={selectedDay === c.iso}
                  />
                );
              }),
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const DAY_MS_LOCAL = 86_400_000;

function YearCellTile({
  cell,
  cellSize,
  baseCurrency,
  onSelectDay,
  isSelected,
}: {
  cell: YearCell;
  cellSize: number;
  baseCurrency: CurrencyCode;
  onSelectDay?: (iso: string) => void;
  isSelected?: boolean;
}) {
  const [hover, setHover] = useState(false);
  const interactive = typeof onSelectDay === "function";
  // Brief-locked fill ladder: paper (no spend) → ink 20/45/60/80 →
  // terracotta 100 (₱1500+ outlier swap). Matches the bucket thresholds
  // computed upstream so the visual encoding reads the same across users.
  const bg = (() => {
    switch (cell.bucket) {
      case 0:
        return "transparent";
      case 1:
        return "color-mix(in oklab, var(--ink) 20%, transparent)";
      case 2:
        return "color-mix(in oklab, var(--ink) 45%, transparent)";
      case 3:
        return "color-mix(in oklab, var(--ink) 60%, transparent)";
      case 4:
        return "color-mix(in oklab, var(--ink) 80%, transparent)";
      case 5:
        return "color-mix(in oklab, var(--terracotta) 100%, transparent)";
      default:
        return "transparent";
    }
  })();
  const dateLabel = new Date(cell.ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  // Tooltip collision avoidance — Sunday + Saturday rows would push the
  // tooltip below the panel and clip; flip them above the cell.
  const tooltipBelow = cell.dayOfWeek <= 3; // Mon..Thu
  const tooltipClass = tooltipBelow ? "top-full mt-1" : "bottom-full mb-1";
  // Selected outline — visual confirmation the dense list below is
  // filtered to this day. Hover keeps the light ring on every cell.
  const selectedRing = isSelected
    ? "ring-2 ring-ink/55"
    : "hover:ring-1 hover:ring-ink/30";
  // Non-interactive when no click handler — render as a div so the
  // button affordance doesn't lie when there's nothing to click.
  if (!interactive) {
    return (
      <div
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        className={`relative rounded-[2px] transition-colors duration-200 ${selectedRing} ${cell.bucket === 0 ? "border border-ink/8" : ""}`}
        style={{ width: cellSize, height: cellSize, background: bg }}
        aria-label={`${dateLabel}: ${formatMoney(cell.total, baseCurrency, { compact: true })} spent`}
        role="img"
      >
        {hover && (
          <span
            className={`pointer-events-none absolute left-1/2 z-30 -translate-x-1/2 whitespace-nowrap rounded-[8px] border border-ink/15 bg-paper px-2 py-1 text-[10.5px] shadow-lg ${tooltipClass}`}
            role="tooltip"
          >
            <span className="font-medium text-ink/90">{dateLabel}</span>
            <span className="ml-1.5 tabular text-ink/65">
              {cell.total > 0
                ? `${formatMoney(cell.total, baseCurrency, { compact: true })} spent`
                : "no spend"}
            </span>
          </span>
        )}
      </div>
    );
  }
  return (
    <button
      type="button"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => onSelectDay?.(cell.iso)}
      className={`relative rounded-[2px] transition-colors duration-200 ${selectedRing} ${cell.bucket === 0 ? "border border-ink/8" : ""}`}
      style={{ width: cellSize, height: cellSize, background: bg }}
      aria-label={`${dateLabel}: ${formatMoney(cell.total, baseCurrency, { compact: true })} spent`}
      aria-pressed={isSelected || undefined}
    >
      {hover && (
        <span
          className={`pointer-events-none absolute left-1/2 z-30 -translate-x-1/2 whitespace-nowrap rounded-[8px] border border-ink/15 bg-paper px-2 py-1 text-[10.5px] shadow-lg ${tooltipClass}`}
          role="tooltip"
        >
          <span className="font-medium text-ink/90">{dateLabel}</span>
          <span className="ml-1.5 tabular text-ink/65">
            {cell.total > 0
              ? `${formatMoney(cell.total, baseCurrency, { compact: true })} spent`
              : "no spend"}
          </span>
        </span>
      )}
    </button>
  );
}

"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type MonthValue = { year: number; month: number };

type Props = {
  value: MonthValue;
  onChange: (next: MonthValue) => void;
  /** Optional headline stats slot rendered to the right of the month label. */
  summary?: React.ReactNode;
  /** Optional secondary controls (e.g. "Jump to today") rendered far-right. */
  actions?: React.ReactNode;
  className?: string;
  /** Lock navigation past this month (inclusive). */
  maxMonth?: MonthValue;
  /** Lock navigation before this month (inclusive). */
  minMonth?: MonthValue;
};

const LABEL_FMT = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
});

function step({ year, month }: MonthValue, delta: number): MonthValue {
  const idx = year * 12 + (month - 1) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

function compare(a: MonthValue, b: MonthValue) {
  return a.year * 12 + a.month - (b.year * 12 + b.month);
}

/**
 * `< May 2026 >` style month switcher with optional inline summary slot.
 * Header bar — sits flush with the page body, denser than a PageHeader.
 */
export function PageMonthNav({
  value,
  onChange,
  summary,
  actions,
  className,
  maxMonth,
  minMonth,
}: Props) {
  const label = React.useMemo(
    () => LABEL_FMT.format(new Date(value.year, value.month - 1, 1)),
    [value.year, value.month],
  );

  const prev = step(value, -1);
  const next = step(value, 1);
  const canPrev = minMonth ? compare(prev, minMonth) >= 0 : true;
  const canNext = maxMonth ? compare(next, maxMonth) <= 0 : true;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-foreground/10 pb-3",
        className,
      )}
    >
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Previous month"
          disabled={!canPrev}
          onClick={() => canPrev && onChange(prev)}
        >
          <ChevronLeft />
        </Button>
        <h2
          aria-live="polite"
          className="font-display min-w-[10ch] text-center text-xl leading-none tracking-tight"
          style={{ fontVariationSettings: '"opsz" 144, "SOFT" 40' }}
        >
          {label}
        </h2>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Next month"
          disabled={!canNext}
          onClick={() => canNext && onChange(next)}
        >
          <ChevronRight />
        </Button>
      </div>
      {summary && (
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
          {summary}
        </div>
      )}
      {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/**
 * Small helper for rendering one stat inside `summary`. Keeps the spacing
 * and label-vs-value typography consistent across pages.
 */
export function MonthNavStat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: React.ReactNode;
  tone?: "neutral" | "positive" | "warning";
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">
        {label}
      </span>
      <span
        className={cn(
          "tabular text-sm font-medium",
          tone === "neutral" && "text-foreground",
          tone === "positive" && "text-[var(--color-positive,theme(colors.lime.400))]",
          tone === "warning" && "text-[var(--color-warning,theme(colors.orange.400))]",
        )}
      >
        {value}
      </span>
    </div>
  );
}

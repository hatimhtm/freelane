"use client";

import { cn } from "@/lib/utils";

// Day strip — row of small dots, one per day in the period; today bold,
// past days inked, future days muted. Reads "12 of 30" at a glance.

export function DayStrip({
  total,
  current,
  tone = "default",
  className,
  width,
}: {
  total: number;
  current: number; // 0-indexed; current dot is bold
  tone?: "default" | "lime" | "terracotta" | "muted";
  className?: string;
  width?: number;
}) {
  const dots = Math.max(1, total);
  const accent =
    tone === "lime"
      ? "oklch(0.85 0.18 120)"
      : tone === "terracotta"
        ? "oklch(0.7 0.13 45)"
        : tone === "muted"
          ? "oklch(0.7 0 0 / 0.5)"
          : "currentColor";
  const dotWidth = width ? width / dots : 6;
  const gap = 2;
  const r = Math.max(1.2, Math.min(2.4, dotWidth / 2 - gap / 2));
  const w = width ?? dots * (r * 2 + gap);
  const h = Math.max(6, r * 2 + 4);
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className={cn("text-foreground", className)}
      aria-hidden
    >
      {Array.from({ length: dots }).map((_, i) => {
        const cx = (i + 0.5) * (w / dots);
        const cy = h / 2;
        const isPast = i < current;
        const isToday = i === current;
        return (
          <circle
            key={i}
            cx={cx}
            cy={cy}
            r={isToday ? r + 0.4 : r}
            fill={isToday ? accent : isPast ? "currentColor" : "currentColor"}
            fillOpacity={isToday ? 1 : isPast ? 0.6 : 0.18}
          />
        );
      })}
    </svg>
  );
}

"use client";

import { cn } from "@/lib/utils";

// Fill bar — thin horizontal, two-tone. For saving-toward-target, day-budget
// remaining, cigarettes-vs-baseline.

export function FillBar({
  fill,
  width = 160,
  height = 6,
  tone = "default",
  className,
}: {
  fill: number; // 0..1
  width?: number;
  height?: number;
  tone?: "default" | "lime" | "terracotta" | "rose" | "muted";
  className?: string;
}) {
  const f = Math.max(0, Math.min(1, fill));
  const accent =
    tone === "lime"
      ? "oklch(0.85 0.18 120)"
      : tone === "terracotta"
        ? "oklch(0.7 0.13 45)"
        : tone === "rose"
          ? "oklch(0.65 0.21 22)"
          : tone === "muted"
            ? "oklch(0.7 0 0 / 0.5)"
            : "currentColor";
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("text-foreground", className)}
      aria-hidden
    >
      <rect x={0} y={0} width={width} height={height} rx={height / 2} fill="currentColor" fillOpacity={0.1} />
      <rect x={0} y={0} width={width * f} height={height} rx={height / 2} fill={accent} />
    </svg>
  );
}

"use client";

import { cn } from "@/lib/utils";

// Trail-line — horizontal stroke with a moving inked dot along the journey.
// For progress along a journey (period progress, recovery progress, savings).

export function TrailLine({
  progress,
  width = 160,
  height = 16,
  tone = "default",
  className,
}: {
  progress: number; // 0..1
  width?: number;
  height?: number;
  tone?: "default" | "lime" | "terracotta" | "muted";
  className?: string;
}) {
  const p = Math.max(0, Math.min(1, progress));
  const y = height / 2;
  const x = 4 + (width - 8) * p;
  const accent =
    tone === "lime"
      ? "oklch(0.85 0.18 120)"
      : tone === "terracotta"
        ? "oklch(0.7 0.13 45)"
        : tone === "muted"
          ? "oklch(0.7 0 0 / 0.5)"
          : "currentColor";
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("text-foreground/40", className)}
      aria-hidden
    >
      <line x1={4} y1={y} x2={width - 4} y2={y} stroke="currentColor" strokeOpacity={0.2} strokeWidth={1.2} />
      <line x1={4} y1={y} x2={x} y2={y} stroke={accent} strokeWidth={1.6} strokeLinecap="round" />
      <circle cx={x} cy={y} r={3.2} fill={accent} />
    </svg>
  );
}

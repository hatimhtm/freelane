"use client";

import { cn } from "@/lib/utils";

// Phase-moon — a circle inked from one side, like a lunar phase. Reads
// "11 of 30" at a glance. Pure SVG, no external deps.

export function PhaseMoon({
  fraction,
  size = 56,
  tone = "default",
  className,
}: {
  fraction: number; // 0..1
  size?: number;
  tone?: "default" | "lime" | "terracotta" | "muted";
  className?: string;
}) {
  const f = Math.max(0, Math.min(1, fraction));
  const r = size / 2 - 1;
  const cx = size / 2;
  const cy = size / 2;
  // Approximate filled crescent via clipping a chord.
  const x = cx - r + 2 * r * f;
  const stroke = "currentColor";
  const fill =
    tone === "lime"
      ? "oklch(0.85 0.18 120)"
      : tone === "terracotta"
        ? "oklch(0.7 0.13 45)"
        : tone === "muted"
          ? "oklch(0.7 0 0 / 0.4)"
          : "currentColor";

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={cn("text-foreground", className)}
      aria-hidden
    >
      <defs>
        <clipPath id={`pm-${size}-${Math.round(f * 100)}`}>
          <rect x={0} y={0} width={x} height={size} />
        </clipPath>
      </defs>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={stroke} strokeOpacity={0.15} strokeWidth={1.2} />
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill={fill}
        clipPath={`url(#pm-${size}-${Math.round(f * 100)})`}
      />
    </svg>
  );
}

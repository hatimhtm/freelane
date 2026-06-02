"use client";

import { cn } from "@/lib/utils";

// Stack bar — segmented thin horizontal showing breakdown. For wallet
// (in / out / held) or period (spent / planned / remaining).

export type StackSegment = {
  value: number;
  tone?: "default" | "lime" | "terracotta" | "rose" | "muted";
};

const TONE_FILL: Record<NonNullable<StackSegment["tone"]>, string> = {
  default: "currentColor",
  lime: "oklch(0.85 0.18 120)",
  terracotta: "oklch(0.7 0.13 45)",
  rose: "oklch(0.65 0.21 22)",
  muted: "oklch(0.7 0 0 / 0.45)",
};

export function StackBar({
  segments,
  width = 160,
  height = 8,
  className,
}: {
  segments: StackSegment[];
  width?: number;
  height?: number;
  className?: string;
}) {
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  if (total <= 0) {
    return (
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} aria-hidden>
        <rect x={0} y={0} width={width} height={height} rx={height / 2} fill="currentColor" fillOpacity={0.1} />
      </svg>
    );
  }
  // Compute cumulative offsets up-front so the render pass is purely
  // declarative (lint rule: no side effects during render).
  const offsets: { x: number; w: number }[] = [];
  let running = 0;
  for (const s of segments) {
    const w = (Math.max(0, s.value) / total) * width;
    offsets.push({ x: running, w });
    running += w;
  }
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("text-foreground", className)}
      aria-hidden
    >
      <rect x={0} y={0} width={width} height={height} rx={height / 2} fill="currentColor" fillOpacity={0.08} />
      {segments.map((s, i) => (
        <rect
          key={i}
          x={offsets[i].x}
          y={0}
          width={offsets[i].w}
          height={height}
          fill={TONE_FILL[s.tone ?? "default"]}
          // First and last get rounded corners; middle segments stay sharp.
          rx={i === 0 || i === segments.length - 1 ? height / 2 : 0}
        />
      ))}
    </svg>
  );
}

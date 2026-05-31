"use client";

import { useMemo } from "react";
import NumberFlow from "@number-flow/react";
import { motion } from "motion/react";
import type { SafeToSpendBreakdown } from "@/lib/safe-to-spend";

const EASE = [0.22, 1, 0.36, 1] as const;

// 28px outer, 2px stroke, leaves ~12px inner. Tight enough to live beside an
// input row without competing with the amount itself.
const SIZE = 28;
const STROKE = 2;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

// Color stops in oklch so the blend feels continuous (lime through neutral ink
// through terracotta). Channels are interpolated independently below — no step.
const STOP_SAFE = { l: 0.78, c: 0.18, h: 124 };   // lime-leaning
const STOP_NEUTRAL = { l: 0.45, c: 0.02, h: 80 }; // ink-leaning, low chroma
const STOP_WARN = { l: 0.6, c: 0.16, h: 36 };     // terracotta

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// Map ratio [0, 1.5+] to oklch via two segments:
//   0   → SAFE     (full lime tilt)
//   1.0 → NEUTRAL  (at the allowance, calm ink)
//   1.5+→ WARN     (over the allowance, terracotta)
// The midpoint sits at exactly the daily allowance so the user feels the
// crossover before reaching the warning end.
function blendColor(ratio: number): string {
  const r = Math.max(0, Math.min(1.5, ratio));
  if (r <= 1) {
    const t = r;
    const l = lerp(STOP_SAFE.l, STOP_NEUTRAL.l, t);
    const c = lerp(STOP_SAFE.c, STOP_NEUTRAL.c, t);
    const h = lerp(STOP_SAFE.h, STOP_NEUTRAL.h, t);
    return `oklch(${l.toFixed(3)} ${c.toFixed(3)} ${h.toFixed(1)})`;
  }
  const t = (r - 1) / 0.5;
  const l = lerp(STOP_NEUTRAL.l, STOP_WARN.l, t);
  const c = lerp(STOP_NEUTRAL.c, STOP_WARN.c, t);
  const h = lerp(STOP_NEUTRAL.h, STOP_WARN.h, t);
  return `oklch(${l.toFixed(3)} ${c.toFixed(3)} ${h.toFixed(1)})`;
}

export function SafeToSpendImpactDial({
  proposedAmountBase,
  baseline,
}: {
  proposedAmountBase: number;
  baseline: SafeToSpendBreakdown;
}) {
  const proposed = Math.max(0, proposedAmountBase);
  const allowance = Math.max(baseline.colFloorBase, baseline.dailyAllowanceBase);
  const safeBefore = Math.max(0, Math.round(baseline.safeTodayBase));

  const ratio = allowance > 0 ? proposed / allowance : 0;
  const atRest = proposed === 0;

  const { strokeColor, dashOffset, safeAfter } = useMemo(() => {
    // At rest: dial sits as a calm ink ring with no fill arc.
    if (atRest) {
      return {
        strokeColor: "oklch(from var(--ink) l c h / 0.35)",
        dashOffset: CIRCUMFERENCE,
        safeAfter: safeBefore,
      };
    }
    const clamped = Math.min(1.5, ratio);
    // Map clamped ratio [0, 1.5] to full circumference — 1.0 fills two thirds.
    const filled = (clamped / 1.5) * CIRCUMFERENCE;
    return {
      strokeColor: blendColor(ratio),
      dashOffset: CIRCUMFERENCE - filled,
      safeAfter: Math.max(0, Math.round(baseline.safeTodayBase - proposed)),
    };
  }, [atRest, ratio, safeBefore, baseline.safeTodayBase, proposed]);

  return (
    <div className="flex flex-col items-start gap-1.5">
      <div className="flex items-center gap-2.5">
        <svg
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          aria-hidden
          className="shrink-0"
        >
          {/* Hairline track — ink at 10% so the empty arc still reads. */}
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke="oklch(from var(--ink) l c h / 0.1)"
            strokeWidth={STROKE}
          />
          {/* Live arc — starts at 12 o'clock, sweeps clockwise. Color and
              offset both animate via motion so neither jumps. */}
          <motion.circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
            initial={false}
            animate={{ stroke: strokeColor, strokeDashoffset: dashOffset }}
            transition={{ duration: 0.4, ease: EASE }}
          />
        </svg>

        <div className="text-[12px] leading-tight tabular text-foreground/70">
          {atRest ? (
            <span>
              Safe today{" "}
              <NumberFlow
                value={safeBefore}
                format={{ style: "currency", currency: "PHP", maximumFractionDigits: 0 }}
                transformTiming={{ duration: 400, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }}
                className="font-medium text-foreground"
              />
            </span>
          ) : (
            <span>
              After this{" "}
              <NumberFlow
                value={safeAfter}
                format={{ style: "currency", currency: "PHP", maximumFractionDigits: 0 }}
                transformTiming={{ duration: 400, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }}
                className="font-medium text-foreground"
              />{" "}
              <span className="text-foreground/45">
                (was{" "}
                <NumberFlow
                  value={safeBefore}
                  format={{ style: "currency", currency: "PHP", maximumFractionDigits: 0 }}
                  transformTiming={{ duration: 400, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }}
                />
                )
              </span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

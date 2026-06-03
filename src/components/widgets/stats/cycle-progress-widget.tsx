"use client";

import { CalendarClock } from "lucide-react";
import { AiDot } from "@/components/widgets/ai-dot";
import { formatMoney } from "@/lib/money";
import type { CurrencyCode } from "@/lib/supabase/types";

// Cycle progress — Money/M widget. Where we are in the PHT month vs
// where spending stands. Hidden by parent when the scope range
// doesn't include the current PHT day (the widget is intentionally
// "right now" framed).

export type CycleProgressWidgetProps = {
  scope: string;
  data: {
    monthLabel: string;
    pctElapsed: number;
    spentMtd: number;
    spentPrevMonthSamePct: number | null;
  };
  baseCurrency: CurrencyCode;
};

export function CycleProgressWidget({
  scope,
  data,
  baseCurrency,
}: CycleProgressWidgetProps) {
  const cardKey = `stats.${scope}.cycle_progress`;
  const pct = Math.round(data.pctElapsed * 100);
  const pace = data.spentPrevMonthSamePct;
  const delta =
    typeof pace === "number" && pace > 0
      ? Math.round(((data.spentMtd - pace) / pace) * 100)
      : null;
  return (
    <div className="group relative flex min-h-[200px] w-full flex-col rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex items-start gap-2">
        <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-foreground/[0.04] text-foreground/70">
          <CalendarClock className="h-4 w-4" />
        </div>
        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          Cycle progress
        </div>
      </div>
      <div className="mt-3">
        <div className="display-headline text-[28px] leading-none tabular-nums text-foreground">
          {pct}% <span className="text-[14px] text-muted-foreground">of {data.monthLabel}</span>
        </div>
        <div className="mt-1.5 text-[12px] text-muted-foreground">
          Spent {formatMoney(data.spentMtd, baseCurrency, { compact: true })} so far
          {delta !== null && (
            <>
              {" · "}
              <span className="tabular-nums">
                {delta > 0 ? "+" : ""}
                {delta}%
              </span>{" "}
              vs last month at this point
            </>
          )}
        </div>
      </div>
      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-foreground/[0.06]">
        <div
          className="h-full bg-foreground/40 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <AiDot
        card={{
          key: cardKey,
          label: "Cycle progress",
          data: {
            scope,
            month: data.monthLabel,
            pct_elapsed: data.pctElapsed,
            spent_mtd: data.spentMtd,
            spent_prev_same_pct: data.spentPrevMonthSamePct,
          },
        }}
        question="Am I pacing okay for this cycle?"
      />
    </div>
  );
}

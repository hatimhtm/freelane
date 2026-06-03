"use client";

import { Compass } from "lucide-react";
import { AiDot } from "@/components/widgets/ai-dot";
import { formatMoney } from "@/lib/money";
import type { CurrencyCode } from "@/lib/supabase/types";

// Runway — Money/S widget. Days = current balance / scope-derived
// daily burn. Hidden by getRunway() in lib/stats/queries.ts when scope
// is unbounded (no clean daily-burn denominator) or when range.toPht
// is a past day (mixing present balance with historical burn would
// mislead). Parent's null-gate then skips the widget.

export type RunwayWidgetProps = {
  scope: string;
  data: { days: number; balance: number; dailyBurn: number };
  baseCurrency: CurrencyCode;
};

export function RunwayWidget({ scope, data, baseCurrency }: RunwayWidgetProps) {
  const cardKey = `stats.${scope}.runway`;
  const days = Math.round(data.days);
  return (
    <div className="group relative flex aspect-square min-h-[160px] w-full flex-col justify-between rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex items-start gap-2">
        <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-foreground/[0.04] text-foreground/70">
          <Compass className="h-4 w-4" />
        </div>
        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          Runway
        </div>
      </div>
      <div className="space-y-1">
        <div className="display-headline text-[28px] leading-none tabular-nums text-foreground">
          {days} <span className="text-[14px] text-muted-foreground">days</span>
        </div>
        <div className="text-[11px] leading-tight text-muted-foreground">
          {formatMoney(data.balance, baseCurrency, { compact: true })} ÷{" "}
          {formatMoney(data.dailyBurn, baseCurrency, { compact: true })}/day
        </div>
      </div>
      <AiDot
        card={{
          key: cardKey,
          label: "Runway",
          data: { scope, days: data.days, balance: data.balance, daily_burn: data.dailyBurn },
        }}
        question="What stretches my runway the most?"
      />
    </div>
  );
}

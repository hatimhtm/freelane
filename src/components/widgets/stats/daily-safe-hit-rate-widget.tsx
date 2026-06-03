"use client";

import { Shield } from "lucide-react";
import { AiDot } from "@/components/widgets/ai-dot";

// Daily Safe hit rate — Behavior/S widget. % of days within scope
// where the user stayed under the morning safe-to-spend snapshot.
// Hidden upstream when no snapshots exist in scope.

export type DailySafeHitRateWidgetProps = {
  scope: string;
  data: { hitDays: number; totalDays: number; rate: number };
};

export function DailySafeHitRateWidget({ scope, data }: DailySafeHitRateWidgetProps) {
  const cardKey = `stats.${scope}.daily_safe_hit_rate`;
  const pct = Math.round(data.rate * 100);
  return (
    <div className="group relative flex aspect-square min-h-[160px] w-full flex-col justify-between rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex items-start gap-2">
        <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-foreground/[0.04] text-foreground/70">
          <Shield className="h-4 w-4" />
        </div>
        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          Safe-day rate
        </div>
      </div>
      <div className="space-y-1">
        <div className="display-headline text-[28px] leading-none tabular-nums text-foreground">
          {pct}%
        </div>
        <div className="text-[11px] leading-tight text-muted-foreground">
          {data.hitDays}/{data.totalDays} days stayed under the morning safe
        </div>
      </div>
      <AiDot
        card={{
          key: cardKey,
          label: "Daily safe hit rate",
          data: { scope, hit_days: data.hitDays, total_days: data.totalDays, rate: data.rate },
        }}
        question="What helps the hit-rate stay up?"
      />
    </div>
  );
}

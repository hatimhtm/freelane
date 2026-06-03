"use client";

import { ListChecks } from "lucide-react";
import { AiDot } from "@/components/widgets/ai-dot";

// Plan completion rate — Behavior/S widget. % of planned_spends in
// scope that have reached the done/bought state.

export type PlanCompletionRateWidgetProps = {
  scope: string;
  data: { completed: number; total: number; rate: number };
};

export function PlanCompletionRateWidget({
  scope,
  data,
}: PlanCompletionRateWidgetProps) {
  const cardKey = `stats.${scope}.plan_completion_rate`;
  const pct = Math.round(data.rate * 100);
  return (
    <div className="group relative flex aspect-square min-h-[160px] w-full flex-col justify-between rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex items-start gap-2">
        <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-foreground/[0.04] text-foreground/70">
          <ListChecks className="h-4 w-4" />
        </div>
        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          Plans followed through
        </div>
      </div>
      <div className="space-y-1">
        <div className="display-headline text-[28px] leading-none tabular-nums text-foreground">
          {pct}%
        </div>
        <div className="text-[11px] leading-tight text-muted-foreground">
          {data.completed}/{data.total} plans landed
        </div>
      </div>
      <AiDot
        card={{
          key: cardKey,
          label: "Plan completion rate",
          data: { scope, completed: data.completed, total: data.total },
        }}
        question="What helps me actually finish a plan?"
      />
    </div>
  );
}

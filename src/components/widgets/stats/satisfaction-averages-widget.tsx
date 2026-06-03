"use client";

import { Smile } from "lucide-react";
import { AiDot } from "@/components/widgets/ai-dot";

// Satisfaction averages — Journey/S widget. Average post-purchase
// satisfaction rating across planned_spends with a recorded rating
// in scope.

export type SatisfactionAveragesWidgetProps = {
  scope: string;
  data: { averageRating: number; sampleSize: number };
};

export function SatisfactionAveragesWidget({
  scope,
  data,
}: SatisfactionAveragesWidgetProps) {
  const cardKey = `stats.${scope}.satisfaction_averages`;
  const rounded = data.averageRating.toFixed(1);
  return (
    <div className="group relative flex aspect-square min-h-[160px] w-full flex-col justify-between rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex items-start gap-2">
        <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-foreground/[0.04] text-foreground/70">
          <Smile className="h-4 w-4" />
        </div>
        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          Avg satisfaction
        </div>
      </div>
      <div className="space-y-1">
        <div className="display-headline text-[28px] leading-none tabular-nums text-foreground">
          {rounded}
          <span className="text-[14px] text-muted-foreground">/5</span>
        </div>
        <div className="text-[11px] leading-tight text-muted-foreground">
          across {data.sampleSize} rated {data.sampleSize === 1 ? "plan" : "plans"}
        </div>
      </div>
      <AiDot
        card={{
          key: cardKey,
          label: "Satisfaction averages",
          data: {
            scope,
            average_rating: data.averageRating,
            sample_size: data.sampleSize,
          },
        }}
        question="What kinds of purchases land highest for me?"
      />
    </div>
  );
}

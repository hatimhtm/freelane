"use client";

import { Footprints } from "lucide-react";
import { AiDot } from "@/components/widgets/ai-dot";

// Vendor visit frequency — Behavior/S widget. Visits-per-week to the
// top vendor in scope. Returns null upstream when fewer than 4 weeks
// of data exist (noisy signal).

export type VendorVisitFrequencyWidgetProps = {
  scope: string;
  data: { vendorName: string; visits: number; weeks: number; visitsPerWeek: number };
};

export function VendorVisitFrequencyWidget({
  scope,
  data,
}: VendorVisitFrequencyWidgetProps) {
  const cardKey = `stats.${scope}.vendor_visit_frequency`;
  return (
    <div className="group relative flex aspect-square min-h-[160px] w-full flex-col justify-between rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex items-start gap-2">
        <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-foreground/[0.04] text-foreground/70">
          <Footprints className="h-4 w-4" />
        </div>
        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          Visit rhythm
        </div>
      </div>
      <div className="space-y-1">
        <div className="display-headline text-[28px] leading-none tabular-nums text-foreground">
          {data.visitsPerWeek.toFixed(1)}×
        </div>
        <div className="text-[11px] leading-tight text-muted-foreground">
          per week to {data.vendorName} ·{" "}
          <span className="tabular-nums">{data.visits}</span> visits over{" "}
          <span className="tabular-nums">{data.weeks}</span>w
        </div>
      </div>
      <AiDot
        card={{
          key: cardKey,
          label: "Vendor visit rhythm",
          data: {
            scope,
            vendor_name: data.vendorName,
            visits_per_week: data.visitsPerWeek,
            weeks: data.weeks,
          },
        }}
        question="Is this visit pace healthy?"
      />
    </div>
  );
}

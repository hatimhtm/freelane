"use client";

import { Sparkles } from "lucide-react";
import { AiDot } from "@/components/widgets/ai-dot";
import { phtDateString } from "@/lib/utils";

// Life events — Journey/M widget. Union of milestones + life_shifts
// in scope, chronological. The brain treats these together as the
// "tagged events" set per the Stats design spec.

export type LifeEventsWidgetProps = {
  scope: string;
  events: Array<{
    id: string;
    kind: "milestone" | "life_shift";
    label: string;
    occurredAt: string;
  }>;
};

const KIND_LABEL: Record<string, string> = {
  milestone: "Milestone",
  life_shift: "Life shift",
};

export function LifeEventsWidget({ scope, events }: LifeEventsWidgetProps) {
  const cardKey = `stats.${scope}.life_events`;
  return (
    <div className="group relative flex min-h-[200px] w-full flex-col rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex items-start gap-2">
        <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-foreground/[0.04] text-foreground/70">
          <Sparkles className="h-4 w-4" />
        </div>
        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          Tagged life events
        </div>
      </div>
      <ul className="mt-3 flex flex-1 flex-col divide-y divide-border/40">
        {events.map((e) => (
          <li key={e.id} className="py-2">
            <div className="flex items-center gap-3 text-[12.5px]">
              <span className="min-w-0 flex-1 truncate text-foreground/90">
                {e.label}
              </span>
              <span className="shrink-0 text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground">
                {KIND_LABEL[e.kind] ?? e.kind}
              </span>
            </div>
            <div className="text-[10.5px] text-muted-foreground">
              {phtDateString(new Date(e.occurredAt))}
            </div>
          </li>
        ))}
      </ul>
      <AiDot
        card={{
          key: cardKey,
          label: "Tagged life events",
          data: {
            scope,
            event_ids: events.map((e) => ({ id: e.id, kind: e.kind })),
          },
        }}
        question="What shifted in my life around these moments?"
      />
    </div>
  );
}

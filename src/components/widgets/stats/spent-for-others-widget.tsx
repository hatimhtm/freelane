"use client";

import { HeartHandshake } from "lucide-react";
import { AiDot } from "@/components/widgets/ai-dot";
import { formatMoney } from "@/lib/money";
import type { CurrencyCode } from "@/lib/supabase/types";

// Spent for others — Money/M widget. Per-entity aggregate of spends
// flagged is_for_someone_else within scope. Extracted from the inline
// block on stats/[scope]/money/page.tsx so the surface uses the
// canonical widget chrome + AI dot + relevance-gating pattern every
// other Money widget follows.
//
// Padding bumped from p-4 to p-5 to align with the L-widget contract
// the rest of the row uses — small consistency win, no layout shift.

export type SpentForOthersWidgetProps = {
  scope: string;
  data: {
    totalBase: number;
    perEntity: Array<{ entityId: string; name: string; amount: number; count: number }>;
  };
  baseCurrency: CurrencyCode;
};

export function SpentForOthersWidget({
  scope,
  data,
  baseCurrency,
}: SpentForOthersWidgetProps) {
  const cardKey = `stats.${scope}.spent_for_others`;
  const { totalBase, perEntity } = data;
  return (
    <div className="group relative flex min-h-[200px] w-full flex-col rounded-xl bg-card p-5 ring-1 ring-foreground/10">
      <div className="flex items-start gap-2">
        <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-foreground/[0.04] text-foreground/70">
          <HeartHandshake className="h-4 w-4" />
        </div>
        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          Spent for others
        </div>
      </div>
      <div className="mt-2 display-headline text-[24px] leading-none tabular-nums text-foreground">
        {formatMoney(totalBase, baseCurrency, { compact: true })}
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Across {perEntity.length} {perEntity.length === 1 ? "person" : "people"}.
      </p>
      <ul className="mt-3 divide-y divide-foreground/10">
        {perEntity.slice(0, 5).map((p) => (
          <li
            key={p.entityId}
            className="grid grid-cols-[1fr_auto] gap-3 py-1.5 text-[12.5px]"
          >
            <span className="truncate text-foreground/85">{p.name}</span>
            <span className="tabular-nums text-foreground/80">
              {formatMoney(p.amount, baseCurrency, { compact: true })}
            </span>
          </li>
        ))}
      </ul>
      <AiDot
        card={{
          key: cardKey,
          label: "Spent for others",
          data: {
            scope,
            total_base: totalBase,
            entity_ids: perEntity.map((p) => p.entityId),
          },
        }}
        question="Who am I spending the most on, and why?"
      />
    </div>
  );
}

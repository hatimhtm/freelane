"use client";

import { Flame } from "lucide-react";
import { AiDot } from "@/components/widgets/ai-dot";
import { formatMoney } from "@/lib/money";
import { phtDateString } from "@/lib/utils";
import type { CurrencyCode } from "@/lib/supabase/types";

// Biggest spends — Money/M widget. The 5 single largest spend rows
// in scope, sorted by base amount descending.

export type BiggestSpendsWidgetProps = {
  scope: string;
  spends: Array<{ id: string; amount: number; description: string | null; spentAt: string }>;
  baseCurrency: CurrencyCode;
};

export function BiggestSpendsWidget({ scope, spends, baseCurrency }: BiggestSpendsWidgetProps) {
  const cardKey = `stats.${scope}.biggest_spends`;
  return (
    <div className="group relative flex min-h-[200px] w-full flex-col rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex items-start gap-2">
        <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-foreground/[0.04] text-foreground/70">
          <Flame className="h-4 w-4" />
        </div>
        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          Biggest spends
        </div>
      </div>
      <ul className="mt-3 flex flex-1 flex-col divide-y divide-border/40">
        {spends.map((s) => (
          <li key={s.id} className="py-2">
            <div className="flex items-center gap-3 text-[12.5px]">
              <span className="min-w-0 flex-1 truncate text-foreground/90">
                {s.description?.trim() || "Untitled spend"}
              </span>
              <span className="tabular-nums text-foreground/85">
                {formatMoney(s.amount, baseCurrency, { compact: true })}
              </span>
            </div>
            <div className="text-[10.5px] text-muted-foreground">
              {phtDateString(new Date(s.spentAt))}
            </div>
          </li>
        ))}
      </ul>
      <AiDot
        card={{
          key: cardKey,
          label: "Biggest spends",
          data: { scope, spend_ids: spends.map((s) => s.id) },
        }}
        question="What were these biggest spends really for?"
      />
    </div>
  );
}

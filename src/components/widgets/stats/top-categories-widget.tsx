"use client";

import { Tag } from "lucide-react";
import { AiDot } from "@/components/widgets/ai-dot";
import { formatMoney } from "@/lib/money";
import type { CurrencyCode } from "@/lib/supabase/types";

// Top categories — Money/M widget. Sibling of TopVendorsWidget but
// keyed off spend_category_links so the brain can talk about
// "consumption vs investment" vibes.

export type TopCategoriesWidgetProps = {
  scope: string;
  categories: Array<{ categoryId: string; name: string; amount: number; count: number }>;
  baseCurrency: CurrencyCode;
};

export function TopCategoriesWidget({
  scope,
  categories,
  baseCurrency,
}: TopCategoriesWidgetProps) {
  const cardKey = `stats.${scope}.top_categories`;
  const max = Math.max(1, ...categories.map((c) => c.amount));
  return (
    <div className="group relative flex min-h-[200px] w-full flex-col rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex items-start gap-2">
        <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-foreground/[0.04] text-foreground/70">
          <Tag className="h-4 w-4" />
        </div>
        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          Top categories
        </div>
      </div>
      <ul className="mt-3 flex flex-1 flex-col gap-1.5">
        {categories.map((c) => (
          <li key={c.categoryId} className="flex items-center gap-2 text-[12.5px]">
            <span className="min-w-0 flex-1 truncate text-foreground/85">{c.name}</span>
            <div className="flex shrink-0 items-center gap-2">
              <div className="h-1 w-16 overflow-hidden rounded-full bg-foreground/[0.06]">
                <div
                  className="h-full bg-foreground/40"
                  style={{ width: `${(c.amount / max) * 100}%` }}
                />
              </div>
              <span className="tabular-nums text-foreground/80">
                {formatMoney(c.amount, baseCurrency, { compact: true })}
              </span>
            </div>
          </li>
        ))}
      </ul>
      <AiDot
        card={{
          key: cardKey,
          label: "Top categories",
          data: { scope, category_ids: categories.map((c) => c.categoryId) },
        }}
        question="Which categories are quietly eating my budget?"
      />
    </div>
  );
}

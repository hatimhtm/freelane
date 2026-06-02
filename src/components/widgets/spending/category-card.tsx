"use client";

import Link from "next/link";
import { SWidget } from "@/components/widgets/s-widget";
import { formatMoney } from "@/lib/money";
import type { CurrencyCode, SpendCategory } from "@/lib/supabase/types";

// Spending workflow — CATEGORY CARDS SIMPLIFIED.
//
// One S widget per category. Hero is ₱ total for the category over the
// active window. A subtle horizontal stack-bar at the top shows the
// category's share of the period total (visual cue) and a "% of spends"
// subtitle reads the same number for screen-reader clarity. Click →
// filters spends by that tag (handled via Link to /spending/category/<id>).
//
// No per-category chart — the GitHub-style yearly heatmap covers the
// temporal pattern. The brief is explicit: "boxes too small, text
// bleeding, charts not necessary."
export function CategoryCard({
  category,
  totalBase,
  shareOfTotal,
  baseCurrency,
}: {
  category: SpendCategory;
  totalBase: number;
  // [0, 1] fraction of the period's Total Spent (overlapping tags can
  // legitimately push the sum across categories above 1.0 — that's the
  // contract, the parent surface explains via tooltip).
  shareOfTotal: number;
  baseCurrency: CurrencyCode;
}) {
  const pct = Math.max(0, Math.min(1, shareOfTotal)) * 100;
  return (
    <Link
      href={`/spending/category/${category.id}`}
      className="block"
      aria-label={`Filter spends by ${category.name}`}
    >
      <SWidget
        label={category.name}
        hero={formatMoney(totalBase, baseCurrency, { compact: true })}
        sub={
          <span className="flex flex-col gap-1 [&>*]:block">
            {/* Stack-bar — a thin horizontal fill at the top of the card.
                Track sits at ink/10, fill at ink/30 so the bar reads as a
                quiet share cue and the hero number stays the primary
                element. Earlier ink/55 fill competed with the percentage
                text below; the design system is "sparse + glanceable". */}
            <span
              aria-hidden
              className="h-1 w-full overflow-hidden rounded-full bg-foreground/[0.10]"
            >
              <span
                className="block h-full rounded-full bg-foreground/30"
                style={{ width: `${pct.toFixed(1)}%` }}
              />
            </span>
            <span className="text-muted-foreground/85">
              {pct.toFixed(0)}% of spends
            </span>
          </span>
        }
      />
    </Link>
  );
}

"use client";

import { useMemo } from "react";
import { Info } from "lucide-react";
import { CategoryCard } from "@/components/widgets/spending/category-card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { totalsByCategoryBase, SPENT_BY_TAG_TOOLTIP } from "@/lib/spends";
import type {
  CurrencyCode,
  Spend,
  SpendCategory,
  SpendCategoryLink,
} from "@/lib/supabase/types";

// Spending workflow — CATEGORY CARDS SIMPLIFIED.
//
// Originally this file rendered a 6-up small-multiples grid with a
// per-category Sparkline (post-CLAUDE.md note: "boxes too small, text
// bleeding, charts not necessary"). Replaced with a flat S widget grid
// of CategoryCard tiles per the locked design: name, ₱ total, stack-bar
// % of total, "% of spends" subtitle. No per-category chart.
//
// Header carries the info tooltip explaining the per-tag aggregation
// rule so users don't read overlapping totals as a bug.
//
// Click any card → /spending/category/<id> (filters spends by that tag).
//
// Component name kept as CategoryTrendSmallMultiples so the consuming
// surface ("spending-view.tsx") doesn't need to swap imports yet — the
// surface itself is being rebuilt in this same workflow.

export function CategoryTrendSmallMultiples({
  spends,
  categoryLinks,
  categories,
  topN = 6,
  baseCurrency,
}: {
  spends: Spend[];
  categoryLinks: SpendCategoryLink[];
  categories: SpendCategory[];
  topN?: number;
  baseCurrency: CurrencyCode;
  // Kept on the type for backward-compat; not used post-restyle (the
  // sparkline is gone).
  now?: Date;
}) {
  const cells = useMemo(() => {
    // Push the audience-kind filter INTO totalsByCategoryBase so the
    // returned map already excludes the radio-filter tags. Any future
    // consumer that doesn't filter audience downstream still gets a
    // clean per-category map by default.
    const totalsByCat = totalsByCategoryBase(spends, categoryLinks, {
      categories,
      excludeTagKinds: ["audience"],
    });
    const byId = new Map(categories.map((c) => [c.id, c] as const));
    // Total Spent = SUM(distinct spend.amount_base) — share denominator.
    const totalSpent = spends.reduce(
      (s, sp) => s + Number(sp.amount_base ?? 0),
      0,
    );
    const ranked: Array<{
      category: SpendCategory;
      totalBase: number;
      shareOfTotal: number;
    }> = [];
    for (const [cid, totalBase] of totalsByCat) {
      const cat = byId.get(cid);
      if (!cat || cat.archived) continue;
      ranked.push({
        category: cat,
        totalBase,
        shareOfTotal: totalSpent > 0 ? totalBase / totalSpent : 0,
      });
    }
    ranked.sort((a, b) => b.totalBase - a.totalBase);
    return ranked.slice(0, topN);
  }, [spends, categoryLinks, categories, topN]);

  if (cells.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-[12px] text-ink/45">
        No categorized spending yet.
      </div>
    );
  }

  return (
    <div className="space-y-3 p-3">
      {/* Header-level overlap explanation now lives on the panel eyebrow
          via <TopCategoriesEyebrowInfo />. Keeping the duplicate row
          here would push the grid down by an extra line and re-state
          the same tooltip body. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {cells.map((cell) => (
          <CategoryCard
            key={cell.category.id}
            category={cell.category}
            totalBase={cell.totalBase}
            shareOfTotal={cell.shareOfTotal}
            baseCurrency={baseCurrency}
          />
        ))}
      </div>
    </div>
  );
}

// Info tooltip rendered next to the "Top categories" panel eyebrow.
// Explains the per-tag aggregation rule so users don't read overlapping
// totals as a bug. Lifted out of the grid body so the panel header
// carries the annotation and the body stays focused on the cards.
export function TopCategoriesEyebrowInfo() {
  return (
    <TooltipProvider delay={150}>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label="How per-tag totals work"
              className="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground/70 hover:text-foreground"
            >
              <Info className="h-3 w-3" />
            </button>
          }
        />
        <TooltipContent className="max-w-[260px] text-[11.5px] leading-snug">
          {SPENT_BY_TAG_TOOLTIP}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

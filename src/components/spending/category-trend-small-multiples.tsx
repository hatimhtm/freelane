"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Sparkline } from "@/components/stats/sparkline";
import { formatMoney } from "@/lib/money";
import type {
  CurrencyCode,
  Spend,
  SpendCategory,
  SpendCategoryLink,
} from "@/lib/supabase/types";

interface CellData {
  category: SpendCategory;
  // 6 entries, oldest → current month.
  series: number[];
  // Current month total (last element of series).
  current: number;
}

// Trailing N months including `now`, bucketed by spent_at month-of-year.
// Returns the bucket keys + a Map<categoryId → number[]> aligned to those keys.
function buildCategorySeries(
  spends: Spend[],
  links: SpendCategoryLink[],
  now: Date,
  monthsBack: number,
): { totalsByCat: Map<string, number[]>; bucketKeys: string[] } {
  const bucketKeys: string[] = [];
  const start = new Date(now.getFullYear(), now.getMonth() - (monthsBack - 1), 1);
  for (let i = 0; i < monthsBack; i++) {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
    bucketKeys.push(`${d.getFullYear()}-${d.getMonth()}`);
  }
  const idx = new Map(bucketKeys.map((k, i) => [k, i] as const));

  // spend_id → category_ids (so we can fan one spend out to all its tags).
  const linksBySpend = new Map<string, string[]>();
  for (const l of links) {
    const arr = linksBySpend.get(l.spend_id) ?? [];
    arr.push(l.category_id);
    linksBySpend.set(l.spend_id, arr);
  }

  const totalsByCat = new Map<string, number[]>();
  for (const sp of spends) {
    const d = new Date(sp.spent_at);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    const bucket = idx.get(key);
    if (bucket === undefined) continue;
    const catIds = linksBySpend.get(sp.id);
    if (!catIds || catIds.length === 0) continue;
    const amount = Number(sp.amount_base ?? 0);
    for (const cid of catIds) {
      let arr = totalsByCat.get(cid);
      if (!arr) {
        arr = new Array<number>(monthsBack).fill(0);
        totalsByCat.set(cid, arr);
      }
      arr[bucket]! += amount;
    }
  }
  return { totalsByCat, bucketKeys };
}

export function CategoryTrendSmallMultiples({
  spends,
  categoryLinks,
  categories,
  topN = 6,
  baseCurrency,
  now,
}: {
  spends: Spend[];
  categoryLinks: SpendCategoryLink[];
  categories: SpendCategory[];
  topN?: number;
  baseCurrency: CurrencyCode;
  now?: Date;
}) {
  const cells = useMemo<CellData[]>(() => {
    const refNow = now ?? new Date();
    const { totalsByCat } = buildCategorySeries(spends, categoryLinks, refNow, 6);
    const byId = new Map(categories.map((c) => [c.id, c] as const));

    const ranked: CellData[] = [];
    for (const [cid, series] of totalsByCat) {
      const cat = byId.get(cid);
      if (!cat || cat.archived) continue;
      // Headline number is the trailing 6-month TOTAL, matching the panel
      // subtitle "Trailing 6 months, top by spend." — previously this showed
      // only the current month, which read as "₱0" the moment the calendar
      // ticked over even when the 6-month trend behind it was non-trivial.
      const current = series.reduce((s, v) => s + v, 0);
      ranked.push({ category: cat, series, current });
    }
    // Rank by trailing 6-month total — small-multiples want the most-spent
    // categories overall, not just whichever happened to spike this month.
    ranked.sort((a, b) => {
      const at = a.series.reduce((s, v) => s + v, 0);
      const bt = b.series.reduce((s, v) => s + v, 0);
      return bt - at;
    });
    return ranked.slice(0, topN);
  }, [spends, categoryLinks, categories, topN, now]);

  if (cells.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-[12px] text-ink/45">
        No categorized spending yet.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-px bg-ink/8 sm:grid-cols-3">
      {cells.map((cell) => (
        <CategoryCell key={cell.category.id} cell={cell} baseCurrency={baseCurrency} />
      ))}
    </div>
  );
}

function CategoryCell({
  cell,
  baseCurrency,
}: {
  cell: CellData;
  baseCurrency: CurrencyCode;
}) {
  const color = cell.category.color ?? "var(--chart-1)";
  return (
    <Link
      href={`/spending/category/${cell.category.id}`}
      className="group block bg-paper px-4 py-3.5 transition-colors duration-300 hover:bg-ink/[0.025]"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-[12px] uppercase tracking-[0.14em] text-ink/60">
          {cell.category.name}
        </span>
      </div>
      <div className="mt-1.5 font-fraunces text-[22px] leading-tight tabular text-ink/90">
        {formatMoney(cell.current, baseCurrency, { compact: true })}
      </div>
      <div className="mt-2 -mx-0.5">
        <Sparkline data={cell.series} height={32} color={color} strokeWidth={1.5} filled />
      </div>
    </Link>
  );
}

import type {
  CurrencyCode,
  ExchangeRate,
  Spend,
  SpendCategory,
  SpendCategoryLink,
} from "@/lib/supabase/types";

// Fast lookup: spend.id → category_ids[].
export function linksBySpend(links: SpendCategoryLink[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const l of links) {
    const arr = out.get(l.spend_id) ?? [];
    arr.push(l.category_id);
    out.set(l.spend_id, arr);
  }
  return out;
}

// Inverse: category_id → spend_ids[].
export function spendsByCategory(links: SpendCategoryLink[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const l of links) {
    const arr = out.get(l.category_id) ?? [];
    arr.push(l.spend_id);
    out.set(l.category_id, arr);
  }
  return out;
}

// Resolve category ids on a spend → category objects.
export function categoriesForSpend(
  spendId: string,
  links: SpendCategoryLink[],
  categories: SpendCategory[],
): SpendCategory[] {
  const ids = new Set(
    links.filter((l) => l.spend_id === spendId).map((l) => l.category_id),
  );
  return categories.filter((c) => ids.has(c.id)).sort((a, b) => a.sort_order - b.sort_order);
}

// Headline total — each spend counts ONCE (the m2m tags only multi-count in
// per-category views).
export function totalSpentBase(spends: Spend[]): number {
  return spends.reduce((s, sp) => s + Number(sp.amount_base ?? 0), 0);
}

export interface BusinessPersonalSplit {
  personal: number;
  business: number;
}

export function businessPersonalSplit(spends: Spend[]): BusinessPersonalSplit {
  return spends.reduce<BusinessPersonalSplit>(
    (acc, sp) => {
      const amount = Number(sp.amount_base ?? 0);
      if (sp.business_relevant) acc.business += amount;
      else acc.personal += amount;
      return acc;
    },
    { personal: 0, business: 0 },
  );
}

// VAT is denominated in the spend's currency — convert each row to base.
// Note: VAT base is recomputed via current FX rather than locked at entry
// like amount_base; the schema deliberately doesn't carry vat_amount_base.
// If long-term VAT-vs-spend drift becomes a concern, add the locked column.
export function totalVatBase(
  spends: Spend[],
  rates: Pick<ExchangeRate, "code" | "rate_to_base">[],
): number {
  return spends.reduce((s, sp) => {
    if (sp.vat_amount == null) return s;
    const rate = rates.find((r) => r.code === sp.currency)?.rate_to_base ?? 1;
    return s + Number(sp.vat_amount) * rate;
  }, 0);
}

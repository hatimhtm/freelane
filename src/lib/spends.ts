import type {
  CurrencyCode,
  ExchangeRate,
  Spend,
  SpendCategory,
  SpendCategoryLink,
  TagKind,
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
//
// Aggregation contract (locked 2026-06-03, post-BUG FIX #1):
//   - Total Spent (this function) = SUM(distinct spend.amount_base)
//   - Per-tag total                = SUM(spend.amount_base WHERE tag in
//                                       categoryIds for that spend)
//                                    counts the FULL spend amount for
//                                    each tagged spend, NOT a share.
//   - Sum of per-tag totals CAN exceed Total Spent (overlapping tags).
//     The UI surfaces this via a "Spent by tag (full amount each)" info
//     tooltip wherever per-tag totals are displayed.
export function totalSpentBase(spends: Spend[]): number {
  return spends.reduce((s, sp) => s + Number(sp.amount_base ?? 0), 0);
}

// Header copy used by every surface that renders per-tag totals so the
// "sum of categories > Total Spent" doesn't read as a bug. Pair with an
// info-tooltip in the UI. Single source of truth so the wording stays
// consistent across Spending, Today, and Dashboard surfaces.
export const SPENT_BY_TAG_TOOLTIP =
  "Spent by tag — counts the full amount per tag. Overlapping tags can make the sum across categories exceed total spent.";

// Per-tag aggregation. For each category id, returns SUM of base amounts
// across the spends that carry the tag. Each spend's FULL amount counts
// in every tag it has — no share/allocation.
//
// Optional `categories` + `excludeTagKinds`: when both are supplied, ids
// whose tag_kind is in the exclude set are skipped during aggregation.
// Default behaviour is unchanged so legacy callers continue to receive
// every linked id. Pass `excludeTagKinds: ["audience"]` to match the
// locked design contract: audience tags drive the radio filter, NOT the
// per-category aggregation grid. Pushing the filter into the aggregation
// stops downstream consumers from accidentally treating audience
// totals as legitimate category totals.
export function totalsByCategoryBase(
  spends: Spend[],
  links: SpendCategoryLink[],
  options?: {
    categories?: SpendCategory[];
    excludeTagKinds?: ReadonlyArray<TagKind>;
  },
): Map<string, number> {
  const linksMap = linksBySpend(links);
  const totals = new Map<string, number>();
  let excludeIds: Set<string> | null = null;
  if (
    options?.categories &&
    options.excludeTagKinds &&
    options.excludeTagKinds.length > 0
  ) {
    const excludeKinds = new Set<TagKind>(options.excludeTagKinds);
    excludeIds = new Set<string>();
    for (const c of options.categories) {
      if (excludeKinds.has(c.tag_kind)) excludeIds.add(c.id);
    }
  }
  for (const sp of spends) {
    const tagIds = linksMap.get(sp.id);
    if (!tagIds || tagIds.length === 0) continue;
    const amount = Number(sp.amount_base ?? 0);
    for (const cid of tagIds) {
      if (excludeIds && excludeIds.has(cid)) continue;
      totals.set(cid, (totals.get(cid) ?? 0) + amount);
    }
  }
  return totals;
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

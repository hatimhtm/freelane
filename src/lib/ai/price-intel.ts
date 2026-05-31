import type {
  PriceIntelligenceRow,
  Spend,
  SpendItem,
} from "@/lib/supabase/types";

export interface ItemPriceLookup {
  itemNameNorm: string;
  count: number;
  prices: number[];
  stores: Record<string, number[]>;
  median: number | null;
  p90: number | null;
  lastSeenAt: string | null;
  suggestedRangeLow: number | null;
  suggestedRangeHigh: number | null;
}

// Stores I shop at in San Pablo — first match wins on description tokenization.
// Order matters: "Mercury Drug" before "Mercury" would be redundant, but "SM"
// is short enough that it must be matched on word boundaries (handled below).
const STORE_TOKENS: Array<{ key: string; pattern: RegExp }> = [
  { key: "SM",           pattern: /\bsm\b/i },
  { key: "Dali",         pattern: /\bdali\b/i },
  { key: "AlfaMart",     pattern: /\balfa\s*mart\b/i },
  { key: "7-Eleven",     pattern: /\b(7[- ]?eleven|7e|seven\s*eleven)\b/i },
  { key: "Robinsons",    pattern: /\brobinsons?\b/i },
  { key: "Puregold",     pattern: /\bpure\s*gold\b/i },
  { key: "Mercury Drug", pattern: /\bmercury(\s*drug)?\b/i },
  { key: "Watsons",      pattern: /\bwatsons?\b/i },
];

const UNKNOWN_STORE = "unknown";

// Normalize an item name to its canonical lookup key. Goal: "5 kg", "5kg",
// "5  KG." all collapse to the same string, so history matches on intent.
export function normalizeItemName(name: string): string {
  if (!name) return "";
  let s = name.toLowerCase().trim();
  // Glue numbers to their following unit so "5 kg" -> "5kg", "330 ml" -> "330ml".
  s = s.replace(/(\d)\s+(kg|g|mg|l|ml|cl|oz|lb|pcs?|pc|pack|packs|bottles?|cans?|bags?)\b/g, "$1$2");
  // Drop punctuation (keep digits, letters, whitespace).
  s = s.replace(/[^\p{L}\p{N}\s]+/gu, " ");
  // Collapse whitespace.
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

function inferStore(description: string | null | undefined): string {
  if (!description) return UNKNOWN_STORE;
  for (const { key, pattern } of STORE_TOKENS) {
    if (pattern.test(description)) return key;
  }
  return UNKNOWN_STORE;
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function lookupItemPriceFromHistory(
  itemNameNorm: string,
  items: SpendItem[],
  spends: Spend[],
): ItemPriceLookup {
  const empty: ItemPriceLookup = {
    itemNameNorm,
    count: 0,
    prices: [],
    stores: {},
    median: null,
    p90: null,
    lastSeenAt: null,
    suggestedRangeLow: null,
    suggestedRangeHigh: null,
  };
  if (!itemNameNorm) return empty;

  const spendById = new Map<string, Spend>();
  for (const sp of spends) spendById.set(sp.id, sp);

  const prices: number[] = [];
  const stores: Record<string, number[]> = {};
  let latestTs = -Infinity;
  let latestIso: string | null = null;

  for (const it of items) {
    if (normalizeItemName(it.name) !== itemNameNorm) continue;
    const parent = spendById.get(it.spend_id);
    if (!parent) continue;

    let amount: number | null = null;
    if (it.amount != null && Number.isFinite(Number(it.amount))) {
      amount = Number(it.amount);
    } else if (parent.amount != null && Number.isFinite(Number(parent.amount))) {
      amount = Number(parent.amount);
    }
    if (amount == null || !(amount > 0)) continue;

    prices.push(amount);

    const store = inferStore(parent.description);
    const bucket = stores[store] ?? [];
    bucket.push(amount);
    stores[store] = bucket;

    const ts = new Date(parent.spent_at).getTime();
    if (Number.isFinite(ts) && ts > latestTs) {
      latestTs = ts;
      latestIso = parent.spent_at;
    }
  }

  if (prices.length === 0) return empty;

  const sorted = [...prices].sort((a, b) => a - b);
  const median = percentile(sorted, 0.5);
  const p90 = percentile(sorted, 0.9);
  const suggestedRangeLow = median != null ? median * 0.8 : null;
  const suggestedRangeHigh = median != null ? median * 1.2 : null;

  return {
    itemNameNorm,
    count: prices.length,
    prices,
    stores,
    median,
    p90,
    lastSeenAt: latestIso,
    suggestedRangeLow,
    suggestedRangeHigh,
  };
}

export function lookupItemPriceFromCache(
  itemNameNorm: string,
  store: string | undefined,
  priceIntel: PriceIntelligenceRow[],
): PriceIntelligenceRow | null {
  if (!itemNameNorm) return null;
  let best: PriceIntelligenceRow | null = null;
  let bestTs = -Infinity;
  for (const row of priceIntel) {
    if (row.item_name_norm !== itemNameNorm) continue;
    if (store !== undefined && row.store_name !== store) continue;
    const ts = new Date(row.last_seen_at).getTime();
    if (!Number.isFinite(ts)) continue;
    if (ts > bestTs) {
      bestTs = ts;
      best = row;
    }
  }
  return best;
}

export function combineLookups(
  history: ItemPriceLookup,
  cache: PriceIntelligenceRow | null,
): {
  source: "history" | "cache" | "hybrid";
  low: number | null;
  typical: number | null;
  high: number | null;
  count: number;
  lastSeenAt: string | null;
} {
  const historyStrong = history.count >= 3;

  if (historyStrong) {
    return {
      source: cache ? "hybrid" : "history",
      low: history.suggestedRangeLow,
      typical: history.median,
      high: history.suggestedRangeHigh,
      count: history.count,
      lastSeenAt: history.lastSeenAt,
    };
  }

  if (cache) {
    return {
      source: "cache",
      low: cache.price_low,
      typical: cache.price_typical,
      high: cache.price_high,
      count: history.count,
      lastSeenAt: cache.last_seen_at,
    };
  }

  return {
    source: "history",
    low: history.suggestedRangeLow,
    typical: history.median,
    high: history.suggestedRangeHigh,
    count: history.count,
    lastSeenAt: history.lastSeenAt,
  };
}

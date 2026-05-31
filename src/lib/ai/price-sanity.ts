import type {
  CurrencyCode,
  Spend,
  SpendCategoryLink,
} from "@/lib/supabase/types";

export type PriceSanityStatus = "ok" | "low" | "high" | "very_high" | "impossible";

export interface PriceSanityResult {
  status: PriceSanityStatus;
  reason?: string;
  suggestedAmount?: number;
  comparison?: {
    median: number;
    p90: number;
    max: number;
    n: number;
  };
}

export interface PriceSanityInput {
  amount: number;
  currency: CurrencyCode;
  categoryIds: string[];
  vendorToken?: string;
  walletBalanceBase: number;
  history: {
    spends: Spend[];
    links: SpendCategoryLink[];
  };
}

const NINETY_DAYS_MS = 90 * 86_400_000;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function priceSanity(input: PriceSanityInput): PriceSanityResult {
  const {
    amount,
    currency,
    categoryIds,
    vendorToken,
    walletBalanceBase,
    history,
  } = input;

  const cutoff = Date.now() - NINETY_DAYS_MS;
  const wantedCats = new Set(categoryIds);

  const spendIdsInCats = new Set<string>();
  if (wantedCats.size > 0) {
    for (const link of history.links) {
      if (wantedCats.has(link.category_id)) {
        spendIdsInCats.add(link.spend_id);
      }
    }
  }

  const token = vendorToken?.trim().toLowerCase();

  const matches: number[] = [];
  for (const sp of history.spends) {
    if (sp.currency !== currency) continue;
    const t = new Date(sp.spent_at).getTime();
    if (!Number.isFinite(t) || t < cutoff) continue;
    if (wantedCats.size > 0 && !spendIdsInCats.has(sp.id)) continue;
    if (token) {
      const desc = (sp.description ?? "").toLowerCase();
      if (!desc.includes(token)) continue;
    }
    const n = Number(sp.amount);
    if (!Number.isFinite(n) || n <= 0) continue;
    matches.push(n);
  }

  if (matches.length < 3) {
    return { status: "ok", reason: "not enough history" };
  }

  const sorted = [...matches].sort((a, b) => a - b);
  const median = percentile(sorted, 0.5);
  const p90 = percentile(sorted, 0.9);
  const max = sorted[sorted.length - 1];
  const comparison = { median, p90, max, n: sorted.length };

  const ratioToMedian = median > 0 ? amount / median : 0;
  const missingDecimal =
    median > 0 && ratioToMedian >= 8 && ratioToMedian <= 12;

  if (amount > walletBalanceBase && amount > median * 10) {
    return {
      status: "impossible",
      reason: missingDecimal
        ? `${amount.toFixed(2)} is ~10× your typical ${median.toFixed(2)} — missing a decimal?`
        : `${amount.toFixed(2)} exceeds wallet balance and is >10× your typical ${median.toFixed(2)}.`,
      suggestedAmount: missingDecimal ? amount / 10 : median,
      comparison,
    };
  }

  if (amount > p90 * 3 && amount > median * 5) {
    return {
      status: "very_high",
      reason: missingDecimal
        ? `${amount.toFixed(2)} is ~10× your typical ${median.toFixed(2)} — missing a decimal?`
        : `${amount.toFixed(2)} is >3× your 90th-percentile ${p90.toFixed(2)}.`,
      suggestedAmount: missingDecimal ? amount / 10 : median,
      comparison,
    };
  }

  if (amount > p90 * 2) {
    return {
      status: "high",
      reason: `${amount.toFixed(2)} is >2× your 90th-percentile ${p90.toFixed(2)}.`,
      suggestedAmount: median,
      comparison,
    };
  }

  if (median > 0 && amount < median / 5) {
    return {
      status: "low",
      reason: `${amount.toFixed(2)} is <1/5 of your typical ${median.toFixed(2)} — extra zero missing?`,
      suggestedAmount: median,
      comparison,
    };
  }

  return { status: "ok", comparison };
}

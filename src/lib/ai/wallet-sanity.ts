import type {
  RecurringSpend,
  Spend,
  SpendCategoryLink,
} from "@/lib/supabase/types";
import type { HoldingBalanceRow } from "@/lib/payment-chain";

export type WalletSanityStatus = "ok" | "mismatch" | "insufficient";

export interface WalletSanityResult {
  status: WalletSanityStatus;
  reason?: string;
  suggestedWalletId?: string;
}

export interface WalletSanityInput {
  walletId: string;
  categoryIds: string[];
  amountBase: number;
  holdings: HoldingBalanceRow[];
  history: {
    spends: Spend[];
    links: SpendCategoryLink[];
  };
  recurring: RecurringSpend[];
}

const DOMINANT_THRESHOLD = 0.7;
const CHOSEN_FLOOR = 0.05;
const CATEGORY_HISTORY_MIN = 4;

function biggestPositiveBalance(holdings: HoldingBalanceRow[]): HoldingBalanceRow | null {
  let best: HoldingBalanceRow | null = null;
  for (const row of holdings) {
    if (row.balance <= 0) continue;
    if (!best || row.balance > best.balance) best = row;
  }
  return best;
}

export function walletSanity(input: WalletSanityInput): WalletSanityResult {
  const { walletId, categoryIds, amountBase, holdings, history, recurring } = input;

  // ── Check 1: insufficient balance ──
  const chosenHolding = holdings.find((h) => h.methodId === walletId);
  if (chosenHolding && chosenHolding.balance < amountBase) {
    const alt = biggestPositiveBalance(holdings.filter((h) => h.methodId !== walletId));
    return {
      status: "insufficient",
      reason: `${chosenHolding.name} balance ${chosenHolding.balance.toFixed(2)} < ${amountBase.toFixed(2)}.`,
      suggestedWalletId: alt?.methodId,
    };
  }

  // ── Check 2: category-wallet mismatch from history ──
  // For each category, find the dominant wallet (>= 70% share). If chosen
  // walletId barely shows up there (< 5%), suggest the dominant one.
  if (categoryIds.length > 0) {
    const wantedCats = new Set(categoryIds);
    const catsBySpend = new Map<string, string[]>();
    for (const l of history.links) {
      if (!wantedCats.has(l.category_id)) continue;
      const arr = catsBySpend.get(l.spend_id) ?? [];
      arr.push(l.category_id);
      catsBySpend.set(l.spend_id, arr);
    }

    const walletCountsByCat = new Map<string, Map<string, number>>();
    for (const sp of history.spends) {
      const cats = catsBySpend.get(sp.id);
      if (!cats || cats.length === 0) continue;
      for (const cid of cats) {
        let perWallet = walletCountsByCat.get(cid);
        if (!perWallet) {
          perWallet = new Map<string, number>();
          walletCountsByCat.set(cid, perWallet);
        }
        perWallet.set(sp.wallet_id, (perWallet.get(sp.wallet_id) ?? 0) + 1);
      }
    }

    for (const cid of categoryIds) {
      const perWallet = walletCountsByCat.get(cid);
      if (!perWallet) continue;
      let total = 0;
      for (const v of perWallet.values()) total += v;
      if (total < CATEGORY_HISTORY_MIN) continue;

      let dominantId: string | null = null;
      let dominantCount = 0;
      for (const [wid, count] of perWallet) {
        if (count > dominantCount) {
          dominantId = wid;
          dominantCount = count;
        }
      }
      if (!dominantId || dominantId === walletId) continue;
      if (dominantCount / total < DOMINANT_THRESHOLD) continue;

      const chosenShare = (perWallet.get(walletId) ?? 0) / total;
      if (chosenShare < CHOSEN_FLOOR) {
        return {
          status: "mismatch",
          reason: `This category usually comes from another wallet (${Math.round(
            (dominantCount / total) * 100,
          )}% of past entries).`,
          suggestedWalletId: dominantId,
        };
      }
    }
  }

  // ── Check 3: recurring rule with a pinned wallet ──
  if (categoryIds.length > 0) {
    const wantedCats = new Set(categoryIds);
    for (const rule of recurring) {
      if (!rule.active) continue;
      if (!rule.wallet_id || rule.wallet_id === walletId) continue;
      const defaults = rule.default_category_ids ?? [];
      if (defaults.length === 0) continue;
      const overlap = defaults.some((cid) => wantedCats.has(cid));
      if (!overlap) continue;
      return {
        status: "mismatch",
        reason: `Recurring rule "${rule.label}" pays from a different wallet.`,
        suggestedWalletId: rule.wallet_id,
      };
    }
  }

  return { status: "ok" };
}

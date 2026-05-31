import { formatMoney } from "@/lib/money";
import {
  combineLookups,
  lookupItemPriceFromCache,
  lookupItemPriceFromHistory,
  normalizeItemName,
} from "@/lib/ai/price-intel";
import type {
  PriceIntelligenceRow,
  Spend,
  SpendItem,
} from "@/lib/supabase/types";

interface PriceIntelLineProps {
  itemName: string;
  items: SpendItem[];
  spends: Spend[];
  cache?: PriceIntelligenceRow[];
}

const HAIR = " ";

function formatRange(low: number | null, high: number | null, typical: number | null): string | null {
  if (low != null && high != null) {
    const lowRounded = Math.round(low);
    const highRounded = Math.round(high);
    if (lowRounded === highRounded) {
      return formatMoney(lowRounded, "PHP", { compact: true }).replace("₱", `₱${HAIR}`);
    }
    const lowStr = formatMoney(lowRounded, "PHP", { compact: true }).replace("₱", `₱${HAIR}`);
    const highStr = new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(highRounded);
    return `${lowStr}–${highStr}`;
  }
  if (typical != null) {
    return formatMoney(Math.round(typical), "PHP", { compact: true }).replace("₱", `₱${HAIR}`);
  }
  return null;
}

function formatAge(iso: string | null): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return null;
  const diffMs = Date.now() - then;
  if (diffMs < 0) return null;
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(days / 365);
  return `${years}y ago`;
}

function topStore(stores: Record<string, number[]>): string | null {
  let best: string | null = null;
  let bestCount = 0;
  for (const [name, prices] of Object.entries(stores)) {
    if (name === "unknown") continue;
    if (prices.length > bestCount) {
      bestCount = prices.length;
      best = name;
    }
  }
  return best;
}

export function PriceIntelLine({ itemName, items, spends, cache }: PriceIntelLineProps) {
  const norm = normalizeItemName(itemName);
  if (!norm) return null;

  const history = lookupItemPriceFromHistory(norm, items, spends);
  const cacheHit = cache ? lookupItemPriceFromCache(norm, undefined, cache) : null;
  const combined = combineLookups(history, cacheHit);

  const baseClass = "mt-1 text-xs leading-relaxed text-ink/55 tabular";

  // Cold start: nothing yet, anywhere.
  if (history.count === 0 && !cacheHit) {
    return (
      <p className={baseClass}>
        First time — I&rsquo;ll learn the price.
      </p>
    );
  }

  const range = formatRange(combined.low, combined.high, combined.typical);
  const age = formatAge(combined.lastSeenAt);
  const store = topStore(history.stores);

  // History-backed: "Last 5×: ₱340–360 at Dali · 12d ago"
  if (history.count >= 1 && range) {
    const parts: string[] = [];
    parts.push(
      history.count === 1
        ? `Last seen ${range}`
        : `Last ${history.count}×: ${range}`,
    );
    if (store) parts[parts.length - 1] += ` at ${store}`;
    if (age) parts.push(age);
    return <p className={baseClass}>{parts.join(" · ")}</p>;
  }

  // Cache-only: AI prior / web — no personal history yet.
  if (cacheHit && range) {
    const parts: string[] = [`Usually ${range}`];
    if (cacheHit.store_name) parts[0] += ` at ${cacheHit.store_name}`;
    parts.push("still learning yours");
    return <p className={baseClass}>{parts.join(" · ")}</p>;
  }

  return null;
}

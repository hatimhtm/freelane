import type { Spend } from "@/lib/supabase/types";

// Lowercased alias → canonical display name. Aliases include common
// spelling/spacing variants users actually type in descriptions.
export const KNOWN_PH_VENDORS: Record<string, string> = {
  sm: "SM",
  "sm supermarket": "SM",
  "sm market": "SM",
  dali: "Dali",
  alfamart: "AlfaMart",
  "7-eleven": "7-Eleven",
  "7eleven": "7-Eleven",
  "seven eleven": "7-Eleven",
  "seven-eleven": "7-Eleven",
  robinsons: "Robinsons",
  puregold: "Puregold",
  "mercury drug": "Mercury Drug",
  mercury: "Mercury Drug",
  watsons: "Watsons",
  jollibee: "Jollibee",
  "mcdonald's": "McDonald's",
  mcdonalds: "McDonald's",
  mcdo: "McDonald's",
  kfc: "KFC",
  chowking: "Chowking",
  goldilocks: "Goldilocks",
  "red ribbon": "Red Ribbon",
  "wendy's": "Wendy's",
  wendys: "Wendy's",
  starbucks: "Starbucks",
  bpi: "BPI",
  bdo: "BDO",
  grab: "Grab",
  foodpanda: "Foodpanda",
  lalamove: "Lalamove",
  shopee: "Shopee",
  lazada: "Lazada",
  petron: "Petron",
  shell: "Shell",
  caltex: "Caltex",
  globe: "Globe",
  smart: "Smart",
  jeep: "Jeepney",
  jeepney: "Jeepney",
  tricycle: "Tricycle",
};

// Sorted longest-first so multi-word aliases ("mercury drug") win over
// their single-word prefixes ("mercury") on substring scan.
const SORTED_ALIASES = Object.keys(KNOWN_PH_VENDORS).sort(
  (a, b) => b.length - a.length,
);

export interface VendorMatch {
  vendor: string | null;
  confidence: "known" | "guessed" | null;
}

export function extractVendorToken(description: string): VendorMatch {
  if (!description) return { vendor: null, confidence: null };
  const lower = description.toLowerCase();

  for (const alias of SORTED_ALIASES) {
    // Word-boundary-ish: alias must sit between non-letters or string edges.
    // Cheap substring + boundary check avoids regex-escape gymnastics on
    // aliases containing "." or "-" (e.g. "mcdonald's", "7-eleven").
    let from = 0;
    while (from <= lower.length - alias.length) {
      const idx = lower.indexOf(alias, from);
      if (idx === -1) break;
      const before = idx === 0 ? "" : lower[idx - 1];
      const after = lower[idx + alias.length] ?? "";
      const boundaryBefore = before === "" || !/[a-z0-9]/.test(before);
      const boundaryAfter = after === "" || !/[a-z0-9]/.test(after);
      if (boundaryBefore && boundaryAfter) {
        return { vendor: KNOWN_PH_VENDORS[alias], confidence: "known" };
      }
      from = idx + 1;
    }
  }

  // Guessed: a single capitalized noun OR an ALL-CAPS short word in the
  // raw description. Skip the leading word if the description starts with
  // a generic verb pattern? Keep it simple — first qualifying token wins.
  const tokens = description.split(/[\s,.;:!?()/\\-]+/).filter(Boolean);
  for (const tok of tokens) {
    if (/^[A-Z]{2,6}$/.test(tok)) {
      return { vendor: tok, confidence: "guessed" };
    }
    if (/^[A-Z][a-z]{2,}$/.test(tok)) {
      return { vendor: tok, confidence: "guessed" };
    }
  }

  return { vendor: null, confidence: null };
}

const NO_VENDOR_KEY = "—";

// URL-safe slug from a canonical vendor display name. Lowercased, alnum-only,
// dashed. Mirrors the inline helpers in vendor-intelligence.tsx and
// spend-anomalies-panel.tsx — kept here so the /spending/vendor/[slug] route
// can match against the same canonical form.
export function vendorSlug(vendor: string): string {
  return vendor
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function groupSpendsByVendor(spends: Spend[]): Map<string, Spend[]> {
  const out = new Map<string, Spend[]>();
  for (const sp of spends) {
    const { vendor } = extractVendorToken(sp.description ?? "");
    const key = vendor ?? NO_VENDOR_KEY;
    const arr = out.get(key) ?? [];
    arr.push(sp);
    out.set(key, arr);
  }
  return out;
}

export interface VendorIntelligence {
  count: number;
  total: number;
  lastSeenAt: string | null;
  avgTicket: number;
  biggestTicket: number;
  firstSeenAt: string | null;
  // Last 12 months of base-currency totals, oldest → newest, anchored on
  // the most recent spend's month (index 11). Quiet months stay 0.
  monthly: number[];
}

const MONTHLY_WINDOW = 12;

export function vendorIntelligence(
  spends: Spend[],
  vendor: string,
): VendorIntelligence {
  const mine: Spend[] = [];
  for (const sp of spends) {
    const { vendor: v } = extractVendorToken(sp.description ?? "");
    const key = v ?? NO_VENDOR_KEY;
    if (key === vendor) mine.push(sp);
  }

  if (mine.length === 0) {
    return {
      count: 0,
      total: 0,
      lastSeenAt: null,
      avgTicket: 0,
      biggestTicket: 0,
      firstSeenAt: null,
      monthly: new Array(MONTHLY_WINDOW).fill(0),
    };
  }

  let total = 0;
  let biggestTicket = 0;
  let lastSeenAt: string | null = null;
  let firstSeenAt: string | null = null;
  for (const sp of mine) {
    const amt = Number(sp.amount_base ?? 0);
    total += amt;
    if (amt > biggestTicket) biggestTicket = amt;
    if (lastSeenAt === null || sp.spent_at > lastSeenAt) lastSeenAt = sp.spent_at;
    if (firstSeenAt === null || sp.spent_at < firstSeenAt) firstSeenAt = sp.spent_at;
  }

  const monthly = new Array<number>(MONTHLY_WINDOW).fill(0);
  if (lastSeenAt) {
    const anchor = new Date(lastSeenAt);
    const anchorY = anchor.getUTCFullYear();
    const anchorM = anchor.getUTCMonth();
    for (const sp of mine) {
      const d = new Date(sp.spent_at);
      const diff =
        (anchorY - d.getUTCFullYear()) * 12 + (anchorM - d.getUTCMonth());
      if (diff >= 0 && diff < MONTHLY_WINDOW) {
        const idx = MONTHLY_WINDOW - 1 - diff;
        monthly[idx] += Number(sp.amount_base ?? 0);
      }
    }
  }

  return {
    count: mine.length,
    total,
    lastSeenAt,
    avgTicket: total / mine.length,
    biggestTicket,
    firstSeenAt,
    monthly,
  };
}

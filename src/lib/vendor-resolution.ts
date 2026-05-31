import type { Spend, Vendor, VendorAlias, SpendVendorLink } from "@/lib/supabase/types";
import { extractVendorToken, vendorSlug } from "@/lib/spending/vendor-extract";

// Vendor resolution layer. Tier 1 used pure-text extraction from spend
// descriptions; Tier 2 adds a canonical `vendors` table the extraction
// lookup resolves against.
//
// Resolution order on a fresh spend:
//   1. Exact alias match (case-insensitive) → return the alias's vendor_id
//   2. Substring scan of canonical_name + alias_norm → return best match
//   3. extractVendorToken() against KNOWN_PH_VENDORS → propose creating a new
//      vendor (creation is a separate action; this fn only RESOLVES).
//
// Used by:
//   - spend create/update server actions (auto-link to spend_vendor_links)
//   - vendor autocomplete in the spend modal
//   - the periodic curiosity sweep when it sees an unmatched vendor token

const NORMALIZE_RE = /[^a-z0-9]+/g;

export function normalizeAlias(text: string): string {
  return text.toLowerCase().normalize("NFKD").replace(/\p{Diacritic}+/gu, "").replace(NORMALIZE_RE, " ").trim();
}

export interface VendorResolution {
  vendor: Vendor | null;
  matchKind: "alias" | "substring" | "extracted" | null;
  // When matchKind === "extracted", the proposed canonical name + slug we'd
  // create if the user accepted the suggestion.
  proposedCanonical?: string;
  proposedSlug?: string;
}

export function resolveVendor(
  description: string,
  vendors: Vendor[],
  aliases: VendorAlias[],
): VendorResolution {
  const desc = description ?? "";
  if (!desc.trim()) {
    return { vendor: null, matchKind: null };
  }
  const norm = normalizeAlias(desc);

  // 1. Exact alias match — pick the row with the longest alias that fits
  //    inside the normalized description as a word boundary.
  const sortedAliases = [...aliases].sort((a, b) => b.alias_norm.length - a.alias_norm.length);
  for (const a of sortedAliases) {
    if (!a.alias_norm) continue;
    if (matchAsWord(norm, a.alias_norm)) {
      const vendor = vendors.find((v) => v.id === a.vendor_id) ?? null;
      if (vendor) return { vendor, matchKind: "alias" };
    }
  }

  // 2. Substring scan against canonical_name. Same word-boundary semantics
  //    so "SM" doesn't match "smaller".
  const sortedVendors = [...vendors]
    .filter((v) => !v.archived)
    .sort((a, b) => b.canonical_name.length - a.canonical_name.length);
  for (const v of sortedVendors) {
    const vnorm = normalizeAlias(v.canonical_name);
    if (vnorm && matchAsWord(norm, vnorm)) {
      return { vendor: v, matchKind: "substring" };
    }
  }

  // 3. Fall back to the KNOWN_PH_VENDORS extractor. If it found one, propose
  //    creating a canonical row (caller decides whether to act).
  const extracted = extractVendorToken(desc);
  if (extracted.vendor) {
    return {
      vendor: null,
      matchKind: "extracted",
      proposedCanonical: extracted.vendor,
      proposedSlug: vendorSlug(extracted.vendor),
    };
  }

  return { vendor: null, matchKind: null };
}

function matchAsWord(haystack: string, needle: string): string | null {
  if (!needle) return null;
  let from = 0;
  while (from <= haystack.length - needle.length) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) break;
    const before = idx === 0 ? "" : haystack[idx - 1];
    const after = haystack[idx + needle.length] ?? "";
    const boundaryBefore = !/[a-z0-9]/.test(before);
    const boundaryAfter = !/[a-z0-9]/.test(after);
    if (boundaryBefore && boundaryAfter) return needle;
    from = idx + 1;
  }
  return null;
}

// Spend → linked vendors (for client-side filter views).
export function vendorsForSpend(
  spendId: string,
  links: SpendVendorLink[],
  vendors: Vendor[],
): Vendor[] {
  const vendorIds = new Set(links.filter((l) => l.spend_id === spendId).map((l) => l.vendor_id));
  return vendors.filter((v) => vendorIds.has(v.id));
}

// Group spends per vendor (using stored links, not re-extraction).
export function spendsByVendor(
  spends: Spend[],
  links: SpendVendorLink[],
): Map<string, Spend[]> {
  const linkBySpend = new Map<string, string[]>();
  for (const l of links) {
    const arr = linkBySpend.get(l.spend_id) ?? [];
    arr.push(l.vendor_id);
    linkBySpend.set(l.spend_id, arr);
  }
  const out = new Map<string, Spend[]>();
  for (const sp of spends) {
    const vendorIds = linkBySpend.get(sp.id) ?? [];
    for (const vid of vendorIds) {
      const arr = out.get(vid) ?? [];
      arr.push(sp);
      out.set(vid, arr);
    }
  }
  return out;
}

// Last-seen rollup — populates vendors.last_seen_at.
export function lastSeenByVendor(links: SpendVendorLink[], spends: Spend[]): Map<string, string> {
  const spendById = new Map(spends.map((s) => [s.id, s] as const));
  const out = new Map<string, string>();
  for (const l of links) {
    const sp = spendById.get(l.spend_id);
    if (!sp) continue;
    const prev = out.get(l.vendor_id);
    if (!prev || sp.spent_at > prev) out.set(l.vendor_id, sp.spent_at);
  }
  return out;
}

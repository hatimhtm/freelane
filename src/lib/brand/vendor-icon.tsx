import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  lookupCuratedVendorBrand,
  normalizeVendorName,
  type VendorBrand,
} from "./vendors";
import type { VendorIconCacheRow } from "@/lib/supabase/types";

// PURE module. Three-tier vendor icon resolver — runs on both server
// (during page render) and client (interactive surfaces). NO "use
// server", NO "import server-only".
//
// Tiers, in order:
//   1. Curated PH vendor registry (src/lib/brand/vendors.ts)
//   2. Per-user AI-fetched cache row (finance.vendor_icon_cache, filled
//      by the identify-vendor brain — write-once per vendor name)
//   3. Generic paper tile + first letter in ink
//
// User overrides (cache row with user_overridden=true) win even over the
// curated registry — once the user picks a glyph for a name, the
// resolver respects it forever. The brain never overwrites such rows.

export type VendorIconResolution = {
  source: "curated" | "cache" | "fallback";
  brand: boolean;
  label: string;
  color: string | null;
  icon: ReactNode;
};

export type ResolveVendorIconOpts = {
  cache?: VendorIconCacheRow | null;
  className?: string;
};

function deriveInitial(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9 ]/g, " ").trim();
  if (!cleaned) return "?";
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function renderBrandIcon(brand: VendorBrand, className?: string): ReactNode {
  const Glyph = brand.Glyph;
  return <Glyph className={cn("shrink-0", className)} ariaLabel={`${brand.label} glyph`} />;
}

function renderGenericFallback(label: string, color: string | null, className?: string): ReactNode {
  const letter = deriveInitial(label);
  const bg = color ?? "oklch(0.28 0.02 250)";
  const fg = color ? "oklch(0.18 0 0)" : "oklch(0.95 0 0)";
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn("shrink-0", className)}
      role="img"
      aria-label={`${label} glyph`}
    >
      <rect width="32" height="32" rx="8" fill={bg} fillOpacity={0.18} />
      <text
        x="16"
        y="17"
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        fontWeight={600}
        fontSize={14}
        fill={fg}
      >
        {letter}
      </text>
    </svg>
  );
}

// Render a cache-row glyph. Three forms — letter (most common), symbol
// (single unicode glyph the AI picked), category (semantic word — we
// just render the first letter for now, but the cache row still carries
// the category_hint string for chatbot context). glyph_kind='none' falls
// through to generic.
function renderCacheGlyph(cache: VendorIconCacheRow, className?: string): ReactNode {
  const label = cache.canonical_name ?? cache.vendor_name_normalized;
  const color = cache.brand_color_hex;
  // Mirror renderGenericFallback's contrast model: when the brain returns a
  // brand color, the LETTER stays dark ink so it doesn't disappear into an
  // 18% tint of the same hex. Without a color we fall to light ink on a
  // neutral tile (parity with the curated registry's letter glyphs).
  const fg = color ? "oklch(0.18 0 0)" : "oklch(0.95 0 0)";
  const bg = color ?? "oklch(0.28 0.02 250)";
  if (cache.glyph_kind === "letter" || cache.glyph_kind === "symbol") {
    const value = (cache.glyph_value ?? deriveInitial(label)).slice(0, 2);
    return (
      <svg
        viewBox="0 0 32 32"
        className={cn("shrink-0", className)}
        role="img"
        aria-label={`${label} glyph`}
      >
        <rect width="32" height="32" rx="8" fill={bg} fillOpacity={0.18} />
        <text
          x="16"
          y="17"
          textAnchor="middle"
          dominantBaseline="central"
          fontFamily="ui-sans-serif, system-ui, sans-serif"
          fontWeight={700}
          fontSize={value.length > 1 ? 11 : 14}
          fill={fg}
        >
          {value}
        </text>
      </svg>
    );
  }
  // category or unknown → fall back to derived initial on tinted tile.
  return renderGenericFallback(label, color, className);
}

export function resolveVendorIcon(
  vendorName: string,
  opts: ResolveVendorIconOpts = {},
): VendorIconResolution {
  const label = vendorName.trim() || "Unknown";
  const className = opts.className;
  const cache = opts.cache ?? null;

  // User override wins forever — even before curated. This is the user's
  // explicit choice; the resolver never second-guesses it. A glyph_kind of
  // 'none' is a valid override: the user is saying "show no brand glyph for
  // this name, even though it's in the curated registry." Honor it with
  // the generic fallback rather than letting tier 1 reinstate the brand.
  if (cache?.user_overridden) {
    if (cache.glyph_kind === "none") {
      return {
        source: "fallback",
        brand: false,
        label: cache.canonical_name ?? label,
        color: null,
        icon: renderGenericFallback(cache.canonical_name ?? label, null, className),
      };
    }
    return {
      source: "cache",
      brand: true,
      label: cache.canonical_name ?? label,
      color: cache.brand_color_hex,
      icon: renderCacheGlyph(cache, className),
    };
  }

  // Tier 1 — curated registry.
  const curated = lookupCuratedVendorBrand(label);
  if (curated) {
    return {
      source: "curated",
      brand: true,
      label: curated.label,
      color: curated.color,
      icon: renderBrandIcon(curated, className),
    };
  }

  // Tier 2 — AI-filled cache row (non-overridden). The 0.4 confidence
  // floor is enforced upstream in identify-vendor.ts (it clamps glyph_kind
  // to "none" when confidence < 0.4), so we only need the glyph_kind
  // check here. Dev-warn if a row sneaks through with sub-floor
  // confidence + a non-none kind — that signals a bad manual edit or a
  // migration backfill that bypassed the brain.
  if (cache && cache.glyph_kind !== "none") {
    if (
      process.env.NODE_ENV !== "production" &&
      typeof cache.confidence === "number" &&
      cache.confidence < 0.4
    ) {
      console.warn(
        `[vendor-icon] cache row for "${cache.vendor_name_normalized}" has glyph_kind="${cache.glyph_kind}" but confidence=${cache.confidence} (below 0.4 floor). Bypassing brain clamp?`,
      );
    }
    return {
      source: "cache",
      brand: true,
      label: cache.canonical_name ?? label,
      color: cache.brand_color_hex,
      icon: renderCacheGlyph(cache, className),
    };
  }

  // Tier 3 — generic fallback.
  return {
    source: "fallback",
    brand: false,
    label,
    color: null,
    icon: renderGenericFallback(label, null, className),
  };
}

// Helper for pre-aggregating a cache map keyed by vendor_name_normalized,
// so the resolver can do O(1) lookups across long lists (vendor leaderboard,
// spend feed, vendors page).
export function indexVendorIconCache(rows: VendorIconCacheRow[]): Map<string, VendorIconCacheRow> {
  const m = new Map<string, VendorIconCacheRow>();
  for (const row of rows) m.set(row.vendor_name_normalized, row);
  return m;
}

// Re-export the normalizer so call sites don't need to dual-import.
export { normalizeVendorName };

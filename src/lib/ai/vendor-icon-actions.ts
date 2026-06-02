"use server";

import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { safeRunLabeled, type ActionResult } from "@/lib/data/actions";
import { identifyVendor, type VendorIdentification } from "./identify-vendor";
import { normalizeVendorName } from "@/lib/brand/vendors";
import type { VendorIconCacheRow } from "@/lib/supabase/types";

// Server-action wrappers around the vendor-icon brain + cache row
// upserts. Lives in a dedicated *-actions.ts file so Next.js 16's
// use-server rule is satisfied (only async exports). Anything that needs
// to invalidate / mutate the cache row also goes here.
//
// identifyVendorIconAction is fire-and-forget from createVendor /
// updateVendor. It:
//   1. normalizes the vendor name
//   2. checks if a cache row already exists for (user, normalized name)
//      with user_overridden=true → bail (respect the user's pick forever)
//   3. calls the Flash Lite brain (cache-aware via withBrainCache)
//   4. upserts the result into finance.vendor_icon_cache
//
// All failures are swallowed at the safeRun boundary so a brain or
// network hiccup never blocks the parent vendor mutation.

export type VendorIconCacheUpsert = Pick<
  VendorIconCacheRow,
  | "vendor_name_normalized"
  | "canonical_name"
  | "brand_color_hex"
  | "glyph_kind"
  | "glyph_value"
  | "category_hint"
  | "confidence"
>;

async function readCacheRow(
  vendorNameNormalized: string,
): Promise<VendorIconCacheRow | null> {
  const user = await getAuthUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("vendor_icon_cache")
    .select("*")
    .eq("user_id", user.id)
    .eq("vendor_name_normalized", vendorNameNormalized)
    .maybeSingle();
  return (data ?? null) as VendorIconCacheRow | null;
}

async function upsertCacheRow(
  vendorNameNormalized: string,
  identification: VendorIdentification,
): Promise<void> {
  const user = await getAuthUser();
  if (!user) return;
  const supabase = await createClient();
  await supabase
    .from("vendor_icon_cache")
    .upsert(
      {
        user_id: user.id,
        vendor_name_normalized: vendorNameNormalized,
        canonical_name: identification.canonical_name,
        brand_color_hex: identification.brand_color_hex,
        glyph_kind: identification.glyph_kind,
        glyph_value: identification.glyph_value,
        category_hint: identification.category_hint,
        confidence: identification.confidence,
        generated_at: new Date().toISOString(),
        user_overridden: false,
      },
      { onConflict: "user_id,vendor_name_normalized" },
    );
}

function cacheRowToIdentification(
  row: VendorIconCacheRow,
): VendorIdentification {
  const kind = row.glyph_kind;
  const safeKind: VendorIdentification["glyph_kind"] =
    kind === "letter" || kind === "symbol" || kind === "category" || kind === "none"
      ? kind
      : "none";
  return {
    canonical_name: row.canonical_name ?? row.vendor_name_normalized,
    brand_color_hex: row.brand_color_hex,
    glyph_kind: safeKind,
    glyph_value: row.glyph_value,
    category_hint: row.category_hint,
    confidence: row.confidence ?? 0,
  };
}

export async function identifyVendorIconAction(
  vendorName: string,
): Promise<ActionResult<VendorIdentification | null>> {
  return safeRunLabeled("freelane-brand", "identify-vendor-icon", async () => {
    const trimmed = (vendorName ?? "").trim();
    if (!trimmed) return null;
    const normalized = normalizeVendorName(trimmed);
    if (!normalized) return null;
    // Respect user override forever — don't even ping the brain.
    const existing = await readCacheRow(normalized);
    if (existing?.user_overridden) return cacheRowToIdentification(existing);
    // Fresh enough? Short-circuit cases:
    //   1. Non-none glyph with confidence >= 0.4 (brain landed) within the
    //      30-day TTL window — refreshes only after TTL so a brain or prompt
    //      change can land an improved glyph eventually.
    //   2. glyph_kind='none' from a prior low-confidence run — the row itself
    //      is the permanent "don't re-ask" marker. Re-asking won't change
    //      the answer unless the brain itself changes (in which case we
    //      bump BRAIN_KEYS.VENDOR_ICON_IDENTIFY and the cache invalidates
    //      naturally via fingerprint mismatch). Pinning these forever
    //      matches the MEMORY.md invariant and saves Flash Lite calls.
    const TTL_MS = 30 * 24 * 60 * 60 * 1000;
    const ageMs = existing?.generated_at
      ? Date.now() - new Date(existing.generated_at).getTime()
      : Infinity;
    const withinTtl = ageMs < TTL_MS;
    if (existing && existing.glyph_kind === "none") return null;
    if (
      existing &&
      withinTtl &&
      existing.glyph_kind !== "none" &&
      typeof existing.confidence === "number" &&
      existing.confidence >= 0.4
    ) {
      return null;
    }
    const result = await identifyVendor({ vendorName: trimmed });
    await upsertCacheRow(normalized, result);
    return result;
  });
}

// User override — invoked from the per-vendor edit-icon control in the
// vendor detail sheet. Sets user_overridden=true so the brain never
// overwrites the row.
export type VendorIconOverrideInput = {
  vendorName: string;
  canonical_name?: string | null;
  brand_color_hex?: string | null;
  glyph_kind: "letter" | "symbol" | "category" | "none";
  glyph_value?: string | null;
  category_hint?: string | null;
};

export async function setVendorIconOverride(
  input: VendorIconOverrideInput,
): Promise<ActionResult<{ vendor_name_normalized: string }>> {
  return safeRunLabeled("freelane-brand", "set-vendor-icon-override", async () => {
    const user = await getAuthUser();
    if (!user) throw new Error("Unauthenticated");
    const trimmed = (input.vendorName ?? "").trim();
    if (!trimmed) throw new Error("Vendor name required.");
    const normalized = normalizeVendorName(trimmed);
    if (!normalized) throw new Error("Vendor name unusable.");
    const supabase = await createClient();
    await supabase
      .from("vendor_icon_cache")
      .upsert(
        {
          user_id: user.id,
          vendor_name_normalized: normalized,
          canonical_name: input.canonical_name ?? trimmed,
          brand_color_hex: input.brand_color_hex ?? null,
          glyph_kind: input.glyph_kind,
          glyph_value: input.glyph_value ?? null,
          category_hint: input.category_hint ?? null,
          confidence: 1,
          generated_at: new Date().toISOString(),
          user_overridden: true,
        },
        { onConflict: "user_id,vendor_name_normalized" },
      );
    return { vendor_name_normalized: normalized };
  });
}

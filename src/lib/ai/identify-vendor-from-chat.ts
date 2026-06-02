import "server-only";

import { Type } from "@google/genai";
import { gemini, hasGemini, pickModel } from "./models";
import { withBrainCache, fingerprintFromIds, scopedBrainKey } from "./cache";
import { BRAIN_KEYS } from "./cache-keys";
import { scrubForbiddenPhrases } from "./voice-scrub";
import { normalizeVendorName } from "@/lib/brand/vendors";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import type { VendorIdentification } from "./identify-vendor";

// Flash Lite brain — identify a vendor from a chat reply.
//
// Different from src/lib/ai/identify-vendor.ts: this brain takes BOTH
// the bare vendor name AND the user's free-text description (a
// vendor_identify_request notification opens the chatbot scoped to the
// vendor; the user types "It's the cigarette stall near my building",
// the brain runs once with that context). The cache key is vendor-
// scoped so re-identification calls per vendor are write-once.
//
// Side effects (the wrapper performs these after a successful brain
// call):
//   - upsert finance.vendor_icon_cache (user_overridden=true so the
//     existing identify-vendor brain never overwrites the user's pick)
//   - clear finance.vendors.needs_identification + brand_key
//   - revalidate /spending so the row's brand glyph re-renders
//
// SKIP path lives in the action wrapper (skipVendorIdentificationAction)
// and short-circuits before this brain is called.

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    canonical_name: { type: Type.STRING },
    brand_color_hex: { type: Type.STRING },
    glyph_kind: { type: Type.STRING },
    glyph_value: { type: Type.STRING },
    category_hint: { type: Type.STRING },
    confidence: { type: Type.NUMBER },
  },
  required: ["canonical_name", "glyph_kind", "confidence"],
} as const;

const SYSTEM_PROMPT = `You identify a Philippine vendor from a bare name + a free-text user description.

Output ONLY structured JSON. Hard rules:
- canonical_name: the chain or place's clean display name. 1-40 chars.
- brand_color_hex: 7-char hex string (#RRGGBB) for the chain's primary brand colour. Leave empty if it's a single-location or unbranded place.
- glyph_kind: one of "letter", "symbol", "category", "none".
  - "letter": short 1-2 char letterform (most chains and most local places).
  - "symbol": single unicode glyph (₱, ⌂, ⛽, ☕, etc).
  - "category": a one-word category hint (food, drug, fuel, transit, grocery, service, sari_sari).
  - "none": you cannot identify what this place is from the description.
- glyph_value: ≤ 2 chars. Required when glyph_kind is letter or symbol.
- category_hint: ≤ 16 chars (food, drug, grocery, transit, fuel, telco, bank, service, sari_sari, other).
- confidence ∈ [0,1]. The user's description is the primary signal — even an unbranded sari-sari store has 0.8+ confidence if the description is clear.
- NEVER fabricate a chain match. If the user describes a unique local place, choose "letter" with the first letter of the canonical_name + a reasonable category_hint.
- NEVER write coaching prose anywhere in any field.

Return ONLY the JSON object.`;

export type IdentifyVendorFromChatInput = {
  vendorName: string;
  userDescription: string;
};

function emptyResult(input: string): VendorIdentification {
  return {
    canonical_name: input,
    brand_color_hex: null,
    glyph_kind: "none",
    glyph_value: null,
    category_hint: null,
    confidence: 0,
  };
}

const HEX_RE = /^#?[0-9a-fA-F]{6}$/;

function normalizeHex(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!HEX_RE.test(s)) return null;
  return s.startsWith("#") ? s : `#${s}`;
}

function clampKind(raw: unknown): "letter" | "symbol" | "category" | "none" {
  const s = typeof raw === "string" ? raw.toLowerCase() : "";
  if (s === "letter" || s === "symbol" || s === "category") return s;
  return "none";
}

// Pure brain. Cached via withBrainCache keyed on (vendor_normalized,
// description fingerprint) so re-asking with the same description is a
// free read. The 30-day TTL is the catalogue floor — the wrapper writes
// vendor_icon_cache with user_overridden=true which is the durable truth.
export async function identifyVendorFromChat(
  input: IdentifyVendorFromChatInput,
): Promise<VendorIdentification> {
  if (!hasGemini()) return emptyResult(input.vendorName.trim());
  const name = (input.vendorName ?? "").trim();
  const description = (input.userDescription ?? "").trim();
  if (!name) return emptyResult(name);
  const normalized = normalizeVendorName(name);
  if (!normalized) return emptyResult(name);

  const fp = await fingerprintFromIds([
    "identify_vendor_from_chat",
    normalized,
    description.slice(0, 200),
  ]);

  const cached = await withBrainCache<VendorIdentification>({
    brainKey: scopedBrainKey(
      BRAIN_KEYS.VENDOR_IDENTIFY_FROM_CHAT,
      "vendor",
      normalized,
    ),
    fingerprint: fp,
    phtDayAnchored: false,
    regen: async () => {
      const prompt = `VENDOR NAME: ${name}\nNormalized form: ${normalized}\n\nUSER DESCRIPTION:\n${description}\n\nReturn the structured identification JSON.`;
      const res = await gemini().models.generateContent({
        model: pickModel("fast"),
        contents: prompt,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          temperature: 0.1,
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
        },
      });
      const parsed = JSON.parse((res.text ?? "{}").trim()) as Partial<{
        canonical_name: string;
        brand_color_hex: string;
        glyph_kind: string;
        glyph_value: string;
        category_hint: string;
        confidence: number;
      }>;
      const confidence = Math.max(0, Math.min(1, Number(parsed.confidence ?? 0)));
      const kind = clampKind(parsed.glyph_kind);
      const canonical = scrubForbiddenPhrases(
        String(parsed.canonical_name ?? name).trim(),
      ).slice(0, 40) || name;
      const category = scrubForbiddenPhrases(
        String(parsed.category_hint ?? "").trim(),
      ).slice(0, 16);
      const result: VendorIdentification = {
        canonical_name: canonical,
        brand_color_hex: normalizeHex(parsed.brand_color_hex),
        glyph_kind: confidence < 0.4 ? "none" : kind,
        glyph_value:
          (kind === "letter" || kind === "symbol")
            ? String(parsed.glyph_value ?? "").trim().slice(0, 2) || null
            : null,
        category_hint: category || null,
        confidence,
      };
      return result;
    },
  });

  return cached?.payload ?? emptyResult(name);
}

// Side-effect wrapper — runs the brain, then writes vendor_icon_cache
// (user_overridden=true) and clears the needs_identification flag on
// finance.vendors. Best-effort: any write failure is swallowed but
// surfaced via the return shape so the caller can show a toast.
export async function completeVendorIdentificationFromChat(args: {
  vendorId: string;
  vendorName: string;
  userDescription: string;
}): Promise<{ ok: boolean; brand_key: string | null; error?: string }> {
  try {
    const user = await getAuthUser();
    if (!user) return { ok: false, brand_key: null, error: "Unauthenticated" };
    const supabase = await createClient();
    const identification = await identifyVendorFromChat({
      vendorName: args.vendorName,
      userDescription: args.userDescription,
    });
    const normalized = normalizeVendorName(args.vendorName);
    if (!normalized) return { ok: false, brand_key: null, error: "Vendor name unusable." };
    // Cache row — user_overridden=true so the auto brain never replaces
    // this answer on a future re-render.
    await supabase
      .from("vendor_icon_cache")
      .upsert(
        {
          user_id: user.id,
          vendor_name_normalized: normalized,
          canonical_name: identification.canonical_name,
          brand_color_hex: identification.brand_color_hex,
          glyph_kind: identification.glyph_kind,
          glyph_value: identification.glyph_value,
          category_hint: identification.category_hint,
          confidence: identification.confidence,
          generated_at: new Date().toISOString(),
          user_overridden: true,
        },
        { onConflict: "user_id,vendor_name_normalized" },
      );
    // Clear the identification flag on the vendor row. brand_key is
    // populated by the Brand Identity workflow's resolver, not here.
    //
    // We do NOT also reset identification_skipped: the dispatcher gate
    // is `needs_identification && !identification_skipped`, and the
    // skip path NEVER flips needs_identification back to true on its
    // own — so re-clearing identification_skipped has no observable
    // effect. Dropping the redundant write keeps the action focused.
    await supabase
      .from("vendors")
      .update({ needs_identification: false })
      .eq("id", args.vendorId)
      .eq("user_id", user.id);
    return { ok: true, brand_key: null };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, brand_key: null, error: message };
  }
}

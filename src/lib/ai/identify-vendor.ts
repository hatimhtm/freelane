import "server-only";

import { Type } from "@google/genai";
import { gemini, hasGemini, pickModel } from "./models";
import { withBrainCache, fingerprintFromIds, scopedBrainKey } from "./cache";
import { BRAIN_KEYS } from "./cache-keys";
import { scrubForbiddenPhrases } from "./voice-scrub";
import { normalizeVendorName } from "@/lib/brand/vendors";

// Flash Lite brain — identify a vendor by name.
//
// Takes a free-form vendor name (whatever the user wrote on the spend
// row or pasted into the vendor create modal) and returns a structured
// brand identification: canonical name, a brand colour the resolver can
// tint the tile with, a glyph_kind + glyph_value the resolver can paint,
// a confidence score, and a category hint that flows into the chatbot
// context.
//
// Confidence floor: <0.4 returns glyph_kind='none' so the cache row
// persists and the brain isn't re-asked for the same name. The resolver
// falls through to the generic paper tile + initial.
//
// Why a brain at all (instead of "wait for the user to wire it"): names
// like "jolibe" / "sm mayapa" / "merc drug" / "7e" don't survive the
// curated registry's exact-slug + fuzzy alias matcher. Flash Lite can
// recognise PH retail patterns trivially and seed the cache so the
// resolver never asks again.
//
// VOICE: the brain writes structured fields, NOT prose. Forbidden-phrase
// scrubbing still runs on the canonical_name + category_hint as a
// belt-and-braces measure.

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

const SYSTEM_PROMPT = `You identify a Philippine retail vendor from a free-form name string.

Output ONLY structured JSON. Hard rules:
- canonical_name: the chain's standard display name. e.g. "Jollibee", "7-Eleven", "Mercury Drug". 1-40 chars.
- brand_color_hex: 7-char hex string (#RRGGBB) for the chain's primary brand colour. Leave empty if unknown.
- glyph_kind: one of "letter", "symbol", "category", "none".
  - "letter": short 1-2 char letterform mark (most chains). Put it in glyph_value.
  - "symbol": single unicode glyph (₱, ⌂, etc). Put it in glyph_value.
  - "category": a one-word category hint (food, drug, fuel, transit, grocery, service). The resolver paints a generic category tile.
  - "none": you are not confident the name is a known vendor. confidence MUST be < 0.4 when this is the value.
- glyph_value: ≤ 2 chars. Required when glyph_kind is letter or symbol.
- category_hint: short category word — ≤ 16 chars (food, drug, grocery, transit, fuel, telco, bank, service, other).
- confidence ∈ [0,1]. 0.9+ for unambiguous chain matches; 0.5-0.7 for partial / regional matches; below 0.4 use glyph_kind="none".
- NEVER fabricate a name. If you don't recognize the input, emit canonical_name=<input verbatim trimmed>, glyph_kind="none", confidence < 0.4.
- NEVER write coaching prose anywhere in any field.

Return ONLY the JSON object.`;

export type VendorIdentification = {
  canonical_name: string;
  brand_color_hex: string | null;
  glyph_kind: "letter" | "symbol" | "category" | "none";
  glyph_value: string | null;
  category_hint: string | null;
  confidence: number;
};

export type IdentifyVendorInput = {
  vendorName: string;
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

// Pure brain call. Cached via withBrainCache keyed on the normalized
// vendor name so re-asking the same input is a free read. The PHT-day
// anchor is OFF — vendor identity isn't day-anchored. TTL fallback is
// the 30-day shelf marker.
export async function identifyVendor(
  input: IdentifyVendorInput,
): Promise<VendorIdentification> {
  if (!hasGemini()) return emptyResult(input.vendorName.trim());
  const name = (input.vendorName ?? "").trim();
  if (!name) return emptyResult(name);
  const normalized = normalizeVendorName(name);
  if (!normalized) return emptyResult(name);

  const fp = await fingerprintFromIds(["identify_vendor", normalized]);

  const cached = await withBrainCache<VendorIdentification>({
    brainKey: scopedBrainKey(
      BRAIN_KEYS.VENDOR_ICON_IDENTIFY,
      "vendor",
      normalized,
    ),
    fingerprint: fp,
    phtDayAnchored: false,
    regen: async () => {
      const prompt = `VENDOR NAME: ${name}\n\nNormalized form (for context): ${normalized}\n\nReturn the structured identification JSON.`;
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

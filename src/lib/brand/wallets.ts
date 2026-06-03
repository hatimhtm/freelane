import type { ComponentType } from "react";
import type { PaymentMethod } from "@/lib/supabase/types";
import { CoinPhGlyph } from "@/components/brand/wallet-glyphs/coin-ph-glyph";
import { GCashGlyph } from "@/components/brand/wallet-glyphs/gcash-glyph";
import { CashGlyph } from "@/components/brand/wallet-glyphs/cash-glyph";
import { WiseGlyph } from "@/components/brand/wallet-glyphs/wise-glyph";
import { CoinmamaGlyph } from "@/components/brand/wallet-glyphs/coinmama-glyph";
import { CFGBankGlyph } from "@/components/brand/wallet-glyphs/cfg-bank-glyph";
import { GenericWalletGlyph } from "@/components/brand/wallet-glyphs/generic-wallet-glyph";

// PURE module: no "use server", no "import server-only". This registry +
// resolver runs on both server (page render) and client (interactive
// wallet picker). Mirrors the shape of src/lib/brand/client-accent.ts.
//
// Wallet identity is now driven off the brand_key column on
// finance.payment_methods (migration 0078). resolveWalletBrand prefers
// that column; when null, it fuzzy-matches the wallet name as a fallback
// so users who renamed wallets idiosyncratically still see brand colour
// before they wire brand_key explicitly.

export type WalletGlyphProps = {
  className?: string;
  ariaLabel?: string;
};

export type WalletGlyphComponent = ComponentType<WalletGlyphProps>;

// Stable string union for all brand_key values the picker can write —
// the 6 canonical brand keys + the literal "custom" escape hatch (the
// custom_brand_glyph + custom_brand_color columns drive the render in
// that case). Exported so MethodValues / PaymentMethodInput /
// BrandPickerValue all narrow against the same source of truth.
export type WalletBrandKey =
  | "coin_ph"
  | "gcash"
  | "cash"
  | "wise"
  | "coinmama"
  | "cfg_bank"
  | "custom";

export type WalletBrand = {
  // Curated brand keys, the "custom" escape hatch, or the literal
  // "generic" produced by buildGenericWalletBrand when nothing else
  // matches.
  brandKey: WalletBrandKey | "generic";
  label: string;
  // Brand hex. Cash has no corporate brand — color is null so render
  // callsites fall back to the neutral paper tint.
  color: string | null;
  // Stylized SVG component. Always renders a 32x32 viewBox. Pass through
  // className to size it on the call site.
  Glyph: WalletGlyphComponent;
};

// The 6 canonical wallets seeded in wallet_platform_metadata.
export const WALLET_BRANDS: Record<string, WalletBrand> = {
  coin_ph: {
    brandKey: "coin_ph",
    label: "coin.ph",
    color: "#FF6B00",
    Glyph: CoinPhGlyph,
  },
  gcash: {
    brandKey: "gcash",
    label: "GCash",
    color: "#0073E6",
    Glyph: GCashGlyph,
  },
  cash: {
    brandKey: "cash",
    label: "Cash",
    color: null,
    Glyph: CashGlyph,
  },
  wise: {
    brandKey: "wise",
    label: "Wise",
    color: "#00B9FF",
    Glyph: WiseGlyph,
  },
  coinmama: {
    brandKey: "coinmama",
    label: "Coinmama",
    color: "#FFC42F",
    Glyph: CoinmamaGlyph,
  },
  cfg_bank: {
    brandKey: "cfg_bank",
    label: "CFG",
    color: "#1B4D2E",
    Glyph: CFGBankGlyph,
  },
};

// Generic brand returned when no curated entry matches. The Glyph is the
// paper-tile-with-initial fallback — caller still needs to provide the
// initial letter at render time. We expose a builder that wraps the
// generic glyph so the resolved object has the same shape as the
// curated brands.
export const GENERIC_WALLET_BRAND_KEY = "generic";
export const CUSTOM_WALLET_BRAND_KEY = "custom";

export function buildGenericWalletBrand(initial: string, label: string): WalletBrand {
  const letter = (initial || label.slice(0, 1) || "?").trim();
  const GenericGlyphForInitial: WalletGlyphComponent = (props) => (
    GenericWalletGlyph({ ...props, initial: letter })
  );
  GenericGlyphForInitial.displayName = `GenericWalletGlyph(${letter})`;
  return {
    brandKey: GENERIC_WALLET_BRAND_KEY,
    label,
    color: null,
    Glyph: GenericGlyphForInitial,
  };
}

// Pick a legible foreground colour for a given background hex. White on
// dark, ink on light. Computes relative luminance from the picked hex
// so a #FF6600 background paints with white text and a #FFFF66 with ink.
function pickLegibleForeground(hex: string): string {
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return "oklch(0.95 0 0)";
  let r = 0;
  let g = 0;
  let b = 0;
  const body = m[1];
  if (body.length === 3) {
    r = parseInt(body[0] + body[0], 16);
    g = parseInt(body[1] + body[1], 16);
    b = parseInt(body[2] + body[2], 16);
  } else {
    r = parseInt(body.slice(0, 2), 16);
    g = parseInt(body.slice(2, 4), 16);
    b = parseInt(body.slice(4, 6), 16);
  }
  // sRGB relative-luminance — same formula the WCAG contrast checks use.
  const srgb = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const luminance = 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
  return luminance > 0.55 ? "oklch(0.28 0.02 250)" : "oklch(0.97 0 0)";
}

// Custom-brand builder — used when brand_key === "custom" + the row carries
// custom_brand_glyph / custom_brand_color (migration 0110). Reuses the
// generic glyph but lets the caller override the colour swatch so the
// custom hex shows up VERBATIM in the rendered tile (background +
// computed-contrast foreground), not just in the outer wrapper tint.
// Earlier versions only routed the hex through walletBrandTintStyle on
// the wrapper, so the glyph itself stayed neutral and the brief's
// "renders verbatim" promise quietly broke.
export function buildCustomWalletBrand(glyph: string, color: string | null, label: string): WalletBrand {
  const letter = (glyph || label.slice(0, 1) || "?").trim();
  const validColor =
    color && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color) ? color : null;
  const foreground = validColor ? pickLegibleForeground(validColor) : null;
  const GenericGlyphForInitial: WalletGlyphComponent = (props) => (
    GenericWalletGlyph({
      ...props,
      initial: letter,
      backgroundFill: validColor,
      foregroundFill: foreground,
    })
  );
  GenericGlyphForInitial.displayName = `CustomWalletGlyph(${letter})`;
  return {
    brandKey: CUSTOM_WALLET_BRAND_KEY,
    label,
    color: validColor,
    Glyph: GenericGlyphForInitial,
  };
}

function slugifyMethodName(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]/g, "");
}

// Fuzzy fallback — substring match the slugged name against each brand's
// known slug aliases. Order matters: longer/more-specific aliases first
// so "coinmama" never collides with the looser "coin" alias for coin.ph.
const FUZZY_ALIASES: Array<{ brandKey: string; needles: readonly string[] }> = [
  { brandKey: "coinmama", needles: ["coinmama"] },
  { brandKey: "coin_ph",  needles: ["coinph", "coin"] },
  { brandKey: "gcash",    needles: ["gcash"] },
  { brandKey: "wise",     needles: ["wise", "transferwise"] },
  { brandKey: "cfg_bank", needles: ["cfg"] },
  { brandKey: "cash",     needles: ["cash"] },
];

export function fuzzyMatchWalletBrandKey(name: string): string | null {
  const slug = slugifyMethodName(name);
  if (!slug) return null;
  for (const { brandKey, needles } of FUZZY_ALIASES) {
    if (needles.some((n) => slug.includes(n))) return brandKey;
  }
  return null;
}

// Derive a short display initial for the generic fallback (1-2 chars).
function deriveInitial(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9 ]/g, " ").trim();
  if (!cleaned) return "?";
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

// Public resolver. Wallets prefer their explicit brand_key column; if
// null/unknown, we fuzzy-match the display name; if still unmatched, we
// return the generic paper-tile brand with a derived initial.
//
// brand_key === "custom" routes to the custom builder which reads
// custom_brand_glyph + custom_brand_color from the payment_methods row
// (migration 0110) — the user-controlled escape hatch for wallets that
// don't match any curated brand AND can't be fuzzy-matched.
export function resolveWalletBrand(
  method: Pick<PaymentMethod, "name" | "brand_key"> & {
    custom_brand_glyph?: string | null;
    custom_brand_color?: string | null;
  },
): WalletBrand {
  const explicit = method.brand_key?.trim();
  if (explicit === CUSTOM_WALLET_BRAND_KEY) {
    // Dev-only data-integrity drift signal. The DB CHECK constraints
    // require custom_brand_glyph to be non-null when brand_key === 'custom',
    // so a null here only happens via a manual SQL edit (or a bypassed
    // form). The render still degrades gracefully (we fall back to a
    // derived initial), but flagging it early in dev makes the drift
    // visible instead of silent.
    if (
      process.env.NODE_ENV !== "production" &&
      !method.custom_brand_glyph?.trim()
    ) {
      console.warn(
        `[wallets] brand_key='custom' on "${method.name}" but custom_brand_glyph is null — falling back to derived initial.`,
      );
    }
    return buildCustomWalletBrand(
      method.custom_brand_glyph?.trim() || deriveInitial(method.name),
      method.custom_brand_color ?? null,
      method.name,
    );
  }
  if (explicit && WALLET_BRANDS[explicit]) return WALLET_BRANDS[explicit];
  const fuzzy = fuzzyMatchWalletBrandKey(method.name);
  if (fuzzy && WALLET_BRANDS[fuzzy]) return WALLET_BRANDS[fuzzy];
  return buildGenericWalletBrand(deriveInitial(method.name), method.name);
}

// Convenience for surfaces that only have a name (legacy callers, ad-hoc
// chip rendering). Behaves identical to resolveWalletBrand without a
// brand_key — fuzzy match first, then generic.
export function resolveWalletBrandFromName(name: string): WalletBrand {
  return resolveWalletBrand({ name, brand_key: null });
}

// Helper for surfaces that want a tinted background style for the
// resolved brand. Returns a 6%-opacity color string that mounts cleanly
// on paper without screaming. Cash + generic (color===null) return null
// so the caller can omit the tint entirely.
export function walletBrandTintStyle(brand: WalletBrand): { background: string } | undefined {
  if (!brand.color) return undefined;
  return { background: `${brand.color}10` }; // 0x10 / 0xff ≈ 6.3% on hex colors
}

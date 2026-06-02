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

export type WalletBrand = {
  brandKey: string;
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
export function resolveWalletBrand(
  method: Pick<PaymentMethod, "name" | "brand_key">,
): WalletBrand {
  const explicit = method.brand_key?.trim();
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

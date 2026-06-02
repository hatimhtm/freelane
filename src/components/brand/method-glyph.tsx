import { cn } from "@/lib/utils";
import { resolveWalletBrand } from "@/lib/brand/wallets";

// Wallet brand glyph. As of the Brand Identity workflow this delegates to
// resolveWalletBrand, which prefers the wallet's explicit brand_key
// column (migration 0078) and falls back to fuzzy name-slug matching for
// wallets that pre-date the column.
//
// Backwards compatibility: call sites that only have a name keep working
// — `brandKey` is optional. New surfaces should pass the brand_key
// directly so the resolver doesn't need the fuzzy fallback path.
//
// Sizing: pass `className="size-X"` to scale the 32x32 viewBox.

export type MethodGlyphProps = {
  name: string;
  brandKey?: string | null;
  className?: string;
  ariaLabel?: string;
};

export function MethodGlyph({ name, brandKey, className, ariaLabel }: MethodGlyphProps) {
  const brand = resolveWalletBrand({ name, brand_key: brandKey ?? null });
  const Glyph = brand.Glyph;
  return (
    <Glyph
      className={cn("shrink-0", className)}
      ariaLabel={ariaLabel ?? `${brand.label} glyph`}
    />
  );
}

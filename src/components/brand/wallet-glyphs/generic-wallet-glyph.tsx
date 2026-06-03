import { cn } from "@/lib/utils";

// Generic wallet glyph — paper tile + derived initial. The terminal
// fallback in the resolveWalletBrand chain. Default ink-on-paper styling
// keeps the row visually quiet so unknown wallets don't out-shout the
// curated brands.
//
// Custom-brand support (migration 0110): when the user picks a custom
// brand, the picker passes an optional `backgroundFill` (their hex) and
// the glyph paints the rect with it at 18% opacity; foreground colour
// is derived for legibility so we don't drift into illegible
// dark-on-dark territory. Without overrides, behaviour is unchanged so
// the generic fallback stays visually quiet.
export function GenericWalletGlyph({
  initial,
  className,
  ariaLabel = "wallet",
  backgroundFill,
  foregroundFill,
}: {
  initial: string;
  className?: string;
  ariaLabel?: string;
  backgroundFill?: string | null;
  foregroundFill?: string | null;
}) {
  const raw = (initial || "?").trim();
  // Up to 4 chars per the DB constraint (custom_brand_glyph length 1..4).
  // Auto-shrink the type so a 3-4 char glyph doesn't overflow the tile.
  const letter = raw.length > 0 ? raw.slice(0, 4).toUpperCase() : "?";
  const fontSize = letter.length >= 4 ? 8 : letter.length === 3 ? 10 : 14;

  const hasCustomBg = !!backgroundFill;
  const rectFill = backgroundFill ?? "oklch(0.28 0.02 250)";
  const rectOpacity = hasCustomBg ? 0.22 : 0.1;
  const textFill =
    foregroundFill ??
    (hasCustomBg ? backgroundFill ?? "oklch(0.95 0 0)" : "oklch(0.95 0 0)");

  return (
    <svg
      viewBox="0 0 32 32"
      className={cn("shrink-0", className)}
      role="img"
      aria-label={ariaLabel}
    >
      <rect width="32" height="32" rx="8" fill={rectFill} fillOpacity={rectOpacity} />
      <text
        x="16"
        y="17"
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        fontWeight={600}
        fontSize={fontSize}
        fill={textFill}
      >
        {letter}
      </text>
    </svg>
  );
}

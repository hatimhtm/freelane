import { cn } from "@/lib/utils";

// Generic wallet glyph — paper tile + derived initial. The terminal
// fallback in the resolveWalletBrand chain. Default ink-on-paper styling
// keeps the row visually quiet so unknown wallets don't out-shout the
// curated brands.
export function GenericWalletGlyph({
  initial,
  className,
  ariaLabel = "wallet",
}: {
  initial: string;
  className?: string;
  ariaLabel?: string;
}) {
  const letter = (initial || "?").slice(0, 1).toUpperCase();
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn("shrink-0", className)}
      role="img"
      aria-label={ariaLabel}
    >
      <rect width="32" height="32" rx="8" fill="oklch(0.28 0.02 250)" fillOpacity={0.10} />
      <text
        x="16"
        y="17"
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        fontWeight={600}
        fontSize={14}
        fill="oklch(0.95 0 0)"
      >
        {letter}
      </text>
    </svg>
  );
}

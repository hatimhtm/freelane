import { cn } from "@/lib/utils";

// Stylized Coinmama glyph — NOT the literal corporate mark. Amber tile with
// a stacked-coin motif suggesting an exchange on-ramp.
export function CoinmamaGlyph({
  className,
  ariaLabel = "Coinmama",
}: {
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn("shrink-0", className)}
      role="img"
      aria-label={ariaLabel}
    >
      <rect width="32" height="32" rx="8" fill="#FFC42F" fillOpacity={0.16} />
      <ellipse cx="16" cy="11" rx="7" ry="2.4" fill="none" stroke="oklch(0.40 0.12 80)" strokeWidth={1.2} />
      <path d="M9 11 V18 A 7 2.4 0 0 0 23 18 V11" fill="none" stroke="oklch(0.40 0.12 80)" strokeWidth={1.2} />
      <ellipse cx="16" cy="18" rx="7" ry="2.4" fill="none" stroke="oklch(0.40 0.12 80)" strokeWidth={1.0} />
    </svg>
  );
}

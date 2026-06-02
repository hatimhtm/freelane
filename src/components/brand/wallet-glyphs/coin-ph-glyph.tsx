import { cn } from "@/lib/utils";

// Stylized coin.ph glyph — NOT the literal corporate mark. A coin disc in
// the brand orange with an inset "c" lowercase letterform. 32x32 viewBox,
// rounded background tile so the same rx=8 cadence reads across the
// wallet glyph set.
export function CoinPhGlyph({
  className,
  ariaLabel = "coin.ph",
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
      <rect width="32" height="32" rx="8" fill="#FF6B00" fillOpacity={0.12} />
      <circle cx="16" cy="16" r="9" fill="#FF6B00" fillOpacity={0.18} stroke="#FF6B00" strokeWidth={1.4} />
      <text
        x="16"
        y="17.5"
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        fontWeight={700}
        fontSize={12}
        fill="#FF6B00"
      >
        c
      </text>
    </svg>
  );
}

import { cn } from "@/lib/utils";

// Stylized Wise glyph — NOT the literal corporate mark. Brand cyan tile
// with two arrow-ish dashes evoking cross-currency flow + a "W" letterform.
export function WiseGlyph({
  className,
  ariaLabel = "Wise",
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
      <rect width="32" height="32" rx="8" fill="#00B9FF" fillOpacity={0.14} />
      <path
        d="M8 12 L12 22 L16 14 L20 22 L24 12"
        fill="none"
        stroke="#0099D6"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

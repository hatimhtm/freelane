import { cn } from "@/lib/utils";

// Stylized Cash glyph — paper-warm tile with a peso symbol. No corporate
// brand to approximate; this is the "physical cash" rail.
export function CashGlyph({
  className,
  ariaLabel = "Cash",
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
      <rect width="32" height="32" rx="8" fill="oklch(0.72 0.13 80)" fillOpacity={0.14} />
      <rect x="6" y="10" width="20" height="12" rx="2" fill="oklch(0.72 0.13 80)" fillOpacity={0.22} stroke="oklch(0.40 0.05 80)" strokeWidth={1.1} />
      <text
        x="16"
        y="17"
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        fontWeight={700}
        fontSize={11}
        fill="oklch(0.30 0.05 80)"
      >
        ₱
      </text>
    </svg>
  );
}

import { cn } from "@/lib/utils";

// Stylized GCash glyph — NOT the literal corporate mark. Brand blue tile
// with a chat-bubble-style rounded square and a peso-bold inset glyph.
export function GCashGlyph({
  className,
  ariaLabel = "GCash",
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
      <rect width="32" height="32" rx="8" fill="#0073E6" fillOpacity={0.12} />
      <rect x="7" y="8" width="18" height="14" rx="4" fill="#0073E6" fillOpacity={0.22} stroke="#0073E6" strokeWidth={1.2} />
      <text
        x="16"
        y="16"
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        fontWeight={700}
        fontSize={10}
        fill="#0073E6"
      >
        G
      </text>
    </svg>
  );
}

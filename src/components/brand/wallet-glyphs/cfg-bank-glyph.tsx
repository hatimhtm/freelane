import { cn } from "@/lib/utils";

// Stylized CFG Bank glyph — NOT the literal corporate mark. Deep-green
// tile with a column-portico motif suggesting a bank facade.
export function CFGBankGlyph({
  className,
  ariaLabel = "CFG Bank",
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
      <rect width="32" height="32" rx="8" fill="#1B4D2E" fillOpacity={0.14} />
      <path d="M7 12 L16 7 L25 12" fill="none" stroke="#1B4D2E" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
      <line x1="9" y1="14" x2="9" y2="22" stroke="#1B4D2E" strokeWidth={1.3} strokeLinecap="round" />
      <line x1="14" y1="14" x2="14" y2="22" stroke="#1B4D2E" strokeWidth={1.3} strokeLinecap="round" />
      <line x1="18" y1="14" x2="18" y2="22" stroke="#1B4D2E" strokeWidth={1.3} strokeLinecap="round" />
      <line x1="23" y1="14" x2="23" y2="22" stroke="#1B4D2E" strokeWidth={1.3} strokeLinecap="round" />
      <line x1="6.5" y1="23" x2="25.5" y2="23" stroke="#1B4D2E" strokeWidth={1.4} strokeLinecap="round" />
    </svg>
  );
}

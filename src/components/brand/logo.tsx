import { cn } from "@/lib/utils";

// Ink tile, ascending bars, with the top bar in acid lime — the brand's one
// sanctioned splash of the signature colour.
export function LogoMark({ className }: { className?: string }) {
  // CSS vars must go through `style`, not SVG presentation attributes
  // (fill="var(--x)" silently renders nothing in SVG).
  return (
    <svg viewBox="0 0 32 32" className={cn("shrink-0", className)} aria-hidden="true">
      <rect width="32" height="32" rx="9" style={{ fill: "var(--ink)" }} />
      <rect x="7"  y="18" width="4" height="7"  rx="1.5" style={{ fill: "var(--paper)" }} fillOpacity="0.5" />
      <rect x="14" y="12" width="4" height="13" rx="1.5" style={{ fill: "var(--paper)" }} fillOpacity="0.75" />
      <rect x="21" y="7"  width="4" height="18" rx="1.5" style={{ fill: "var(--brand)" }} />
    </svg>
  );
}

export function Logo({
  className,
  markClassName,
  showWordmark = true,
}: {
  className?: string;
  markClassName?: string;
  showWordmark?: boolean;
}) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <LogoMark className={cn("h-7 w-7", markClassName)} />
      {showWordmark && (
        <span className="font-display text-[17px] tracking-tight">Freelane</span>
      )}
    </div>
  );
}

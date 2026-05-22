import { cn } from "@/lib/utils";

// Ink tile, ascending bars, with the top bar in acid lime — the brand's one
// sanctioned splash of the signature colour.
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("shrink-0", className)} aria-hidden="true">
      <rect width="32" height="32" rx="9" className="fill-[var(--ink)]" />
      <rect x="7"  y="18" width="4" height="7"  rx="1.5" fill="white" fillOpacity="0.45" />
      <rect x="14" y="12" width="4" height="13" rx="1.5" fill="white" fillOpacity="0.7" />
      <rect x="21" y="7"  width="4" height="18" rx="1.5" fill="var(--brand)" />
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

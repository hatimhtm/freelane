import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn("shrink-0", className)}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="freelane-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#9d6bff" />
          <stop offset="1" stopColor="#5b9dff" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#freelane-mark)" />
      <rect x="7"  y="18" width="4" height="7"  rx="1.5" fill="white" fillOpacity="0.55" />
      <rect x="14" y="12" width="4" height="13" rx="1.5" fill="white" fillOpacity="0.78" />
      <rect x="21" y="7"  width="4" height="18" rx="1.5" fill="white" />
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
    <div className={cn("flex items-center gap-2", className)}>
      <LogoMark className={cn("h-7 w-7", markClassName)} />
      {showWordmark && (
        <span className="text-[15px] font-semibold tracking-tight">Freelane</span>
      )}
    </div>
  );
}

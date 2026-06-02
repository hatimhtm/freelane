"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// Floating primary action — the one "I want to do THIS" affordance per page.
// Sits fixed bottom-right, painted in the acid-lime brand colour so it reads
// as the obvious next step regardless of how much else is on the screen.
//
// NOTE: the Log-a-spend floating helper was removed (T25). Today + Dashboard
// now lean on the global ⌘L shortcut and ⌘K command palette for that path.
// Other surfaces still use this generic FAB for their primary action.

export function PrimaryAction({
  label,
  icon: Icon,
  href,
  onClick,
  className,
  ariaLabel,
}: {
  label: string;
  icon: LucideIcon;
  href?: string;
  onClick?: () => void;
  className?: string;
  ariaLabel?: string;
}) {
  const cls = cn(
    "fixed bottom-5 right-5 z-30 inline-flex items-center gap-2 rounded-full bg-[var(--brand)] px-5 py-3 text-sm font-medium tracking-tight text-[var(--brand-foreground)] shadow-xl ring-1 ring-foreground/10 transition-all hover:scale-[1.04] active:scale-95 sm:bottom-7 sm:right-7",
    "[padding-bottom:max(0.75rem,env(safe-area-inset-bottom))]",
    className,
  );
  const inner = (
    <>
      <Icon className="h-4 w-4" aria-hidden />
      <span>{label}</span>
    </>
  );
  if (href) {
    return (
      <Link href={href} className={cls} aria-label={ariaLabel ?? label}>
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cls} aria-label={ariaLabel ?? label}>
      {inner}
    </button>
  );
}

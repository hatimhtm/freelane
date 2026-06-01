"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// Floating primary action — the one "I want to do THIS" affordance per page.
// Sits fixed bottom-right, painted in the acid-lime brand colour so it reads
// as the obvious next step regardless of how much else is on the screen.
// The bar also leaves room above the iOS home indicator on PWA installs.
//
// Pass `href` to navigate. Pass `onClick` to fire an inline handler (e.g.
// dispatch the open-spend-sheet event Today + Spending already listen for).

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
    "fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 rounded-full bg-[var(--brand)] px-5 py-3 text-sm font-medium tracking-tight text-[var(--brand-foreground)] shadow-xl ring-1 ring-foreground/10 transition-all hover:scale-[1.04] active:scale-95 sm:bottom-7 sm:right-7",
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

// Convenience: floating "Log a spend" CTA — dispatches the same global event
// the spend modal listens for on /today + /spending, so the existing wiring
// just opens the sheet.
export function LogSpendPrimaryAction() {
  return (
    <PrimaryAction
      icon={Plus}
      label="Log a spend"
      ariaLabel="Open the spend log"
      onClick={() => {
        if (typeof window === "undefined") return;
        window.dispatchEvent(
          new CustomEvent("freelane:open-spend-sheet", {
            detail: { source: "primary-action" },
          }),
        );
      }}
    />
  );
}

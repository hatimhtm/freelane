"use client";

import type { MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

// Warning pill — the locked inline format for the per-widget warning slot.
// Small, rounded-full, rose-tinted, never larger than glyph-text.
//
// CONTRACT:
//   - With `onTap` OR `detailHref`: renders as an interactive <button> that
//     stops propagation (so the parent card's onOpen doesn't fire) and
//     either invokes onTap or navigates to detailHref. Default action when
//     both are present: onTap wins.
//   - With neither: renders as a non-interactive <span role="status"> so
//     screen readers announce a static status message instead of "button".
//     The rose-warm tone + aria-live="polite" surface the message as a
//     calm status update rather than an action.
//
// Click handler stops propagation in both prop-driven modes so the pill
// can't double-fire the parent card's onOpen.

export type WarningPillProps = {
  children: React.ReactNode;
  onTap?: () => void;
  detailHref?: string;
  className?: string;
  // Optional override so call sites with a generic message ("Needs
  // attention") can include the parent card's identity. The button
  // already announces children to screen readers; this overrides the
  // accessible name when children would be too ambiguous on their own.
  ariaLabel?: string;
};

// Shared classes — rose-500 baseline so the tint stays readable across
// both light and dark themes (Graphite / Midnight / Carbon). The dark:
// variant nudges to rose-300 where rose-500 would muddy on dark cards.
const PILL_CLASSES =
  "inline-flex items-center gap-1 rounded-full bg-rose-500/10 px-2 py-0.5 text-[11px] font-medium text-rose-500 dark:text-rose-300";

export function WarningPill({
  children,
  onTap,
  detailHref,
  className,
  ariaLabel,
}: WarningPillProps) {
  const router = useRouter();
  const interactive = !!onTap || !!detailHref;

  if (!interactive) {
    return (
      <span
        role="status"
        aria-live="polite"
        aria-label={ariaLabel}
        className={cn(PILL_CLASSES, className)}
      >
        {children}
      </span>
    );
  }

  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (onTap) {
      onTap();
      return;
    }
    if (detailHref) router.push(detailHref);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={ariaLabel}
      className={cn(
        PILL_CLASSES,
        "cursor-pointer transition-colors hover:bg-rose-500/15",
        className,
      )}
    >
      {children}
    </button>
  );
}

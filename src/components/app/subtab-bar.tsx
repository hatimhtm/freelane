"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

// ────────────────────────────────────────────────────────── SubtabBar ──
// Page-level second navigation tier. Renders inside the topbar's center
// slot via TopBarSubtabSlot; layout files at /dashboard, /spending,
// /payments, /stats/[scope], /clients drive its appearance through the
// pathname → subtabs mapping.
//
// Visual: text labels separated by gap-1. The active label sits on a
// motion.span underline (layoutId="subtab-underline") so navigating
// between subtabs animates the underline like a shared element. Inactive
// labels are slate-muted and lift to ink on hover.

export type Subtab = { href: string; label: string };

export function SubtabBar({
  subtabs,
  activePath,
}: {
  subtabs: Subtab[];
  activePath: string;
}) {
  const prefersReducedMotion = useReducedMotion();

  // Verifier fix: the prior per-tab isActive() marked both /clients
  // and /clients/people active when on /clients/people, because the
  // prefix match `startsWith("/clients/")` swallowed the deeper
  // route. With shared layoutId="subtab-underline" on framer-motion,
  // two active underlines rendered simultaneously and both labels got
  // text-foreground styling. The fix is to pick exactly ONE active
  // tab per render — the most-specific (longest href) match wins.
  const activeHref = pickMostSpecificActive(activePath, subtabs);

  return (
    <nav
      aria-label="Page sections"
      className="flex items-center gap-1"
    >
      {subtabs.map((sub) => {
        const active = sub.href === activeHref;
        return (
          <Link
            key={sub.href}
            href={sub.href}
            prefetch
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative inline-flex h-9 items-center rounded-md px-3 text-[13px] tracking-tight transition-colors",
              active
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span className="relative">{sub.label}</span>
            {active && (
              <motion.span
                layoutId="subtab-underline"
                aria-hidden
                className="absolute inset-x-2 bottom-1 h-[2px] rounded-full bg-[var(--brand)]"
                transition={
                  prefersReducedMotion
                    ? { duration: 0 }
                    : { type: "spring", stiffness: 380, damping: 32 }
                }
              />
            )}
          </Link>
        );
      })}
    </nav>
  );
}

// Pick the single most-specific tab to mark active. Prefers an exact
// path match; otherwise picks the longest href whose prefix matches the
// path (covers nested routes like /stats/[scope]/money/anything → its
// /stats/[scope]/money tab). Returns null when no tab matches so all
// tabs render inactive (e.g. the parent layout was wrong).
function pickMostSpecificActive(
  activePath: string,
  subtabs: Subtab[],
): string | null {
  // Exact match wins outright.
  const exact = subtabs.find((s) => s.href === activePath);
  if (exact) return exact.href;
  // Prefix match — pick the longest matching href.
  let best: { href: string; len: number } | null = null;
  for (const s of subtabs) {
    if (activePath.startsWith(s.href + "/")) {
      if (!best || s.href.length > best.len) {
        best = { href: s.href, len: s.href.length };
      }
    }
  }
  return best?.href ?? null;
}

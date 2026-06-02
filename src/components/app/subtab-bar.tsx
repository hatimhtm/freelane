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

  return (
    <nav
      aria-label="Page sections"
      className="flex items-center gap-1"
    >
      {subtabs.map((sub) => {
        const active = isActive(activePath, sub.href);
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

// Active when the path matches exactly, or when the path starts with the
// href followed by a "/" — covers nested routes like /stats/[scope]/money
// matching from /stats/[scope]/money/anything.
function isActive(activePath: string, href: string): boolean {
  if (activePath === href) return true;
  if (activePath.startsWith(href + "/")) return true;
  return false;
}

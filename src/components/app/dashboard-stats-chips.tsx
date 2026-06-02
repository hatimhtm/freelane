"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

// Dashboard stats-scope chips (NOT filter pills). Each chip navigates to
// the matching /stats scope rather than filtering the current dashboard.
// Active state reads from the live pathname so a user already viewing
// /stats/2026 sees the matching chip highlighted when they navigate back
// via the Dashboard header. aria-label spells out "View …" so screen
// readers don't conflate this with a filter affordance.

export type DashboardStatsChipsProps = {
  activeYears: number[];
};

function chipClass(active: boolean) {
  return cn(
    "rounded-full px-2.5 py-0.5 text-[11px] font-medium tracking-tight transition-colors",
    "ring-1 ring-foreground/10 hover:ring-foreground/25",
    active
      ? "bg-foreground text-background"
      : "bg-card text-muted-foreground hover:text-foreground",
  );
}

function isActiveFor(pathname: string | null, scope: string): boolean {
  if (!pathname) return false;
  // Match /stats/<scope> with optional trailing slash or query.
  return new RegExp(`^/stats/${scope}(/|$|\\?)`).test(pathname);
}

export function DashboardStatsChips({ activeYears }: DashboardStatsChipsProps) {
  const pathname = usePathname();
  return (
    <>
      <Link
        href="/stats/lifetime"
        aria-label="View lifetime stats"
        className={chipClass(isActiveFor(pathname, "lifetime"))}
      >
        Lifetime
      </Link>
      {activeYears.map((y) => (
        <Link
          key={y}
          href={`/stats/${y}`}
          aria-label={`View ${y} stats`}
          className={chipClass(isActiveFor(pathname, String(y)))}
        >
          {y}
        </Link>
      ))}
    </>
  );
}

"use client";

import { usePathname } from "next/navigation";
import { SubtabBar, type Subtab } from "@/components/app/subtab-bar";
import { useStatsLettersVisibility } from "@/components/app/stats-letters-visibility";

// ─────────────────────────────────────────────────── TopBarSubtabSlot ──
// Reads the current pathname and renders the SubtabBar for the page that
// owns this URL. Returns null on pages without subtabs (Today, Sadaka,
// Plans, Projects, Activity, Notifications, Letters, Settings) so the
// topbar center stays empty.
//
// Verifier fix (high): on /stats/[scope]/* we drop the Letters chip
// when the scope has zero letters. The visibility flag is computed
// server-side in the stats layout and pushed into a context the slot
// reads here (see stats-letters-visibility.tsx).

export function TopBarSubtabSlot() {
  const pathname = usePathname() ?? "";
  const statsHasLetters = useStatsLettersVisibility();

  const subtabs = subtabsForPath(pathname, { statsHasLetters });
  if (!subtabs) return null;

  return <SubtabBar subtabs={subtabs} activePath={pathname} />;
}

function subtabsForPath(
  pathname: string,
  ctx: { statsHasLetters: boolean | null },
): Subtab[] | null {
  // Dashboard — Money / Commitments / State / Body
  if (pathname === "/dashboard" || pathname.startsWith("/dashboard/")) {
    return [
      { href: "/dashboard/money", label: "Money" },
      { href: "/dashboard/commitments", label: "Commitments" },
      { href: "/dashboard/state", label: "State" },
      { href: "/dashboard/body", label: "Body" },
    ];
  }

  // Spending — Spends / Trends / Vendors
  // Spending has sibling dynamic routes /spending/category/[id] and
  // /spending/vendor/[slug]; those are detail surfaces, not subtabs.
  // We render subtabs only on the three first-class subtab routes.
  if (
    pathname === "/spending" ||
    pathname === "/spending/spends" ||
    pathname.startsWith("/spending/spends/") ||
    pathname === "/spending/trends" ||
    pathname.startsWith("/spending/trends/") ||
    pathname === "/spending/vendors" ||
    pathname.startsWith("/spending/vendors/")
  ) {
    return [
      { href: "/spending/spends", label: "Spends" },
      { href: "/spending/trends", label: "Trends" },
      { href: "/spending/vendors", label: "Vendors" },
    ];
  }

  // Payments — Wallets / Withdrawals / History
  if (pathname === "/payments" || pathname.startsWith("/payments/")) {
    return [
      { href: "/payments/wallets", label: "Wallets" },
      { href: "/payments/withdrawals", label: "Withdrawals" },
      { href: "/payments/history", label: "History" },
    ];
  }

  // Stats — Money / Behavior / Journey / Letters (per dynamic [scope])
  if (pathname.startsWith("/stats/")) {
    // /stats/{scope}/...
    const parts = pathname.split("/").filter(Boolean); // ["stats", "{scope}", maybe-subtab]
    const scope = parts[1];
    if (!scope) return null;
    // Verifier fix (low): no encodeURIComponent — DashboardStatsChips
    // builds chip URLs un-encoded, and every documented scope token
    // (lifetime / 4-digit year / client-<id> / 30d|90d|6m|1y) is
    // URI-safe by construction. Keeping both surfaces in lockstep
    // avoids latent inconsistency the next time the grammar grows.
    const base = `/stats/${scope}`;
    const tabs: Subtab[] = [
      { href: `${base}/money`, label: "Money" },
      { href: `${base}/behavior`, label: "Behavior" },
      { href: `${base}/journey`, label: "Journey" },
    ];
    // Letters chip is conditional on the scope having letters. The flag
    // arrives from the stats layout via context. While the flag is null
    // (first render before the layout's Writer mounts) we hide the chip
    // by default — otherwise it would flicker on every navigation. The
    // /letters page redirects to /money on empty as a second safety net.
    if (ctx.statsHasLetters === true) {
      tabs.push({ href: `${base}/letters`, label: "Letters" });
    }
    return tabs;
  }

  // Clients — Clients / People
  // /clients renders the clients list (Clients subtab).
  // /clients/people renders the entities surface.
  // /clients/[id] is the client detail route; the People subtab still
  // shows but the Clients subtab also stays active because [id] is
  // nested under /clients.
  if (pathname === "/clients" || pathname.startsWith("/clients/")) {
    return [
      { href: "/clients", label: "Clients" },
      { href: "/clients/people", label: "People" },
    ];
  }

  return null;
}

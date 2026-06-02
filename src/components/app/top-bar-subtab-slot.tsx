"use client";

import { usePathname } from "next/navigation";
import { SubtabBar, type Subtab } from "@/components/app/subtab-bar";

// ─────────────────────────────────────────────────── TopBarSubtabSlot ──
// Reads the current pathname and renders the SubtabBar for the page that
// owns this URL. Returns null on pages without subtabs (Today, Sadaka,
// Plans, Projects, Activity, Notifications, Letters, Settings) so the
// topbar center stays empty.

export function TopBarSubtabSlot() {
  const pathname = usePathname() ?? "";

  const subtabs = subtabsForPath(pathname);
  if (!subtabs) return null;

  return <SubtabBar subtabs={subtabs} activePath={pathname} />;
}

function subtabsForPath(pathname: string): Subtab[] | null {
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
    const base = `/stats/${encodeURIComponent(scope)}`;
    return [
      { href: `${base}/money`, label: "Money" },
      { href: `${base}/behavior`, label: "Behavior" },
      { href: `${base}/journey`, label: "Journey" },
      { href: `${base}/letters`, label: "Letters" },
    ];
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

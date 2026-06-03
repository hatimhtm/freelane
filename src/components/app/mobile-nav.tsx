"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Bell,
  Calendar,
  FolderKanban,
  HandHeart,
  LayoutDashboard,
  Menu,
  Receipt,
  Settings,
  Sun,
  Users,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Logo } from "@/components/brand/logo";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; icon: LucideIcon };

const NAV: { title: string; items: NavItem[] }[] = [
  {
    title: "Now",
    items: [
      { href: "/dashboard",     label: "Dashboard",     icon: LayoutDashboard },
      { href: "/today",         label: "Today",         icon: Sun },
      { href: "/notifications", label: "Notifications", icon: Bell },
    ],
  },
  {
    title: "Money",
    items: [
      { href: "/projects",  label: "Projects",  icon: FolderKanban },
      { href: "/payments",  label: "Payments",  icon: Wallet },
      { href: "/spending",  label: "Spending",  icon: Receipt },
      { href: "/plans",     label: "Plans",     icon: Calendar },
      { href: "/sadaka",    label: "Sadaka",    icon: HandHeart },
    ],
  },
  {
    title: "People",
    items: [
      // Vendors moved to /spending/vendors per freelane-vendors-design.
      // Entities moved to /clients/people per freelane-entities-design
      // (2026-06-03). /entities keeps a redirect for legacy links.
      { href: "/clients",   label: "Clients",   icon: Users },
    ],
  },
  // Stories group removed (freelane-shouldibuy-design 2026-06-02). Letters
  // surface via notifications + Stats; Should-I-Buy collapsed into the
  // chatbot's intent-classifier routing. The /should-i-buy route redirects
  // to / for legacy links.
  {
    title: "Log",
    items: [
      { href: "/activity",  label: "Activity",   icon: Activity },
      // What's New moved to Settings → Updates (freelane-whatsnew-design
      // 2026-06-02). CHANGELOG.md in the repo root is the source of
      // truth; Settings paints a badge when a release the user hasn't
      // opened has landed.
      { href: "/settings",  label: "Settings",   icon: Settings },
    ],
  },
];

export function MobileNav({
  settingsHasUpdate = false,
}: {
  /**
   * When true, paint a small rose dot on the Settings nav row. Mirrors
   * SidebarNav's same prop so the cue is consistent on phones + tablets.
   */
  settingsHasUpdate?: boolean;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden"
        aria-label="Open menu"
        onClick={() => setOpen(true)}
      >
        <Menu className="h-5 w-5" />
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-72 p-0">
          <SheetHeader className="px-5 py-4">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <Logo />
          </SheetHeader>
          <nav className="no-scrollbar flex flex-1 flex-col gap-4 overflow-y-auto p-3 pb-6">
            {NAV.map((group, gi) => (
              <div key={group.title} className="flex flex-col gap-0.5">
                {gi > 0 && (
                  <div className="px-3 pb-1 pt-1.5 text-[9px] uppercase tracking-[0.18em] text-sidebar-foreground/35">
                    {group.title}
                  </div>
                )}
                {group.items.map(({ href, label, icon: Icon }) => {
                  const active =
                    pathname === href ||
                    pathname.startsWith(href + "/") ||
                    (href === "/dashboard" && pathname === "/");
                  const showUpdateDot =
                    href === "/settings" && settingsHasUpdate;
                  return (
                    <Link
                      key={href}
                      href={href}
                      onClick={() => setOpen(false)}
                      className={cn(
                        "relative flex items-center gap-3 rounded-[6px] px-3 py-2.5 text-sm transition-colors",
                        active
                          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                          : "text-sidebar-foreground/70 hover:bg-sidebar-accent/40 hover:text-sidebar-foreground",
                      )}
                    >
                      {active && <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-full bg-[var(--brand)]" />}
                      <span className="relative shrink-0">
                        <Icon className="h-[18px] w-[18px]" />
                        {showUpdateDot && (
                          <span
                            aria-label="New release available"
                            className="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-rose-500"
                          />
                        )}
                      </span>
                      {label}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>
        </SheetContent>
      </Sheet>
    </>
  );
}

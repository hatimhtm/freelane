"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Calendar,
  FileText,
  FolderKanban,
  HeartHandshake,
  LayoutDashboard,
  Menu,
  Receipt,
  Settings,
  ShoppingBag,
  Sparkles,
  Store,
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
      { href: "/today",     label: "Today",     icon: Sun },
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    ],
  },
  {
    title: "Money",
    items: [
      { href: "/projects",  label: "Projects",  icon: FolderKanban },
      { href: "/payments",  label: "Payments",  icon: Wallet },
      { href: "/spending",  label: "Spending",  icon: Receipt },
      { href: "/plans",     label: "Plans",     icon: Calendar },
    ],
  },
  {
    title: "People",
    items: [
      { href: "/clients",   label: "Clients",   icon: Users },
      { href: "/vendors",   label: "Vendors",   icon: Store },
      { href: "/entities",  label: "Entities",  icon: HeartHandshake },
    ],
  },
  {
    title: "Stories",
    items: [
      { href: "/letters",      label: "Letters",       icon: FileText },
      { href: "/should-i-buy", label: "Should I buy?", icon: ShoppingBag },
    ],
  },
  {
    title: "Log",
    items: [
      { href: "/activity",  label: "Activity",   icon: Activity },
      { href: "/changelog", label: "What's new", icon: Sparkles },
      { href: "/settings",  label: "Settings",   icon: Settings },
    ],
  },
];

export function MobileNav() {
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
          <nav className="flex flex-1 flex-col gap-4 overflow-y-auto p-3 pb-6">
            {NAV.map((group, gi) => (
              <div key={group.title} className="flex flex-col gap-0.5">
                {gi > 0 && (
                  <div className="px-3 pb-1 pt-1.5 text-[9px] uppercase tracking-[0.18em] text-sidebar-foreground/35">
                    {group.title}
                  </div>
                )}
                {group.items.map(({ href, label, icon: Icon }) => {
                  const active = pathname === href || pathname.startsWith(href + "/");
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
                      <Icon className="h-[18px] w-[18px] shrink-0" />
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

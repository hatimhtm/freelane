"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  KanbanSquare,
  Users,
  FileText,
  Settings,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/brand/logo";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/projects",  label: "Projects",  icon: KanbanSquare   },
  { href: "/payments",  label: "Payments",  icon: Wallet         },
  { href: "/clients",   label: "Clients",   icon: Users          },
  { href: "/invoices",  label: "Invoices",  icon: FileText       },
  { href: "/settings",  label: "Settings",  icon: Settings       },
];

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
      <div className="flex h-14 items-center gap-2.5 border-b border-sidebar-border px-5">
        <Logo />
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 p-3">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/60 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
              )}
            >
              {active && (
                <span className="absolute inset-y-1 left-0 w-[3px] rounded-r-full bg-[var(--brand)]" />
              )}
              <Icon
                className={cn(
                  "h-4 w-4 shrink-0 transition-colors",
                  active ? "text-[var(--brand)]" : "text-sidebar-foreground/50 group-hover:text-sidebar-foreground",
                )}
              />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-sidebar-border p-3">
        <div className="rounded-xl bg-sidebar-accent/50 p-3 text-xs text-sidebar-foreground/70">
          <div className="mb-1 font-medium text-sidebar-foreground">Tip</div>
          Press <kbd className="rounded border border-sidebar-border bg-sidebar px-1 py-px font-mono text-[10px]">⌘K</kbd> to search or jump anywhere.
        </div>
      </div>
    </aside>
  );
}

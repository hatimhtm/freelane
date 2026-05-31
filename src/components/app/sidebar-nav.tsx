"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import {
  Activity,
  LayoutDashboard,
  Receipt,
  Sun,
  Users,
  Wallet,
  FolderKanban,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/brand/logo";

const NAV = [
  { href: "/today",     label: "Today",     icon: Sun             },
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/projects",  label: "Projects",  icon: FolderKanban    },
  { href: "/payments",  label: "Payments",  icon: Wallet          },
  { href: "/spending",  label: "Spending",  icon: Receipt         },
  { href: "/clients",   label: "Clients",   icon: Users           },
  { href: "/activity",  label: "Activity",  icon: Activity        },
  { href: "/settings",  label: "Settings",  icon: Settings        },
];

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
      <div className="flex h-16 items-center gap-2.5 px-6">
        <Logo />
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 px-3 py-2">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              prefetch
              className={cn(
                "group relative flex items-center gap-3 rounded-[6px] px-3 py-2 text-sm transition-colors",
                active
                  ? "text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/65 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
              )}
            >
              {active && (
                <motion.span
                  layoutId="sidebar-active"
                  className="absolute inset-0 rounded-[6px] bg-sidebar-accent"
                  transition={{ type: "spring", stiffness: 420, damping: 34 }}
                />
              )}
              {active && (
                <motion.span
                  layoutId="sidebar-active-bar"
                  className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-full bg-[var(--brand)]"
                  transition={{ type: "spring", stiffness: 420, damping: 34 }}
                />
              )}
              <Icon
                className={cn(
                  "relative h-[18px] w-[18px] shrink-0 transition-transform",
                  active ? "text-foreground" : "text-sidebar-foreground/55 group-hover:scale-105",
                )}
              />
              <span className={cn("relative", active && "font-medium")}>{label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="px-4 pb-5 pt-3">
        <div className="rounded-[10px] border border-sidebar-border/70 bg-sidebar-accent/40 px-3 py-2.5 text-[11px] leading-relaxed text-sidebar-foreground/60">
          Press{" "}
          <kbd className="rounded border border-sidebar-border bg-sidebar px-1 py-px font-mono text-[10px]">⌘K</kbd>{" "}
          to jump anywhere.
        </div>
      </div>
    </aside>
  );
}

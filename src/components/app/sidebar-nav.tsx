"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import {
  LayoutDashboard,
  KanbanSquare,
  Users,
  FileText,
  Settings,
  Wallet,
  Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/brand/logo";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/projects",  label: "Projects",  icon: KanbanSquare   },
  { href: "/payments",  label: "Payments",  icon: Wallet         },
  { href: "/clients",   label: "Clients",   icon: Users          },
  { href: "/invoices",  label: "Invoices",  icon: FileText       },
  { href: "/activity",  label: "Activity",  icon: Activity       },
  { href: "/settings",  label: "Settings",  icon: Settings       },
];

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar/70 backdrop-blur-xl md:flex">
      <div className="flex h-14 items-center gap-2.5 border-b border-sidebar-border px-5">
        <motion.div
          initial={{ opacity: 0, x: -6 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.4, ease: [0.2, 0.9, 0.3, 1] }}
        >
          <Logo />
        </motion.div>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 p-3">
        {NAV.map(({ href, label, icon: Icon }, index) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <motion.div
              key={href}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, delay: index * 0.03, ease: [0.2, 0.9, 0.3, 1] }}
            >
              <Link
                href={href}
                prefetch
                className={cn(
                  "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/60 hover:bg-sidebar-accent/40 hover:text-sidebar-foreground",
                )}
              >
                {active && (
                  <motion.span
                    layoutId="sidebar-active"
                    className="absolute inset-0 rounded-lg bg-sidebar-accent"
                    transition={{ type: "spring", stiffness: 380, damping: 30 }}
                  />
                )}
                {active && (
                  <motion.span
                    layoutId="sidebar-active-bar"
                    className="absolute inset-y-1 left-0 w-[3px] rounded-r-full bg-[var(--brand)]"
                    transition={{ type: "spring", stiffness: 380, damping: 30 }}
                  />
                )}
                <Icon
                  className={cn(
                    "relative h-4 w-4 shrink-0 transition-all",
                    active
                      ? "text-[var(--brand)]"
                      : "text-sidebar-foreground/50 group-hover:scale-110 group-hover:text-sidebar-foreground",
                  )}
                />
                <span className="relative">{label}</span>
              </Link>
            </motion.div>
          );
        })}
      </nav>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.3 }}
        className="border-t border-sidebar-border p-3"
      >
        <div className="rounded-xl bg-sidebar-accent/50 p-3 text-xs text-sidebar-foreground/70">
          <div className="mb-1 font-medium text-sidebar-foreground">Tip</div>
          Press{" "}
          <kbd className="rounded border border-sidebar-border bg-sidebar px-1 py-px font-mono text-[10px]">
            ⌘K
          </kbd>{" "}
          to search or jump anywhere.
        </div>
      </motion.div>
    </aside>
  );
}

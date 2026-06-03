"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  Bell,
  Calendar,
  CalendarRange,
  Database,
  FolderKanban,
  HandHeart,
  Heart,
  Info,
  LayoutDashboard,
  LogOut,
  MessagesSquare,
  Plus,
  Receipt,
  RefreshCw,
  Repeat,
  Settings,
  ShieldCheck,
  Sparkles,
  Stars,
  Store,
  Sun,
  Tags,
  User,
  Users,
  Wallet,
} from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { createClient } from "@/lib/supabase/client";

// CommandPaletteHost — headless ⌘K listener + dialog. Mounted once in
// the (app) layout. Replaces the old top-bar trigger button (search now
// lives ONLY in this palette per the design-structure restructure).
export function CommandPaletteHost() {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = (path: string) => {
    setOpen(false);
    router.push(path);
  };

  async function lockFreelane() {
    setOpen(false);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Search clients, projects, payments…" />
        <CommandList>
          <CommandEmpty>No results.</CommandEmpty>
          <CommandGroup heading="Now">
            <CommandItem onSelect={() => go("/dashboard")}>
              <LayoutDashboard className="mr-2 h-4 w-4" /> Dashboard
            </CommandItem>
            <CommandItem onSelect={() => go("/today")}>
              <Sun className="mr-2 h-4 w-4" /> Today
            </CommandItem>
            <CommandItem onSelect={() => go("/notifications")}>
              <Bell className="mr-2 h-4 w-4" /> Notifications
            </CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Money">
            <CommandItem onSelect={() => go("/projects")}>
              <FolderKanban className="mr-2 h-4 w-4" /> Projects
            </CommandItem>
            <CommandItem onSelect={() => go("/payments")}>
              <Wallet className="mr-2 h-4 w-4" /> Payments
            </CommandItem>
            <CommandItem onSelect={() => go("/spending")}>
              <Receipt className="mr-2 h-4 w-4" /> Spending
            </CommandItem>
            <CommandItem onSelect={() => go("/plans")}>
              <Calendar className="mr-2 h-4 w-4" /> Plans
            </CommandItem>
            <CommandItem onSelect={() => go("/sadaka")}>
              <HandHeart className="mr-2 h-4 w-4" /> Sadaka
            </CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="People">
            <CommandItem onSelect={() => go("/clients")}>
              <Users className="mr-2 h-4 w-4" /> Clients
            </CommandItem>
            {/* Vendors moved into Spending → Vendors per
                freelane-vendors-design (2026-06-02). The command-palette
                entry below routes to the new sub-view; legacy /vendors
                URL redirects via the page-level redirect in
                src/app/(app)/vendors/page.tsx. */}
            <CommandItem onSelect={() => go("/spending/vendors")}>
              <Store className="mr-2 h-4 w-4" /> Vendors
            </CommandItem>
            {/* Entities moved into Clients → People per
                freelane-entities-design (2026-06-03). The command-palette
                entry now routes to the new sub-tab; the legacy /entities
                URL redirects via the page-level redirect in
                src/app/(app)/entities/page.tsx so historical command-
                palette history keeps resolving. */}
            <CommandItem onSelect={() => go("/clients/people")}>
              <Users className="mr-2 h-4 w-4" /> People
            </CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Stories">
            {/* Letters removed from command palette (freelane-letters-design
                2026-06-02). Letters reach the user via the new_letter
                notification → letter-reader center modal, the Recent
                Letters card on Stats, or direct deep links to
                /letters/[id]. The /letters archive page is still routable
                directly if the user types it.

                Should-I-Buy collapsed into the chatbot (freelane-shouldibuy-
                design 2026-06-02). Open the chatbot pill and type
                "should I buy ...?" — the intent-classifier routes the
                question into the purchase-decision brain. The /should-i-buy
                route redirects to / for legacy bookmarks. */}
            <CommandItem onSelect={() => go(`/year/${new Date().getFullYear()}`)}>
              <CalendarRange className="mr-2 h-4 w-4" /> {new Date().getFullYear()} in review
            </CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Log">
            <CommandItem onSelect={() => go("/activity")}>
              <Activity className="mr-2 h-4 w-4" /> Activity
            </CommandItem>
            {/* What's New (Settings → Updates) is the single canonical
                entry — it lives in the Settings group below with the
                changelog/version keywords, so duplicating it here would
                fire two cmdk rows on the same query. */}
            <CommandItem onSelect={() => go("/settings")}>
              <Settings className="mr-2 h-4 w-4" /> Settings
            </CommandItem>
            <CommandItem onSelect={lockFreelane}>
              <LogOut className="mr-2 h-4 w-4" /> Lock Freelane
            </CommandItem>
          </CommandGroup>
          <CommandSeparator />
          {/* Settings — the 12-subtab hub. Sorted below the primary
              navigation groups so cmdk fuzzy-match still surfaces a
              top-level page (e.g. /payments) above its sibling settings
              entry (e.g. /settings/wallets) when the user types a
              partial. The keywords prop steers the match for entries
              whose tab name differs from common shorthand (e.g. typing
              "subscription" finds Cycles). */}
          <CommandGroup heading="Settings">
            <CommandItem keywords={["profile", "name", "timezone", "currency"]} onSelect={() => go("/settings/profile")}>
              <User className="mr-2 h-4 w-4" /> Profile
            </CommandItem>
            <CommandItem keywords={["wallets", "methods", "rates", "fx", "opening"]} onSelect={() => go("/settings/wallets")}>
              <Wallet className="mr-2 h-4 w-4" /> Wallets
            </CommandItem>
            <CommandItem keywords={["cycles", "recurring", "subscription", "bills"]} onSelect={() => go("/settings/cycles")}>
              <Repeat className="mr-2 h-4 w-4" /> Cycles
            </CommandItem>
            <CommandItem keywords={["body", "wellbeing", "sleep", "habits", "smoking"]} onSelect={() => go("/settings/body")}>
              <Heart className="mr-2 h-4 w-4" /> Body & Wellbeing
            </CommandItem>
            <CommandItem keywords={["faith", "prayer", "qibla", "hijri", "ramadan", "islam", "adhan", "masjid"]} onSelect={() => go("/settings/faith")}>
              <Stars className="mr-2 h-4 w-4" /> Faith
            </CommandItem>
            <CommandItem keywords={["tags", "categories", "labels"]} onSelect={() => go("/settings/tags")}>
              <Tags className="mr-2 h-4 w-4" /> Tags
            </CommandItem>
            <CommandItem keywords={["ai", "memory", "facts"]} onSelect={() => go("/settings/ai")}>
              <Sparkles className="mr-2 h-4 w-4" /> AI
            </CommandItem>
            <CommandItem keywords={["notifications", "push", "alerts"]} onSelect={() => go("/settings/notifications")}>
              <Bell className="mr-2 h-4 w-4" /> Notifications
            </CommandItem>
            <CommandItem keywords={["privacy", "data", "export", "delete", "gdpr", "export data", "delete account"]} onSelect={() => go("/settings/privacy")}>
              <ShieldCheck className="mr-2 h-4 w-4" /> Privacy & Data
            </CommandItem>
            <CommandItem keywords={["updates", "changelog", "version"]} onSelect={() => go("/settings/updates")}>
              <RefreshCw className="mr-2 h-4 w-4" /> Updates
            </CommandItem>
            <CommandItem keywords={["advanced", "flags", "dev", "experimental", "beta"]} onSelect={() => go("/settings/advanced")}>
              <Database className="mr-2 h-4 w-4" /> Advanced
            </CommandItem>
            <CommandItem keywords={["about", "version", "build", "contact", "support", "feedback"]} onSelect={() => go("/settings/about")}>
              <Info className="mr-2 h-4 w-4" /> About
            </CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Quick actions">
            <CommandItem
              onSelect={() => {
                setOpen(false);
                if (typeof window !== "undefined") {
                  window.dispatchEvent(new CustomEvent("freelane:open-spend-sheet"));
                }
              }}
            >
              <Plus className="mr-2 h-4 w-4" /> Log a spend
            </CommandItem>
            <CommandItem
              onSelect={() => {
                setOpen(false);
                if (typeof window !== "undefined") {
                  // The new chatbot listens for freelane:open-chatbot; the
                  // legacy freelane:open-ask-ai event name still works (the
                  // provider listens for both during the transition) but
                  // new dispatchers should use the modern name.
                  window.dispatchEvent(new CustomEvent("freelane:open-chatbot"));
                }
              }}
            >
              <MessagesSquare className="mr-2 h-4 w-4" /> Ask your money
            </CommandItem>
            <CommandItem onSelect={() => go("/clients?new=1")}>
              <Plus className="mr-2 h-4 w-4" /> New client
            </CommandItem>
            <CommandItem onSelect={() => go("/projects?new=1")}>
              <Plus className="mr-2 h-4 w-4" /> New project
            </CommandItem>
            <CommandItem onSelect={() => go("/payments?new=1")}>
              <Plus className="mr-2 h-4 w-4" /> Log a payment
            </CommandItem>
            <CommandItem onSelect={() => go("/settings/wallets#rates")}>
              <RefreshCw className="mr-2 h-4 w-4" /> Update exchange rates
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}

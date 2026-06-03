"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  Bell,
  Calendar,
  CalendarRange,
  FolderKanban,
  HandHeart,
  LayoutDashboard,
  LogOut,
  MessagesSquare,
  Plus,
  Receipt,
  RefreshCw,
  Settings,
  Store,
  Sun,
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
            {/* What's New moved to Settings → Updates (freelane-whatsnew-
                design 2026-06-02). Legacy /changelog bookmarks are
                redirected via next.config.ts's redirects() entry. */}
            <CommandItem onSelect={() => go("/settings/updates")}>
              <RefreshCw className="mr-2 h-4 w-4" /> Updates
            </CommandItem>
            <CommandItem onSelect={() => go("/settings")}>
              <Settings className="mr-2 h-4 w-4" /> Settings
            </CommandItem>
            <CommandItem onSelect={lockFreelane}>
              <LogOut className="mr-2 h-4 w-4" /> Lock Freelane
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
            <CommandItem onSelect={() => go("/settings#rates")}>
              <RefreshCw className="mr-2 h-4 w-4" /> Update exchange rates
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}

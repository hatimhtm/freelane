"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  CalendarRange,
  FolderKanban,
  LayoutDashboard,
  Plus,
  Receipt,
  RefreshCw,
  Search,
  Settings,
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

export function CommandTrigger() {
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

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="group inline-flex h-9 items-center gap-2 rounded-[6px] border border-border/70 bg-background px-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Search className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Search or jump to…</span>
        <kbd className="ml-2 hidden items-center rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline-flex">
          ⌘K
        </kbd>
      </button>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Search clients, projects, payments…" />
        <CommandList>
          <CommandEmpty>No results.</CommandEmpty>
          <CommandGroup heading="Navigate">
            <CommandItem onSelect={() => go("/today")}>
              <Sun className="mr-2 h-4 w-4" />
              Today
            </CommandItem>
            <CommandItem onSelect={() => go("/dashboard")}>
              <LayoutDashboard className="mr-2 h-4 w-4" />
              Dashboard
            </CommandItem>
            <CommandItem onSelect={() => go("/projects")}>
              <FolderKanban className="mr-2 h-4 w-4" />
              Projects
            </CommandItem>
            <CommandItem onSelect={() => go("/payments")}>
              <Wallet className="mr-2 h-4 w-4" />
              Payments
            </CommandItem>
            <CommandItem onSelect={() => go("/spending")}>
              <Receipt className="mr-2 h-4 w-4" />
              Spending
            </CommandItem>
            <CommandItem onSelect={() => go("/clients")}>
              <Users className="mr-2 h-4 w-4" />
              Clients
            </CommandItem>
            <CommandItem onSelect={() => go("/activity")}>
              <Activity className="mr-2 h-4 w-4" />
              Activity
            </CommandItem>
            <CommandItem onSelect={() => go("/settings")}>
              <Settings className="mr-2 h-4 w-4" />
              Settings
            </CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Quick actions">
            <CommandItem onSelect={() => go("/clients?new=1")}>
              <Plus className="mr-2 h-4 w-4" />
              New client
            </CommandItem>
            <CommandItem onSelect={() => go("/projects?new=1")}>
              <Plus className="mr-2 h-4 w-4" />
              New project
            </CommandItem>
            <CommandItem onSelect={() => go("/payments?new=1")}>
              <Plus className="mr-2 h-4 w-4" />
              Log a payment
            </CommandItem>
            <CommandItem onSelect={() => go("/spending?new=1")}>
              <Plus className="mr-2 h-4 w-4" />
              Log a spend
            </CommandItem>
            <CommandItem onSelect={() => go("/settings#rates")}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Update exchange rates
            </CommandItem>
            <CommandItem onSelect={() => go(`/year/${new Date().getFullYear()}`)}>
              <CalendarRange className="mr-2 h-4 w-4" />
              {new Date().getFullYear()} in review
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}

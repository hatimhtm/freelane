"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { LogOut, Settings as SettingsIcon, User } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { createClient } from "@/lib/supabase/client";

export function UserMenu() {
  const router = useRouter();

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account"
        className="group inline-flex h-9 w-9 items-center justify-center rounded-full outline-none transition-all focus-visible:ring-2 focus-visible:ring-ring/50 data-[popup-open]:ring-2 data-[popup-open]:ring-[var(--brand)]/40"
      >
        <span className="relative grid h-7 w-7 place-items-center overflow-hidden rounded-full bg-[var(--ink)] text-[var(--paper)] transition-transform group-hover:scale-105 group-active:scale-95">
          <User className="h-3.5 w-3.5 opacity-90" />
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Freelane
        </DropdownMenuLabel>
        <DropdownMenuItem render={<Link href="/settings" />}>
          <SettingsIcon className="mr-2 h-4 w-4" />
          Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={signOut} variant="destructive">
          <LogOut className="mr-2 h-4 w-4" />
          Lock Freelane
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

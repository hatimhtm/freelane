"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { LogOut, Settings as SettingsIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
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
        render={
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full hover:ring-2 hover:ring-border/60"
            aria-label="Account"
          />
        }
      >
        <div className="h-7 w-7 rounded-full bg-gradient-to-br from-[#9d6bff] to-[#5b9dff] shadow-inner shadow-white/20" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
          Signed in
        </DropdownMenuLabel>
        <DropdownMenuItem render={<Link href="/settings" />}>
          <SettingsIcon className="mr-2 h-4 w-4" />
          Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={signOut} className="text-destructive focus:text-destructive">
          <LogOut className="mr-2 h-4 w-4" />
          Lock Freelane
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

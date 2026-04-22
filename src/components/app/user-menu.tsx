"use client";

import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { LogOut, Settings as SettingsIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
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
        className={cn(
          buttonVariants({ variant: "ghost", size: "icon" }),
          "group/avatar relative rounded-full transition-all hover:scale-105",
        )}
      >
        <motion.span
          whileTap={{ scale: 0.9 }}
          className="relative block h-7 w-7 rounded-full bg-gradient-to-br from-[#9d6bff] to-[#5b9dff] shadow-inner shadow-white/20"
        >
          <span className="absolute inset-0 rounded-full ring-0 ring-[var(--brand)]/0 transition-all group-hover/avatar:ring-2 group-hover/avatar:ring-[var(--brand)]/40" />
        </motion.span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
          Signed in
        </DropdownMenuLabel>
        <DropdownMenuItem onClick={() => router.push("/settings")}>
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

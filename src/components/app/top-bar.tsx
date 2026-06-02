import { Suspense } from "react";
import { UserMenu } from "@/components/app/user-menu";
import { CommandTrigger } from "@/components/app/command-palette";
import { MobileNav } from "@/components/app/mobile-nav";
import { NotificationsBell } from "@/components/app/notifications-bell";

export function TopBar() {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-border/60 bg-background/75 px-4 backdrop-blur-xl md:px-6">
      <div className="flex items-center gap-2">
        <MobileNav />
        <CommandTrigger />
      </div>
      <div className="flex items-center gap-1">
        <Suspense fallback={<div className="h-9 w-9" />}>
          <NotificationsBell />
        </Suspense>
        <UserMenu />
      </div>
    </header>
  );
}

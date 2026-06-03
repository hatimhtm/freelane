import { Suspense } from "react";
import { MobileNav } from "@/components/app/mobile-nav";
import { NotificationsBell } from "@/components/app/notifications-bell";
import { TopBarSubtabSlot } from "@/components/app/top-bar-subtab-slot";

// Topbar shell — three zones:
//   left   → MobileNav hamburger (the desktop logo lives in the sidebar)
//   center → TopBarSubtabSlot (renders SubtabBar on pages that have one,
//            empty on pages without subtabs — Today, Sadaka, Plans, etc.)
//   right  → NotificationsBell
//
// Search lives ONLY in ⌘K now (CommandPaletteHost mounted in the (app)
// layout). The profile icon is gone — Settings is reached via the
// sidebar's Log group; sign-out lives in the ⌘K Log group.
export function TopBar({
  settingsHasUpdate = false,
}: {
  settingsHasUpdate?: boolean;
}) {
  return (
    <header className="sticky top-0 z-30 grid h-14 grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-border/60 bg-background/75 px-4 backdrop-blur-xl md:px-6">
      <div className="flex items-center gap-2">
        <MobileNav settingsHasUpdate={settingsHasUpdate} />
      </div>
      <div className="flex min-w-0 items-center justify-center">
        <TopBarSubtabSlot />
      </div>
      <div className="flex items-center gap-1 justify-self-end">
        <Suspense fallback={<div className="h-9 w-9" />}>
          <NotificationsBell />
        </Suspense>
      </div>
    </header>
  );
}

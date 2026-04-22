import { ThemeToggle } from "@/components/theme-toggle";
import { UserMenu } from "@/components/app/user-menu";
import { CommandTrigger } from "@/components/app/command-palette";

export function TopBar() {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-4 border-b border-border/60 bg-background/75 px-6 backdrop-blur-xl">
      <CommandTrigger />
      <div className="flex items-center gap-1">
        <ThemeToggle />
        <UserMenu />
      </div>
    </header>
  );
}

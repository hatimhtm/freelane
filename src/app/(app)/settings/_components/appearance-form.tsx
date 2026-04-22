"use client";

import { useTheme } from "next-themes";
import { Check, Moon, Monitor, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Settings } from "@/lib/supabase/types";

const OPTIONS = [
  { value: "light",  label: "Light",  icon: Sun    },
  { value: "dark",   label: "Dark",   icon: Moon   },
  { value: "system", label: "System", icon: Monitor },
] as const;

export function AppearanceForm(_props: { settings: Settings | null }) {
  const { theme, setTheme } = useTheme();
  return (
    <div className="grid grid-cols-3 gap-3">
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const active = (theme ?? "system") === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => setTheme(value)}
            className={cn(
              "group relative flex flex-col items-start gap-3 rounded-xl border p-4 text-left transition-all",
              active
                ? "border-[var(--brand)] bg-[var(--brand)]/10"
                : "border-border/60 bg-muted/20 hover:border-border hover:bg-muted/40",
            )}
          >
            <div className="flex items-center gap-2">
              <Icon className="h-4 w-4" />
              <span className="text-sm font-medium">{label}</span>
              {active && (
                <Check className="ml-auto h-4 w-4 text-[var(--brand)]" />
              )}
            </div>
            <div
              className={cn(
                "h-14 w-full rounded-md border transition-colors",
                value === "light" && "border-zinc-200 bg-white",
                value === "dark" && "border-zinc-800 bg-zinc-950",
                value === "system" && "border-zinc-200 bg-gradient-to-br from-white to-zinc-900",
              )}
            />
          </button>
        );
      })}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Check, Moon, Monitor, Sun, Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";
import { soundEnabled, setSoundEnabled, playTick } from "@/lib/sound";
import { Switch } from "@/components/ui/switch";
import type { Settings } from "@/lib/supabase/types";

const OPTIONS = [
  { value: "light",  label: "Light",  icon: Sun    },
  { value: "dark",   label: "Dark",   icon: Moon   },
  { value: "system", label: "System", icon: Monitor },
] as const;

export function AppearanceForm(_props: { settings: Settings | null }) {
  const { theme, setTheme } = useTheme();
  const [sound, setSound] = useState(true);
  useEffect(() => { setSound(soundEnabled()); }, []);

  function toggleSound(on: boolean) {
    setSound(on);
    setSoundEnabled(on);
    if (on) playTick();
  }

  return (
    <div className="space-y-6">
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
              <div className="flex w-full items-center gap-2">
                <Icon className="h-4 w-4" />
                <span className="text-sm font-medium">{label}</span>
                {active && <Check className="ml-auto h-4 w-4 text-[var(--brand)]" />}
              </div>
              <div
                className={cn(
                  "h-14 w-full rounded-md border transition-colors",
                  value === "light" && "border-[#e7e2d8] bg-[#faf8f3]",
                  value === "dark" && "border-zinc-800 bg-[#15140f]",
                  value === "system" && "border-[#e7e2d8] bg-gradient-to-br from-[#faf8f3] to-[#15140f]",
                )}
              />
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between rounded-xl border border-border/60 bg-muted/20 px-4 py-3">
        <div className="flex items-center gap-3">
          {sound ? <Volume2 className="h-4 w-4 text-muted-foreground" /> : <VolumeX className="h-4 w-4 text-muted-foreground" />}
          <div>
            <div className="text-sm font-medium">Sound &amp; haptics</div>
            <div className="text-xs text-muted-foreground">A soft tick when a payment lands.</div>
          </div>
        </div>
        <Switch checked={sound} onCheckedChange={toggleSound} />
      </div>
    </div>
  );
}

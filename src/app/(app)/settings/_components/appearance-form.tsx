"use client";

import { useEffect, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { soundEnabled, setSoundEnabled, playTick } from "@/lib/sound";
import { Switch } from "@/components/ui/switch";
import { ThemePicker } from "@/components/app/theme-picker";
import type { Settings } from "@/lib/supabase/types";

export function AppearanceForm(_props: { settings: Settings | null }) {
  const [sound, setSound] = useState(true);
  useEffect(() => { setSound(soundEnabled()); }, []);

  function toggleSound(on: boolean) {
    setSound(on);
    setSoundEnabled(on);
    if (on) playTick();
  }

  return (
    <div className="space-y-6">
      <ThemePicker />

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

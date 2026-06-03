"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { saveMorningLogAction } from "@/lib/data/actions";
import type { MorningLog } from "@/lib/supabase/types";

// Lightweight body-log form. Surfaces the existing saveMorningLogAction
// (Tier 4 / actions.ts) at a clean settings address instead of asking the
// user to wait for the Today nudge. Loads the most recent entry as a
// prefill so the form reads as "edit today's log" not "start blank every
// time".

export function BodyForm({ recent }: { recent: MorningLog | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [v, setV] = useState({
    slept_hours: recent?.slept_hours ?? "",
    mood_band: recent?.mood_band ?? "",
    mind_state: recent?.mind_state ?? "",
    notes: recent?.notes ?? "",
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const result = await saveMorningLogAction({
        sleptHours:
          v.slept_hours === "" ? null : Number(v.slept_hours),
        moodBand: v.mood_band === "" ? null : Number(v.mood_band),
        mindState: v.mind_state?.toString().trim() || null,
        notes: v.notes?.toString().trim() || null,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Morning logged");
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Slept hours</Label>
          <Input
            type="number"
            inputMode="decimal"
            step="0.25"
            min="0"
            max="14"
            value={v.slept_hours}
            onChange={(e) => setV({ ...v, slept_hours: e.target.value })}
            placeholder="7.5"
          />
        </div>
        <div>
          <Label className="text-xs">Mood band (1–5)</Label>
          <Input
            type="number"
            inputMode="numeric"
            min="1"
            max="5"
            value={v.mood_band}
            onChange={(e) => setV({ ...v, mood_band: e.target.value })}
            placeholder="3"
          />
        </div>
      </div>
      <div>
        <Label className="text-xs">Mind state</Label>
        <Input
          value={v.mind_state}
          onChange={(e) => setV({ ...v, mind_state: e.target.value })}
          placeholder="focused · scattered · heavy · light"
        />
      </div>
      <div>
        <Label className="text-xs">Notes</Label>
        <Textarea
          value={v.notes}
          onChange={(e) => setV({ ...v, notes: e.target.value })}
          placeholder="What's worth remembering about how I woke up?"
          rows={3}
        />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save morning log"}
      </Button>
    </form>
  );
}

"use client";

import { useState } from "react";
import { SWidget } from "@/components/widgets/s-widget";
import { NumberHero } from "@/components/widgets/number-hero";
import { CenterModal, CenterModalBody, CenterModalFooter } from "@/components/ui/center-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { saveMorningLogAction } from "@/lib/data/actions";
import type { SleepSpendEcho } from "@/lib/ai/sleep-spend-echo";

// T19 — Sleep S widget. Hero = last night's hours, animated via
// NumberFlow. Sub = "last night" + plain word for tone, no DayStrip —
// only one night is actually fed in (the older two slots are always null,
// so the previous DayStrip was decoration). No icon — Bed is not in the
// locked vocabulary; the tooltip label "Sleep" carries the meaning.

type NightRow = { slept: number | null };

type Props = {
  recentNights: NightRow[]; // newest first; up to 3
  echo: SleepSpendEcho | null;
};

function descriptorFor(hours: number | null): string {
  if (hours === null) return "no log";
  if (hours >= 7) return "rested";
  if (hours >= 5) return "lean";
  return "short";
}

export function SleepWidget({ recentNights, echo }: Props) {
  const [open, setOpen] = useState(false);
  const lastNight = recentNights[0]?.slept ?? null;
  return (
    <>
      <SWidget
        label="Sleep"
        hero={
          lastNight === null ? (
            <span>—</span>
          ) : (
            <NumberHero
              value={lastNight}
              maximumFractionDigits={1}
              minimumFractionDigits={1}
              suffix="h"
              className="tabular-nums"
            />
          )
        }
        sub={`last night · ${descriptorFor(lastNight)}`}
        onOpen={() => setOpen(true)}
      />
      <MorningLogModal open={open} onOpenChange={setOpen} existing={echo?.morning ?? null} />
    </>
  );
}

function MorningLogModal({
  open,
  onOpenChange,
  existing,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  existing: SleepSpendEcho["morning"];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [slept, setSlept] = useState<string>(existing?.slept_hours ? String(existing.slept_hours) : "");
  const [mood, setMood] = useState<number | null>(existing?.mood_band ?? null);
  const [mind, setMind] = useState<string>(existing?.mind_state ?? "");
  const [notes, setNotes] = useState<string>(existing?.notes ?? "");
  return (
    <CenterModal
      open={open}
      onOpenChange={onOpenChange}
      title="Morning"
      description="Log how the night went. The AI writes back tonight."
    >
      <CenterModalBody>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="slept">Slept (hours)</Label>
            <Input
              id="slept"
              type="number"
              step="0.5"
              min="0"
              max="14"
              value={slept}
              onChange={(e) => setSlept(e.target.value)}
              placeholder="7.5"
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Mood</Label>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setMood(n)}
                  className={
                    "h-9 w-9 rounded-full border text-sm tabular-nums transition-colors " +
                    (mood === n
                      ? "border-foreground bg-foreground text-background"
                      : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground")
                  }
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="mind">Mind state</Label>
            <Input
              id="mind"
              value={mind}
              onChange={(e) => setMind(e.target.value)}
              placeholder="clear / fuzzy / wired …"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="notes">Notes (optional)</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>
        </div>
      </CenterModalBody>
      <CenterModalFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
          Cancel
        </Button>
        <Button
          onClick={() => {
            start(async () => {
              const result = await saveMorningLogAction({
                sleptHours: slept ? Number(slept) : null,
                moodBand: mood,
                mindState: mind.trim() || null,
                notes: notes.trim() || null,
              });
              if (result.ok) {
                toast.success("Morning logged.");
                onOpenChange(false);
                router.refresh();
              } else {
                toast.error(result.error);
              }
            });
          }}
          disabled={pending}
        >
          Save
        </Button>
      </CenterModalFooter>
    </CenterModal>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { Bed, Send } from "lucide-react";
import { toast } from "sonner";

import { CenterModal, CenterModalBody, CenterModalFooter } from "@/components/ui/center-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { saveMorningLogAction } from "@/lib/data/actions";
import { cn } from "@/lib/utils";
import type { SleepSpendEcho } from "@/lib/ai/sleep-spend-echo";

// Sleep × Spend Echo (#4) — ship as a NOTIFICATION (Hatim 2026-06-01). For
// web, we render a prompt card. When the user has logged the morning, the
// card shows the AI-written echo line. When they haven't, it shows a quick
// "Log the morning" button that opens a center modal.

export function SleepSpendEchoCard({ echo }: { echo: SleepSpendEcho | null }) {
  const [open, setOpen] = useState(false);
  if (!echo) return null;
  const hasLog = echo.morning != null;

  return (
    <>
      <motion.section
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        className="rounded-[12px] border border-border/60 bg-card/30 px-3.5 py-3"
      >
        <header className="flex items-baseline justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Bed className="h-3 w-3 text-foreground/70" />
            <span className="text-[10px] uppercase tracking-[0.14em] text-foreground/70">
              Sleep × Spend
            </span>
          </div>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
          >
            {hasLog ? "Edit" : "Log"}
          </button>
        </header>
        {hasLog ? (
          <p className="mt-1.5 text-sm leading-snug text-foreground">{echo.line}</p>
        ) : (
          <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
            Log the morning — sleep, mood, and a line about your mind. The AI writes back the echo at the end of the day.
          </p>
        )}
      </motion.section>

      <MorningLogModal open={open} onOpenChange={setOpen} existing={echo.morning ?? null} />
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
      title="Log the morning"
      description="Sleep, mood, mind. The echo at end-of-day reads against it."
      size="sm"
    >
      <CenterModalBody>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Hours slept
            </Label>
            <Input
              type="number"
              step="0.5"
              min="0"
              max="24"
              value={slept}
              onChange={(e) => setSlept(e.target.value)}
              placeholder="7"
              className="h-9 text-sm tabular"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Mood
            </Label>
            <div className="flex gap-1.5">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setMood(mood === n ? null : n)}
                  className={cn(
                    "h-9 flex-1 rounded-md border text-sm tabular transition-colors",
                    mood === n
                      ? "border-foreground bg-foreground text-background"
                      : "border-border/70 text-foreground/80 hover:bg-muted",
                  )}
                  aria-label={`Mood ${n} of 5`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Mind
            </Label>
            <Input
              value={mind}
              onChange={(e) => setMind(e.target.value)}
              placeholder="scattered, calm but tired, edgy…"
              className="h-9 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Notes <span className="ml-1 normal-case tracking-normal text-muted-foreground/60">optional</span>
            </Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything worth remembering about today"
              rows={2}
              className="resize-none text-sm"
            />
          </div>
        </div>
      </CenterModalBody>
      <CenterModalFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button
          disabled={pending}
          onClick={() =>
            start(async () => {
              try {
                const sleptNum = slept.trim() ? Number(slept) : null;
                await saveMorningLogAction({
                  sleptHours: Number.isFinite(sleptNum) ? sleptNum : null,
                  moodBand: mood,
                  mindState: mind.trim() || null,
                  notes: notes.trim() || null,
                });
                toast.success("Morning logged.");
                onOpenChange(false);
                router.refresh();
              } catch (err) {
                toast.error((err as Error).message);
              }
            })
          }
          className="gap-1.5"
        >
          <Send className="h-3.5 w-3.5" />
          {pending ? "Saving…" : "Save"}
        </Button>
      </CenterModalFooter>
    </CenterModal>
  );
}

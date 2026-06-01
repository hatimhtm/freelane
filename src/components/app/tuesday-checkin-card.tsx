"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { Sparkles, Send } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { saveCheckinResponseAction } from "@/lib/data/actions";
import { cn } from "@/lib/utils";
import type { WellbeingCheckin } from "@/lib/supabase/types";

// Tuesday Check-In card on Today. Surfaces only on Tuesday OR when a check-in
// already exists for the current week. Otherwise the card is silent — the
// /should-i-buy quicklink in the header replaces this affordance the rest of
// the week.

export function TuesdayCheckinCard({
  prompt,
  checkin,
  isCheckinDay,
}: {
  prompt: string;
  checkin: WellbeingCheckin | null;
  isCheckinDay: boolean;
}) {
  const router = useRouter();
  const [response, setResponse] = useState<string>(checkin?.response ?? "");
  const [mood, setMood] = useState<number | null>(checkin?.mood ?? null);
  const [energy, setEnergy] = useState<number | null>(checkin?.energy ?? null);
  const [pending, start] = useTransition();

  // Hide entirely when there's nothing to do.
  if (!isCheckinDay && !checkin) return null;

  return (
    <motion.section
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className="rounded-[14px] border border-border/60 bg-card/40 p-4"
    >
      <header className="flex items-center gap-1.5">
        <Sparkles className="h-3 w-3 text-foreground/70" />
        <span className="text-[10px] uppercase tracking-[0.14em] text-foreground/70">
          Tuesday check-in
        </span>
      </header>
      <p className="mt-1.5 text-sm leading-snug text-foreground">{prompt}</p>

      <Textarea
        value={response}
        onChange={(e) => setResponse(e.target.value)}
        placeholder="A line is enough."
        rows={3}
        className="mt-2.5 resize-none text-sm"
      />

      <div className="mt-3 grid grid-cols-2 gap-3">
        <PillRow label="Mood" value={mood} onChange={setMood} />
        <PillRow label="Energy" value={energy} onChange={setEnergy} />
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        {checkin?.echo ? (
          <p className="min-w-0 flex-1 text-[12px] leading-relaxed text-foreground/85">
            <span className="font-medium">Echo · </span>{checkin.echo}
          </p>
        ) : (
          <span className="text-[11px] text-muted-foreground/70">
            The echo lands after you save.
          </span>
        )}
        <Button
          size="sm"
          disabled={pending || !response.trim()}
          onClick={() =>
            start(async () => {
              const result = await saveCheckinResponseAction({
                response: response.trim(),
                mood,
                energy,
              });
              if (!result.ok) {
                toast.error(result.error || "Couldn't save.");
                return;
              }
              toast.success("Saved.");
              router.refresh();
            })
          }
          className="gap-1.5"
        >
          <Send className="h-3 w-3" />
          {pending ? "Writing…" : "Send"}
        </Button>
      </div>
    </motion.section>
  );
}

function PillRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (n: number | null) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(value === n ? null : n)}
            className={cn(
              "h-7 flex-1 rounded-md border text-xs tabular transition-colors",
              value === n
                ? "border-foreground bg-foreground text-background"
                : "border-border/70 text-foreground/80 hover:bg-muted",
            )}
            aria-label={`${label} ${n} of 5`}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { Coffee, Send } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { saveCheckinResponseAction } from "@/lib/data/actions";
import { cn } from "@/lib/utils";
import type { WellbeingCheckin } from "@/lib/supabase/types";

// Tuesday Check-In card on Today. Shows the AI-written prompt at the top
// + a textarea + 1-5 pills for mood and energy + submit. Once submitted,
// shows the echo line back. Hides nothing — the user can edit and re-submit.

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
  const [open, setOpen] = useState(isCheckinDay || !!checkin);
  const [pending, start] = useTransition();

  if (!open) {
    return (
      <motion.section
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        className="rounded-[12px] border border-border/60 bg-card/30 px-3.5 py-3"
      >
        <header className="flex items-baseline justify-between gap-2">
          <span className="text-[10px] uppercase tracking-[0.14em] text-foreground/70">
            Tuesday check-in
          </span>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
          >
            Open
          </button>
        </header>
        <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">{prompt}</p>
      </motion.section>
    );
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className="rounded-[14px] border border-border/60 bg-card/40 p-4"
    >
      <header className="flex items-baseline justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Coffee className="h-3 w-3 text-foreground/70" />
          <span className="text-[10px] uppercase tracking-[0.14em] text-foreground/70">
            Tuesday check-in
          </span>
        </div>
        {!isCheckinDay && (
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
          >
            Close
          </button>
        )}
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

      <div className="mt-3 flex items-center justify-between gap-2">
        {checkin?.echo ? (
          <p className="text-[12px] leading-relaxed text-foreground/85">
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
              try {
                await saveCheckinResponseAction({
                  response: response.trim(),
                  mood,
                  energy,
                });
                toast.success("Saved.");
                router.refresh();
              } catch (err) {
                toast.error((err as Error).message);
              }
            })
          }
          className="gap-1.5"
        >
          <Send className="h-3 w-3" />
          {pending ? "Writing back…" : "Send"}
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

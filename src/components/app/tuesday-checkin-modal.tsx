"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Send } from "lucide-react";

import { CenterModal, CenterModalBody, CenterModalFooter } from "@/components/ui/center-modal";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { saveCheckinResponseAction } from "@/lib/data/actions";
import { cn } from "@/lib/utils";
import type { WellbeingCheckin } from "@/lib/supabase/types";

// T06 — Tuesday check-in lives as a CENTER modal, opened from the notification
// inbox. The notification is dispatched on the morning of every Tuesday.

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  prompt: string;
  checkin: WellbeingCheckin | null;
};

export function TuesdayCheckinModal({ open, onOpenChange, prompt, checkin }: Props) {
  const router = useRouter();
  const [response, setResponse] = useState<string>(checkin?.response ?? "");
  const [mood, setMood] = useState<number | null>(checkin?.mood ?? null);
  const [energy, setEnergy] = useState<number | null>(checkin?.energy ?? null);
  const [pending, start] = useTransition();

  return (
    <CenterModal
      open={open}
      onOpenChange={onOpenChange}
      title="Tuesday check-in"
      description="A line and two numbers. The echo lands after you save."
    >
      <CenterModalBody>
        <p className="text-sm leading-snug text-foreground">{prompt}</p>
        <Textarea
          value={response}
          onChange={(e) => setResponse(e.target.value)}
          placeholder="A line is enough."
          rows={4}
          className="mt-3 resize-none text-sm"
        />
        <div className="mt-4 grid grid-cols-2 gap-3">
          <PillRow label="Mood" value={mood} onChange={setMood} />
          <PillRow label="Energy" value={energy} onChange={setEnergy} />
        </div>
        {checkin?.echo && (
          <p className="mt-4 rounded-md bg-foreground/[0.03] px-3 py-2 text-[12.5px] leading-snug text-foreground/85">
            <span className="font-medium">Echo · </span>
            {checkin.echo}
          </p>
        )}
      </CenterModalBody>
      <CenterModalFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
          Close
        </Button>
        <Button
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
              onOpenChange(false);
              router.refresh();
            })
          }
        >
          <Send className="mr-1.5 h-3.5 w-3.5" />
          {pending ? "Writing…" : "Send"}
        </Button>
      </CenterModalFooter>
    </CenterModal>
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
              "h-8 flex-1 rounded-md border text-xs tabular-nums transition-colors",
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

"use client";

import { useState } from "react";
import { MWidget } from "@/components/widgets/m-widget";
import { DiaryModal } from "./diary-modal";
import type { DiaryEntryRow } from "@/lib/data/actions";

// T21 — Diary M widget. Freeform body + 1-5 mood pill (energy lives on the
// morning log — keeping the diary surface to "freeform + one number" per
// the Today brief). Hero on closed card = first line of body (or "Tap to
// write" empty state). No icon — BookOpen isn't in the locked vocabulary;
// the eyebrow "DIARY" carries the label.

type Props = {
  existing: DiaryEntryRow | null;
  entryDate: string;
};

function firstLine(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return "Tap to write";
  const line = trimmed.split(/\r?\n/)[0];
  return line.length > 120 ? line.slice(0, 117) + "…" : line;
}

export function DiaryWidget({ existing, entryDate }: Props) {
  const [open, setOpen] = useState(false);
  const headline = firstLine(existing?.body ?? "");
  const isEmpty = !existing || !existing.body.trim();

  return (
    <>
      <MWidget
        label="Diary"
        eyebrow="DIARY"
        hero={
          <span className="display-headline text-[20px] leading-snug text-balance">
            {headline}
          </span>
        }
        sub={
          existing && existing.mood ? (
            <span className="flex items-center gap-3">
              <span>mood {existing.mood}/5</span>
            </span>
          ) : isEmpty ? (
            "Mood optional."
          ) : null
        }
        onOpen={() => setOpen(true)}
        tone={isEmpty ? "muted" : "default"}
      />
      <DiaryModal
        open={open}
        onOpenChange={setOpen}
        existing={existing}
        entryDate={entryDate}
      />
    </>
  );
}

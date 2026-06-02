"use client";

import { Sparkles } from "lucide-react";

// Starter-pill row inside the modal. Shown only when the current session
// has 0 messages — pills are conversation-openers, not interrupters.
//
// Replaces the standalone today-question-pills.tsx surfacing. Pills are
// now Flash-Lite generated per page, lazy on modal open.

type Props = {
  pills: string[];
  onPick: (q: string) => void;
  loading: boolean;
};

export function ChatbotPillsBar({ pills, onPick, loading }: Props) {
  if (loading) {
    return (
      <div className="space-y-2 px-1 py-2">
        <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
          <Sparkles className="h-3 w-3" />
          Starter prompts
        </div>
        <div className="flex flex-wrap gap-2">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-7 w-32 animate-pulse rounded-full bg-foreground/[0.06]"
            />
          ))}
        </div>
      </div>
    );
  }
  if (pills.length === 0) return null;
  return (
    <div className="space-y-2 px-1 py-2">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
        <Sparkles className="h-3 w-3" />
        Starter prompts
      </div>
      <div className="flex flex-wrap gap-2">
        {pills.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onPick(p)}
            className="rounded-full border border-border/70 bg-card px-3 py-1.5 text-[12px] text-muted-foreground transition-colors hover:border-foreground/40 hover:bg-foreground/[0.04] hover:text-foreground"
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}

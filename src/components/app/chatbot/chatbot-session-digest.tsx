"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, MessageCircle } from "lucide-react";

// Collapsed past-session row in the chat history. Default collapsed:
// date range + first 80 chars + chevron. Expanded: full summary.

type Props = {
  summary: string;
  startedAt: string;
  endedAt: string;
  messageCount: number;
};

function dayLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function ChatbotSessionDigest({
  summary,
  startedAt,
  endedAt,
  messageCount,
}: Props) {
  const [open, setOpen] = useState(false);
  const Chev = open ? ChevronDown : ChevronRight;
  const preview = summary.length > 80 ? summary.slice(0, 80) + "…" : summary;
  const sameDay = startedAt.slice(0, 10) === endedAt.slice(0, 10);
  const dateRange = sameDay
    ? dayLabel(startedAt)
    : `${dayLabel(startedAt)} – ${dayLabel(endedAt)}`;

  return (
    <button
      type="button"
      onClick={() => setOpen((v) => !v)}
      className="w-full rounded-md border border-border/40 bg-card/30 px-3 py-2 text-left text-[12px] transition-colors hover:bg-card/50"
    >
      <div className="flex items-start gap-2">
        <Chev className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-muted-foreground">
            <MessageCircle className="h-3 w-3" />
            <span>{dateRange}</span>
            <span aria-hidden>·</span>
            <span>{messageCount} msgs</span>
          </div>
          <div className="mt-1 text-foreground/80">
            {open ? summary : preview}
          </div>
        </div>
      </div>
    </button>
  );
}

"use client";

import { cn } from "@/lib/utils";
import { TERRACOTTA_DOT_CLASS } from "@/lib/design/tokens";
import type { ClientPatternHistoryRow } from "@/lib/data/queries";

// Vertical timeline of every detected pattern shift + the answer Hatim
// chose. Reads from getClientPatternHistory(clientId) at the page level
// — the row union covers both client_pattern_change notifications and
// answered open-questions. Empty state hidden per the widget memo.

type Props = {
  rows: ClientPatternHistoryRow[];
};

export function PatternChangeHistory({ rows }: Props) {
  if (rows.length === 0) return null;
  return (
    <section>
      <h2 className="mb-3 text-sm font-medium">Pattern shifts</h2>
      <ol className="relative ml-2 space-y-3 border-l border-border/60 pl-4">
        {rows.map((row) => (
          <li key={row.id} className="relative">
            <span
              className={cn(
                "absolute -left-[21px] top-1.5 size-2 rounded-full ring-2 ring-background",
                row.source === "notification" ? TERRACOTTA_DOT_CLASS : "bg-muted-foreground/40",
              )}
            />
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                {row.pattern_kind ? humanizeKind(row.pattern_kind) : "Shift"}
              </span>
              <time className="shrink-0 text-[10.5px] tabular text-muted-foreground/70">
                {formatPhtDate(row.created_at)}
              </time>
            </div>
            {row.summary && (
              <div className="mt-1 text-sm leading-snug text-foreground">{row.summary}</div>
            )}
            {row.question && !row.summary && (
              <div className="mt-1 text-sm leading-snug text-foreground">{row.question}</div>
            )}
            {row.answer && (
              <div className="mt-1 text-[12px] italic text-muted-foreground">
                You said: &ldquo;{row.answer}&rdquo;
              </div>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

function humanizeKind(kind: string): string {
  return kind
    .replace(/^pattern_change_/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatPhtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

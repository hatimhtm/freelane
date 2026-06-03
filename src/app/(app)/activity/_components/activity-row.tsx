"use client";

import Link from "next/link";
import { Brain, Bell, type LucideIcon } from "lucide-react";
import { cn, phtTimeString } from "@/lib/utils";
import { CATEGORY_BY_KEY } from "@/lib/activity/categories";
import { SOURCE_BY_TABLE } from "@/lib/activity/sources-registry";
import { sourceDetailHref } from "@/lib/activity/source-detail";
import type { ActivityRow } from "@/lib/activity/feed";

const ACTOR_ICON: Record<"ai" | "system", LucideIcon> = {
  ai: Brain,
  system: Bell,
};

// Per-source nouns come from SOURCE_BY_TABLE (lib/activity/sources-
// registry.ts). Centralizing the noun there means a new source can't
// land without a screen-reader label — the registry is the only entry
// point. Fallback humanizes snake_case so even an unregistered table
// reads naturally to a screen reader.
function nounFor(sourceTable: string): string {
  const registered = SOURCE_BY_TABLE.get(sourceTable);
  if (registered) return registered.noun;
  return sourceTable.replace(/_/g, " ");
}

// Visual grammar note
// ───────────────────
// This row is intentionally NOT a `<MWidget>` from
// `src/components/widgets/m-widget.tsx`. The M-widget is a fixed-size
// (~340×160) glanceable card; the activity feed needs a horizontally
// dense single-row primitive. We deliberately mirror the M-widget's
// visual grammar (rounded-xl bg-card ring-1 hover-translate-y-0.5
// hover-shadow) inline so the row reads as part of the same system
// without inheriting the card's height. Don't "fix" by swapping in
// MWidget — the layout breaks.
export function ActivityRow({ row }: { row: ActivityRow }) {
  const cat = CATEGORY_BY_KEY[row.category];
  const CatIcon = cat.icon;
  const href = sourceDetailHref(row.source_table, row.source_id, row.payload);

  // Actor badge — user rows render WITHOUT a badge by design (spec calls
  // out the badge for AI/system rows only). Keeping the choice explicit
  // so a future reviewer doesn't "fix" the missing branch by adding a
  // "You" affordance that would crowd the meta row.
  const ActorIcon =
    row.actor === "ai"
      ? ACTOR_ICON.ai
      : row.actor === "system"
        ? ACTOR_ICON.system
        : null;

  const noun = nounFor(row.source_table);
  // Screen readers reach rows in isolation (focus skip, list-item
  // traversal). The visible PHT day lives in the group header above,
  // which a row-by-row reader doesn't pick up. Build a full-context
  // label so each row reads with both day and clock time.
  const phtDayLabel = formatPhtDayLabel(row.timestamp);
  const phtClock = phtTimeString(row.timestamp);
  const ariaLabel = `${row.summary} — ${phtDayLabel} at ${phtClock} — open ${noun} detail`;

  return (
    <Link
      href={href}
      prefetch={false}
      aria-label={ariaLabel}
      className={cn(
        "group flex w-full items-start gap-3 rounded-xl bg-card p-3.5 ring-1 ring-foreground/10 transition-all duration-200",
        "hover:-translate-y-0.5 hover:shadow-[0_8px_20px_-8px_oklch(0_0_0/0.12)]",
      )}
    >
      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md bg-foreground/[0.04] text-foreground/70">
        <CatIcon className="h-[16px] w-[16px]" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-baseline gap-2">
          <div
            className="min-w-0 flex-1 truncate text-sm leading-snug text-foreground"
            title={row.summary}
          >
            {row.summary}
          </div>
          <div className="shrink-0 text-[11px] tabular-nums text-muted-foreground/70">
            {phtClock}
          </div>
        </div>
        <div className="flex items-center gap-2 text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground/70">
          <span>{cat.label}</span>
          {ActorIcon && (
            <span
              aria-label={row.actor === "ai" ? "AI action" : "System action"}
              className="inline-flex items-center gap-1 rounded-full bg-foreground/[0.06] px-1.5 py-px text-foreground/80 ring-1 ring-foreground/10"
            >
              <ActorIcon className="h-[10px] w-[10px]" />
              {row.actor === "ai" ? "AI" : "System"}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

// PHT-day label used for the row's screen-reader context. Renders as
// "today", "yesterday", or "Mon, Jun 2" depending on distance from
// now. Kept private to this file — the visible day group header in
// activity-view.tsx still renders the canonical "Today"/"Yesterday"
// label with capitalization, but SR text should read lowercased
// inside the sentence.
function formatPhtDayLabel(iso: string): string {
  const phtOffsetMs = 8 * 60 * 60 * 1000;
  const ts = new Date(iso).getTime();
  const nowMs = Date.now();
  const rowDay = phtDayKey(ts, phtOffsetMs);
  const todayDay = phtDayKey(nowMs, phtOffsetMs);
  if (rowDay === todayDay) return "today";
  const yesterdayDay = phtDayKey(nowMs - 86_400_000, phtOffsetMs);
  if (rowDay === yesterdayDay) return "yesterday";
  return new Date(`${rowDay}T00:00:00+08:00`).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function phtDayKey(ms: number, offsetMs: number): string {
  const shifted = new Date(ms + offsetMs);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import {
  Activity as ActivityIcon,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Filter,
  RotateCcw,
  Sliders,
  X,
} from "lucide-react";
import { cn, addDaysPht, phtDateString } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { EmptyState } from "@/components/app/empty-state";
import {
  CATEGORIES,
  type ActivityCategory,
} from "@/lib/activity/categories";
import { SOURCE_REGISTRY } from "@/lib/activity/sources-registry";
import type { ActivityRow as ActivityRowType } from "@/lib/activity/feed";
import { ActivityRow } from "./activity-row";

// Source registry is the single source of truth (lives in
// lib/activity/sources-registry.ts) so categories.ts, feed.ts specs, and
// this dropdown all read the same shape. SOURCE_OPTIONS is just a view
// projection.
const SOURCE_OPTIONS = SOURCE_REGISTRY.map((s) => ({
  value: s.table,
  label: s.label,
}));

// Sentinel that mirrors the server contract in page.tsx — used when the
// user deselects every category chip so the URL can ENCODE "show me
// nothing" instead of falling back to "all categories" (the missing-
// param contract).
const EMPTY_CATEGORIES_SENTINEL = "__none__";

// Skip the AnimatePresence height-animation on day groups this large.
// Measure-layer height animations cause first-paint jank on mobile
// Safari when the section contains many rows.
const HEIGHT_ANIMATE_ROW_LIMIT = 30;

// Apply the URL state in a single replace — every filter affordance funnels
// through this so the search params stay canonical (no stray nulls, no
// duplicate keys).
function updateSearchParams(
  current: URLSearchParams,
  patch: Record<string, string | null>,
) {
  const next = new URLSearchParams(current.toString());
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === "") next.delete(key);
    else next.set(key, value);
  }
  return next.toString();
}

export type ActivityViewProps = {
  rows: ActivityRowType[];
  initialCategories: ActivityCategory[];
  noneSelected: boolean;
  initialSource: string | null;
  initialDay: string | null;
  initialShowAi: boolean;
  nextCursor: { timestamp: string; id: string } | null;
  partial: boolean;
};

export function ActivityView({
  rows,
  initialCategories,
  noneSelected,
  initialSource,
  initialDay,
  initialShowAi,
  nextCursor,
  partial,
}: ActivityViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [selectedCategories, setSelectedCategories] =
    useState<ActivityCategory[]>(initialCategories);
  const [source, setSource] = useState<string | null>(initialSource);
  const [day, setDay] = useState<string | null>(initialDay);
  const [showAi, setShowAi] = useState<boolean>(initialShowAi);
  const [partialDismissed, setPartialDismissed] = useState(false);

  // Per-day collapsible groups. TODAY is auto-expanded; everything else
  // collapses by default so the feed reads as "what happened today" with
  // history one tap away. When the user jumped to a specific PHT day via
  // the calendar popover, expand that day too so they don't have to tap
  // twice to see results.
  const today = useMemo(() => phtDateString(new Date()), []);
  const grouped = useMemo(() => groupByPhtDay(rows, today), [rows, today]);
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    initial.add(today);
    if (day) initial.add(day);
    return initial;
  });

  // When the URL day changes, fold it into the expanded set so the user
  // doesn't need to manually expand a freshly-jumped-to day group.
  useEffect(() => {
    if (!day) return;
    setExpanded((prev) => {
      if (prev.has(day)) return prev;
      const next = new Set(prev);
      next.add(day);
      return next;
    });
  }, [day]);

  // Reset the dismissed flag when a fresh navigation arrives with a
  // different partial signal — a true→true→false→true transition
  // shouldn't leave the banner permanently hidden.
  useEffect(() => {
    setPartialDismissed(false);
  }, [partial]);

  // The server already narrowed by category + source + day + includeAi.
  // No client-side filtering on grouped rows — we just render what the
  // server returned. Empty groups still render the "nothing here yet"
  // empty state via totalRows below.
  const totalRows = grouped.reduce((s, g) => s + g.rows.length, 0);

  const toggleDay = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleCategory = (key: ActivityCategory) => {
    // When deselecting the LAST chip from a non-empty set, encode the
    // explicit "show nothing" sentinel so the server returns the empty
    // state instead of silently falling back to "all categories" (the
    // missing-param contract).
    const next = selectedCategories.includes(key)
      ? selectedCategories.filter((c) => c !== key)
      : [...selectedCategories, key];
    setSelectedCategories(next);
    const all = next.length === CATEGORIES.length;
    const encoded =
      next.length === 0
        ? EMPTY_CATEGORIES_SENTINEL
        : all
          ? null
          : next.join(",");
    startTransition(() => {
      router.replace(
        `?${updateSearchParams(searchParams, {
          categories: encoded,
          // Reset pagination — a new filter set means the cursor is stale.
          cursor: null,
          cursorId: null,
        })}`,
        { scroll: false },
      );
    });
  };

  const onSourceChange = (value: string | null) => {
    setSource(value);
    startTransition(() => {
      router.replace(
        `?${updateSearchParams(searchParams, {
          source: value,
          cursor: null,
          cursorId: null,
        })}`,
        { scroll: false },
      );
    });
  };

  const onDayChange = (value: string | null) => {
    setDay(value);
    startTransition(() => {
      router.replace(
        `?${updateSearchParams(searchParams, {
          day: value,
          cursor: null,
          cursorId: null,
        })}`,
        { scroll: false },
      );
    });
  };

  const onShowAiChange = (value: boolean) => {
    setShowAi(value);
    startTransition(() => {
      router.replace(
        `?${updateSearchParams(searchParams, {
          showAi: value ? "1" : null,
          cursor: null,
          cursorId: null,
        })}`,
        { scroll: false },
      );
    });
  };

  // Track the count of rows BEFORE the most recent navigation so the
  // "Load older" affordance can briefly highlight newly appended rows
  // when a paginated batch lands. Without the flash a user sitting at
  // the bottom sees nothing change — the URL replace appends silently.
  const prevTotalRef = useRef(totalRows);
  const [recentlyAppended, setRecentlyAppended] = useState(false);
  useEffect(() => {
    if (totalRows > prevTotalRef.current) {
      setRecentlyAppended(true);
      const t = setTimeout(() => setRecentlyAppended(false), 1200);
      return () => clearTimeout(t);
    }
    prevTotalRef.current = totalRows;
    return undefined;
  }, [totalRows]);

  const onLoadOlder = () => {
    if (!nextCursor) return;
    startTransition(() => {
      router.replace(
        `?${updateSearchParams(searchParams, {
          cursor: nextCursor.timestamp,
          cursorId: nextCursor.id,
        })}`,
        { scroll: false },
      );
    });
  };

  const onRetryPartial = () => {
    startTransition(() => {
      router.refresh();
    });
  };

  // Quick-jump chips on the calendar popover. Today + Yesterday + 7d ago
  // are the most-common destinations — saves the user from poking the
  // calendar grid for the routine cases. Uses the shared addDaysPht
  // helper from @/lib/utils so PHT date math stays in one place.
  const quickJumps = useMemo(() => {
    return [
      { label: "Today", day: today },
      { label: "Yesterday", day: addDaysPht(today, -1) },
      { label: "7d ago", day: addDaysPht(today, -7) },
    ];
  }, [today]);

  const showPartialBanner = partial && !partialDismissed;

  // Mobile-only collapsed filter button count (active selectors). When
  // the user has trimmed any default we surface a numeric hint so the
  // collapsed control reads "Filters (2)" instead of just "Filters".
  const activeFilterHints =
    (source ? 1 : 0) +
    (day ? 1 : 0) +
    (showAi ? 1 : 0) +
    (selectedCategories.length === CATEGORIES.length ? 0 : 1);

  return (
    <div className="space-y-6">
      {/* Filter bar */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {CATEGORIES.map((c) => {
            const Icon = c.icon;
            const active = selectedCategories.includes(c.key);
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => toggleCategory(c.key)}
                aria-pressed={active}
                aria-label={`${c.label} category${active ? ", on" : ", off"}`}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition-colors",
                  active
                    ? "bg-foreground text-background ring-foreground"
                    : "bg-card text-muted-foreground ring-foreground/10 hover:bg-foreground/[0.04]",
                )}
              >
                <Icon className="h-[14px] w-[14px]" aria-hidden="true" />
                {c.label}
              </button>
            );
          })}
        </div>

        {/* Desktop / tablet: the full secondary row. Mobile (<sm) hides
            it and surfaces a single "Filters" sheet trigger so the
            chrome doesn't eat 4 rows of vertical space on 360px. */}
        <div className="hidden flex-wrap items-center gap-2 sm:flex">
          <SourceFilter
            value={source}
            onChange={onSourceChange}
          />
          <DayFilter
            value={day}
            today={today}
            quickJumps={quickJumps}
            onChange={onDayChange}
          />
          <ShowAiToggle value={showAi} onChange={onShowAiChange} />
        </div>

        {/* Mobile collapsed entry point. The popover holds the same three
            controls (source / day / show-AI) stacked. */}
        <div className="flex sm:hidden">
          <Popover>
            <PopoverTrigger
              aria-label={`Open filters${activeFilterHints > 0 ? `, ${activeFilterHints} active` : ""}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-background px-3 text-xs font-medium text-foreground hover:bg-accent hover:text-accent-foreground"
            >
              <Sliders className="h-3.5 w-3.5" aria-hidden="true" />
              Filters{activeFilterHints > 0 ? ` (${activeFilterHints})` : ""}
              <ChevronDown className="h-3 w-3 opacity-60" aria-hidden="true" />
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72 space-y-3 p-3">
              <div className="space-y-1.5">
                <label className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  Source
                </label>
                <SourceFilter value={source} onChange={onSourceChange} fullWidth />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  Day
                </label>
                <DayFilter
                  value={day}
                  today={today}
                  quickJumps={quickJumps}
                  onChange={onDayChange}
                  fullWidth
                />
              </div>
              <div className="flex items-center justify-between rounded-md bg-muted/30 px-3 py-2">
                <span className="text-xs font-medium">Show AI</span>
                <Switch checked={showAi} onCheckedChange={onShowAiChange} />
              </div>
            </PopoverContent>
          </Popover>
        </div>

        {showPartialBanner && (
          <div
            role="status"
            aria-live="polite"
            className="flex items-start gap-2 rounded-md bg-amber-50 px-3 py-1.5 text-[11px] text-amber-900 ring-1 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-100 dark:ring-amber-900/30"
          >
            <span className="flex-1 leading-relaxed">
              Some sources couldn&apos;t be loaded just now — what&apos;s
              below is the rest of the feed.
            </span>
            <button
              type="button"
              onClick={onRetryPartial}
              className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-100 dark:hover:bg-amber-900/60"
            >
              <RotateCcw className="h-3 w-3" aria-hidden="true" /> Retry
            </button>
            <button
              type="button"
              aria-label="Dismiss partial-load warning"
              onClick={() => setPartialDismissed(true)}
              className="rounded-md p-0.5 text-amber-900/70 hover:text-amber-900 dark:text-amber-100/70 dark:hover:text-amber-100"
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>

      {/* Empty state */}
      {noneSelected ? (
        <EmptyState
          icon={ActivityIcon}
          title="No categories selected"
          description="Tap any category chip to start filtering — selecting all of them shows everything."
        />
      ) : totalRows === 0 ? (
        <EmptyState
          icon={ActivityIcon}
          title="Nothing here yet"
          description="With your current filters, no activity matches. Try widening the categories or clearing the day filter."
        />
      ) : (
        <div className={cn("space-y-6 transition-opacity", isPending && "opacity-60")}>
          {grouped.map((group) => {
            const open = expanded.has(group.key);
            const contentId = `day-${group.key}-rows`;
            return (
              <section key={group.key} className="space-y-2">
                <button
                  type="button"
                  onClick={() => toggleDay(group.key)}
                  aria-expanded={open}
                  aria-controls={contentId}
                  className="flex w-full items-center gap-3 rounded-md px-1 py-1 text-left transition-colors hover:bg-foreground/[0.03]"
                >
                  <ChevronDown
                    aria-hidden="true"
                    className={cn(
                      "h-3.5 w-3.5 text-muted-foreground transition-transform",
                      open ? "rotate-0" : "-rotate-90",
                    )}
                  />
                  <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                    {group.label}
                  </div>
                  <div className="h-px flex-1 bg-border/60" aria-hidden="true" />
                  <div className="text-[11px] text-muted-foreground/70">
                    {group.rows.length} event{group.rows.length === 1 ? "" : "s"}
                  </div>
                </button>
                <DayGroupRows
                  open={open}
                  contentId={contentId}
                  group={group}
                  flashOnAppend={recentlyAppended}
                />
              </section>
            );
          })}
          {nextCursor && (
            <div className="flex justify-center pt-2">
              <button
                type="button"
                onClick={onLoadOlder}
                disabled={isPending}
                className={cn(
                  "inline-flex h-9 items-center gap-2 rounded-full border border-input bg-background px-4 text-xs font-medium hover:bg-accent hover:text-accent-foreground",
                  isPending && "cursor-wait opacity-60",
                )}
              >
                {isPending ? "Loading…" : "Load older"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Day group row container ────────────────────────────────────────
//
// Two render paths:
//   - Small groups (<= HEIGHT_ANIMATE_ROW_LIMIT rows) use a height
//     transition for a tactile expand/collapse.
//   - Large groups skip the height transition and cross-fade only,
//     because measuring `height: 'auto'` on 100+ children stutters on
//     mobile Safari first-paint.
function DayGroupRows({
  open,
  contentId,
  group,
  flashOnAppend,
}: {
  open: boolean;
  contentId: string;
  group: DayGroup;
  flashOnAppend: boolean;
}) {
  const animate = group.rows.length <= HEIGHT_ANIMATE_ROW_LIMIT;
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="rows"
          id={contentId}
          initial={animate ? { opacity: 0, height: 0 } : { opacity: 0 }}
          animate={animate ? { opacity: 1, height: "auto" } : { opacity: 1 }}
          exit={animate ? { opacity: 0, height: 0 } : { opacity: 0 }}
          transition={{ duration: animate ? 0.2 : 0.12 }}
          className={cn(animate && "overflow-hidden")}
        >
          <div
            className={cn(
              "space-y-2 pl-1 pt-1 transition-colors",
              flashOnAppend && "rounded-md bg-foreground/[0.02]",
            )}
          >
            {group.rows.map((row) => (
              <ActivityRow key={row.id} row={row} />
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── Source filter dropdown ─────────────────────────────────────────

function SourceFilter({
  value,
  onChange,
  fullWidth = false,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
  fullWidth?: boolean;
}) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label="Filter by source"
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-background px-3 text-xs font-medium text-foreground hover:bg-accent hover:text-accent-foreground",
          fullWidth && "w-full justify-between",
        )}
      >
        <span className="inline-flex items-center gap-1.5">
          <Filter className="h-3.5 w-3.5" aria-hidden="true" />
          {value
            ? SOURCE_OPTIONS.find((o) => o.value === value)?.label ?? "Source"
            : "All sources"}
        </span>
        <ChevronDown className="h-3 w-3 opacity-60" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1.5">
        <div className="max-h-72 overflow-y-auto" role="listbox" aria-label="Source">
          <button
            type="button"
            role="option"
            aria-selected={!value}
            onClick={() => onChange(null)}
            className={cn(
              "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-xs hover:bg-muted",
              !value && "bg-muted font-medium",
            )}
          >
            All sources
          </button>
          {SOURCE_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={value === o.value}
              onClick={() => onChange(o.value)}
              className={cn(
                "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-xs hover:bg-muted",
                value === o.value && "bg-muted font-medium",
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ── Day filter (calendar + quick jumps) ────────────────────────────

function DayFilter({
  value,
  today,
  quickJumps,
  onChange,
  fullWidth = false,
}: {
  value: string | null;
  today: string;
  quickJumps: { label: string; day: string }[];
  onChange: (next: string | null) => void;
  fullWidth?: boolean;
}) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label="Filter by PHT day"
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-background px-3 text-xs font-medium text-foreground hover:bg-accent hover:text-accent-foreground",
          fullWidth && "w-full justify-between",
        )}
      >
        <span className="inline-flex items-center gap-1.5">
          <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
          {value ? phtDayLabel(value, today) : "Any day"}
        </span>
        <ChevronDown className="h-3 w-3 opacity-60" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-3">
        <div className="space-y-3">
          <div className="space-y-1.5">
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Quick jump
            </div>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Quick jump">
              {quickJumps.map((qj) => {
                const selected = value === qj.day;
                return (
                  <button
                    key={qj.day}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => onChange(qj.day)}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full bg-muted/40 px-2 py-1 text-[11px] hover:bg-muted",
                      selected && "bg-foreground text-background hover:bg-foreground",
                    )}
                  >
                    {qj.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Pick a PHT day
            </div>
            <CalendarGrid
              today={today}
              selected={value}
              onSelect={(d) => onChange(d)}
            />
          </div>
          {value && (
            <button
              type="button"
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
              onClick={() => onChange(null)}
            >
              <X className="h-3 w-3" aria-hidden="true" /> Clear
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Inline PHT calendar grid. We render our own instead of the native
// <input type="date"> (which renders inconsistently on iOS Safari and
// ignores the surrounding card styling). The grid is anchored to PHT
// — every key it emits is a "YYYY-MM-DD" string in PHT, matching the
// rest of the feed's day-grouping.
function CalendarGrid({
  today,
  selected,
  onSelect,
}: {
  today: string;
  selected: string | null;
  onSelect: (day: string) => void;
}) {
  const [viewMonth, setViewMonth] = useState(() => firstOfMonthPht(selected ?? today));

  const monthLabel = useMemo(() => {
    const dt = new Date(`${viewMonth}T00:00:00+08:00`);
    return dt.toLocaleDateString(undefined, {
      month: "long",
      year: "numeric",
    });
  }, [viewMonth]);

  const grid = useMemo(() => buildMonthGrid(viewMonth), [viewMonth]);

  const canStepForward = compareDayPht(viewMonth, firstOfMonthPht(today)) < 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => setViewMonth((m) => shiftMonthPht(m, -1))}
          className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        <div className="text-xs font-medium text-foreground">{monthLabel}</div>
        <button
          type="button"
          aria-label="Next month"
          disabled={!canStepForward}
          onClick={() => setViewMonth((m) => shiftMonthPht(m, 1))}
          className={cn(
            "grid h-7 w-7 place-items-center rounded-md text-muted-foreground",
            canStepForward
              ? "hover:bg-muted hover:text-foreground"
              : "opacity-40",
          )}
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
        {WEEKDAYS.map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {grid.map((cell, i) => {
          if (!cell) {
            return <span key={i} aria-hidden="true" className="h-7" />;
          }
          const inFuture = compareDayPht(cell.key, today) > 0;
          const isSelected = selected === cell.key;
          const isToday = cell.key === today;
          return (
            <button
              key={cell.key}
              type="button"
              role="gridcell"
              aria-current={isToday ? "date" : undefined}
              aria-pressed={isSelected}
              aria-label={cell.aria}
              disabled={inFuture}
              onClick={() => onSelect(cell.key)}
              className={cn(
                "h-7 rounded-md text-[11px] tabular-nums transition-colors",
                isSelected
                  ? "bg-foreground text-background"
                  : isToday
                    ? "bg-muted text-foreground"
                    : "text-foreground hover:bg-muted",
                inFuture && "cursor-not-allowed text-muted-foreground/40 hover:bg-transparent",
              )}
            >
              {cell.dayNum}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Show AI toggle ─────────────────────────────────────────────────

function ShowAiToggle({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div
      className="ml-auto inline-flex items-center gap-2 rounded-full bg-card px-3 py-1.5 ring-1 ring-foreground/10"
      title="Include rows where the AI took an action — memory updates, vendor canonicalizations, letters."
    >
      <span className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
        Show AI
      </span>
      <Switch
        checked={value}
        onCheckedChange={onChange}
        aria-label="Include AI activity in the feed"
      />
    </div>
  );
}

// ── PHT helpers ────────────────────────────────────────────────────
//
// Day-grouping math is delegated to @/lib/utils (phtDateString,
// addDaysPht) so the canonical helper is the single source of truth
// for PHT date logic. Locals below cover view-only concerns: human
// labels for headers/triggers and the calendar grid build.

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

type DayGroup = {
  key: string;
  label: string;
  rows: ActivityRowType[];
};

function phtDayLabel(dayKey: string, today: string): string {
  if (dayKey === today) return "Today";
  if (dayKey === addDaysPht(today, -1)) return "Yesterday";
  const todayYear = new Date(`${today}T00:00:00+08:00`).getUTCFullYear();
  const cellYear = new Date(`${dayKey}T00:00:00+08:00`).getUTCFullYear();
  return new Date(`${dayKey}T00:00:00+08:00`).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: cellYear === todayYear ? undefined : "numeric",
  });
}

function groupByPhtDay(rows: ActivityRowType[], today: string): DayGroup[] {
  const buckets: DayGroup[] = [];
  const index = new Map<string, number>();
  for (const row of rows) {
    const key = phtDateString(new Date(row.timestamp));
    let i = index.get(key);
    if (i === undefined) {
      i = buckets.length;
      index.set(key, i);
      buckets.push({ key, label: phtDayLabel(key, today), rows: [] });
    }
    buckets[i].rows.push(row);
  }
  // Defensive sort within each bucket. Compare as epoch millis so an
  // ISO offset mismatch doesn't silently reorder same-instant rows.
  for (const bucket of buckets) {
    bucket.rows.sort((a, b) => {
      const at = new Date(a.timestamp).getTime();
      const bt = new Date(b.timestamp).getTime();
      if (at === bt) return a.id < b.id ? 1 : -1;
      return at < bt ? 1 : -1;
    });
  }
  return buckets;
}

// First PHT-day of the month for the given PHT-day key.
function firstOfMonthPht(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

// Shift a month-anchor PHT day key by N months.
function shiftMonthPht(monthKey: string, delta: number): string {
  const [y, m] = monthKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m ?? 1) - 1 + delta, 1));
  const ny = dt.getUTCFullYear();
  const nm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  return `${ny}-${nm}-01`;
}

// Compare two PHT day keys lexically (safe because the format is
// zero-padded). Returns negative if a is earlier than b.
function compareDayPht(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

type CalendarCell = { key: string; dayNum: number; aria: string };

// Build the per-month grid with Mon-first ordering. Leading cells are
// null so the grid offsets correctly into the right weekday column.
function buildMonthGrid(monthKey: string): (CalendarCell | null)[] {
  const [y, m] = monthKey.split("-").map(Number);
  const firstOfMonth = new Date(Date.UTC(y, (m ?? 1) - 1, 1));
  const weekday = firstOfMonth.getUTCDay(); // 0 = Sun
  const monIndex = (weekday + 6) % 7; // 0 = Mon
  const daysInMonth = new Date(Date.UTC(y, m ?? 1, 0)).getUTCDate();
  const cells: (CalendarCell | null)[] = [];
  for (let i = 0; i < monIndex; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) {
    const key = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const aria = new Date(`${key}T00:00:00+08:00`).toLocaleDateString(undefined, {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    cells.push({ key, dayNum: day, aria });
  }
  // Pad trailing so the row stays the same width — helps Safari grid
  // hover affordances render cleanly.
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

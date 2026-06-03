"use client";

import { useState, useTransition } from "react";
import { Archive, ArchiveRestore, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  archiveHabit,
  createHabit,
  toggleHabitEntry,
  updateHabit,
} from "@/lib/habits/actions";
import type { HabitCadence } from "@/lib/supabase/types";
import type { HabitWithEntries } from "@/lib/habits/queries";

const CADENCES: { value: HabitCadence; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "custom", label: "Custom" },
];

// PHT-anchored weekday-narrow formatter. Each tile's label is derived
// from its own date so the letter under the tile always matches the
// real weekday — fixes the positional [M,T,W,T,F,S,S] bug where the
// label and the date never lined up.
const PHT_WEEKDAY = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Manila",
  weekday: "narrow",
});

function dayLabel(isoDate: string): string {
  // habit_entries.completed_on is a date-only column written from phtToday().
  // Hydrate the wall-clock noon in PHT so the weekday-narrow formatter
  // resolves the right day no matter what the rendering server's TZ is.
  // Noon avoids DST edge cases (PHT has no DST today, but defensive).
  const d = new Date(`${isoDate}T12:00:00+08:00`);
  return PHT_WEEKDAY.format(d);
}

export function HabitsSection({
  habits,
  archived: archivedHabits,
}: {
  habits: HabitWithEntries[];
  archived: HabitWithEntries[];
}) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<HabitWithEntries | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [, start] = useTransition();

  function onToggle(habit: HabitWithEntries, date: string, currentlyDone: boolean) {
    start(async () => {
      // revalidatePath in the server action already refreshes the route —
      // no need for a router.refresh() chase on top of it.
      const result = await toggleHabitEntry(habit.id, !currentlyDone, date);
      if (!result.ok) {
        toast.error(result.error);
      }
    });
  }

  function onArchive(habit: HabitWithEntries, archived: boolean) {
    start(async () => {
      const result = await archiveHabit(habit.id, archived);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(archived ? "Habit archived" : "Habit restored");
    });
  }

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-xl border border-border/60">
        {habits.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            No habits yet. Add one — small ones stick.
          </div>
        )}
        {habits.map((h, i) => {
          // Period progress — only meaningful when target > 1. For weekly,
          // the last 7-day window IS the period so the strip itself is
          // the truth; for custom we count over the visible window. Daily
          // (target===1) doesn't render a badge — the checked tile is
          // the progress.
          const doneInWindow = h.recent.filter((d) => d.done).length;
          const showProgress = (h.target ?? 1) > 1;
          return (
            <div
              key={h.id}
              className={cn(
                "group flex items-center gap-3 px-4 py-3",
                i !== habits.length - 1 && "border-b border-border/50",
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{h.name}</span>
                  <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {h.cadence}
                  </span>
                  {showProgress && (
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] tabular",
                        doneInWindow >= (h.target ?? 1)
                          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {doneInWindow}/{h.target} this {h.cadence === "weekly" ? "week" : "window"}
                    </span>
                  )}
                </div>
                <div className="mt-1 flex items-center gap-1">
                  {h.recent.map((day, idx) => {
                    const isToday = idx === h.recent.length - 1;
                    return (
                      <button
                        key={day.date}
                        type="button"
                        aria-pressed={day.done}
                        aria-label={`${day.date} ${day.done ? "done" : "not done"}`}
                        onClick={() => onToggle(h, day.date, day.done)}
                        className={cn(
                          "grid size-6 place-items-center rounded-md border text-[10px] font-semibold transition-colors",
                          day.done
                            ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                            : "border-border/60 text-muted-foreground hover:bg-muted",
                          isToday && !day.done && "ring-1 ring-foreground/20",
                        )}
                      >
                        {dayLabel(day.date)}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 max-md:opacity-100">
                <IconBtn label="Edit" onClick={() => setEditing(h)}>
                  <Pencil className="h-3.5 w-3.5" />
                </IconBtn>
                <IconBtn label="Archive" onClick={() => onArchive(h, true)}>
                  <Archive className="h-3.5 w-3.5" />
                </IconBtn>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-3">
        <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
          <Plus className="mr-1.5 h-3.5 w-3.5" /> Add habit
        </Button>
        {archivedHabits.length > 0 && (
          <button
            type="button"
            onClick={() => setShowArchived((s) => !s)}
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            {showArchived ? "Hide" : "Show"} archived ({archivedHabits.length})
          </button>
        )}
      </div>

      {showArchived && archivedHabits.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-dashed border-border/60 bg-muted/20">
          {archivedHabits.map((h, i) => (
            <div
              key={h.id}
              className={cn(
                "flex items-center gap-3 px-4 py-2.5",
                i !== archivedHabits.length - 1 && "border-b border-border/40",
              )}
            >
              <div className="min-w-0 flex-1">
                <span className="truncate text-sm text-muted-foreground">{h.name}</span>
                <span className="ml-2 shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {h.cadence}
                </span>
              </div>
              <IconBtn label="Restore" onClick={() => onArchive(h, false)}>
                <ArchiveRestore className="h-3.5 w-3.5" />
              </IconBtn>
            </div>
          ))}
        </div>
      )}

      <Dialog open={creating} onOpenChange={setCreating}>
        {creating && (
          <HabitDialog
            onSubmit={async (values) => {
              const result = await createHabit(values);
              if (!result.ok) {
                toast.error(result.error);
                return;
              }
              toast.success("Habit added");
              setCreating(false);
            }}
          />
        )}
      </Dialog>
      {editing && (
        <Dialog open onOpenChange={(o) => !o && setEditing(null)}>
          <HabitDialog
            initial={editing}
            onSubmit={async (values) => {
              const result = await updateHabit(editing.id, values);
              if (!result.ok) {
                toast.error(result.error);
                return;
              }
              toast.success("Habit updated");
              setEditing(null);
            }}
          />
        </Dialog>
      )}
    </div>
  );
}

function IconBtn({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="grid size-7 max-md:size-9 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      {children}
    </button>
  );
}

type HabitValues = { name: string; cadence: HabitCadence; target: number };

function HabitDialog({
  initial,
  onSubmit,
}: {
  initial?: HabitWithEntries;
  onSubmit: (v: HabitValues) => Promise<void>;
}) {
  const [v, setV] = useState<HabitValues>({
    name: initial?.name ?? "",
    cadence: (initial?.cadence as HabitCadence) ?? "daily",
    target: initial?.target ?? 1,
  });
  const [pending, start] = useTransition();
  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{initial ? "Edit habit" : "New habit"}</DialogTitle>
      </DialogHeader>
      <div className="space-y-3">
        <div>
          <Label className="text-xs">Name</Label>
          <Input
            value={v.name}
            onChange={(e) => setV({ ...v, name: e.target.value })}
            placeholder="Quran 10 min · Walk · No cigarettes"
            autoFocus
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Cadence</Label>
            <Select
              value={v.cadence}
              onValueChange={(val) =>
                val && setV({ ...v, cadence: val as HabitCadence })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CADENCES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Target / period</Label>
            <Input
              type="number"
              min="1"
              value={v.target}
              onChange={(e) => setV({ ...v, target: Number(e.target.value) })}
            />
          </div>
        </div>
        <Button
          className="w-full"
          disabled={pending}
          onClick={() =>
            start(async () => {
              if (!v.name.trim()) {
                toast.error("Name is required");
                return;
              }
              await onSubmit({
                name: v.name.trim(),
                cadence: v.cadence,
                target: Math.max(1, v.target),
              });
            })
          }
        >
          {pending ? "Saving…" : initial ? "Save changes" : "Add habit"}
        </Button>
      </div>
    </DialogContent>
  );
}

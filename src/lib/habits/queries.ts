import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { addDaysPht, phtToday } from "@/lib/utils";
import type { Habit, HabitEntry } from "@/lib/supabase/types";

// Per-user habits + per-day check-off entries (migration 0109).
// Live readers filter archived_at IS NULL so a soft-deleted habit
// disappears from the UI but its entries survive for the Activity feed
// and Stats.

export type HabitWithEntries = Habit & {
  // Last 7 PHT-days, oldest first. Used to render the inline check-off
  // strip without N round-trips to the entries table.
  recent: { date: string; done: boolean }[];
  doneToday: boolean;
};

export async function getHabitsWithRecent(): Promise<HabitWithEntries[]> {
  const user = await getAuthUser();
  if (!user) return [];
  const supabase = await createClient();

  const { data: habits } = await supabase
    .from("habits")
    .select("*")
    .eq("user_id", user.id)
    .is("archived_at", null)
    .order("created_at", { ascending: true });
  const list = ((habits ?? []) as unknown) as Habit[];
  if (list.length === 0) return [];

  // Last 7 days window. PHT-local — we never mix UTC dates with date-only
  // columns or the boundary creeps. Walk PHT-anchored date keys via
  // addDaysPht so the row keys match `habit_entries.completed_on`
  // (date-only column written from `phtToday()`); `Date#setDate` on a
  // UTC server would walk the UTC date instead and silently drift by
  // one day for the 00:00–08:00 UTC window.
  const today = phtToday();
  const days: string[] = [];
  for (let i = 6; i >= 0; i--) {
    days.push(addDaysPht(today, -i));
  }
  const oldest = days[0];

  const { data: entries } = await supabase
    .from("habit_entries")
    .select("habit_id, completed_on")
    .eq("user_id", user.id)
    .gte("completed_on", oldest);
  const entryRows = ((entries ?? []) as unknown) as Pick<
    HabitEntry,
    "habit_id" | "completed_on"
  >[];
  const byHabit = new Map<string, Set<string>>();
  for (const row of entryRows) {
    if (!byHabit.has(row.habit_id)) byHabit.set(row.habit_id, new Set());
    byHabit.get(row.habit_id)!.add(row.completed_on);
  }

  return list.map((h) => {
    const dayset = byHabit.get(h.id) ?? new Set();
    const recent = days.map((d) => ({ date: d, done: dayset.has(d) }));
    return {
      ...h,
      recent,
      doneToday: dayset.has(today),
    };
  });
}

// Archived (soft-deleted) habits — lightweight reader for the Settings →
// Body subtab's collapsed "Archived" section so the user can un-archive
// without DB access. We skip the entries hydration here — the archived
// list shows name + cadence + an Unarchive button only.
export async function getArchivedHabitsLite(): Promise<HabitWithEntries[]> {
  const user = await getAuthUser();
  if (!user) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("habits")
    .select("*")
    .eq("user_id", user.id)
    .not("archived_at", "is", null)
    .order("archived_at", { ascending: false });
  const list = ((data ?? []) as unknown) as Habit[];
  return list.map((h) => ({
    ...h,
    recent: [],
    doneToday: false,
  }));
}

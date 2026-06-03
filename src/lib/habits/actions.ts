"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { safeRunLabeled, type ActionResult } from "@/lib/data/actions";
import { addDaysPht, phtToday } from "@/lib/utils";
import type { HabitCadence } from "@/lib/supabase/types";

// Toggle-window: the UI strip shows last 7 PHT days. Tolerate a slightly
// wider window in case the user has the strip open across midnight, but
// reject anything older than ~30 days or in the future so a client with
// devtools can't backfill / pre-fill arbitrary cells and corrupt the
// streak math the heatmap and Stats will derive from these rows.
const TOGGLE_WINDOW_DAYS = 30;

// Next.js 16's "use server" rule rejects non-async RUNTIME exports. Types
// live in @/lib/supabase/types so they don't trip the build; everything
// here is async by construction.

export async function createHabit(input: {
  name: string;
  cadence: HabitCadence;
  target: number;
}): Promise<ActionResult<{ id: string }>> {
  return safeRunLabeled("freelane-habits", "create", async () => {
    const user = await getAuthUser();
    if (!user) throw new Error("Unauthenticated");
    const name = input.name.trim();
    if (!name) throw new Error("Habit name is required.");
    const target = Math.max(1, Math.floor(input.target || 1));
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("habits")
      .insert({
        user_id: user.id,
        name,
        cadence: input.cadence,
        target,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    revalidatePath("/settings/body");
    return { id: data.id as string };
  });
}

export async function updateHabit(
  id: string,
  patch: { name?: string; cadence?: HabitCadence; target?: number },
): Promise<ActionResult<null>> {
  return safeRunLabeled("freelane-habits", "update", async () => {
    const user = await getAuthUser();
    if (!user) throw new Error("Unauthenticated");
    const supabase = await createClient();
    const update: Record<string, unknown> = {};
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) throw new Error("Habit name is required.");
      update.name = name;
    }
    if (patch.cadence !== undefined) update.cadence = patch.cadence;
    if (patch.target !== undefined)
      update.target = Math.max(1, Math.floor(patch.target));
    if (Object.keys(update).length === 0) return null;
    const { error } = await supabase
      .from("habits")
      .update(update)
      .eq("id", id)
      .eq("user_id", user.id);
    if (error) throw new Error(error.message);
    revalidatePath("/settings/body");
    return null;
  });
}

// Soft-archive — the row stays in the table so historical entries continue
// to reference a valid habit_id. Live readers filter archived_at IS NULL.
export async function archiveHabit(
  id: string,
  archived: boolean,
): Promise<ActionResult<null>> {
  return safeRunLabeled("freelane-habits", "archive", async () => {
    const user = await getAuthUser();
    if (!user) throw new Error("Unauthenticated");
    const supabase = await createClient();
    const { error } = await supabase
      .from("habits")
      .update({ archived_at: archived ? new Date().toISOString() : null })
      .eq("id", id)
      .eq("user_id", user.id);
    if (error) throw new Error(error.message);
    revalidatePath("/settings/body");
    return null;
  });
}

// Toggle today's check-off for a habit. UNIQUE (habit_id, completed_on)
// makes duplicate inserts a constraint violation — we use upsert/ignore
// for the insert path and delete for the un-check.
export async function toggleHabitEntry(
  habitId: string,
  done: boolean,
  date?: string,
): Promise<ActionResult<{ date: string; done: boolean }>> {
  return safeRunLabeled("freelane-habits", "toggle", async () => {
    const user = await getAuthUser();
    if (!user) throw new Error("Unauthenticated");
    const supabase = await createClient();
    const today = phtToday();
    const completedOn = date ?? today;

    // Server-side date-bounds gate. RLS already scopes writes to the row
    // owner so a rogue client can't pollute someone else's history — but
    // the user can still corrupt their OWN streak / heatmap math from
    // devtools without this guard.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(completedOn)) {
      throw new Error("Invalid date.");
    }
    if (completedOn > today) {
      throw new Error("Can't toggle a future day.");
    }
    const oldestAllowed = addDaysPht(today, -TOGGLE_WINDOW_DAYS);
    if (completedOn < oldestAllowed) {
      throw new Error("Date is outside the editable window.");
    }

    if (done) {
      const { error } = await supabase.from("habit_entries").upsert(
        {
          habit_id: habitId,
          user_id: user.id,
          completed_on: completedOn,
        },
        { onConflict: "habit_id,completed_on" },
      );
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase
        .from("habit_entries")
        .delete()
        .eq("habit_id", habitId)
        .eq("user_id", user.id)
        .eq("completed_on", completedOn);
      if (error) throw new Error(error.message);
    }
    revalidatePath("/settings/body");
    revalidatePath("/today");
    return { date: completedOn, done };
  });
}

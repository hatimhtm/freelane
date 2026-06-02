"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { safeRunLabeled, type ActionResult } from "@/lib/data/actions";
import type { NotificationPrefs } from "./dispatcher";

// Single canonical ActionResult<T> shape — reuse, not parallel implementation.
// Kept as an alias so the old NotifActionResult name still type-checks at
// call sites until they're migrated.
export type NotifActionResult<T> = ActionResult<T>;

// Reuse the canonical safeRun implementation; the "freelane-notif" prefix
// keeps the inbox-action logs distinct from the financial-action logs.
async function safeRun<T>(label: string, fn: () => Promise<T>): Promise<ActionResult<T>> {
  return safeRunLabeled("freelane-notif", label, fn);
}

export async function markNotificationReadAction(id: string): Promise<ActionResult<null>> {
  return safeRun("markRead", async () => {
    const user = await getAuthUser();
    if (!user) throw new Error("Unauthenticated");
    const supabase = await createClient();
    await supabase
      .from("notifications_inbox")
      .update({ read_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .eq("id", id);
    revalidatePath("/notifications");
    revalidatePath("/");
    revalidatePath("/today");
    return null;
  });
}

export async function dismissNotificationAction(id: string): Promise<ActionResult<null>> {
  return safeRun("dismiss", async () => {
    const user = await getAuthUser();
    if (!user) throw new Error("Unauthenticated");
    const supabase = await createClient();
    const now = new Date().toISOString();
    await supabase
      .from("notifications_inbox")
      .update({ dismissed_at: now, read_at: now })
      .eq("user_id", user.id)
      .eq("id", id);
    revalidatePath("/notifications");
    revalidatePath("/");
    revalidatePath("/today");
    return null;
  });
}

export async function markAllReadAction(): Promise<ActionResult<null>> {
  return safeRun("markAllRead", async () => {
    const user = await getAuthUser();
    if (!user) throw new Error("Unauthenticated");
    const supabase = await createClient();
    await supabase
      .from("notifications_inbox")
      .update({ read_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .is("read_at", null);
    revalidatePath("/notifications");
    revalidatePath("/");
    revalidatePath("/today");
    return null;
  });
}

export async function clearDismissedAction(): Promise<ActionResult<null>> {
  return safeRun("clearDismissed", async () => {
    const user = await getAuthUser();
    if (!user) throw new Error("Unauthenticated");
    const supabase = await createClient();
    await supabase
      .from("notifications_inbox")
      .delete()
      .eq("user_id", user.id)
      .not("dismissed_at", "is", null);
    revalidatePath("/notifications");
    return null;
  });
}

export async function saveNotificationPrefsAction(
  prefs: NotificationPrefs,
): Promise<ActionResult<null>> {
  return safeRun("savePrefs", async () => {
    const user = await getAuthUser();
    if (!user) throw new Error("Unauthenticated");
    const supabase = await createClient();
    await supabase
      .from("notification_prefs")
      .upsert(
        {
          user_id: user.id,
          prefs: prefs as unknown as Record<string, unknown>,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
    revalidatePath("/settings");
    return null;
  });
}

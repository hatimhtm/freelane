"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { safeRunLabeled, type ActionResult } from "@/lib/data/actions";
import type { NotificationAnswer } from "./types";

// Persists the user's response when a notification triggers the
// MultiChoiceAnswer or FreeTextAnswer renderer. Writes to
// notifications_inbox.answer (jsonb — single source of truth on the row).
// Also marks read_at so the row immediately leaves the Unread tab.

export async function submitNotificationAnswerAction(
  notificationId: string,
  answer: NotificationAnswer,
): Promise<ActionResult<null>> {
  return safeRunLabeled("freelane-notif", "answer", async () => {
    const user = await getAuthUser();
    if (!user) throw new Error("Unauthenticated");
    const supabase = await createClient();
    const now = new Date().toISOString();
    await supabase
      .from("notifications_inbox")
      .update({
        answer: answer as unknown as Record<string, unknown>,
        read_at: now,
      })
      .eq("user_id", user.id)
      .eq("id", notificationId);
    revalidatePath("/notifications");
    revalidatePath("/today");
    revalidatePath("/");
    return null;
  });
}

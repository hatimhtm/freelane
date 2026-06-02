"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { safeRunLabeled, type ActionResult } from "@/lib/data/actions";
import type { NotificationPrefs, Notification } from "./dispatcher";
import type {
  NotificationSettings,
  PerKindPref,
  PerKindPrefs,
} from "./types";

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

// ─── notification_settings (retention + push + per-kind) ─────────────────

function revalidateSettingsSurfaces() {
  revalidatePath("/settings/notifications");
  revalidatePath("/notifications");
  revalidatePath("/today");
  revalidatePath("/");
}

async function upsertSettings(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  patch: Partial<{
    retention_days: number;
    retention_forever: boolean;
    push_enabled: boolean;
    per_kind_prefs: PerKindPrefs;
  }>,
) {
  // Read current row to merge per_kind_prefs (so a per-kind upsert doesn't
  // clobber sibling kinds).
  const { data: existing } = await supabase
    .from("notification_settings")
    .select("retention_days, retention_forever, push_enabled, per_kind_prefs")
    .eq("user_id", userId)
    .maybeSingle();
  const merged = {
    retention_days: patch.retention_days ?? existing?.retention_days ?? 3,
    retention_forever:
      patch.retention_forever ?? existing?.retention_forever ?? false,
    push_enabled: patch.push_enabled ?? existing?.push_enabled ?? false,
    per_kind_prefs:
      patch.per_kind_prefs ??
      ((existing?.per_kind_prefs ?? {}) as PerKindPrefs),
  };
  await supabase
    .from("notification_settings")
    .upsert(
      {
        user_id: userId,
        retention_days: merged.retention_days,
        retention_forever: merged.retention_forever,
        push_enabled: merged.push_enabled,
        per_kind_prefs: merged.per_kind_prefs as unknown as Record<
          string,
          unknown
        >,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
}

export async function saveNotificationSettingsAction(
  patch: Partial<NotificationSettings>,
): Promise<ActionResult<null>> {
  return safeRun("saveSettings", async () => {
    const user = await getAuthUser();
    if (!user) throw new Error("Unauthenticated");
    const supabase = await createClient();
    await upsertSettings(supabase, user.id, patch);
    revalidateSettingsSurfaces();
    return null;
  });
}

export async function saveRetentionAction(
  value: number | "forever",
): Promise<ActionResult<null>> {
  return safeRun("saveRetention", async () => {
    const user = await getAuthUser();
    if (!user) throw new Error("Unauthenticated");
    const supabase = await createClient();
    if (value === "forever") {
      await upsertSettings(supabase, user.id, { retention_forever: true });
    } else {
      await upsertSettings(supabase, user.id, {
        retention_days: value,
        retention_forever: false,
      });
    }
    revalidateSettingsSurfaces();
    return null;
  });
}

export async function savePerKindPrefAction(
  kind: string,
  patch: PerKindPref,
): Promise<ActionResult<null>> {
  return safeRun("savePerKindPref", async () => {
    const user = await getAuthUser();
    if (!user) throw new Error("Unauthenticated");
    const supabase = await createClient();
    const { data: existing } = await supabase
      .from("notification_settings")
      .select("per_kind_prefs")
      .eq("user_id", user.id)
      .maybeSingle();
    const current = (existing?.per_kind_prefs ?? {}) as PerKindPrefs;
    const next: PerKindPrefs = {
      ...current,
      [kind]: { ...(current[kind] ?? {}), ...patch },
    };
    await upsertSettings(supabase, user.id, { per_kind_prefs: next });
    revalidateSettingsSurfaces();
    return null;
  });
}

export async function setPushEnabledAction(
  enabled: boolean,
): Promise<ActionResult<null>> {
  return safeRun("setPushEnabled", async () => {
    const user = await getAuthUser();
    if (!user) throw new Error("Unauthenticated");
    const supabase = await createClient();
    await upsertSettings(supabase, user.id, { push_enabled: enabled });
    revalidateSettingsSurfaces();
    return null;
  });
}

export async function getNotificationByIdAction(
  id: string,
): Promise<ActionResult<Notification | null>> {
  return safeRun("getById", async () => {
    const user = await getAuthUser();
    if (!user) throw new Error("Unauthenticated");
    const supabase = await createClient();
    const { data } = await supabase
      .from("notifications_inbox")
      .select("*")
      .eq("user_id", user.id)
      .eq("id", id)
      .maybeSingle();
    return (data ?? null) as Notification | null;
  });
}

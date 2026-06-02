import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";

// Freelane notification dispatcher (ported from ViralOS).
//
// Single-user app — recipient is whoever is logged in. Wrap calls in try/catch
// at the call site so a notification failure never blocks the originating
// mutation. dedup_key on the row uniques the row to one per dedup_key (silent
// no-op on collision via partial unique index from migration 0050).
//
// Priority semantics:
//   0 (default) — calm informational
//   1           — needs attention soon
//   2+          — escalated (bell paints rose)

export type NotificationInput = {
  kind: string;
  subject: string;
  body?: string;
  linkUrl?: string;
  dedupKey?: string;
  priority?: number;
};

export type Notification = {
  id: string;
  kind: string;
  subject: string;
  body: string | null;
  link_url: string | null;
  dedup_key: string | null;
  priority: number;
  read_at: string | null;
  dismissed_at: string | null;
  created_at: string;
};

export type NotificationPrefs = Record<string, { in_app?: boolean; email?: boolean }>;

async function readPrefs(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  const { data } = await supabase
    .from("notification_prefs")
    .select("prefs")
    .eq("user_id", userId)
    .maybeSingle();
  return (data?.prefs ?? {}) as NotificationPrefs;
}

export async function postNotification(input: NotificationInput): Promise<{ ok: boolean }> {
  try {
    const user = await getAuthUser();
    if (!user) return { ok: false };
    const supabase = await createClient();

    // Respect per-kind in_app preference (defaults to true if missing).
    const prefs = await readPrefs(supabase, user.id);
    const inApp = prefs[input.kind]?.in_app;
    if (inApp === false) return { ok: false };

    await supabase
      .from("notifications_inbox")
      .insert({
        user_id: user.id,
        kind: input.kind,
        subject: input.subject,
        body: input.body ?? null,
        link_url: input.linkUrl ?? null,
        dedup_key: input.dedupKey ?? null,
        priority: input.priority ?? 0,
      });
    // Unique constraint on (user_id, dedup_key) where dedup_key is not null
    // will reject duplicates silently — that's the desired dedup behaviour.
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export async function listInbox(limit = 50): Promise<Notification[]> {
  const user = await getAuthUser();
  if (!user) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("notifications_inbox")
    .select("*")
    .eq("user_id", user.id)
    .is("dismissed_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  return ((data ?? []) as Notification[]);
}

export async function listOpen(limit = 8): Promise<Notification[]> {
  const user = await getAuthUser();
  if (!user) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("notifications_inbox")
    .select("*")
    .eq("user_id", user.id)
    .is("read_at", null)
    .is("dismissed_at", null)
    .order("priority", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  return ((data ?? []) as Notification[]);
}

export async function countUnread(): Promise<number> {
  const user = await getAuthUser();
  if (!user) return 0;
  const supabase = await createClient();
  const { count } = await supabase
    .from("notifications_inbox")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .is("read_at", null)
    .is("dismissed_at", null);
  return count ?? 0;
}

export async function readNotificationPrefs(): Promise<NotificationPrefs> {
  const user = await getAuthUser();
  if (!user) return {};
  const supabase = await createClient();
  return readPrefs(supabase, user.id);
}

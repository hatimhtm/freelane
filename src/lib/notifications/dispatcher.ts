import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { sendPushToUser } from "@/lib/push/server";
import type {
  NotificationPayload,
  NotificationAnswer,
  NotificationSettings,
  PerKindPrefs,
} from "./types";
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  effectivePerKindPref,
} from "./types";

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
  payload?: NotificationPayload;
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
  payload: NotificationPayload | null;
  answer: NotificationAnswer;
};

// Legacy per-kind prefs shape backed by finance.notification_prefs (the
// older table). Kept readable for backward compat while postNotification
// migrates callers to finance.notification_settings.per_kind_prefs.
export type NotificationPrefs = Record<string, { in_app?: boolean; email?: boolean }>;

async function readLegacyPrefs(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
) {
  const { data } = await supabase
    .from("notification_prefs")
    .select("prefs")
    .eq("user_id", userId)
    .maybeSingle();
  return (data?.prefs ?? {}) as NotificationPrefs;
}

async function readSettings(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<NotificationSettings> {
  const { data } = await supabase
    .from("notification_settings")
    .select("retention_days, retention_forever, push_enabled, per_kind_prefs")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return DEFAULT_NOTIFICATION_SETTINGS;
  return {
    retention_days: data.retention_days ?? 3,
    retention_forever: data.retention_forever ?? false,
    push_enabled: data.push_enabled ?? false,
    per_kind_prefs: (data.per_kind_prefs ?? {}) as PerKindPrefs,
  };
}

export async function readNotificationSettings(): Promise<NotificationSettings> {
  const user = await getAuthUser();
  if (!user) return DEFAULT_NOTIFICATION_SETTINGS;
  const supabase = await createClient();
  const settings = await readSettings(supabase, user.id);
  // First-read-writes-defaults: if no row exists yet (settings deep-equals
  // the in-memory default), upsert a row so the retention cron — which
  // scans notification_settings — actually sees this user and runs
  // retention against them. Without this backstop, users who never open
  // Settings → Notifications would accumulate read notifications forever.
  const isUnseededDefault =
    settings === DEFAULT_NOTIFICATION_SETTINGS ||
    (settings.retention_days === DEFAULT_NOTIFICATION_SETTINGS.retention_days &&
      settings.retention_forever === DEFAULT_NOTIFICATION_SETTINGS.retention_forever &&
      settings.push_enabled === DEFAULT_NOTIFICATION_SETTINGS.push_enabled &&
      Object.keys(settings.per_kind_prefs).length === 0);
  if (isUnseededDefault) {
    // Use the .from(...) builder — fire-and-forget; a failure here is
    // harmless (next call re-tries) and must not block the page render.
    await supabase
      .from("notification_settings")
      .upsert(
        {
          user_id: user.id,
          retention_days: DEFAULT_NOTIFICATION_SETTINGS.retention_days,
          retention_forever: DEFAULT_NOTIFICATION_SETTINGS.retention_forever,
          push_enabled: DEFAULT_NOTIFICATION_SETTINGS.push_enabled,
          per_kind_prefs: {},
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id", ignoreDuplicates: true },
      );
  }
  return settings;
}

export async function postNotification(input: NotificationInput): Promise<{ ok: boolean }> {
  try {
    const user = await getAuthUser();
    if (!user) return { ok: false };
    const supabase = await createClient();

    // Resolve in-app + push gating via the shared effectivePerKindPref so
    // defaults match the UI exactly. Canonical source is
    // notification_settings.per_kind_prefs; the legacy notification_prefs
    // table stays as a fallback so already-shipped Tuesday toggles keep
    // working without a forced migration.
    const [settings, legacy] = await Promise.all([
      readSettings(supabase, user.id),
      readLegacyPrefs(supabase, user.id),
    ]);
    const effective = effectivePerKindPref(
      settings.per_kind_prefs,
      legacy,
      input.kind,
    );

    if (!effective.in_app) return { ok: false };

    const { data: inserted } = await supabase
      .from("notifications_inbox")
      .insert({
        user_id: user.id,
        kind: input.kind,
        subject: input.subject,
        body: input.body ?? null,
        link_url: input.linkUrl ?? null,
        dedup_key: input.dedupKey ?? null,
        priority: input.priority ?? 0,
        payload: (input.payload ?? null) as unknown as Record<string, unknown> | null,
      })
      .select("id, subject, body, link_url")
      .maybeSingle();
    // Unique constraint on (user_id, dedup_key) where dedup_key is not null
    // will reject duplicates silently — inserted will be null in that case.

    if (inserted && settings.push_enabled && effective.push) {
      // Fire-and-forget push send. A failure here MUST NOT block the
      // dispatcher result — the inbox row is the canonical delivery.
      // sound=false flips `silent: true` on the push payload so the
      // service worker can suppress the OS alert sound.
      try {
        await sendPushToUser(user.id, {
          id: inserted.id as string,
          subject: inserted.subject as string,
          body: (inserted.body as string | null) ?? null,
          link_url: (inserted.link_url as string | null) ?? null,
          silent: !effective.sound,
        });
      } catch (err) {
        // Push best-effort — log so server logs surface delivery failures
        // (expired subscriptions, VAPID misconfig, network errors).
        // eslint-disable-next-line no-console
        console.error(
          "[freelane-notif] push send failed",
          { kind: input.kind, userId: user.id },
          err,
        );
      }
    }

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

// Recently-read rows, for the [Read] tab in the bell popover and the
// /notifications route. Excludes dismissed so the Read tab doesn't grow
// noisy with rows the user actively swiped away.
export async function listReadRecent(limit = 8): Promise<Notification[]> {
  const user = await getAuthUser();
  if (!user) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("notifications_inbox")
    .select("*")
    .eq("user_id", user.id)
    .not("read_at", "is", null)
    .is("dismissed_at", null)
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
  return readLegacyPrefs(supabase, user.id);
}

// Count notifications of a given kind in a trailing-window. Used by the
// vendor_identify_request 5/hour cap (Spendings workflow). The supporting
// index notifications_inbox_user_kind_created_idx ships in migration 0083
// so this read is index-only.
export async function countNotificationsInWindow(
  kind: string,
  windowMs: number,
): Promise<number> {
  const user = await getAuthUser();
  if (!user) return 0;
  const supabase = await createClient();
  const since = new Date(Date.now() - windowMs).toISOString();
  const { count } = await supabase
    .from("notifications_inbox")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("kind", kind)
    .gte("created_at", since);
  return count ?? 0;
}

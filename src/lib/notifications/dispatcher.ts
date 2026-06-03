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
  // Migration 0090 — optional scheduled delivery time (ISO).
  // When set, the row is inserted now (so dedup uniqueness is recorded
  // and the +14d satisfaction-check semantics can't accidentally
  // double-emit), but listInbox / listOpen / countUnread filter it out
  // until deliver_at <= now(). Push is also suppressed until the
  // satisfaction sweep flips it visible.
  deliverAt?: string;
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
  // Migration 0090 — optional scheduled visibility timestamp.
  deliver_at: string | null;
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

// Result shape: `ok` stays true when the dispatcher accepted the request,
// `inserted` is true only when a new row actually landed in
// notifications_inbox. The (user_id, dedup_key) partial unique index
// silently rejects duplicates; without surfacing that, callers (the
// vendor_clarify kickoff + backfill) bump per-vendor debounce stamps
// for deliveries that never happened. Backward-compatible: existing
// `.ok`-only callers keep working.
export async function postNotification(
  input: NotificationInput,
): Promise<{ ok: boolean; inserted: boolean }> {
  try {
    const user = await getAuthUser();
    if (!user) return { ok: false, inserted: false };
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

    if (!effective.in_app) return { ok: false, inserted: false };

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
        // null deliver_at means deliver-now and matches every row written
        // before migration 0090 — the listInbox / listOpen filters treat
        // null as "ready". Scheduled rows (plan_satisfaction_check)
        // populate this with the future timestamp.
        deliver_at: input.deliverAt ?? null,
      })
      .select("id, subject, body, link_url, deliver_at")
      .maybeSingle();
    // Unique constraint on (user_id, dedup_key) where dedup_key is not null
    // will reject duplicates silently — inserted will be null in that case.

    // Scheduled rows do NOT fire push immediately — the satisfaction-check
    // sweep flips them via runPlanNotificationsSweep at deliver time.
    const isScheduled =
      !!input.deliverAt && new Date(input.deliverAt).getTime() > Date.now();

    if (inserted && !isScheduled && settings.push_enabled && effective.push) {
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

    // dedup_key collision returns null inserted — the row already
    // existed under the same (user_id, dedup_key). ok stays true (the
    // dispatcher itself didn't fail) but inserted=false signals to
    // callers that no NEW notification reached the user, so any
    // "stamp debounce on successful delivery" logic skips this round.
    return { ok: true, inserted: !!inserted };
  } catch {
    return { ok: false, inserted: false };
  }
}

// Migration 0090 — readers gate on deliver_at. Scheduled rows (the +14d
// plan_satisfaction_check) stay out of the bell until the sweep flips
// them visible. NULL deliver_at means deliver-now (every legacy row).
const DELIVER_AT_VISIBLE = "deliver_at.is.null,deliver_at.lte.";

function deliverAtFilter(): string {
  return `${DELIVER_AT_VISIBLE}${new Date().toISOString()}`;
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
    .or(deliverAtFilter())
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
    .or(deliverAtFilter())
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
    .or(deliverAtFilter())
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
    .is("dismissed_at", null)
    .or(deliverAtFilter());
  return count ?? 0;
}

export async function readNotificationPrefs(): Promise<NotificationPrefs> {
  const user = await getAuthUser();
  if (!user) return {};
  const supabase = await createClient();
  return readLegacyPrefs(supabase, user.id);
}

// ─────────────────────────── Plans workflow sweep (0088-0089) ──
//
// Idempotent daily sweep producing plan_target_approaching (30d window)
// and plan_strategy_stale (active strategy underperforming). Designed
// to be called from a daily cron — the per-row dedup keys keep dupes
// out so calling it twice in a day is a no-op.
//
// The sweep runs PER USER. Callers iterating users (Vercel cron pattern)
// invoke runPlanNotificationsSweep() inside the per-user loop after
// authenticating as that user (which is how postNotification reads
// auth.uid()). For now, the public entry point sweeps the currently
// authenticated user only — matches the rest of the dispatcher.

const DAY_MS = 86_400_000;

export async function runPlanNotificationsSweep(): Promise<{
  targetEmitted: number;
  staleEmitted: number;
  satisfactionPushed: number;
}> {
  const user = await getAuthUser();
  if (!user) return { targetEmitted: 0, staleEmitted: 0, satisfactionPushed: 0 };
  const supabase = await createClient();
  const now = new Date();

  let targetEmitted = 0;
  let staleEmitted = 0;
  let satisfactionPushed = 0;

  // plan_satisfaction_check — scheduled at confirmPlanBought time with
  // deliver_at = bought_at + 14d. The inbox reader filters by
  // deliver_at, so visibility is already correct. This sweep is the
  // PUSH side: rows whose deliver_at <= now() and that haven't fired
  // push yet need to send a notification. We mark them with a
  // payload.push_sent_at flag so re-runs of the sweep don't double-push.
  try {
    const { data: due } = await supabase
      .from("notifications_inbox")
      .select("id, subject, body, link_url, payload")
      .eq("user_id", user.id)
      .eq("kind", "plan_satisfaction_check")
      .is("read_at", null)
      .is("dismissed_at", null)
      .not("deliver_at", "is", null)
      .lte("deliver_at", now.toISOString());
    const settings = await readSettings(supabase, user.id);
    const legacy = await readLegacyPrefs(supabase, user.id);
    const effective = effectivePerKindPref(
      settings.per_kind_prefs,
      legacy,
      "plan_satisfaction_check",
    );
    if (settings.push_enabled && effective.push) {
      for (const row of due ?? []) {
        const payload = (row.payload as Record<string, unknown> | null) ?? {};
        if (payload.push_sent_at) continue;
        try {
          await sendPushToUser(user.id, {
            id: row.id as string,
            subject: row.subject as string,
            body: (row.body as string | null) ?? null,
            link_url: (row.link_url as string | null) ?? null,
            silent: !effective.sound,
          });
          await supabase
            .from("notifications_inbox")
            .update({
              payload: { ...payload, push_sent_at: now.toISOString() },
            })
            .eq("id", row.id as string)
            .eq("user_id", user.id);
          satisfactionPushed += 1;
        } catch {
          // Best-effort.
        }
      }
    }
  } catch {
    // Best-effort.
  }

  // plan_target_approaching — fires when target_date - 30d ≤ today and
  // not already sent for this plan. The dedup_key uniques to plan_id so
  // multiple sweeps in the same window stay idempotent.
  try {
    const { data: targets } = await supabase
      .from("planned_spends")
      .select("id,label,target_date,status")
      .eq("user_id", user.id)
      .in("status", ["active", "planned"])
      .not("target_date", "is", null);
    for (const p of targets ?? []) {
      const td = p.target_date as string | null;
      if (!td) continue;
      const target = new Date(td);
      const diffDays = (target.getTime() - now.getTime()) / DAY_MS;
      if (diffDays <= 30 && diffDays >= 0) {
        const res = await postNotification({
          kind: "plan_target_approaching",
          subject: `Target nearing — ${p.label}`,
          body: `Target date in ${Math.max(0, Math.round(diffDays))} days.`,
          dedupKey: `plan_target_approaching:${p.id}`,
          linkUrl: `/plans?focus=${p.id}`,
          payload: { kind_specific: { plan_id: p.id as string } },
        });
        if (res.ok) targetEmitted += 1;
      }
    }
  } catch {
    // Best-effort.
  }

  // plan_strategy_stale — fires for active strategies whose
  // monthly_save_estimate has been missed for N cycles. We approximate
  // "missed" by comparing the user's last-30d spend against a baseline.
  // For v1, surface staleness only when the strategy has been active
  // for > 60 days without an associated plan-side win (no bought_at on
  // its plan). Lower precision today; tighter heuristic when we have
  // more telemetry.
  try {
    const { data: actives } = await supabase
      .from("plan_strategies")
      .select("id,plan_id,activated_at,title,monthly_save_estimate")
      .eq("user_id", user.id)
      .eq("active", true);
    for (const s of actives ?? []) {
      if (!s.activated_at) continue;
      const daysActive = (now.getTime() - new Date(s.activated_at as string).getTime()) / DAY_MS;
      if (daysActive < 60) continue;
      const { data: plan } = await supabase
        .from("planned_spends")
        .select("status")
        .eq("id", s.plan_id as string)
        .maybeSingle();
      if (plan?.status === "bought" || plan?.status === "done") continue;
      const res = await postNotification({
        kind: "plan_strategy_stale",
        subject: `Strategy off-track — ${s.title}`,
        body: "It has been active for over two months without landing the plan.",
        dedupKey: `plan_strategy_stale:${s.id}:${Math.floor(daysActive / 30)}`,
        linkUrl: `/plans?focus=${s.plan_id}`,
        payload: { kind_specific: { plan_id: s.plan_id as string, strategy_id: s.id as string } },
      });
      if (res.ok) staleEmitted += 1;
    }
  } catch {
    // Best-effort.
  }

  return { targetEmitted, staleEmitted, satisfactionPushed };
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

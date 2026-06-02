import "server-only";

import webpush from "web-push";
import { createServiceClient } from "@/lib/supabase/service";

// Server-side Web Push sender. Loads all push_subscriptions for the user
// via service-role (cross-user safe because we filter by user_id on every
// query), sends the payload, and prunes dead endpoints (404/410). One
// VAPID config per process lifetime — configured the first time send is
// called rather than at module load so missing env in dev doesn't crash
// the whole bundle.

export type PushPayload = {
  id: string;
  subject: string;
  body?: string | null;
  link_url?: string | null;
  // When true the service worker is asked to show the notification without
  // playing the OS alert sound (mirrors the Notification API's `silent`
  // option). Honors the per-kind sound preference.
  silent?: boolean;
};

type PushSubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

let vapidConfigured = false;

function configureVapidOnce(): boolean {
  if (vapidConfigured) return true;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:freelane@example.com";
  if (!publicKey || !privateKey) {
    // Push not configured for this environment — silent skip is fine; the
    // dispatcher already treats push failure as best-effort.
    return false;
  }
  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    vapidConfigured = true;
    return true;
  } catch {
    return false;
  }
}

export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
): Promise<{ sent: number; pruned: number }> {
  if (!configureVapidOnce()) return { sent: 0, pruned: 0 };

  const supabase = createServiceClient();
  const { data: subs } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", userId);

  const subscriptions = (subs ?? []) as PushSubscriptionRow[];
  if (subscriptions.length === 0) return { sent: 0, pruned: 0 };

  const json = JSON.stringify(payload);
  let sent = 0;
  let pruned = 0;
  const deadIds: string[] = [];

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          json,
        );
        sent += 1;
      } catch (err: unknown) {
        const code = (err as { statusCode?: number } | null)?.statusCode;
        if (code === 404 || code === 410) {
          deadIds.push(sub.id);
        }
        // Other errors (network, 5xx) — leave the subscription alone, it
        // may recover next dispatch.
      }
    }),
  );

  if (deadIds.length > 0) {
    await supabase.from("push_subscriptions").delete().in("id", deadIds);
    pruned = deadIds.length;
  }

  // Bump last_used_at on successful sends so a future cleanup pass can
  // tell working endpoints from stale ones.
  if (sent > 0) {
    await supabase
      .from("push_subscriptions")
      .update({ last_used_at: new Date().toISOString() })
      .eq("user_id", userId);
  }

  return { sent, pruned };
}

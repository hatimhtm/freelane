import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";

// POST /api/push/subscribe
// Body: { endpoint: string, keys: { p256dh: string, auth: string }, userAgent?: string }
// Persists the browser's PushSubscription so the server-side sender can
// later push notifications to this device. Idempotent via the (endpoint)
// unique constraint — re-subscribing from the same browser bumps the row
// rather than creating a duplicate.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Body = {
  endpoint?: string;
  keys?: { p256dh?: string; auth?: string };
  userAgent?: string;
};

export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Unauthenticated" },
      { status: 401 },
    );
  }
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }
  const endpoint = body.endpoint?.trim();
  const p256dh = body.keys?.p256dh?.trim();
  const auth = body.keys?.auth?.trim();
  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json(
      { ok: false, error: "Missing endpoint or keys" },
      { status: 400 },
    );
  }
  try {
    const supabase = await createClient();
    await supabase
      .from("push_subscriptions")
      .upsert(
        {
          user_id: user.id,
          endpoint,
          p256dh,
          auth,
          user_agent: body.userAgent ?? null,
        },
        { onConflict: "endpoint" },
      );
    return NextResponse.json({ ok: true, data: null });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to subscribe";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

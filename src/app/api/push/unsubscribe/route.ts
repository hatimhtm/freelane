import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";

// POST /api/push/unsubscribe
// Body: { endpoint: string }
// Removes the subscription for this device. The browser is expected to
// also call PushSubscription.unsubscribe() locally — the server-side row
// removal is the canonical state, so sending to the endpoint stops even if
// the local unsubscribe call fails.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Body = { endpoint?: string };

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
  if (!endpoint) {
    return NextResponse.json(
      { ok: false, error: "Missing endpoint" },
      { status: 400 },
    );
  }
  try {
    const supabase = await createClient();
    await supabase
      .from("push_subscriptions")
      .delete()
      .eq("user_id", user.id)
      .eq("endpoint", endpoint);
    return NextResponse.json({ ok: true, data: null });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to unsubscribe";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

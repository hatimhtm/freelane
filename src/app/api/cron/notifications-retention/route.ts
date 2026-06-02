import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

// GET /api/cron/notifications-retention
//
// Daily cron — hard-deletes READ notifications older than each user's
// retention_days setting. Unread rows are NEVER deleted, regardless of
// age. The actual sweep is encoded in the SQL function
// finance.run_notifications_retention() (migration 0060) so the whole
// job runs in ONE round trip and scales past a per-user delete loop.
//
// Users without a notification_settings row are handled in the SQL via a
// LEFT JOIN against auth.users with a default of 3 days — see migration
// 0060.
//
// Auth: requires Authorization: Bearer ${CRON_SECRET} OR a Vercel cron
// request (x-vercel-cron header). The route is in PUBLIC_PATHS in
// middleware.ts so cron invocations without session cookies reach this
// handler — the auth check below is the only gate.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization") ?? "";
  const vercelCron = req.headers.get("x-vercel-cron");
  const bearerOk =
    !!cronSecret && authHeader === `Bearer ${cronSecret}`;
  const vercelOk = !!vercelCron;
  if (!bearerOk && !vercelOk) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  try {
    const supabase = createServiceClient();
    // The service client is already pinned to db.schema = "finance" (see
    // lib/supabase/service.ts), so an unqualified rpc("run_notifications_retention")
    // would resolve correctly today. We explicitly re-pin via .schema("finance")
    // here so the resolution chain is visible at the call site — this cron
    // is the kind of long-tail path that silently rots if a future
    // PostgREST or supabase-js release tightens schema resolution.
    const { data, error } = await supabase
      .schema("finance")
      .rpc("run_notifications_retention");
    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 },
      );
    }
    const deleted = typeof data === "number" ? data : 0;
    return NextResponse.json({ ok: true, deleted });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Retention cron failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

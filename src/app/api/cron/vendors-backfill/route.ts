import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { runVendorBackfillBatch } from "@/lib/vendors/backfill";

// GET /api/cron/vendors-backfill
//
// Daily pass over the canonicalize-vendor backfill workflow. For every
// user with an open finance.vendor_backfill_progress row (finished_at IS
// NULL), advance one batch via runVendorBackfillBatch. The orchestrator:
//   • runs the Pro canonicalize-vendor brain on each candidate vendor
//   • persists confidence + canonical_name (when confident enough) +
//     brand_key
//   • queues a vendor_clarify notification per vendor, capped at 5/day
//     per user (the rest queue silently for tomorrow)
//   • advances the cursor + processed counter
//   • flips finished_at when the user's pool is exhausted
//
// Schedule (vercel.json): "0 19 * * *" → 19:00 UTC = 03:00 PHT — runs
// AFTER reconcile (01:00 PHT) + sadaka-daily (01:30 PHT) so vendor
// reads see settled state.
//
// Idempotent: cursor + finished_at make repeated invocations safe. A
// half-finished pass resumes; a finished pass returns done=true
// immediately.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization") ?? "";
  const vercelCron = req.headers.get("x-vercel-cron");
  const bearerOk = !!cronSecret && authHeader === `Bearer ${cronSecret}`;
  const vercelOk = !!vercelCron;
  if (!bearerOk && !vercelOk) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  try {
    const supabase = createServiceClient();

    // Two paths to "needs a batch run":
    //   1. An open progress row already exists (finished_at IS NULL).
    //   2. A user has vendors flagged for backfill but no progress row
    //      yet — first pass will INSERT one and start from the head.
    //
    // Step 1: every user with an open progress row gets a batch (the
    // orchestrator handles the resume-from-cursor). This is the cheap
    // path — vendor_backfill_progress has one row per user.
    const openProgress = await supabase
      .from("vendor_backfill_progress")
      .select("user_id")
      .is("finished_at", null);
    if (openProgress.error) {
      return NextResponse.json(
        { ok: false, error: openProgress.error.message },
        { status: 500 },
      );
    }
    const progressUserIds = new Set(
      (openProgress.data ?? [])
        .map((r) => (r as { user_id: string | null }).user_id)
        .filter((v): v is string => typeof v === "string" && v.length > 0),
    );

    // Step 2: discover NEW users (no progress row yet) by sampling
    // vendors. Bounded by the per-run user cap so a daily scan can't
    // accidentally turn into a full-table read on finance.vendors as
    // the user base grows. New users not seen in this scan will be
    // picked up tomorrow — once a progress row exists for them, step 1
    // covers them forever.
    const PER_RUN_USER_CAP = 200;
    const NEW_USER_SAMPLE_LIMIT = 2_000;
    const { data: candidates, error: candErr } = await supabase
      .from("vendors")
      .select("user_id")
      .or("needs_identification.eq.true,canonical_name.is.null,confidence.is.null")
      .limit(NEW_USER_SAMPLE_LIMIT);
    if (candErr) {
      return NextResponse.json(
        { ok: false, error: candErr.message },
        { status: 500 },
      );
    }
    const newUserIds = new Set<string>();
    for (const r of candidates ?? []) {
      const uid = (r as { user_id: string | null }).user_id;
      if (typeof uid !== "string" || uid.length === 0) continue;
      if (progressUserIds.has(uid)) continue;
      newUserIds.add(uid);
    }
    const userIds = [
      ...progressUserIds,
      ...newUserIds,
    ].slice(0, PER_RUN_USER_CAP);

    let succeeded = 0;
    let totalProcessed = 0;
    let totalQueued = 0;
    const failures: Array<{ userId: string; message: string }> = [];

    for (const userId of userIds) {
      try {
        const result = await runVendorBackfillBatch(supabase, userId);
        succeeded += 1;
        totalProcessed += result.processed;
        totalQueued += result.notificationsQueued;
      } catch (e) {
        failures.push({
          userId,
          message: e instanceof Error ? e.message : "backfill threw",
        });
      }
    }

    return NextResponse.json({
      ok: true,
      users: userIds.length,
      succeeded,
      processed: totalProcessed,
      notificationsQueued: totalQueued,
      failed: failures.length,
      failures,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Vendors backfill cron failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

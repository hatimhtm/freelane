import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { runEntityBackfillBatch } from "@/lib/entities/backfill";

// GET /api/cron/entities-backfill
//
// Daily pass over the canonicalize-entity backfill workflow. Mirrors
// the vendors-backfill cron route shape exactly — see
// src/app/api/cron/vendors-backfill/route.ts for the long-form
// explanation. Picks up users with an open entity_backfill_progress row
// AND new users discovered via finance.entities rows whose confidence /
// relationship are still NULL.

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

    const openProgress = await supabase
      .from("entity_backfill_progress")
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

    const PER_RUN_USER_CAP = 200;
    const NEW_USER_SAMPLE_LIMIT = 2_000;
    const { data: candidates, error: candErr } = await supabase
      .from("entities")
      .select("user_id")
      .or("confidence.is.null,relationship.is.null")
      .eq("archived", false)
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
        const result = await runEntityBackfillBatch(supabase, userId);
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
      err instanceof Error ? err.message : "Entities backfill cron failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

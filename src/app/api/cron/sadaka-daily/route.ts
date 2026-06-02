import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { runDailyDecay } from "@/lib/sadaka/decay";
import { maybeFireSadakaNudge } from "@/lib/sadaka/nudge-dispatcher";

// GET /api/cron/sadaka-daily
//
// Daily pass over the sadaka workflow. For each user with a sadaka_config
// row (every signed-up user, after migration 0071's backfill trigger):
//   1. runDailyDecay → writes a decay ledger row (idempotent per PHT day).
//   2. maybeFireSadakaNudge → posts a sadaka_nudge notification when the
//      pool is sizeable, the user has been silent ≥ nudge_silence_days, and
//      the brain's surface_today flag is true.
//
// Auth: shares the existing CRON_SECRET / x-vercel-cron pattern.
//
// Schedule (suggested in vercel.json): "30 17 * * *" → 01:30 PHT, AFTER the
// reconcile pass at 01:00 PHT lands its unaccounted_outflow rows so the
// pool reading already reflects the latest source-table truth.

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
    const { data: cfgRows, error: cfgErr } = await supabase
      .from("sadaka_config")
      .select("user_id");
    if (cfgErr) {
      return NextResponse.json(
        { ok: false, error: cfgErr.message },
        { status: 500 },
      );
    }
    const userIds = Array.from(
      new Set(
        (cfgRows ?? [])
          .map((r) => (r as { user_id: string | null }).user_id)
          .filter((v): v is string => typeof v === "string" && v.length > 0),
      ),
    );

    let decaySucceeded = 0;
    let nudgeSucceeded = 0;
    const failures: Array<{
      userId: string;
      step: "decay" | "nudge";
      message: string;
    }> = [];

    for (const userId of userIds) {
      try {
        const decay = await runDailyDecay(userId);
        if (decay.ok) decaySucceeded += 1;
        else failures.push({ userId, step: "decay", message: "decay failed" });
      } catch (e) {
        failures.push({
          userId,
          step: "decay",
          message: e instanceof Error ? e.message : "decay threw",
        });
      }
      try {
        const nudge = await maybeFireSadakaNudge(userId);
        if (nudge.ok) nudgeSucceeded += 1;
        else failures.push({ userId, step: "nudge", message: "nudge failed" });
      } catch (e) {
        failures.push({
          userId,
          step: "nudge",
          message: e instanceof Error ? e.message : "nudge threw",
        });
      }
    }

    return NextResponse.json({
      ok: true,
      users: userIds.length,
      decaySucceeded,
      nudgeSucceeded,
      failed: failures.length,
      failures,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Sadaka daily cron failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

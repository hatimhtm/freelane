import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

// GET /api/cron/reconcile
//
// Nightly reconciliation pass — iterates every user that owns a holding
// wallet and invokes finance.reconcile_user_wallets(p_user_id, 50). The DB
// function (migration 0070) compares source-table truth (payments + spends
// + withdrawals since the wallet's anchor) against the running sum of
// money_ledger rows for that wallet. When the gap exceeds the threshold
// (50 base) it appends an 'unaccounted_outflow' row so the ledger sum
// re-aligns with reality and the dashboard's drift banner has something
// to latch onto.
//
// Schedule (in vercel.json): "0 17 * * *" → 17:00 UTC = 01:00 PHT, after
// the day's spends have settled and before the user wakes up to look at
// the dashboard.
//
// Why iterate per-user instead of one global call: the DB function takes a
// user_id and its security model is per-user. The "list users with holding
// wallets" query stays cheap because payment_methods is small.
//
// Auth: requires Authorization: Bearer ${CRON_SECRET} OR a Vercel cron
// request (x-vercel-cron header). The route is in PUBLIC_PATHS in
// lib/supabase/middleware.ts so cron invocations without session cookies
// reach this handler — the auth check below is the only gate.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Gap threshold below which we don't append a correction row. Matches the
// default in finance.reconcile_user_wallets (migration 0070) so the cron's
// behaviour is identical to a manual ad-hoc call from the SQL editor.
const RECONCILE_THRESHOLD_BASE = 50;

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

    // Distinct user_id list across holding wallets only — non-holding rails
    // never have a balance to drift, so reconciling them is wasted budget.
    const { data: holders, error: holdersErr } = await supabase
      .from("payment_methods")
      .select("user_id")
      .eq("is_holding", true);
    if (holdersErr) {
      return NextResponse.json(
        { ok: false, error: holdersErr.message },
        { status: 500 },
      );
    }

    const userIds = Array.from(
      new Set(
        (holders ?? [])
          .map((r) => (r as { user_id: string | null }).user_id)
          .filter((v): v is string => typeof v === "string" && v.length > 0),
      ),
    );

    let succeeded = 0;
    const failures: Array<{ userId: string; message: string }> = [];

    for (const userId of userIds) {
      // Explicitly re-pin to the finance schema (matching the pattern in
      // notifications-retention) so the resolution chain is visible at the
      // call site — this cron is exactly the long-tail path that rots
      // silently if a future PostgREST or supabase-js release tightens
      // schema resolution.
      const { error } = await supabase
        .schema("finance")
        .rpc("reconcile_user_wallets", {
          p_user_id: userId,
          p_threshold_base: RECONCILE_THRESHOLD_BASE,
        });
      if (error) {
        failures.push({ userId, message: error.message });
        continue;
      }
      succeeded += 1;
    }

    return NextResponse.json({
      ok: true,
      users: userIds.length,
      succeeded,
      failed: failures.length,
      // Only echo failure messages — succeeded ids carry no debugging value
      // and would bloat the response on a wide user base.
      failures,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Reconcile cron failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

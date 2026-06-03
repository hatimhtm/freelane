import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { tryAutoGenerateLetterForUser } from "@/lib/ai/letters-auto-trigger";
import { periodKeyFor } from "@/lib/ai/editorial-letter";

// GET /api/cron/letters-time-keyed
//
// Time-keyed Tier 3 letters cron. Routes the SUNDAY (weekly) and the
// END_OF_MONTH (calendar) auto-trigger paths through the worth-saying
// gate so the scheduler shares the same quality bar as the receipt-
// driven Tier 3 triggers in data/actions.ts.
//
// Before this route existed, the gate wiring at the top of
// letters-auto-trigger.ts referenced "2 time-keyed paths routed via
// refreshLetterAction({ autoTriggered: true })" but nothing in the
// codebase actually called it that way. Both paths were dead code.
//
// Scheduling rules (PHT-anchored, evaluated server-side):
//   - sunday        → fires when the PHT day-of-week is Sunday
//   - end_of_month  → fires when the PHT day is the LAST day of the month
//
// Auth: shares the existing CRON_SECRET / x-vercel-cron pattern. Cron
// runs daily; the kind selector inside the handler decides whether
// today's PHT date qualifies for either trigger (or both, or neither).

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// PHT helpers — copy the small helpers locally instead of importing the
// auth-scoped queries module. The cron carries no request auth so it
// can't hit anything that calls getAuthUser.
const PHT_OFFSET_MS = 8 * 60 * 60 * 1000;
function phtDate(now = new Date()): Date {
  return new Date(now.getTime() + PHT_OFFSET_MS);
}
function phtIsSunday(now = new Date()): boolean {
  // Date.getUTCDay() against a shifted Date == PHT day-of-week.
  return phtDate(now).getUTCDay() === 0;
}
function phtIsEndOfMonth(now = new Date()): boolean {
  const today = phtDate(now);
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  // If tomorrow's month is different from today's month, today is the
  // last day of the current PHT month.
  return tomorrow.getUTCMonth() !== today.getUTCMonth();
}

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

  const now = new Date();
  const fireSunday = phtIsSunday(now);
  const fireEndOfMonth = phtIsEndOfMonth(now);

  if (!fireSunday && !fireEndOfMonth) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "Not a Sunday-PHT or end-of-month-PHT day.",
    });
  }

  try {
    const supabase = createServiceClient();
    // Iterate every user with a settings row — the same broad cohort
    // the other Tier 3 / 4 / 5 crons use. settings.user_id is the
    // authoritative "active account" surface (every signed-up user has
    // one via the welcome migration).
    const { data: settingsRows, error: settingsErr } = await supabase
      .from("settings")
      .select("user_id");
    if (settingsErr) {
      return NextResponse.json(
        { ok: false, error: settingsErr.message },
        { status: 500 },
      );
    }
    const userIds = Array.from(
      new Set(
        (settingsRows ?? [])
          .map((r) => (r as { user_id: string | null }).user_id)
          .filter((v): v is string => typeof v === "string" && v.length > 0),
      ),
    );

    let sundayFired = 0;
    let endOfMonthFired = 0;
    let skipped = 0;
    const failures: Array<{
      userId: string;
      kind: "sunday" | "end_of_month";
      message: string;
    }> = [];

    for (const userId of userIds) {
      if (fireSunday) {
        try {
          const res = await tryAutoGenerateLetterForUser(userId, {
            triggerKind: "sunday",
            letterKind: "sunday",
            triggerPayload: { auto: true, source: "cron-time-keyed" },
            periodKey: periodKeyFor("sunday"),
          });
          if (res.proceeded) sundayFired += 1;
          else skipped += 1;
        } catch (e) {
          failures.push({
            userId,
            kind: "sunday",
            message: e instanceof Error ? e.message : "sunday threw",
          });
        }
      }
      if (fireEndOfMonth) {
        try {
          const res = await tryAutoGenerateLetterForUser(userId, {
            triggerKind: "end_of_month",
            letterKind: "end_of_month",
            triggerPayload: { auto: true, source: "cron-time-keyed" },
            periodKey: periodKeyFor("end_of_month"),
          });
          if (res.proceeded) endOfMonthFired += 1;
          else skipped += 1;
        } catch (e) {
          failures.push({
            userId,
            kind: "end_of_month",
            message: e instanceof Error ? e.message : "end_of_month threw",
          });
        }
      }
    }

    return NextResponse.json({
      ok: true,
      users: userIds.length,
      fireSunday,
      fireEndOfMonth,
      sundayFired,
      endOfMonthFired,
      skipped,
      failed: failures.length,
      failures,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Letters time-keyed cron failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

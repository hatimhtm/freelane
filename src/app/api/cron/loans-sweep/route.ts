import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sendPushToUser } from "@/lib/push/server";

// GET /api/cron/loans-sweep
//
// Daily PHT-morning cron over every open / partially-returned loan.
// For each loan:
//   - if due_date == PHT today + 3 days  → fire loan_due_soon
//   - if due_date <  PHT today           → fire loan_overdue
//
// dedup_key keys off (loan_id, PHT date) so re-runs of the same cron
// in the same PHT day silently no-op via the partial unique index on
// notifications_inbox(dedup_key).
//
// Why direct INSERTs (vs postNotification): postNotification reads
// auth.uid() to scope the row. The cron carries no request auth, so
// we use the service client + manual per-user prefs check, mirroring
// /api/cron/surface-question.
//
// Delivery: per-user notification_settings is loaded once (single-flight
// cache keyed by user_id across the loan loop). For each loan row we
// gate on per_kind_prefs[kind].in_app before the inbox insert, then call
// sendPushToUser when push_enabled + per_kind_prefs[kind].push allow it.
// Push is fire-and-forget — a failure must not block the next loan row.
//
// Auth: requires Bearer ${CRON_SECRET} OR a Vercel cron header. The
// /api/cron prefix is allow-listed in middleware.ts so cron invocations
// without session cookies reach this handler.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// PHT helpers — local copy so the cron stays auth-free.
const PHT_OFFSET_MS = 8 * 60 * 60 * 1000;
function phtDateString(now = new Date()): string {
  const shifted = new Date(now.getTime() + PHT_OFFSET_MS);
  return shifted.toISOString().slice(0, 10);
}

function addDaysPht(today: string, days: number): string {
  const [y, m, d] = today.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

const OPEN_STATUSES = ["open", "partial", "partially_returned"] as const;

type LoanRow = {
  id: string;
  user_id: string;
  due_date: string | null;
  status: string;
  counterparty_entity_id: string | null;
};

type PerKindPrefs = Record<
  string,
  { in_app?: boolean; push?: boolean; sound?: boolean } | undefined
>;

type UserPrefs = {
  push_enabled: boolean;
  per_kind_prefs: PerKindPrefs;
};

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
    const today = phtDateString();
    const dueSoonAnchor = addDaysPht(today, 3);

    const { data: loanRows, error: loanErr } = await supabase
      .from("loans")
      .select("id, user_id, due_date, status, counterparty_entity_id")
      .in("status", OPEN_STATUSES as unknown as string[])
      .not("due_date", "is", null);
    if (loanErr) {
      return NextResponse.json(
        { ok: false, error: loanErr.message },
        { status: 500 },
      );
    }

    // Single-flight cache so we hit notification_settings once per user
    // even when a user has many overdue loans in the same sweep.
    const prefsByUser = new Map<string, UserPrefs>();
    async function loadPrefs(userId: string): Promise<UserPrefs> {
      const cached = prefsByUser.get(userId);
      if (cached) return cached;
      const { data } = await supabase
        .from("notification_settings")
        .select("push_enabled, per_kind_prefs")
        .eq("user_id", userId)
        .maybeSingle();
      const prefs: UserPrefs = {
        push_enabled: !!data?.push_enabled,
        per_kind_prefs: (data?.per_kind_prefs ?? {}) as PerKindPrefs,
      };
      prefsByUser.set(userId, prefs);
      return prefs;
    }

    let dueSoonEmitted = 0;
    let overdueEmitted = 0;
    let pushAttempted = 0;
    let pushSkipped = 0;
    let prefsGated = 0;
    const failures: Array<{ userId: string; loanId: string; message: string }> = [];

    for (const row of (loanRows ?? []) as LoanRow[]) {
      try {
        if (!row.due_date) continue;
        // Window-based due-soon detection — any loan whose due_date is
        // within today..today+3 (inclusive) and not yet overdue. Strict
        // equality on dueSoonAnchor silently swallowed loans 2 or 4 days
        // out, and a single missed cron day (or timing slipping around
        // midnight UTC) would bury the due_soon notification forever for
        // that loan. dedup_key already keys off (kind, loan_id, today),
        // so repeated runs across the window stay idempotent per day.
        const isOverdue = row.due_date < today;
        const isDueSoon =
          !isOverdue &&
          row.due_date >= today &&
          row.due_date <= dueSoonAnchor;
        if (!isDueSoon && !isOverdue) continue;

        const kind = isOverdue ? "loan_overdue" : "loan_due_soon";
        const subject = isOverdue ? "Loan overdue" : "Loan due soon";
        const dedupKey = `${kind}:${row.id}:${today}`;

        // Per-kind in-app gate. Defaults to TRUE on missing key — same
        // convention as effectivePerKindPref in lib/notifications/types.
        const prefs = await loadPrefs(row.user_id);
        const kindPref = prefs.per_kind_prefs[kind] ?? {};
        if (kindPref.in_app === false) {
          prefsGated += 1;
          continue;
        }

        const payload = isOverdue
          ? {
              kind_specific: {
                loan_id: row.id,
                days_overdue: Math.max(
                  1,
                  Math.round(
                    (Date.parse(today) - Date.parse(row.due_date)) /
                      (24 * 60 * 60 * 1000),
                  ),
                ),
              },
            }
          : {
              kind_specific: {
                loan_id: row.id,
                days_remaining: 3,
              },
            };

        const linkUrl = `/spending?loans=1&loan_id=${row.id}`;
        const { data: inserted, error: insertErr } = await supabase
          .from("notifications_inbox")
          .insert({
            user_id: row.user_id,
            kind,
            subject,
            body: null,
            link_url: linkUrl,
            dedup_key: dedupKey,
            priority: isOverdue ? 1 : 0,
            payload,
          })
          .select("id")
          .maybeSingle();
        if (insertErr) {
          const code = (insertErr as { code?: string }).code;
          // 23505 is the partial unique on (user_id, dedup_key) firing —
          // a previous sweep already delivered this notification today.
          // Silent no-op.
          if (code !== "23505") {
            failures.push({
              userId: row.user_id,
              loanId: row.id,
              message: insertErr.message ?? "insert failed",
            });
          }
          continue;
        }

        if (isOverdue) overdueEmitted += 1;
        else dueSoonEmitted += 1;

        // Push delivery — fire-and-forget. Mirrors the dispatcher's gate:
        // both push_enabled AND per-kind push must be on. Missing
        // per-kind push defaults to true.
        const pushOn = kindPref.push !== false;
        if (
          inserted &&
          prefs.push_enabled &&
          pushOn
        ) {
          pushAttempted += 1;
          const silent = kindPref.sound === false;
          try {
            await sendPushToUser(row.user_id, {
              id: inserted.id as string,
              subject,
              body: null,
              link_url: linkUrl,
              silent,
            });
          } catch (err) {
            // Best-effort — the inbox row is the canonical delivery.
            // eslint-disable-next-line no-console
            console.error(
              "[freelane-loans-sweep] push send failed",
              { kind, userId: row.user_id, loanId: row.id },
              err,
            );
          }
        } else {
          pushSkipped += 1;
        }
      } catch (e) {
        failures.push({
          userId: row.user_id,
          loanId: row.id,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return NextResponse.json({
      ok: true,
      loans: loanRows?.length ?? 0,
      dueSoonEmitted,
      overdueEmitted,
      prefsGated,
      pushAttempted,
      pushSkipped,
      failed: failures.length,
      failures,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Loans sweep failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

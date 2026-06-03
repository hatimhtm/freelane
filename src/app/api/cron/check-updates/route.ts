import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkForUpdates } from "@/lib/changelog/check-for-updates";
import {
  effectivePerKindPref,
  type PerKindPrefs,
} from "@/lib/notifications/types";

// GET /api/cron/check-updates
//
// Daily probe (9 AM PHT ≈ 1 AM UTC) that fetches the upstream CHANGELOG.md
// from GitHub raw, compares the top published version against the build's
// CURRENT_VERSION, and writes an `app_update_available` notification for
// every user with a settings row when a newer entry has landed.
//
// Auth: shares the existing CRON_SECRET / x-vercel-cron pattern with the
// other crons. The route lives outside the auth middleware whitelist so
// Vercel cron requests reach this handler without a session cookie.
//
// Single-user app today, but the per-user fan-out is correct for the day
// the app gains real multi-tenancy. Dedup key
// `app_update_available:<version>` keeps re-runs idempotent — the same
// version never lands twice in a single user's inbox even if the cron
// fires multiple times a day.

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
    const result = await checkForUpdates();
    if (!result.has_update) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        current_version: result.current_version,
        latest_version: result.latest_version,
        reason: "No newer release on GitHub raw.",
      });
    }

    const supabase = createServiceClient();

    // settings.user_id is the authoritative "active account" surface —
    // the welcome migration writes one row per signed-up user. We fan
    // out by iterating this list and inserting one
    // app_update_available row per user (dedup_key uniques across runs).
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

    // Batch the prefs reads in two `.in()` queries instead of serial
    // round-tripping per user. At single-user scale either shape works;
    // at multi-tenancy scale the per-user loop would be O(N) network
    // hops to Supabase for read-only data that's trivially fetched in
    // one go.
    let perKindByUser = new Map<string, PerKindPrefs>();
    let legacyByUser = new Map<
      string,
      Record<string, { in_app?: boolean }>
    >();
    if (userIds.length > 0) {
      const [settingsBatch, legacyBatch] = await Promise.all([
        supabase
          .from("notification_settings")
          .select("user_id, per_kind_prefs")
          .in("user_id", userIds),
        supabase
          .from("notification_prefs")
          .select("user_id, prefs")
          .in("user_id", userIds),
      ]);
      perKindByUser = new Map(
        (settingsBatch.data ?? []).map((row) => [
          (row as { user_id: string }).user_id,
          ((row as { per_kind_prefs: PerKindPrefs | null }).per_kind_prefs ??
            {}) as PerKindPrefs,
        ]),
      );
      legacyByUser = new Map(
        (legacyBatch.data ?? []).map((row) => [
          (row as { user_id: string }).user_id,
          ((row as {
            prefs: Record<string, { in_app?: boolean }> | null;
          }).prefs ?? {}) as Record<string, { in_app?: boolean }>,
        ]),
      );
    }

    let inserted = 0;
    let duplicates = 0;
    let suppressed = 0;
    const failures: Array<{ userId: string; message: string }> = [];

    for (const userId of userIds) {
      try {
        // Honour the same per-kind in_app gate that postNotification
        // applies on the user-scoped path. A user who turned the
        // `app_update_available` kind OFF in Settings -> Notifications
        // shouldn't get a row from the cron either — otherwise the two
        // paths diverge in policy for the same kind.
        const perKind = perKindByUser.get(userId) ?? ({} as PerKindPrefs);
        const legacy =
          legacyByUser.get(userId) ?? ({} as Record<
            string,
            { in_app?: boolean }
          >);
        const effective = effectivePerKindPref(
          perKind,
          legacy,
          "app_update_available",
        );
        if (!effective.in_app) {
          suppressed += 1;
          continue;
        }

        // Direct service-side insert. We can't call postNotification here
        // because it gates on the per-user push prefs read via
        // auth.uid() — and crons run without a user session. The cost is
        // that browser push doesn't fire from this path (it would for
        // the on-mount client probe). That's deliberate: a daily
        // background OS notification for every signed-up user is the
        // wrong shape — the inbox row is enough; push fires when the
        // user actually opens the app.
        const { data, error } = await supabase
          .from("notifications_inbox")
          .insert({
            user_id: userId,
            kind: "app_update_available",
            subject: `Freelane ${result.latest_version} is ready`,
            body:
              result.summary ||
              "Open Settings -> Updates to see what changed.",
            link_url: `/settings/updates?expand=${encodeURIComponent(result.latest_version)}`,
            dedup_key: result.dedup_key,
            priority: 0,
            payload: {
              kind_specific: {
                version: result.latest_version,
                summary: result.summary,
              },
            },
          })
          .select("id")
          .maybeSingle();
        if (error) {
          // Unique-violation on (user_id, dedup_key) is the happy "we
          // already told this user about this version" path. Anything
          // else is a real failure worth surfacing in the JSON.
          if (error.code === "23505") {
            duplicates += 1;
          } else {
            failures.push({ userId, message: error.message });
          }
          continue;
        }
        if (data) inserted += 1;
        else duplicates += 1;
      } catch (e) {
        failures.push({
          userId,
          message: e instanceof Error ? e.message : "unknown",
        });
      }
    }

    return NextResponse.json({
      ok: true,
      users: userIds.length,
      current_version: result.current_version,
      latest_version: result.latest_version,
      inserted,
      duplicates,
      suppressed,
      failed: failures.length,
      failures,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Check-updates cron failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

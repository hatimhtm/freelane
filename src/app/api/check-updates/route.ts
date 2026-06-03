import { NextResponse } from "next/server";
import { checkForUpdates } from "@/lib/changelog/check-for-updates";
import { postNotification } from "@/lib/notifications/dispatcher";
import { createClient } from "@/lib/supabase/server";

// GET /api/check-updates
//
// Hit on every app mount (client-side) so a user who already loaded the
// app sees a newer release the next time they navigate. The daily Vercel
// cron at /api/cron/check-updates fires the SAME dispatcher for users
// who are not currently using the app. Both paths share the dedup key
// `app_update_available:<version>` so we never double-notify the user
// for the same release.
//
// Auth: requires a signed-in session. The client-side sessionStorage
// guard in updates-section.tsx is best-effort UX and trivially
// bypassable, so we gate the endpoint server-side too. Without this an
// unauthed external caller could turn the route into a free GitHub raw
// proxy and dispatcher would silently no-op anyway (it reads auth.uid()
// to gate prefs).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { ok: false, error: "Unauthenticated" },
        { status: 401 },
      );
    }
    const result = await checkForUpdates();
    if (result.has_update) {
      try {
        await postNotification({
          kind: "app_update_available",
          subject: `Freelane ${result.latest_version} is ready`,
          body: result.summary || "Open Settings -> Updates to see what changed.",
          linkUrl: `/settings/updates?expand=${encodeURIComponent(result.latest_version)}`,
          dedupKey: result.dedup_key,
          priority: 0,
          payload: {
            kind_specific: {
              version: result.latest_version,
              summary: result.summary,
            },
          },
          // The user is already active in the app — the in-app banner
          // the Updates page renders is the right UX. Don't ALSO fire an
          // OS toast for the very app they're currently using. The daily
          // cron path explicitly skips push for the same reason.
          skipPush: true,
        });
      } catch {
        // Best-effort. A failed dispatch must not break the JSON probe.
      }
    }
    return NextResponse.json({
      ok: true,
      current_version: result.current_version,
      latest_version: result.latest_version,
      has_update: result.has_update,
      summary: result.summary,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Couldn't check for updates.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

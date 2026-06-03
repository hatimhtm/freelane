import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { runWeeklyPriceCheck } from "@/lib/ai/weekly-price-check";

// GET /api/cron/weekly-price-check
//
// Sunday-morning sweep over vendor_price_history. For each user with
// recent vendor activity:
//   1. Pull the trailing 42 days of vendor_price_history (joined to
//      vendor canonical_name for the brain prompt). 42 covers the
//      latest week + the 4 fully-prior weeks the noteworthy floor
//      (prior_4w_count >= 3) requires.
//   2. Run the Pro weekly-price-check brain with the noteworthy
//      threshold (|delta_pct| >= 0.10 AND prior_4w_count >= 3).
//   3. If any noteworthy changes come back, insert ONE
//      vendor_price_check_weekly notification per user with the bundled
//      changes in payload.kind_specific. Subject summarizes the top 3.
//
// Schedule (vercel.json): "0 22 * * 6" → 22:00 UTC Saturday = 06:00
// PHT Sunday morning. Matches the locked freelane-vendors-design spec.
//
// One notification per user per week. The brain itself is idempotent
// (same observations → same output) and the notification carries a
// dedup_key of `vendor_price_check_weekly:${YYYY-WW}` so repeat cron
// invocations within the same ISO week are silent no-ops.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// 42-day lookback: latest week + the 4 fully-prior weeks required for
// a stable prior_4w_avg. 30 days truncated to ~3 weeks of prior
// observations and biased the avg toward the latest week.
const PRICE_HISTORY_WINDOW_MS = 42 * 24 * 60 * 60 * 1000;

// PHT offset (UTC+8). The cron runs Sunday 06:00 PHT — computing the
// ISO week off raw UTC would tag that morning with the PRIOR week's
// label (since UTC is still Saturday). Users see the modal Sunday in
// PHT and expect the label to match.
const PHT_OFFSET_MS = 8 * 60 * 60 * 1000;

function isoWeekKey(d: Date): string {
  // Cheap ISO-week stamp: YYYY-Www. Computed against a PHT-shifted
  // wallclock so the dedup_key + payload.week_key align with the
  // user's local calendar. The shift is a constant so dedup behavior
  // stays consistent across retries within the same UTC week.
  const phtNow = new Date(d.getTime() + PHT_OFFSET_MS);
  const tmp = new Date(
    Date.UTC(phtNow.getUTCFullYear(), phtNow.getUTCMonth(), phtNow.getUTCDate()),
  );
  const dayNum = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const week = Math.ceil(
    ((tmp.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7,
  );
  return `${tmp.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
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

  try {
    const supabase = createServiceClient();
    const since = new Date(Date.now() - PRICE_HISTORY_WINDOW_MS).toISOString();

    // Surface every user with at least one vendor_price_history row in
    // the trailing window. Anyone quieter than that has nothing to
    // notify on.
    //
    // Prefer the recent_price_history_user_ids RPC (migration 0095) so
    // cohort discovery is server-side DISTINCT — at any scale, exactly
    // one row per user. Fall back to the older row-scan with a wider
    // limit if the RPC isn't deployed yet (treats missing RPC as a
    // recoverable error rather than blowing the cron).
    let userIds: string[] = [];
    const rpc = await supabase.rpc("recent_price_history_user_ids", {
      since_ts: since,
    });
    if (!rpc.error && Array.isArray(rpc.data)) {
      userIds = (rpc.data as Array<{ user_id: string | null }>)
        .map((r) => r.user_id)
        .filter((v): v is string => typeof v === "string" && v.length > 0);
    } else {
      // Fallback path — still bounded, still JS-deduped. A heavy user
      // can produce > 10k observations in 42 days, so the bound is
      // raised to 50k for the fallback only.
      const { data: cohort, error: cohortErr } = await supabase
        .from("vendor_price_history")
        .select("user_id")
        .gte("observed_at", since)
        .limit(50_000);
      if (cohortErr) {
        return NextResponse.json(
          { ok: false, error: cohortErr.message },
          { status: 500 },
        );
      }
      userIds = Array.from(
        new Set(
          (cohort ?? [])
            .map((r) => (r as { user_id: string | null }).user_id)
            .filter((v): v is string => typeof v === "string" && v.length > 0),
        ),
      );
    }

    const weekKey = isoWeekKey(new Date());
    let succeeded = 0;
    let notified = 0;
    // `silenced_by_pref` lets observability disambiguate "user opted
    // out" from "brain found nothing" on quiet weeks. The two used to
    // collapse into a single early-continue counter.
    let silencedByPref = 0;
    const failures: Array<{ userId: string; message: string }> = [];

    for (const userId of userIds) {
      try {
        // Pull the user's trailing 42d of observations, joined to vendor
        // names so the brain prompt is human-readable.
        //
        // Order DESC so the 2000-row LIMIT protects the LONG-TAIL vendor
        // instead of starving the most recent activity. Ascending+limit
        // would return the OLDEST rows — exactly the wrong slice, since
        // the brain's `latest_amount`/`delta_pct` reasoning depends on
        // the most-recent observations being present. The brain's prompt
        // re-sorts internally, so DESC here is invisible to the model.
        //
        // Cap raised from 800 → 2000: at 42 days, a heavy shopper (3-5
        // spends/day × 5-10 items) can land 1000+ rows. The previous
        // 800 cap silently starved the prior-week window for those
        // users — they received zero notifications even on real shifts.
        const { data: obsRows } = await supabase
          .from("vendor_price_history")
          .select("vendor_id, item_label, unit_amount, observed_at, vendors(canonical_name)")
          .eq("user_id", userId)
          .gte("observed_at", since.split("T")[0])
          .order("observed_at", { ascending: false })
          .limit(2000);

        const rawObservations = (obsRows ?? []).map((r) => {
          const row = r as unknown as {
            vendor_id: string;
            item_label: string | null;
            unit_amount: number | null;
            observed_at: string;
            vendors: { canonical_name: string | null } | null;
          };
          return {
            vendor_id: row.vendor_id,
            vendor_name:
              row.vendors?.canonical_name ?? "Unknown vendor",
            item_label: row.item_label ?? null,
            unit_amount: Number(row.unit_amount ?? 0),
            observed_at: row.observed_at,
          };
        }).filter((o) => o.unit_amount > 0);

        // Bucket observations into (vendor, item, ISO-week) so the
        // brain reasons over 5 weeks × N items instead of N raw rows.
        // At 2000-row cap the bucketed view fits in the Pro context
        // comfortably even for the noisiest shoppers, and prior_4w_avg
        // computation is the same arithmetic the brain would do on
        // raw rows.
        const observations = aggregateObservationsByWeek(rawObservations);

        const brain = await runWeeklyPriceCheck(userId, { observations });
        succeeded += 1;

        if (brain.changes.length === 0) continue;

        // Defence-in-depth — drop any change whose vendor_id wasn't
        // present in the observations we handed to the brain. Structured
        // output makes hallucinated IDs unlikely but not impossible; a
        // ghost vendor_id in the payload would surface a "real-looking
        // change" for a vendor the user never logged.
        const validVendorIds = new Set(observations.map((o) => o.vendor_id));
        const safeChanges = brain.changes.filter((c) =>
          validVendorIds.has(c.vendor_id),
        );
        if (safeChanges.length === 0) continue;

        // Honour per-kind prefs.
        const { data: settings } = await supabase
          .from("notification_settings")
          .select("per_kind_prefs")
          .eq("user_id", userId)
          .maybeSingle();
        const prefs =
          ((settings?.per_kind_prefs ?? {}) as Record<
            string,
            { in_app?: boolean }
          >)["vendor_price_check_weekly"] ?? { in_app: true };
        if (prefs.in_app === false) {
          silencedByPref += 1;
          continue;
        }

        const top = safeChanges.slice(0, 3);
        const bodyParts = top.map((c) => {
          const arrow = c.direction === "up" ? "+" : "-";
          const pct = Math.round(Math.abs(c.delta_pct) * 100);
          const label = c.item_label ? `${c.vendor_name} ${c.item_label}` : c.vendor_name;
          return `${label} ${arrow}${pct}%`;
        });

        // The dedup_key partial unique index on (user_id, dedup_key)
        // rejects same-week re-runs with Postgres 23505. Manual replay,
        // Vercel retry-on-5xx, multi-region cron storm — all valid
        // scenarios. Treat 23505 here as the docstring promises: a
        // SILENT NO-OP, not a failure. Anything else surfaces normally.
        const { error: insertErr } = await supabase
          .from("notifications_inbox")
          .insert({
            user_id: userId,
            kind: "vendor_price_check_weekly",
            subject: `Weekly vendor price changes (${safeChanges.length})`,
            body: bodyParts.join(" · "),
            dedup_key: `vendor_price_check_weekly:${weekKey}`,
            priority: 0,
            payload: {
              kind_specific: {
                changes: safeChanges,
                week_key: weekKey,
              },
            } as unknown as Record<string, unknown>,
          });
        if (insertErr) {
          if (String(insertErr.code) === "23505") {
            // Already notified this ISO week — silent no-op.
            continue;
          }
          throw insertErr;
        }
        notified += 1;
      } catch (e) {
        failures.push({
          userId,
          message: e instanceof Error ? e.message : "brain threw",
        });
      }
    }

    return NextResponse.json({
      ok: true,
      users: userIds.length,
      succeeded,
      notified,
      silencedByPref,
      failed: failures.length,
      failures,
      weekKey,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Weekly price-check cron failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

type RawObservation = {
  vendor_id: string;
  vendor_name: string;
  item_label: string | null;
  unit_amount: number;
  observed_at: string;
};

// Bucket raw observations into (vendor_id, item_label, ISO-week) groups
// and emit ONE synthetic observation per bucket carrying the bucket's
// mean unit_amount + median observed_at (a value the brain treats as
// the bucket's anchor).
//
// Why: the brain has to compute prior_4w_avg over the prior 4 weeks
// excluding the latest week. With raw rows past the per-user cap, a
// frequent shopper starves the older weeks. Bucketing collapses the
// vendor×item dimension to ~5 entries per pair (one per ISO week)
// which fits in the model context at any realistic spend cadence
// without losing fidelity.
function aggregateObservationsByWeek(
  raw: RawObservation[],
): RawObservation[] {
  type Bucket = {
    vendor_id: string;
    vendor_name: string;
    item_label: string | null;
    sum: number;
    count: number;
    midpointDay: string;
  };
  const buckets = new Map<string, Bucket>();
  for (const o of raw) {
    const day = (o.observed_at ?? "").slice(0, 10);
    if (!day) continue;
    const weekTag = phtWeekTagFromDay(day);
    const key = `${o.vendor_id}|${o.item_label ?? ""}|${weekTag}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.sum += o.unit_amount;
      existing.count += 1;
      // Carry the latest day in the bucket as the anchor — the brain
      // reasons about the LATEST week vs the prior 4w, and we want
      // the bucket's anchor to be the most-recent observation inside
      // the week so the brain's chronology stays accurate.
      if (day > existing.midpointDay) existing.midpointDay = day;
    } else {
      buckets.set(key, {
        vendor_id: o.vendor_id,
        vendor_name: o.vendor_name,
        item_label: o.item_label ?? null,
        sum: o.unit_amount,
        count: 1,
        midpointDay: day,
      });
    }
  }
  const out: RawObservation[] = [];
  for (const b of buckets.values()) {
    out.push({
      vendor_id: b.vendor_id,
      vendor_name: b.vendor_name,
      item_label: b.item_label,
      unit_amount: b.sum / b.count,
      observed_at: b.midpointDay,
    });
  }
  // Sort recent-first so the brain prompt reads chronologically the
  // same way the unaggregated path used to.
  out.sort((a, b) => (a.observed_at < b.observed_at ? 1 : -1));
  return out;
}

// Compute the ISO-week tag for a YYYY-MM-DD day, anchored in PHT for
// consistency with the dedup_key on the notification row.
function phtWeekTagFromDay(day: string): string {
  const parts = day.split("-");
  if (parts.length !== 3) return day;
  const utcMidnight = new Date(
    Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])),
  );
  return isoWeekKey(utcMidnight);
}

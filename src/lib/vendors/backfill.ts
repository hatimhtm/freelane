import "server-only";

import { canonicalizeVendor } from "@/lib/ai/canonicalize-vendor";
import type { createServiceClient } from "@/lib/supabase/service";
import {
  VENDOR_CLARIFY_ONE_DAY_MS,
  VENDOR_CLARIFY_PER_DAY_CAP,
  VENDOR_CLARIFY_PER_VENDOR_DEBOUNCE_MS,
} from "@/lib/vendors/clarify-limits";

// Backfill orchestrator for the always-ask canonicalize-vendor workflow.
//
// Runs per-user via the /api/cron/vendors-backfill cron route. Each
// invocation advances one batch:
//   1. Look up (or create) the per-user finance.vendor_backfill_progress
//      row.
//   2. Skip if finished_at is set.
//   3. Select up to BATCH_SIZE vendors past the cursor where
//      needs_identification = true OR canonical_name IS NULL OR
//      confidence IS NULL.
//   4. For each vendor, run the Pro canonicalize brain. Persist the
//      brain's output on the vendor row. Queue a vendor_clarify
//      notification, BUT cap at VENDOR_CLARIFY_PER_DAY_CAP (3/day —
//      shared with the synchronous kickoff path so the user never sees
//      more than 3 vendor_clarify a day total) by counting vendor_clarify
//      rows in the trailing 24h.
//   5. Advance cursor + vendors_processed. Set finished_at when no rows
//      remained.
//
// Calls into this module run via a SERVICE-ROLE supabase client (cron
// authority) — RLS is bypassed; we still pass user_id explicitly on
// every read/write.

const BATCH_SIZE = 25;
const PER_DAY_NOTIF_CAP = VENDOR_CLARIFY_PER_DAY_CAP;
const ONE_DAY_MS = VENDOR_CLARIFY_ONE_DAY_MS;

type ServiceSb = ReturnType<typeof createServiceClient>;

type VendorRow = {
  id: string;
  user_id: string;
  canonical_name: string | null;
  raw_user_typed_name: string | null;
  needs_identification: boolean;
  identification_skipped: boolean;
  confidence: number | null;
  last_clarify_notif_at: string | null;
};

type ProgressRow = {
  user_id: string;
  cursor_vendor_id: string | null;
  vendors_processed: number;
  vendors_total: number | null;
  finished_at: string | null;
};

async function loadOrInitProgress(
  supabase: ServiceSb,
  userId: string,
): Promise<ProgressRow> {
  const { data: existing } = await supabase
    .from("vendor_backfill_progress")
    .select("user_id, cursor_vendor_id, vendors_processed, vendors_total, finished_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (existing) return existing as unknown as ProgressRow;

  // Initialize with the total count so the UI / log can show progress.
  const { count } = await supabase
    .from("vendors")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .or("needs_identification.eq.true,canonical_name.is.null,confidence.is.null");

  const fresh: ProgressRow = {
    user_id: userId,
    cursor_vendor_id: null,
    vendors_processed: 0,
    vendors_total: count ?? 0,
    finished_at: null,
  };
  await supabase.from("vendor_backfill_progress").insert(fresh);
  return fresh;
}

async function countVendorClarifyToday(
  supabase: ServiceSb,
  userId: string,
): Promise<number> {
  const since = new Date(Date.now() - ONE_DAY_MS).toISOString();
  const { count } = await supabase
    .from("notifications_inbox")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("kind", "vendor_clarify")
    .gte("created_at", since);
  return count ?? 0;
}

export type VendorBackfillResult = {
  userId: string;
  processed: number;
  notificationsQueued: number;
  done: boolean;
};

export async function runVendorBackfillBatch(
  supabase: ServiceSb,
  userId: string,
): Promise<VendorBackfillResult> {
  const progress = await loadOrInitProgress(supabase, userId);
  if (progress.finished_at) {
    return {
      userId,
      processed: 0,
      notificationsQueued: 0,
      done: true,
    };
  }

  // Pull the next batch past the cursor. Ordered by id so the cursor is
  // stable across runs.
  let query = supabase
    .from("vendors")
    .select(
      "id, user_id, canonical_name, raw_user_typed_name, needs_identification, identification_skipped, confidence, last_clarify_notif_at",
    )
    .eq("user_id", userId)
    .or("needs_identification.eq.true,canonical_name.is.null,confidence.is.null")
    .order("id", { ascending: true })
    .limit(BATCH_SIZE);
  if (progress.cursor_vendor_id) {
    query = query.gt("id", progress.cursor_vendor_id);
  }
  const { data: vendors } = await query;
  const batch = (vendors ?? []) as VendorRow[];

  if (batch.length === 0) {
    await supabase
      .from("vendor_backfill_progress")
      .update({
        finished_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);
    return {
      userId,
      processed: 0,
      notificationsQueued: 0,
      done: true,
    };
  }

  let notifsSentToday = await countVendorClarifyToday(supabase, userId);
  let queuedThisRun = 0;
  let processedThisRun = 0;
  let lastId = progress.cursor_vendor_id;

  // Hoist the user's notification_settings.per_kind_prefs to the top of
  // the run — vendor_clarify in_app preference doesn't mutate inside a
  // single batch, so re-SELECTing on every iteration is wasted IO. The
  // synchronous postNotification dispatcher uses effectivePerKindPref;
  // the cron context can't auth.uid() so we rely on the same per_kind
  // map directly here.
  const { data: settings } = await supabase
    .from("notification_settings")
    .select("per_kind_prefs")
    .eq("user_id", userId)
    .maybeSingle();
  const perKindPrefs =
    (settings?.per_kind_prefs ?? {}) as Record<string, { in_app?: boolean }>;
  const clarifyInApp = perKindPrefs["vendor_clarify"]?.in_app ?? true;

  for (const vendor of batch) {
    lastId = vendor.id;
    processedThisRun += 1;
    if (vendor.identification_skipped) continue;
    const name =
      vendor.raw_user_typed_name ?? vendor.canonical_name ?? "";
    if (!name) continue;

    // Honour the per-vendor 30-min debounce on the BACKFILL path too,
    // not just on the synchronous kickoff. The OR-filter
    // `(needs_identification | canonical_name IS NULL | confidence IS
    // NULL)` re-surfaces the same row across cron runs whenever the
    // brain returns nothing, and a manual cron re-trigger (or transient
    // Gemini outage that leaves confidence NULL) can otherwise re-queue
    // the same vendor inside the 30-min window. The constant lives in
    // clarify-limits.ts so the two halves of the system can't drift.
    if (vendor.last_clarify_notif_at) {
      const last = new Date(vendor.last_clarify_notif_at).getTime();
      if (
        Number.isFinite(last) &&
        Date.now() - last < VENDOR_CLARIFY_PER_VENDOR_DEBOUNCE_MS
      ) {
        continue;
      }
    }

    // Track which fields the brain mutated so the UPDATE below only
    // includes fields with new values — a no-op UPDATE on every
    // brain-returns-nothing iteration churns triggers, RLS checks, and
    // any audit logging.
    let brainConfidence: number | null = null;
    let brainCanonical: string | null = null;
    let brandKey: string | null = null;
    let suggested: string[] = [];
    let alternatives: Array<{ canonical_name: string; reasoning: string }> = [];
    let brainProducedSomething = false;

    try {
      const brain = await canonicalizeVendor(vendor.id, {
        userTypedName: name,
      });
      brainProducedSomething =
        !!brain.canonical_name ||
        !!brain.brand_match ||
        brain.alternatives.length > 0;
      if (brainProducedSomething) {
        brainConfidence = brain.confidence;
        if (brain.canonical_name && brain.confidence >= 0.6) {
          brainCanonical = brain.canonical_name;
          suggested.push(brain.canonical_name);
        }
        if (brain.brand_match) brandKey = brain.brand_match;
        alternatives = brain.alternatives;
        for (const alt of brain.alternatives) {
          if (alt.canonical_name && !suggested.includes(alt.canonical_name)) {
            suggested.push(alt.canonical_name);
          }
        }
        suggested = suggested.slice(0, 3);
      }
    } catch {
      // Brain failure — leave the vendor row untouched so the next cron
      // run gets another shot at canonicalizing it (don't poison
      // confidence with a fabricated 0).
    }

    // Build the suggested list for the notification body too — fall
    // back to the existing canonical_name when the brain produced
    // nothing but the row already had a confident-enough name.
    const displaySuggested = suggested.length
      ? suggested
      : vendor.canonical_name
        ? [vendor.canonical_name]
        : [];

    const willQueueNotif =
      notifsSentToday < PER_DAY_NOTIF_CAP && clarifyInApp;

    // Step A — try to queue the vendor_clarify FIRST. Stamping the 30-min
    // per-vendor debounce before the insert succeeds was the previous
    // failure mode: a transport blip silenced the next cron run too.
    //
    // Distinguish three outcomes:
    //   • insert succeeded         → notifInserted = true
    //   • dedup_key 23505 conflict → notifDedupSkipped = true
    //   • any other error          → both false (transport blip; retry
    //                                 next cron)
    // Only insert-succeeded paths increment notifsSentToday + stamp
    // last_clarify_notif_at. A dedup conflict means SOMETHING ELSE
    // already queued this clarify (sync kickoff, prior cron run) — that
    // upstream path already incremented its own counters; double-
    // counting here artificially caps the daily budget AND silences the
    // next per-vendor retry for a notification this run didn't deliver.
    let notifInserted = false;
    let notifDedupSkipped = false;
    if (willQueueNotif) {
      const { error: insertErr } = await supabase
        .from("notifications_inbox")
        .insert({
          user_id: userId,
          kind: "vendor_clarify",
          subject: `What is "${name}"?`,
          body: displaySuggested.length
            ? `Tap the closest, or type it. ${displaySuggested.join(" · ")}.`
            : "Tap to clarify or type the place's name.",
          dedup_key: `vendor_clarify:${vendor.id}`,
          priority: 0,
          payload: {
            kind_specific: {
              vendor_id: vendor.id,
              vendor_name: name,
              suggested_answers: displaySuggested,
              alternatives,
              confidence: brainConfidence ?? vendor.confidence ?? 0,
              allow_skip: true,
              source: "backfill",
            },
          } as unknown as Record<string, unknown>,
        });
      if (!insertErr) {
        notifInserted = true;
      } else if (String(insertErr.code) === "23505") {
        notifDedupSkipped = true;
      }
    }

    // Step B — single merged UPDATE. Only persist fields the brain
    // actually mutated. Only stamp last_clarify_notif_at when a NEW
    // row landed in notifications_inbox (dedup-skip means someone else
    // already delivered and stamped — re-stamping would silence the
    // next 30-min retry for free).
    const patch: Record<string, unknown> = {};
    if (brainProducedSomething && brainConfidence !== null) {
      patch.confidence = brainConfidence;
    }
    if (brainCanonical && brainCanonical !== vendor.canonical_name) {
      patch.canonical_name = brainCanonical;
    }
    if (brandKey) patch.brand_key = brandKey;
    if (notifInserted) {
      patch.last_clarify_notif_at = new Date().toISOString();
    }
    if (Object.keys(patch).length > 0) {
      await supabase
        .from("vendors")
        .update(patch)
        .eq("id", vendor.id)
        .eq("user_id", userId);
    }

    if (notifInserted) {
      notifsSentToday += 1;
      queuedThisRun += 1;
    }
    // notifDedupSkipped intentionally NOT counted — the dedup_key row
    // already exists from an upstream queue, and its OWN delivery path
    // already counted itself. Touch nothing.
    void notifDedupSkipped;
  }

  await supabase
    .from("vendor_backfill_progress")
    .update({
      cursor_vendor_id: lastId,
      vendors_processed: progress.vendors_processed + processedThisRun,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);

  return {
    userId,
    processed: processedThisRun,
    notificationsQueued: queuedThisRun,
    done: false,
  };
}

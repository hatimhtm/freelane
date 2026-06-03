import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { canonicalizeVendor } from "@/lib/ai/canonicalize-vendor";
import { countNotificationsInWindow, postNotification } from "@/lib/notifications/dispatcher";
import { VENDOR_REGISTRY } from "@/lib/brand/vendors";
import {
  VENDOR_CLARIFY_ONE_DAY_MS,
  VENDOR_CLARIFY_PER_DAY_CAP,
  VENDOR_CLARIFY_PER_VENDOR_DEBOUNCE_MS,
} from "@/lib/vendors/clarify-limits";

// Fire-and-forget kickoff helper that runs after createVendor inserts the
// fast-path row. NEVER throws — every failure mode degrades to "user
// gets no vendor_clarify notification" which is the same outcome as
// declining the clarify in the chatbot.
//
// Debouncing rules (locked 2026-06-02 freelane-vendors-design):
//   1. Max 3 vendor_clarify per day per user (rest queue silently).
//   2. 30-minute debounce per vendor against last_clarify_notif_at.
//   3. Same vendor never asked twice — if confidence is already set
//      OR identification_skipped=true, we skip silently.
//   4. Always-ask flag: even at confidence >= 0.85, we STILL queue
//      the notification. The user picks the top chip; debouncing
//      rules above keep it from spamming.

// Re-exported under local aliases so the file reads identically — the
// shared module is the source of truth.
const PER_DAY_CAP = VENDOR_CLARIFY_PER_DAY_CAP;
const ONE_DAY_MS = VENDOR_CLARIFY_ONE_DAY_MS;
const PER_VENDOR_DEBOUNCE_MS = VENDOR_CLARIFY_PER_VENDOR_DEBOUNCE_MS;

export async function kickoffVendorCanonicalize(args: {
  vendorId: string;
  vendorName: string;
  spendContext?: {
    amount?: number | null;
    walletName?: string | null;
    timeOfDay?: string | null;
    locationHint?: string | null;
    tags?: string[];
  } | null;
}): Promise<void> {
  try {
    const user = await getAuthUser();
    if (!user) return;
    const supabase = await createClient();

    // Read current vendor state — skip if already canonicalized or
    // explicitly skipped. The row was just inserted by createVendor; we
    // re-read to confirm RLS visibility + pick up any concurrent edit.
    const { data: row } = await supabase
      .from("vendors")
      .select(
        "confidence, identification_skipped, last_clarify_notif_at, needs_identification, canonical_name",
      )
      .eq("id", args.vendorId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!row) return;
    const r = row as {
      confidence?: number | null;
      identification_skipped?: boolean | null;
      last_clarify_notif_at?: string | null;
      needs_identification?: boolean | null;
      canonical_name?: string | null;
    };
    if (r.identification_skipped) return;
    // If a meaningful confidence is already on the row, the brain has
    // already run successfully AND the user has answered (or the
    // always-ask path has already queued one notif for this vendor).
    // Skip to avoid re-asking.
    //
    // We treat ONLY positive (> 0) values as "already canonicalized".
    // confidence=0 can legitimately land in two paths:
    //   • a brain failure we want re-tried next createVendor, OR
    //   • a successful brain run that returned only `alternatives`
    //     (canonical_name null, confidence 0) — brainProducedSomething
    //     flips true on alternatives, so confidence=0 used to be
    //     persisted and then silently silenced every future kickoff
    //     for this vendor. Excluding 0 here keeps the next kickoff
    //     alive when the dispatcher previously dropped the row.
    if (typeof r.confidence === "number" && r.confidence > 0) return;

    // 30-min per-vendor debounce.
    if (r.last_clarify_notif_at) {
      const last = new Date(r.last_clarify_notif_at).getTime();
      if (Number.isFinite(last) && Date.now() - last < PER_VENDOR_DEBOUNCE_MS) {
        return;
      }
    }

    // 3/day global cap on vendor_clarify.
    const today = await countNotificationsInWindow("vendor_clarify", ONE_DAY_MS);
    if (today >= PER_DAY_CAP) {
      // Cap reached — the backfill cron picks up the slack tomorrow.
      return;
    }

    // Gather lightweight context for the brain.
    const [{ data: knownVendors }] = await Promise.all([
      supabase
        .from("vendors")
        .select("canonical_name")
        .eq("user_id", user.id)
        .neq("id", args.vendorId)
        .not("canonical_name", "is", null)
        .limit(80),
    ]);
    const knownNames = (knownVendors ?? [])
      .map((v) => (v as { canonical_name: string | null }).canonical_name)
      .filter((v): v is string => typeof v === "string" && v.length > 0);

    // Pass the curated PH brand registry slugs so the brain can match
    // against the canonical list instead of guessing chain names from
    // training-data memory alone. The "never fabricate a brand match"
    // hard rule in canonicalize-vendor.ts is the user-trust guarantee
    // here — without registry grounding the rule has nothing to anchor
    // against on ambiguous local names.
    const brandRegistryKeys = Object.keys(VENDOR_REGISTRY);

    const brain = await canonicalizeVendor(args.vendorId, {
      userTypedName: args.vendorName,
      spendContext: args.spendContext ?? null,
      knownVendors: knownNames,
      brandRegistry: brandRegistryKeys,
    });

    // Persist brain output on the row. canonical_name is overwritten
    // only when the brain is confident enough to act on its proposal
    // (>= 0.6) — below that, we keep the raw_user_typed_name as the
    // display name until the user clarifies.
    //
    // Distinguish "brain ran successfully but is unsure" from "brain
    // failed entirely". canonicalizeVendor returns emptyResult() (all
    // null + confidence=0) on Gemini outage / missing key / schema drift.
    // We must NOT persist confidence=0 in that case, because the early-
    // exit above treats any numeric confidence as "already canonicalized"
    // and would silence future kickoff attempts forever. The backfill
    // cron's OR-filter on `confidence IS NULL` also relies on this.
    const brainProducedSomething =
      !!brain.canonical_name ||
      !!brain.brand_match ||
      brain.alternatives.length > 0;
    const patch: Record<string, unknown> = {};
    if (brainProducedSomething) {
      patch.confidence = brain.confidence;
      if (brain.canonical_name && brain.confidence >= 0.6) {
        patch.canonical_name = brain.canonical_name;
      }
      if (brain.brand_match) {
        patch.brand_key = brain.brand_match;
      }
    }
    if (Object.keys(patch).length > 0) {
      await supabase
        .from("vendors")
        .update(patch)
        .eq("id", args.vendorId)
        .eq("user_id", user.id);
    }

    // Build the chip list. canonical_name guess goes first when
    // confidence >= 0.6; otherwise the top "alternative" leads.
    const chips: string[] = [];
    if (brain.canonical_name && brain.confidence >= 0.6) {
      chips.push(brain.canonical_name);
    }
    for (const alt of brain.alternatives) {
      if (alt.canonical_name && !chips.includes(alt.canonical_name)) {
        chips.push(alt.canonical_name);
      }
    }

    const dispatched = await postNotification({
      kind: "vendor_clarify",
      subject: `What is "${args.vendorName}"?`,
      body: chips.length
        ? `Tap the closest, or type it. ${chips.slice(0, 3).join(" · ")}.`
        : "Tap to clarify or type the place's name.",
      dedupKey: `vendor_clarify:${args.vendorId}`,
      priority: 0,
      payload: {
        kind_specific: {
          vendor_id: args.vendorId,
          vendor_name: args.vendorName,
          suggested_answers: chips.slice(0, 3),
          alternatives: brain.alternatives,
          confidence: brain.confidence,
          allow_skip: true,
        },
      },
    });

    // Only stamp the 30-min per-vendor debounce when the dispatcher
    // actually INSERTED a new row. `ok=true,inserted=false` is the
    // dedup-key collision path (backfill already queued a clarify for
    // this vendor earlier in the day); silencing the next kickoff
    // there would hide the next legitimate retry behind a debounce for
    // a delivery that never actually happened.
    if (dispatched.ok && dispatched.inserted) {
      await supabase
        .from("vendors")
        .update({ last_clarify_notif_at: new Date().toISOString() })
        .eq("id", args.vendorId)
        .eq("user_id", user.id);
    }
  } catch {
    // Best-effort — never throws.
  }
}

import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import {
  canonicalizeEntity,
  type CanonicalizeEntityAlternative,
} from "@/lib/ai/brains/canonicalize-entity";
import {
  proposeEntityFromSignal,
  type ProposeEntitySignalKind,
} from "@/lib/ai/brains/propose-entity-from-signal";
import {
  countNotificationsInWindow,
  postNotification,
} from "@/lib/notifications/dispatcher";
import { fingerprintFromIds } from "@/lib/ai/cache";
import {
  ENTITY_CLARIFY_ONE_DAY_MS,
  ENTITY_CLARIFY_PER_DAY_CAP,
  ENTITY_CLARIFY_PER_ENTITY_DEBOUNCE_MS,
  ENTITY_DISCOVERY_ONE_DAY_MS,
  ENTITY_DISCOVERY_PER_DAY_CAP,
} from "@/lib/entities/clarify-limits";
import { normalizeEntityName } from "@/lib/entities/normalize";

// Entities workflow — discovery (Gate 1) + canonicalization kickoff
// (Gate 2). Both helpers are fire-and-forget and NEVER throw; every
// failure mode degrades to "the user gets no notification" which is the
// same outcome as declining the prompt in the chatbot.
//
// Gate 1 — entity_discovery_request:
//   scanForCandidateEntity() takes a raw signal (spend note / chat /
//   sadaka tag / transfer target), runs the Flash Lite
//   propose-entity-from-signal brain, checks the denylist, and emits an
//   entity_discovery_request notification when the brain says yes.
//   Per-day cap (ENTITY_DISCOVERY_PER_DAY_CAP=2) silently queues
//   overflow — the per-signal cache fingerprint keeps the next cron
//   sweep from re-billing Gemini.
//
// Gate 2 — entity_clarify:
//   kickoffEntityCanonicalize() runs after createEntity (manual or
//   post-Gate-1 confirmation). The Pro canonicalize-entity brain runs
//   async then ALWAYS queues an entity_clarify notification regardless
//   of confidence. Debouncing:
//     • Per-user 3/day cap (ENTITY_CLARIFY_PER_DAY_CAP)
//     • 30-min per-entity debounce (last_clarify_notif_at on the row)
//     • identification_skipped=true short-circuits silently
//     • confidence > 0 + a non-empty canonical_name short-circuits
//       (already canonicalized).

// Wire through the shared normalizeEntityName helper so the JS-side
// denylist key stays byte-for-byte aligned with the DB's documented form
// in migration 0098. Local alias kept for call-site readability.
const normalizeName = normalizeEntityName;

// ─────────────────────────── Gate 1 ──

export async function scanForCandidateEntity(args: {
  sourceKind: ProposeEntitySignalKind;
  sourceText: string;
  candidateName: string;
  // Optional override — the spend modal already knows the spend id and
  // can pass it through; chat messages pass message_id. Used to build
  // the per-signal fingerprint so re-runs hit the cache.
  signalId?: string | null;
}): Promise<void> {
  try {
    const user = await getAuthUser();
    if (!user) return;
    const supabase = await createClient();
    const candidate = (args.candidateName ?? "").trim();
    if (!candidate) return;

    // 1. Denylist check FIRST — cheapest read, conclusive answer.
    const normalized = normalizeName(candidate);
    if (!normalized) return;
    const { data: denied } = await supabase
      .from("entity_discovery_denylist")
      .select("id")
      .eq("user_id", user.id)
      .eq("name_normalized", normalized)
      .maybeSingle();
    if (denied) return;

    // 2. Per-day discovery cap. Gate 1 fires AT MOST
    //    ENTITY_DISCOVERY_PER_DAY_CAP times per user.
    //
    //    Known tradeoff (verifier noted): when the cap is hit, we skip
    //    the brain call AND skip writing a cache row, so the same signal
    //    arriving tomorrow burns a fresh Gemini call. That's an
    //    intentional choice — caching a negative outcome from "capped"
    //    would suppress the legitimate retry tomorrow when the cap
    //    window slides forward. Burning the call on tomorrow's first
    //    encounter is the cheaper failure mode than silently dropping
    //    a worth-asking signal forever. A future cron sweep could
    //    persist a 24h queued-marker if Gemini cost ever spikes from
    //    this path.
    const sentToday = await countNotificationsInWindow(
      "entity_discovery_request",
      ENTITY_DISCOVERY_ONE_DAY_MS,
    );
    if (sentToday >= ENTITY_DISCOVERY_PER_DAY_CAP) return;

    // 3. Pull existing entities + denylist for the brain.
    const [{ data: entities }, { data: deny }] = await Promise.all([
      supabase
        .from("entities")
        .select("canonical_name")
        .eq("user_id", user.id)
        .eq("archived", false)
        .limit(80),
      supabase
        .from("entity_discovery_denylist")
        .select("name_normalized")
        .eq("user_id", user.id)
        .limit(120),
    ]);

    const existingNames = (entities ?? [])
      .map((e) => (e as { canonical_name: string | null }).canonical_name)
      .filter((v): v is string => typeof v === "string" && v.length > 0);
    const denyList = (deny ?? [])
      .map((r) => (r as { name_normalized: string }).name_normalized)
      .filter((v): v is string => typeof v === "string" && v.length > 0);

    // 4. Build the signal fingerprint and run the Flash Lite brain.
    const signalFingerprint = await fingerprintFromIds([
      "signal",
      args.sourceKind,
      candidate.toLowerCase(),
      (args.signalId ?? args.sourceText.slice(0, 80)).toString(),
    ]);

    const brain = await proposeEntityFromSignal({
      signalFingerprint,
      sourceKind: args.sourceKind,
      sourceText: args.sourceText,
      candidateName: candidate,
      existingEntities: existingNames,
      denylist: denyList,
    });

    if (!brain.is_potential_entity) return;
    if (brain.match_existing) return; // it's an existing entity — skip
    const suggestedName = brain.suggested_name ?? candidate;

    // Verifier fix: the denylist check at step 1 was on the CANDIDATE
    // name, but the brain may rename it. Re-check the brain's
    // suggested_name against the denylist Set already loaded above; if
    // the user previously rejected the canonicalised form, suppress.
    const normalizedSuggested = normalizeName(suggestedName);
    if (
      normalizedSuggested &&
      normalizedSuggested !== normalized &&
      denyList.includes(normalizedSuggested)
    ) {
      return;
    }

    // 5. Queue the entity_discovery_request notification. The dedup key
    //    uniques per-(user, signal_fingerprint) so a chat message that
    //    re-mentions the same name doesn't fire twice. The payload
    //    carries the brain's suggestion + the source context so the
    //    Gate-1 modal can render context inline.
    await postNotification({
      kind: "entity_discovery_request",
      subject: `Add ${suggestedName} as someone you know?`,
      body: brain.reasoning
        ? `I noticed "${candidate}" in your ${args.sourceKind.replace(
            "_",
            " ",
          )}. ${brain.reasoning}`
        : `I noticed "${candidate}" in your ${args.sourceKind.replace(
            "_",
            " ",
          )}.`,
      dedupKey: `entity_discovery_request:${signalFingerprint}`,
      priority: 0,
      payload: {
        choices: ["Add as entity", "Edit then add", "Not an entity", "Skip"],
        kind_specific: {
          signal_fingerprint: signalFingerprint,
          source_kind: args.sourceKind,
          source_text: args.sourceText.slice(0, 300),
          candidate_name: candidate,
          suggested_name: suggestedName,
          suggested_relationship: brain.suggested_relationship,
          confidence: brain.confidence,
          reasoning: brain.reasoning,
        },
      },
    });
  } catch {
    // Best-effort — never throws.
  }
}

// ─────────────────────────── Gate 2 ──

export async function kickoffEntityCanonicalize(args: {
  entityId: string;
  entityName: string;
  relationshipHint?: string | null;
  discoveredFrom?: string | null;
}): Promise<void> {
  try {
    const user = await getAuthUser();
    if (!user) return;
    const supabase = await createClient();

    // Re-read the entity row — confirm RLS visibility + concurrent
    // edits. The row was just inserted by createEntity; this round-trip
    // also catches the race where Gate 1 confirmation + manual add both
    // fire at the same time on the same name.
    const { data: row } = await supabase
      .from("entities")
      .select(
        "confidence, identification_skipped, last_clarify_notif_at, canonical_name, discovered_from, relationship",
      )
      .eq("id", args.entityId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!row) return;
    const r = row as {
      confidence?: number | null;
      identification_skipped?: boolean | null;
      last_clarify_notif_at?: string | null;
      canonical_name?: string | null;
      discovered_from?: string | null;
      relationship?: string | null;
    };
    if (r.identification_skipped) return;

    // Gate 1 confirmation short-circuit (verifier fix). When the user
    // accepts entity_discovery_request and supplies a relationship via
    // Gate 1's modal, acceptEntityDiscovery stamps:
    //   discovered_from = 'gate1_confirmed' (or the originating source_kind)
    //   relationship    = the user's pick
    //   canonical_name  = the user's final name
    //   confidence      = 1.0 (sentinel — only set by Gate 1 confirm)
    // The user has already answered the canonicalize question; firing a
    // Gate 2 notification on top of that double-prompts them. We treat
    // this exact combination as "Gate 2 already answered" and exit.
    //
    // NOTE: this is NOT the same as the previously-removed
    // "confidence>0 + relationship" short-circuit. The brain's own
    // confident output lands as 0.6-0.9; only the explicit user-confirm
    // path stamps 1.0. So subsequent edits + brain re-runs still get
    // their chance, while Gate 1 acceptance suppresses the duplicate.
    if (
      typeof r.confidence === "number" &&
      r.confidence >= 1.0 &&
      !!r.relationship &&
      !!r.canonical_name
    ) {
      return;
    }

    // NOTE on idempotency (per the verifier's "ALWAYS fires" guidance):
    // beyond the Gate 1 short-circuit above, we rely on TWO defences:
    //   1. dedupKey `entity_clarify:${entityId}` — the partial unique on
    //      notifications_inbox suppresses duplicate inbox rows so the
    //      user never sees two outstanding clarify cards for the same
    //      entity. The first row stays open until the user answers it.
    //   2. last_clarify_notif_at + per-entity debounce (30m) — a rapid
    //      re-fire within the debounce window is silenced even if the
    //      inbox row has been read/archived already.

    // 30-min per-entity debounce.
    if (r.last_clarify_notif_at) {
      const last = new Date(r.last_clarify_notif_at).getTime();
      if (
        Number.isFinite(last) &&
        Date.now() - last < ENTITY_CLARIFY_PER_ENTITY_DEBOUNCE_MS
      ) {
        return;
      }
    }

    // 3/day global cap.
    const sentToday = await countNotificationsInWindow(
      "entity_clarify",
      ENTITY_CLARIFY_ONE_DAY_MS,
    );
    if (sentToday >= ENTITY_CLARIFY_PER_DAY_CAP) return;

    // Pull a tiny relationship_context for the brain — recent
    // beneficiary spends + sadaka payments tied to this entity. Falls
    // back to empty array on any read failure.
    const { data: recentSpends } = await supabase
      .from("spends")
      .select("amount_base, description, spent_at")
      .eq("user_id", user.id)
      .eq("beneficiary_entity_id", args.entityId)
      .order("spent_at", { ascending: false })
      .limit(8);
    const relationshipContext = (recentSpends ?? []).map((s) => ({
      kind: "beneficiary_spend" as const,
      amount: Number((s as { amount_base: number | null }).amount_base ?? 0),
      note:
        ((s as { description: string | null }).description ?? "").slice(0, 80) ||
        null,
    }));

    const brain = await canonicalizeEntity(args.entityId, {
      userTypedName: args.entityName,
      discoveredFrom: args.discoveredFrom ?? r.discovered_from ?? null,
      relationshipContext,
    });

    // Persist brain output on the row. canonical_name overwrites only
    // when the brain is confident enough (>= 0.6); relationship lands
    // when the brain proposed one. Same defensive treatment of
    // confidence=0 as the vendors workflow — empty brain output keeps
    // the row's NULL confidence so the next kickoff is still alive.
    const brainProducedSomething =
      !!brain.canonical_name ||
      !!brain.relationship ||
      brain.alternatives.length > 0;
    const patch: Record<string, unknown> = {};
    if (brainProducedSomething) {
      patch.confidence = brain.confidence;
      if (brain.canonical_name && brain.confidence >= 0.6) {
        patch.canonical_name = brain.canonical_name;
      }
      if (brain.relationship && brain.confidence >= 0.6) {
        patch.relationship = brain.relationship;
      }
    }
    if (Object.keys(patch).length > 0) {
      // Concurrency guard (verifier fix): if Gate 1 acceptance raced
      // with this kickoff and stamped confidence=1.0 + canonical_name +
      // relationship on the row while the brain was in flight, the
      // brain's lower-confidence output must not overwrite the user-
      // confirmed answer. Re-read the row and skip the patch fields
      // that would clobber a confirmed sentinel.
      const { data: latest } = await supabase
        .from("entities")
        .select("confidence, relationship, canonical_name")
        .eq("id", args.entityId)
        .eq("user_id", user.id)
        .maybeSingle();
      const latestConfidence = Number(
        (latest as { confidence?: number | null } | null)?.confidence ?? 0,
      );
      const userConfirmed = latestConfidence >= 1.0;
      if (userConfirmed) {
        // Drop the brain's name + relationship + confidence write so the
        // Gate-1 confirmed values stay intact. The brain's alternatives
        // can still be surfaced via the notification payload below.
        delete patch.canonical_name;
        delete patch.relationship;
        delete patch.confidence;
      }
      if (Object.keys(patch).length > 0) {
        // Also scope the UPDATE so a parallel Gate 1 stamp landing AFTER
        // our re-read but BEFORE the UPDATE doesn't get clobbered.
        await supabase
          .from("entities")
          .update(patch)
          .eq("id", args.entityId)
          .eq("user_id", user.id)
          .lt("confidence", 1.0);
      }
    }

    // Build the chip list. canonical_name guess first when
    // confident enough; otherwise the top alternative leads.
    const chips: string[] = [];
    const altsForPayload: CanonicalizeEntityAlternative[] = brain.alternatives;
    if (brain.canonical_name && brain.confidence >= 0.6) {
      chips.push(brain.canonical_name);
    }
    for (const alt of altsForPayload) {
      if (alt.canonical_name && !chips.includes(alt.canonical_name)) {
        chips.push(alt.canonical_name);
      }
    }

    const dispatched = await postNotification({
      kind: "entity_clarify",
      subject: `Who is "${args.entityName}"?`,
      body: chips.length
        ? `Tap the closest, or type it. ${chips.slice(0, 3).join(" · ")}.`
        : "Tap to clarify the person's name or relationship.",
      dedupKey: `entity_clarify:${args.entityId}`,
      priority: 0,
      payload: {
        kind_specific: {
          entity_id: args.entityId,
          entity_name: args.entityName,
          suggested_answers: chips.slice(0, 3),
          alternatives: altsForPayload,
          suggested_relationship:
            args.relationshipHint ?? brain.relationship ?? null,
          confidence: brain.confidence,
          allow_skip: true,
        },
      },
    });

    // Only stamp the 30-min per-entity debounce when the dispatcher
    // actually INSERTED a new row. ok=true,inserted=false is the
    // dedup-key collision path; silencing the next kickoff there would
    // hide the next legitimate retry behind a debounce for a delivery
    // that never happened.
    if (dispatched.ok && dispatched.inserted) {
      await supabase
        .from("entities")
        .update({ last_clarify_notif_at: new Date().toISOString() })
        .eq("id", args.entityId)
        .eq("user_id", user.id);
    }
  } catch {
    // Best-effort — never throws.
  }
}

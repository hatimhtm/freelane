import "server-only";

import { canonicalizeEntity } from "@/lib/ai/brains/canonicalize-entity";
import type { createServiceClient } from "@/lib/supabase/service";
import {
  ENTITY_CLARIFY_ONE_DAY_MS,
  ENTITY_CLARIFY_PER_DAY_CAP,
  ENTITY_CLARIFY_PER_ENTITY_DEBOUNCE_MS,
} from "@/lib/entities/clarify-limits";

// Backfill orchestrator for the always-ask canonicalize-entity workflow.
//
// Mirrors src/lib/vendors/backfill.ts almost line-for-line so a future
// reader sees one shape instead of two. Per-batch advances the user's
// entity_backfill_progress row, runs canonicalize-entity on every
// not-yet-canonicalized entity, persists confidence + canonical_name +
// relationship, queues entity_clarify notifications under the per-day
// cap, and advances the cursor.

const BATCH_SIZE = 25;
const PER_DAY_NOTIF_CAP = ENTITY_CLARIFY_PER_DAY_CAP;
const ONE_DAY_MS = ENTITY_CLARIFY_ONE_DAY_MS;

type ServiceSb = ReturnType<typeof createServiceClient>;

type EntityRow = {
  id: string;
  user_id: string;
  canonical_name: string | null;
  raw_user_typed_name: string | null;
  relationship: string | null;
  identification_skipped: boolean | null;
  confidence: number | null;
  last_clarify_notif_at: string | null;
  discovered_from: string | null;
};

type ProgressRow = {
  user_id: string;
  cursor_entity_id: string | null;
  entities_processed: number;
  entities_total: number | null;
  finished_at: string | null;
};

async function loadOrInitProgress(
  supabase: ServiceSb,
  userId: string,
): Promise<ProgressRow> {
  const { data: existing } = await supabase
    .from("entity_backfill_progress")
    .select("user_id, cursor_entity_id, entities_processed, entities_total, finished_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (existing) return existing as unknown as ProgressRow;

  // Initialize with the total count so the UI / log can show progress.
  const { count } = await supabase
    .from("entities")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .or("confidence.is.null,relationship.is.null");

  const fresh: ProgressRow = {
    user_id: userId,
    cursor_entity_id: null,
    entities_processed: 0,
    entities_total: count ?? 0,
    finished_at: null,
  };
  await supabase.from("entity_backfill_progress").insert(fresh);
  return fresh;
}

async function countEntityClarifyToday(
  supabase: ServiceSb,
  userId: string,
): Promise<number> {
  const since = new Date(Date.now() - ONE_DAY_MS).toISOString();
  const { count } = await supabase
    .from("notifications_inbox")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("kind", "entity_clarify")
    .gte("created_at", since);
  return count ?? 0;
}

export type EntityBackfillResult = {
  userId: string;
  processed: number;
  notificationsQueued: number;
  done: boolean;
};

export async function runEntityBackfillBatch(
  supabase: ServiceSb,
  userId: string,
): Promise<EntityBackfillResult> {
  const progress = await loadOrInitProgress(supabase, userId);
  if (progress.finished_at) {
    return {
      userId,
      processed: 0,
      notificationsQueued: 0,
      done: true,
    };
  }

  let query = supabase
    .from("entities")
    .select(
      "id, user_id, canonical_name, raw_user_typed_name, relationship, identification_skipped, confidence, last_clarify_notif_at, discovered_from",
    )
    .eq("user_id", userId)
    .or("confidence.is.null,relationship.is.null")
    .eq("archived", false)
    .order("id", { ascending: true })
    .limit(BATCH_SIZE);
  if (progress.cursor_entity_id) {
    query = query.gt("id", progress.cursor_entity_id);
  }
  const { data: entities } = await query;
  const batch = (entities ?? []) as EntityRow[];

  if (batch.length === 0) {
    await supabase
      .from("entity_backfill_progress")
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

  let notifsSentToday = await countEntityClarifyToday(supabase, userId);
  let queuedThisRun = 0;
  let processedThisRun = 0;
  let lastId = progress.cursor_entity_id;

  // Hoist the user's notification_settings.per_kind_prefs to the top of
  // the run. entity_clarify in_app preference doesn't mutate inside a
  // single batch.
  const { data: settings } = await supabase
    .from("notification_settings")
    .select("per_kind_prefs")
    .eq("user_id", userId)
    .maybeSingle();
  const perKindPrefs =
    (settings?.per_kind_prefs ?? {}) as Record<string, { in_app?: boolean }>;
  const clarifyInApp = perKindPrefs["entity_clarify"]?.in_app ?? true;

  for (const entity of batch) {
    lastId = entity.id;
    processedThisRun += 1;
    if (entity.identification_skipped) continue;
    const name =
      entity.raw_user_typed_name ?? entity.canonical_name ?? "";
    if (!name) continue;

    // 30-min per-entity debounce — same as vendors backfill.
    if (entity.last_clarify_notif_at) {
      const last = new Date(entity.last_clarify_notif_at).getTime();
      if (
        Number.isFinite(last) &&
        Date.now() - last < ENTITY_CLARIFY_PER_ENTITY_DEBOUNCE_MS
      ) {
        continue;
      }
    }

    let brainConfidence: number | null = null;
    let brainCanonical: string | null = null;
    let brainRelationship: string | null = null;
    let suggested: string[] = [];
    let alternatives: Array<{
      canonical_name: string;
      relationship: string;
      reasoning: string;
    }> = [];
    let brainProducedSomething = false;

    try {
      const brain = await canonicalizeEntity(entity.id, {
        userTypedName: name,
        discoveredFrom: entity.discovered_from,
      });
      brainProducedSomething =
        !!brain.canonical_name ||
        !!brain.relationship ||
        brain.alternatives.length > 0;
      if (brainProducedSomething) {
        brainConfidence = brain.confidence;
        if (brain.canonical_name && brain.confidence >= 0.6) {
          brainCanonical = brain.canonical_name;
          suggested.push(brain.canonical_name);
        }
        if (brain.relationship && brain.confidence >= 0.6) {
          brainRelationship = brain.relationship;
        }
        alternatives = brain.alternatives;
        for (const alt of brain.alternatives) {
          if (alt.canonical_name && !suggested.includes(alt.canonical_name)) {
            suggested.push(alt.canonical_name);
          }
        }
        suggested = suggested.slice(0, 3);
      }
    } catch {
      // Brain failure — leave the entity row untouched so the next cron
      // run gets another shot.
    }

    const displaySuggested = suggested.length
      ? suggested
      : entity.canonical_name
        ? [entity.canonical_name]
        : [];

    const willQueueNotif =
      notifsSentToday < PER_DAY_NOTIF_CAP && clarifyInApp;

    // Step A — try to queue the entity_clarify FIRST. Three outcomes
    // (insert / 23505 dedup / transport-fail) mirror the vendors path.
    let notifInserted = false;
    let notifDedupSkipped = false;
    if (willQueueNotif) {
      const { error: insertErr } = await supabase
        .from("notifications_inbox")
        .insert({
          user_id: userId,
          kind: "entity_clarify",
          subject: `Who is "${name}"?`,
          body: displaySuggested.length
            ? `Tap the closest, or type it. ${displaySuggested.join(" · ")}.`
            : "Tap to clarify the person's name or relationship.",
          dedup_key: `entity_clarify:${entity.id}`,
          priority: 0,
          payload: {
            kind_specific: {
              entity_id: entity.id,
              entity_name: name,
              suggested_answers: displaySuggested,
              alternatives,
              suggested_relationship: brainRelationship,
              confidence: brainConfidence ?? entity.confidence ?? 0,
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
    // actually mutated.
    const patch: Record<string, unknown> = {};
    if (brainProducedSomething && brainConfidence !== null) {
      patch.confidence = brainConfidence;
    }
    if (brainCanonical && brainCanonical !== entity.canonical_name) {
      patch.canonical_name = brainCanonical;
    }
    if (brainRelationship && brainRelationship !== entity.relationship) {
      patch.relationship = brainRelationship;
    }
    if (notifInserted) {
      patch.last_clarify_notif_at = new Date().toISOString();
    }
    if (Object.keys(patch).length > 0) {
      await supabase
        .from("entities")
        .update(patch)
        .eq("id", entity.id)
        .eq("user_id", userId);
    }

    if (notifInserted) {
      notifsSentToday += 1;
      queuedThisRun += 1;
    }
    void notifDedupSkipped;
  }

  await supabase
    .from("entity_backfill_progress")
    .update({
      cursor_entity_id: lastId,
      entities_processed: progress.entities_processed + processedThisRun,
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

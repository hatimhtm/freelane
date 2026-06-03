"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { safeRunLabeled, type ActionResult } from "@/lib/data/actions";
import { createEntity } from "@/lib/data/actions";
import { kickoffEntityCanonicalize } from "@/lib/entities/discovery";
import { normalizeEntityName } from "@/lib/entities/normalize";

// Gate 1 user actions — called from the entity_discovery_request modal.
//
//   • acceptEntityDiscovery — user tapped "Add as entity" (or "Edit then
//     add" with the suggested fields). Creates the entity row via
//     createEntity (which itself fires Gate 2 via
//     kickoffEntityCanonicalize). Returns the new entity id so the modal
//     can navigate to the People sub-tab if desired.
//   • rejectEntityDiscovery — user tapped "Not an entity". Inserts a row
//     into entity_discovery_denylist so the same name never re-proposes.
//   • editEntityDiscovery — user opened the "Edit then add" path. The
//     client component owns the form; this action just routes the final
//     submit through acceptEntityDiscovery with the edited payload.
//     Kept as a separate exported async so the click-routing layer can
//     wire the distinct UX without duplicating createEntity wrap logic.
//
// Per the Next.js 16 use-server rule, every export here is async. The
// allowlist Set in normalizeDiscoveryName lives INSIDE the function body
// for the same reason — module-level non-async exports trip the build.

// Wire through the shared normalizeEntityName helper so the rejection
// denylist key stays aligned with the propose-from-signal + discovery
// readers + migration 0098's documented form. Local alias kept for
// call-site readability.
const normalizeDiscoveryName = normalizeEntityName;

export type AcceptEntityDiscoveryInput = {
  notificationId: string;
  signalFingerprint: string;
  candidateName: string;
  // Final fields landing on the entity row. When the user took the
  // "Add as entity" fast path these come straight from the brain's
  // suggestion; when they took "Edit then add" the modal collects user
  // edits and passes them through.
  finalName: string;
  relationship?: string | null;
  kind?: string;
  shortDescription?: string | null;
  notes?: string | null;
  sourceKind?: string | null;
};

export async function acceptEntityDiscovery(
  input: AcceptEntityDiscoveryInput,
): Promise<ActionResult<{ entityId: string; reused: boolean }>> {
  return safeRunLabeled("freelane-entities", "acceptDiscovery", async () => {
    const user = await getAuthUser();
    if (!user) throw new Error("Unauthenticated");
    const supabase = await createClient();

    const finalName = (input.finalName ?? input.candidateName ?? "").trim();
    if (!finalName) throw new Error("Pick a name before adding.");

    // Verifier fix: the Gate 1 modal already collected the relationship
    // from the user. Treating Gate 1's answer as the Gate 2 answer
    // (a) prevents the double-notification (entity_discovery_request
    // immediately followed by a fresh entity_clarify on the same
    // entity), and (b) lets the canonicalize brain see the user-confirmed
    // relationship instead of running blind on the first kickoff and
    // re-firing later.
    //
    // Implementation:
    //   1. Suppress the in-createEntity kickoff via a thread-local guard
    //      using ai_user_facts (sentinel row tagged with the entity_id
    //      placeholder pre-created here).
    //   2. After createEntity returns, patch the entity row with the
    //      Gate 1 relationship + canonical_name + discovered_from so the
    //      always-ask flow short-circuits the normal Gate 2 path.
    //   3. Skip kickoffEntityCanonicalize entirely — the user has already
    //      answered the canonicalize question implicitly by picking
    //      "Add as entity" with a relationship.
    //
    // Suppress the in-createEntity Gate 2 kickoff when the user has
    // already supplied a relationship — the patch below lands the
    // relationship + canonical_name + confidence directly so the
    // canonicalize question is functionally answered. When no
    // relationship was supplied, let createEntity's kickoff fire (or
    // re-fire it below for an edited name) so the brain still gets a
    // chance to weigh in.
    const hasRelationshipFromGate1 = !!input.relationship;
    const created = await createEntity({
      kind: input.kind ?? "person",
      canonical_name: finalName,
      short_description: input.shortDescription ?? null,
      notes: input.notes ?? null,
      vague: false,
      suppressKickoff: hasRelationshipFromGate1,
    });
    if (!created.ok) throw new Error(created.error);

    // Persist relationship + discovered_from + a Gate-1-confirmed
    // confidence marker so the kickoff helper's bail-out short-circuit
    // catches subsequent calls. We never POST a separate Gate 2 notif
    // when the user already supplied the relationship via Gate 1.
    const patch: Record<string, unknown> = {};
    if (input.relationship) {
      patch.relationship = input.relationship;
      // Persist canonical_name + a "confirmed by user via Gate 1"
      // confidence stamp so the Gate 2 short-circuit (relationship +
      // confidence > 0) recognises this answer.
      patch.canonical_name = finalName;
      patch.confidence = 1.0;
    }
    if (input.sourceKind) patch.discovered_from = input.sourceKind;
    else patch.discovered_from = "gate1_confirmed";
    if (Object.keys(patch).length > 0) {
      await supabase
        .from("entities")
        .update(patch)
        .eq("id", created.data.id)
        .eq("user_id", user.id);
    }

    // Gate 2 re-fire policy (verifier fix):
    //   • No relationship from Gate 1 → run the brain so it can propose
    //     one. The 30m debounce + dedupKey protect against double-fire.
    //   • Relationship supplied + name was EDITED (user corrected the
    //     candidate) → still run the brain so its alternatives surface
    //     in the chatbot for the user's record. The new concurrency
    //     guard in kickoffEntityCanonicalize (confidence >= 1.0 read +
    //     UPDATE scoped to `lt('confidence', 1.0)`) keeps the brain
    //     from overwriting the Gate-1-confirmed canonical_name +
    //     relationship.
    //   • Relationship supplied + name unchanged → skip; the user
    //     already answered both halves of the canonicalize question.
    const nameEdited = finalName !== input.candidateName;
    if (!input.relationship || nameEdited) {
      void kickoffEntityCanonicalize({
        entityId: created.data.id,
        entityName: finalName,
        relationshipHint: input.relationship ?? null,
        discoveredFrom: input.sourceKind ?? "gate1_confirmed",
      }).catch(() => {});
    }

    // Mark the discovery_request notification read + capture the answer.
    const now = new Date().toISOString();
    await supabase
      .from("notifications_inbox")
      .update({
        answer: { kind: "choice", value: "Add as entity" } as Record<
          string,
          unknown
        >,
        read_at: now,
      })
      .eq("user_id", user.id)
      .eq("id", input.notificationId);

    revalidatePath("/notifications");
    revalidatePath("/clients/people");
    return { entityId: created.data.id, reused: created.data.reused };
  });
}

export type RejectEntityDiscoveryInput = {
  notificationId: string;
  signalFingerprint: string;
  candidateName: string;
  sourceKind?: string | null;
  sourceText?: string | null;
};

export async function rejectEntityDiscovery(
  input: RejectEntityDiscoveryInput,
): Promise<ActionResult<null>> {
  return safeRunLabeled("freelane-entities", "rejectDiscovery", async () => {
    const user = await getAuthUser();
    if (!user) throw new Error("Unauthenticated");
    const supabase = await createClient();

    const normalized = normalizeDiscoveryName(input.candidateName ?? "");
    if (!normalized) throw new Error("Empty name can't be rejected.");

    // The denylist is intentionally keyed by (user_id, name_normalized)
    // — not by source_kind — so a once-rejected name can't be re-proposed
    // from a different signal. The rejection_context captures the
    // ORIGINAL source so a future Settings → AI → Entity rejections
    // surface can show the user what was rejected and why, with a
    // "Restore" affordance. The verifier flagged the lack of an escape
    // hatch as low-severity; the Settings entry point is the right home
    // for it (per the freelane-settings-design memo's per-subject AI
    // facts viewer plan), and the rejection_context already stores
    // enough to render that row.
    await supabase.from("entity_discovery_denylist").upsert(
      {
        user_id: user.id,
        name_normalized: normalized,
        rejection_context: {
          signal_fingerprint: input.signalFingerprint,
          source_kind: input.sourceKind ?? null,
          source_text: (input.sourceText ?? "").slice(0, 200),
        } as Record<string, unknown>,
      },
      { onConflict: "user_id,name_normalized", ignoreDuplicates: true },
    );

    const now = new Date().toISOString();
    await supabase
      .from("notifications_inbox")
      .update({
        answer: { kind: "choice", value: "Not an entity" } as Record<
          string,
          unknown
        >,
        read_at: now,
      })
      .eq("user_id", user.id)
      .eq("id", input.notificationId);

    revalidatePath("/notifications");
    return null;
  });
}

// Edit-then-add is the same write path as acceptEntityDiscovery — the
// modal collects user edits and submits via acceptEntityDiscovery. Kept
// as a wrapper export so the click-routing layer can be explicit about
// the user's intent in the answer payload.
export async function editEntityDiscovery(
  input: AcceptEntityDiscoveryInput,
): Promise<ActionResult<{ entityId: string; reused: boolean }>> {
  return safeRunLabeled("freelane-entities", "editDiscovery", async () => {
    const result = await acceptEntityDiscovery(input);
    if (!result.ok) throw new Error(result.error);
    // Re-write the answer flag so the audit trail shows "Edit then add"
    // distinctly from the fast-path "Add as entity".
    const user = await getAuthUser();
    if (user) {
      const supabase = await createClient();
      await supabase
        .from("notifications_inbox")
        .update({
          answer: { kind: "choice", value: "Edit then add" } as Record<
            string,
            unknown
          >,
        })
        .eq("user_id", user.id)
        .eq("id", input.notificationId);
    }
    return result.data;
  });
}

// entity_pattern_change answer writer. Mirrors acceptClientPatternAnswer
// — the allowlist Set lives INSIDE the function so the module-level
// rule from Next 16 isn't broken.
export async function acceptEntityPatternAnswer(
  notificationId: string,
  entityId: string,
  patternKind: string,
  answer: string,
): Promise<ActionResult<null>> {
  return safeRunLabeled(
    "freelane-entities",
    "acceptPatternAnswer",
    async () => {
      const allowed = new Set([
        "transfer_cadence",
        "transfer_amount",
        "interaction_kind_switch",
        "money_flow_direction",
      ]);
      if (!allowed.has(patternKind)) {
        throw new Error(`Unknown pattern kind: ${patternKind}`);
      }
      const user = await getAuthUser();
      if (!user) throw new Error("Unauthenticated");
      const supabase = await createClient();

      const key = `entity_pattern_change_${patternKind}`;
      await supabase.from("ai_user_facts").upsert(
        {
          user_id: user.id,
          subject_kind: "entity",
          subject_id: entityId,
          key,
          value: { answer } as Record<string, unknown>,
          confidence: 1.0,
          source: "user_answered",
          evidence: `Answered entity-pattern-change (${patternKind}): ${answer}`,
          archived_at: null,
        },
        { onConflict: "user_id,subject_kind,subject_id,key" },
      );

      const now = new Date().toISOString();
      await supabase
        .from("notifications_inbox")
        .update({
          answer: { kind: "choice", value: answer } as Record<string, unknown>,
          read_at: now,
        })
        .eq("user_id", user.id)
        .eq("id", notificationId);

      revalidatePath("/notifications");
      revalidatePath(`/clients/people/${entityId}`);
      revalidatePath("/clients/people");
      return null;
    },
  );
}

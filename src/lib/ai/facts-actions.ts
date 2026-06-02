"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { safeRunLabeled, type ActionResult } from "@/lib/data/actions";
import {
  extractFactsFromNotes,
  type ExtractFactsResult,
} from "./brains/extract-facts-from-notes";
import {
  getFactsForSubject,
  projectFacts,
  type Fact,
  type FactSubjectKind,
} from "./facts";

// Next.js 16's "use server" rule rejects non-async RUNTIME exports
// (constants, pure helpers). TS types are erased at compile time and
// may be colocated here for caller convenience, but every RUNTIME
// reader / constant lives in the sibling facts.ts (server-only, not
// "use server"). Hold the line — mixing non-async runtime values into
// a "use server" file is what trips the build, not the type aliases.

export async function getFactsForSubjectAction(
  subjectKind: FactSubjectKind,
  subjectId: string | null,
): Promise<ActionResult<Fact[]>> {
  return safeRunLabeled("freelane-facts", "list", async () => {
    return await getFactsForSubject(subjectKind, subjectId);
  });
}

export type UpsertFactInput = {
  subjectKind: FactSubjectKind;
  subjectId: string | null;
  key: string;
  value: Record<string, unknown> | string;
  confidence?: number;
  source?: "user_answered" | "inferred" | "seeded";
  evidence?: string | null;
};

// UPSERTs a fact. Dynamic onConflict target so the partial-unique index
// pair (one WHERE subject_id is null, one WHERE subject_id is not null)
// from migration 0062 routes correctly. open-questions-actions.ts uses
// the same trick — mirror it exactly.
export async function upsertFact(
  input: UpsertFactInput,
): Promise<ActionResult<{ id: string | null }>> {
  return safeRunLabeled("freelane-facts", "upsert", async () => {
    const user = await getAuthUser();
    if (!user) throw new Error("Unauthenticated");
    const supabase = await createClient();
    const value =
      typeof input.value === "string" ? { answer: input.value } : input.value;
    const confidence = clampConfidence(input.confidence ?? 0.7);
    const onConflict = input.subjectId
      ? "user_id,subject_kind,subject_id,key"
      : "user_id,subject_kind,key";

    const { data } = await supabase
      .from("ai_user_facts")
      .upsert(
        {
          user_id: user.id,
          subject_kind: input.subjectKind,
          subject_id: input.subjectId,
          key: input.key,
          value: value as Record<string, unknown>,
          confidence,
          source: input.source ?? "inferred",
          evidence: input.evidence ?? null,
          // Un-archive on re-write so an old archived row revives with
          // the new value instead of leaving the live slot empty.
          archived_at: null,
        },
        { onConflict },
      )
      .select("id")
      .maybeSingle();
    if (input.subjectId) {
      revalidatePath(`/clients/${input.subjectId}`);
    }
    return { id: (data?.id as string) ?? null };
  });
}

export type EditFactPatch = {
  value?: Record<string, unknown> | string;
  confidence?: number;
  evidence?: string | null;
};

// Edit a fact in place. `key` is read-only by design — the partial-unique
// indexes treat key as part of the slot identity, so renaming would
// collide silently. The UI surfaces value + confidence + evidence only.
export async function editFact(
  factId: string,
  patch: EditFactPatch,
): Promise<ActionResult<null>> {
  return safeRunLabeled("freelane-facts", "edit", async () => {
    const user = await getAuthUser();
    if (!user) throw new Error("Unauthenticated");
    const supabase = await createClient();
    const update: Record<string, unknown> = {};
    if (patch.value !== undefined) {
      update.value =
        typeof patch.value === "string" ? { answer: patch.value } : patch.value;
    }
    if (patch.confidence !== undefined) {
      update.confidence = clampConfidence(patch.confidence);
    }
    if (patch.evidence !== undefined) {
      update.evidence = patch.evidence;
    }
    // User-edited facts are user_answered authority — bump source so the
    // next extraction pass doesn't overwrite the manual edit with an
    // inferred value.
    update.source = "user_answered";

    const { data: row } = await supabase
      .from("ai_user_facts")
      .select("subject_id")
      .eq("user_id", user.id)
      .eq("id", factId)
      .maybeSingle();
    await supabase
      .from("ai_user_facts")
      .update(update)
      .eq("user_id", user.id)
      .eq("id", factId);
    const subjectId = row?.subject_id as string | null | undefined;
    if (subjectId) revalidatePath(`/clients/${subjectId}`);
    return null;
  });
}

// Soft-archive (NOT hard delete) so the audit trail survives. Live readers
// in facts.ts filter archived_at is null; the row stays around for the
// extraction brain to skip on the next pass.
export async function deleteFact(
  factId: string,
): Promise<ActionResult<null>> {
  return safeRunLabeled("freelane-facts", "delete", async () => {
    const user = await getAuthUser();
    if (!user) throw new Error("Unauthenticated");
    const supabase = await createClient();
    const now = new Date().toISOString();
    const { data: row } = await supabase
      .from("ai_user_facts")
      .select("subject_id")
      .eq("user_id", user.id)
      .eq("id", factId)
      .maybeSingle();
    await supabase
      .from("ai_user_facts")
      .update({ archived_at: now })
      .eq("user_id", user.id)
      .eq("id", factId);
    const subjectId = row?.subject_id as string | null | undefined;
    if (subjectId) revalidatePath(`/clients/${subjectId}`);
    return null;
  });
}

// Notification answer → ai_user_facts write. Wired into KIND_HANDLERS for
// client_pattern_change so a multi-choice selection persists as a fact
// the brain reads on the next round.
export async function acceptClientPatternAnswer(
  notificationId: string,
  clientId: string,
  patternKind: string,
  answer: string,
): Promise<ActionResult<null>> {
  return safeRunLabeled("freelane-facts", "patternAnswer", async () => {
    // patternKind is sourced from the notification payload — and a
    // tampered or malformed payload could otherwise stuff an arbitrary
    // key suffix into ai_user_facts. Allowlist before composing the key.
    // The Set is declared inside the function so it doesn't leak through
    // the "use server" registry (Next 16 forbids non-async exports here).
    const allowed = new Set(["payment_method", "project_size_shift"]);
    if (!allowed.has(patternKind)) {
      throw new Error(`Unknown pattern kind: ${patternKind}`);
    }
    const user = await getAuthUser();
    if (!user) throw new Error("Unauthenticated");
    const supabase = await createClient();

    const key = `pattern_change_${patternKind}`;
    await supabase.from("ai_user_facts").upsert(
      {
        user_id: user.id,
        subject_kind: "client",
        subject_id: clientId,
        key,
        value: { answer } as Record<string, unknown>,
        confidence: 1.0,
        source: "user_answered",
        evidence: `Answered pattern-change notification (${patternKind}): ${answer}`,
        archived_at: null,
      },
      { onConflict: "user_id,subject_kind,subject_id,key" },
    );

    // Mark the notification read + store the answer so the row leaves the
    // unread bell and stays auditable. Mirrors submitNotificationAnswerAction.
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
    revalidatePath(`/clients/${clientId}`);
    revalidatePath("/clients");
    return null;
  });
}

// Notes → Facts extraction trigger. Called from the client dialog (30s
// debounce) AFTER a successful save of notes. Loads live facts, runs the
// extraction brain, UPSERTs new facts, and archives keys the new notes
// no longer support so the AI's view converges with the writing.
export async function extractClientFactsAction(
  clientId: string,
  notesText: string,
): Promise<ActionResult<ExtractFactsResult>> {
  return safeRunLabeled("freelane-facts", "extract", async () => {
    const user = await getAuthUser();
    if (!user) throw new Error("Unauthenticated");
    const supabase = await createClient();

    const liveFacts = await getFactsForSubject("client", clientId);
    const projected = projectFacts(liveFacts);

    const result = await extractFactsFromNotes({
      subjectKind: "client",
      subjectId: clientId,
      fullNotesText: notesText,
      previouslyExtractedFacts: projected,
    });

    // Batched UPSERT — one round-trip instead of N. Same partial-unique
    // index path (subject_id-not-null case) so the conflict target is
    // identical to the prior per-row UPSERT.
    if (result.facts.length > 0) {
      await supabase.from("ai_user_facts").upsert(
        result.facts.map((f) => ({
          user_id: user.id,
          subject_kind: "client",
          subject_id: clientId,
          key: f.key,
          value: { answer: f.value } as Record<string, unknown>,
          confidence: clampConfidence(f.confidence),
          source: "inferred",
          evidence: f.evidence_excerpt,
          archived_at: null,
        })),
        { onConflict: "user_id,subject_kind,subject_id,key" },
      );
    }

    // Archive removed keys in a single UPDATE … WHERE key IN (…). Skip any
    // key the user has manually marked user_answered — the user's authority
    // outranks an extraction diff.
    if (result.removed_facts.length > 0) {
      const now = new Date().toISOString();
      await supabase
        .from("ai_user_facts")
        .update({ archived_at: now })
        .eq("user_id", user.id)
        .eq("subject_kind", "client")
        .eq("subject_id", clientId)
        .in("key", result.removed_facts)
        .neq("source", "user_answered");
    }

    revalidatePath(`/clients/${clientId}`);
    return result;
  });
}

function clampConfidence(c: number): number {
  if (!Number.isFinite(c)) return 0.5;
  return Math.max(0, Math.min(1, c));
}

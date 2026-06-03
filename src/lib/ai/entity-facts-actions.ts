"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { safeRunLabeled, type ActionResult } from "@/lib/data/actions";
import {
  extractFactsFromNotes,
  type ExtractFactsResult,
} from "./brains/extract-facts-from-notes";
import { getFactsForSubject, projectFacts } from "./facts";

// Entities workflow — entity-scoped facts.
//
// Mirrors src/lib/ai/facts-actions.ts:extractClientFactsAction but with
// subjectKind='entity'. The notes textarea on the entity detail sheet
// fires this action 30s after the last keystroke (debounced client-side
// — same pattern as Clients) so the brain reads the saved notes and
// upserts structured facts onto ai_user_facts (subject_kind='entity',
// subject_id=entity_id).
//
// Per the Next 16 use-server rule, every export here is async. The
// extractFactsFromNotes brain already lives in brains/ and is safe to
// import — its cache slot is scoped by (subjectKind, subjectId) so the
// 'entity' slot can't collide with the 'client' slot.

function clampConfidence(c: number): number {
  if (!Number.isFinite(c)) return 0.5;
  return Math.max(0, Math.min(1, c));
}

export async function extractEntityFactsAction(
  entityId: string,
  notesText: string,
): Promise<ActionResult<ExtractFactsResult>> {
  return safeRunLabeled("freelane-entity-facts", "extract", async () => {
    const user = await getAuthUser();
    if (!user) throw new Error("Unauthenticated");
    const supabase = await createClient();

    const liveFacts = await getFactsForSubject("entity", entityId);
    const projected = projectFacts(liveFacts);

    const result = await extractFactsFromNotes({
      subjectKind: "entity",
      subjectId: entityId,
      fullNotesText: notesText,
      previouslyExtractedFacts: projected,
    });

    if (result.facts.length > 0) {
      await supabase.from("ai_user_facts").upsert(
        result.facts.map((f) => ({
          user_id: user.id,
          subject_kind: "entity",
          subject_id: entityId,
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

    if (result.removed_facts.length > 0) {
      const now = new Date().toISOString();
      await supabase
        .from("ai_user_facts")
        .update({ archived_at: now })
        .eq("user_id", user.id)
        .eq("subject_kind", "entity")
        .eq("subject_id", entityId)
        .in("key", result.removed_facts)
        .neq("source", "user_answered");
    }

    revalidatePath(`/clients/people/${entityId}`);
    return result;
  });
}

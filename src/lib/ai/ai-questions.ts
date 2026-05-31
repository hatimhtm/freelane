import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { logEvent } from "@/lib/data/events";
import type {
  AiQuestion,
  AiQuestionKind,
  AiQuestionSourceType,
} from "@/lib/supabase/types";

function snippet(text: string, max = 80): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

// Inserts a new question into the AI's inbox. Default priority 5 (mid). The
// caller in curiosity-sweep.ts decides priority + provides the raw context
// blob so the AI can reconstruct WHY it asked without a second round-trip.
export async function queueAiQuestion(input: {
  question: string;
  kind: AiQuestionKind;
  context: Record<string, unknown>;
  options?: string[];
  sourceEntityType?: AiQuestionSourceType;
  sourceEntityId?: string;
  priority?: number;
}): Promise<AiQuestion> {
  const user = await getAuthUser();
  if (!user) throw new Error("Not authenticated.");
  const supabase = await createClient();
  const priority = input.priority ?? 5;
  const { data, error } = await supabase
    .from("ai_questions")
    .insert({
      user_id: user.id,
      question: input.question,
      kind: input.kind,
      context: input.context,
      options: input.options ?? null,
      source_entity_type: input.sourceEntityType ?? null,
      source_entity_id: input.sourceEntityId ?? null,
      priority,
    })
    .select("*")
    .single();
  if (error) throw error;
  const row = data as AiQuestion;
  await logEvent({
    userId: user.id,
    kind: "ai_question.queued",
    title: `AI asked: ${snippet(input.question)}`,
    entityType: "ai_question",
    entityId: row.id,
    metadata: { kind: input.kind, priority },
  });
  return row;
}

// Marks a question answered, folds the Q+A into user_memory_entries as a
// user_note so the next memory consolidation absorbs it, then kicks off
// consolidation in the background (matches the recordUserMemoryNote pattern).
// answerNotes is the free-text reply that pairs with the chip per the
// universal notes rule (Tier 1, migration 0029).
export async function answerAiQuestion(
  id: string,
  answer: string,
  answerNotes?: string,
): Promise<void> {
  const user = await getAuthUser();
  if (!user) throw new Error("Not authenticated.");
  const trimmed = answer.trim();
  const trimmedNotes = (answerNotes ?? "").trim();
  if (!trimmed && !trimmedNotes) throw new Error("Answer is empty.");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_questions")
    .update({
      answered_at: new Date().toISOString(),
      answer: trimmed || null,
      answer_notes: trimmedNotes || null,
    })
    .eq("id", id)
    .eq("user_id", user.id)
    .select("*")
    .single();
  if (error) throw error;
  const row = data as AiQuestion;
  try {
    const memoryLine = trimmedNotes
      ? `Q: ${row.question} / A: ${trimmed || "(chip skipped)"} / Notes: ${trimmedNotes}`
      : `Q: ${row.question} / A: ${trimmed}`;
    await supabase.from("user_memory_entries").insert({
      user_id: user.id,
      content: memoryLine,
      source: "user_note",
    });
  } catch {
    // Best-effort — the answer is already persisted on ai_questions.
  }
  await logEvent({
    userId: user.id,
    kind: "ai_question.answered",
    title: `Answered: ${snippet(row.question)}`,
    entityType: "ai_question",
    entityId: row.id,
    metadata: { kind: row.kind, has_notes: !!trimmedNotes },
  });
  void import("@/lib/ai/user-memory").then((m) => m.consolidateUserMemory()).catch(() => {});
}

// Soft-dismiss — the row stays for the curiosity sweep to learn from. Repeated
// dismissals of a given kind are the signal the AI uses upstream to ask less
// (that read-side logic lives in curiosity-sweep.ts).
export async function dismissAiQuestion(id: string): Promise<void> {
  const user = await getAuthUser();
  if (!user) throw new Error("Not authenticated.");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_questions")
    .update({ dismissed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id,question,kind")
    .single();
  if (error) throw error;
  const row = data as Pick<AiQuestion, "id" | "question" | "kind">;
  await logEvent({
    userId: user.id,
    kind: "ai_question.dismissed",
    title: `Dismissed: ${snippet(row.question)}`,
    entityType: "ai_question",
    entityId: row.id,
    metadata: { kind: row.kind },
  });
}

// The inbox. Priority asc (1 = most urgent), then newest first within a band.
export async function getOpenAiQuestions(limit = 10): Promise<AiQuestion[]> {
  const user = await getAuthUser();
  if (!user) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_questions")
    .select("*")
    .eq("user_id", user.id)
    .is("answered_at", null)
    .is("dismissed_at", null)
    .order("priority", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return [];
  return (data ?? []) as AiQuestion[];
}

// Feeds back into the curiosity sweep so it can read its own track record +
// avoid re-asking things Max already answered.
export async function getRecentlyAnsweredQuestions(limit = 20): Promise<AiQuestion[]> {
  const user = await getAuthUser();
  if (!user) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_questions")
    .select("*")
    .eq("user_id", user.id)
    .not("answered_at", "is", null)
    .order("answered_at", { ascending: false })
    .limit(limit);
  if (error) return [];
  return (data ?? []) as AiQuestion[];
}

"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { safeRunLabeled, type ActionResult } from "@/lib/data/actions";
import { postNotification } from "@/lib/notifications/dispatcher";
import { pickNextQuestion } from "./brains/pick-next-question";
import { invalidateBrainCache } from "./cache";
import { BRAIN_KEYS } from "./cache-keys";

// Lifecycle for the chatbot's clarifying-question system.
//
// answerOpenQuestion  — user answered (chat OR notification modal). Writes
//                       the fact at confidence=1.0 (source='user_answered')
//                       and closes the question.
// dismissOpenQuestion — user skipped. Bumps dismissal_count and feeds the
//                       backoff threshold in pick-next-question.
// enqueueOpenQuestion — brain (or seed) drops a question on the queue.
//                       Idempotent on (user, subject, question_key).
// surfaceNextOpenQuestion — pick-next + dispatch a notification.

type SubjectKind = "user" | "client" | "vendor" | "project" | "plan" | "entity";

export async function answerOpenQuestion(
  questionId: string,
  answer: string,
): Promise<ActionResult<null>> {
  return safeRunLabeled("freelane-chat", "answerQuestion", async () => {
    const user = await getAuthUser();
    if (!user) throw new Error("Unauthenticated");
    const supabase = await createClient();

    const { data: q } = await supabase
      .from("ai_open_questions")
      .select(
        "id,subject_kind,subject_id,fact_key,question_text",
      )
      .eq("user_id", user.id)
      .eq("id", questionId)
      .maybeSingle();
    if (!q) throw new Error("Question not found.");

    // Upsert the fact. value is jsonb and the column is typed as
    // Record<string,unknown> in supabase-js, so we wrap the free-text
    // answer in { answer } — round-trips cleanly at every reader (the
    // snapshot stringifies it; pick-next reads confidence only).
    await supabase.from("ai_user_facts").upsert(
      {
        user_id: user.id,
        subject_kind: q.subject_kind as SubjectKind,
        subject_id: (q.subject_id as string | null) ?? null,
        key: q.fact_key as string,
        value: { answer } as Record<string, unknown>,
        confidence: 1.0,
        source: "user_answered",
        evidence: `From open question: ${q.question_text}`,
      },
      // Cover both partial-unique indexes by manual conflict target.
      {
        onConflict: q.subject_id
          ? "user_id,subject_kind,subject_id,key"
          : "user_id,subject_kind,key",
      },
    );

    await supabase
      .from("ai_open_questions")
      .update({
        status: "answered",
        answered_at: new Date().toISOString(),
      })
      .eq("user_id", user.id)
      .eq("id", questionId);

    // Snapshot must regenerate — a new fact landed.
    await invalidateBrainCache([
      BRAIN_KEYS.STATE_SNAPSHOT,
      BRAIN_KEYS.PICK_NEXT_QUESTION,
    ]);

    revalidatePath("/today");
    revalidatePath("/notifications");
    return null;
  });
}

export async function dismissOpenQuestion(
  questionId: string,
): Promise<ActionResult<null>> {
  return safeRunLabeled("freelane-chat", "dismissQuestion", async () => {
    const user = await getAuthUser();
    if (!user) throw new Error("Unauthenticated");
    const supabase = await createClient();

    const { data: existing } = await supabase
      .from("ai_open_questions")
      .select("dismissal_count")
      .eq("user_id", user.id)
      .eq("id", questionId)
      .maybeSingle();
    const nextCount = ((existing?.dismissal_count as number | null) ?? 0) + 1;

    await supabase
      .from("ai_open_questions")
      .update({
        status: "dismissed",
        dismissed_at: new Date().toISOString(),
        dismissal_count: nextCount,
      })
      .eq("user_id", user.id)
      .eq("id", questionId);

    await invalidateBrainCache(BRAIN_KEYS.PICK_NEXT_QUESTION);
    revalidatePath("/notifications");
    return null;
  });
}

export type EnqueueQuestionInput = {
  questionKey: string;
  questionText: string;
  suggestedAnswers?: string[];
  freeText?: boolean;
  priority?: number;
  factKey: string;
  subjectKind?: SubjectKind;
  subjectId?: string | null;
  confidenceGain?: number;
};

// Cooldown window before a dismissed question can be re-queued. Below
// this age the brain's re-enqueue is a no-op (the user just said no);
// past this age the same fact gap can resurface with a fresh question
// row. Without this, the queue permanently loses every question the user
// has skipped once — even ones the brain still cares about.
const DISMISSED_REQUEUE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

export async function enqueueOpenQuestion(
  input: EnqueueQuestionInput,
): Promise<ActionResult<{ id: string | null }>> {
  return safeRunLabeled("freelane-chat", "enqueueQuestion", async () => {
    const user = await getAuthUser();
    if (!user) throw new Error("Unauthenticated");
    const supabase = await createClient();

    const subjectKind: SubjectKind = input.subjectKind ?? "user";
    const subjectId = input.subjectId ?? null;

    // Manual conflict-handling: look up the existing row first so we can
    // decide between (a) no-op (already queued / asked / answered), (b)
    // resurrect a dismissed row past the cooldown, (c) insert fresh.
    const existingQuery = supabase
      .from("ai_open_questions")
      .select("id,status,dismissed_at,dismissal_count")
      .eq("user_id", user.id)
      .eq("subject_kind", subjectKind)
      .eq("question_key", input.questionKey);
    const existingScoped = subjectId
      ? existingQuery.eq("subject_id", subjectId)
      : existingQuery.is("subject_id", null);
    const { data: existing } = await existingScoped.maybeSingle();

    const sharedFields = {
      question_text: input.questionText,
      suggested_answers: (input.suggestedAnswers ?? []) as unknown as Record<
        string,
        unknown
      >,
      free_text: input.freeText ?? false,
      priority: input.priority ?? 0.5,
      fact_key: input.factKey,
      confidence_gain: input.confidenceGain ?? 0.3,
    };

    if (existing) {
      const status = existing.status as string;
      if (status !== "dismissed" && status !== "expired") {
        // queued / asked / answered — leave alone.
        return { id: (existing.id as string) ?? null };
      }
      const dismissedAtIso = existing.dismissed_at as string | null;
      const dismissedAtMs = dismissedAtIso
        ? new Date(dismissedAtIso).getTime()
        : 0;
      if (
        status === "dismissed" &&
        dismissedAtMs > 0 &&
        Date.now() - dismissedAtMs < DISMISSED_REQUEUE_COOLDOWN_MS
      ) {
        // Too soon — respect the user's "not now".
        return { id: (existing.id as string) ?? null };
      }
      // Past the cooldown (or 'expired'): reset to queued. dismissal_count
      // stays so the backoff window still sees the history.
      await supabase
        .from("ai_open_questions")
        .update({
          ...sharedFields,
          status: "queued",
          asked_at: null,
          dismissed_at: null,
          last_notification_id: null,
        })
        .eq("user_id", user.id)
        .eq("id", existing.id as string);
      return { id: (existing.id as string) ?? null };
    }

    const { data } = await supabase
      .from("ai_open_questions")
      .insert({
        user_id: user.id,
        subject_kind: subjectKind,
        subject_id: subjectId,
        question_key: input.questionKey,
        status: "queued",
        ...sharedFields,
      })
      .select("id")
      .maybeSingle();

    return { id: (data?.id as string) ?? null };
  });
}

export async function surfaceNextOpenQuestion(): Promise<
  ActionResult<{ surfaced: boolean }>
> {
  return safeRunLabeled("freelane-chat", "surfaceNext", async () => {
    const user = await getAuthUser();
    if (!user) return { surfaced: false };
    const picked = await pickNextQuestion();
    if (!picked) return { surfaced: false };

    const supabase = await createClient();

    // Dispatch the notification first — its returned id seeds
    // last_notification_id on the question. payload.choices /
    // payload.freeText drives the existing click-routing renderer.
    await postNotification({
      kind: "ai_clarifying_question",
      subject: "A quick question",
      body: picked.questionText,
      priority: 0,
      payload: {
        choices: picked.suggestedAnswers,
        freeText: picked.freeText,
        kind_specific: { questionId: picked.questionId },
      },
    });

    await supabase
      .from("ai_open_questions")
      .update({ status: "asked", asked_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .eq("id", picked.questionId);

    return { surfaced: true };
  });
}

// T32 — bootstrap a small fixed set of starter open-questions on first run
// so the bidirectional loop has content while the brain is still warming
// up. Idempotent via the upsert ignoreDuplicates path; safe to call from
// the chatbot context provider on first modal open.
export async function seedInitialOpenQuestions(): Promise<ActionResult<null>> {
  return safeRunLabeled("freelane-chat", "seedQuestions", async () => {
    const SEEDS: EnqueueQuestionInput[] = [
      {
        questionKey: "user.daily_wake_time",
        questionText: "When do you usually start your day?",
        suggestedAnswers: ["Before 7am", "7-9am", "After 9am"],
        priority: 0.4,
        factKey: "daily_wake_time",
      },
      {
        questionKey: "user.cigarette_brand",
        questionText: "Which brand do you smoke?",
        freeText: true,
        priority: 0.3,
        factKey: "cigarette_brand",
      },
      {
        questionKey: "user.coffee_habit",
        questionText: "Coffee — at home or out?",
        suggestedAnswers: ["At home", "Out", "Both"],
        priority: 0.35,
        factKey: "coffee_habit",
      },
      {
        questionKey: "user.weekend_pattern",
        questionText: "Weekends — quiet at home, or out and about?",
        suggestedAnswers: ["Quiet at home", "Out and about", "Mix"],
        priority: 0.3,
        factKey: "weekend_pattern",
      },
    ];
    for (const seed of SEEDS) {
      await enqueueOpenQuestion(seed);
    }
    return null;
  });
}

import "server-only";

import { Type } from "@google/genai";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { gemini, hasGemini, HEAVY_MODEL } from "../models";
import { withBrainCache, fingerprintFromIds } from "../cache";
import { BRAIN_KEYS } from "../cache-keys";
import { getFreelaneStateSnapshot } from "../freelane-state-snapshot";

// Pro brain: pick the ONE highest-value clarifying question to surface
// next. Value = priority * (1 - existing_confidence). Backoff: if the
// user dismissed 3+ questions in the last 48h (any 3, not necessarily
// consecutive — the spec's "consecutive" reading would need a per-user
// counter we don't store yet), raise the gain threshold so only
// high-value questions surface until they re-engage.

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    questionId: { type: Type.STRING, nullable: true },
    rationale: { type: Type.STRING },
  },
} as const;

const SYSTEM_PROMPT = `You are picking the next clarifying question to ask a freelance dev about themselves. The goal is to fill the gap that would change the most about how their money brain thinks.

Hard rules:
- Pick at most ONE questionId from the candidates given.
- Prefer questions about HABITS over questions about preferences (habits drive numbers).
- Skip duplicates of facts that already have high confidence in the snapshot.
- If NONE of the candidates feel worth asking right now, return questionId=null.
- Plain reasoning. NEVER use: "you should", "consider", "amazing".

Return ONLY the JSON.`;

export type PickedQuestion = {
  questionId: string;
  questionText: string;
  suggestedAnswers: string[];
  freeText: boolean;
  factKey: string;
};

const DISMISSAL_WINDOW_MS = 48 * 60 * 60 * 1000;

export async function pickNextQuestion(): Promise<PickedQuestion | null> {
  const user = await getAuthUser();
  if (!user) return null;
  const supabase = await createClient();

  // Pull queued questions + per-fact existing confidence.
  const [{ data: questions }, { data: facts }, { data: recentDismissals }] =
    await Promise.all([
      supabase
        .from("ai_open_questions")
        .select("*")
        .eq("user_id", user.id)
        .eq("status", "queued")
        .order("priority", { ascending: false })
        .limit(20),
      supabase
        .from("ai_user_facts")
        .select("subject_kind,subject_id,key,confidence")
        .eq("user_id", user.id),
      supabase
        .from("ai_open_questions")
        .select("dismissed_at")
        .eq("user_id", user.id)
        .eq("status", "dismissed")
        .gte("dismissed_at", new Date(Date.now() - DISMISSAL_WINDOW_MS).toISOString())
        .order("dismissed_at", { ascending: false }),
    ]);

  if (!questions || questions.length === 0) return null;

  // Key the confidence map on (subject_kind, subject_id, key) so a
  // user-scoped "monthly_income" doesn't shadow a client-scoped
  // "monthly_income" for a specific client (or vice versa). Without
  // this, the first entity-aware question to ship silently mismatches.
  const factScopeKey = (
    subjectKind: string,
    subjectId: string | null | undefined,
    key: string,
  ) => `${subjectKind}::${subjectId ?? ""}::${key}`;

  const confidenceByScope = new Map<string, number>();
  for (const f of facts ?? []) {
    const sk = factScopeKey(
      f.subject_kind as string,
      (f.subject_id as string | null) ?? null,
      f.key as string,
    );
    const c = Number(f.confidence ?? 0);
    if (!confidenceByScope.has(sk) || (confidenceByScope.get(sk) ?? 0) < c) {
      confidenceByScope.set(sk, c);
    }
  }

  // Backoff: 3+ dismissals in 48h raises the gain threshold to 0.5.
  const dismissalsRecent = (recentDismissals ?? []).length;
  const threshold = dismissalsRecent >= 3 ? 0.5 : 0;

  const ranked = questions
    .map((q) => {
      const sk = factScopeKey(
        q.subject_kind as string,
        (q.subject_id as string | null) ?? null,
        q.fact_key as string,
      );
      const existing = confidenceByScope.get(sk) ?? 0;
      const value = Number(q.priority) * (1 - existing);
      return { q, value };
    })
    .filter((r) => r.value >= threshold)
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);

  if (ranked.length === 0) return null;

  // If the top candidate is clearly highest-value (gap > 0.25), skip the
  // Pro call and use it directly — saves a token round-trip on obvious
  // picks. The Pro arbitration kicks in only when several candidates are
  // close in value.
  const top = ranked[0];
  const gap = ranked.length > 1 ? top.value - ranked[1].value : 1;
  let chosen = top.q;

  if (gap < 0.25 && hasGemini()) {
    const fp = await fingerprintFromIds([
      "pick",
      ...ranked.map((r) => String(r.q.id)),
      String(threshold),
    ]);
    const cached = await withBrainCache<{ questionId: string | null }>({
      brainKey: BRAIN_KEYS.PICK_NEXT_QUESTION,
      fingerprint: fp,
      phtDayAnchored: false,
      regen: async () => {
        // Snapshot fetch lives inside the regen closure so a PICK_NEXT_QUESTION
        // cache hit short-circuits before we round-trip Supabase for the
        // (also-cached) state snapshot. Saves a needless select on the hot
        // path; matters most for rapid-fire pick calls.
        const snapshot = await getFreelaneStateSnapshot().catch(() => null);
        try {
          const candList = ranked
            .map(
              (r) =>
                `- ${r.q.id}: "${r.q.question_text}" (key=${r.q.fact_key}, priority=${r.q.priority}, value=${r.value.toFixed(2)})`,
            )
            .join("\n");
          // Snapshot lives in systemInstruction (alongside SYSTEM_PROMPT) so
          // the heavy ~4k chars stay byte-stable across rapid pick calls —
          // only the candidate list (which varies) rides in `contents`. This
          // lets Gemini's implicit auto-caching dedupe the snapshot prefix
          // across calls. Contents stays minimal so the variable part is
          // small.
          const systemBlock = `${SYSTEM_PROMPT}

==============================
STATE SNAPSHOT
==============================
${(snapshot?.text ?? "(snapshot unavailable)").slice(0, 4000)}`;
          const prompt = `CANDIDATE QUESTIONS:
${candList}

Pick ONE questionId or null. Return JSON.`;
          const res = await gemini().models.generateContent({
            model: HEAVY_MODEL,
            contents: prompt,
            config: {
              systemInstruction: systemBlock,
              temperature: 0.3,
              responseMimeType: "application/json",
              responseSchema: RESPONSE_SCHEMA,
            },
          });
          const parsed = JSON.parse((res.text ?? "{}").trim()) as {
            questionId?: string | null;
          };
          return { questionId: parsed.questionId ?? null };
        } catch {
          return { questionId: top.q.id as string };
        }
      },
    });
    const pickedId = cached?.payload.questionId ?? top.q.id;
    const found = ranked.find((r) => r.q.id === pickedId);
    if (found) chosen = found.q;
  }

  return {
    questionId: chosen.id as string,
    questionText: chosen.question_text as string,
    suggestedAnswers: Array.isArray(chosen.suggested_answers)
      ? (chosen.suggested_answers as string[])
      : [],
    freeText: !!chosen.free_text,
    factKey: chosen.fact_key as string,
  };
}

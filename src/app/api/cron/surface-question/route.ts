import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

// GET /api/cron/surface-question
//
// Daily (PHT-midnight aligned) cron. Two responsibilities:
//
//   1. Stale 'asked' recycle. Any question with status='asked' whose
//      asked_at is older than RECYCLE_AFTER_MS gets flipped back to
//      'queued' (so it can re-surface) — or to 'expired' if its
//      dismissal_count has already crossed EXPIRE_DISMISSAL_THRESHOLD
//      (give up, the user clearly isn't engaging with this one).
//
//   2. Daily picker. For every user with at least one queued question,
//      pick the highest-value queued question (priority * (1 -
//      existing_confidence)) and dispatch it as an ai_clarifying_question
//      notification. Without this the bidirectional loop only fires on
//      explicit user actions — an idle user would never see a question.
//
// Why service-client + per-user-direct-writes: postNotification() relies
// on auth context, which the cron doesn't have. The math here is the
// deterministic value-ranking half of pick-next-question; the Pro
// arbitration only matters when several candidates are close, and on a
// daily background tick the deterministic top is the right pick.
//
// Auth: requires Authorization: Bearer ${CRON_SECRET} OR a Vercel cron
// request (x-vercel-cron header). The route is in PUBLIC_PATHS in
// lib/supabase/middleware.ts so cron invocations without session cookies
// reach this handler — the auth check below is the only gate.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const RECYCLE_AFTER_MS = 7 * 24 * 60 * 60 * 1000; // 7d untouched -> back to queued
const EXPIRE_DISMISSAL_THRESHOLD = 3; // 3+ dismissals + stale = expire

type OpenQuestionRow = {
  id: string;
  user_id: string;
  subject_kind: string;
  subject_id: string | null;
  question_text: string;
  priority: number;
  fact_key: string;
  suggested_answers: unknown;
  free_text: boolean;
};

type FactRow = {
  subject_kind: string;
  subject_id: string | null;
  key: string;
  confidence: number | string;
};

function scopeKey(
  subjectKind: string,
  subjectId: string | null,
  key: string,
): string {
  return `${subjectKind}::${subjectId ?? ""}::${key}`;
}

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization") ?? "";
  const vercelCron = req.headers.get("x-vercel-cron");
  const bearerOk = !!cronSecret && authHeader === `Bearer ${cronSecret}`;
  const vercelOk = !!vercelCron;
  if (!bearerOk && !vercelOk) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  try {
    const supabase = createServiceClient();
    const now = Date.now();
    const recycleCutoff = new Date(now - RECYCLE_AFTER_MS).toISOString();

    // -------- (1) Stale 'asked' recycle --------
    // Pull stale asked rows in one round-trip and partition into recycle
    // vs expire client-side. Keeps the logic auditable and avoids a
    // SECURITY DEFINER SQL function for what's effectively a sweep.
    const { data: staleAsked } = await supabase
      .from("ai_open_questions")
      .select("id,dismissal_count")
      .eq("status", "asked")
      .lt("asked_at", recycleCutoff);

    const toExpire: string[] = [];
    const toRecycle: string[] = [];
    for (const row of (staleAsked ?? []) as Array<{
      id: string;
      dismissal_count: number | null;
    }>) {
      const dc = Number(row.dismissal_count ?? 0);
      if (dc >= EXPIRE_DISMISSAL_THRESHOLD) toExpire.push(row.id);
      else toRecycle.push(row.id);
    }
    let recycled = 0;
    let expired = 0;
    if (toRecycle.length > 0) {
      const { error: recErr } = await supabase
        .from("ai_open_questions")
        .update({
          status: "queued",
          asked_at: null,
          last_notification_id: null,
        })
        .in("id", toRecycle);
      if (!recErr) recycled = toRecycle.length;
    }
    if (toExpire.length > 0) {
      const { error: expErr } = await supabase
        .from("ai_open_questions")
        .update({ status: "expired" })
        .in("id", toExpire);
      if (!expErr) expired = toExpire.length;
    }

    // -------- (2) Daily picker per user --------
    // Find every distinct user with at least one queued question. We
    // intentionally don't iterate auth.users — only users with actual
    // queue depth need a dispatch on a given day.
    const { data: queuedRows } = await supabase
      .from("ai_open_questions")
      .select(
        "id,user_id,subject_kind,subject_id,question_text,priority,fact_key,suggested_answers,free_text",
      )
      .eq("status", "queued");

    // Group queued questions by user.
    const byUser = new Map<string, OpenQuestionRow[]>();
    for (const row of (queuedRows ?? []) as OpenQuestionRow[]) {
      const list = byUser.get(row.user_id) ?? [];
      list.push(row);
      byUser.set(row.user_id, list);
    }

    let surfaced = 0;
    for (const [userId, questions] of byUser.entries()) {
      // Per-user facts for confidence-by-scope.
      const { data: facts } = await supabase
        .from("ai_user_facts")
        .select("subject_kind,subject_id,key,confidence")
        .eq("user_id", userId);

      const confidenceByScope = new Map<string, number>();
      for (const f of (facts ?? []) as FactRow[]) {
        const sk = scopeKey(f.subject_kind, f.subject_id, f.key);
        const c = Number(f.confidence ?? 0);
        if (!confidenceByScope.has(sk) || (confidenceByScope.get(sk) ?? 0) < c) {
          confidenceByScope.set(sk, c);
        }
      }

      // 48h dismissal backoff (mirror pick-next-question.ts).
      const dismissalWindow = new Date(now - 48 * 60 * 60 * 1000).toISOString();
      const { data: dismissals } = await supabase
        .from("ai_open_questions")
        .select("id")
        .eq("user_id", userId)
        .eq("status", "dismissed")
        .gte("dismissed_at", dismissalWindow);
      const threshold = (dismissals ?? []).length >= 3 ? 0.5 : 0;

      const ranked = questions
        .map((q) => {
          const sk = scopeKey(q.subject_kind, q.subject_id, q.fact_key);
          const existing = confidenceByScope.get(sk) ?? 0;
          return { q, value: Number(q.priority) * (1 - existing) };
        })
        .filter((r) => r.value >= threshold)
        .sort((a, b) => b.value - a.value);
      if (ranked.length === 0) continue;

      const picked = ranked[0].q;

      // Check user's notification settings (in-app gating). If the kind
      // is off we still flip the question to 'asked' to avoid spamming
      // the picker on every tick — the next cron pass will recycle it
      // back to queued via the stale-asked path if it goes unanswered.
      const { data: settings } = await supabase
        .from("notification_settings")
        .select("per_kind_prefs")
        .eq("user_id", userId)
        .maybeSingle();
      const perKind = (settings?.per_kind_prefs ?? {}) as Record<
        string,
        { in_app?: boolean }
      >;
      const inAppOk =
        perKind["ai_clarifying_question"]?.in_app !== false;
      if (!inAppOk) continue;

      const suggested = Array.isArray(picked.suggested_answers)
        ? (picked.suggested_answers as string[])
        : [];

      const { data: inserted } = await supabase
        .from("notifications_inbox")
        .insert({
          user_id: userId,
          kind: "ai_clarifying_question",
          subject: "A quick question",
          body: picked.question_text,
          priority: 0,
          payload: {
            choices: suggested,
            freeText: !!picked.free_text,
            kind_specific: { questionId: picked.id },
          } as Record<string, unknown>,
        })
        .select("id")
        .maybeSingle();

      await supabase
        .from("ai_open_questions")
        .update({
          status: "asked",
          asked_at: new Date().toISOString(),
          last_notification_id: (inserted?.id as string) ?? null,
        })
        .eq("id", picked.id);

      surfaced += 1;
    }

    return NextResponse.json({
      ok: true,
      recycled,
      expired,
      surfaced,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Surface-question cron failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

"use client";

import { useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import type { Notification } from "@/lib/notifications/dispatcher";
import type { NotificationPayload } from "@/lib/notifications/types";
import {
  MultiChoiceAnswer,
  FreeTextAnswer,
} from "@/components/app/notification-answer-renderers";
import { TuesdayCheckinLoader } from "@/components/app/tuesday-checkin-loader";
import { ClarifyingQuestionCard } from "@/components/app/chatbot/clarifying-question-card";
import { useNotificationModal } from "@/components/app/notification-modal-host";
import { acceptClientPatternAnswer } from "@/lib/ai/facts-actions";
import { rateSatisfaction } from "@/app/(app)/plans/_actions/plan-actions";

// Generalized click-routing for notification bell + /notifications + the
// ?notification=<id> deep-link interceptor.
//
// A ClickHandler decides what happens when the user clicks the BODY of a
// notification row. It receives the row, an `openModal` callback (binds
// to the NotificationModalHost provider), and a `navigate` callback
// (router.push). A handler MAY:
//   1. open a center modal (TuesdayCheckin, multi-choice, free-text, …)
//   2. navigate to a deep link
//   3. do nothing (info kinds — body click + X both just mark read)
//
// Adding a new kind: append the key to KNOWN_KINDS in kinds.ts, append a
// handler here. If a notification arrives with a kind that has no handler,
// the fallback at the bottom navigates to its link_url (or stays put).

export type ClickHandler = (
  n: Notification,
  openModal: (el: ReactNode, opts?: { title?: string; description?: string }) => void,
  navigate: (href: string) => void,
) => void;

// Inline wrapper so closeModal() can be passed to the chatbot's clarifying
// question card. Same pattern as the multi-choice / free-text inline
// wrappers below.
function ClarifyingQuestionModalBody({
  questionId,
  questionText,
  suggestedAnswers,
  freeText,
}: {
  questionId: string;
  questionText: string;
  suggestedAnswers: string[];
  freeText: boolean;
}) {
  const { closeModal } = useNotificationModal();
  return (
    <ClarifyingQuestionCard
      questionId={questionId}
      questionText={questionText}
      suggestedAnswers={suggestedAnswers}
      freeText={freeText}
      onSubmitted={closeModal}
    />
  );
}

const KIND_HANDLERS: Record<string, ClickHandler> = {
  tuesday_checkin: (n, openModal) => {
    openModal(<TuesdayCheckinLoader notification={n} />, {
      title: "Tuesday check-in",
      description: "A line and two numbers. The echo lands after you save.",
    });
  },
  info: () => {
    // Dismiss-only — the calling site marks read regardless.
  },
  app_update_available: (_n, _openModal, navigate) => {
    navigate("/settings/updates");
  },
  // Storm + stale anchor route to the today tight-mode landing.
  storm_active: (_n, _openModal, navigate) => {
    navigate("/today#tight-mode");
  },
  wallet_anchor_stale: (_n, _openModal, navigate) => {
    navigate("/today#tight-mode");
  },
  sadaka_nudge: (_n, _openModal, navigate) => {
    navigate("/sadaka");
  },
  // Plans redesign — three new kinds.
  plan_satisfaction_check: (n, openModal) => {
    const payload = (n.payload ?? {}) as {
      kind_specific?: {
        plan_id?: string;
        plan_label?: string;
        question_text?: string | null;
        suggested_followups?: string[];
      };
    };
    const planId = payload.kind_specific?.plan_id;
    const planLabel = payload.kind_specific?.plan_label ?? "purchase";
    const questionText =
      payload.kind_specific?.question_text || n.subject || null;
    const suggested = payload.kind_specific?.suggested_followups ?? [];
    if (!planId) return;
    openModal(
      <PlanSatisfactionModalBody
        planId={planId}
        planLabel={planLabel}
        questionText={questionText}
        suggestedFollowups={suggested}
      />,
      { title: n.subject, description: undefined },
    );
  },
  plan_strategy_stale: (n, _openModal, navigate) => {
    const payload = (n.payload ?? {}) as {
      kind_specific?: { plan_id?: string };
    };
    const planId = payload.kind_specific?.plan_id;
    navigate(planId ? `/plans?focus=${planId}` : "/plans");
  },
  plan_target_approaching: (n, _openModal, navigate) => {
    const payload = (n.payload ?? {}) as {
      kind_specific?: { plan_id?: string };
    };
    const planId = payload.kind_specific?.plan_id;
    navigate(planId ? `/plans?focus=${planId}` : "/plans");
  },
  // ai_clarifying_question routes through the chatbot's renderer so the
  // answer flows into ai_user_facts (source='user_answered', confidence=1.0)
  // and the question itself moves from queued/asked -> answered. The
  // notification's payload carries the question metadata.
  client_pattern_change: (n, openModal) => {
    const payload = (n.payload ?? {}) as {
      kind_specific?: {
        client_id?: string;
        pattern_kind?: string;
        question?: string;
        summary?: string;
        suggested_answers?: string[];
      };
    };
    const clientId = payload.kind_specific?.client_id;
    const patternKind = payload.kind_specific?.pattern_kind;
    const question = payload.kind_specific?.question ?? n.body ?? n.subject;
    const summary = payload.kind_specific?.summary ?? n.body ?? "";
    const suggested = payload.kind_specific?.suggested_answers ?? [];
    if (!clientId || !patternKind) {
      // Malformed — dev warning, no modal.
      if (process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.warn(
          "[notifications] client_pattern_change missing client_id or pattern_kind",
          n,
        );
      }
      return;
    }
    openModal(
      <ClientPatternAnswerModalBody
        notificationId={n.id}
        clientId={clientId}
        patternKind={patternKind}
        question={question}
        summary={summary}
        suggested={suggested}
      />,
      { title: n.subject, description: undefined },
    );
  },
  // vendor_identify_request — opens the chatbot scoped to vendor
  // identification. The chatbot listens for this event and seeds its
  // session context with { vendor_id, vendor_name } from the payload so
  // the intent classifier routes user replies through the
  // completeVendorIdentificationAction. "skip" branches to
  // skipVendorIdentificationAction. Both actions live in
  // src/app/(app)/spending/_actions/vendor-identify-actions.ts.
  vendor_identify_request: (n, _openModal, navigate) => {
    const payload = (n.payload ?? {}) as {
      kind_specific?: { vendor_id?: string; vendor_name?: string };
    };
    const vendorId = payload.kind_specific?.vendor_id;
    const vendorName = payload.kind_specific?.vendor_name;
    if (!vendorId || !vendorName) {
      if (process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.warn(
          "[notifications] vendor_identify_request missing vendor_id or vendor_name",
          n,
        );
      }
      // Fallback to the spending page; the user can still open the
      // chatbot manually there.
      navigate("/spending");
      return;
    }
    // Dispatch the canonical freelane:open-chatbot event. The chatbot
    // context provider listens for question + activeCard; we pass an
    // activeCard with kind="vendor_identify" so the chatbot's intent
    // classifier routes the user's free-text reply through the
    // completeVendorIdentificationAction. The prefilled question seeds
    // the conversation with what the brain needs.
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("freelane:open-chatbot", {
          detail: {
            question: `Tell me about ${vendorName}. What is this? (Reply "skip" to skip.)`,
            activeCard: {
              key: `vendor_identify:${vendorId}`,
              label: vendorName,
              data: {
                // Keep in sync with CHATBOT_INTENT.IDENTIFY_VENDOR in
                // src/lib/data/chat-context-registry.ts — the
                // postChatMessage dispatcher matches on this exact
                // string + presence of vendor_id/vendor_name (see
                // isIdentifyVendorIntent type guard).
                intent: "identify_vendor",
                vendor_id: vendorId,
                vendor_name: vendorName,
              },
            },
          },
        }),
      );
    }
  },
  ai_clarifying_question: (n, openModal) => {
    const payload = (n.payload ?? {}) as {
      choices?: string[];
      freeText?: boolean;
      kind_specific?: { questionId?: string };
    };
    const questionId = payload.kind_specific?.questionId;
    if (!questionId) {
      // Malformed — fall through to nothing. Dev-only warning.
      if (process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.warn(
          "[notifications] ai_clarifying_question without payload.kind_specific.questionId",
          n,
        );
      }
      return;
    }
    openModal(
      <ClarifyingQuestionModalBody
        questionId={questionId}
        questionText={n.body ?? n.subject}
        suggestedAnswers={payload.choices ?? []}
        freeText={!!payload.freeText}
      />,
      { title: n.subject, description: undefined },
    );
  },
};

// Inline wrappers that bind the host modal's closeModal() to onSubmitted on
// the payload-driven renderers. Without this the modal would stay open
// after a successful submit and the user would have to close it manually
// (TuesdayCheckinLoader does the same dance internally).
function MultiChoiceModalBody({
  n,
  choices,
}: {
  n: Notification;
  choices: string[];
}) {
  const { closeModal } = useNotificationModal();
  return <MultiChoiceAnswer n={n} choices={choices} onSubmitted={closeModal} />;
}

function FreeTextModalBody({
  n,
  placeholder,
}: {
  n: Notification;
  placeholder?: string;
}) {
  const { closeModal } = useNotificationModal();
  return (
    <FreeTextAnswer n={n} placeholder={placeholder} onSubmitted={closeModal} />
  );
}

// Body for the client_pattern_change kind. Renders the suggested answers
// as chips + an optional free-text "Other" fallback. Selection routes
// through acceptClientPatternAnswer which UPSERTs an ai_user_facts row
// (subject_kind=client, key=pattern_change_<kind>, source=user_answered).
function ClientPatternAnswerModalBody({
  notificationId,
  clientId,
  patternKind,
  question,
  summary,
  suggested,
}: {
  notificationId: string;
  clientId: string;
  patternKind: string;
  question: string;
  summary: string;
  suggested: string[];
}) {
  const { closeModal } = useNotificationModal();
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [other, setOther] = useState("");

  const submit = (answer: string) => {
    if (!answer.trim()) return;
    setBusy(answer);
    start(async () => {
      const res = await acceptClientPatternAnswer(
        notificationId,
        clientId,
        patternKind,
        answer.trim(),
      );
      if (!res.ok) {
        toast.error(res.error || "Couldn't save.");
        setBusy(null);
        return;
      }
      closeModal();
    });
  };

  return (
    <div className="space-y-3">
      {summary && (
        <p className="text-sm leading-snug text-muted-foreground">{summary}</p>
      )}
      <p className="text-sm font-medium text-foreground">{question}</p>
      <div className="flex flex-col gap-2">
        {suggested.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => submit(s)}
            disabled={pending}
            className="w-full rounded-lg border border-border/70 bg-card px-3 py-2.5 text-left text-sm font-medium text-foreground transition-colors hover:bg-foreground/[0.04] disabled:opacity-50"
          >
            {busy === s ? "Saving…" : s}
          </button>
        ))}
        <div className="flex gap-2 pt-1">
          <input
            type="text"
            value={other}
            onChange={(e) => setOther(e.target.value)}
            placeholder="Other (optional)"
            className="flex-1 rounded-lg border border-border/70 bg-card px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={() => submit(other)}
            disabled={pending || !other.trim()}
            className="rounded-lg bg-foreground px-3 py-2 text-sm font-medium text-background disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

// Plan satisfaction body: 1-5 star picker + AI-tailored question +
// 2-3 quick-tap suggested follow-ups (toggleable chips) + optional
// free-text note. Writes via rateSatisfaction; the action persists the
// rating + satisfaction_note (migration 0090 separates this from the
// user's general plan notes).
function PlanSatisfactionModalBody({
  planId,
  planLabel,
  questionText,
  suggestedFollowups,
}: {
  planId: string;
  planLabel: string;
  questionText: string | null;
  suggestedFollowups: string[];
}) {
  const { closeModal } = useNotificationModal();
  const [stars, setStars] = useState<number>(0);
  const [note, setNote] = useState<string>("");
  const [chips, setChips] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const toggleChip = (s: string) => {
    setChips((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  };
  const submit = () => {
    if (stars <= 0) return;
    // Compose the saved note from selected chips + free-text. Chip
    // labels come first so the saved string reads like a tag list
    // followed by the optional sentence.
    const chipPart = Array.from(chips).join(", ");
    const composed = [chipPart, note.trim()].filter(Boolean).join(" — ");
    start(async () => {
      const res = await rateSatisfaction(planId, stars, composed || null);
      if (!res.ok) {
        toast.error(res.error || "Couldn't save.");
        return;
      }
      closeModal();
    });
  };
  const question = questionText ?? `How is the ${planLabel} working out?`;
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-foreground">{question}</p>
      <div className="flex gap-1.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setStars(n)}
            className={
              "rounded-full border px-3 py-1.5 text-sm font-medium " +
              (stars >= n
                ? "border-foreground bg-foreground text-background"
                : "border-border/70 text-foreground/80 hover:bg-muted")
            }
          >
            {n}
          </button>
        ))}
      </div>
      {suggestedFollowups.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {suggestedFollowups.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => toggleChip(s)}
              className={
                "rounded-full border px-3 py-1 text-[12px] " +
                (chips.has(s)
                  ? "border-foreground bg-foreground text-background"
                  : "border-border/70 text-foreground/80 hover:bg-muted")
              }
            >
              {s}
            </button>
          ))}
        </div>
      )}
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Optional note — what worked, what didn't"
        rows={3}
        className="w-full resize-none rounded-lg border border-border/70 bg-card px-3 py-2 text-sm"
      />
      <div className="flex justify-end">
        <button
          type="button"
          onClick={submit}
          disabled={pending || stars <= 0}
          className="rounded-lg bg-foreground px-3 py-2 text-sm font-medium text-background disabled:opacity-40"
        >
          {pending ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}

export function routeNotificationClick(
  n: Notification,
  openModal: (el: ReactNode, opts?: { title?: string; description?: string }) => void,
  navigate: (href: string) => void,
): void {
  // Per-kind handlers win FIRST so kinds that need custom write semantics
  // (e.g. ai_clarifying_question writes to ai_user_facts, NOT to
  // notifications_inbox.answer) can intercept their own payload.
  const handler = KIND_HANDLERS[n.kind];
  if (handler) {
    handler(n, openModal, navigate);
    return;
  }
  // Generic payload-driven renderers — any kind that wants a multi-choice
  // or free-text form WITHOUT custom downstream writes just dispatches
  // with the payload set.
  const payload = (n.payload ?? null) as NotificationPayload | null;
  if (payload?.choices && payload.choices.length > 0) {
    openModal(<MultiChoiceModalBody n={n} choices={payload.choices} />, {
      title: n.subject,
      description: n.body ?? undefined,
    });
    return;
  }
  if (payload?.freeText) {
    openModal(<FreeTextModalBody n={n} placeholder={payload.placeholder} />, {
      title: n.subject,
      description: n.body ?? undefined,
    });
    return;
  }
  if (n.link_url) {
    navigate(n.link_url);
    return;
  }
  // Dev-only: a kind landed here with no handler, no payload, and no
  // link_url. In production this just silently marks read; in dev we
  // shout so the next kind addition gets wired up.
  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.warn(
      `[notifications] No click handler for kind "${n.kind}" — add one to KIND_HANDLERS in click-routing.tsx.`,
    );
  }
}

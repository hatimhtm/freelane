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

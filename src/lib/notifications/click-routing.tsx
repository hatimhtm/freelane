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
import {
  acceptEntityDiscovery,
  rejectEntityDiscovery,
  acceptEntityPatternAnswer,
} from "@/lib/entities/discovery-actions";
import {
  acceptLoanProposal,
  rejectLoanProposal,
} from "@/lib/loans/proposal-actions";
import { LetterReader } from "@/components/letters/letter-reader";

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
  openModal: (
    el: ReactNode,
    opts?: {
      title?: string;
      description?: string;
      size?: "default" | "reader";
      chromeless?: boolean;
    },
  ) => void,
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
  // app_update_available (freelane-whatsnew-design 2026-06-02). Lands the
  // user on Settings → Updates with the new entry expanded. Payload
  // carries `kind_specific.version` so the deep link auto-opens the
  // exact release entry that triggered the notification.
  app_update_available: (n, _openModal, navigate) => {
    const payload = (n.payload ?? {}) as {
      kind_specific?: { version?: string };
    };
    const version = payload.kind_specific?.version;
    navigate(
      version
        ? `/settings/updates?expand=${encodeURIComponent(version)}`
        : "/settings/updates",
    );
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
  // vendor_clarify — Vendors workflow always-ask path. Opens the chatbot
  // seeded with intent="clarify_vendor". Payload carries the chip list
  // (brain proposals up to 3), brain alternatives, and the allow_skip
  // flag. The chatbot reply handler routes the user's pick through the
  // clarify-vendor intent server action (see
  // src/lib/ai/chatbot/intent-handlers/clarify-vendor.ts).
  vendor_clarify: (n, _openModal, navigate) => {
    const payload = (n.payload ?? {}) as {
      kind_specific?: {
        vendor_id?: string;
        vendor_name?: string;
        suggested_answers?: string[];
        alternatives?: Array<{ canonical_name: string; reasoning: string }>;
        allow_skip?: boolean;
      };
    };
    const vendorId = payload.kind_specific?.vendor_id;
    const vendorName = payload.kind_specific?.vendor_name;
    if (!vendorId || !vendorName) {
      if (process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.warn(
          "[notifications] vendor_clarify missing vendor_id or vendor_name",
          n,
        );
      }
      navigate("/spending/vendors");
      return;
    }
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("freelane:open-chatbot", {
          detail: {
            question: `What is "${vendorName}"? Tap the closest, or type it.`,
            activeCard: {
              key: `vendor_clarify:${vendorId}`,
              label: vendorName,
              data: {
                intent: "clarify_vendor",
                vendor_id: vendorId,
                vendor_name: vendorName,
                suggested_answers: payload.kind_specific?.suggested_answers ?? [],
                alternatives: payload.kind_specific?.alternatives ?? [],
                allow_skip: payload.kind_specific?.allow_skip !== false,
              },
            },
          },
        }),
      );
    }
  },
  // entity_discovery_request — GATE 1 (Entities workflow). The brain
  // proposed an entity from a signal (spend note / chat / sadaka tag /
  // transfer target). Open a center modal with Add / Edit / Not an
  // entity / Skip actions. The modal commits via acceptEntityDiscovery
  // (or rejectEntityDiscovery for the denylist path).
  entity_discovery_request: (n, openModal) => {
    const payload = (n.payload ?? {}) as {
      kind_specific?: {
        signal_fingerprint?: string;
        source_kind?: string;
        source_text?: string;
        candidate_name?: string;
        suggested_name?: string;
        suggested_relationship?: string | null;
        confidence?: number;
        reasoning?: string;
      };
    };
    const ks = payload.kind_specific ?? {};
    if (!ks.signal_fingerprint || !ks.candidate_name) {
      if (process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.warn(
          "[notifications] entity_discovery_request missing signal_fingerprint or candidate_name",
          n,
        );
      }
      return;
    }
    openModal(
      <EntityDiscoveryModalBody
        notificationId={n.id}
        signalFingerprint={ks.signal_fingerprint}
        sourceKind={ks.source_kind ?? null}
        sourceText={ks.source_text ?? null}
        candidateName={ks.candidate_name}
        suggestedName={ks.suggested_name ?? ks.candidate_name}
        suggestedRelationship={ks.suggested_relationship ?? null}
        reasoning={ks.reasoning ?? ""}
      />,
      { title: n.subject, description: n.body ?? undefined },
    );
  },
  // entity_clarify — GATE 2 (Entities workflow). Opens the chatbot
  // seeded with intent="clarify_entity". Payload carries the chip list
  // (brain proposals up to 3) + relationship suggestion. Mirrors the
  // vendor_clarify wiring.
  entity_clarify: (n, _openModal, navigate) => {
    const payload = (n.payload ?? {}) as {
      kind_specific?: {
        entity_id?: string;
        entity_name?: string;
        suggested_answers?: string[];
        alternatives?: Array<{
          canonical_name: string;
          relationship: string;
          reasoning: string;
        }>;
        suggested_relationship?: string | null;
        allow_skip?: boolean;
      };
    };
    const entityId = payload.kind_specific?.entity_id;
    const entityName = payload.kind_specific?.entity_name;
    if (!entityId || !entityName) {
      if (process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.warn(
          "[notifications] entity_clarify missing entity_id or entity_name",
          n,
        );
      }
      navigate("/clients/people");
      return;
    }
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("freelane:open-chatbot", {
          detail: {
            question: `Who is "${entityName}"? Tap the closest, or type it.`,
            activeCard: {
              key: `entity_clarify:${entityId}`,
              label: entityName,
              data: {
                intent: "clarify_entity",
                entity_id: entityId,
                entity_name: entityName,
                suggested_answers:
                  payload.kind_specific?.suggested_answers ?? [],
                alternatives: payload.kind_specific?.alternatives ?? [],
                suggested_relationship:
                  payload.kind_specific?.suggested_relationship ?? null,
                allow_skip: payload.kind_specific?.allow_skip !== false,
              },
            },
          },
        }),
      );
    }
  },
  // entity_introduction — NEW ELEMENT TRIGGERS. Open a center modal
  // with a free-text capture so the user can drop a one-line context
  // about the entity. The payload's freeText flag + placeholder mirror
  // the generic FreeTextAnswer renderer; we reuse the modal body so the
  // submit lands in notifications_inbox.answer (and the entity row's
  // introduction_status advances via the dispatcher's read hook).
  entity_introduction: (n, openModal, navigate) => {
    const payload = (n.payload ?? null) as NotificationPayload | null;
    const placeholder =
      payload?.placeholder ??
      "What should I know about them? (Or tap the link to open their page.)";
    if (payload?.freeText) {
      openModal(<FreeTextModalBody n={n} placeholder={placeholder} />, {
        title: n.subject,
        description: n.body ?? undefined,
      });
      return;
    }
    if (n.link_url) {
      navigate(n.link_url);
    }
  },
  // entity_pattern_change — mirrors client_pattern_change. Renders the
  // suggested chip list + "Other" textbox; selection routes through
  // acceptEntityPatternAnswer which UPSERTs an ai_user_facts row
  // (subject_kind=entity, key=entity_pattern_change_<kind>,
  // source=user_answered).
  entity_pattern_change: (n, openModal) => {
    const payload = (n.payload ?? {}) as {
      kind_specific?: {
        entity_id?: string;
        pattern_kind?: string;
        question?: string;
        summary?: string;
        suggested_answers?: string[];
      };
    };
    const entityId = payload.kind_specific?.entity_id;
    const patternKind = payload.kind_specific?.pattern_kind;
    const question = payload.kind_specific?.question ?? n.body ?? n.subject;
    const summary = payload.kind_specific?.summary ?? n.body ?? "";
    const suggested = payload.kind_specific?.suggested_answers ?? [];
    if (!entityId || !patternKind) {
      if (process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.warn(
          "[notifications] entity_pattern_change missing entity_id or pattern_kind",
          n,
        );
      }
      return;
    }
    openModal(
      <EntityPatternAnswerModalBody
        notificationId={n.id}
        entityId={entityId}
        patternKind={patternKind}
        question={question}
        summary={summary}
        suggested={suggested}
      />,
      { title: n.subject, description: undefined },
    );
  },
  // vendor_price_check_weekly — opens a modal listing every noteworthy
  // change the weekly Pro brain bundled into one notification. Each row
  // has explain/ignore affordances. The handler keeps the modal simple —
  // a bulleted summary plus a "Open vendors" button — and lets the user
  // dig deeper from /spending/vendors.
  vendor_price_check_weekly: (n, openModal, navigate) => {
    const payload = (n.payload ?? {}) as {
      kind_specific?: {
        changes?: Array<{
          vendor_id: string;
          vendor_name: string;
          item_label: string | null;
          latest_amount: number;
          prior_4w_avg: number;
          delta_pct: number;
          direction: "up" | "down";
          internal_summary: string;
          external_context: string;
        }>;
      };
    };
    const changes = payload.kind_specific?.changes ?? [];
    if (changes.length === 0) {
      navigate("/spending/vendors");
      return;
    }
    openModal(
      <WeeklyPriceCheckModalBody changes={changes} />,
      { title: n.subject, description: n.body ?? undefined },
    );
  },
  // Letters workflow (freelane-letters-design 2026-06-02) — opens the
  // letter-reader center modal with full editorial typography. Payload
  // carries letter_id; malformed payload falls back to /letters archive.
  //
  // The letter reader OWNS its typography (Fraunces display-headline +
  // display-eyebrow + max-w-[680px] reading column). We open the modal
  // CHROMELESS so the host doesn't double-render a sans DialogTitle
  // above the Fraunces headline, and at `size: 'reader'` so the 680px
  // inner column fits the modal's 720px max-width without clipping.
  new_letter: (n, openModal, navigate) => {
    const payload = (n.payload ?? {}) as {
      kind_specific?: {
        letter_id?: string;
        kind?: string;
        period_key?: string;
      };
    };
    const letterId = payload.kind_specific?.letter_id;
    if (!letterId) {
      if (process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.warn(
          "[notifications] new_letter missing letter_id in payload.kind_specific",
          n,
        );
      }
      navigate("/letters");
      return;
    }
    openModal(<LetterReader letterId={letterId} />, {
      title: n.subject,
      size: "reader",
      chromeless: true,
    });
  },
  // Loans workflow — loan_proposal opens a center modal with Accept /
  // Not a loan buttons. Accept forwards to createPersonalLoan via
  // acceptLoanProposal; reject stamps spends.non_loan via
  // rejectLoanProposal so the brain doesn't re-propose the same row.
  // Both actions mark the notification read on success.
  loan_proposal: (n, openModal) => {
    openModal(
      <LoanProposalModalBody
        notificationId={n.id}
        subject={n.subject}
        body={n.body}
      />,
      { title: n.subject, description: undefined },
    );
  },
  // loan_due_soon + loan_overdue carry link_url=/spending?loans=1&loan_id=…
  // and would route via the generic link_url fallback below. Register
  // them explicitly so KIND_HANDLERS coverage is unambiguous and a
  // future handler swap (e.g. opening a quick "Record return" modal)
  // doesn't have to dig through the fallback path.
  loan_due_soon: (_n, _openModal, navigate) => {
    const link = _n.link_url;
    navigate(link ?? "/spending?loans=1");
  },
  loan_overdue: (_n, _openModal, navigate) => {
    const link = _n.link_url;
    navigate(link ?? "/spending?loans=1");
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

// Weekly vendor price-check body. Render every noteworthy change as a row
// with: vendor · item · direction arrow · delta_pct · short internal
// summary + external_context. The "Open vendors" button hands off to the
// /spending/vendors surface where the full per-vendor history lives.
function WeeklyPriceCheckModalBody({
  changes,
}: {
  changes: Array<{
    vendor_id: string;
    vendor_name: string;
    item_label: string | null;
    latest_amount: number;
    prior_4w_avg: number;
    delta_pct: number;
    direction: "up" | "down";
    internal_summary: string;
    external_context: string;
  }>;
}) {
  const { closeModal } = useNotificationModal();
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        External context is a rough reference, not ground truth. The internal
        delta is the real signal.
      </p>
      <ul className="flex flex-col gap-2">
        {changes.map((c, i) => {
          const arrow = c.direction === "up" ? "↑" : "↓";
          const pct = Math.round(Math.abs(c.delta_pct) * 100);
          return (
            <li
              key={`${c.vendor_id}:${c.item_label ?? "whole"}:${i}`}
              className="rounded-lg border border-border/60 bg-card px-3 py-2"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium text-foreground">
                  {c.vendor_name}
                  {c.item_label ? ` · ${c.item_label}` : ""}
                </span>
                <span
                  className={
                    "text-sm font-medium " +
                    (c.direction === "up"
                      ? "text-[var(--color-warning,theme(colors.orange.500))]"
                      : "text-acid-lime")
                  }
                >
                  {arrow} {pct}%
                </span>
              </div>
              {c.internal_summary && (
                <p className="mt-1 text-[12px] leading-snug text-foreground/80">
                  {c.internal_summary}
                </p>
              )}
              {c.external_context && (
                <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                  {c.external_context}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={closeModal}
          className="rounded-lg bg-foreground px-3 py-2 text-sm font-medium text-background"
        >
          Got it
        </button>
      </div>
    </div>
  );
}

// Entity discovery (Gate 1) modal body. Renders the suggested name +
// reasoning at top, then four actions: Add as entity / Edit then add /
// Not an entity / Skip. The "Edit then add" path opens an inline form
// with editable name + relationship before submitting via
// acceptEntityDiscovery; the other paths route through their dedicated
// actions and close the modal.
function EntityDiscoveryModalBody({
  notificationId,
  signalFingerprint,
  sourceKind,
  sourceText,
  candidateName,
  suggestedName,
  suggestedRelationship,
  reasoning,
}: {
  notificationId: string;
  signalFingerprint: string;
  sourceKind: string | null;
  sourceText: string | null;
  candidateName: string;
  suggestedName: string;
  suggestedRelationship: string | null;
  reasoning: string;
}) {
  const { closeModal } = useNotificationModal();
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [editMode, setEditMode] = useState(false);
  const [editName, setEditName] = useState(suggestedName);
  const [editRel, setEditRel] = useState(suggestedRelationship ?? "");

  const submitAdd = (finalName: string, relationship: string | null) => {
    setBusy("add");
    start(async () => {
      const res = await acceptEntityDiscovery({
        notificationId,
        signalFingerprint,
        candidateName,
        finalName,
        relationship: relationship || null,
        sourceKind,
      });
      if (!res.ok) {
        toast.error(res.error || "Couldn't add.");
        setBusy(null);
        return;
      }
      closeModal();
    });
  };

  const submitReject = () => {
    setBusy("reject");
    start(async () => {
      const res = await rejectEntityDiscovery({
        notificationId,
        signalFingerprint,
        candidateName,
        sourceKind,
        sourceText,
      });
      if (!res.ok) {
        toast.error(res.error || "Couldn't save rejection.");
        setBusy(null);
        return;
      }
      closeModal();
    });
  };

  if (editMode) {
    return (
      <div className="space-y-3">
        <p className="text-sm font-medium text-foreground">
          Edit before adding
        </p>
        <div className="space-y-2">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Name
          </label>
          <input
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            className="w-full rounded-lg border border-border/70 bg-card px-3 py-2 text-sm"
          />
        </div>
        <div className="space-y-2">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Relationship
          </label>
          <input
            type="text"
            value={editRel}
            onChange={(e) => setEditRel(e.target.value)}
            placeholder="wife / sibling / friend / neighbour"
            className="w-full rounded-lg border border-border/70 bg-card px-3 py-2 text-sm"
          />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={() => setEditMode(false)}
            disabled={pending}
            className="rounded-lg border border-border/70 bg-card px-3 py-2 text-sm font-medium text-foreground"
          >
            Back
          </button>
          <button
            type="button"
            onClick={() => submitAdd(editName.trim(), editRel.trim() || null)}
            disabled={pending || !editName.trim()}
            className="rounded-lg bg-foreground px-3 py-2 text-sm font-medium text-background disabled:opacity-40"
          >
            {busy === "add" ? "Adding…" : "Add as entity"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {reasoning && (
        <p className="text-sm leading-snug text-muted-foreground">{reasoning}</p>
      )}
      <p className="text-sm text-foreground">
        Add <span className="font-medium">{suggestedName}</span>
        {suggestedRelationship ? ` (${suggestedRelationship})` : ""} as someone
        you know?
      </p>
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => submitAdd(suggestedName, suggestedRelationship)}
          disabled={pending}
          className="w-full rounded-lg bg-foreground px-3 py-2.5 text-left text-sm font-medium text-background transition-colors disabled:opacity-50"
        >
          {busy === "add" ? "Adding…" : "Add as entity"}
        </button>
        <button
          type="button"
          onClick={() => setEditMode(true)}
          disabled={pending}
          className="w-full rounded-lg border border-border/70 bg-card px-3 py-2.5 text-left text-sm font-medium text-foreground transition-colors hover:bg-foreground/[0.04] disabled:opacity-50"
        >
          Edit then add
        </button>
        <button
          type="button"
          onClick={submitReject}
          disabled={pending}
          className="w-full rounded-lg border border-border/70 bg-card px-3 py-2.5 text-left text-sm font-medium text-foreground transition-colors hover:bg-foreground/[0.04] disabled:opacity-50"
        >
          {busy === "reject" ? "Saving…" : "Not an entity"}
        </button>
        <button
          type="button"
          onClick={closeModal}
          disabled={pending}
          className="w-full rounded-lg border border-border/70 bg-card px-3 py-2.5 text-left text-sm font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.04] disabled:opacity-50"
        >
          Skip
        </button>
      </div>
    </div>
  );
}

// Body for the entity_pattern_change kind. Renders the suggested
// answers as chips + an optional free-text "Other" fallback. Selection
// routes through acceptEntityPatternAnswer which UPSERTs an
// ai_user_facts row (subject_kind=entity).
function EntityPatternAnswerModalBody({
  notificationId,
  entityId,
  patternKind,
  question,
  summary,
  suggested,
}: {
  notificationId: string;
  entityId: string;
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
      const res = await acceptEntityPatternAnswer(
        notificationId,
        entityId,
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

// Body for the loan_proposal kind. The brain spotted loan-ish language
// on a beneficiary spend; the user confirms (createPersonalLoan via
// acceptLoanProposal) or rejects (stamp spends.non_loan via
// rejectLoanProposal). The payload carries the full proposed_loan shape
// already — both server actions re-read it from the inbox row so we
// don't have to thread anything through the modal beyond the
// notification id.
function LoanProposalModalBody({
  notificationId,
  subject,
  body,
}: {
  notificationId: string;
  subject: string;
  body: string | null;
}) {
  const { closeModal } = useNotificationModal();
  const [busy, setBusy] = useState<"accept" | "reject" | null>(null);
  const [pending, start] = useTransition();

  const accept = () => {
    setBusy("accept");
    start(async () => {
      const res = await acceptLoanProposal(notificationId);
      if (!res.ok) {
        toast.error(res.error || "Couldn't log the loan.");
        setBusy(null);
        return;
      }
      toast.success("Logged as a loan.");
      closeModal();
    });
  };

  const reject = () => {
    setBusy("reject");
    start(async () => {
      const res = await rejectLoanProposal(notificationId);
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
      {body && (
        <p className="text-sm leading-snug text-muted-foreground">{body}</p>
      )}
      <p className="text-sm font-medium text-foreground">
        {subject || "Was this a loan?"}
      </p>
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={accept}
          disabled={pending}
          className="w-full rounded-lg bg-foreground px-3 py-2.5 text-left text-sm font-medium text-background transition-colors disabled:opacity-50"
        >
          {busy === "accept" ? "Logging…" : "Yes, log loan"}
        </button>
        <button
          type="button"
          onClick={reject}
          disabled={pending}
          className="w-full rounded-lg border border-border/70 bg-card px-3 py-2.5 text-left text-sm font-medium text-foreground transition-colors hover:bg-foreground/[0.04] disabled:opacity-50"
        >
          {busy === "reject" ? "Saving…" : "Not a loan"}
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

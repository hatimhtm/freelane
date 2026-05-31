"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { ArrowRight, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils";
import {
  answerAiQuestionAction,
  answerAiQuestionWithNotesAction,
  dismissAiQuestionAction,
  runCuriositySweepAction,
} from "@/lib/data/actions";
import type { AiQuestion } from "@/lib/supabase/types";

const EASE = [0.22, 1, 0.36, 1] as const;

type Props = { questions: AiQuestion[] };

// Calm letter-like surface for the AI's queued question for Max. Renders only
// the top-priority open question; on answer/dismiss it fades the current
// question out and lets the next-highest take the stage.
export function AiQuestionsCard({ questions }: Props) {
  const sorted = useMemo(
    () =>
      [...questions].sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        return b.created_at.localeCompare(a.created_at);
      }),
    [questions],
  );

  const [resolvedIds, setResolvedIds] = useState<Set<string>>(() => new Set());
  const queue = sorted.filter((q) => !resolvedIds.has(q.id));
  const current = queue[0] ?? null;

  if (!current) return <CuriosityNudge hasHistory={questions.length > 0} />;

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.article
        key={current.id}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.32, ease: EASE }}
        className="group relative overflow-hidden rounded-[14px] bg-card p-5 ring-1 ring-foreground/10"
      >
        <DismissButton
          id={current.id}
          onDone={() =>
            setResolvedIds((prev) => {
              const next = new Set(prev);
              next.add(current.id);
              return next;
            })
          }
        />

        <p className="max-w-[58ch] pr-8 text-[15px] leading-snug text-foreground">
          {current.question}
        </p>

        <div className="mt-4">
          {current.options && current.options.length > 0 ? (
            <OptionChips
              question={current}
              onDone={() =>
                setResolvedIds((prev) => {
                  const next = new Set(prev);
                  next.add(current.id);
                  return next;
                })
              }
            />
          ) : (
            <FreeformAnswer
              question={current}
              onDone={() =>
                setResolvedIds((prev) => {
                  const next = new Set(prev);
                  next.add(current.id);
                  return next;
                })
              }
            />
          )}
        </div>
      </motion.article>
    </AnimatePresence>
  );
}

function DismissButton({ id, onDone }: { id: string; onDone: () => void }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      aria-label="Dismiss question"
      disabled={pending}
      onClick={() =>
        start(async () => {
          try {
            await dismissAiQuestionAction(id);
          } finally {
            onDone();
          }
        })
      }
      className={cn(
        "absolute right-3 top-3 grid size-7 place-items-center rounded-full",
        "text-muted-foreground/0 transition-colors",
        "hover:bg-muted/40 hover:text-muted-foreground",
        "group-hover:text-muted-foreground/60 focus-visible:text-muted-foreground",
      )}
    >
      <X className="size-3.5" />
    </button>
  );
}

function OptionChips({
  question,
  onDone,
}: {
  question: AiQuestion;
  onDone: () => void;
}) {
  // Free-text + chips per universal ask-sheet rule (Tier 1, migration 0029).
  // Chip is fast-path; the textarea below sends a free-text note alongside.
  const [pickedChip, setPickedChip] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [pending, start] = useTransition();

  const sendCombined = () => {
    if (pending) return;
    const chip = pickedChip ?? "";
    const trimmed = notes.trim();
    if (!chip && !trimmed) return;
    start(async () => {
      try {
        await answerAiQuestionWithNotesAction(question.id, chip, trimmed);
      } finally {
        onDone();
      }
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {(question.options ?? []).map((opt) => {
          const active = pickedChip === opt;
          return (
            <button
              key={opt}
              type="button"
              disabled={pending}
              onClick={() => setPickedChip((cur) => (cur === opt ? null : opt))}
              className={cn(
                "rounded-full border px-3.5 py-1.5 text-[13px] leading-none transition-colors",
                "border-foreground/20 text-foreground",
                "hover:bg-muted/50 hover:border-foreground/30",
                "disabled:cursor-not-allowed",
                active && "bg-foreground text-background border-foreground",
                !active && pending && "opacity-40",
              )}
              style={{ borderWidth: 1.5 }}
            >
              {opt}
            </button>
          );
        })}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          sendCombined();
        }}
        className="flex items-center gap-2 border-b border-foreground/15 pb-1.5 focus-within:border-foreground/35 transition-colors"
      >
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={pickedChip ? "Or add your own words" : "Or tell me in your own words"}
          disabled={pending}
          className="flex-1 bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground/60"
        />
        <button
          type="submit"
          disabled={pending || (!pickedChip && !notes.trim())}
          aria-label="Send reply"
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-full transition-all",
            "bg-foreground text-background",
            "hover:scale-105 disabled:opacity-30 disabled:hover:scale-100",
          )}
        >
          <ArrowRight className="size-3.5" />
        </button>
      </form>
    </div>
  );
}

function FreeformAnswer({
  question,
  onDone,
}: {
  question: AiQuestion;
  onDone: () => void;
}) {
  const [value, setValue] = useState("");
  const [pending, start] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const send = () => {
    const trimmed = value.trim();
    if (!trimmed || pending) return;
    start(async () => {
      try {
        await answerAiQuestionAction(question.id, trimmed);
      } finally {
        onDone();
      }
    });
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
      className="flex items-center gap-2 border-b border-foreground/15 pb-1.5 focus-within:border-foreground/35 transition-colors"
    >
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Type a reply"
        disabled={pending}
        className="flex-1 bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground/60"
      />
      <button
        type="submit"
        disabled={pending || !value.trim()}
        aria-label="Send reply"
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-full transition-all",
          "bg-foreground text-background",
          "hover:scale-105 disabled:opacity-30 disabled:hover:scale-100",
        )}
      >
        <ArrowRight className="size-3.5" />
      </button>
    </form>
  );
}

function CuriosityNudge({ hasHistory }: { hasHistory: boolean }) {
  const [pending, start] = useTransition();
  const [hidden, setHidden] = useState(false);

  if (hidden) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4, ease: EASE }}
      className="flex items-center justify-start"
    >
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            try {
              const res = await runCuriositySweepAction();
              if (res.queued === 0) setHidden(true);
            } catch {
              setHidden(true);
            }
          })
        }
        className={cn(
          "rounded-full border px-3.5 py-1.5 text-[12px] leading-none transition-colors",
          "border-foreground/15 text-muted-foreground",
          "hover:bg-muted/40 hover:text-foreground hover:border-foreground/25",
          "disabled:opacity-50",
        )}
        style={{ borderWidth: 1.5 }}
      >
        {pending
          ? "Looking…"
          : hasHistory
            ? "Ask the AI to take another look"
            : "Ask the AI to take a look"}
      </button>
    </motion.div>
  );
}

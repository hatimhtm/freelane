"use client";

import { useState, useTransition } from "react";
import { Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  answerOpenQuestion,
  dismissOpenQuestion,
} from "@/lib/ai/open-questions-actions";

// Renderer for AI clarifying questions surfaced through the notification
// modal OR inline in the chatbot. Combines the multi-choice + free-text
// patterns from notification-answer-renderers into a single integrated
// card with explicit Skip semantics (skip = dismiss, raises backoff).

type Props = {
  questionId: string;
  questionText: string;
  suggestedAnswers: string[];
  freeText: boolean;
  onSubmitted?: () => void;
};

export function ClarifyingQuestionCard({
  questionId,
  questionText,
  suggestedAnswers,
  freeText,
  onSubmitted,
}: Props) {
  const [text, setText] = useState("");
  const [busyChoice, setBusyChoice] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = (answer: string) => {
    const trimmed = answer.trim();
    if (!trimmed) return;
    setBusyChoice(answer);
    start(async () => {
      const res = await answerOpenQuestion(questionId, trimmed);
      setBusyChoice(null);
      if (!res.ok) {
        toast.error(res.error || "Couldn't save.");
        return;
      }
      onSubmitted?.();
    });
  };

  const skip = () => {
    start(async () => {
      const res = await dismissOpenQuestion(questionId);
      if (!res.ok) {
        toast.error(res.error || "Couldn't skip.");
        return;
      }
      onSubmitted?.();
    });
  };

  return (
    <div className="space-y-3">
      <p className="text-[13.5px] leading-relaxed text-foreground">
        {questionText}
      </p>
      {suggestedAnswers.length > 0 && (
        <div className="flex flex-col gap-2">
          {suggestedAnswers.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => submit(c)}
              disabled={pending}
              className="w-full rounded-lg border border-border/70 bg-card px-3 py-2.5 text-left text-sm font-medium text-foreground transition-colors hover:bg-foreground/[0.04] disabled:opacity-50"
            >
              {busyChoice === c ? "Saving…" : c}
            </button>
          ))}
        </div>
      )}
      {freeText && (
        <div className="space-y-2">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="A line is enough."
            className="min-h-[80px] resize-y text-sm"
          />
          <div className="flex justify-end">
            <Button onClick={() => submit(text)} disabled={pending || !text.trim()}>
              <Send className="mr-1.5 h-3.5 w-3.5" />
              {pending ? "Saving…" : "Send"}
            </Button>
          </div>
        </div>
      )}
      <div className="flex justify-end pt-1">
        <button
          type="button"
          onClick={skip}
          disabled={pending}
          className="text-[12px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
        >
          Skip for now
        </button>
      </div>
    </div>
  );
}

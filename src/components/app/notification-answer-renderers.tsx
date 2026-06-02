"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { submitNotificationAnswerAction } from "@/lib/notifications/answer-actions";
import type { Notification } from "@/lib/notifications/dispatcher";

// Two generic renderers used by the click-routing registry when the
// notification's payload signals an interactive form.
//
//   payload.choices: string[]   -> MultiChoiceAnswer
//   payload.freeText: true      -> FreeTextAnswer
//
// The host modal already shows n.subject as DialogTitle and n.body as the
// DialogDescription, so neither renderer repeats them — they only render
// the input controls. Both call submitNotificationAnswerAction on submit
// (which writes the answer + marks read), then onSubmitted to close the
// host modal. Modal-close is the success signal — no toast on success.

type CommonProps = {
  n: Notification;
  onSubmitted?: () => void;
};

export function MultiChoiceAnswer({
  n,
  choices,
  onSubmitted,
}: CommonProps & { choices: string[] }) {
  const [pending, start] = useTransition();
  const [busyChoice, setBusyChoice] = useState<string | null>(null);

  const submit = (choice: string) => {
    setBusyChoice(choice);
    start(async () => {
      const res = await submitNotificationAnswerAction(n.id, choice);
      if (!res.ok) {
        toast.error(res.error || "Couldn't save.");
        setBusyChoice(null);
        return;
      }
      onSubmitted?.();
    });
  };

  return (
    <div className="flex flex-col gap-2">
      {choices.map((c) => (
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
  );
}

export function FreeTextAnswer({
  n,
  placeholder,
  onSubmitted,
}: CommonProps & { placeholder?: string }) {
  const [text, setText] = useState("");
  const [pending, start] = useTransition();

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    start(async () => {
      const res = await submitNotificationAnswerAction(n.id, trimmed);
      if (!res.ok) {
        toast.error(res.error || "Couldn't save.");
        return;
      }
      // Modal close is the success signal — keeps the feedback consistent
      // with MultiChoiceAnswer.
      onSubmitted?.();
    });
  };

  return (
    <div className="space-y-3">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder ?? "A line is enough."}
        className="min-h-[80px] resize-y text-sm"
      />
      <div className="flex justify-end">
        <Button onClick={submit} disabled={pending || !text.trim()}>
          <Send className="mr-1.5 h-3.5 w-3.5" />
          {pending ? "Saving…" : "Send"}
        </Button>
      </div>
    </div>
  );
}

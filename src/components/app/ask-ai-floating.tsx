"use client";

import { useEffect, useState } from "react";
import { MessagesSquare } from "lucide-react";
import { AskAiModal } from "./ask-ai-modal";

// T24 — floating bottom-right Ask AI button. Replaces the inline AiPanel
// mount + the LogSpendPrimaryAction. Persistent across Today + Dashboard.

export function AskAiFloating({ enabled }: { enabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [prefill, setPrefill] = useState<string | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | { question?: string }
        | undefined;
      setPrefill(detail?.question ?? null);
      setOpen(true);
    };
    window.addEventListener("freelane:open-ask-ai", handler as EventListener);
    return () => window.removeEventListener("freelane:open-ask-ai", handler as EventListener);
  }, []);

  if (!enabled) return null;

  return (
    <>
      <button
        type="button"
        aria-label="Ask your money"
        onClick={() => {
          setPrefill(null);
          setOpen(true);
        }}
        className="fixed bottom-6 right-6 z-30 grid h-12 w-12 place-items-center rounded-full bg-foreground text-background shadow-lg transition-transform hover:-translate-y-0.5 hover:shadow-xl"
      >
        <MessagesSquare className="h-5 w-5" />
      </button>
      <AskAiModal open={open} onOpenChange={setOpen} prefill={prefill} />
    </>
  );
}

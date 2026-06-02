"use client";

// Today-only AI question pills. Per the Today brief, these sit at the top
// of Today as a visible row (NOT inside the modal) so common today-scoped
// questions are one tap away. Dispatches the same `freelane:open-ask-ai`
// event the floating button uses and pre-fills the question.

const TODAY_PILLS = [
  "Did I overspend yet today?",
  "What's left in the GCash holding?",
  "Why is Safe-to-Spend lower than yesterday?",
] as const;

export function TodayQuestionPills() {
  const ask = (question: string) => {
    window.dispatchEvent(
      new CustomEvent("freelane:open-ask-ai", { detail: { question } }),
    );
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      {TODAY_PILLS.map((q) => (
        <button
          key={q}
          type="button"
          onClick={() => ask(q)}
          className="rounded-full bg-foreground/[0.04] px-3 py-1.5 text-[12px] text-muted-foreground transition-colors hover:bg-foreground/[0.08] hover:text-foreground"
        >
          {q}
        </button>
      ))}
    </div>
  );
}

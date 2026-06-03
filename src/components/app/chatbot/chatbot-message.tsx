"use client";

import { cn } from "@/lib/utils";

// Single message bubble. User bubbles right-aligned (acid-lime accent),
// assistant bubbles left-aligned (paper). System messages render as
// inline subtle dividers — currently we don't emit any from the brain
// stack but the shape is here for future use (e.g. "session resumed
// after 2h").
//
// Markdown rendering is intentionally NOT included — the chat brain
// returns plain text per its system prompt. If a richer renderer is
// needed later, swap the body span for a markdown component.
//
// Assistant rows can also carry 1-3 follow-up suggestion chips returned
// by the chat-answer brain (parsed out of the FOLLOWUPS: tail by
// splitFollowups). Each chip click re-sends that chip text as a new
// user message — the chips read as user-action prompts ("Plan it
// instead", "Add to wishlist", "Show me the math"), not as questions
// from the bot.

type Props = {
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
  followups?: string[];
  onPickFollowup?: (text: string) => void;
};

export function ChatbotMessage({
  role,
  content,
  followups,
  onPickFollowup,
}: Props) {
  if (role === "system") {
    return (
      <div className="my-1 text-center text-[11px] uppercase tracking-[0.16em] text-muted-foreground/70">
        {content}
      </div>
    );
  }
  const isUser = role === "user";
  const showFollowups =
    !isUser && Array.isArray(followups) && followups.length > 0;
  return (
    <div className={cn("flex flex-col", isUser ? "items-end" : "items-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed",
          isUser
            ? "bg-foreground text-background"
            : "bg-card text-foreground ring-1 ring-foreground/10",
        )}
      >
        <span className="whitespace-pre-wrap">{content}</span>
      </div>
      {showFollowups && (
        <div className="mt-1.5 flex max-w-[85%] flex-wrap gap-1.5">
          {followups!.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => onPickFollowup?.(f)}
              className="rounded-full border border-border/70 bg-card px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-foreground/40 hover:bg-foreground/[0.04] hover:text-foreground"
            >
              {f}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

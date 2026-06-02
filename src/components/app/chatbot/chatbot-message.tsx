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

type Props = {
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
};

export function ChatbotMessage({ role, content }: Props) {
  if (role === "system") {
    return (
      <div className="my-1 text-center text-[11px] uppercase tracking-[0.16em] text-muted-foreground/70">
        {content}
      </div>
    );
  }
  const isUser = role === "user";
  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
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
    </div>
  );
}

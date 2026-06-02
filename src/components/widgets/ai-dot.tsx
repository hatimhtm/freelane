"use client";

import type { MouseEvent } from "react";
import { cn } from "@/lib/utils";
import { setActiveCardContext } from "@/components/app/chatbot/chatbot-context-provider";

// AI dot — small ink-coloured dot top-right of any widget. Opens the
// chatbot scoped to this card via a `freelane:open-chatbot` CustomEvent
// the chatbot context provider listens for.
//
// VISIBILITY: dots default to a low opacity at rest and raise to full on
// hover/focus. On touch devices (`@media (pointer: coarse)`) there is no
// hover state, so the dot stays at full opacity — otherwise mobile users
// never discover the affordance. Aria-label spells out the target card.
//
// Click stops propagation so the parent card's onOpen doesn't fire too.

export type AiDotCardContext = {
  key: string;
  label: string;
  data?: Record<string, unknown>;
};

export type AiDotProps = {
  card: AiDotCardContext;
  question?: string;
  className?: string;
};

export function AiDot({ card, question, className }: AiDotProps) {
  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    // Preferred API — wraps the canonical freelane:open-chatbot
    // CustomEvent so external dispatchers (command palette, etc.) keep
    // working unchanged via the listener inside chatbot-context-provider.
    setActiveCardContext(card, question);
  };
  return (
    <button
      type="button"
      aria-label={`Ask the chatbot about ${card.label}`}
      onClick={handleClick}
      className={cn(
        // The visible dot is still 14px (h-3.5 w-3.5) but the hit region
        // is expanded via the ::before pseudo-element to 28x28 so the
        // affordance clears WCAG 2.5.5 + Apple's 44pt practical target.
        // Easy to miss before, easy to accidentally trigger the parent
        // card's edge — both gone now.
        "absolute right-2 top-2 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full",
        "before:absolute before:-inset-[7px] before:rounded-full before:content-['']",
        "bg-foreground/80 text-background transition-opacity",
        // Resting opacity 40% so the dot is discoverable without dominating;
        // group-hover/focus push it to full strength. Coarse pointers
        // (touch) skip the resting reduction so the affordance is always
        // visible on mobile + iPad.
        "opacity-40 group-hover:opacity-100 focus-visible:opacity-100",
        "[@media(pointer:coarse)]:opacity-100",
        "cursor-pointer hover:bg-foreground",
        className,
      )}
    >
      <span aria-hidden className="block h-1 w-1 rounded-full bg-background" />
    </button>
  );
}

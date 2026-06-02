"use client";

import { forwardRef, type KeyboardEvent, type ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  BRAND_LIME_RING_CLASS,
  BRAND_LIME_VAR_CLASS,
  TERRACOTTA_RING_CLASS,
} from "@/lib/design/tokens";
import { AiDot, type AiDotCardContext } from "./ai-dot";

// Freelane S widget — ~160 sq. Icon + one hero value. Label lives in a hover
// tooltip; the whole card is clickable. Reuse: pass `onOpen` to mount details.

export type SWidgetProps = {
  label: string;
  icon?: ReactNode;
  hero: ReactNode;
  sub?: ReactNode;
  className?: string;
  tone?: "default" | "lime" | "terracotta" | "rose" | "muted";
  live?: boolean;
  onOpen?: () => void;
  // Phase 1.5 — optional inline warning pill at the bottom of the card.
  // Renders a WarningPill (or any small ReactNode) below `sub`. Caller is
  // responsible for not stacking enough pills to break the icon+ONE-number
  // S contract.
  warning?: ReactNode;
  // Phase 1.5 — optional AI dot in the top-right corner. Click opens the
  // chatbot scoped to this card via the freelane:open-chatbot event.
  aiDot?: AiDotCardContext;
};

const TONE_RING: Record<NonNullable<SWidgetProps["tone"]>, string> = {
  default: "ring-foreground/10",
  lime: BRAND_LIME_RING_CLASS,
  terracotta: TERRACOTTA_RING_CLASS,
  rose: "ring-rose-500/30",
  muted: "ring-foreground/5",
};

export const SWidget = forwardRef<HTMLDivElement, SWidgetProps>(function SWidget(
  { label, icon, hero, sub, className, tone = "default", live, onOpen, warning, aiDot },
  ref,
) {
  const clickable = !!onOpen;
  const handleKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!onOpen) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpen();
    }
  };
  return (
    <TooltipProvider delay={120}>
      <Tooltip>
        <TooltipTrigger
          render={
            <div
              ref={ref}
              role={clickable ? "button" : undefined}
              tabIndex={clickable ? 0 : undefined}
              onClick={onOpen}
              onKeyDown={handleKey}
              data-slot="card"
              className={cn(
                "group relative flex aspect-square w-full min-h-[160px] flex-col justify-between rounded-xl bg-card p-4 ring-1 transition-all duration-300",
                TONE_RING[tone],
                clickable && "cursor-pointer hover:-translate-y-0.5 hover:shadow-[0_8px_20px_-8px_oklch(0_0_0/0.12)]",
                className,
              )}
            >
              <div className="flex items-start justify-between">
                {icon ? (
                  <div className="grid h-7 w-7 place-items-center rounded-md bg-foreground/[0.04] text-foreground/70">
                    {icon}
                  </div>
                ) : (
                  // No spacer — empty icon tile reads as decoration on Sleep /
                  // Today's Focus / Diary / Fees / Biggest debtor / Avg days.
                  <span aria-hidden />
                )}
                {live && (
                  <span className={cn("h-1.5 w-1.5 animate-breathe rounded-full", BRAND_LIME_VAR_CLASS)} />
                )}
              </div>
              <div className="space-y-1">
                <div className="display-headline text-[28px] leading-none tabular-nums text-foreground">
                  {hero}
                </div>
                {sub && (
                  <div className="text-[11px] leading-tight text-muted-foreground">{sub}</div>
                )}
                {warning && <div className="pt-1">{warning}</div>}
              </div>
              {aiDot && <AiDot card={aiDot} />}
            </div>
          }
        />
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
});

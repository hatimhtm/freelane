"use client";

import { forwardRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { AiDot, type AiDotCardContext } from "./ai-dot";

// Freelane L widget — ~340 x 340. Hero + chart + 4-6 supporting. Opt-in only.

export type LWidgetProps = {
  label?: string;
  eyebrow?: ReactNode;
  icon?: ReactNode;
  hero: ReactNode;
  sub?: ReactNode;
  chart?: ReactNode;
  supporting?: ReactNode;
  className?: string;
  tone?: "default" | "lime" | "terracotta" | "rose" | "muted";
  onOpen?: () => void;
  warning?: ReactNode;
  aiDot?: AiDotCardContext;
};

const TONE_RING: Record<NonNullable<LWidgetProps["tone"]>, string> = {
  default: "ring-foreground/10",
  lime: "ring-[oklch(0.85_0.18_120)]/30",
  terracotta: "ring-[oklch(0.7_0.13_45)]/30",
  rose: "ring-rose-500/30",
  muted: "ring-foreground/5",
};

export const LWidget = forwardRef<HTMLDivElement, LWidgetProps>(function LWidget(
  { label, eyebrow, icon, hero, sub, chart, supporting, className, tone = "default", onOpen, warning, aiDot },
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
    <div
      ref={ref}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-label={label}
      onClick={onOpen}
      onKeyDown={handleKey}
      data-slot="card"
      className={cn(
        "group relative flex min-h-[340px] w-full flex-col gap-3 rounded-xl bg-card p-5 ring-1 transition-all duration-300",
        TONE_RING[tone],
        clickable && "cursor-pointer hover:-translate-y-0.5 hover:shadow-[0_10px_28px_-12px_oklch(0_0_0/0.14)]",
        className,
      )}
    >
      <div className="flex items-start gap-2">
        {icon && (
          <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-foreground/[0.04] text-foreground/70">
            {icon}
          </div>
        )}
        {eyebrow && (
          <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {eyebrow}
          </div>
        )}
      </div>
      <div>
        <div className="display-headline text-[44px] leading-none tabular-nums text-foreground">
          {hero}
        </div>
        {sub && (
          <div className="mt-1.5 text-[13px] leading-snug text-muted-foreground">{sub}</div>
        )}
      </div>
      {chart && <div className="flex-1">{chart}</div>}
      {supporting && (
        <div className="text-[12px] leading-snug text-muted-foreground">{supporting}</div>
      )}
      {warning && <div>{warning}</div>}
      {aiDot && <AiDot card={aiDot} />}
    </div>
  );
});

// Shared layout helper — Hatim's spec calls for space-y-3 between widgets
// inside a group, space-y-6 between groups. Compose at the surface level.
export function widgetGroup() {
  return "space-y-3";
}
export function widgetGroupGap() {
  return "space-y-6";
}

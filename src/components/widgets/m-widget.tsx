"use client";

import { forwardRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  BRAND_LIME_RING_CLASS,
  BRAND_LIME_VAR_CLASS,
  TERRACOTTA_RING_CLASS,
} from "@/lib/design/tokens";

// Freelane M widget — ~340 x 160. Hero + 2-3 supporting lines + optional
// sparkline / shape on the right. Whole-card click.

export type MWidgetProps = {
  label?: string;
  eyebrow?: ReactNode;
  icon?: ReactNode;
  hero: ReactNode;
  sub?: ReactNode;
  supporting?: ReactNode;
  trailing?: ReactNode;
  className?: string;
  tone?: "default" | "lime" | "terracotta" | "rose" | "muted";
  live?: boolean;
  onOpen?: () => void;
};

const TONE_RING: Record<NonNullable<MWidgetProps["tone"]>, string> = {
  default: "ring-foreground/10",
  lime: BRAND_LIME_RING_CLASS,
  terracotta: TERRACOTTA_RING_CLASS,
  rose: "ring-rose-500/30",
  muted: "ring-foreground/5",
};

export const MWidget = forwardRef<HTMLDivElement, MWidgetProps>(function MWidget(
  { label, eyebrow, icon, hero, sub, supporting, trailing, className, tone = "default", live, onOpen },
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
        "group relative flex min-h-[160px] w-full rounded-xl bg-card p-4 ring-1 transition-all duration-300",
        TONE_RING[tone],
        clickable && "cursor-pointer hover:-translate-y-0.5 hover:shadow-[0_8px_20px_-8px_oklch(0_0_0/0.12)]",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col justify-between">
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
          {live && (
            <span className={cn("ml-auto h-1.5 w-1.5 animate-breathe rounded-full", BRAND_LIME_VAR_CLASS)} />
          )}
        </div>
        <div className="min-w-0 space-y-1.5">
          <div className="display-headline text-[36px] leading-none tabular-nums text-foreground">
            {hero}
          </div>
          {sub && (
            <div className="text-[12.5px] leading-snug text-muted-foreground">{sub}</div>
          )}
          {supporting && (
            <div className="text-[11.5px] leading-snug text-muted-foreground">{supporting}</div>
          )}
        </div>
      </div>
      {trailing && (
        <div className="ml-3 flex shrink-0 items-end justify-end self-end">
          {trailing}
        </div>
      )}
    </div>
  );
});

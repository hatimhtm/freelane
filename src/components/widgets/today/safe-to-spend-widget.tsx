"use client";

import { MoneyFlow } from "@/components/ui/money-flow";
import { MWidget } from "@/components/widgets/m-widget";
import { Stamp } from "@/components/widgets/shapes/stamp";
import { useRouter } from "next/navigation";
import { formatMoney } from "@/lib/money";
import type { CurrencyCode } from "@/lib/supabase/types";
import type { SafeToSpendBreakdown } from "@/lib/safe-to-spend";
import type { SafeToSpendOverlay } from "@/lib/ai/safe-to-spend-ai";

// T16 — Safe-to-Spend M widget. ALWAYS shows a number — never "still
// learning" as empty state. Below 14d of data, a small ROUGH stamp
// renders underneath.
//
// One hero number + one supporting shape (the Stamp). No icon — the
// canonical Wallet glyph is reserved for wallet entities, and a decorative
// TrailLine here would double-pair shapes with one number (locked rule:
// "DON'T pair more than one shape with one number"). The "SAFE TO SPEND"
// eyebrow carries the label. Live breathing dot ON — this is one of the
// two widgets the locked system names as carrying live time-sensitive data.

type Props = {
  baseline: SafeToSpendBreakdown;
  overlay: SafeToSpendOverlay | null;
  currency: CurrencyCode;
  // BUG FIX #2 (LIVE DAILY SAFE) — when provided, the widget renders
  // liveRemaining as the hero with a greyed "started today at ₱X"
  // subtitle. Falls back to the baseline-driven shape when omitted so
  // any legacy caller still works.
  liveRemaining?: number;
  initialForToday?: number;
  // yesterdaySafe was previously declared optional but never wired by any
  // caller — a dormant prop hides the missing-feature signal. Re-add when
  // a getAiSafeSpendCacheRow read returns the prior payload's safeTodayBase
  // and the page actually passes it through; in the meantime the delta line
  // (lines below) gates entirely on whether the prop is present.
};

function tagTone(
  tag: SafeToSpendBreakdown["confidenceTag"] | undefined,
): "muted" | "terracotta" | "lime" {
  if (tag === "rough") return "terracotta";
  if (tag === "calibrating") return "muted";
  return "lime";
}

function tagLabel(
  tag: SafeToSpendBreakdown["confidenceTag"] | undefined,
): string {
  if (tag === "rough") return "ROUGH";
  if (tag === "calibrating") return "CALIBRATING";
  return "STEADY";
}

export function SafeToSpendWidget({
  baseline,
  overlay,
  currency,
  liveRemaining,
  initialForToday,
}: Props) {
  const router = useRouter();
  // BUG FIX #2 — hero is liveRemaining when provided; legacy callers
  // fall back to the breakdown's safeTodayBase.
  const hasLive = liveRemaining != null;
  const heroValue = hasLive
    ? Math.max(0, Math.round(liveRemaining))
    : Math.max(0, baseline.safeTodayBase);
  const initialValue =
    initialForToday != null
      ? Math.max(0, Math.round(initialForToday))
      : Math.max(0, Math.round(baseline.safeTodayBase));
  const horizonDays = baseline.horizonDays;
  const walletsTotal = Math.max(0, Math.round(baseline.walletBalancesBase ?? 0));
  // T32 fallback — older cached payloads predate confidenceTag.
  const tag = baseline.confidenceTag ?? "calibrating";

  const headline = (
    <span>
      <MoneyFlow value={heroValue} currency={currency} />
    </span>
  );

  // div (not span) — flex-column on a span around block-content spans
  // is technically valid HTML but fragile if MWidget ever restyles its
  // sub slot. MWidget already wraps `sub` in a div, so this fits cleanly.
  const sub = (
    <div className="flex flex-col gap-0.5">
      {hasLive ? (
        <span className="text-[11px] text-muted-foreground/70">
          started today at {formatMoney(initialValue, currency, { compact: true })}
        </span>
      ) : (
        <span>for the next {horizonDays} days</span>
      )}
      <span className="text-[11px] text-muted-foreground/80">
        of {formatMoney(walletsTotal, currency, { compact: true })} across wallets
      </span>
    </div>
  );

  // Reasoning rendered as a supporting line only when it carries useful
  // signal — short fragments or paraphrases of the tag get dropped so the
  // card doesn't read as four stacked sub lines.
  const reasoning = overlay?.oneLineReasoning?.trim();
  const reasoningTagOverlap =
    reasoning && tagLabel(tag).toLowerCase().includes(reasoning.toLowerCase().slice(0, 6));
  const useReasoning = !!reasoning && reasoning.length >= 20 && !reasoningTagOverlap;

  const supporting = (
    <div className="flex flex-wrap items-center gap-2">
      <Stamp tone={tagTone(tag)}>{tagLabel(tag)}</Stamp>
      {useReasoning && (
        <span className="text-[11px] text-muted-foreground/70 line-clamp-1">
          {reasoning}
        </span>
      )}
    </div>
  );

  return (
    <MWidget
      label="Safe to spend"
      eyebrow="SAFE TO SPEND"
      hero={headline}
      sub={sub}
      supporting={supporting}
      live
      onOpen={() => router.push("/spending")}
    />
  );
}

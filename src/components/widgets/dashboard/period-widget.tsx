"use client";

import { SWidget } from "@/components/widgets/s-widget";
import { NumberHero } from "@/components/widgets/number-hero";
import { WarningPill } from "@/components/widgets/warning-pill";

// PeriodWidget hides when `daysRemaining` is null. Until the period concept
// has a real source (anchor expiry, recovery target, etc.), the widget
// stays gated so we never ship a hard-coded number as the State headline.
// The endingSoon pill carries a detailHref so the warning is tappable
// rather than purely decorative.
type Props = {
  daysRemaining: number | null;
  endingSoon: boolean;
  endingSoonMessage?: string;
};

export function PeriodWidget({
  daysRemaining,
  endingSoon,
  endingSoonMessage,
}: Props) {
  if (daysRemaining == null) return null;
  return (
    <SWidget
      label="Current period"
      hero={<NumberHero value={daysRemaining} suffix="d" maximumFractionDigits={0} />}
      sub={<span>until next anchor</span>}
      warning={
        endingSoon ? (
          <WarningPill detailHref="/today#tight-mode">
            {endingSoonMessage ?? "Period closes soon"}
          </WarningPill>
        ) : undefined
      }
      aiDot={{ key: "state.period", label: "Current period" }}
    />
  );
}

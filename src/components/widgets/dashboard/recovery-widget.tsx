"use client";

import { SWidget } from "@/components/widgets/s-widget";
import { NumberHero } from "@/components/widgets/number-hero";
import { WarningPill } from "@/components/widgets/warning-pill";

type Props = {
  inRecovery: boolean;
  progress01: number;
  stalled: boolean;
};

export function RecoveryWidget({ inRecovery, progress01, stalled }: Props) {
  if (!inRecovery) return null;
  const pct = Math.round(Math.max(0, Math.min(1, progress01)) * 100);
  return (
    <SWidget
      label="Recovery progress"
      hero={<NumberHero value={pct} suffix="%" maximumFractionDigits={0} />}
      sub={<span>of the recovery target</span>}
      warning={
        stalled ? (
          <WarningPill detailHref="/today">Progress stalled</WarningPill>
        ) : undefined
      }
      aiDot={{ key: "state.recovery", label: "Recovery" }}
    />
  );
}

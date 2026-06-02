"use client";

import { useRouter } from "next/navigation";
import { SWidget } from "@/components/widgets/s-widget";
import { Smoke } from "@/components/widgets/icons/smoke";
import { NumberHero } from "@/components/widgets/number-hero";

// T20 — Cigarettes S widget. Today's count vs the 30d daily baseline.
// One number + tone-encoded ring (terracotta when over baseline). Per the
// locked S contract — icon + one hero number; the baseline lives in the
// sub line as plain text rather than a second shape. Previously the card
// stacked a StackBar + a baseline caption + the hero, which read as two
// supporting visuals for one number.
//
// Icon: canonical Freelane Smoke glyph (lucide's Cigarette is too literal
// per the locked widget vocabulary).

type Props = {
  todayCount: number;
  baselineDailyCount: number;
};

export function CigarettesWidget({ todayCount, baselineDailyCount }: Props) {
  const router = useRouter();
  if (baselineDailyCount === 0 && todayCount === 0) return null;
  const ratio = baselineDailyCount > 0 ? todayCount / baselineDailyCount : 1;
  const tone = ratio >= 1.2 ? "terracotta" : ratio <= 0.6 ? "lime" : "muted";
  return (
    <SWidget
      label="Cigarettes today vs baseline"
      icon={<Smoke className="h-4 w-4" />}
      hero={<NumberHero value={todayCount} className="tabular-nums" />}
      tone={tone === "terracotta" ? "terracotta" : tone === "lime" ? "lime" : "default"}
      sub={`baseline ${Math.round(baselineDailyCount)}/day`}
      onOpen={() => router.push("/spending?category=cigarettes")}
    />
  );
}

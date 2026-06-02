"use client";

import { useRouter } from "next/navigation";
import { SWidget } from "@/components/widgets/s-widget";
import { NumberHero } from "@/components/widgets/number-hero";
import { Smoke } from "@/components/widgets/icons/smoke";

// CigarettesWidget — Body subtab. Stick count for today vs the 7d
// average. Distinct from PackRhythmWidget (which is peso-cost over 12
// weeks on Money). Relevance-gated: hides when no cigarette data wired.
type Props = {
  today: number | null;
  avg7d: number | null;
};

export function CigarettesWidget({ today, avg7d }: Props) {
  const router = useRouter();
  if (today == null && avg7d == null) return null;
  const hero = today ?? avg7d ?? 0;
  return (
    <SWidget
      label="Cigarettes"
      icon={<Smoke className="h-4 w-4" />}
      hero={<NumberHero value={Math.round(hero)} maximumFractionDigits={0} />}
      sub={
        avg7d != null ? (
          <span>{(Math.round(avg7d * 10) / 10).toFixed(1)}/d · 7d avg</span>
        ) : (
          <span>today</span>
        )
      }
      aiDot={{ key: "body.cigarettes", label: "Cigarettes" }}
      onOpen={() => router.push("/spending?category=cigarettes")}
    />
  );
}

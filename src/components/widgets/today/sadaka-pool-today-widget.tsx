"use client";

import { useRouter } from "next/navigation";
import { HandHeart } from "lucide-react";
import { SWidget } from "@/components/widgets/s-widget";
import { NumberHero } from "@/components/widgets/number-hero";
import type { CurrencyCode } from "@/lib/supabase/types";

// Today widget — relevance-gated card. Renders ONLY when the suggestion brain
// says surface_today=true AND suggested_amount > 0 (the parent decides
// whether to mount this at all). When mounted, the hero is the suggested
// amount; the sub-line carries both the brain's reasoning (when present)
// AND the pool balance, so the user always sees the anchor context. Tap
// navigates to /sadaka.

type Props = {
  poolBase: number;
  suggestedAmount: number;
  currency: CurrencyCode;
  reasoning?: string | null;
};

export function SadakaPoolTodayWidget({
  poolBase,
  suggestedAmount,
  currency,
  reasoning,
}: Props) {
  const router = useRouter();
  const poolLine = `pool sits at ${currency} ${Math.round(poolBase)}`;
  return (
    <SWidget
      label="Sadaka"
      icon={<HandHeart className="h-4 w-4" />}
      hero={
        <NumberHero
          value={Math.round(suggestedAmount)}
          prefix={`${currency} `}
        />
      }
      sub={
        reasoning ? (
          <span className="flex flex-col gap-0.5">
            <span>{reasoning}</span>
            <span className="text-muted-foreground/70">{poolLine}</span>
          </span>
        ) : (
          <span>{poolLine}</span>
        )
      }
      onOpen={() => router.push("/sadaka")}
      aiDot={{ key: "today.sadaka_pool", label: "Sadaka pool" }}
    />
  );
}

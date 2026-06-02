"use client";

import { useRouter } from "next/navigation";
import { HandHeart } from "lucide-react";
import { SWidget } from "@/components/widgets/s-widget";
import { NumberHero } from "@/components/widgets/number-hero";
import { WarningPill } from "@/components/widgets/warning-pill";
import type { WarningResult } from "@/lib/warnings/registry";
import type { CurrencyCode } from "@/lib/supabase/types";

// Dashboard /commitments — small Sadaka card. Pool number + suggested-today
// sub-line. Always visible on /commitments (Dashboard is general, not
// relevance-gated). Tap navigates to /sadaka.
//
// `warning` slot accepts a resolved sadaka_pool_overdue result so the
// dispatcher branch in lib/warnings/registry can attach the pill when the
// pool exceeds the grace window. `currency` keeps the hero + sub-line
// prefixed consistently with peer dashboard widgets (OpenPaymentsWidget
// etc) — naked numbers next to currency-prefixed siblings was breaking
// the row's visual contract.

type Props = {
  poolBase: number;
  suggestedToday?: number;
  currency: CurrencyCode;
  warning?: WarningResult;
};

export function SadakaPoolWidget({
  poolBase,
  suggestedToday,
  currency,
  warning,
}: Props) {
  const router = useRouter();
  const sub =
    suggestedToday && suggestedToday > 0
      ? `Suggested today · ${currency} ${Math.round(suggestedToday)}`
      : "Voluntary giving pool";
  return (
    <SWidget
      label="Sadaka pool"
      icon={<HandHeart className="h-4 w-4" />}
      hero={
        <NumberHero
          value={poolBase}
          maximumFractionDigits={0}
          prefix={`${currency} `}
        />
      }
      sub={<span>{sub}</span>}
      onOpen={() => router.push("/sadaka")}
      warning={
        warning?.active ? (
          <WarningPill detailHref={warning.detailHref}>
            {warning.message ?? "Sadaka pool past grace window"}
          </WarningPill>
        ) : undefined
      }
      aiDot={{ key: "commitments.sadaka_pool", label: "Sadaka pool" }}
    />
  );
}

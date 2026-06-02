"use client";

import { useRouter } from "next/navigation";
import { ArrowDownLeft } from "lucide-react";
import { SWidget } from "@/components/widgets/s-widget";
import { NumberHero } from "@/components/widgets/number-hero";
import type { CurrencyCode } from "@/lib/supabase/types";
import { formatMoney } from "@/lib/money";

// /dashboard/money — 30d net derived from money_ledger. Footnote surfaces
// the unaccounted_outflow total when present so the gap is visible.

type Props = {
  netBase: number;
  unaccountedBase: number;
  currency: CurrencyCode;
};

export function ThirtyDayNetWidget({ netBase, unaccountedBase, currency }: Props) {
  const router = useRouter();
  return (
    <SWidget
      label="Net (30 days)"
      icon={<ArrowDownLeft className="h-4 w-4" />}
      hero={<NumberHero value={netBase} maximumFractionDigits={0} />}
      sub={
        unaccountedBase > 0 ? (
          <span>
            incl. {formatMoney(unaccountedBase, currency, { compact: true })} unlogged
          </span>
        ) : (
          <span>last 30 days</span>
        )
      }
      aiDot={{ key: "money.thirty_day_net", label: "30-day net" }}
      onOpen={() => router.push("/spending")}
    />
  );
}

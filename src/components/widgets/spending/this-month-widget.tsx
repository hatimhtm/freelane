"use client";

import { useMemo } from "react";
import NumberFlow from "@number-flow/react";
import { SWidget } from "@/components/widgets/s-widget";
import type { CurrencyCode, Spend } from "@/lib/supabase/types";

// Spending workflow — TOP SECTION RESTYLE.
//
// "This month" S widget. Always shows month-to-date total relative to
// the active calendar month (NOT the navigated month — this card is the
// always-current reference). Eyebrow / label = "This month".
export function ThisMonthWidget({
  recentSpends,
  baseCurrency,
}: {
  recentSpends: Spend[];
  baseCurrency: CurrencyCode;
}) {
  const monthTotal = useMemo(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    let total = 0;
    for (const sp of recentSpends) {
      const t = new Date(sp.spent_at).getTime();
      if (t >= start) total += Number(sp.amount_base ?? 0);
    }
    return total;
  }, [recentSpends]);

  return (
    <SWidget
      label="This month"
      hero={
        <NumberFlow
          value={Math.round(monthTotal)}
          format={{
            style: "currency",
            currency: baseCurrency,
            maximumFractionDigits: 0,
          }}
        />
      }
      sub={<span>month to date</span>}
    />
  );
}

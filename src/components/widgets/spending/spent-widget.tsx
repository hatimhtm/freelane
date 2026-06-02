"use client";

import { useMemo } from "react";
import NumberFlow from "@number-flow/react";
import { Sparkline } from "@/components/stats/sparkline";
import { MWidget } from "@/components/widgets/m-widget";
import { phtDateString } from "@/lib/utils";
import type { CurrencyCode, Spend } from "@/lib/supabase/types";

const DAY_MS = 86_400_000;

// Spending workflow — TOP SECTION RESTYLE.
//
// "Spent" M widget. Replaces the legacy "Total" StatStrip cell. Hero is
// the period total spent. Sub: delta vs prior period (when prior is
// non-zero). Trailing: 30d sparkline.
//
// Copy fix: the eyebrow + label is "Spent" — NEVER "Total". Avoids the
// bare "Total" label everywhere in the Spending context.
export function SpentWidget({
  monthSpends,
  recentSpends,
  prevTotalBase,
  baseCurrency,
}: {
  monthSpends: Spend[];
  // Used to build the 30d sparkline (trailing window from today).
  recentSpends: Spend[];
  prevTotalBase: number;
  baseCurrency: CurrencyCode;
}) {
  const monthTotal = useMemo(
    () => monthSpends.reduce((s, sp) => s + Number(sp.amount_base ?? 0), 0),
    [monthSpends],
  );
  const deltaPct =
    prevTotalBase > 0
      ? ((monthTotal - prevTotalBase) / prevTotalBase) * 100
      : null;

  // 30d sparkline — bucketed by PHT date. amount_base only so cross-
  // currency rows are already at PHP.
  const spark = useMemo(() => {
    const today = new Date();
    const buckets = new Array<number>(30).fill(0);
    const todayPht = phtDateString(today);
    const todayMs = new Date(`${todayPht}T00:00:00+08:00`).getTime();
    for (const sp of recentSpends) {
      const d = new Date(sp.spent_at);
      const diff = Math.floor((todayMs - d.getTime()) / DAY_MS);
      if (diff < 0 || diff >= 30) continue;
      buckets[29 - diff]! += Number(sp.amount_base ?? 0);
    }
    return buckets;
  }, [recentSpends]);

  const hero = (
    <NumberFlow
      value={Math.round(monthTotal)}
      format={{
        style: "currency",
        currency: baseCurrency,
        maximumFractionDigits: 0,
      }}
    />
  );

  const sub =
    deltaPct === null ? (
      <span className="text-muted-foreground/80">first month logged</span>
    ) : (
      <span>
        {deltaPct >= 0 ? "+" : ""}
        {deltaPct.toFixed(0)}% vs prior period
      </span>
    );

  return (
    <MWidget
      label="Spent"
      eyebrow="SPENT"
      hero={hero}
      sub={sub}
      trailing={
        <Sparkline
          data={spark}
          width={120}
          height={44}
          color="var(--chart-1)"
          filled
          strokeWidth={1.5}
        />
      }
    />
  );
}

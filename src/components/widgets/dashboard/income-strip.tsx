"use client";

import { useRouter } from "next/navigation";
import { ArrowDownLeft, ArrowUpRight, Clock } from "lucide-react";
import { MoneyFlow } from "@/components/ui/money-flow";
import { SWidget } from "@/components/widgets/s-widget";
import { NumberHero } from "@/components/widgets/number-hero";
import { useMetricSheet } from "@/components/app/metric-sheet";
import type { CurrencyCode } from "@/lib/supabase/types";

// T28 — 8 income / comparison S widgets. Comparison-set rule applies: each
// card stays visible at 0 even when the underlying number is zero.
//
// Icon vocabulary: ONLY the locked glyphs from the widget system.
// Income / paid / YTD / week / trailing-30-landed → ArrowDownLeft (income),
// ArrowUpRight (spend / outgoing money — fees only here),
// Clock (time-anchored: outstanding, avg-days, biggest debtor's age).
// Every S widget carries one canonical glyph so the comparison-set rule
// (visible at 0) doesn't leave shape-less, icon-less ghost boxes.
//
// "Biggest debtor" hero is the OUTSTANDING TOTAL (number), with the client
// name + age in the sub line — the S contract is "icon + ONE number" and a
// name as hero fails the 1s glance test.

type Props = {
  currency: CurrencyCode;
  landedMtd: number;
  weekLanded: number;
  outstandingTotal: number;
  feesMtd: number;
  avgDaysToPayment: number | null;
  // oldestDays optional so the sub line ("Name · 12d") can read time as
  // well as identity without re-computing on the dashboard side.
  biggestDebtor: { name: string; total: number; oldestDays?: number } | null;
  ytd: number;
  trailing30: number;
};

export function IncomeStrip({
  currency,
  landedMtd,
  weekLanded,
  outstandingTotal,
  feesMtd,
  avgDaysToPayment,
  biggestDebtor,
  ytd,
  trailing30,
}: Props) {
  const router = useRouter();
  const { open } = useMetricSheet();
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <SWidget
        label="Landed this month"
        icon={<ArrowDownLeft className="h-4 w-4" />}
        hero={<MoneyFlow value={landedMtd} currency={currency} />}
        sub="this month"
        onOpen={() => open("landed")}
      />
      <SWidget
        label="This week landed"
        icon={<ArrowDownLeft className="h-4 w-4" />}
        hero={<MoneyFlow value={weekLanded} currency={currency} />}
        sub="this week"
        onOpen={() => router.push("/payments")}
      />
      <SWidget
        label="Outstanding"
        icon={<Clock className="h-4 w-4" />}
        hero={<MoneyFlow value={outstandingTotal} currency={currency} />}
        sub="open balances"
        onOpen={() => open("outstanding")}
      />
      <SWidget
        label="Fees this month"
        icon={<ArrowUpRight className="h-4 w-4" />}
        hero={<MoneyFlow value={feesMtd} currency={currency} />}
        sub="rails + FX"
        onOpen={() => open("fees")}
      />
      <SWidget
        label="Avg days to payment"
        icon={<Clock className="h-4 w-4" />}
        hero={
          avgDaysToPayment === null ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <NumberHero
              value={Math.round(avgDaysToPayment)}
              suffix="d"
              className="tabular-nums"
            />
          )
        }
        sub="quote to first payment"
        onOpen={() => open("avg-days")}
      />
      <SWidget
        label="Biggest debtor"
        icon={<Clock className="h-4 w-4" />}
        // S contract: icon + ONE number. Hero answers "how much?"; the sub
        // line carries identity (name) + age. A name-as-hero failed the 1s
        // glance test on review — flipped to MoneyFlow.
        hero={
          biggestDebtor ? (
            <MoneyFlow value={biggestDebtor.total} currency={currency} />
          ) : (
            <span className="text-muted-foreground">—</span>
          )
        }
        sub={
          biggestDebtor ? (
            <span className="truncate">
              {biggestDebtor.name}
              {typeof biggestDebtor.oldestDays === "number" ? ` · ${biggestDebtor.oldestDays}d` : ""}
            </span>
          ) : (
            "no one"
          )
        }
        onOpen={() => open("debtor")}
      />
      <SWidget
        label="Year to date"
        icon={<ArrowDownLeft className="h-4 w-4" />}
        hero={<MoneyFlow value={ytd} currency={currency} />}
        sub="landed YTD"
        onOpen={() => router.push("/payments")}
      />
      <SWidget
        label="Trailing 30d landed"
        // ArrowDownLeft (income glyph). The dashboard sources trailing30 from
        // landedInRange(payments) — it's landed income, not outflow. Earlier
        // pairing with ArrowUpRight read as a fee/outflow chip and contradicted
        // the underlying metric.
        icon={<ArrowDownLeft className="h-4 w-4" />}
        hero={<MoneyFlow value={trailing30} currency={currency} />}
        sub="landed last 30 days"
        onOpen={() => router.push("/payments")}
      />
    </div>
  );
}

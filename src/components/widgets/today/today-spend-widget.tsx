"use client";

import { useRouter } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import { MoneyFlow } from "@/components/ui/money-flow";
import { SWidget } from "@/components/widgets/s-widget";
import type { CurrencyCode } from "@/lib/supabase/types";

// T22 — Today's spend so far. Hero = sum of today's spends. Sub = an
// honest 7-day spend count (numeric, not a fake DayStrip). Self-hides
// when no spend logged today. Live breathing dot ON — this widget moves
// every time a spend lands.

type Props = {
  todayBase: number;
  last7DayCount: number;
  currency: CurrencyCode;
};

export function TodaySpendWidget({ todayBase, last7DayCount, currency }: Props) {
  const router = useRouter();
  if (todayBase <= 0) return null;
  const subText =
    last7DayCount > 0
      ? `so far today · ${last7DayCount} in 7d`
      : "so far today";
  return (
    <SWidget
      label="Today's spend"
      icon={<ArrowUpRight className="h-4 w-4" />}
      hero={<MoneyFlow value={todayBase} currency={currency} />}
      sub={subText}
      live
      onOpen={() => router.push("/spending")}
    />
  );
}

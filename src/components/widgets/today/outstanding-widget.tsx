"use client";

import { Clock } from "lucide-react";
import { MoneyFlow } from "@/components/ui/money-flow";
import { SWidget } from "@/components/widgets/s-widget";
import { useMetricSheet } from "@/components/app/metric-sheet";
import type { CurrencyCode } from "@/lib/supabase/types";

// T18 — Outstanding S widget. Hero = total outstanding ₱ + sub = "Nd
// oldest" plain-text age. No DayStrip — the previous version inked a fixed
// number of dots with current=0 regardless of any real day cursor, so the
// shape carried no signal beyond the age number (glance-test fail).
// Whole-card click opens the metric sheet.

type Props = {
  totalBase: number;
  oldestDays: number;
  currency: CurrencyCode;
};

export function OutstandingWidget({ totalBase, oldestDays, currency }: Props) {
  const { open } = useMetricSheet();
  if (totalBase <= 0) return null;
  return (
    <SWidget
      label="Outstanding"
      icon={<Clock className="h-4 w-4" />}
      hero={<MoneyFlow value={totalBase} currency={currency} />}
      sub={oldestDays > 0 ? `${oldestDays}d oldest` : "fresh"}
      onOpen={() => open("outstanding")}
    />
  );
}

"use client";

import { Sparkles } from "lucide-react";
import { formatMoney } from "@/lib/money";
import type { CurrencyCode } from "@/lib/supabase/types";
import type { FamilySavingsWitness } from "@/lib/family-savings-witness";

// Family Savings Witness — quiet running number, NOT a target. Surface
// as 11px line. Hides entirely when parkedBase is 0.

export function FamilySavingsWitnessLine({
  read,
  baseCurrency,
}: {
  read: FamilySavingsWitness;
  baseCurrency: CurrencyCode;
}) {
  if (read.parkedBase <= 0) return null;
  const trendLabel = read.trend === "growing"
    ? "growing"
    : read.trend === "shrinking"
      ? "thinner"
      : "steady";
  return (
    <div className="flex items-baseline gap-1.5 text-[11px] text-muted-foreground">
      <Sparkles className="h-3 w-3 text-acid-lime" />
      <span className="text-foreground/80">
        {formatMoney(read.parkedBase, baseCurrency, { compact: true })}
      </span>
      <span>parked toward the household ·</span>
      <span>{trendLabel}</span>
    </div>
  );
}

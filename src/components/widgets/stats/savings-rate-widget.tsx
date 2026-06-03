"use client";

import { PiggyBank } from "lucide-react";
import { AiDot } from "@/components/widgets/ai-dot";
import { formatMoney } from "@/lib/money";
import type { CurrencyCode } from "@/lib/supabase/types";

// Savings rate — Money/S widget. Hero is %, sub is the absolute saved
// amount + the total income it came from. Negative rate (overspending)
// surfaces in terracotta-adjacent muted red so the framing reads
// honest without becoming alarmist.

export type SavingsRateWidgetProps = {
  scope: string;
  data: { rate: number; income: number; outflow: number; saved: number };
  baseCurrency: CurrencyCode;
};

export function SavingsRateWidget({ scope, data, baseCurrency }: SavingsRateWidgetProps) {
  const cardKey = `stats.${scope}.savings_rate`;
  const pct = Math.round(data.rate * 100);
  const positive = data.saved >= 0;
  return (
    <div
      className={
        "group relative flex aspect-square min-h-[160px] w-full flex-col justify-between rounded-xl bg-card p-4 ring-1 ring-foreground/10"
      }
    >
      <div className="flex items-start gap-2">
        <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-foreground/[0.04] text-foreground/70">
          <PiggyBank className="h-4 w-4" />
        </div>
        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          Savings rate
        </div>
      </div>
      <div className="space-y-1">
        <div className="display-headline text-[28px] leading-none tabular-nums text-foreground">
          {pct}%
        </div>
        <div className="text-[11px] leading-tight text-muted-foreground">
          {positive ? "Kept" : "Overspent"}{" "}
          {formatMoney(Math.abs(data.saved), baseCurrency, { compact: true })} of{" "}
          {formatMoney(data.income, baseCurrency, { compact: true })}
        </div>
      </div>
      <AiDot
        card={{
          key: cardKey,
          label: "Savings rate",
          data: { scope, rate: data.rate, income: data.income, outflow: data.outflow },
        }}
        question="What would push my savings rate up?"
      />
    </div>
  );
}

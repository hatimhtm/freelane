"use client";

import { ArrowDownLeft } from "lucide-react";
import { MoneyFlow } from "@/components/ui/money-flow";
import { MWidget } from "@/components/widgets/m-widget";
import { AiDot } from "@/components/widgets/ai-dot";
import type { CurrencyCode } from "@/lib/supabase/types";

// IncomeStrip — canonical brief shape: ONE M widget containing 4 internal
// cells labelled Week / Month / Year / Lifetime. Comparison-set rule
// applies: each cell stays visible at 0 even when the underlying number is
// zero. The four cells come from money_ledger (income / project_receipt)
// rolled up by time-window — the loader passes pre-summed values.
//
// Each cell carries its own AiDot so the chatbot can answer per-window
// questions (money.week_landed, money.month_landed, etc.) without
// conflating the four time-buckets into one card context.

type Props = {
  currency: CurrencyCode;
  weekLanded: number;
  monthLanded: number;
  yearLanded: number;
  lifetimeLanded: number;
};

export function IncomeStrip({
  currency,
  weekLanded,
  monthLanded,
  yearLanded,
  lifetimeLanded,
}: Props) {
  const cells: Array<{
    label: string;
    value: number;
    aiKey: string;
  }> = [
    { label: "Week", value: weekLanded, aiKey: "money.week_landed" },
    { label: "Month", value: monthLanded, aiKey: "money.month_landed" },
    { label: "Year", value: yearLanded, aiKey: "money.year_landed" },
    { label: "Lifetime", value: lifetimeLanded, aiKey: "money.lifetime_landed" },
  ];
  return (
    <MWidget
      label="Landed income"
      eyebrow="Landed"
      icon={<ArrowDownLeft className="h-4 w-4" />}
      hero={
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-4">
          {cells.map((c) => (
            <div key={c.aiKey} className="relative min-w-0">
              <div className="text-[28px] leading-none tabular-nums text-foreground">
                <MoneyFlow value={c.value} currency={currency} />
              </div>
              <div className="mt-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                {c.label}
              </div>
              <AiDot
                card={{
                  key: c.aiKey,
                  label: `${c.label} landed`,
                  data: { currency, value: c.value },
                }}
              />
            </div>
          ))}
        </div>
      }
    />
  );
}

"use client";

import { Cigarette } from "lucide-react";
import { AiDot } from "@/components/widgets/ai-dot";
import { formatMoney } from "@/lib/money";
import type { CurrencyCode } from "@/lib/supabase/types";

// Cigarette translator total — Journey/M widget. Sums base spend on
// the Cigarettes category over the scope and reframes it in the
// familiar "X family-wallet days" idiom from Tier 4.

export type CigaretteTranslatorTotalWidgetProps = {
  scope: string;
  data: { totalBase: number; spendCount: number; familyWalletDays: number };
  baseCurrency: CurrencyCode;
};

export function CigaretteTranslatorTotalWidget({
  scope,
  data,
  baseCurrency,
}: CigaretteTranslatorTotalWidgetProps) {
  const cardKey = `stats.${scope}.cigarette_translator`;
  const days = Math.round(data.familyWalletDays);
  return (
    <div className="group relative flex min-h-[200px] w-full flex-col rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex items-start gap-2">
        <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-foreground/[0.04] text-foreground/70">
          <Cigarette className="h-4 w-4" />
        </div>
        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          Cigarettes translated
        </div>
      </div>
      <div className="mt-3">
        <div className="display-headline text-[28px] leading-none tabular-nums text-foreground">
          {formatMoney(data.totalBase, baseCurrency, { compact: true })}
        </div>
        <div className="mt-1.5 text-[12px] text-muted-foreground">
          {days} days closer to a family wallet ·{" "}
          <span className="tabular-nums">{data.spendCount}</span> spends in scope
        </div>
      </div>
      <AiDot
        card={{
          key: cardKey,
          label: "Cigarette translator",
          data: {
            scope,
            total_base: data.totalBase,
            spend_count: data.spendCount,
            family_wallet_days: data.familyWalletDays,
          },
        }}
        question="What would a quieter cigarette month do to my runway?"
      />
    </div>
  );
}

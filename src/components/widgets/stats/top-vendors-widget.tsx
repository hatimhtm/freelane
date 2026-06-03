"use client";

import { Store } from "lucide-react";
import { AiDot } from "@/components/widgets/ai-dot";
import { formatMoney } from "@/lib/money";
import type { CurrencyCode } from "@/lib/supabase/types";

// Top vendors — Money/M widget. Vendor leaderboard within scope.

export type TopVendorsWidgetProps = {
  scope: string;
  vendors: Array<{ vendorId: string; name: string; amount: number; count: number }>;
  baseCurrency: CurrencyCode;
};

export function TopVendorsWidget({ scope, vendors, baseCurrency }: TopVendorsWidgetProps) {
  const cardKey = `stats.${scope}.top_vendors`;
  const max = Math.max(1, ...vendors.map((v) => v.amount));
  return (
    <div className="group relative flex min-h-[200px] w-full flex-col rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex items-start gap-2">
        <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-foreground/[0.04] text-foreground/70">
          <Store className="h-4 w-4" />
        </div>
        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          Top vendors
        </div>
      </div>
      <ul className="mt-3 flex flex-1 flex-col gap-1.5">
        {vendors.map((v) => (
          <li key={v.vendorId} className="flex items-center gap-2 text-[12.5px]">
            <span className="min-w-0 flex-1 truncate text-foreground/85">{v.name}</span>
            <div className="flex shrink-0 items-center gap-2">
              <div className="h-1 w-16 overflow-hidden rounded-full bg-foreground/[0.06]">
                <div
                  className="h-full bg-foreground/40"
                  style={{ width: `${(v.amount / max) * 100}%` }}
                />
              </div>
              <span className="tabular-nums text-foreground/80">
                {formatMoney(v.amount, baseCurrency, { compact: true })}
              </span>
            </div>
          </li>
        ))}
      </ul>
      <AiDot
        card={{
          key: cardKey,
          label: "Top vendors",
          data: { scope, vendor_ids: vendors.map((v) => v.vendorId) },
        }}
        question="What's driving these top vendors?"
      />
    </div>
  );
}

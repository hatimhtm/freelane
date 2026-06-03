"use client";

import { Archive } from "lucide-react";
import { AiDot } from "@/components/widgets/ai-dot";
import { formatMoney } from "@/lib/money";
import { phtDateString } from "@/lib/utils";
import type { CurrencyCode } from "@/lib/supabase/types";

// Big plans archive — Journey/M widget. The big planned_spends that
// have been decided (done or cancelled) within scope, with the
// planned vs actual delta when both numbers are present.

export type BigPlansArchiveWidgetProps = {
  scope: string;
  plans: Array<{
    id: string;
    label: string;
    status: string;
    decidedAt: string | null;
    actualBase: number | null;
    plannedBase: number;
  }>;
  baseCurrency: CurrencyCode;
};

const STATUS_LABEL: Record<string, string> = {
  done: "Done",
  cancelled: "Cancelled",
};

export function BigPlansArchiveWidget({
  scope,
  plans,
  baseCurrency,
}: BigPlansArchiveWidgetProps) {
  const cardKey = `stats.${scope}.big_plans_archive`;
  return (
    <div className="group relative flex min-h-[200px] w-full flex-col rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex items-start gap-2">
        <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-foreground/[0.04] text-foreground/70">
          <Archive className="h-4 w-4" />
        </div>
        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          Big plans archive
        </div>
      </div>
      <ul className="mt-3 flex flex-1 flex-col divide-y divide-border/40">
        {plans.map((p) => {
          const actual = p.actualBase;
          const planned = p.plannedBase;
          let deltaPct: number | null = null;
          if (typeof actual === "number" && planned > 0) {
            deltaPct = Math.round(((actual - planned) / planned) * 100);
          }
          return (
            <li key={p.id} className="py-2">
              <div className="flex items-center gap-3 text-[12.5px]">
                <span className="min-w-0 flex-1 truncate text-foreground/90">
                  {p.label}
                </span>
                <span className="shrink-0 text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground">
                  {STATUS_LABEL[p.status] ?? p.status}
                </span>
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-[10.5px] text-muted-foreground">
                <span>
                  {p.decidedAt ? phtDateString(new Date(p.decidedAt)) : "Pending"}
                </span>
                <span className="tabular-nums">
                  · planned {formatMoney(planned, baseCurrency, { compact: true })}
                  {typeof actual === "number" && (
                    <>
                      {" "}· actual {formatMoney(actual, baseCurrency, { compact: true })}
                      {deltaPct !== null && (
                        <>
                          {" "}({deltaPct > 0 ? "+" : ""}
                          {deltaPct}%)
                        </>
                      )}
                    </>
                  )}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
      <AiDot
        card={{
          key: cardKey,
          label: "Big plans archive",
          data: { scope, plan_ids: plans.map((p) => p.id) },
        }}
        question="What did I learn from these big plans?"
      />
    </div>
  );
}

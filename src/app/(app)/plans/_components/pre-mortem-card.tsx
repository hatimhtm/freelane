"use client";

import { Lock, Unlock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/money";
import type { CashflowAtlas } from "@/lib/cashflow-atlas";
import type { CurrencyCode, PlannedSpend } from "@/lib/supabase/types";

// Pre-Mortem cards walk Hatim through the liquidity around a big planned
// spend. The card answers three questions: when does the wallet dip lowest
// because of this, what's the runway after it lands, and what's the calm
// move (lock now vs hold)?
//
// All math is derived from the atlas — no extra computation here.

export interface PreMortemCardProps {
  plan: PlannedSpend;
  atlas: CashflowAtlas;
  walletTotal: number;
  baseCurrency: CurrencyCode;
  highlighted?: boolean;
  onCommit: () => void;
  onUncommit: () => void;
}

export function PreMortemCard({
  plan,
  atlas,
  walletTotal,
  baseCurrency,
  highlighted,
  onCommit,
  onUncommit,
}: PreMortemCardProps) {
  const planDate = plan.planned_for;
  const planDay = atlas.days.find((d) => d.dayKey === planDate);
  const planDateShort = shortDateFor(plan.planned_for);
  const indexOfPlan = planDay ? atlas.days.indexOf(planDay) : -1;
  const daysAway = indexOfPlan >= 0 ? indexOfPlan : null;

  const after = indexOfPlan >= 0 ? atlas.days.slice(indexOfPlan + 1) : [];
  const afterMin = after.length
    ? Math.min(...after.map((d) => d.endOfDayBalance))
    : null;
  const afterMinDay = after.length
    ? after.find((d) => d.endOfDayBalance === afterMin)
    : null;

  const projectedAfter = planDay
    ? Math.round(planDay.endOfDayBalance)
    : null;

  const locked = plan.status === "committed";
  const accent = projectedAfter !== null && projectedAfter < 0
    ? "border-overdue/60"
    : highlighted
      ? "border-foreground/40"
      : "border-border/60";

  return (
    <div className={`rounded-[12px] border ${accent} bg-card/40 p-3.5`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-display text-sm font-medium leading-tight">
            {plan.label}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {planDateShort}
            {daysAway !== null && ` · in ${daysAway}d`}
            {` · ${plan.certainty}`}
          </div>
        </div>
        <div className="text-right font-display tabular text-sm">
          {formatMoney(Number(plan.expected_base ?? 0), baseCurrency, { compact: true })}
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
        <PreMortemRow
          label="Wallet now"
          value={walletTotal}
          baseCurrency={baseCurrency}
        />
        {projectedAfter !== null && (
          <PreMortemRow
            label="Right after"
            value={projectedAfter}
            baseCurrency={baseCurrency}
            warn={projectedAfter < 0}
          />
        )}
        {afterMin !== null && afterMinDay && (
          <PreMortemRow
            label={`Then dips · ${shortDateFor(afterMinDay.dayKey)}`}
            value={afterMin}
            baseCurrency={baseCurrency}
            warn={afterMin < 0}
            colspan={2}
          />
        )}
      </dl>

      {plan.notes && (
        <p className="mt-2 border-l-2 border-border/40 pl-2 text-[11px] leading-snug text-muted-foreground">
          {plan.notes.slice(0, 220)}
        </p>
      )}

      <div className="mt-3 flex items-center justify-end gap-1.5">
        {plan.status !== "done" && plan.status !== "cancelled" && (
          <>
            {locked ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={onUncommit}
                className="h-7 gap-1 text-[11px]"
              >
                <Unlock className="h-3 w-3" />
                Unlock
              </Button>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                onClick={onCommit}
                className="h-7 gap-1 text-[11px]"
              >
                <Lock className="h-3 w-3" />
                Lock for this
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function shortDateFor(yyyymmdd: string): string {
  const [, m, d] = yyyymmdd.split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[(m ?? 1) - 1]} ${d}`;
}

function PreMortemRow({
  label,
  value,
  baseCurrency,
  warn,
  colspan,
}: {
  label: string;
  value: number;
  baseCurrency: CurrencyCode;
  warn?: boolean;
  colspan?: 2;
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-2 ${colspan === 2 ? "col-span-2" : ""}`}
    >
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={`tabular font-medium ${warn ? "text-overdue" : "text-foreground"}`}
      >
        {formatMoney(value, baseCurrency, { compact: true })}
      </dd>
    </div>
  );
}

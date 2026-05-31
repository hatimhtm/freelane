"use client";

import { useMemo } from "react";
import { formatMoney } from "@/lib/money";
import { investmentConsumptionSplit } from "@/lib/investment-vs-consumption";
import type {
  CurrencyCode,
  Spend,
  SpendCategory,
  SpendCategoryLink,
} from "@/lib/supabase/types";

// Investment vs Consumption Ledger — Hatim's mental model surfaces directly.
// "Investments" = laptop, keyboard, dev tools, education (the ones that earn
// back). "Consumption" = groceries, transport, rent, etc. "Neutral" = loan
// repayment, sadaka, forgotten, other.
//
// Reads the kind on each category and rolls each spend up to its strongest
// classification (any investment tag wins).

export interface InvestmentVsConsumptionProps {
  spends: Spend[];               // already filtered to the current view
  links: SpendCategoryLink[];
  categories: SpendCategory[];
  baseCurrency: CurrencyCode;
  // Headline label — usually the same time window the parent already shows.
  windowLabel?: string;
}

export function InvestmentVsConsumption({
  spends,
  links,
  categories,
  baseCurrency,
  windowLabel,
}: InvestmentVsConsumptionProps) {
  const split = useMemo(
    () => investmentConsumptionSplit(spends, links, categories),
    [spends, links, categories],
  );
  const total = split.investment + split.consumption + split.neutral;

  // Avoid noisy renders when the window has no spends yet.
  if (total === 0) return null;

  const consumptionPct = total > 0 ? (split.consumption / total) * 100 : 0;
  const investmentPct = total > 0 ? (split.investment / total) * 100 : 0;
  const neutralPct = total > 0 ? (split.neutral / total) * 100 : 0;

  return (
    <section className="rounded-[12px] border border-border/60 bg-card/40 p-3.5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-display text-sm font-medium">
          Investment vs Consumption
        </h3>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {windowLabel ?? "Window"}
        </span>
      </div>

      <div className="mt-2 flex h-2 w-full overflow-hidden rounded-full bg-muted/30">
        <div
          className="bg-acid-lime"
          style={{ width: `${investmentPct}%` }}
          title={`Investment ${formatMoney(split.investment, baseCurrency, { compact: true })}`}
        />
        <div
          className="bg-foreground/35"
          style={{ width: `${consumptionPct}%` }}
          title={`Consumption ${formatMoney(split.consumption, baseCurrency, { compact: true })}`}
        />
        <div
          className="bg-muted-foreground/30"
          style={{ width: `${neutralPct}%` }}
          title={`Neutral ${formatMoney(split.neutral, baseCurrency, { compact: true })}`}
        />
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
        <Stat
          label="Investment"
          amount={split.investment}
          pct={investmentPct}
          baseCurrency={baseCurrency}
          color="text-acid-lime"
        />
        <Stat
          label="Consumption"
          amount={split.consumption}
          pct={consumptionPct}
          baseCurrency={baseCurrency}
        />
        <Stat
          label="Neutral"
          amount={split.neutral}
          pct={neutralPct}
          baseCurrency={baseCurrency}
        />
      </dl>

      <p className="mt-3 text-[11px] leading-snug text-muted-foreground">
        {split.healthy
          ? `Investment share at ${(split.investmentShare * 100).toFixed(0)}% of discretionary — putting money to work.`
          : `Investment share at ${(split.investmentShare * 100).toFixed(0)}% of discretionary. Tag dev tools, education, or upgrades as Investment to track the side that earns back.`}
      </p>
    </section>
  );
}

function Stat({
  label,
  amount,
  pct,
  baseCurrency,
  color,
}: {
  label: string;
  amount: number;
  pct: number;
  baseCurrency: CurrencyCode;
  color?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={`font-display tabular text-sm ${color ?? "text-foreground"}`}>
        {formatMoney(amount, baseCurrency, { compact: true })}
      </div>
      <div className="text-[10px] text-muted-foreground">{pct.toFixed(0)}%</div>
    </div>
  );
}

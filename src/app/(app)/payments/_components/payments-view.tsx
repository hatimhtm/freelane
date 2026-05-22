"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Plus, Wallet } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MetricTile } from "@/components/stats/stat";
import { MethodLeaderboard } from "@/components/app/method-leaderboard";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { CurrencyCode } from "@/lib/supabase/types";
import type { MethodLeaderboardRow } from "@/lib/payment-chain";
import { ChainSheet } from "./chain-sheet";

export type ChainStepView = {
  order: number;
  methodName: string;
  amountIn: number;
  currencyIn: CurrencyCode;
  amountOut: number;
  currencyOut: CurrencyCode;
};

export type PaymentRow = {
  id: string;
  projectTitle: string;
  clientName: string;
  paidAt: string;
  amountIn: number;
  currencyIn: CurrencyCode;
  netBase: number;
  feeBase: number;
  feePct: number;
  signature: string;
  steps: ChainStepView[];
};

type ChainProject = { id: string; title: string; currency: CurrencyCode; clientName: string; outstanding: number };

export function PaymentsView({
  rows,
  leaderboard,
  currency,
  receivedThisMonth,
  lifetime,
  feesThisMonth,
  methods,
  openProjects,
  allProjects,
  allCurrencies,
  rates,
  openNew,
  defaultProjectId,
}: {
  rows: PaymentRow[];
  leaderboard: MethodLeaderboardRow[];
  currency: CurrencyCode;
  receivedThisMonth: number;
  lifetime: number;
  feesThisMonth: number;
  methods: { id: string; name: string }[];
  openProjects: ChainProject[];
  allProjects: ChainProject[];
  allCurrencies: string[];
  rates: { code: string; rate_to_base: number }[];
  openNew?: boolean;
  defaultProjectId?: string;
}) {
  const [sheetOpen, setSheetOpen] = useState(openNew ?? false);
  // Every currency that exists, base first — so newly-added ones are selectable.
  const currencies = useMemo(
    () => Array.from(new Set([currency, ...allCurrencies])),
    [currency, allCurrencies],
  );
  const formProjects = openProjects.length > 0 ? openProjects : allProjects;

  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6 py-8 lg:px-10 lg:py-12">
      <PageHeader
        title="Payments"
        description="Every payment, its chain, and what each rail cost."
        actions={
          <Button onClick={() => setSheetOpen(true)} disabled={allProjects.length === 0}>
            <Plus className="mr-1.5 h-4 w-4" /> Log payment
          </Button>
        }
      />

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        <MetricTile label="Landed this month" value={receivedThisMonth} currency={currency} accent />
        <MetricTile label="Lifetime" value={lifetime} currency={currency} delay={0.04} />
        <MetricTile label="Fees this month" value={feesThisMonth} currency={currency} hint="rails + FX markup" delay={0.08} />
      </div>

      <section className="mt-10">
        <h2 className="mb-3 text-sm font-medium">Cheapest ways to get paid</h2>
        <MethodLeaderboard rows={leaderboard} baseCurrency={currency} />
      </section>

      <section className="mt-10">
        <h2 className="mb-3 text-sm font-medium">All payments</h2>
        {rows.length === 0 ? (
          <EmptyState
            icon={Wallet}
            title="Nothing landed yet."
            description="Log your first payment and Freelane starts tracking what each rail really costs you."
            action={<Button onClick={() => setSheetOpen(true)} disabled={allProjects.length === 0}>Log a payment</Button>}
          />
        ) : (
          <Card className="overflow-hidden p-0">
            {rows.map((r, i) => (
              <PaymentItem key={r.id} row={r} baseCurrency={currency} last={i === rows.length - 1} index={i} />
            ))}
          </Card>
        )}
      </section>

      <ChainSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        projects={formProjects}
        methods={methods}
        currencies={currencies}
        rates={rates}
        baseCurrency={currency}
        defaultProjectId={defaultProjectId}
      />
    </div>
  );
}

function PaymentItem({ row, baseCurrency, last, index }: { row: PaymentRow; baseCurrency: CurrencyCode; last: boolean; index: number }) {
  const [open, setOpen] = useState(false);
  const multi = row.steps.length > 1;

  return (
    <div className={cn(!last && "border-b border-border/50")}>
      <motion.button
        type="button"
        onClick={() => setOpen((o) => !o)}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.35, delay: Math.min(index, 6) * 0.04, ease: [0.16, 1, 0.3, 1] }}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-muted/40"
      >
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{row.projectTitle}</div>
          <div className="truncate text-xs text-muted-foreground">
            {row.clientName} · {new Date(row.paidAt).toLocaleDateString()}<span className="hidden text-muted-foreground/80 sm:inline"> · {row.signature}</span>
          </div>
        </div>
        <FeeChip pct={row.feePct} />
        <div className="shrink-0 text-right">
          <div className="text-sm font-semibold tabular">{formatMoney(row.netBase, baseCurrency)}</div>
          {row.currencyIn !== baseCurrency && (
            <div className="text-[11px] text-muted-foreground tabular">from {formatMoney(row.amountIn, row.currencyIn, { compact: true })}</div>
          )}
        </div>
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground/40 transition-transform duration-200", open && "rotate-180")} />
      </motion.button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden bg-muted/20"
          >
            <div className="space-y-1.5 px-4 py-3">
              {row.steps.map((s) => (
                <div key={s.order} className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-2">
                    <span className="inline-flex size-4 items-center justify-center rounded-full bg-foreground/10 font-mono text-[9px]">{s.order}</span>
                    <span className="font-medium">{s.methodName}</span>
                  </span>
                  <span className="tabular text-muted-foreground">
                    {formatMoney(s.amountIn, s.currencyIn, { compact: true })} → {formatMoney(s.amountOut, s.currencyOut, { compact: true })}
                  </span>
                </div>
              ))}
              <div className="flex items-center justify-between border-t border-border/50 pt-2 text-xs">
                <span className="text-muted-foreground">{multi ? "Total fee across the chain" : "Fee"}</span>
                <span className="tabular font-medium text-[var(--overdue)]">
                  {formatMoney(row.feeBase, baseCurrency, { compact: true })} ({(row.feePct * 100).toFixed(1)}%)
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function FeeChip({ pct }: { pct: number }) {
  const tone = pct >= 0.04 ? "text-[var(--overdue)] bg-[var(--overdue)]/12" : pct >= 0.02 ? "text-[var(--chart-3)] bg-[var(--chart-3)]/12" : "text-[var(--success)] bg-[var(--success)]/12";
  return (
    <span className={cn("inline-block shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium tabular", tone)}>
      {(pct * 100).toFixed(1)}%
    </span>
  );
}

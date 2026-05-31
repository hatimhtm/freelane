"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { HoldingBalanceRow } from "@/lib/payment-chain";
import type { CurrencyCode } from "@/lib/supabase/types";

const EASE = [0.22, 1, 0.36, 1] as const;

type RunwayRow = {
  methodId: string;
  name: string;
  balance: number;
  days: number | null;
};

// "How many days until this wallet runs dry?" — balance ÷ 30d burn, sorted by
// urgency. No burn = infinite runway = em-dash (we don't pretend). Negative
// runway can't happen here; the Negative Wallet Alarm owns that conversation.
export function WalletRunwayCard({
  holdings,
  dailyBurnByWallet,
  baseCurrency,
}: {
  holdings: HoldingBalanceRow[];
  dailyBurnByWallet: Map<string, number>;
  baseCurrency: CurrencyCode;
}) {
  const rows: RunwayRow[] = holdings
    .filter((h) => h.balance > 0)
    .map((h) => {
      const burn = dailyBurnByWallet.get(h.methodId) ?? 0;
      const days = burn > 0 ? Math.floor(h.balance / burn) : null;
      return { methodId: h.methodId, name: h.name, balance: h.balance, days };
    })
    .sort((a, b) => {
      // Most-urgent first; infinite runway sinks to the bottom.
      if (a.days === null && b.days === null) return b.balance - a.balance;
      if (a.days === null) return 1;
      if (b.days === null) return -1;
      return a.days - b.days;
    });

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-ink/10 px-6 py-5 text-sm text-ink/60">
        Set opening balances in{" "}
        <Link href="/settings" className="text-ink underline decoration-ink/20 underline-offset-4 transition-colors hover:decoration-ink/60">
          Settings → Wallets
        </Link>{" "}
        to get runway.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-ink/10">
      {rows.map((row, i) => (
        <Row
          key={row.methodId}
          row={row}
          baseCurrency={baseCurrency}
          last={i === rows.length - 1}
          index={i}
        />
      ))}
    </div>
  );
}

function Row({
  row,
  baseCurrency,
  last,
  index,
}: {
  row: RunwayRow;
  baseCurrency: CurrencyCode;
  last: boolean;
  index: number;
}) {
  const tight = row.days !== null && row.days <= 14;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, delay: index * 0.04, ease: EASE }}
      className={cn(
        "flex min-h-14 items-center gap-4 px-6 py-3",
        tight && "border-l-2 border-[var(--overdue)]",
        !last && "border-b border-ink/10",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-ink">{row.name}</div>
        <div className="truncate text-xs text-ink/60 tabular">
          {formatMoney(row.balance, baseCurrency, { compact: true })}
        </div>
      </div>

      <div className="shrink-0 text-right">
        {row.days === null ? (
          <div className="display-numeric text-2xl text-ink/40">—</div>
        ) : (
          <>
            <div className="display-numeric text-2xl text-ink">{row.days}</div>
            <div className="mt-1 text-[10px] uppercase tracking-[0.18em] text-ink/50">
              {row.days === 1 ? "day" : "days"}
            </div>
          </>
        )}
      </div>
    </motion.div>
  );
}

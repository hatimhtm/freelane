"use client";

import { useMemo, useState, useTransition } from "react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/money";
import { anchorDate, expectedBase, periodKey } from "@/lib/recurring";
import { markRecurringPaid } from "@/lib/data/actions";
import type {
  ExchangeRate,
  RecurringSpend,
  RecurringSpendSkip,
} from "@/lib/supabase/types";
import type { HoldingBalanceRow } from "@/lib/payment-chain";

const DAY_MS = 86_400_000;
const HORIZON_DAYS = 5;
const EASE = [0.22, 1, 0.36, 1] as const;

type Row = {
  rule: RecurringSpend;
  anchor: Date;
  daysUntil: number;
  expectedBase: number;
  walletBalance: number | null;
  shortfall: boolean;
};

// Recurring rules whose next anchor lands inside the next 5 days. Calm row per
// rule — label, expected amount, "in Nd". A muted terracotta dot surfaces when
// the rule's funding wallet won't cover the expected amount at today's rates.
export function RecurringWindowWatch({
  recurring,
  skips,
  holdings,
  rates,
}: {
  recurring: RecurringSpend[];
  skips: RecurringSpendSkip[];
  holdings: HoldingBalanceRow[];
  rates: ExchangeRate[];
}) {
  const rows = useMemo<Row[]>(() => {
    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const balanceByMethod = new Map(holdings.map((h) => [h.methodId, h.balance]));

    const out: Row[] = [];
    for (const r of recurring) {
      if (!r.active) continue;
      const settled = skips.some(
        (s) => s.recurring_spend_id === r.id && s.period_key === periodKey(r, now),
      );
      if (settled) continue;
      const anchor = anchorDate(r, now);
      anchor.setHours(0, 0, 0, 0);
      const daysUntil = Math.round((anchor.getTime() - today.getTime()) / DAY_MS);
      if (daysUntil < 0 || daysUntil > HORIZON_DAYS) continue;
      const exp = expectedBase(r, rates);
      const walletBalance = r.wallet_id
        ? balanceByMethod.get(r.wallet_id) ?? null
        : null;
      out.push({
        rule: r,
        anchor,
        daysUntil,
        expectedBase: exp,
        walletBalance,
        shortfall: walletBalance !== null && walletBalance < exp,
      });
    }
    return out.sort((a, b) => a.daysUntil - b.daysUntil).slice(0, 4);
  }, [recurring, skips, holdings, rates]);

  if (rows.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-2xl border border-ink/10">
      {rows.map((row, i) => (
        <RowItem
          key={row.rule.id}
          row={row}
          last={i === rows.length - 1}
          index={i}
        />
      ))}
    </div>
  );
}

function RowItem({ row, last, index }: { row: Row; last: boolean; index: number }) {
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);

  function onTap() {
    if (pending || done) return;
    if (!row.rule.wallet_id) {
      toast.error("Set a funding wallet for this rule in Settings first.");
      return;
    }
    start(async () => {
      try {
        await markRecurringPaid({
          recurring_spend_id: row.rule.id,
          wallet_id: row.rule.wallet_id as string,
          amount: Number(row.rule.expected_amount),
          currency: row.rule.expected_currency,
          paid_at: new Date().toISOString(),
        });
        setDone(true);
        toast.success(`Marked ${row.rule.label} paid.`);
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  return (
    <motion.button
      type="button"
      onClick={onTap}
      disabled={pending || done}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: done ? 0.4 : 1, y: 0 }}
      transition={{ duration: 0.32, delay: index * 0.04, ease: EASE }}
      className={cn(
        "flex w-full min-h-14 items-center gap-3 px-6 py-3 text-left transition-colors hover:bg-ink/[0.03] disabled:cursor-default",
        !last && "border-b border-ink/10",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-[5px] shrink-0 rounded-full",
          row.shortfall ? "bg-[var(--terracotta)]/80" : "bg-transparent",
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-ink">{row.rule.label}</div>
      </div>
      <div className="font-fraunces text-base leading-none text-ink tabular">
        {formatMoney(Number(row.rule.expected_amount), row.rule.expected_currency)}
      </div>
      <div className="w-14 shrink-0 text-right text-xs text-ink/60 tabular">
        {row.daysUntil === 0
          ? "today"
          : row.daysUntil === 1
            ? "tomorrow"
            : `in ${row.daysUntil}d`}
      </div>
    </motion.button>
  );
}

"use client";

import { Lock, Wallet } from "lucide-react";
import { motion } from "motion/react";
import { formatMoney } from "@/lib/money";
import type { CurrencyCode } from "@/lib/supabase/types";
import type { TightModeRead } from "@/lib/ai/tight-mode-coach";

// The Tight Mode Coach surface. Only renders when the weather band is
// storm/gust and the math has computed real numbers. Sits below the Calm
// Weather banner and above the safe-to-spend hero on Today.

export function TightModeCoach({
  read,
  baseCurrency,
}: {
  read: TightModeRead;
  baseCurrency: CurrencyCode;
}) {
  if (!read.active) return null;
  return (
    <motion.section
      id="tight-mode"
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
      className="rounded-[14px] border border-overdue/40 bg-card/40 p-4"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-sm font-medium">
          Tight Mode Coach
        </h2>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {read.runwayDays}d runway
        </span>
      </div>

      <p className="mt-2 text-sm leading-snug text-foreground">{read.oneMove}</p>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <Stat
          icon={<Lock className="h-3 w-3" />}
          label="Locked 14d"
          value={read.locked14dBase}
          baseCurrency={baseCurrency}
        />
        <Stat
          icon={<Wallet className="h-3 w-3" />}
          label="Wallets"
          value={read.walletTotalBase}
          baseCurrency={baseCurrency}
        />
        <Stat
          label="Flex / day"
          value={read.flexPerDayBase}
          baseCurrency={baseCurrency}
        />
      </div>

      {!read.fromAi && (
        <p className="mt-2 text-[10px] text-muted-foreground/70">
          Math-only read — AI offline.
        </p>
      )}
    </motion.section>
  );
}

function Stat({
  icon,
  label,
  value,
  baseCurrency,
}: {
  icon?: React.ReactNode;
  label: string;
  value: number;
  baseCurrency: CurrencyCode;
}) {
  return (
    <div className="rounded-md border border-border/40 px-2.5 py-1.5">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className="font-display tabular text-sm text-foreground">
        {formatMoney(value, baseCurrency, { compact: true })}
      </div>
    </div>
  );
}

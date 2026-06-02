"use client";

import { Target, Wallet } from "lucide-react";
import { motion } from "motion/react";
import { formatMoney } from "@/lib/money";
import type { CurrencyCode } from "@/lib/supabase/types";
import type { TightModeRead } from "@/lib/ai/tight-mode-coach";

// The Tight Mode Coach surface. Only renders when the weather band is
// storm/gust and the math has computed real numbers. Sits below the Calm
// Weather banner and above the safe-to-spend hero on Today.
//
// Locked tokens only: rounded-xl + ring-1 ring-foreground/10 to match the
// widget primitives; the warm-attention tone comes from the rose ring slot
// (terracotta-equivalent). No --overdue alias — that was a fifth-color slot
// outside the 4-color semantic palette.

const TERRACOTTA_RING = "ring-[oklch(0.7_0.13_45)]/30";

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
      className={`rounded-xl bg-card p-4 ring-1 ${TERRACOTTA_RING}`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-sm font-medium">
          Tight Mode Coach
        </h2>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground tabular-nums">
          {read.runwayDays}d runway
        </span>
      </div>

      <p className="mt-2 text-sm leading-snug text-foreground">{read.oneMove}</p>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <Stat
          // Plan glyph (Target) — locked funds are mini-plans semantically;
          // Lock isn't in the locked symbol vocabulary.
          icon={<Target className="h-3 w-3" />}
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

// Stat boxes carry small supporting numbers, NOT hero numbers — the locked
// rule reserves AnimatedNumber / NumberFlow for hero metrics. Here they
// stay as muted small-text (slate-muted, no display-tabular treatment) so
// they don't compete with the hero "one move" narrative line above.
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
    <div className="rounded-xl bg-card/60 px-2.5 py-1.5 ring-1 ring-foreground/10">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-sm tabular-nums text-muted-foreground">
        {formatMoney(value, baseCurrency, { compact: true })}
      </div>
    </div>
  );
}

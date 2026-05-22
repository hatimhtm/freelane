"use client";

import { motion } from "motion/react";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { MethodLeaderboardRow } from "@/lib/payment-chain";
import type { CurrencyCode } from "@/lib/supabase/types";

// "Which way of getting paid costs me the least?" — chains ranked by effective
// fee %, cheapest first. The top row wears the one lime accent.
export function MethodLeaderboard({
  rows,
  baseCurrency,
  limit,
}: {
  rows: MethodLeaderboardRow[];
  baseCurrency: CurrencyCode;
  limit?: number;
}) {
  const shown = limit ? rows.slice(0, limit) : rows;

  if (shown.length === 0) {
    return (
      <div className="rounded-xl border border-border/60 bg-card px-5 py-8 text-center text-sm text-muted-foreground">
        No payment chains logged yet. Log one to see which rail costs least.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {shown.map((row, i) => {
        const best = i === 0 && shown.length > 1;
        return (
          <motion.div
            key={row.signature}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: i * 0.04 }}
            className={cn(
              "flex items-center gap-3 rounded-xl border bg-card px-4 py-3",
              best ? "border-[var(--brand)]/45" : "border-border/60",
            )}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium">{row.signature}</span>
                {best && (
                  <span className="shrink-0 rounded-full bg-[var(--brand)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--brand-foreground)]">
                    Cheapest
                  </span>
                )}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground tabular">
                {formatMoney(row.volumeBase, baseCurrency, { compact: true })} routed ·{" "}
                {row.count} {row.count === 1 ? "payment" : "payments"}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-base font-semibold tabular">{(row.effectivePct * 100).toFixed(1)}%</div>
              <div className="text-[11px] text-muted-foreground">eff. fee</div>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

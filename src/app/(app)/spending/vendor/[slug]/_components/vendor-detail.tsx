"use client";

import { motion } from "motion/react";
import { TrendAreaChart } from "@/components/stats/trend-area-chart";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { CurrencyCode } from "@/lib/supabase/types";

const EASE = [0.22, 1, 0.36, 1] as const;

export type VendorSpendRow = {
  id: string;
  spentAt: string;
  amount: number;
  currency: CurrencyCode;
  amountBase: number;
  description: string | null;
  walletName: string;
  categoryNames: string[];
  businessRelevant: boolean;
};

interface VendorDetailProps {
  vendor: string;
  confidence: "known" | "guessed";
  baseCurrency: CurrencyCode;
  rows: VendorSpendRow[];
  visits: number;
  total: number;
  avgTicket: number;
  biggestTicket: number;
  firstSeenAt: string;
  lastSeenAt: string;
  monthly: { month: string; total: number }[];
  topCategories: { id: string; name: string; value: number; pct: number }[];
}

export function VendorDetail({
  vendor,
  confidence,
  baseCurrency,
  rows,
  visits,
  total,
  avgTicket,
  biggestTicket,
  firstSeenAt,
  lastSeenAt,
  monthly,
  topCategories,
}: VendorDetailProps) {
  const lastSeenLabel = formatRelative(lastSeenAt);
  const firstSeenLabel = formatLongDate(firstSeenAt);

  return (
    <div>
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE }}
        className="mt-3"
      >
        <div className="display-eyebrow text-muted-foreground">Spending</div>
        <h1
          className={cn(
            "font-fraunces mt-1 text-[clamp(28px,4.5vw,40px)] leading-tight tracking-tight text-foreground",
            confidence === "guessed" &&
              "decoration-dotted decoration-foreground/40 underline-offset-[6px] [text-decoration-line:underline]",
          )}
        >
          {vendor}
        </h1>
        {confidence === "guessed" && (
          <p className="mt-1 text-[11px] text-muted-foreground/70">
            Inferred from descriptions — not in the known-vendor list.
          </p>
        )}
      </motion.div>

      {/* Stat strip */}
      <section className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-6">
        <StatTile
          eyebrow="Visits"
          value={String(visits)}
          delay={0.02}
        />
        <StatTile
          eyebrow="Spent"
          value={formatMoney(total, baseCurrency, { compact: true })}
          delay={0.05}
        />
        <StatTile
          eyebrow="Avg ticket"
          value={formatMoney(avgTicket, baseCurrency, { compact: true })}
          delay={0.08}
        />
        <StatTile
          eyebrow="Biggest"
          value={formatMoney(biggestTicket, baseCurrency, { compact: true })}
          delay={0.11}
        />
        <StatTile eyebrow="Last visit" value={lastSeenLabel} delay={0.14} />
        <StatTile eyebrow="First visit" value={firstSeenLabel} delay={0.17} />
      </section>

      {/* Tagging mix */}
      {topCategories.length > 0 && (
        <section className="mt-6 rounded-[12px] border border-foreground/10 bg-card/40 p-4">
          <div className="flex items-baseline justify-between">
            <div className="display-eyebrow text-muted-foreground">
              How you usually tag this vendor
            </div>
            <span className="text-[11px] text-muted-foreground/70">top 3</span>
          </div>
          <ul className="mt-3 space-y-2">
            {topCategories.map((c) => (
              <li key={c.id} className="space-y-1">
                <div className="flex items-baseline justify-between gap-2 text-[12px]">
                  <span className="truncate text-foreground/85">{c.name}</span>
                  <span className="tabular text-muted-foreground">
                    {formatMoney(c.value, baseCurrency, { compact: true })}
                    <span className="ml-1.5 text-muted-foreground/55">
                      {c.pct.toFixed(0)}%
                    </span>
                  </span>
                </div>
                <div className="h-1 overflow-hidden rounded-full bg-foreground/[0.06]">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${c.pct}%` }}
                    transition={{ duration: 0.7, ease: EASE }}
                    className="h-full rounded-full bg-[var(--brand)]"
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Monthly trend */}
      <section className="mt-6 rounded-[12px] border border-foreground/10 bg-card/40 p-4">
        <div className="flex items-baseline justify-between">
          <div className="display-eyebrow text-muted-foreground">Monthly trend</div>
          <span className="text-[11px] text-muted-foreground/70">last 12 months</span>
        </div>
        <div className="mt-2">
          <TrendAreaChart data={monthly} currency={baseCurrency} height={220} />
        </div>
      </section>

      {/* Full list */}
      <section className="mt-6">
        <div className="flex items-baseline justify-between">
          <div className="display-eyebrow text-muted-foreground">All visits</div>
          <span className="tabular text-[11px] text-muted-foreground/70">
            {visits} {visits === 1 ? "spend" : "spends"} ·{" "}
            {formatMoney(total, baseCurrency, { compact: true })}
          </span>
        </div>
        <ul className="mt-3 border-t border-foreground/10">
          {rows.map((row, i) => (
            <VendorSpendItem
              key={row.id}
              row={row}
              baseCurrency={baseCurrency}
              index={i}
            />
          ))}
        </ul>
      </section>
    </div>
  );
}

function StatTile({
  eyebrow,
  value,
  delay = 0,
}: {
  eyebrow: string;
  value: string;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay, ease: EASE }}
      className="rounded-[10px] border border-foreground/10 bg-card/40 p-3"
    >
      <div className="display-eyebrow text-muted-foreground">{eyebrow}</div>
      <div className="tabular mt-1.5 text-[18px] font-semibold tracking-tight text-foreground">
        {value}
      </div>
    </motion.div>
  );
}

function VendorSpendItem({
  row,
  baseCurrency,
  index,
}: {
  row: VendorSpendRow;
  baseCurrency: CurrencyCode;
  index: number;
}) {
  return (
    <motion.li
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.28, delay: Math.min(index, 8) * 0.02, ease: EASE }}
      className="flex items-center gap-3 border-b border-foreground/10 py-2.5"
    >
      <div className="tabular w-12 shrink-0 text-[11px] text-muted-foreground">
        {formatShortDate(row.spentAt)}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[13px] text-foreground">
            {row.description?.trim() || (
              <span className="text-muted-foreground/60">—</span>
            )}
          </span>
          {row.businessRelevant && (
            <span
              aria-label="Business-relevant"
              title="Business-relevant"
              className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand)]"
            />
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted-foreground">
          <span>{row.walletName}</span>
          {row.categoryNames.length > 0 && (
            <>
              <span className="text-muted-foreground/40">·</span>
              <span className="text-muted-foreground/85">
                {row.categoryNames.join(", ")}
              </span>
            </>
          )}
        </div>
      </div>

      <div className="shrink-0 text-right">
        <div className="tabular text-[13px] text-foreground">
          {formatMoney(row.amountBase, baseCurrency)}
        </div>
        {row.currency !== baseCurrency && (
          <div className="tabular mt-0.5 text-[10px] text-muted-foreground/70">
            {formatMoney(row.amount, row.currency, { compact: true })}
          </div>
        )}
      </div>
    </motion.li>
  );
}

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatLongDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  const days = Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days}d ago`;
  if (days < 60) return `${Math.round(days / 7)}w ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${(days / 365).toFixed(1)}y ago`;
}

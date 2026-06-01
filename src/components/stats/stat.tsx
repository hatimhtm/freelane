"use client";

import Link from "next/link";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { motion } from "motion/react";
import { MoneyFlow } from "@/components/ui/money-flow";
import { Sparkline } from "@/components/stats/sparkline";
import { cn } from "@/lib/utils";
import type { CurrencyCode } from "@/lib/supabase/types";

const EASE = [0.16, 1, 0.3, 1] as const;

// The magazine-cover number. No card, no shadow — just the figure on paper,
// an eyebrow above and a quiet supporting line below. Optionally a sparkline.
export function MastheadStat({
  eyebrow,
  value,
  currency = "PHP",
  support,
  series,
  delta,
  className,
}: {
  eyebrow: string;
  value: number;
  currency?: CurrencyCode;
  support?: React.ReactNode;
  series?: number[];
  delta?: number | null;
  className?: string;
}) {
  return (
    <div className={className}>
      <motion.p
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE }}
        className="display-eyebrow text-muted-foreground"
      >
        {eyebrow}
      </motion.p>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, delay: 0.08, ease: EASE }}
        className="mt-3 flex items-end gap-3"
      >
        <span className="display-numeric tabular text-[clamp(2.75rem,8vw,5.5rem)]">
          <MoneyFlow value={value} currency={currency} />
        </span>
        {typeof delta === "number" && <DeltaChip delta={delta} />}
      </motion.div>
      {support && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.32, ease: EASE }}
          className="mt-3 text-sm text-muted-foreground"
        >
          {support}
        </motion.div>
      )}
      {series && series.length > 1 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.7, delay: 0.5, ease: EASE }}
          className="mt-5 max-w-sm"
        >
          <Sparkline data={series} filled height={46} color="var(--chart-1)" />
        </motion.div>
      )}
    </div>
  );
}

// Secondary metric — a quiet card with label, figure, optional delta + icon.
export function MetricTile({
  label,
  value,
  currency,
  text,
  delta,
  hint,
  icon: Icon,
  accent = false,
  delay = 0,
  href,
}: {
  label: string;
  value?: number;
  currency?: CurrencyCode;
  text?: string;
  delta?: number | null;
  hint?: string;
  icon?: React.ComponentType<{ className?: string }>;
  accent?: boolean;
  delay?: number;
  href?: string;
}) {
  const card = (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: EASE }}
      className={cn(
        "lift h-full rounded-2xl border bg-card p-6",
        accent ? "border-foreground/15" : "border-border/70",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="display-eyebrow text-muted-foreground">{label}</div>
          <div className="mt-2.5 text-[32px] font-semibold leading-tight tracking-tight tabular">
            {typeof value === "number" ? (
              <MoneyFlow value={value} currency={currency ?? "PHP"} />
            ) : (
              text
            )}
          </div>
          {typeof delta === "number" && <div className="mt-1.5"><DeltaChip delta={delta} /></div>}
          {hint && <div className="mt-1.5 text-[13px] text-muted-foreground">{hint}</div>}
        </div>
        {Icon && (
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
            <Icon className="h-[18px] w-[18px]" />
          </div>
        )}
      </div>
    </motion.div>
  );

  if (href) {
    return (
      <Link href={href} className="block h-full">
        {card}
      </Link>
    );
  }
  return card;
}

export function DeltaChip({ delta, suffix = "vs last month" }: { delta: number; suffix?: string }) {
  const positive = delta >= 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[13px] font-medium tabular",
        positive ? "text-[var(--success)]" : "text-[var(--overdue)]",
      )}
    >
      {positive ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
      {(positive ? "+" : "") + (delta * 100).toFixed(0)}% {suffix}
    </span>
  );
}

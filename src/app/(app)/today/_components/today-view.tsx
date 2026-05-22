"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { motion } from "motion/react";
import { MastheadStat } from "@/components/stats/stat";
import { formatMoney } from "@/lib/money";
import type { CurrencyCode } from "@/lib/supabase/types";

const EASE = [0.16, 1, 0.3, 1] as const;

function greetingFor(hour: number): string {
  if (hour < 5) return "Still up";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function TodayView({
  firstName,
  currency,
  mtd,
  momDelta,
  series,
  pendingTotal,
  pendingCount,
  wtd,
  feesMtd,
  situation,
  action,
}: {
  firstName: string | null;
  currency: CurrencyCode;
  mtd: number;
  momDelta: number | null;
  series: number[];
  pendingTotal: number;
  pendingCount: number;
  wtd: number;
  feesMtd: number;
  situation: string;
  action: { label: string; href: string };
}) {
  // Time-aware greeting computed on the client so it matches the user's clock.
  const [greeting, setGreeting] = useState("Welcome back");
  useEffect(() => {
    setGreeting(greetingFor(new Date().getHours()));
  }, []);

  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-3.5rem)] max-w-3xl flex-col justify-center px-4 sm:px-6 py-12 lg:px-10">
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE }}
        className="flex items-center justify-between"
      >
        <span className="display-eyebrow text-muted-foreground">
          {greeting}{firstName ? `, ${firstName}` : ""}
        </span>
        <span className="text-xs text-muted-foreground tabular">{today}</span>
      </motion.div>

      <MastheadStat
        className="mt-6"
        eyebrow="Landed this month"
        value={mtd}
        currency={currency}
        delta={momDelta}
        series={series}
        support={
          <span className="text-base leading-snug text-foreground/80">
            {situation}
          </span>
        }
      />

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.45, ease: EASE }}
        className="mt-8"
      >
        <Link
          href={action.href}
          className="group inline-flex items-center gap-2.5 text-sm font-medium text-foreground"
        >
          <span className="grid size-9 place-items-center rounded-full bg-foreground text-background transition-transform group-hover:translate-x-1">
            <ArrowRight className="size-4" />
          </span>
          {action.label}
        </Link>
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: 0.6 }}
        className="mt-12 grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-border/60 bg-border/60"
      >
        <QuietStat label="Outstanding" value={formatMoney(pendingTotal, currency, { compact: true })} hint={`${pendingCount} open`} />
        <QuietStat label="This week" value={formatMoney(wtd, currency, { compact: true })} hint="landed" />
        <QuietStat label="Fees this month" value={formatMoney(feesMtd, currency, { compact: true })} hint="rails + FX" />
      </motion.div>
    </div>
  );
}

function QuietStat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="bg-card px-4 py-4">
      <div className="display-eyebrow text-muted-foreground">{label}</div>
      <div className="mt-1.5 text-lg font-semibold tabular tracking-tight">{value}</div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>
    </div>
  );
}

"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { Target } from "lucide-react";
import { formatMoney } from "@/lib/money";
import type { CurrencyCode } from "@/lib/supabase/types";
import type { EidPrepCard as EidPrepCardData } from "@/lib/ai/eid-prep";

// Eid Preparation Plan (G) — 60d-out card. Renders one card per upcoming
// Eid that falls inside the 60-day window. Shows last-year reference, the
// suggested parking amount, the AI-written narrative, and a "Lock for this"
// CTA that opens /plans pre-filled with the Eid label + suggested amount.

export function EidPrepCard({
  card,
  baseCurrency,
}: {
  card: EidPrepCardData;
  baseCurrency: CurrencyCode;
}) {
  const remaining = Math.max(0, card.suggestedParkingBase - card.existingPlansBase);
  const lockHref = remaining > 0
    ? `/plans?new=1${remaining > 0 ? `&amount=${Math.round(remaining)}` : ""}`
    : "/plans";

  return (
    <motion.section
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
      // rounded-xl + ring-1 ring-foreground/10 to match the locked widget
      // primitives instead of an ad-hoc 14px radius + bespoke border tone.
      className="rounded-xl bg-card p-4 ring-1 ring-foreground/10"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="font-display text-sm font-medium">{card.label}</h2>
          <p className="text-[11px] text-muted-foreground">
            {card.date}
            {card.daysUntil >= 0 ? ` · in ${card.daysUntil}d` : ` · ${Math.abs(card.daysUntil)}d ago`}
            {card.hijriLabel ? ` · ${card.hijriLabel}` : ""}
          </p>
        </div>
        {remaining > 0 && (
          <Link
            href={lockHref}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-border/70 px-2.5 text-[11px] font-medium hover:bg-muted/40"
          >
            {/* Plan glyph (Target) — Eid parking is a mini-plan; Lock isn't in the
              locked symbol vocabulary. */}
            <Target className="h-3 w-3" />
            Park {formatMoney(remaining, baseCurrency, { compact: true })}
          </Link>
        )}
      </header>

      <p className="mt-3 text-sm leading-snug text-foreground">{card.narrative}</p>

      <dl className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
        <Stat
          label="Last year"
          value={formatMoney(card.lastYearTotalBase, baseCurrency, { compact: true })}
          sub={`${card.lastYearSpendCount} entries`}
        />
        <Stat
          label="Already locked"
          value={formatMoney(card.existingPlansBase, baseCurrency, { compact: true })}
          sub={card.existingPlansBase > 0 ? "in /plans" : "—"}
        />
        <Stat
          label="Suggested"
          value={formatMoney(card.suggestedParkingBase, baseCurrency, { compact: true })}
          sub="parking"
        />
      </dl>

      {card.bigTicketReminders.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {card.bigTicketReminders.map((r, i) => (
            <li key={i} className="rounded-full border border-border/70 bg-muted/30 px-2 py-0.5 text-[10px] text-foreground/80">
              {r}
            </li>
          ))}
        </ul>
      )}

      {!card.fromAi && (
        <p className="mt-2 text-[10px] text-muted-foreground/70">
          Deterministic narrative — AI offline.
        </p>
      )}
    </motion.section>
  );
}

// Stat boxes are supporting numbers, not hero metrics — kept as muted
// small-text per the locked rule (AnimatedNumber wraps hero numbers only).
function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl bg-card/60 px-2.5 py-1.5 ring-1 ring-foreground/10">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-sm tabular-nums text-muted-foreground">{value}</div>
      <div className="text-[10px] text-muted-foreground">{sub}</div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { ArrowRight } from "lucide-react";
import { formatMoney } from "@/lib/money";
import type { ForecastStory } from "@/lib/ai/forecast-storyteller";
import type { CurrencyCode } from "@/lib/supabase/types";

// Forecast Storyteller card — the next 30 days written as a quiet story,
// followed by date pills surfacing the inflection points.

export function ForecastStoryCard({
  story,
  baseCurrency,
}: {
  story: ForecastStory;
  baseCurrency: CurrencyCode;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
      className="rounded-[14px] border border-border/60 bg-card/40 p-4"
    >
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-sm font-medium">Forecast — next 30 days</h2>
        <Link
          href="/plans"
          className="inline-flex items-center gap-0.5 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
        >
          Plans <ArrowRight className="h-3 w-3" />
        </Link>
      </header>
      <p className="mt-2 text-sm leading-snug text-foreground">{story.headline}</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{story.narrative}</p>

      {story.moments.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {story.moments.map((m, i) => (
            <span
              key={i}
              className="rounded-full border border-border/70 bg-muted/30 px-2 py-0.5 text-[10px] tabular text-foreground/80"
              title={`${m.label} · ${m.kind}`}
            >
              <span className="font-medium">{shortDate(m.date)}</span>{" "}
              <span className="text-muted-foreground">{m.label}</span>{" "}
              <span className="text-foreground/70">
                {formatMoney(m.amountBase, baseCurrency, { compact: true })}
              </span>
            </span>
          ))}
        </div>
      )}

      {!story.fromAi && (
        <p className="mt-2 text-[10px] text-muted-foreground/70">
          Deterministic narrative — AI offline.
        </p>
      )}
    </motion.section>
  );
}

function shortDate(yyyymmdd: string): string {
  const [, m, d] = yyyymmdd.split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[(m ?? 1) - 1]} ${d}`;
}

"use client";

import { motion } from "motion/react";
import { Leaf } from "lucide-react";
import { formatMoney } from "@/lib/money";
import type { CurrencyCode } from "@/lib/supabase/types";
import type { SadakaRhythmRead } from "@/lib/ai/sadaka-rhythm";

// Sadaka Rhythm card — observation, never directive. Quiet card on
// Today/Dashboard. Hides entirely when there are 0 Sadaka entries (so the
// surface stays calm for users who don't practice).
//
// Iconography: Leaf is the locked Recovery/growth glyph and is the closest
// semantic match for sadaka-as-growth. Heart is NOT in the vocabulary.
// Chrome: rounded-xl + ring-1 ring-foreground/10 so the card stacks with the
// other Today editorial cards.

export function SadakaRhythmCard({
  read,
  baseCurrency,
}: {
  read: SadakaRhythmRead;
  baseCurrency: CurrencyCode;
}) {
  if (!read || read.givenCount === 0 || !read.line) return null;

  return (
    <motion.section
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className="rounded-xl bg-card px-3.5 py-3 ring-1 ring-foreground/10"
    >
      <div className="flex items-start gap-2.5">
        <Leaf className="mt-1 h-3.5 w-3.5 shrink-0 text-foreground/70" />
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Sadaka rhythm
          </div>
          <p className="mt-0.5 text-sm leading-snug text-foreground">{read.line}</p>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
            <span>Last 180 days · {read.givenCount} entries</span>
            <span>· {formatMoney(read.totalGivenBase, baseCurrency, { compact: true })}</span>
            {read.averagePercentOfIncome > 0 && (
              <span>· {(read.averagePercentOfIncome * 100).toFixed(1)}% of landings</span>
            )}
          </div>
        </div>
      </div>
    </motion.section>
  );
}

"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { ArrowRight, Bookmark } from "lucide-react";
import type { EditorialLetter } from "@/lib/supabase/types";

const KIND_LABEL: Record<EditorialLetter["kind"], string> = {
  end_of_month: "End of month",
  spotlight: "Spotlight",
  sunday: "Sunday",
  year: "Year",
  anniversary: "Anniversary",
  regret_mark: "Two-month mark",
};

// Latest letter card on Today — the most recent letter, pinned or just-written.
// Tap → /letters/[id]. Renders nothing when there are no letters yet.

export function LatestLetterCard({ letter }: { letter: EditorialLetter | null }) {
  if (!letter) return null;
  return (
    <motion.section
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className="rounded-[14px] border border-border/60 bg-card/40 p-4"
    >
      <header className="flex items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="text-[10px] uppercase tracking-[0.14em] text-foreground/70">
            {KIND_LABEL[letter.kind]} · {letter.period_key}
          </span>
          {letter.pinned && (
            <Bookmark className="h-3 w-3 text-acid-lime" aria-label="Pinned" />
          )}
        </div>
        <Link
          href={`/letters/${letter.id}`}
          className="inline-flex items-center gap-0.5 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
        >
          Open <ArrowRight className="h-3 w-3" />
        </Link>
      </header>
      <h2 className="mt-1.5 font-display text-[15px] leading-snug text-foreground">
        {letter.headline}
      </h2>
      <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
        {letter.body.slice(0, 240)}
        {letter.body.length > 240 ? "…" : ""}
      </p>
    </motion.section>
  );
}

"use client";

import { useTransition } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { Leaf, X } from "lucide-react";
import { dismissMilestoneSurfacingAction } from "@/lib/data/actions";
import type { Milestone } from "@/lib/supabase/types";

// Fresh milestones strip on Today — surfaces the surfaced milestones, single
// dismiss per card. Hides entirely when none are surfaced.
//
// Iconography: Milestone's canonical glyph is Leaf (locked vocabulary —
// Check is off-vocabulary). The dismiss X is a row CONTROL, not an entity
// glyph, so it stays; stopPropagation is called so an Enter on the row
// (when the card becomes whole-card clickable) doesn't fire the dismiss.
// Chrome: rounded-xl + ring-1 ring-foreground/10.

export function FreshMilestonesCard({ milestones }: { milestones: Milestone[] }) {
  if (milestones.length === 0) return null;
  return (
    <motion.section
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className="rounded-xl bg-card px-3.5 py-2.5 ring-1 ring-foreground/10"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] uppercase tracking-[0.14em] text-foreground/70">
          Milestones
        </span>
        <Link
          href="/letters?tab=milestones"
          className="text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
        >
          All
        </Link>
      </div>
      <ul className="mt-1.5 flex flex-col gap-1.5">
        {milestones.slice(0, 4).map((m) => (
          <MilestoneRow key={m.id} milestone={m} />
        ))}
      </ul>
    </motion.section>
  );
}

function MilestoneRow({ milestone }: { milestone: Milestone }) {
  const [pending, start] = useTransition();
  return (
    <li className="flex items-start gap-2">
      <Leaf className="mt-0.5 h-3.5 w-3.5 shrink-0 text-acid-lime" />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] leading-snug text-foreground">{milestone.narrative}</p>
        <span className="text-[10px] text-muted-foreground">{milestone.achieved_at}</span>
      </div>
      <button
        type="button"
        aria-label={`Dismiss milestone ${milestone.label}`}
        disabled={pending}
        onClick={(e) => {
          // Future-proof: when the row becomes whole-card clickable (Open
          // milestone details), the dismiss button stops propagation so the
          // dismiss never doubles as an open.
          e.stopPropagation();
          start(() => dismissMilestoneSurfacingAction(milestone.id));
        }}
        className="text-muted-foreground/60 hover:text-foreground/80"
      >
        <X className="h-3 w-3" />
      </button>
    </li>
  );
}

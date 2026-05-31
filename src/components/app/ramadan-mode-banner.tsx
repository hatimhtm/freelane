"use client";

import { Moon } from "lucide-react";
import { motion } from "motion/react";
import type { RamadanPeriod } from "@/lib/islamic-calendar";
import { phtDateString } from "@/lib/utils";

// Ramadan Mode (#7 expanded) — banner only when we're in prep window OR
// inside Ramadan itself. Voice: warm, observational. No counting down to
// celebrations as a budgeting opportunity; just acknowledging the season.

export function RamadanModeBanner({ period }: { period: RamadanPeriod | null }) {
  if (!period) return null;
  if (!period.inWindow && !period.inPrepWindow) return null;

  let line: string;
  if (period.inWindow) {
    line = `Ramadan ${period.hijriYear} AH — day ${dayOfRamadan(period)} of the month.`;
  } else {
    line = `Ramadan begins in ${period.daysUntilStart}d (${phtDateString(period.start)}). Eid al-Fitr lands ${period.eidAlFitr ? phtDateString(period.eidAlFitr) : "shortly after"}.`;
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className="flex items-center gap-3 rounded-[12px] border border-border/60 bg-card/40 px-4 py-3"
    >
      <Moon className="h-4 w-4 shrink-0 text-foreground/70" />
      <p className="text-sm leading-snug text-foreground">{line}</p>
    </motion.section>
  );
}

function dayOfRamadan(period: RamadanPeriod): number {
  const now = new Date();
  return Math.max(1, Math.floor((now.getTime() - period.start.getTime()) / 86_400_000) + 1);
}

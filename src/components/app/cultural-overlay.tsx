"use client";

import { motion } from "motion/react";
import { CalendarDays, Moon, School, Sparkles } from "lucide-react";
import type { IslamicCalendarRow, PhCulturalEventRow } from "@/lib/supabase/types";

import {
  upcomingIslamic,
  islamicLabelFor,
  type IslamicWindow,
} from "@/lib/islamic-calendar";
import { nextFiesta, nextSchoolEvent, phCulturalLabel } from "@/lib/ph-cultural";
import { phtDateString } from "@/lib/utils";

// PH Cultural Rhythm Overlay (#29) — RESTRICTED to fiesta + school year +
// Ramadan + Eids per Hatim 2026-06-01. A single compact strip under the
// Today hero surfacing the closest upcoming cultural event from each lane.
//
// Compact, calm, single line per event. No emojis (icons are fine — they're
// lucide line icons, not pictographs).

export function CulturalOverlay({
  islamic,
  phCultural,
}: {
  islamic: IslamicCalendarRow[];
  phCultural: PhCulturalEventRow[];
}) {
  const now = new Date();
  const upcomingIslam = upcomingIslamic(
    islamic,
    ["ramadan_start", "ramadan_end", "eid_al_fitr", "eid_al_adha"],
    now,
    120,
  );
  const fiesta = nextFiesta(phCultural, now);
  const school = nextSchoolEvent(phCultural, now);

  const rows: OverlayRow[] = [];
  for (const w of upcomingIslam.slice(0, 2)) {
    rows.push(islamicRow(w));
  }
  if (fiesta) {
    rows.push({
      icon: <Sparkles className="h-3.5 w-3.5" />,
      label: phCulturalLabel(fiesta.kind),
      detail: `${fiesta.name}${fiesta.daysUntilStart > 0 ? ` · ${fiesta.daysUntilStart}d` : " · today"}`,
      key: `fiesta-${fiesta.name}`,
    });
  }
  if (school) {
    rows.push({
      icon: <School className="h-3.5 w-3.5" />,
      label: phCulturalLabel(school.kind),
      detail: `${school.name}${school.daysUntilStart > 0 ? ` · ${school.daysUntilStart}d` : school.inWindow ? " · this week" : ""}`,
      key: `school-${school.name}`,
    });
  }

  if (rows.length === 0) return null;

  return (
    <motion.section
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className="rounded-[12px] border border-border/60 bg-card/30 px-3.5 py-2.5"
    >
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1.5">
        {rows.slice(0, 4).map((r) => (
          <div key={r.key} className="flex items-baseline gap-1.5 text-[11px]">
            <span className="text-muted-foreground">{r.icon}</span>
            <span className="font-medium text-foreground/80">{r.label}</span>
            <span className="text-muted-foreground">{r.detail}</span>
          </div>
        ))}
      </div>
    </motion.section>
  );
}

interface OverlayRow {
  icon: React.ReactNode;
  label: string;
  detail: string;
  key: string;
}

function islamicRow(w: IslamicWindow): OverlayRow {
  const isEid = w.kind === "eid_al_fitr" || w.kind === "eid_al_adha";
  return {
    icon: isEid ? <CalendarDays className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />,
    label: islamicLabelFor(w.kind),
    detail: w.daysUntil > 0
      ? `${w.daysUntil}d`
      : w.daysUntil === 0
        ? "today"
        : `${Math.abs(w.daysUntil)}d ago`,
    key: `islam-${w.kind}-${phtDateString(w.date)}`,
  };
}

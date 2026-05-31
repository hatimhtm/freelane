import type {
  PhCulturalEventKind,
  PhCulturalEventRow,
} from "@/lib/supabase/types";

// PH cultural calendar helpers. RESTRICTED scope per Hatim (2026-06-01):
// ONLY fiesta + school year (start/end/midterm/finals/break). NO Christmas,
// NO Western holidays. Migration 0035 seeded 2026-2030.

const DAY_MS = 86_400_000;

function parseLocalDate(yyyymmdd: string): Date {
  const [y, m, d] = yyyymmdd.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export interface PhCulturalWindow {
  kind: PhCulturalEventKind;
  name: string;
  starts: Date;
  ends: Date;
  daysUntilStart: number;
  inWindow: boolean;
}

// Events whose date OR range falls inside [now, now + horizonDays]. If the
// event is currently in-window, it's also returned with daysUntilStart < 0.
export function upcomingPhCultural(
  rows: PhCulturalEventRow[],
  now: Date = new Date(),
  horizonDays = 120,
): PhCulturalWindow[] {
  const today = startOfDay(now);
  const horizon = new Date(today.getTime() + horizonDays * DAY_MS);
  return rows
    .map((r) => {
      const starts = parseLocalDate(r.gregorian_date);
      const ends = r.ends_at ? parseLocalDate(r.ends_at) : starts;
      return { r, starts, ends };
    })
    .filter(({ starts, ends }) => ends >= today && starts <= horizon)
    .sort((a, b) => a.starts.getTime() - b.starts.getTime())
    .map(({ r, starts, ends }) => ({
      kind: r.kind as PhCulturalEventKind,
      name: r.name,
      starts,
      ends,
      daysUntilStart: Math.round((starts.getTime() - today.getTime()) / DAY_MS),
      inWindow: today >= starts && today <= ends,
    }));
}

// The next fiesta-style event (San Pablo Coconut Festival) — Hatim's primary
// PH cultural anchor.
export function nextFiesta(
  rows: PhCulturalEventRow[],
  now: Date = new Date(),
): PhCulturalWindow | null {
  return upcomingPhCultural(rows.filter((r) => r.kind === "fiesta_san_pablo"), now, 400)[0] ?? null;
}

// The next school-year inflection point (midterm / finals / break / start).
// Used by the Wife's Uni Calendar Memory overlay.
const SCHOOL_KINDS: PhCulturalEventKind[] = [
  "school_year_start",
  "school_year_end",
  "midterm",
  "finals",
  "semestral_break",
];

export function nextSchoolEvent(
  rows: PhCulturalEventRow[],
  now: Date = new Date(),
): PhCulturalWindow | null {
  return upcomingPhCultural(rows.filter((r) => SCHOOL_KINDS.includes(r.kind as PhCulturalEventKind)), now, 200)[0] ?? null;
}

export function phCulturalLabel(kind: PhCulturalEventKind): string {
  switch (kind) {
    case "fiesta_san_pablo": return "San Pablo Fiesta";
    case "school_year_start": return "Academic year begins";
    case "school_year_end": return "Academic year ends";
    case "midterm": return "Midterm week";
    case "finals": return "Finals week";
    case "semestral_break": return "Semestral break";
    default: return kind;
  }
}

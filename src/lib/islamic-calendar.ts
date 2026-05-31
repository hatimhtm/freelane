import type {
  IslamicCalendarRow,
  IslamicEventKind,
  PlannedSpend,
} from "@/lib/supabase/types";

// Islamic calendar helpers. Reads from finance.islamic_calendar (seeded
// 2026-2030 in migration 0035). Powers Ramadan Mode (#7), Eid Preparation
// Plan 60d out (G), and the PH Cultural Overlay's Ramadan/Eid surface (#29).

const DAY_MS = 86_400_000;

export const EID_PREP_WINDOW_DAYS = 60;
export const RAMADAN_PREP_WINDOW_DAYS = 30;

export interface IslamicWindow {
  kind: IslamicEventKind;
  date: Date;
  daysUntil: number;
  hijriLabel: string | null;
  hijriYear: number;
}

function parseLocalDate(yyyymmdd: string): Date {
  const [y, m, d] = yyyymmdd.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// Upcoming events of the given kind that fall inside [now, now + horizonDays].
export function upcomingIslamic(
  rows: IslamicCalendarRow[],
  kinds: IslamicEventKind[],
  now: Date = new Date(),
  horizonDays = 365,
): IslamicWindow[] {
  const horizonEnd = new Date(now.getTime() + horizonDays * DAY_MS);
  return rows
    .filter((r) => kinds.includes(r.kind as IslamicEventKind))
    .map((r) => ({ r, d: parseLocalDate(r.gregorian_date) }))
    .filter(({ d }) => d >= startOfDay(now) && d <= horizonEnd)
    .sort((a, b) => a.d.getTime() - b.d.getTime())
    .map(({ r, d }) => ({
      kind: r.kind as IslamicEventKind,
      date: d,
      daysUntil: Math.round((d.getTime() - startOfDay(now).getTime()) / DAY_MS),
      hijriLabel: r.hijri_label,
      hijriYear: r.hijri_year,
    }));
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

// Pair Ramadan_start with the Eid al-Fitr that follows it — useful for the
// Ramadan Mode card ("Ramadan starts March 19 → Eid al-Fitr March 20", which
// is a single planning lens).
export interface RamadanPeriod {
  start: Date;
  end: Date;
  eidAlFitr: Date | null;
  hijriYear: number;
  daysUntilStart: number;
  daysUntilEid: number | null;
  inWindow: boolean;       // now sits between [start, end]
  inPrepWindow: boolean;   // start is within RAMADAN_PREP_WINDOW_DAYS
}

export function nextRamadanPeriod(
  rows: IslamicCalendarRow[],
  now: Date = new Date(),
): RamadanPeriod | null {
  const today = startOfDay(now);
  // Find ramadan_start dates upcoming OR already in progress (within last 31d).
  const starts = rows
    .filter((r) => r.kind === "ramadan_start")
    .map((r) => ({ r, d: parseLocalDate(r.gregorian_date) }))
    .filter(({ d }) => d.getTime() >= today.getTime() - 31 * DAY_MS)
    .sort((a, b) => a.d.getTime() - b.d.getTime());
  const start = starts[0];
  if (!start) return null;
  const end = rows.find(
    (r) => r.kind === "ramadan_end" && r.hijri_year === start.r.hijri_year,
  );
  const eid = rows.find(
    (r) => r.kind === "eid_al_fitr" && r.hijri_year === start.r.hijri_year,
  );
  const endDate = end ? parseLocalDate(end.gregorian_date) : new Date(start.d.getTime() + 30 * DAY_MS);
  const eidDate = eid ? parseLocalDate(eid.gregorian_date) : null;
  const daysUntilStart = Math.round((start.d.getTime() - today.getTime()) / DAY_MS);
  const daysUntilEid = eidDate ? Math.round((eidDate.getTime() - today.getTime()) / DAY_MS) : null;
  const inWindow = today >= start.d && today <= endDate;
  const inPrepWindow = daysUntilStart >= 0 && daysUntilStart <= RAMADAN_PREP_WINDOW_DAYS;
  return {
    start: start.d,
    end: endDate,
    eidAlFitr: eidDate,
    hijriYear: start.r.hijri_year,
    daysUntilStart,
    daysUntilEid,
    inWindow,
    inPrepWindow,
  };
}

// Both Eid prep windows (60d-out per Hatim 2026-06-01). Each Eid landing in
// the next 60 days surfaces as a prep card.
export interface EidPrepWindow {
  kind: "eid_al_fitr" | "eid_al_adha";
  date: Date;
  hijriLabel: string | null;
  hijriYear: number;
  daysUntil: number;
  // Existing planned_spends that already target this Eid window (matched by
  // label OR planned_for inside Eid date ± 14d).
  existingPlans: PlannedSpend[];
}

export function eidPrepWindows(
  rows: IslamicCalendarRow[],
  planned: PlannedSpend[],
  now: Date = new Date(),
): EidPrepWindow[] {
  const today = startOfDay(now);
  const horizon = new Date(today.getTime() + EID_PREP_WINDOW_DAYS * DAY_MS);
  return rows
    .filter((r) => r.kind === "eid_al_fitr" || r.kind === "eid_al_adha")
    .map((r) => ({ r, d: parseLocalDate(r.gregorian_date) }))
    .filter(({ d }) => d >= today && d <= horizon)
    .sort((a, b) => a.d.getTime() - b.d.getTime())
    .map(({ r, d }) => {
      const eidLabel = r.kind === "eid_al_fitr" ? "Eid al-Fitr" : "Eid al-Adha";
      const before = new Date(d.getTime() - 14 * DAY_MS);
      const after = new Date(d.getTime() + 7 * DAY_MS);
      const existingPlans = planned.filter((p) => {
        if (p.status === "cancelled" || p.status === "done") return false;
        if (p.label.toLowerCase().includes("eid")) return true;
        if (p.label.toLowerCase().includes(eidLabel.toLowerCase())) return true;
        const pd = parseLocalDate(p.planned_for);
        return pd >= before && pd <= after;
      });
      return {
        kind: r.kind as "eid_al_fitr" | "eid_al_adha",
        date: d,
        hijriLabel: r.hijri_label,
        hijriYear: r.hijri_year,
        daysUntil: Math.round((d.getTime() - today.getTime()) / DAY_MS),
        existingPlans,
      };
    });
}

export function islamicLabelFor(kind: IslamicEventKind): string {
  switch (kind) {
    case "eid_al_fitr": return "Eid al-Fitr";
    case "eid_al_adha": return "Eid al-Adha";
    case "ramadan_start": return "Ramadan begins";
    case "ramadan_end": return "Ramadan ends";
    case "arafat": return "Day of Arafat";
    case "hijri_new_year": return "Islamic New Year";
  }
}

import "server-only";

import { phtDateString } from "@/lib/utils";

// Prayer-times integration against aladhan.com.
//
// API shape (timingsByCity / timings):
//   https://api.aladhan.com/v1/timings/{date}?latitude=X&longitude=Y
//     &method=N&school=M
//
// `method` is the calculation method (matches finance.faith_settings
// .calculation_method). `school` is 0 (Shafi') / 1 (Hanafi).
//
// The response is cached via Next's fetch cache (6h revalidate) and
// tagged with 'freelane-faith-prayer-times'. Invalidation is driven by
// saveFaithSettings calling revalidateTag — we do NOT rely on the URL
// changing to "naturally" flush the OLD key (the previous URL stays in
// the per-key cache until the 6h TTL elapses; the tag flush is the only
// thing that lets a renamed location show up immediately).
// We don't write to our own table — the cache layer keeps network calls
// down without adding state we have to migrate.

export type DailyPrayerTimes = {
  date: string; // YYYY-MM-DD in PHT
  fajr: string | null;
  sunrise: string | null;
  dhuhr: string | null;
  asr: string | null;
  maghrib: string | null;
  isha: string | null;
  imsak: string | null;
};

type AladhanTimings = Record<string, string>;

type AladhanResponse = {
  code?: number;
  data?: {
    timings?: AladhanTimings;
    date?: { gregorian?: { date?: string } };
  };
};

// Strip the parenthesised timezone Aladhan appends (e.g. "04:36 (PHT)").
function clean(time: string | undefined): string | null {
  if (!time) return null;
  return time.split(" ")[0] ?? null;
}

// Build the DD-MM-YYYY path segment Aladhan expects from a PHT-anchored
// date key. Pulling UTC components off `new Date()` directly was wrong
// for any moment between 16:00 UTC and 00:00 UTC — PHT had already
// rolled into the next day but the request still asked for UTC-today's
// timings, so the user saw yesterday's table after midnight PHT.
function ddmmyyyyPht(): string {
  const [y, m, d] = phtDateString(new Date()).split("-");
  return `${d}-${m}-${y}`;
}

export async function fetchDailyPrayerTimes({
  latitude,
  longitude,
  method,
  madhab,
}: {
  latitude: number;
  longitude: number;
  method: number;
  madhab: "shafi" | "hanafi";
}): Promise<DailyPrayerTimes | null> {
  const school = madhab === "hanafi" ? 1 : 0;
  const dateStr = ddmmyyyyPht();
  const url = `https://api.aladhan.com/v1/timings/${dateStr}?latitude=${latitude}&longitude=${longitude}&method=${method}&school=${school}`;

  try {
    const res = await fetch(url, {
      // Cache per day per location/method/madhab combo. Next collapses
      // identical fetches across the render pass; the 6h revalidate keeps
      // the table fresh enough that a method/location change shows up
      // before the next PHT-midnight tick triggers a full recompute.
      next: { revalidate: 60 * 60 * 6, tags: ["freelane-faith-prayer-times"] },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as AladhanResponse;
    const timings = json?.data?.timings;
    const date = json?.data?.date?.gregorian?.date ?? dateStr;
    if (!timings) return null;
    return {
      date,
      fajr: clean(timings.Fajr),
      sunrise: clean(timings.Sunrise),
      dhuhr: clean(timings.Dhuhr),
      asr: clean(timings.Asr),
      maghrib: clean(timings.Maghrib),
      isha: clean(timings.Isha),
      imsak: clean(timings.Imsak),
    };
  } catch {
    // Network errors are silent — the UI renders a friendly fallback
    // "Couldn't fetch prayer times" instead of throwing.
    return null;
  }
}

// CALCULATION_METHODS moved to ./calculation-methods so Client Components
// can read the picker catalogue without importing this server-only module.
// Re-exported here for back-compat with any server-side caller.
export { CALCULATION_METHODS } from "./calculation-methods";

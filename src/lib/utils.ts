import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Manila is UTC+8 with NO daylight savings. Single-user Freelane runs on
// Hatim's PHT clock, but the server (Vercel) runs in UTC and `new Date()` on
// any device defaults to its local clock. Using `.toISOString().slice(0,10)`
// returns the UTC date, which is wrong at PHT midnight–08:00 (server still
// reads as "yesterday"). These helpers force PHT semantics for everything
// that produces a "YYYY-MM-DD" string the user reads as a date.
const PHT_OFFSET_MS = 8 * 60 * 60 * 1000;

export function phtToday(): string {
  return phtDateString(new Date());
}

export function phtDateString(d: Date): string {
  const shifted = new Date(d.getTime() + PHT_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Returns the PHT clock-time as "HH:mm" for any Date moment. Used by the
// spend modal's "now" default + log timestamps that should read in local
// time even on UTC servers.
export function phtTimeHHMM(d: Date = new Date()): string {
  const shifted = new Date(d.getTime() + PHT_OFFSET_MS);
  const h = String(shifted.getUTCHours()).padStart(2, "0");
  const m = String(shifted.getUTCMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

// PHT-correct Monday-of-week key for dedup/cache keys (e.g. weekly check-ins,
// weekly cache buckets). Returns "YYYY-MM-DD" in PHT. Parses the supplied
// date's PHT date first so the rollover doesn't move when the server is UTC.
export function phtMondayOfWeek(d: Date = new Date()): string {
  // Build a PHT-anchored Date at PHT-midnight for the given moment.
  const todayStr = phtDateString(d);
  const pht = new Date(`${todayStr}T00:00:00+08:00`);
  // getUTCDay() on a +08 anchor returns the same weekday as PHT clock.
  const dow = (pht.getUTCDay() || 7) - 1; // 0 = Monday, 6 = Sunday
  const monday = new Date(pht.getTime() - dow * 86_400_000);
  return phtDateString(monday);
}

// Accept BOTH "." and "," as the decimal separator on amount inputs — the
// numpad comma key is right there on most keyboards (esp. EU layouts) and
// the user shouldn't have to retrain their muscle memory. Use this on the
// onChange of every amount field that's <input type="text" inputMode="decimal">.
// Returns a string safe to feed into Number()/parseFloat() and to store as
// the input's controlled value. Strips non-digits except an optional leading
// minus and a single decimal point.
export function normalizeAmountInput(raw: string): string {
  if (!raw) return "";
  let sign = "";
  let body = raw.replace(/,/g, ".");
  if (body.startsWith("-")) {
    sign = "-";
    body = body.slice(1);
  }
  const cleaned = body.replace(/[^\d.]/g, "");
  const parts = cleaned.split(".");
  const payload = parts.length <= 1
    ? cleaned
    : `${parts[0]}.${parts.slice(1).join("").slice(0, 2)}`;
  return `${sign}${payload}`;
}

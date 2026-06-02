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

// Single source of truth for "is this spend_at value today in PHT?".
// The Live Daily Safe pipeline computes todaySpendsBase by summing over
// spends whose spent_at PHT-date equals today's PHT-date. Today's page,
// the Spending loader, and the SpendModal optimistic gate must all
// answer this the same way — drift between them silently re-introduces
// bug-class #2 (live numbers disagreeing across surfaces).
//
// Accepts the spend's `spent_at` (ISO string or Date) and an optional
// reference moment (defaults to now). The reference is used for tests.
export function isPhtToday(
  spentAt: string | Date,
  reference: Date = new Date(),
): boolean {
  const d = typeof spentAt === "string" ? new Date(spentAt) : spentAt;
  return phtDateString(d) === phtDateString(reference);
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

// Milliseconds until the next PHT-midnight (rollover into the next PHT
// day). Used by the Today + Spending client views to schedule a
// router.refresh() at exactly the boundary so the live-daily snapshot
// transitions to the new day without a stale hero number lingering for
// users who keep the tab open across midnight.
//
// Returns a number in [1, 24*60*60*1000]. The +1ms minimum protects
// against scheduling a setTimeout with delay 0 when the function is
// called at exactly PHT midnight (which would re-fire immediately and
// thrash router.refresh()).
export function msUntilNextPhtMidnight(reference: Date = new Date()): number {
  const todayStr = phtDateString(reference);
  // The PHT timezone offset is +08:00 year-round, so the next PHT
  // midnight is parseable as an ISO string with the explicit offset.
  const todayPhtStart = new Date(`${todayStr}T00:00:00+08:00`).getTime();
  const nextMidnight = todayPhtStart + 86_400_000;
  const delta = nextMidnight - reference.getTime();
  return delta > 0 ? delta : 1;
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

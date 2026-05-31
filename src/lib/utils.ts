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

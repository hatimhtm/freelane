import type {
  CurrencyCode,
  ExchangeRate,
  RecurringSpend,
  RecurringSpendSkip,
} from "@/lib/supabase/types";
import { toBase } from "@/lib/money";

const DAY_MS = 86_400_000;

// Period-key format must match SQL convention (migration 0020):
//   monthly         → "YYYY-MM"
//   half_monthly    → "YYYY-MM-H1" | "YYYY-MM-H2"
//   weekly          → "YYYY-Www"
//   every_n_months  → "YYYY-MM"
//   yearly          → "YYYY"
export function periodKey(rule: RecurringSpend, date: Date): string {
  switch (rule.schedule_kind) {
    case "monthly":
    case "every_n_months":
      return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
    case "half_monthly": {
      const h = date.getDate() <= 15 ? "H1" : "H2";
      return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${h}`;
    }
    case "weekly": {
      const w = isoWeek(date);
      return `${w.year}-W${pad2(w.week)}`;
    }
    case "yearly":
      return `${date.getFullYear()}`;
  }
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// Local-time ISO 8601 week. The app is single-user Manila (no DST), so local is
// stable and keeps anchorDate (also local) consistent with the period_key it
// gets tagged under at the same instant.
function isoWeek(d: Date): { year: number; week: number } {
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayNum = t.getDay() || 7;
  t.setDate(t.getDate() + 4 - dayNum);
  const yearStart = new Date(t.getFullYear(), 0, 1);
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7);
  return { year: t.getFullYear(), week };
}

// Canonical "due" date for the rule's current period — the day reminders anchor on.
//   monthly + day_of_month 5 → the 5th of the current month
//   half_monthly             → 1st OR 15th (whichever this period straddles)
//   weekly + day_of_week 1   → Monday of the CURRENT ISO week
//   yearly                   → day_of_month of January (v1 schema limitation)
export function anchorDate(rule: RecurringSpend, periodReference: Date): Date {
  switch (rule.schedule_kind) {
    case "monthly":
    case "every_n_months": {
      const day = clampDayToMonth(
        periodReference.getFullYear(),
        periodReference.getMonth(),
        rule.day_of_month ?? 1,
      );
      return new Date(periodReference.getFullYear(), periodReference.getMonth(), day);
    }
    case "half_monthly": {
      const day = periodReference.getDate();
      // Anchor at the START of the half (day 1 for H1, day 16 for H2) so
      // window math centers symmetrically and periodKey(anchor) === periodKey(now).
      const which = day <= 15 ? 1 : 16;
      return new Date(periodReference.getFullYear(), periodReference.getMonth(), which);
    }
    case "weekly": {
      // Snap to Monday of the CURRENT ISO week first, then offset to target.
      // Without this snap, anchor jumps to next week's matching day if today's
      // weekday is past the target — which decouples the anchor from the
      // period_key the engine tags for the same instant.
      const target = rule.day_of_week ?? 1;  // JS convention: 0 = Sunday
      const start = new Date(periodReference);
      start.setHours(0, 0, 0, 0);
      const jsDay = start.getDay();
      const daysFromMonday = (jsDay + 6) % 7;       // Mon=0, Tue=1, …, Sun=6
      const monday = new Date(start);
      monday.setDate(monday.getDate() - daysFromMonday);
      const targetOffset = (target + 6) % 7;
      monday.setDate(monday.getDate() + targetOffset);
      return monday;
    }
    case "yearly": {
      return new Date(periodReference.getFullYear(), 0, rule.day_of_month ?? 1);
    }
  }
}

// Handle Feb 30, Apr 31, etc. — clamp day to the last day of the target month.
function clampDayToMonth(year: number, monthZeroIndexed: number, day: number): number {
  const lastDay = new Date(year, monthZeroIndexed + 1, 0).getDate();
  return Math.min(day, lastDay);
}

export function isWithinWindow(rule: RecurringSpend, now: Date = new Date()): boolean {
  if (!rule.active) return false;
  const anchor = anchorDate(rule, now);
  anchor.setHours(0, 0, 0, 0);  // defensive: every anchorDate branch already returns midnight
  const winStart = new Date(anchor.getTime() - rule.window_before_days * DAY_MS);
  const winEnd = new Date(anchor.getTime() + (rule.window_after_days + 1) * DAY_MS - 1);
  return now >= winStart && now <= winEnd;
}

export function isCurrentPeriodSettled(
  rule: RecurringSpend,
  skips: RecurringSpendSkip[],
  now: Date = new Date(),
): boolean {
  const key = periodKey(rule, now);
  return skips.some((s) => s.recurring_spend_id === rule.id && s.period_key === key);
}

export interface PendingRecurring {
  rule: RecurringSpend;
  anchor: Date;
  windowStart: Date;
  windowEnd: Date;
  periodKey: string;
}

export function pendingRecurringNow(
  rules: RecurringSpend[],
  skips: RecurringSpendSkip[],
  now: Date = new Date(),
): PendingRecurring[] {
  return rules
    .filter((r) => r.active)
    .filter((r) => isWithinWindow(r, now))
    .filter((r) => !isCurrentPeriodSettled(r, skips, now))
    .map((r) => {
      const anchor = anchorDate(r, now);
      anchor.setHours(0, 0, 0, 0);
      return {
        rule: r,
        anchor,
        windowStart: new Date(anchor.getTime() - r.window_before_days * DAY_MS),
        windowEnd: new Date(anchor.getTime() + (r.window_after_days + 1) * DAY_MS - 1),
        periodKey: periodKey(r, now),
      };
    });
}

export function expectedBase(
  rule: RecurringSpend,
  rates: Pick<ExchangeRate, "code" | "rate_to_base">[],
): number {
  return toBase(Number(rule.expected_amount), rule.expected_currency as CurrencyCode, rates);
}

// Future period-keys to emit when a single paid spend covers N periods.
// Returns the N-1 keys following the period the spend settled — those rows
// are written into recurring_spend_skips with source='covered_by_prepay' so
// the reminder engine stays quiet for the prepaid window.
export function prepayPeriodKeys(
  rule: RecurringSpend,
  paidAt: Date,
  coversPeriods: number,
): string[] {
  if (coversPeriods <= 1) return [];
  const out: string[] = [];
  const cursor = new Date(paidAt);
  for (let i = 1; i < coversPeriods; i++) {
    advance(rule, cursor);
    out.push(periodKey(rule, cursor));
  }
  return out;
}

// Move cursor forward by one period. Edge cases that previously broke:
//  - monthly / every_n_months: naïve setMonth day-overflows at month ends
//    (paidAt Jan 31 → Feb 31 → JS rolls to Mar 3, skipping Feb entirely).
//    Fix: clamp day to last day of TARGET month.
//  - half_monthly: +15 days from Jan 16 = Jan 31, still in H2. Fix: jump
//    explicitly to the START of the next half (day 16 of same month if in H1,
//    or day 1 of next month if in H2).
function advance(rule: RecurringSpend, cursor: Date): void {
  switch (rule.schedule_kind) {
    case "monthly": {
      const y = cursor.getFullYear();
      const targetM = cursor.getMonth() + 1;
      const d = clampDayToMonth(y, targetM, cursor.getDate());
      cursor.setFullYear(y, targetM, d);
      break;
    }
    case "every_n_months": {
      const y = cursor.getFullYear();
      const targetM = cursor.getMonth() + (rule.every_n_value ?? 1);
      const d = clampDayToMonth(y, targetM, cursor.getDate());
      cursor.setFullYear(y, targetM, d);
      break;
    }
    case "half_monthly": {
      const d = cursor.getDate();
      if (d <= 15) {
        cursor.setDate(16);
      } else {
        cursor.setMonth(cursor.getMonth() + 1, 1);
      }
      break;
    }
    case "weekly":
      cursor.setDate(cursor.getDate() + 7 * (rule.every_n_value ?? 1));
      break;
    case "yearly":
      cursor.setFullYear(cursor.getFullYear() + 1);
      break;
  }
}

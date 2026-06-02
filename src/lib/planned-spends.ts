import type { PlannedSpend } from "@/lib/supabase/types";
import { safeToSpend, type SafeToSpendInputs } from "@/lib/safe-to-spend";

// Anything bigger than this many days of safe-to-spend at the current pace
// is considered a "big plan" — drives the Pre-Mortem narrative and shows up
// in the Calm Weather brain's input snapshot. Threshold is intentionally
// generous (1 week of spending) so even mid-sized plans like an Apple Dev
// renewal trigger reflection.
export const BIG_PLAN_DAYS_THRESHOLD = 7;

// A PHP floor too — never miss a 5-figure outflow just because the user is
// in a strong window. Hatim's ₱70k MacBook would qualify either way, but
// the explicit floor catches the Apple Dev renewal (₱5,500-ish) when his
// safe-to-spend is high.
export const BIG_PLAN_BASE_FLOOR = 4000;

export interface PlannedSpendsInRange {
  total: number;
  rows: PlannedSpend[];
}

const DAY_MS = 86_400_000;

// Sum of PLANNED-STATUS planned_spends in [start, end] — counts windows too. A
// planned spend with planned_for inside [start, end] OR a window straddling it
// is included. `committed`, `cancelled`, and `done` are ALL EXCLUDED here:
// committed is tracked separately by committedPoolBase (always-locked, not
// horizon-bound), so counting it here would double-subtract from the
// discretionary pool.
export function plannedInRange(
  planned: PlannedSpend[],
  start: Date,
  end: Date,
  opts: { includeWindow?: boolean } = {},
): PlannedSpendsInRange {
  const includeWindow = opts.includeWindow ?? true;
  const rows = planned.filter((p) => {
    // Migration 0088 — 'active' is the redesign-vocabulary alias for
    // "intent declared, not yet bought". Old 'planned' rows still count
    // identically, so both flow through here. 'bought'/'done'/'cancelled'/
    // 'abandoned' are EXCLUDED — they're history, not future obligation.
    if (p.status !== "planned" && p.status !== "active") return false;
    const center = parseLocalDate(p.planned_for);
    if (includeWindow) {
      const win = p.planned_for_window_days || 0;
      const startWin = new Date(center.getTime() - win * DAY_MS);
      const endWin = new Date(center.getTime() + win * DAY_MS);
      return endWin >= start && startWin <= end;
    }
    return center >= start && center <= end;
  });
  const total = rows.reduce((s, p) => s + Number(p.expected_base ?? 0), 0);
  return { total, rows };
}

// Migration 0088 collapsed the lock mechanism — there is no "committed
// pool" anymore. The function is preserved as a 0-returning stub so
// any historical call site keeps compiling until they migrate. New code
// should NOT call this — daily safe is governed entirely by the
// safe-to-spend.applyStrategy hook now.
export function committedPoolBase(_planned: PlannedSpend[]): number {
  return 0;
}

// Mirror parseLocalDate from dashboard-calc to handle "YYYY-MM-DD" without
// the UTC pitfall.
function parseLocalDate(yyyymmdd: string): Date {
  const [y, m, d] = yyyymmdd.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// Auto-detect "big" status from safe-to-spend.
// Used at create time when user doesn't explicitly mark; also re-evaluated
// when safe-to-spend shifts dramatically.
export function isLikelyBigPlan(
  expectedBase: number,
  safeInputs: SafeToSpendInputs,
): boolean {
  if (expectedBase >= BIG_PLAN_BASE_FLOOR) return true;
  const safe = safeToSpend(safeInputs);
  const dailyPace = Math.max(1, safe.dailyAllowanceBase);
  return expectedBase >= dailyPace * BIG_PLAN_DAYS_THRESHOLD;
}

// Big plans hitting in the next N days — drives the Pre-Mortem cards.
export function bigPlansUpcoming(
  planned: PlannedSpend[],
  now: Date,
  withinDays = 90,
): PlannedSpend[] {
  const horizonEnd = new Date(now.getTime() + withinDays * DAY_MS);
  return planned
    .filter((p) => p.is_big_plan)
    .filter((p) => p.status === "planned" || p.status === "active")
    .filter((p) => {
      const d = parseLocalDate(p.planned_for);
      return d >= now && d <= horizonEnd;
    })
    .sort((a, b) => {
      const da = parseLocalDate(a.planned_for).getTime();
      const db = parseLocalDate(b.planned_for).getTime();
      return da - db;
    });
}

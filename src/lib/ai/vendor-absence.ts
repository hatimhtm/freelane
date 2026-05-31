import "server-only";
import type {
  Spend,
  SpendVendorLink,
  Vendor,
} from "@/lib/supabase/types";

// Vendor Absence Detector (#31) — "Haven't been to Mercury Drug in 67 days
// — change?" A vendor counts as "absent" when:
//   1. The user has visited it ≥ 3 times historically (signal not noise).
//   2. The recent gap exceeds the typical gap × 2 (with a hard 30d floor).
//
// Pure-math; no AI call. The surface frames the read; user replies via the
// AI Questions queue if curious.

const DAY_MS = 86_400_000;
const ABSENT_FLOOR_DAYS = 30;
const HISTORICAL_VISIT_FLOOR = 3;

export interface VendorAbsence {
  vendor: Vendor;
  lastSeenAt: string | null;
  daysSinceLastSeen: number;
  typicalGapDays: number;
  totalVisits: number;
}

export function vendorAbsences(
  vendors: Vendor[],
  links: SpendVendorLink[],
  spends: Spend[],
  now: Date = new Date(),
): VendorAbsence[] {
  const spendById = new Map(spends.map((s) => [s.id, s] as const));
  const linksByVendor = new Map<string, string[]>();
  for (const l of links) {
    const arr = linksByVendor.get(l.vendor_id) ?? [];
    arr.push(l.spend_id);
    linksByVendor.set(l.vendor_id, arr);
  }
  const out: VendorAbsence[] = [];
  for (const v of vendors) {
    if (v.archived) continue;
    const spendIds = linksByVendor.get(v.id) ?? [];
    if (spendIds.length < HISTORICAL_VISIT_FLOOR) continue;
    const dates = spendIds
      .map((id) => spendById.get(id)?.spent_at)
      .filter((d): d is string => !!d)
      .sort();
    if (dates.length < HISTORICAL_VISIT_FLOOR) continue;
    const lastSeen = dates[dates.length - 1];
    const lastSeenDate = new Date(lastSeen);
    const daysSinceLastSeen = Math.round((now.getTime() - lastSeenDate.getTime()) / DAY_MS);
    // Compute typical gap from consecutive-visit deltas.
    const gaps: number[] = [];
    for (let i = 1; i < dates.length; i++) {
      const a = new Date(dates[i - 1]).getTime();
      const b = new Date(dates[i]).getTime();
      gaps.push((b - a) / DAY_MS);
    }
    const typicalGapDays = gaps.length ? gaps.reduce((s, g) => s + g, 0) / gaps.length : 0;
    if (daysSinceLastSeen > Math.max(ABSENT_FLOOR_DAYS, typicalGapDays * 2)) {
      out.push({
        vendor: v,
        lastSeenAt: lastSeen,
        daysSinceLastSeen,
        typicalGapDays,
        totalVisits: dates.length,
      });
    }
  }
  // Most-overdue first.
  out.sort((a, b) => b.daysSinceLastSeen - a.daysSinceLastSeen);
  return out;
}

export function absenceLine(a: VendorAbsence): string {
  const days = a.daysSinceLastSeen;
  return `${a.vendor.canonical_name} — ${days} days since last visit (typical ${a.typicalGapDays.toFixed(0)}d).`;
}

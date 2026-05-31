import type { Spend } from "@/lib/supabase/types";

// Cigarette Cost Translator (D) — every Cigarettes spend gets translation
// in Hatim's terms. Pure-math; no Gemini call. Surfaces inline in the
// spend modal when the Cigarettes tag is selected and again quarterly as
// an annual projection card.
//
// Translation framings (from memory):
//   - days closer to family wallet (₱100/day target — calibration value)
//   - weeks of coffee (₱180/week local rate — calibration value)
//   - Sadaka-equivalent (1.5% of current landings)
//
// Voice rules: factual, never moralized. The output is a list of frames;
// the UI picks one or two at a time.

const FAMILY_WALLET_DAILY_RATE_PHP = 100;
const COFFEE_WEEKLY_PHP = 180;
const SADAKA_PCT_OF_INCOME = 0.015;

export interface CigaretteCostTranslation {
  amountPhp: number;
  framings: CigaretteFraming[];
}

export interface CigaretteFraming {
  kind: "family_wallet" | "coffee_weeks" | "sadaka_equivalent" | "annual_projection";
  label: string;
  detail?: string;
}

export function translateCigaretteSpend(amountPhp: number): CigaretteCostTranslation {
  const framings: CigaretteFraming[] = [];
  if (amountPhp > 0) {
    const familyDays = amountPhp / FAMILY_WALLET_DAILY_RATE_PHP;
    if (familyDays >= 0.5) {
      framings.push({
        kind: "family_wallet",
        label: `${familyDays.toFixed(familyDays >= 10 ? 0 : 1)} days closer to a family wallet`,
        detail: `₱${FAMILY_WALLET_DAILY_RATE_PHP}/day pace`,
      });
    }
    const coffeeWeeks = amountPhp / COFFEE_WEEKLY_PHP;
    if (coffeeWeeks >= 0.5) {
      framings.push({
        kind: "coffee_weeks",
        label: `${coffeeWeeks.toFixed(coffeeWeeks >= 10 ? 0 : 1)} weeks of coffee`,
        detail: `₱${COFFEE_WEEKLY_PHP}/wk local rate`,
      });
    }
  }
  return { amountPhp, framings };
}

// Annual projection from the last N weeks of cigarette spending.
// Quarterly use: surfaces in /today or a settings card. Returns null when
// there's not enough history.
export function projectAnnualCigaretteSpend(weeklyTotalsPhp: number[]): {
  weeksMeasured: number;
  weeklyAveragePhp: number;
  annualProjectionPhp: number;
  framings: CigaretteFraming[];
} | null {
  if (weeklyTotalsPhp.length < 4) return null;
  const measuredWeeks = weeklyTotalsPhp.length;
  const avg = weeklyTotalsPhp.reduce((s, n) => s + n, 0) / measuredWeeks;
  const annual = avg * 52;
  if (annual <= 0) return null;
  const familyDays = annual / FAMILY_WALLET_DAILY_RATE_PHP;
  const coffeeWeeks = annual / COFFEE_WEEKLY_PHP;
  const sadakaEquivalent = annual * SADAKA_PCT_OF_INCOME * 100;  // % framing not money
  void sadakaEquivalent;
  const framings: CigaretteFraming[] = [
    {
      kind: "annual_projection",
      label: `Projecting ₱${Math.round(annual).toLocaleString()} a year`,
      detail: `${measuredWeeks}-week average ₱${avg.toFixed(0)}/week`,
    },
    {
      kind: "family_wallet",
      label: `That's ${familyDays.toFixed(0)} family-wallet days a year`,
    },
    {
      kind: "coffee_weeks",
      label: `Or ${coffeeWeeks.toFixed(0)} weeks of coffee`,
    },
  ];
  return {
    weeksMeasured: measuredWeeks,
    weeklyAveragePhp: avg,
    annualProjectionPhp: annual,
    framings,
  };
}

// Compute weekly cigarette totals for the trailing N weeks from the spend
// list (already category-filtered by the caller).
export function weeklyCigaretteTotals(spends: Spend[], weeks = 12, now: Date = new Date()): number[] {
  const DAY_MS = 86_400_000;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const dow = today.getDay() || 7;
  const thisMon = new Date(today.getTime() - (dow - 1) * DAY_MS);
  const totals = new Array(weeks).fill(0);
  for (const sp of spends) {
    const d = new Date(sp.spent_at);
    const weeksBack = Math.floor((thisMon.getTime() - d.getTime()) / (7 * DAY_MS));
    if (weeksBack < 0 || weeksBack >= weeks) continue;
    totals[weeks - 1 - weeksBack] += Number(sp.amount_base ?? 0);
  }
  return totals;
}

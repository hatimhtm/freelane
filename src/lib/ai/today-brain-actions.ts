"use server";

// Today-brain regen server actions. These are the client-callable endpoints
// the 5 blocking Today widgets fire on mount when their cached payload is
// PHT-day stale (or absent). Mirrors the getDailyFocus / refreshCalmWeather
// pattern: fetch the inputs, delegate to the brain regen, return an
// ActionResult so the client surfaces a graceful failure when AI is offline.

import { getDashboardData, getTodayMorningLog } from "@/lib/data/queries";
import { safeRunLabeled, type ActionResult } from "@/lib/data/actions";
import { computeTightMode, type TightModeRead } from "./tight-mode-coach";
import { generateEidPrep, type EidPrepRead } from "./eid-prep";
import { generateSadakaRhythm, type SadakaRhythmRead } from "./sadaka-rhythm";
import { generatePostPaydaySurge, type PostPaydaySurgeRead } from "./post-payday-surge";
import { generateSleepSpendEcho, type SleepSpendEcho } from "./sleep-spend-echo";

export async function refreshTightMode(
  opts: { force?: boolean } = {},
): Promise<ActionResult<TightModeRead>> {
  return safeRunLabeled("freelane-ai", "tight-mode.refresh", async () => {
    const data = await getDashboardData();
    return computeTightMode(
      {
        payments: data.payments,
        withdrawals: data.withdrawals,
        spends: data.spends,
        recurring: data.recurring,
        recurringSkips: data.recurringSkips,
        loanInstallments: data.loanInstallments,
        plannedSpends: data.plannedSpends,
        methods: data.methods,
        stepsByPayment: data.stepsByPayment,
        rates: data.rates,
        calmWeather: data.calmWeather,
      },
      { force: opts.force },
    );
  });
}

export async function refreshEidPrep(
  opts: { force?: boolean } = {},
): Promise<ActionResult<EidPrepRead>> {
  return safeRunLabeled("freelane-ai", "eid-prep.refresh", async () => {
    const data = await getDashboardData();
    return generateEidPrep(
      {
        islamic: data.islamicCalendar,
        spends: data.spends,
        spendCategoryLinks: data.spendCategoryLinks,
        plannedSpends: data.plannedSpends,
      },
      { force: opts.force },
    );
  });
}

export async function refreshSadakaRhythm(
  opts: { force?: boolean } = {},
): Promise<ActionResult<SadakaRhythmRead>> {
  return safeRunLabeled("freelane-ai", "sadaka-rhythm.refresh", async () => {
    const data = await getDashboardData();
    return generateSadakaRhythm(
      {
        spends: data.spends,
        payments: data.payments,
        spendCategories: data.spendCategories,
        spendCategoryLinks: data.spendCategoryLinks,
      },
      { force: opts.force },
    );
  });
}

export async function refreshPostPaydaySurge(
  opts: { force?: boolean } = {},
): Promise<ActionResult<PostPaydaySurgeRead>> {
  return safeRunLabeled("freelane-ai", "post-payday.refresh", async () => {
    const data = await getDashboardData();
    return generatePostPaydaySurge(
      {
        payments: data.payments,
        spends: data.spends,
      },
      { force: opts.force },
    );
  });
}

export async function refreshSleepSpendEcho(
  opts: { force?: boolean } = {},
): Promise<ActionResult<SleepSpendEcho>> {
  return safeRunLabeled("freelane-ai", "sleep-echo.refresh", async () => {
    const data = await getDashboardData();
    const morning = await getTodayMorningLog().catch(() => null);
    return generateSleepSpendEcho(
      {
        morning,
        spends: data.spends,
        spendCategories: data.spendCategories,
        spendCategoryLinks: data.spendCategoryLinks,
      },
      { force: opts.force },
    );
  });
}

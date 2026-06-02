import { getDashboardData, getAiSafeSpendCacheRow, getDiaryEntry, getLetters, getMilestones, getTodayMorningLog } from "@/lib/data/queries";
import { outstanding, outstandingTotalBase } from "@/lib/dashboard-calc";
import { holdingBalances } from "@/lib/payment-chain";
import { computeSafeToSpendFromData, suggestSadakaForIncome } from "@/lib/safe-to-spend";
import { hasGemini } from "@/lib/ai/gemini";
import { readFocusCache } from "@/lib/ai/actions";
import { getCalmWeatherCached, refreshCalmWeather } from "@/lib/ai/calm-weather";
import { getTightModeCached } from "@/lib/ai/tight-mode-coach";
import { getSadakaRhythmCached } from "@/lib/ai/sadaka-rhythm";
import { getEidPrepCached } from "@/lib/ai/eid-prep";
import { nextRamadanPeriod, type RamadanPeriod } from "@/lib/islamic-calendar";
import { generateLateNightRead } from "@/lib/ai/late-night-cluster";
import { getPostPaydaySurgeCached } from "@/lib/ai/post-payday-surge";
import { getSleepSpendEchoCached } from "@/lib/ai/sleep-spend-echo";
import { buildYearMemoryRecall, type YearMemoryRecall } from "@/lib/ai/year-memory-recall";
import { promptForWeek, isCheckinDay } from "@/lib/ai/tuesday-checkin";
import { postNotification } from "@/lib/notifications/dispatcher";
import { BASE_CURRENCY_FALLBACK } from "@/lib/constants";
import { phtToday, phtMondayOfWeek } from "@/lib/utils";
import { linksBySpend } from "@/lib/spends";
import { isCigaretteCategoryName } from "@/lib/spending/categories";
import type { CurrencyCode, MorningLog } from "@/lib/supabase/types";
import type { SafeToSpendOverlay } from "@/lib/ai/safe-to-spend-ai";
import type { SafeToSpendBreakdown } from "@/lib/safe-to-spend";
import { TodayView } from "./_components/today-view";

const DAY_MS = 86_400_000;
const SADAKA_FRESH_HOURS = 36;

// First-paint contract: every brain on Today is now cache-first. The page
// loads whatever's already in ai_brain_cache (server-side, no Gemini call),
// hands it to a client widget, and the widget decides at mount whether the
// payload is PHT-day stale. When stale (or absent), it kicks off a refresh
// server action that does the heavy work AFTER first paint. Implementation
// lives in src/components/widgets/today/*-widget.tsx + the per-brain
// withBrainCache wrappers in src/lib/ai/cache.ts.
//
// The previous race-against-a-budget pattern (withFirstPaintBudget) was a
// holdover from before withBrainCache shipped; with the wrapper live every
// brain gets the same async-on-stale behavior without a server-side timer.

export const metadata = { title: "Today" };

export default async function TodayPage() {
  const aiEnabled = hasGemini();
  const [data, focus, cachedOverlayRow] = await Promise.all([
    getDashboardData(),
    aiEnabled ? readFocusCache() : Promise.resolve({ insights: [], generatedAt: null }),
    getAiSafeSpendCacheRow(),
  ]);
  const {
    settings,
    projects,
    payments,
    rates,
    clients,
    currencies,
    methods,
    withdrawals,
    spends,
    spendCategories,
    spendCategoryLinks,
    spendItems,
    recurring,
    recurringSkips,
    loanInstallments,
    stepsByPayment,
    plannedSpends,
    calmWeather: cachedCalmWeather,
    islamicCalendar,
    phCulturalEvents,
    wifeState,
  } = data;

  const currency = (settings?.base_currency ?? BASE_CURRENCY_FALLBACK) as CurrencyCode;
  const now = new Date();
  const todayStr = phtToday();

  // Outstanding total + days-since-oldest.
  const rows = outstanding(projects, payments, clients, rates);
  const pendingTotal = outstandingTotalBase(rows);
  const oldestDays = rows[0]?.daysAged ?? 0;

  // Holdings (defensive).
  let holdings: ReturnType<typeof holdingBalances>;
  try {
    holdings = holdingBalances(methods, payments, stepsByPayment, withdrawals, spends);
  } catch (err) {
    console.error("Today: holdingBalances threw", err);
    holdings = [];
  }

  // Today-spend totals (PHT day).
  const dayStart = new Date(todayStr + "T00:00:00+08:00").getTime();
  const todaySpends = spends.filter((sp) => new Date(sp.spent_at).getTime() >= dayStart);
  const todaySpendBase = todaySpends.reduce((s, sp) => s + Number(sp.amount_base ?? 0), 0);
  const sevenDayCutoff = dayStart - 6 * DAY_MS;
  const last7DaySpendCount = spends.filter((sp) => new Date(sp.spent_at).getTime() >= sevenDayCutoff).length;

  // Income → sadaka pairing.
  const freshCutoff = now.getTime() - SADAKA_FRESH_HOURS * 60 * 60 * 1000;
  const freshPayment = payments.find((p) => {
    const t = new Date(p.paid_at).getTime();
    return t >= freshCutoff && t <= now.getTime() && Number(p.net_amount_base ?? 0) > 0;
  });
  let sadakaSuggestion: { suggestedBase: number; percent: number; reason: string } | null = null;
  let triggeringPayment: { client: string; net: number; paid_at: string } | null = null;
  if (freshPayment) {
    try {
      const netBase = Number(freshPayment.net_amount_base ?? 0);
      const project = projects.find((p) => p.id === freshPayment.project_id);
      const client = project ? clients.find((c) => c.id === project.client_id) : null;
      const s = suggestSadakaForIncome(netBase, {
        payments,
        withdrawals,
        spends,
        recurring,
        recurringSkips,
        loanInstallments,
        methods,
        stepsByPayment,
        rates,
      });
      if (s.suggestedBase > 0) {
        sadakaSuggestion = { suggestedBase: s.suggestedBase, percent: s.percent, reason: s.reason };
        triggeringPayment = {
          client: client?.name ?? "a client",
          net: netBase,
          paid_at: freshPayment.paid_at,
        };
      }
    } catch (err) {
      console.error("Today: suggestSadakaForIncome threw", err);
    }
  }

  const sadakaCategoryId =
    spendCategories.find((c) => /sadaka/i.test(c.name))?.id ?? null;

  const overlay: SafeToSpendOverlay | null = cachedOverlayRow?.insight
    ? (cachedOverlayRow.insight as SafeToSpendOverlay)
    : null;

  // Pipe the full HoldingBalanceRow (balance + tolerance + status) through the
  // spend modal's WalletOpt so the picker / impact dial render the canonical
  // tri-state. Non-holding methods carry no status — they aren't ledgered.
  const holdingByMethod = new Map(holdings.map((h) => [h.methodId, h]));
  const sheetWallets = methods
    .filter((m) => !m.archived)
    .map((m) => {
      const h = holdingByMethod.get(m.id);
      return {
        id: m.id,
        name: m.name,
        is_holding: !!m.is_holding,
        balanceBase: m.is_holding ? h?.balance ?? 0 : undefined,
        overdraftToleranceBase: h?.overdraftToleranceBase,
        status: h?.status,
      };
    });

  let safeToSpendBaseline: SafeToSpendBreakdown;
  try {
    // Single-source-of-truth helper — passes plannedSpends so the headline
    // can never drift between Today / Dashboard / Spending / Plans.
    safeToSpendBaseline = computeSafeToSpendFromData(
      {
        payments,
        withdrawals,
        spends,
        recurring,
        recurringSkips,
        loanInstallments,
        methods,
        stepsByPayment,
        rates,
        plannedSpends,
      },
      now,
    );
  } catch (err) {
    console.error("Today: safeToSpend threw", err);
    safeToSpendBaseline = {
      horizonDays: 30,
      walletBalancesBase: 0,
      trailingIncomeBase: 0,
      trailingSpendBase: 0,
      forwardIncomeProjectionBase: 0,
      recurringForwardBase: 0,
      loanForwardBase: 0,
      feeFloorBase: 0,
      plannedForwardBase: 0,
      committedLockedBase: 0,
      committedPoolBase: 0,
      trailingOverspendBase: 0,
      recoveryDailyTaxBase: 0,
      inRecovery: false,
      discretionaryPoolBase: 0,
      dailyAllowanceBase: 0,
      stabilityScore: 1,
      stabilityMultiplier: 1,
      patternMultiplier: 1,
      colFloorBase: 0,
      safeTodayBase: 0,
      notes: ["safe-to-spend recompute failed — fell back to a calm default."],
      isLearning: true,
      observationDays: 0,
      confidenceTag: "rough",
    };
  }

  // Calm weather: read the cache only — even if stale — so the page can
  // render immediately. If the row is missing or stale, fire a background
  // refresh that the user will see on the next visit (a mutation will also
  // invalidate it through invalidateAiSafeSpendCache). The cachedCalmWeather
  // already came down with getDashboardData and is the canonical fallback.
  const calmWeatherRow = await getCalmWeatherCached().catch(() => null);
  const calmWeather = calmWeatherRow ?? cachedCalmWeather ?? null;
  const calmStale = calmWeather === null || new Date(calmWeather.expires_at).getTime() <= now.getTime();
  if (calmStale) {
    void refreshCalmWeather({ force: false }).catch(() => {});
  }
  const ramadan: RamadanPeriod | null = nextRamadanPeriod(islamicCalendar, now);

  // Pull non-AI DB reads first so the AI fan-out below isn't conflated with
  // a serial morning-log fetch. morningLog feeds sleepEcho's Gemini call —
  // having it ready in advance is what lets every brain race in parallel.
  const morningLog: MorningLog | null = await getTodayMorningLog().catch(() => null);

  // 5 blocking brains → cache-only server reads in parallel. Each one
  // returns a CachedBrainPayload<T> | null (the brain's regen body lives
  // inside withBrainCache and is now driven from the client widgets).
  // yearRecall stays serial-ish for now — it's calendar-driven and not on
  // the hot Gemini path.
  const [
    tightModeCached,
    eidPrepCached,
    sadakaCached,
    postPaydayCached,
    sleepEchoCached,
    yearRecall,
  ] = await Promise.all([
    getTightModeCached().catch(() => null),
    getEidPrepCached().catch(() => null),
    getSadakaRhythmCached().catch(() => null),
    getPostPaydaySurgeCached().catch(() => null),
    getSleepSpendEchoCached().catch(() => null),
    buildYearMemoryRecall().catch(() => null as YearMemoryRecall | null),
  ]);

  // Diary entry for today.
  const diaryEntry = await getDiaryEntry(todayStr).catch(() => null);

  // Recent sleep nights — past 3 from morning_log.
  const recentNights: Array<{ slept: number | null }> = [
    { slept: morningLog?.slept_hours != null ? Number(morningLog.slept_hours) : null },
    { slept: null },
    { slept: null },
  ];

  // Cigarettes today + baseline.
  const linkIndex = linksBySpend(spendCategoryLinks);
  // Canonical cigarette-category detector — same helper used by pack-rhythm
  // so Today and Dashboard never split the same data into different category
  // sets.
  const cigCategoryIds = new Set(
    spendCategories.filter((c) => isCigaretteCategoryName(c.name)).map((c) => c.id),
  );
  const isCigSpend = (spendId: string): boolean => {
    const links = linkIndex.get(spendId) ?? [];
    return links.some((l) => cigCategoryIds.has(l));
  };
  const cigTodayCount = todaySpends.filter((s) => isCigSpend(s.id)).length;
  const thirtyAgo = now.getTime() - 30 * DAY_MS;
  const cigTrailing = spends.filter((s) => {
    if (!isCigSpend(s.id)) return false;
    const t = new Date(s.spent_at).getTime();
    return t >= thirtyAgo;
  });
  const cigBaselineDaily = cigTrailing.length / 30;

  // Letters + milestones for editorial cluster.
  let lettersList: Awaited<ReturnType<typeof getLetters>> = [];
  let milestonesList: Awaited<ReturnType<typeof getMilestones>> = [];
  try {
    [lettersList, milestonesList] = await Promise.all([getLetters(8), getMilestones(20)]);
  } catch (err) {
    console.error("Today: getLetters/getMilestones threw", err);
  }
  const latestLetter = lettersList.find((l) => l.pinned) ?? lettersList[0] ?? null;
  const freshMilestones = milestonesList.filter((m) => m.surfaced).slice(0, 4);

  // T06 — dispatch Tuesday check-in as a notification on Tuesday mornings.
  // Fire-and-forget: notification dispatch is purely best-effort and must
  // never delay first paint. The dedupKey makes a duplicate dispatch silent.
  if (isCheckinDay(now)) {
    void (async () => {
      try {
        // PHT-correct Monday-of-week dedup key (single canonical helper). The
        // pre-fix `new Date(todayStr)` parses as UTC midnight then getDay()
        // reads local TZ — coincidentally correct on Vercel UTC, wrong on a
        // PHT host. Using phtMondayOfWeek makes the boundary deterministic.
        const weekKey = phtMondayOfWeek(now);
        const prompt = await promptForWeek();
        await postNotification({
          kind: "tuesday_checkin",
          subject: prompt,
          body: "A line, two numbers. The echo lands after you save.",
          linkUrl: "/notifications?open=tuesday",
          dedupKey: `tuesday_checkin:${weekKey}`,
          priority: 1,
        });
      } catch {
        // Notification dispatch is best-effort.
      }
    })();
  }

  // Late-night cluster: cache-warming side-effect for the Dashboard remark.
  // FIRE-AND-FORGET so a 3s Gemini call doesn't stretch Today's TTFB. The
  // Dashboard reads the cache when it renders; a cold-start render there
  // will trigger its own regen if the warm hasn't completed yet.
  void generateLateNightRead({ spends, now }).catch(() => {});

  return (
    <TodayView
      firstName={settings?.issuer_name?.split(" ")[0] ?? null}
      currency={currency}
      hasClients={clients.length > 0}
      year={new Date().getFullYear()}
      outstandingTotal={pendingTotal}
      oldestDays={oldestDays}
      todaySpendBase={todaySpendBase}
      last7DaySpendCount={last7DaySpendCount}
      safeToSpendBaseline={safeToSpendBaseline}
      overlay={overlay}
      recentNights={recentNights}
      cigarettesTodayCount={cigTodayCount}
      cigarettesBaselineDailyCount={cigBaselineDaily}
      diaryEntry={diaryEntry}
      diaryEntryDate={todayStr}
      focusInsights={focus.insights}
      focusGeneratedAt={focus.generatedAt}
      aiEnabled={aiEnabled}
      holdings={holdings}
      calmWeather={calmWeather}
      tightMode={tightModeCached?.payload ?? null}
      tightModeGeneratedAt={tightModeCached?.generatedAt ?? null}
      ramadan={ramadan}
      islamicCalendar={islamicCalendar}
      phCulturalEvents={phCulturalEvents}
      eidPrep={eidPrepCached?.payload ?? null}
      eidPrepGeneratedAt={eidPrepCached?.generatedAt ?? null}
      sadaka={sadakaCached?.payload ?? null}
      sadakaGeneratedAt={sadakaCached?.generatedAt ?? null}
      postPayday={postPaydayCached?.payload ?? null}
      postPaydayGeneratedAt={postPaydayCached?.generatedAt ?? null}
      sleepEcho={sleepEchoCached?.payload ?? null}
      sleepEchoGeneratedAt={sleepEchoCached?.generatedAt ?? null}
      wifeState={wifeState}
      yearRecall={yearRecall}
      latestLetter={latestLetter}
      freshMilestones={freshMilestones}
      sadakaSuggestion={sadakaSuggestion}
      triggeringPayment={triggeringPayment}
      sadakaCategoryId={sadakaCategoryId}
      rates={rates}
      spendCategories={spendCategories}
      spendCategoryLinks={spendCategoryLinks}
      spendItems={spendItems}
      spends={spends}
      sheetWallets={sheetWallets}
      currencies={currencies.map((c) => c.code)}
    />
  );
}

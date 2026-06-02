"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { msUntilNextPhtMidnight } from "@/lib/utils";

import { CalmWeatherBanner } from "@/components/app/calm-weather-banner";
import { CulturalOverlay } from "@/components/app/cultural-overlay";
import { FreshMilestonesCard } from "@/components/app/fresh-milestones-card";
import { IncomeSadakaSuggestion } from "@/components/app/income-sadaka-suggestion";
import { LatestLetterCard } from "@/components/app/latest-letter-card";
import { NegativeWalletAlarm } from "@/components/app/negative-wallet-alarm";
import { RamadanModeBanner } from "@/components/app/ramadan-mode-banner";
import { YearMemoryRecallCard } from "@/components/app/year-memory-recall-card";

import { CigarettesWidget } from "@/components/widgets/today/cigarettes-widget";
import { DiaryWidget } from "@/components/widgets/today/diary-widget";
import { EidPrepWidget } from "@/components/widgets/today/eid-prep-widget";
import { OutstandingWidget } from "@/components/widgets/today/outstanding-widget";
import { PostPaydaySurgeWidget } from "@/components/widgets/today/post-payday-surge-widget";
import { SadakaRhythmWidget } from "@/components/widgets/today/sadaka-rhythm-widget";
import { SadakaPoolTodayWidget } from "@/components/widgets/today/sadaka-pool-today-widget";
import { SafeToSpendWidget } from "@/components/widgets/today/safe-to-spend-widget";
import { SleepSpendEchoWidget } from "@/components/widgets/today/sleep-spend-echo-widget";
import { TightModeWidget } from "@/components/widgets/today/tight-mode-widget";
import { TodaySpendWidget } from "@/components/widgets/today/today-spend-widget";
import { TodaysFocusWidget } from "@/components/widgets/today/todays-focus-widget";

import {
  SpendModal,
  type SpendModalDefaults,
  type WalletOpt,
} from "@/app/(app)/spending/_components/spend-modal";

import type {
  CalmWeatherState,
  CurrencyCode,
  EditorialLetter,
  ExchangeRate,
  IslamicCalendarRow,
  Milestone,
  PhCulturalEventRow,
  Spend,
  SpendCategory,
  SpendCategoryLink,
  SpendItem,
  WifeState,
} from "@/lib/supabase/types";
import type { MoneyInsight } from "@/lib/ai/actions";
import type { SafeToSpendOverlay } from "@/lib/ai/safe-to-spend-ai";
import type { TightModeRead } from "@/lib/ai/tight-mode-coach";
import type { RamadanPeriod } from "@/lib/islamic-calendar";
import type { EidPrepRead } from "@/lib/ai/eid-prep";
import type { SadakaRhythmRead } from "@/lib/ai/sadaka-rhythm";
import type { PostPaydaySurgeRead } from "@/lib/ai/post-payday-surge";
import type { SleepSpendEcho } from "@/lib/ai/sleep-spend-echo";
import type { YearMemoryRecall } from "@/lib/ai/year-memory-recall";
import type { SafeToSpendBreakdown } from "@/lib/safe-to-spend";
import type { HoldingBalanceRow } from "@/lib/payment-chain";
import type { DiaryEntryRow } from "@/lib/data/actions";

type TodayViewProps = {
  firstName: string | null;
  currency: CurrencyCode;
  hasClients: boolean;
  year: number;

  // Glance numbers.
  outstandingTotal: number;
  oldestDays: number;
  todaySpendBase: number;
  last7DaySpendCount: number;

  // Widget data.
  safeToSpendBaseline: SafeToSpendBreakdown;
  // BUG FIX #2 (LIVE DAILY SAFE) — PHT-anchored snapshot + live
  // remaining piped from the page loader. Optional so legacy props
  // shape still type-checks if the page hasn't migrated yet.
  initialSafeForToday?: number;
  liveSafeRemaining?: number;
  overlay: SafeToSpendOverlay | null;
  recentNights: Array<{ slept: number | null }>;
  cigarettesTodayCount: number;
  cigarettesBaselineDailyCount: number;
  diaryEntry: DiaryEntryRow | null;
  diaryEntryDate: string;

  focusInsights: MoneyInsight[];
  focusGeneratedAt: string | null;
  aiEnabled: boolean;

  // Contextual band data. The 5 brains below are CACHE-FIRST: payload is the
  // cached row (possibly stale), generatedAt drives the widget's PHT-day
  // staleness check, and each widget fires its own refresh server action
  // after first paint when needed.
  holdings: HoldingBalanceRow[];
  calmWeather: CalmWeatherState | null;
  tightMode: TightModeRead | null;
  tightModeGeneratedAt: string | null;
  ramadan: RamadanPeriod | null;
  islamicCalendar: IslamicCalendarRow[];
  phCulturalEvents: PhCulturalEventRow[];
  eidPrep: EidPrepRead | null;
  eidPrepGeneratedAt: string | null;
  sadaka: SadakaRhythmRead | null;
  sadakaGeneratedAt: string | null;
  postPayday: PostPaydaySurgeRead | null;
  postPaydayGeneratedAt: string | null;
  sleepEcho: SleepSpendEcho | null;
  sleepEchoGeneratedAt: string | null;
  wifeState: WifeState | null;
  yearRecall: YearMemoryRecall | null;
  latestLetter: EditorialLetter | null;
  freshMilestones: Milestone[];

  sadakaSuggestion: { suggestedBase: number; percent: number; reason: string } | null;
  triggeringPayment: { client: string; net: number; paid_at: string } | null;
  sadakaCategoryId: string | null;
  // Phase 2 sadaka pool — independent of the on-income suggestion. The
  // SadakaPoolTodayWidget renders only when surfaceToday=true AND the
  // suggested amount > 0; otherwise the renderMoneyRhythmCard pipe falls
  // through to the next signal.
  sadakaPoolBase: number;
  sadakaSuggestedToday: number;
  sadakaSuggestedReasoning: string;
  sadakaSurfaceToday: boolean;

  // Spend modal plumbing — kept so ⌘K / ⌘L can open it.
  rates: ExchangeRate[];
  spendCategories: SpendCategory[];
  spendCategoryLinks: SpendCategoryLink[];
  spendItems: SpendItem[];
  spends: Spend[];
  sheetWallets: WalletOpt[];
  currencies: string[];
};

export function TodayView(props: TodayViewProps) {
  const {
    currency,
    outstandingTotal,
    oldestDays,
    todaySpendBase,
    last7DaySpendCount,
    safeToSpendBaseline,
    initialSafeForToday,
    liveSafeRemaining,
    overlay,
    recentNights,
    sleepEcho,
    sleepEchoGeneratedAt,
    cigarettesTodayCount,
    cigarettesBaselineDailyCount,
    diaryEntry,
    diaryEntryDate,
    focusInsights,
    focusGeneratedAt,
    aiEnabled,
    holdings,
    calmWeather,
    tightMode,
    tightModeGeneratedAt,
    ramadan,
    islamicCalendar,
    phCulturalEvents,
    eidPrep,
    eidPrepGeneratedAt,
    sadaka,
    sadakaGeneratedAt,
    postPayday,
    postPaydayGeneratedAt,
    yearRecall,
    latestLetter,
    freshMilestones,
    sadakaSuggestion,
    triggeringPayment,
    sadakaCategoryId,
    sadakaPoolBase,
    sadakaSuggestedToday,
    sadakaSuggestedReasoning,
    sadakaSurfaceToday,
    rates,
    spendCategories,
    spendCategoryLinks,
    spendItems,
    spends,
    sheetWallets,
    currencies,
  } = props;

  const router = useRouter();

  // Spend modal — opened via ⌘K Quick Action or any chip dispatching the event.
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetDefaults, setSheetDefaults] = useState<SpendModalDefaults | undefined>(undefined);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent).detail as SpendModalDefaults | undefined;
      setSheetDefaults(detail);
      setSheetOpen(true);
    };
    window.addEventListener("freelane:open-spend-sheet", onOpen);
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "l") {
        e.preventDefault();
        setSheetDefaults(undefined);
        setSheetOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("freelane:open-spend-sheet", onOpen);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  // PHT midnight rollover — when the user keeps /today open across PHT
  // midnight, the snapshot/initialForToday transition would otherwise wait
  // until they manually navigate. Schedule a router.refresh() at exactly
  // the next PHT-midnight so yesterday's hero number doesn't linger.
  // After the refresh, re-schedule for the following day. Cleared on
  // unmount so navigation away cancels the pending timer.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    function schedule() {
      const delay = msUntilNextPhtMidnight();
      timer = setTimeout(() => {
        router.refresh();
        schedule();
      }, delay);
    }
    schedule();
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [router]);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-6 md:px-6">
      {/* Escalated alerts only — Calm Weather banner self-hides on calm. */}
      <CalmWeatherBanner state={calmWeather} variant="today" />
      <NegativeWalletAlarm holdings={holdings} />

      {/* Starter pills moved into the chatbot modal (chatbot-pills-bar) —
          single source of conversation-openers per page, lazy on modal
          open. See freelane-chatbot-design memory. */}

      {/* TOP GLANCE ROW — Safe-to-Spend top-left, Outstanding + Focus next.
          4-column grid on md so the M (col-span-2) + 2 S widgets read as one
          balanced hero row. Mobile collapses to 2-cols (M spans 2, S widgets
          stack underneath). */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="col-span-2 md:col-span-2">
          <SafeToSpendWidget
            baseline={safeToSpendBaseline}
            overlay={overlay}
            currency={currency}
            liveRemaining={liveSafeRemaining}
            initialForToday={initialSafeForToday}
          />
        </div>
        <OutstandingWidget
          totalBase={outstandingTotal}
          oldestDays={oldestDays}
          currency={currency}
        />
        <TodaysFocusWidget
          initial={focusInsights}
          generatedAt={focusGeneratedAt}
          aiEnabled={aiEnabled}
        />
      </section>

      {/* Noise floor — S widgets for the less-urgent today data. Explicit
          3-col grid on md so each S box stays at its locked ~160 sq size
          (instead of stretching wider when the row has fewer children than
          the parent 4-col grid expects). */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <TodaySpendWidget
          todayBase={todaySpendBase}
          last7DayCount={last7DaySpendCount}
          currency={currency}
        />
        <SleepSpendEchoWidget
          initial={sleepEcho}
          generatedAt={sleepEchoGeneratedAt}
          aiEnabled={aiEnabled}
          recentNights={recentNights}
        />
        <CigarettesWidget
          todayCount={cigarettesTodayCount}
          baselineDailyCount={cigarettesBaselineDailyCount}
        />
      </section>

      {/* MIDDLE — diary M widget. */}
      <section>
        <DiaryWidget existing={diaryEntry} entryDate={diaryEntryDate} />
      </section>

      {/* CONTEXTUAL BAND — modular-relevance-gated, AND capped at 3 cards so
          Today never turns into a vertical newsfeed on rich-signal days.
          One pick per category: money-rhythm (TightMode > Sadaka suggestion >
          PostPayday > SadakaRhythm), cultural (Ramadan > first Eid > Cultural
          overlay), editorial (Year-Memory > Letter > Milestones — only one
          shows). Each card still hides on no signal. */}
      <section className="space-y-3">
        {renderMoneyRhythmCard({
          sadakaSuggestion,
          triggeringPayment,
          sadakaCategoryId,
          sadakaPoolBase,
          sadakaSuggestedToday,
          sadakaSuggestedReasoning,
          sadakaSurfaceToday,
          tightMode,
          tightModeGeneratedAt,
          postPayday,
          postPaydayGeneratedAt,
          sadaka,
          sadakaGeneratedAt,
          aiEnabled,
          currency,
        })}
        {renderCulturalCard({
          ramadan,
          eidPrep,
          eidPrepGeneratedAt,
          aiEnabled,
          islamicCalendar,
          phCulturalEvents,
          currency,
        })}
        {renderEditorialCard({
          yearRecall,
          latestLetter,
          freshMilestones,
        })}
      </section>

      <SpendModal
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        wallets={sheetWallets}
        categories={spendCategories}
        currencies={currencies}
        baseCurrency={currency}
        rates={rates.map((r) => ({ code: r.code, rate_to_base: Number(r.rate_to_base) }))}
        recentSpends={spends}
        spendCategoryLinks={spendCategoryLinks}
        spendItems={spendItems}
        safeToSpendBaseline={safeToSpendBaseline}
        defaults={sheetDefaults}
      />
    </div>
  );
}

// One pick per category — Today contextual band cap (≤ 3 cards). Each
// renderer self-hides if no signal is present.

function renderMoneyRhythmCard(args: {
  sadakaSuggestion: TodayViewProps["sadakaSuggestion"];
  triggeringPayment: TodayViewProps["triggeringPayment"];
  sadakaCategoryId: TodayViewProps["sadakaCategoryId"];
  sadakaPoolBase: TodayViewProps["sadakaPoolBase"];
  sadakaSuggestedToday: TodayViewProps["sadakaSuggestedToday"];
  sadakaSuggestedReasoning: TodayViewProps["sadakaSuggestedReasoning"];
  sadakaSurfaceToday: TodayViewProps["sadakaSurfaceToday"];
  tightMode: TodayViewProps["tightMode"];
  tightModeGeneratedAt: TodayViewProps["tightModeGeneratedAt"];
  postPayday: TodayViewProps["postPayday"];
  postPaydayGeneratedAt: TodayViewProps["postPaydayGeneratedAt"];
  sadaka: TodayViewProps["sadaka"];
  sadakaGeneratedAt: TodayViewProps["sadakaGeneratedAt"];
  aiEnabled: boolean;
  currency: CurrencyCode;
}) {
  const {
    sadakaSuggestion,
    triggeringPayment,
    sadakaCategoryId,
    sadakaPoolBase,
    sadakaSuggestedToday,
    sadakaSuggestedReasoning,
    sadakaSurfaceToday,
    tightMode,
    tightModeGeneratedAt,
    postPayday,
    postPaydayGeneratedAt,
    sadaka,
    sadakaGeneratedAt,
    aiEnabled,
    currency,
  } = args;
  // Priority order (each renderer self-hides when no signal):
  //   1. fresh sadaka income event (most time-sensitive)
  //   2. standing sadaka-pool prompt (relevance-gated by the brain)
  //   3. tight-mode (storm/gust)
  //   4. post-payday surge
  //   5. standing sadaka rhythm read
  // Trade-off note: the pool prompt outranks tight-mode by design — the
  // pool reflects an obligation the user committed to, while tight-mode
  // is a transient liquidity pill that the rest of the page already
  // covers. Revisit if user testing shows the storm pill should win.
  // Each rhythm widget is cache-first + async-regen so first paint never
  // blocks on a Gemini call.
  if (sadakaSuggestion && triggeringPayment && sadakaCategoryId) {
    return (
      <IncomeSadakaSuggestion
        suggestion={sadakaSuggestion}
        triggeringPayment={triggeringPayment}
        sadakaCategoryId={sadakaCategoryId}
      />
    );
  }
  // Sadaka pool today card — relevance-gated by the brain's surface_today
  // boolean AND a non-zero suggested amount. Sits ABOVE tight-mode so the
  // standing pool prompt isn't shadowed by a transient storm pill.
  if (sadakaSurfaceToday && sadakaSuggestedToday > 0) {
    return (
      <SadakaPoolTodayWidget
        poolBase={sadakaPoolBase}
        suggestedAmount={sadakaSuggestedToday}
        currency={currency}
        reasoning={sadakaSuggestedReasoning}
      />
    );
  }
  // TightMode card is allowed to render its own first-paint copy even when
  // the cached payload is missing — the widget will fetch + populate on
  // mount. Pass aiEnabled so the widget can decide whether to fire the
  // regen at all.
  if (tightMode && tightMode.active) {
    return (
      <TightModeWidget
        initial={tightMode}
        generatedAt={tightModeGeneratedAt}
        aiEnabled={aiEnabled}
        baseCurrency={currency}
      />
    );
  }
  if (postPayday && postPayday.surface) {
    return (
      <PostPaydaySurgeWidget
        initial={postPayday}
        generatedAt={postPaydayGeneratedAt}
        aiEnabled={aiEnabled}
      />
    );
  }
  if (sadaka && sadaka.givenCount > 0) {
    return (
      <SadakaRhythmWidget
        initial={sadaka}
        generatedAt={sadakaGeneratedAt}
        aiEnabled={aiEnabled}
        baseCurrency={currency}
      />
    );
  }
  return null;
}

function renderCulturalCard(args: {
  ramadan: TodayViewProps["ramadan"];
  eidPrep: TodayViewProps["eidPrep"];
  eidPrepGeneratedAt: TodayViewProps["eidPrepGeneratedAt"];
  aiEnabled: boolean;
  islamicCalendar: TodayViewProps["islamicCalendar"];
  phCulturalEvents: TodayViewProps["phCulturalEvents"];
  currency: CurrencyCode;
}) {
  const { ramadan, eidPrep, eidPrepGeneratedAt, aiEnabled, islamicCalendar, phCulturalEvents, currency } = args;
  if (ramadan) return <RamadanModeBanner period={ramadan} />;
  const firstEid = eidPrep?.windows?.[0];
  if (firstEid) {
    return (
      <EidPrepWidget
        initial={eidPrep ?? null}
        generatedAt={eidPrepGeneratedAt}
        aiEnabled={aiEnabled}
        baseCurrency={currency}
      />
    );
  }
  // CulturalOverlay self-hides if nothing relevant is upcoming.
  return <CulturalOverlay islamic={islamicCalendar} phCultural={phCulturalEvents} />;
}

function renderEditorialCard(args: {
  yearRecall: TodayViewProps["yearRecall"];
  latestLetter: TodayViewProps["latestLetter"];
  freshMilestones: TodayViewProps["freshMilestones"];
}) {
  const { yearRecall, latestLetter, freshMilestones } = args;
  if (yearRecall) return <YearMemoryRecallCard recall={yearRecall} />;
  if (latestLetter) return <LatestLetterCard letter={latestLetter} />;
  if (freshMilestones.length > 0) return <FreshMilestonesCard milestones={freshMilestones} />;
  return null;
}

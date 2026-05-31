import { getDashboardData, getAiSafeSpendCacheRow } from "@/lib/data/queries";
import {
  cashflowMetrics,
  outstanding,
  outstandingTotalBase,
  topClients,
  dailySeries,
} from "@/lib/dashboard-calc";
import { monthlyFeeBase } from "@/lib/payment-chain";
import { holdingBalances } from "@/lib/payment-chain";
import { safeToSpend, suggestSadakaForIncome } from "@/lib/safe-to-spend";
import { hasGemini } from "@/lib/ai/gemini";
import { readFocusCache } from "@/lib/ai/actions";
import { getCalmWeather } from "@/lib/ai/calm-weather";
import { computeTightMode, type TightModeRead } from "@/lib/ai/tight-mode-coach";
import { generateForecastStory, type ForecastStory } from "@/lib/ai/forecast-storyteller";
import { generateSadakaRhythm, type SadakaRhythmRead } from "@/lib/ai/sadaka-rhythm";
import { generateEidPrep, type EidPrepRead } from "@/lib/ai/eid-prep";
import { nextRamadanPeriod, type RamadanPeriod } from "@/lib/islamic-calendar";
import { BASE_CURRENCY_FALLBACK } from "@/lib/constants";
import type { CurrencyCode } from "@/lib/supabase/types";
import type { BlockedRow } from "@/components/app/blocked-money-list";
import type { SafeToSpendOverlay } from "@/lib/ai/safe-to-spend-ai";
import { TodayView } from "./_components/today-view";

const DAY_MS = 86_400_000;
// Income → sadaka window: a payment that landed within this many hours counts
// as "fresh" enough to surface the suggestion card on Today. Past that, the
// moment has passed and the card disappears until the next landing.
const SADAKA_FRESH_HOURS = 36;

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
    openAiQuestions,
    plannedSpends,
    calmWeather: cachedCalmWeather,
    islamicCalendar,
    phCulturalEvents,
    wifeState,
  } = data;

  const currency = (settings?.base_currency ?? BASE_CURRENCY_FALLBACK) as CurrencyCode;
  const recurringFee = methods.reduce((s, m) => s + monthlyFeeBase(m, rates), 0);

  const metrics = cashflowMetrics(payments, new Date(), recurringFee, withdrawals);
  const rows = outstanding(projects, payments, clients, rates);
  const pendingTotal = outstandingTotalBase(rows);
  const series = dailySeries(payments, 30);

  const blocked: BlockedRow[] = rows.map((r) => ({
    projectId: r.project.id,
    projectTitle: r.project.title,
    clientName: r.client?.name ?? "—",
    outstandingNative: r.outstandingNative,
    currency: r.project.currency as CurrencyCode,
    outstandingBase: r.outstandingBase,
    daysAged: r.daysAged,
    status: r.project.status === "partially_paid" ? "partially_paid" : "unpaid",
    flagged: r.project.flagged_overdue,
  }));

  const debtById = new Map<string, { name: string; total: number }>();
  for (const r of rows) {
    const name = r.client?.name ?? "Unknown";
    const e = debtById.get(r.project.client_id) ?? { name, total: 0 };
    e.total += r.outstandingBase;
    debtById.set(r.project.client_id, e);
  }
  const biggestDebtor = Array.from(debtById.values()).sort((a, b) => b.total - a.total)[0] ?? null;

  const lags = projects
    .filter((p) => p.quoted_at && p.status === "paid")
    .map((p) => {
      const first = payments
        .filter((pay) => pay.project_id === p.id)
        .map((pay) => new Date(pay.paid_at).getTime())
        .sort((a, b) => a - b)[0];
      if (!first) return null;
      return Math.max(0, (first - new Date(p.quoted_at!).getTime()) / DAY_MS);
    })
    .filter((n): n is number => n !== null);
  const avgDaysToPayment = lags.length ? lags.reduce((a, b) => a + b, 0) / lags.length : null;

  const recent = payments.slice(0, 5).map((p) => {
    const project = projects.find((pr) => pr.id === p.project_id);
    const client = project ? clients.find((c) => c.id === project.client_id) : null;
    return {
      id: p.id,
      net: Number(p.net_amount_base ?? 0),
      paidAt: p.paid_at,
      projectTitle: project?.title ?? "—",
      clientName: client?.name ?? "—",
    };
  });

  const oldest = rows[0] ?? null;
  let situation: string;
  if (clients.length === 0) {
    situation = "No clients yet. Add the first one and Freelane starts keeping score.";
  } else if (oldest) {
    const who = oldest.client?.name ?? "A client";
    const others = rows.length - 1;
    situation =
      `${who} owes the most right now` +
      (oldest.daysAged > 0 ? ` — waiting ${oldest.daysAged} ${oldest.daysAged === 1 ? "day" : "days"}` : "") +
      (others > 0 ? `, with ${others} other ${others === 1 ? "project" : "projects"} still open.` : ".");
  } else {
    situation = "Nothing's waiting on you. Every project is settled.";
  }

  // ── Phase 1.5 surfaces ──

  // Wallet balances (holding wallets only) — feeds NegativeWalletAlarm + Runway.
  // Defensive: a single malformed row (e.g. an orphan withdrawal with a stale
  // method_id) shouldn't take the whole Today page down on a revalidate.
  let holdings: ReturnType<typeof holdingBalances>;
  try {
    holdings = holdingBalances(methods, payments, stepsByPayment, withdrawals, spends);
  } catch (err) {
    console.error("Today: holdingBalances threw", err);
    holdings = [];
  }

  // Trailing 30d spend per wallet → daily burn used by WalletRunwayCard.
  const now = new Date();
  const burnStart = now.getTime() - 30 * DAY_MS;
  const burnSumByWallet = new Map<string, number>();
  for (const s of spends) {
    const t = new Date(s.spent_at).getTime();
    if (t < burnStart || t > now.getTime()) continue;
    burnSumByWallet.set(
      s.wallet_id,
      (burnSumByWallet.get(s.wallet_id) ?? 0) + Number(s.amount_base ?? 0),
    );
  }
  const dailyBurnByWallet: Array<[string, number]> = Array.from(burnSumByWallet.entries()).map(
    ([k, v]) => [k, v / 30],
  );

  // Income → sadaka pairing. We look for the most recent landed payment inside
  // the freshness window; if there is one, derive the suggestion locally so the
  // card works without depending on the AI cache being populated.
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

  // Sadaka category id — the quick-log button + suggestion both target it.
  const sadakaCategoryId =
    spendCategories.find((c) => /sadaka/i.test(c.name))?.id ?? null;

  // Safe-to-spend AI overlay: read whatever's in the cache. If empty, pass
  // null and let MorningBriefHero show its calm "still learning" state.
  const overlay: SafeToSpendOverlay | null = cachedOverlayRow?.insight
    ? (cachedOverlayRow.insight as SafeToSpendOverlay)
    : null;

  // SpendSheet props — Today renders its own sheet so the Sadaka quick-log +
  // suggestion buttons can open it without routing away.
  const balanceByMethod = new Map(holdings.map((h) => [h.methodId, h.balance]));
  const sheetWallets = methods
    .filter((m) => !m.archived)
    .map((m) => ({
      id: m.id,
      name: m.name,
      is_holding: !!m.is_holding,
      balanceBase: m.is_holding ? balanceByMethod.get(m.id) ?? 0 : undefined,
    }));
  // safeToSpend is pure math, but it consumes every ledger collection — a
  // single bad input row (e.g. NaN amount_base from a half-migrated spend)
  // would crash the whole Today render on revalidate. Catch and fall back to
  // a "learning" baseline so the UI can still render. The cached overlay
  // (above) handles the headline number; this baseline is the spend-sheet's
  // post-spend projection.
  let safeToSpendBaseline: ReturnType<typeof safeToSpend>;
  try {
    safeToSpendBaseline = safeToSpend({
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
    };
  }

  // ── Tier 1 layer: Calm Weather + Tight Mode + Forecast ──
  // Calm Weather regenerates on read when stale. Tight Mode + Forecast read
  // straight off the snapshot. All three are best-effort — a failure on any
  // doesn't break the page.
  const calmWeather = await getCalmWeather().catch(() => cachedCalmWeather ?? null);

  let tightMode: TightModeRead | null = null;
  if (calmWeather && (calmWeather.band === "storm" || calmWeather.band === "gust")) {
    try {
      tightMode = await computeTightMode({
        payments,
        withdrawals,
        spends,
        recurring,
        recurringSkips,
        loanInstallments,
        plannedSpends,
        methods,
        stepsByPayment,
        rates,
        calmWeather,
        now,
      });
    } catch (err) {
      console.error("Today: computeTightMode threw", err);
    }
  }

  let forecastStory: ForecastStory | null = null;
  if (aiEnabled) {
    try {
      forecastStory = await generateForecastStory({
        payments,
        withdrawals,
        spends,
        recurring,
        recurringSkips,
        loanInstallments,
        plannedSpends,
        methods,
        stepsByPayment,
        rates,
        now,
      });
    } catch (err) {
      console.error("Today: generateForecastStory threw", err);
    }
  }

  // Tier 2 surfaces — Cultural overlay + Eid Prep + Ramadan + Sadaka Rhythm.
  // All best-effort; failure on one doesn't break the page.
  const ramadan: RamadanPeriod | null = nextRamadanPeriod(islamicCalendar, now);
  let eidPrep: EidPrepRead | null = null;
  let sadaka: SadakaRhythmRead | null = null;
  try {
    eidPrep = await generateEidPrep({
      islamic: islamicCalendar,
      spends,
      spendCategoryLinks,
      plannedSpends,
      now,
    });
  } catch (err) {
    console.error("Today: generateEidPrep threw", err);
  }
  try {
    sadaka = await generateSadakaRhythm({
      spends,
      payments,
      spendCategories,
      spendCategoryLinks,
      now,
    });
  } catch (err) {
    console.error("Today: generateSadakaRhythm threw", err);
  }

  return (
    <TodayView
      firstName={settings?.issuer_name?.split(" ")[0] ?? null}
      currency={currency}
      hasClients={clients.length > 0}
      metrics={metrics}
      series={series}
      pendingTotal={pendingTotal}
      pendingCount={rows.length}
      biggestDebtor={biggestDebtor}
      avgDaysToPayment={avgDaysToPayment}
      blocked={blocked}
      topClients={topClients(payments, projects, clients, 5)}
      recent={recent}
      situation={situation}
      year={new Date().getFullYear()}
      aiEnabled={aiEnabled}
      focusInsights={focus.insights}
      focusGeneratedAt={focus.generatedAt}
      overlay={overlay}
      holdings={holdings}
      dailyBurnByWalletEntries={dailyBurnByWallet}
      sadakaSuggestion={sadakaSuggestion}
      triggeringPayment={triggeringPayment}
      sadakaCategoryId={sadakaCategoryId}
      openAiQuestions={openAiQuestions}
      recurring={recurring}
      recurringSkips={recurringSkips}
      rates={rates}
      spendCategories={spendCategories}
      spendCategoryLinks={spendCategoryLinks}
      spendItems={spendItems}
      spends={spends}
      sheetWallets={sheetWallets}
      currencies={currencies.map((c) => c.code)}
      safeToSpendBaseline={safeToSpendBaseline}
      calmWeather={calmWeather}
      tightMode={tightMode}
      forecastStory={forecastStory}
      islamicCalendar={islamicCalendar}
      phCulturalEvents={phCulturalEvents}
      ramadan={ramadan}
      eidPrep={eidPrep}
      sadaka={sadaka}
      wifeState={wifeState}
    />
  );
}

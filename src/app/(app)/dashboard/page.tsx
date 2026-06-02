import { getDashboardData } from "@/lib/data/queries";
import {
  cashflowMetrics,
  outstanding,
  outstandingTotalBase,
  dailySeries,
  landedInRange,
} from "@/lib/dashboard-calc";
import { monthlyFeeBase, holdingBalances } from "@/lib/payment-chain";
import { phtMondayOfWeek } from "@/lib/utils";
import { computeSafeToSpendFromData } from "@/lib/safe-to-spend";
import { anchorDate, periodKey, expectedBase } from "@/lib/recurring";
import { buildCashflowAtlas } from "@/lib/cashflow-atlas";
import { getCalmWeatherCached, refreshCalmWeather } from "@/lib/ai/calm-weather";
import { generateForecastStory, type ForecastStory } from "@/lib/ai/forecast-storyteller";
import { generatePackRhythm } from "@/lib/ai/pack-rhythm";
import { generateLateNightRead } from "@/lib/ai/late-night-cluster";
import { hasGemini } from "@/lib/ai/gemini";
import { BASE_CURRENCY_FALLBACK } from "@/lib/constants";
import type { CurrencyCode, Spend } from "@/lib/supabase/types";
import { DashboardView, type AlertRow } from "./_components/dashboard-view";

const DAY_MS = 86_400_000;
const RECURRING_HORIZON_DAYS = 5;
const ALERT_LIMIT = 6;

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const {
    settings,
    projects,
    payments,
    rates,
    clients,
    methods,
    stepsByPayment,
    withdrawals,
    spends,
    spendCategories,
    spendCategoryLinks,
    recurring,
    recurringSkips,
    loanInstallments,
    openAiQuestions,
    plannedSpends,
    calmWeather: cachedCalmWeather,
  } = await getDashboardData();

  const currency = (settings?.base_currency ?? BASE_CURRENCY_FALLBACK) as CurrencyCode;
  const now = new Date();
  const recurringFee = methods.reduce((s, m) => s + monthlyFeeBase(m, rates), 0);

  // Headline cashflow — month-to-date landed, spent, fees.
  const metrics = cashflowMetrics(payments, now, recurringFee, withdrawals, spends);

  // Wallet balances — sum across all holding wallets (negative ones drag the
  // total down honestly so the bird's-eye number doesn't lie).
  //
  // NOTE: walletTotal is the RAW (unclamped) sum. The Safe-today hero above it
  // clamps via Math.max(0, walletBalancesBase) in safe-to-spend.ts:232. The
  // raw figure is intentional here so the hero subtitle ("of ₱X across wallets")
  // agrees with WalletRunwayWidget's "Overdrawn ₱X" label and the negative
  // wallet alarm row — three surfaces, one shared raw total.
  const holdings = holdingBalances(methods, payments, stepsByPayment, withdrawals, spends);
  const walletTotal = Math.round(holdings.reduce((s, h) => s + h.balance, 0));

  // Outstanding total — sum of all open project balances at today's rates.
  const outstandingRows = outstanding(projects, payments, clients, rates);
  const outstandingTotal = Math.round(outstandingTotalBase(outstandingRows));

  // Safe-to-spend — full breakdown via the shared single-source helper so
  // the headline can never drift from Today / Spending / Plans.
  const sts = computeSafeToSpendFromData(
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

  // 90-Day Cashflow Atlas — drives the bird's-eye chart on the dashboard.
  const atlas = buildCashflowAtlas({
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
    horizonDays: 90,
  });

  // Calm Weather + Forecast — best-effort. Failures fall back to whatever's
  // cached (calmWeather) or null (forecast).
  //
  // Cache-only read so the Dashboard never blocks on a synchronous Gemini
  // regen. Refresh is fire-and-forget; the next page load reads the warmed
  // row. Matches Today's pattern so the two surfaces can't paint different
  // calm bands in the gap between visits.
  const calmWeather = await getCalmWeatherCached().catch(() => cachedCalmWeather ?? null);
  if (!calmWeather || new Date(calmWeather.expires_at).getTime() <= Date.now()) {
    void refreshCalmWeather({ force: false }).catch(() => {});
  }
  const forecastStory: ForecastStory | null = hasGemini()
    ? await generateForecastStory({
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
      }).catch(() => null)
    : null;

  // 30-day pulse — landed and spent series, aligned to today.
  const landedSeries = dailySeries(payments, 30, now);
  const spentSeries = dailySpendSeries(spends, 30, now);

  // T28 — extra income strip aggregates. Week starts Monday in PHT (single
  // canonical helper so server (UTC) and Hatim's PHT clock agree).
  const startOfWeek = new Date(`${phtMondayOfWeek(now)}T00:00:00+08:00`);
  const weekLanded = landedInRange(payments, startOfWeek, now);
  // Year starts at PHT midnight Jan 1 so the boundary matches user clock.
  const startOfYear = new Date(`${now.getFullYear()}-01-01T00:00:00+08:00`);
  const ytd = landedInRange(payments, startOfYear, now);
  const trailing30 = landedInRange(payments, new Date(now.getTime() - 30 * DAY_MS), now);
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

  // Biggest debtor. oldestDays = longest open project age in days; renders in
  // the S widget sub line ("Name · 12d") since hero is now the money figure.
  const debtById = new Map<string, { name: string; total: number; oldestDays: number }>();
  for (const r of outstandingRows) {
    const name = r.client?.name ?? "Unknown";
    const e = debtById.get(r.project.client_id) ?? { name, total: 0, oldestDays: 0 };
    e.total += r.outstandingBase;
    if (r.daysAged > e.oldestDays) e.oldestDays = r.daysAged;
    debtById.set(r.project.client_id, e);
  }
  const biggestDebtor = Array.from(debtById.values()).sort((a, b) => b.total - a.total)[0] ?? null;

  // T26 + T27 — Pack rhythm + late night cluster on Dashboard. Pack rhythm
  // needs spendCategories + links to detect cigarette spends — the previous
  // [] passthrough caused the widget to render the empty-state forever.
  const [packRhythm, lateNight] = await Promise.all([
    generatePackRhythm({
      spends,
      spendCategories,
      spendCategoryLinks,
      now,
    }).catch(() => null),
    generateLateNightRead({ spends, now }).catch(() => null),
  ]);

  // Daily burn per wallet (trailing 30d).
  const burnSumByWallet = new Map<string, number>();
  const burnStart = now.getTime() - 30 * DAY_MS;
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

  // ─────────────────────────────────────────────────────────── ALERTS ──
  const alerts: AlertRow[] = [];

  // 1) Holding wallets that have crossed their overdraft tolerance — most
  // urgent first (largest deficit). Uses the canonical walletStatus tri-state
  // (set on each HoldingBalanceRow) so this matches NegativeWalletAlarm; a
  // wallet at -₱200 with ₱500 tolerance no longer gets alerted here.
  const negatives = holdings
    .filter((h) => h.status === "over_overdraft")
    .sort((a, b) => a.balance - b.balance);
  for (const h of negatives) {
    alerts.push({
      kind: "negative-wallet",
      name: h.name,
      deficit: Math.abs(Math.round(h.balance)),
      href: "/payments",
    });
  }

  // 2) Recurring rules whose next anchor lands inside the next 5 days and
  // haven't been settled for the current period.
  const dueSoon: { label: string; daysUntil: number; expectedBase: number; currency: CurrencyCode }[] = [];
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  for (const r of recurring) {
    if (!r.active) continue;
    const settled = recurringSkips.some(
      (s) => s.recurring_spend_id === r.id && s.period_key === periodKey(r, now),
    );
    if (settled) continue;
    const anchor = anchorDate(r, now);
    anchor.setHours(0, 0, 0, 0);
    const daysUntil = Math.round((anchor.getTime() - today.getTime()) / DAY_MS);
    if (daysUntil < 0 || daysUntil > RECURRING_HORIZON_DAYS) continue;
    dueSoon.push({
      label: r.label,
      daysUntil,
      expectedBase: Math.round(expectedBase(r, rates)),
      currency: r.expected_currency as CurrencyCode,
    });
  }
  dueSoon
    .sort((a, b) => a.daysUntil - b.daysUntil)
    .slice(0, 3)
    .forEach((d) =>
      alerts.push({
        kind: "recurring-due",
        label: d.label,
        daysUntil: d.daysUntil,
        expectedBase: d.expectedBase,
        currency: d.currency,
        href: "/settings/recurring",
      }),
    );

  // 3) Open AI questions — count + first headline as preview.
  if (openAiQuestions.length > 0) {
    alerts.push({
      kind: "ai-questions",
      count: openAiQuestions.length,
      preview: openAiQuestions[0]?.question ?? null,
      href: "/today",
    });
  }

  return (
    <DashboardView
      firstName={settings?.issuer_name?.split(" ")[0] ?? null}
      currency={currency}
      hasClients={clients.length > 0}
      year={now.getFullYear()}
      landedMtd={Math.round(metrics.mtd)}
      spentMtd={Math.round(metrics.spentMtd)}
      feesMtd={Math.round(metrics.feesMtd)}
      outstandingTotal={outstandingTotal}
      walletTotal={walletTotal}
      safeToday={Math.round(sts.safeTodayBase)}
      landedSeries={landedSeries}
      spentSeries={spentSeries}
      alerts={alerts.slice(0, ALERT_LIMIT)}
      calmWeather={calmWeather}
      atlas={atlas}
      forecastStory={forecastStory}
      holdings={holdings}
      dailyBurnByWallet={dailyBurnByWallet}
      weekLanded={Math.round(weekLanded)}
      avgDaysToPayment={avgDaysToPayment}
      biggestDebtor={biggestDebtor ? { name: biggestDebtor.name, total: Math.round(biggestDebtor.total) } : null}
      ytd={Math.round(ytd)}
      trailing30={Math.round(trailing30)}
      packRhythm={packRhythm}
      lateNight={lateNight}
    />
  );
}

// Daily spend totals over the trailing N days (oldest → newest). Mirrors
// dailySeries() for payments but lives here because nothing else needs it yet.
function dailySpendSeries(spends: Spend[], days: number, now: Date): number[] {
  const out = new Array(days).fill(0);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  for (const sp of spends) {
    const d = new Date(sp.spent_at);
    const idx = Math.floor((d.getTime() - start.getTime()) / DAY_MS);
    if (idx >= 0 && idx < days) out[idx] += Number(sp.amount_base ?? 0);
  }
  return out;
}

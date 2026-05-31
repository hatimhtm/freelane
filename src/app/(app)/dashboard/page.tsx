import { getDashboardData } from "@/lib/data/queries";
import {
  cashflowMetrics,
  outstanding,
  outstandingTotalBase,
  dailySeries,
} from "@/lib/dashboard-calc";
import { monthlyFeeBase, holdingBalances } from "@/lib/payment-chain";
import { safeToSpend } from "@/lib/safe-to-spend";
import { anchorDate, periodKey, expectedBase } from "@/lib/recurring";
import { buildCashflowAtlas } from "@/lib/cashflow-atlas";
import { getCalmWeather } from "@/lib/ai/calm-weather";
import { generateForecastStory, type ForecastStory } from "@/lib/ai/forecast-storyteller";
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
  const holdings = holdingBalances(methods, payments, stepsByPayment, withdrawals, spends);
  const walletTotal = Math.round(holdings.reduce((s, h) => s + h.balance, 0));

  // Outstanding total — sum of all open project balances at today's rates.
  const outstandingRows = outstanding(projects, payments, clients, rates);
  const outstandingTotal = Math.round(outstandingTotalBase(outstandingRows));

  // Safe-to-spend — full breakdown, but only the headline lands here.
  const sts = safeToSpend({
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
    now,
  });

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
  const calmWeather = await getCalmWeather().catch(() => cachedCalmWeather ?? null);
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

  // ─────────────────────────────────────────────────────────── ALERTS ──
  const alerts: AlertRow[] = [];

  // 1) Negative holding wallets — most urgent first (largest deficit).
  const negatives = holdings
    .filter((h) => h.balance < 0)
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

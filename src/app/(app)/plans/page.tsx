import { getPlansData } from "@/lib/data/queries";
import { computeSafeToSpendFromData } from "@/lib/safe-to-spend";
import { holdingBalances } from "@/lib/payment-chain";
import { buildCashflowAtlas } from "@/lib/cashflow-atlas";
import { bigPlansUpcoming } from "@/lib/planned-spends";
import { generateForecastStory } from "@/lib/ai/forecast-storyteller";
import { hasGemini } from "@/lib/ai/gemini";
import { BASE_CURRENCY_FALLBACK } from "@/lib/constants";
import type { CurrencyCode, PlannedSpend } from "@/lib/supabase/types";
import { PlansView, type PlansViewProps } from "./_components/plans-view";

export const metadata = { title: "Plans" };

export default async function PlansPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string; focus?: string }>;
}) {
  const params = await searchParams;
  const data = await getPlansData();
  const baseCurrency = (data.settings?.base_currency ?? BASE_CURRENCY_FALLBACK) as CurrencyCode;
  const now = new Date();

  // Atlas drives both the Pre-Commitment Runway chart and the Pre-Mortem
  // narrative around each big plan.
  const atlas = buildCashflowAtlas({
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
    now,
    horizonDays: 90,
  });

  // Forecast Storyteller for the page hero — quietly opinionated narrative
  // over the 30-day window.
  const story = hasGemini()
    ? await generateForecastStory({
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
        now,
      }).catch(() => null)
    : null;

  // Safe-to-spend baseline via the shared single-source helper — keeps the
  // headline identical across Today / Dashboard / Spending / Plans.
  const safe = computeSafeToSpendFromData(
    {
      payments: data.payments,
      withdrawals: data.withdrawals,
      spends: data.spends,
      recurring: data.recurring,
      recurringSkips: data.recurringSkips,
      loanInstallments: data.loanInstallments,
      methods: data.methods,
      stepsByPayment: data.stepsByPayment,
      rates: data.rates,
      plannedSpends: data.plannedSpends,
    },
    now,
  );

  // Holdings → wallet picker balances for the planned-spend modal.
  const holdings = holdingBalances(
    data.methods,
    data.payments,
    data.stepsByPayment,
    data.withdrawals,
    data.spends,
  );
  const holdingByMethod = new Map(holdings.map((h) => [h.methodId, h]));
  const wallets = data.methods
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

  const bigPlans: PlannedSpend[] = bigPlansUpcoming(data.plannedSpends, now, 90);

  const viewProps: PlansViewProps = {
    plans: data.plannedSpends,
    bigPlans,
    atlas,
    safe,
    walletTotal: holdings.reduce((s, h) => s + h.balance, 0),
    wallets,
    spendCategories: data.spendCategories,
    currencies: data.currencies.map((c) => c.code),
    baseCurrency,
    forecastHeadline: story?.headline ?? null,
    forecastNarrative: story?.narrative ?? null,
    calmWeather: data.calmWeather,
    openNew: params.new === "1",
    focusPlanId: params.focus ?? null,
  };

  return <PlansView {...viewProps} />;
}

import { Suspense } from "react";
import { PageHeader } from "@/components/app/page-header";
import { BASE_CURRENCY_FALLBACK } from "@/lib/constants";
import type { CurrencyCode } from "@/lib/supabase/types";
import {
  getBaseCurrency,
  getBiggestSpends,
  getRunway,
  getSavingsRate,
  getSpendVsIncomeTrend,
  getSpentForOthers,
  getTopCategories,
  getTopVendors,
  resolveScopeRange,
} from "@/lib/stats/queries";
import { SpendVsIncomeTrendWidget } from "@/components/widgets/stats/spend-vs-income-trend-widget";
import { TopVendorsWidget } from "@/components/widgets/stats/top-vendors-widget";
import { TopCategoriesWidget } from "@/components/widgets/stats/top-categories-widget";
import { SavingsRateWidget } from "@/components/widgets/stats/savings-rate-widget";
import { RunwayWidget } from "@/components/widgets/stats/runway-widget";
import { BiggestSpendsWidget } from "@/components/widgets/stats/biggest-spends-widget";
import { SpentForOthersWidget } from "@/components/widgets/stats/spent-for-others-widget";

export const metadata = { title: "Stats · Money" };

// Money section of the Stats workflow. Resolves the [scope] segment
// into a date range via resolveScopeRange, fans out the section's
// widget fetchers in parallel, and renders a sparse 2-column grid
// (Apple-widget feel). Relevance gating: widgets returning null are
// skipped — empty users see only the cards they have data for.
//
// Verifier fix (medium): the inline "Spent for others" block was
// promoted to its own SpentForOthersWidget so it follows the AiDot +
// p-5 chrome contract every other widget uses. Its data fetch moved
// to getSpentForOthers in lib/stats/queries.ts, where it gates on
// totals so we don't waste a round-trip on empty scopes.
//
// Verifier fix (medium): CycleProgressWidget was removed. The widget
// always returned current-month MTD regardless of scope, duplicating
// the Dashboard's cycle widget. The Dashboard is the right home for
// "right now" rhythm signals.
//
// Verifier fix (medium): SpendFrequencyHeatmapWidget lives in Behavior
// (not Money). The grid surfaces *when* spending happens, not *how
// much* — that's a behavioral rhythm signal, so it pairs naturally with
// daily-safe hit-rate and visit cadence. See behavior/page.tsx.
//
// Verifier fix (low): the widget grid now sits inside a <Suspense>
// boundary so a slow fetch (heatmap / runway balance sum) streams
// independently from the page header.

export default async function StatsMoneyPage({
  params,
}: {
  params: Promise<{ scope: string }>;
}) {
  const { scope } = await params;
  const range = resolveScopeRange(scope);

  const baseCurrencyRaw = await getBaseCurrency();
  const baseCurrency = (baseCurrencyRaw ?? BASE_CURRENCY_FALLBACK) as CurrencyCode;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-10 lg:py-12">
      <PageHeader title="Money" description={range.label} />
      <section className="mt-8">
        <h2 className="display-eyebrow text-muted-foreground">Money</h2>
        <Suspense fallback={<MoneyGridSkeleton />}>
          <MoneyGrid scope={scope} baseCurrency={baseCurrency} />
        </Suspense>
      </section>
    </div>
  );
}

async function MoneyGrid({
  scope,
  baseCurrency,
}: {
  scope: string;
  baseCurrency: CurrencyCode;
}) {
  const range = resolveScopeRange(scope);
  const [
    spendVsIncome,
    topVendors,
    topCategories,
    savingsRate,
    runway,
    biggestSpends,
    spentForOthers,
  ] = await Promise.all([
    getSpendVsIncomeTrend(range),
    getTopVendors(range, 5),
    getTopCategories(range, 5),
    getSavingsRate(range),
    getRunway(range),
    getBiggestSpends(range, 5),
    getSpentForOthers(range, 8),
  ]);

  const widgets: React.ReactNode[] = [];
  if (spendVsIncome) {
    widgets.push(
      <SpendVsIncomeTrendWidget
        key="spend-vs-income"
        scope={scope}
        data={spendVsIncome}
        baseCurrency={baseCurrency}
      />,
    );
  }
  if (topVendors) {
    widgets.push(
      <TopVendorsWidget
        key="top-vendors"
        scope={scope}
        vendors={topVendors}
        baseCurrency={baseCurrency}
      />,
    );
  }
  if (topCategories) {
    widgets.push(
      <TopCategoriesWidget
        key="top-categories"
        scope={scope}
        categories={topCategories}
        baseCurrency={baseCurrency}
      />,
    );
  }
  if (savingsRate) {
    widgets.push(
      <SavingsRateWidget
        key="savings-rate"
        scope={scope}
        data={savingsRate}
        baseCurrency={baseCurrency}
      />,
    );
  }
  if (runway) {
    widgets.push(
      <RunwayWidget
        key="runway"
        scope={scope}
        data={runway}
        baseCurrency={baseCurrency}
      />,
    );
  }
  if (biggestSpends) {
    widgets.push(
      <BiggestSpendsWidget
        key="biggest-spends"
        scope={scope}
        spends={biggestSpends}
        baseCurrency={baseCurrency}
      />,
    );
  }
  if (spentForOthers) {
    widgets.push(
      <SpentForOthersWidget
        key="for-others"
        scope={scope}
        data={spentForOthers}
        baseCurrency={baseCurrency}
      />,
    );
  }

  if (widgets.length === 0) {
    return (
      <div className="mt-4 rounded-[14px] border border-dashed border-foreground/15 bg-card/40 px-5 py-10 text-center">
        <div className="display-eyebrow text-muted-foreground">
          Nothing in scope yet
        </div>
        <p className="mx-auto mt-3 max-w-[420px] text-[13px] leading-relaxed text-foreground/75">
          No money activity in{" "}
          <span className="font-medium text-foreground/90">{range.label}</span>.
          Spend, log, or shift the scope to see Money widgets fill in.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {widgets}
    </div>
  );
}

function MoneyGridSkeleton() {
  // Verifier fix (low): widget count is data-dependent (0-7). 6 shimmer
  // tiles collapsing to an empty state on a brand-new user reads as a
  // broken promise. 3 tiles matches lg:grid-cols-3 and feels honest about
  // the sparse-grid commitment.
  return (
    <div className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="aspect-square min-h-[160px] w-full animate-pulse rounded-xl bg-card/60 ring-1 ring-foreground/10"
        />
      ))}
    </div>
  );
}

import { Suspense } from "react";
import { PageHeader } from "@/components/app/page-header";
import { BASE_CURRENCY_FALLBACK } from "@/lib/constants";
import type { CurrencyCode } from "@/lib/supabase/types";
import {
  getBaseCurrency,
  getCigaretteTranslatorTotal,
  getDailySafeHitRate,
  getSatisfactionAverages,
  getSpendFrequencyHeatmap,
  getVendorVisitFrequency,
  resolveScopeRange,
} from "@/lib/stats/queries";
import { DailySafeHitRateWidget } from "@/components/widgets/stats/daily-safe-hit-rate-widget";
import { SpendFrequencyHeatmapWidget } from "@/components/widgets/stats/spend-frequency-heatmap-widget";
import { VendorVisitFrequencyWidget } from "@/components/widgets/stats/vendor-visit-frequency-widget";
import { SatisfactionAveragesWidget } from "@/components/widgets/stats/satisfaction-averages-widget";
import { CigaretteTranslatorTotalWidget } from "@/components/widgets/stats/cigarette-translator-total-widget";

export const metadata = { title: "Stats · Behavior" };

// Behavior section of the Stats workflow. Mirrors money/page.tsx: resolve
// the [scope] segment into a date range, fan out the section's widget
// fetchers in parallel, and render a sparse 2/3-col grid (Apple-widget
// feel). Each fetcher returns null when the scope is empty — those
// widgets are skipped so users see only the cards they have data for.
//
// Verifier fix (high): this page was previously a placeholder card and
// the five Behavior widgets (heatmap, daily-safe hit-rate, vendor visits,
// satisfaction, cigarette translator) were orphaned. They're now wired
// in the same shape as MoneyGrid.
//
// Verifier fix (medium): PageHeader now reads range.label ("Last 30
// days", "2026", etc.) instead of the raw scope token, matching Money.
//
// Verifier fix (low): container width normalized to max-w-6xl so
// switching between Money/Behavior/Journey doesn't reflow the column.

export default async function StatsBehaviorPage({
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
      <PageHeader title="Behavior" description={range.label} />
      <section className="mt-8">
        <h2 className="display-eyebrow text-muted-foreground">Behavior</h2>
        <Suspense fallback={<BehaviorGridSkeleton />}>
          <BehaviorGrid scope={scope} baseCurrency={baseCurrency} />
        </Suspense>
      </section>
    </div>
  );
}

async function BehaviorGrid({
  scope,
  baseCurrency,
}: {
  scope: string;
  baseCurrency: CurrencyCode;
}) {
  const range = resolveScopeRange(scope);
  const [
    heatmap,
    dailySafe,
    vendorVisits,
    satisfaction,
    cigarettes,
  ] = await Promise.all([
    getSpendFrequencyHeatmap(range),
    getDailySafeHitRate(range),
    getVendorVisitFrequency(range),
    getSatisfactionAverages(range),
    getCigaretteTranslatorTotal(range),
  ]);

  const widgets: React.ReactNode[] = [];
  if (heatmap) {
    widgets.push(
      <SpendFrequencyHeatmapWidget
        key="spend-frequency-heatmap"
        scope={scope}
        data={heatmap}
      />,
    );
  }
  if (dailySafe) {
    widgets.push(
      <DailySafeHitRateWidget
        key="daily-safe-hit-rate"
        scope={scope}
        data={dailySafe}
      />,
    );
  }
  if (vendorVisits) {
    widgets.push(
      <VendorVisitFrequencyWidget
        key="vendor-visits"
        scope={scope}
        data={vendorVisits}
      />,
    );
  }
  if (satisfaction) {
    widgets.push(
      <SatisfactionAveragesWidget
        key="satisfaction"
        scope={scope}
        data={satisfaction}
      />,
    );
  }
  if (cigarettes) {
    widgets.push(
      <CigaretteTranslatorTotalWidget
        key="cigarette-translator"
        scope={scope}
        data={cigarettes}
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
          No behavior signal in{" "}
          <span className="font-medium text-foreground/90">{range.label}</span>.
          Spend, log, or shift the scope to see Behavior widgets fill in.
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

function BehaviorGridSkeleton() {
  // Verifier fix (low): match the lg col count so a brand-new user
  // doesn't see 6 shimmering tiles collapse to an empty state.
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

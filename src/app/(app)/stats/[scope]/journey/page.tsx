import { Suspense } from "react";
import { PageHeader } from "@/components/app/page-header";
import { BASE_CURRENCY_FALLBACK } from "@/lib/constants";
import type { CurrencyCode } from "@/lib/supabase/types";
import {
  getBaseCurrency,
  getBigPlansArchive,
  getLettersTimeline,
  getLifeEvents,
  getPlanCompletionRate,
  resolveScopeRange,
} from "@/lib/stats/queries";
import { BigPlansArchiveWidget } from "@/components/widgets/stats/big-plans-archive-widget";
import { LettersTimelineWidget } from "@/components/widgets/stats/letters-timeline-widget";
import { LifeEventsWidget } from "@/components/widgets/stats/life-events-widget";
import { PlanCompletionRateWidget } from "@/components/widgets/stats/plan-completion-rate-widget";

export const metadata = { title: "Stats · Journey" };

// Journey section of the Stats workflow. Mirrors money/page.tsx: resolve
// the [scope] segment into a date range, fan out the section's widget
// fetchers in parallel, and render a sparse 2/3-col grid. Null-gated
// widgets so empty scopes show only the cards that have data.
//
// Verifier fix (high): this page was previously a placeholder card; the
// four Journey widgets (life events, big plans archive, plan completion
// rate, letters timeline) were orphaned. They're now wired the same way
// as Money/Behavior.
//
// Verifier fix (medium): PageHeader uses range.label, not the raw scope
// token. Container width normalized to max-w-6xl.

export default async function StatsJourneyPage({
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
      <PageHeader title="Journey" description={range.label} />
      <section className="mt-8">
        <h2 className="display-eyebrow text-muted-foreground">Journey</h2>
        <Suspense fallback={<JourneyGridSkeleton />}>
          <JourneyGrid scope={scope} baseCurrency={baseCurrency} />
        </Suspense>
      </section>
    </div>
  );
}

async function JourneyGrid({
  scope,
  baseCurrency,
}: {
  scope: string;
  baseCurrency: CurrencyCode;
}) {
  const range = resolveScopeRange(scope);
  const [
    lifeEvents,
    bigPlans,
    planCompletion,
    lettersTimeline,
  ] = await Promise.all([
    getLifeEvents(range, 10),
    getBigPlansArchive(range, 6),
    getPlanCompletionRate(range),
    getLettersTimeline(range, 12),
  ]);

  const widgets: React.ReactNode[] = [];
  if (lifeEvents) {
    widgets.push(
      <LifeEventsWidget
        key="life-events"
        scope={scope}
        events={lifeEvents}
      />,
    );
  }
  if (bigPlans) {
    widgets.push(
      <BigPlansArchiveWidget
        key="big-plans-archive"
        scope={scope}
        plans={bigPlans}
        baseCurrency={baseCurrency}
      />,
    );
  }
  if (planCompletion) {
    widgets.push(
      <PlanCompletionRateWidget
        key="plan-completion-rate"
        scope={scope}
        data={planCompletion}
      />,
    );
  }
  if (lettersTimeline) {
    widgets.push(
      <LettersTimelineWidget
        key="letters-timeline"
        scope={scope}
        letters={lettersTimeline}
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
          No journey markers in{" "}
          <span className="font-medium text-foreground/90">{range.label}</span>.
          Plan, tag a milestone, or shift the scope to see Journey widgets
          fill in.
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

function JourneyGridSkeleton() {
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

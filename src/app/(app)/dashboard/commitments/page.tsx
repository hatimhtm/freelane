import { DashboardView } from "../_components/dashboard-view";
import { loadDashboardProps } from "../_components/dashboard-data";
import { EditorialHeader } from "@/components/app/editorial-header";
import { DashboardStatsChips } from "@/components/app/dashboard-stats-chips";
import { ActiveProjectsWidget } from "@/components/widgets/dashboard/active-projects-widget";
import { OpenPaymentsWidget } from "@/components/widgets/dashboard/open-payments-widget";
import { SadakaPoolWidget } from "@/components/widgets/dashboard/sadaka-pool-widget";
import { LastClientWidget } from "@/components/widgets/dashboard/last-client-widget";
import { resolveSadakaPoolOverdue } from "@/lib/warnings/registry";

export const metadata = { title: "Dashboard · Commitments" };

export default async function DashboardCommitmentsPage() {
  const props = await loadDashboardProps();
  const activeYears = props.activeYears ?? [];
  // sadaka_pool_overdue is in WARNING_KINDS but no consumer reads it until
  // the workflow lands. Resolving inline here so when sadakaConfigured
  // flips true the pill auto-attaches without a separate wire-up — the
  // dispatcher branch is no longer silently inert.
  const sadakaWarning = resolveSadakaPoolOverdue({
    sadakaWorkflowActive: !!props.sadakaConfigured,
    poolBase: Number(props.sadakaPoolBase ?? 0),
    graceWindowDays: 0,
  });
  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <EditorialHeader
        headline="Commitments"
        subline="Promised work, open invoices, and pool obligations."
        chips={<DashboardStatsChips activeYears={activeYears} />}
      />
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {/* No closest-plan line per brief — the closest project signal
            lives on /projects. ActiveProjectsWidget sub renders a static
            "open work" caption instead. */}
        <ActiveProjectsWidget
          count={props.openProjectsCount ?? 0}
          closestDueLabel={null}
        />
        <OpenPaymentsWidget
          count={props.openPaymentsCount ?? 0}
          totalDueBase={props.openPaymentsTotalBase ?? 0}
          currency={props.currency}
        />
        {/* Sadaka workflow (Phase 2). poolBase reads from finance.sadaka_ledger
            via lib/sadaka/ledger.ts; suggestedToday comes from the cached
            sadaka_suggested_today brain. Tap navigates to /sadaka. */}
        <SadakaPoolWidget
          poolBase={props.sadakaPoolBase ?? 0}
          suggestedToday={props.sadakaSuggestedToday ?? 0}
          currency={props.currency}
          warning={sadakaWarning}
        />
        <LastClientWidget
          name={props.lastClientName ?? null}
          daysAgo={props.lastClientDaysAgo ?? null}
        />
      </div>
      <div className="mt-6">
        <DashboardView
          firstName={props.firstName}
          currency={props.currency}
          hasClients={props.hasClients}
          year={props.year}
          alerts={props.alerts}
          calmWeather={props.calmWeather}
          holdings={props.holdings}
          lateNight={props.lateNight}
          dataDegraded={props.dataDegraded}
          tab="commitments"
        />
      </div>
    </div>
  );
}

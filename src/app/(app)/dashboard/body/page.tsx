import { DashboardView } from "../_components/dashboard-view";
import { loadDashboardProps } from "../_components/dashboard-data";
import { EditorialHeader } from "@/components/app/editorial-header";
import { DashboardStatsChips } from "@/components/app/dashboard-stats-chips";
import { DiaryRecentWidget } from "@/components/widgets/dashboard/diary-recent-widget";
import { SleepWidget } from "@/components/widgets/dashboard/sleep-widget";
import { CigarettesWidget } from "@/components/widgets/dashboard/cigarettes-widget";

export const metadata = { title: "Dashboard · Body" };

// Body subtab — brief calls for sleep + cigarettes + diary recent. All
// three widgets are relevance-gated (sleep + cigarettes hide on null,
// diary shows empty-state copy). The NightSpendsRemark strip rides via
// DashboardView since it's a body-side spending signal.
export default async function DashboardBodyPage() {
  const props = await loadDashboardProps();
  const activeYears = props.activeYears ?? [];
  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <EditorialHeader
        headline="Body"
        subline="Sleep, cigarettes, the diary stream."
        chips={<DashboardStatsChips activeYears={activeYears} />}
      />
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <SleepWidget
          lastNightHours={props.sleepLastNightHours ?? null}
          trailing7dHours={props.sleepTrailing7dHours ?? null}
        />
        <CigarettesWidget
          today={props.cigarettesToday ?? null}
          avg7d={props.cigarettesAvg7d ?? null}
        />
        <DiaryRecentWidget entries={props.diaryRecent ?? []} />
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
          tab="body"
        />
      </div>
    </div>
  );
}

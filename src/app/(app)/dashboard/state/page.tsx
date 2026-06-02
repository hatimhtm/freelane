import { loadDashboardProps } from "../_components/dashboard-data";
import { EditorialHeader } from "@/components/app/editorial-header";
import { DashboardStatsChips } from "@/components/app/dashboard-stats-chips";
import { PeriodWidget } from "@/components/widgets/dashboard/period-widget";
import { RecoveryWidget } from "@/components/widgets/dashboard/recovery-widget";

export const metadata = { title: "Dashboard · State" };

// State subtab — period + recovery only per the brief. The legacy
// DashboardView slot is intentionally dropped: alerts band, fallback
// paragraph, JumpTo, IncomeStrip all belong elsewhere. PeriodWidget gates
// itself on a non-null daysRemaining so we never paint a fake number;
// when the real period concept lands the data layer flips
// periodDaysRemaining and the widget appears.
export default async function DashboardStatePage() {
  const props = await loadDashboardProps();
  const activeYears = props.activeYears ?? [];
  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <EditorialHeader
        headline="State"
        subline="Where the period stands and whether recovery is on track."
        chips={<DashboardStatsChips activeYears={activeYears} />}
      />
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <PeriodWidget
          daysRemaining={props.periodDaysRemaining ?? null}
          endingSoon={!!props.periodEndingSoon}
          endingSoonMessage={props.periodEndingSoonMessage}
        />
        <RecoveryWidget
          inRecovery={!!props.recoveryInProgress}
          progress01={props.recoveryProgress01 ?? 0}
          stalled={!!props.recoveryStalled}
        />
      </div>
    </div>
  );
}

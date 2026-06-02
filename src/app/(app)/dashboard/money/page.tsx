import { Plus } from "lucide-react";
import { LinkButton } from "@/components/ui/link-button";
import { DashboardView } from "../_components/dashboard-view";
import { loadDashboardProps } from "../_components/dashboard-data";
import { EditorialHeader } from "@/components/app/editorial-header";
import { DashboardStatsChips } from "@/components/app/dashboard-stats-chips";
import { TotalWalletsWidget } from "@/components/widgets/dashboard/total-wallets-widget";
import { ThirtyDayNetWidget } from "@/components/widgets/dashboard/thirty-day-net-widget";
import { ForecastWidget } from "@/components/widgets/dashboard/forecast-widget";
import { SpendTrendWidget } from "@/components/widgets/dashboard/spend-trend-widget";
import { WalletStack } from "@/components/widgets/dashboard/wallet-stack";
import { PackRhythmWidget } from "@/components/widgets/dashboard/pack-rhythm-widget";
import { IncomeStrip } from "@/components/widgets/dashboard/income-strip";
import { WalletRunwayWidget } from "@/components/widgets/dashboard/wallet-runway-widget";
import type { WarningResult } from "@/lib/warnings/registry";

export const metadata = { title: "Dashboard · Money" };

export default async function DashboardMoneyPage() {
  // Phase 1.5: active-years fetch is folded INTO loadDashboardProps so the
  // chip strip costs one query for the whole dashboard, not one per subtab.
  const props = await loadDashboardProps();
  const activeYears = props.activeYears ?? [];

  // Stale-wallet warnings carry the FULL WarningResult per wallet so the
  // pill renders the resolver's exact message ("No anchor yet" vs
  // "Anchor over a month old") + detailHref. The previous code collapsed
  // both states to a single hardcoded string.
  const staleMap: Map<string, WarningResult> =
    props.walletAnchorStaleMap ?? new Map();

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <EditorialHeader
        headline={props.firstName ? `Hey, ${props.firstName}.` : "Dashboard"}
        subline={`${new Date().toLocaleString("en", { month: "long", year: "numeric" })} at a glance.`}
        chips={<DashboardStatsChips activeYears={activeYears} />}
        actions={
          <LinkButton
            href={props.hasClients ? "/payments?new=1" : "/clients?new=1"}
            size="sm"
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            {props.hasClients ? "Log payment" : "Add client"}
          </LinkButton>
        }
      />
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <TotalWalletsWidget
          totalBase={props.walletTotal}
          delta7dBase={props.walletDelta7dBase ?? 0}
          currency={props.currency}
        />
        <ThirtyDayNetWidget
          netBase={props.thirtyDayNet ?? 0}
          unaccountedBase={props.unaccountedOutflow30dBase ?? 0}
          currency={props.currency}
        />
      </div>
      <div className="mt-3 space-y-3">
        <ForecastWidget summary={props.forecastSummary ?? null} />
        <WalletStack holdings={props.holdings} staleWalletWarnings={staleMap} />
        {/* WalletRunwayWidget rides next to the wallet stack — they share
            the wallet semantic. Runway = combined balance / combined daily
            burn; the M-widget hero is days-of-runway with a single overdrawn
            stamp when wallets have crossed zero. */}
        <WalletRunwayWidget
          holdings={props.holdings}
          dailyBurnByWallet={new Map(props.dailyBurnByWallet)}
          currency={props.currency}
        />
        {/* IncomeStrip — canonical brief shape: 1 M widget with 4 internal
            cells (Week / Month / Year / Lifetime). Comparison-set rule
            applies: each cell stays visible at zero. The other 4 metrics
            previously bundled into this strip (Outstanding / Fees MTD /
            Avg-days / Biggest-debtor) live on /payments + commitments. */}
        <IncomeStrip
          currency={props.currency}
          weekLanded={props.weekLanded}
          monthLanded={props.landedMtd}
          yearLanded={props.ytd}
          lifetimeLanded={props.lifetimeLanded}
        />
        <SpendTrendWidget daily={props.spentSeries} currency={props.currency} />
        {/* PackRhythmWidget belongs on Money per brief — it's a money
            widget (peso cost-per-week + 12w sparkline). The body subtab
            carries cigarette STICK COUNT separately. */}
        <PackRhythmWidget read={props.packRhythm} baseCurrency={props.currency} />
      </div>

      {/* DashboardView carries only the cross-tab chrome the new grid
          doesn't replace: CalmWeatherBanner, NegativeWalletAlarm,
          Alerts band, JumpTo. Hero + atlas + pulse + storyteller were the
          duplicate-forecast / duplicate-net surfaces the brief flagged.
          IncomeStrip + WalletRunway are restored above. Only the props the
          view actually reads are forwarded — the old {...props} dead-
          spread is gone so future drift fails type-check, not silently. */}
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
          tab="money"
        />
      </div>
    </div>
  );
}

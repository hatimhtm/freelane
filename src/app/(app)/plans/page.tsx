import { getPlansData } from "@/lib/data/queries";
import { computeWalletBalancesFromLedger } from "@/lib/data/wallet-balance";
import { logLedgerReadFailure } from "@/lib/data/money-ledger";
import { holdingBalances } from "@/lib/payment-chain";
import { BASE_CURRENCY_FALLBACK } from "@/lib/constants";
import type { CurrencyCode } from "@/lib/supabase/types";
import { PlansView, type PlansViewProps } from "./_components/plans-view";

export const metadata = { title: "Plans" };

// Plans redesign (2026-06) loader.
//
// Forecast Storyteller / CashflowAtlasChart / Pre-Mortem cards are
// REMOVED from this page per brief. The Plans tab is now scoped to
// "big planned purchases the runway should know about" — narrative
// runway widgets live on the dashboard.

export default async function PlansPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string; focus?: string }>;
}) {
  const params = await searchParams;
  const data = await getPlansData();
  const baseCurrency = (data.settings?.base_currency ?? BASE_CURRENCY_FALLBACK) as CurrencyCode;

  // Wallet picker balances for the purchase-decision modal. Ledger-
  // derived map → holdingBalances() → WalletOpt[].
  const ledgerMap = await computeWalletBalancesFromLedger(data.methods).catch(
    (err) => {
      const message = err instanceof Error ? err.message : String(err);
      void logLedgerReadFailure(`plans wallet-balance read: ${message}`);
      return new Map();
    },
  );
  const chainMap = new Map<string, number>();
  for (const [k, v] of ledgerMap) chainMap.set(k, v.balance);
  const holdings = holdingBalances(
    data.methods,
    data.payments,
    data.stepsByPayment,
    data.withdrawals,
    data.spends,
    chainMap,
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

  const viewProps: PlansViewProps = {
    plans: data.plannedSpends,
    strategies: data.planStrategies,
    wallets,
    baseCurrency,
    openNew: params.new === "1",
    focusPlanId: params.focus ?? null,
  };

  return <PlansView {...viewProps} />;
}

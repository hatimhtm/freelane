import { getSpendingData } from "@/lib/data/queries";
import { safeToSpend } from "@/lib/safe-to-spend";
import { holdingBalances } from "@/lib/payment-chain";
import { generateSpendingAnomalies } from "@/lib/ai/spending-anomalies";
import { BASE_CURRENCY_FALLBACK } from "@/lib/constants";
import type { CurrencyCode } from "@/lib/supabase/types";
import { SpendingView, type SpendRow } from "./_components/spending-view";
import type { MonthValue } from "@/components/app/page-month-nav";

export const metadata = { title: "Spending" };

export default async function SpendingPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string; category?: string; m?: string }>;
}) {
  const params = await searchParams;
  const {
    spends,
    spendCategories,
    spendCategoryLinks,
    spendItems,
    recurring,
    recurringSkips,
    loanInstallments,
    withdrawals,
    methods,
    settings,
    currencies,
    rates,
    payments,
    stepsByPayment,
  } = await getSpendingData();
  const baseCurrency = (settings?.base_currency ?? BASE_CURRENCY_FALLBACK) as CurrencyCode;

  // Tag lookup: spendId → categoryIds. Drives chip filtering + per-row display.
  const tagsBySpend = new Map<string, string[]>();
  for (const link of spendCategoryLinks) {
    const arr = tagsBySpend.get(link.spend_id) ?? [];
    arr.push(link.category_id);
    tagsBySpend.set(link.spend_id, arr);
  }
  const walletNameById = new Map(methods.map((m) => [m.id, m.name]));

  const rows: SpendRow[] = spends.map((s) => ({
    id: s.id,
    spentAt: s.spent_at,
    amount: Number(s.amount),
    currency: s.currency as CurrencyCode,
    amountBase: Number(s.amount_base ?? 0),
    description: s.description ?? null,
    walletId: s.wallet_id,
    walletName: walletNameById.get(s.wallet_id) ?? "Untagged",
    categoryIds: tagsBySpend.get(s.id) ?? [],
    businessRelevant: !!s.business_relevant,
  }));

  // Holding balances feed the SpendModal's wallet picker so the richest holding
  // wallet leads — the most likely source of an everyday spend.
  const holdings = holdingBalances(methods, payments, stepsByPayment, withdrawals, spends);
  const balanceByMethod = new Map(holdings.map((h) => [h.methodId, h.balance]));

  const wallets = methods
    .filter((m) => !m.archived)
    .map((m) => ({
      id: m.id,
      name: m.name,
      is_holding: !!m.is_holding,
      balanceBase: m.is_holding ? balanceByMethod.get(m.id) ?? 0 : undefined,
    }));

  // Baseline for the SpendModal's impact dial — recomputed live as the user
  // types via SafeToSpendImpactDial(proposedAmountBase, baseline).
  const safeToSpendBaseline = safeToSpend({
    payments,
    withdrawals,
    spends,
    recurring,
    recurringSkips,
    loanInstallments,
    methods,
    stepsByPayment,
    rates,
  });

  const initialMonth = parseMonthParam(params.m) ?? currentMonth();

  // Trailing 6 months feeds the line chart, the small-multiples sparklines,
  // and the anomaly snapshot. Anchored on `now` (not the navigated month)
  // because trend context shouldn't shift as the user scrubs back through
  // history — the right rail is always "what's been happening lately".
  const now = new Date();
  const trailingStart = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const spendsTrailing6mo = spends.filter((s) => {
    const t = new Date(s.spent_at).getTime();
    return t >= trailingStart.getTime();
  });

  // This-month vs trailing-baseline anomalies. Server-side single call; the
  // panel skips rendering if the array is empty.
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const spendsThisMonth = spends.filter(
    (s) => new Date(s.spent_at) >= startOfMonth,
  );
  const anomalies = await generateSpendingAnomalies({
    spendsThisMonth,
    spendsTrailing6mo,
    categories: spendCategories,
    categoryLinks: spendCategoryLinks,
  });

  return (
    <SpendingView
      rows={rows}
      categories={spendCategories}
      wallets={wallets}
      currencies={currencies.map((c) => c.code)}
      rates={rates.map((r) => ({ code: r.code, rate_to_base: Number(r.rate_to_base) }))}
      baseCurrency={baseCurrency}
      safeToSpendBaseline={safeToSpendBaseline}
      recentSpends={spends}
      spendsTrailing6mo={spendsTrailing6mo}
      spendCategoryLinks={spendCategoryLinks}
      spendItems={spendItems}
      anomalies={anomalies}
      initialMonth={initialMonth}
      openNew={params.new === "1"}
      defaultCategoryId={params.category}
    />
  );
}

function currentMonth(): MonthValue {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

function parseMonthParam(raw: string | undefined): MonthValue | null {
  if (!raw) return null;
  const m = /^(\d{4})-(\d{2})$/.exec(raw);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (!year || month < 1 || month > 12) return null;
  return { year, month };
}

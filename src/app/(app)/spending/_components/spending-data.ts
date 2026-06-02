// Shared spending data loader. Lifted out of the old monolithic
// /spending/page.tsx so each subtab page can call the same pipeline.
//
// PageMonthNav drives ?m= as a query param — the loader respects it via
// searchParams so server-rendered month state matches the URL on first
// paint (matters for trends/spends which share the navigated month).

import { getSpendingData } from "@/lib/data/queries";
import { computeSafeToSpendFromData } from "@/lib/safe-to-spend";
import { holdingBalances } from "@/lib/payment-chain";
import { computeWalletBalancesFromLedger } from "@/lib/data/wallet-balance";
import { logLedgerReadFailure } from "@/lib/data/money-ledger";
import { generateSpendingAnomalies } from "@/lib/ai/spending-anomalies";
import { BASE_CURRENCY_FALLBACK } from "@/lib/constants";
import type { CurrencyCode } from "@/lib/supabase/types";
import type { MonthValue } from "@/components/app/page-month-nav";
import type { SpendRow } from "./spending-view";

export type SpendingPageProps = Omit<
  Parameters<typeof import("./spending-view").SpendingView>[0],
  "tab"
>;

export async function loadSpendingProps(params: {
  new?: string;
  category?: string;
  m?: string;
}): Promise<SpendingPageProps> {
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
    plannedSpends,
  } = await getSpendingData();
  const baseCurrency = (settings?.base_currency ?? BASE_CURRENCY_FALLBACK) as CurrencyCode;

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

  // Phase 1.5: ledger reader first; falls back to source-table math for
  // wallets the ledger doesn't yet cover.
  const ledgerBalanceMap = await computeWalletBalancesFromLedger(methods).catch(
    (err) => {
      const message = err instanceof Error ? err.message : String(err);
      void logLedgerReadFailure(`spending wallet-balance read: ${message}`);
      return new Map();
    },
  );
  const ledgerBalanceForChain = new Map<string, number>();
  for (const [k, v] of ledgerBalanceMap) ledgerBalanceForChain.set(k, v.balance);

  const holdings = holdingBalances(methods, payments, stepsByPayment, withdrawals, spends, ledgerBalanceForChain);
  const holdingByMethod = new Map(holdings.map((h) => [h.methodId, h]));

  const wallets = methods
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

  const safeToSpendBaseline = computeSafeToSpendFromData({
    payments,
    withdrawals,
    spends,
    recurring,
    recurringSkips,
    loanInstallments,
    methods,
    stepsByPayment,
    rates,
    plannedSpends,
    ledgerBalances: ledgerBalanceForChain,
  });

  const initialMonth = parseMonthParam(params.m) ?? currentMonth();

  const now = new Date();
  const trailingStart = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const spendsTrailing6mo = spends.filter((s) => {
    const t = new Date(s.spent_at).getTime();
    return t >= trailingStart.getTime();
  });

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

  return {
    rows,
    categories: spendCategories,
    wallets,
    currencies: currencies.map((c) => c.code),
    rates: rates.map((r) => ({ code: r.code, rate_to_base: Number(r.rate_to_base) })),
    baseCurrency,
    safeToSpendBaseline,
    recentSpends: spends,
    spendsTrailing6mo,
    spendCategoryLinks,
    spendItems,
    anomalies,
    initialMonth,
    openNew: params.new === "1",
    defaultCategoryId: params.category,
  };
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

// ─── Chatbot context ────────────────────────────────────────────────
//
// Spending's chatbot primary question is "where is the money leaking?" —
// pulls top-7d categories + the anomalies the AI brain already flagged.

import {
  pageKeyFromPath,
  registerChatbotContext,
  type PageContext,
} from "@/lib/data/chat-context-registry";

const DAY_MS = 86_400_000;

export async function loadSpendingChatbotContext(
  _userId: string,
): Promise<PageContext> {
  const {
    spends,
    spendCategories,
    spendCategoryLinks,
  } = await getSpendingData();

  const catById = new Map(spendCategories.map((c) => [c.id, c.name as string]));
  const tagsBySpend = new Map<string, string[]>();
  for (const link of spendCategoryLinks) {
    const arr = tagsBySpend.get(link.spend_id) ?? [];
    arr.push(catById.get(link.category_id) ?? "untagged");
    tagsBySpend.set(link.spend_id, arr);
  }
  const sevenDaysAgo = Date.now() - 7 * DAY_MS;
  const recent = spends.filter(
    (s) => new Date(s.spent_at).getTime() >= sevenDaysAgo,
  );
  const totalsByCat = new Map<string, number>();
  for (const s of recent) {
    const tags = tagsBySpend.get(s.id) ?? ["untagged"];
    for (const t of tags) {
      totalsByCat.set(t, (totalsByCat.get(t) ?? 0) + Number(s.amount_base ?? 0));
    }
  }
  const top7d = Array.from(totalsByCat.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, total]) => ({ name, total: Math.round(total) }));

  // Anomalies are computed elsewhere (spending/_components/anomaly cards) —
  // the chatbot just exposes the top categories. Re-running anomaly brain
  // on every chat-open burns Pro tokens; the brain can ask the user
  // directly about a category if the snapshot doesn't already cover it.

  return {
    page: "spending",
    surface: "/spending",
    primaryQuestion: "Where is the money leaking?",
    relevantData: {
      top7d,
      spendsLast7d: recent.length,
      totalLast7dBase: Math.round(
        recent.reduce((s, sp) => s + Number(sp.amount_base ?? 0), 0),
      ),
    },
    suggestPills: true,
  };
}

registerChatbotContext({
  match: (path) => {
    const key = pageKeyFromPath(path);
    return key === "spending" || key.startsWith("spending.");
  },
  fetch: loadSpendingChatbotContext,
});

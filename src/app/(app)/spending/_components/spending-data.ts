// Shared spending data loader. Lifted out of the old monolithic
// /spending/page.tsx so each subtab page can call the same pipeline.
//
// PageMonthNav drives ?m= as a query param — the loader respects it via
// searchParams so server-rendered month state matches the URL on first
// paint (matters for trends/spends which share the navigated month).

import {
  getSpendingData,
  getVendorIconCache,
  getDailySafeSnapshotForToday,
} from "@/lib/data/queries";
import {
  computeSafeToSpendFromData,
  computeSafeToSpend,
} from "@/lib/safe-to-spend";
import { upsertDailySafeSnapshot } from "@/lib/data/actions";
import { isPhtToday, phtDateString } from "@/lib/utils";
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
    activePlanStrategies,
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
    forUs: !!s.for_us,
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
    // Migration 0089 — strategy reduction. Keeps Spending's dial in
    // lockstep with Today / Dashboard / Plans.
    activePlanStrategies,
  });

  // BUG FIX #2 (LIVE DAILY SAFE) — read today's PHT-anchored snapshot.
  // If none exists (first read of the day), upsert one with the current
  // baseline.safeTodayBase. Subsequent reads of the day pick up the
  // stable value. liveRemaining = initialForToday - sum(today's spend
  // amount_base in PHT).
  //
  // Snapshot-write integrity rules:
  //   1. Refuse to snapshot a 0 when wallets/payments exist — that
  //      would lock the user at ₱0 Safe-to-Spend for the day if a
  //      transient compute failure ever produces a zeroed baseline.
  //      Let the next render retry against a fresh recompute.
  //   2. Refuse to snapshot when the upstream baseline tagged itself
  //      as the catch-block default (notes contains the sentinel
  //      "fell back to a calm default").
  //   3. On upsert failure, return null instead of fabricating a fake
  //      "stable" snapshot — fabrication silently violates the intraday
  //      stability invariant the snapshot exists to provide.
  const todayPht = phtDateString(new Date());
  const baselineFellBack = safeToSpendBaseline.notes.some((n) =>
    n.includes("fell back to a calm default"),
  );
  const hasWalletsOrPayments = methods.length > 0 || payments.length > 0;
  const baselineSnapshotOk =
    !baselineFellBack &&
    (safeToSpendBaseline.safeTodayBase > 0 || !hasWalletsOrPayments);
  let snapshot = await getDailySafeSnapshotForToday().catch(() => null);
  if (!snapshot && baselineSnapshotOk) {
    const writeResult = await upsertDailySafeSnapshot({
      initialSafeBase: Math.max(0, safeToSpendBaseline.safeTodayBase),
      currency: baseCurrency,
    }).catch(() => null);
    if (writeResult?.ok) {
      // Only adopt an in-memory snapshot when the write actually
      // succeeded — otherwise let the live compute fall back to the
      // current baseline so the next render can retry.
      snapshot = {
        initial_safe_base: Math.max(0, Math.round(safeToSpendBaseline.safeTodayBase)),
        currency: baseCurrency,
        computed_at: new Date().toISOString(),
      };
    } else if (writeResult && !writeResult.ok) {
      console.error("spending-data: upsertDailySafeSnapshot failed", writeResult.error);
    }
  }
  // Shared PHT-today helper keeps Today + Spending in lockstep — neither
  // surface can regress in isolation. todayPht remains in scope above
  // for cache-key construction and snapshot freshness checks.
  void todayPht;
  const todaySpendsBase = spends.reduce((s, sp) => {
    return isPhtToday(sp.spent_at)
      ? s + Number(sp.amount_base ?? 0)
      : s;
  }, 0);
  const live = computeSafeToSpend({
    baseline: safeToSpendBaseline,
    snapshotBase: snapshot ? snapshot.initial_safe_base : null,
    todaySpendsBase,
    currency: baseCurrency,
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

  // Brand Identity workflow — vendor icon cache for the spend list + the
  // vendor leaderboard. Failure swallowed (resolver falls through to
  // tier 1 / tier 3 without the cache row).
  const vendorIconCache = await getVendorIconCache().catch(() => []);

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
    vendorIconCache,
    initialSafeForToday: live.initialForToday,
    liveSafeRemaining: live.liveRemaining,
    liveSafeOvershoot: live.overshootBase,
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

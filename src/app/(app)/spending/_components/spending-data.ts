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
  getKnownVendorsForModal,
  getKnownPeopleForModal,
} from "@/lib/data/queries";
import { getLoansForSpendIds, normalizeDirection } from "@/lib/loans/queries";
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

  // Loans workflow — project loan state onto each spend row. The spending
  // list shows given-direction loans inline (received loans have no
  // origin spend by design and live in entity detail instead). Single
  // batched query keyed off the spend ids in scope; degrades gracefully
  // (badges hide, deep links inert) if the call throws.
  const loansBySpendId = new Map<
    string,
    { loanId: string; direction: "given" | "received"; status: string }
  >();
  try {
    const spendIds = spends.map((s) => s.id);
    const loanRows = await getLoansForSpendIds(spendIds);
    for (const l of loanRows) {
      if (!l.origin_spend_id) continue;
      const dir = normalizeDirection(l.direction);
      if (!dir) continue;
      loansBySpendId.set(l.origin_spend_id, {
        loanId: l.id,
        direction: dir,
        status: l.status,
      });
    }
  } catch {
    // Swallow — the spends list still renders without loan badges.
  }

  const rows: SpendRow[] = spends.map((s) => {
    const loanMatch = loansBySpendId.get(s.id);
    return {
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
      isLoan: !!loanMatch,
      loanId: loanMatch?.loanId ?? null,
      loanDirection: loanMatch?.direction ?? null,
      loanStatus: loanMatch?.status ?? null,
    };
  });

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

  // Vendors workflow — light projection of the user's active vendors so
  // the spend modal can render the "text input + dropdown of matching
  // known vendors" affordance without re-fetching the heavy
  // getVendorsData payload. Failure degrades silently — the dropdown
  // simply shows no suggestions and the typed text still flows through
  // resolveLinksForSpend / createVendor on save.
  const knownVendors = await getKnownVendorsForModal().catch(() => []);
  // Entities workflow — light projection of the user's active entities
  // for the "For someone else" picker on the spend modal. Failure
  // degrades silently — the picker still accepts free-text input and
  // Gate 1 fires on save.
  const knownPeople = await getKnownPeopleForModal().catch(() => []);

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
    knownVendors,
    knownPeople,
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
  isVendorDetailIntent,
  type PageContext,
  type ChatbotActiveCardArg,
} from "@/lib/data/chat-context-registry";
import { createClient } from "@/lib/supabase/server";

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

// Vendors workflow — per-card AI dot on Active vendor cards. When the
// chatbot opens scoped to a specific vendor, pull the most-recent
// vendor_price_history rows + the trailing 90d of spends linked to
// this vendor so chat-answer can speak to "are SM prices rising?",
// "when did I last go", "what do I usually buy here?" without a
// blanket re-snapshot. Best-effort: any individual sub-fetch failing
// degrades to the base context plus the activeCard payload.
async function loadVendorCardContext(
  userId: string,
  card: ChatbotActiveCardArg,
): Promise<Partial<PageContext>> {
  if (!isVendorDetailIntent(card)) return {};
  const vendorId = card.data.vendor_id;
  const supabase = await createClient();
  const since = new Date(Date.now() - 90 * DAY_MS).toISOString();
  const [vendorRow, linkRows, priceRows] = await Promise.all([
    supabase
      .from("vendors")
      .select(
        "id, canonical_name, raw_user_typed_name, brand_key, short_description, kinds, notes, last_seen_at, confidence",
      )
      .eq("id", vendorId)
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("spend_vendor_links")
      .select("spend_id")
      .eq("vendor_id", vendorId),
    supabase
      .from("vendor_price_history")
      .select("item_label, unit_price_base, observed_at")
      .eq("vendor_id", vendorId)
      .gte("observed_at", since)
      .order("observed_at", { ascending: false })
      .limit(30),
  ]);
  const linkedSpendIds = (linkRows.data ?? []).map(
    (r) => r.spend_id as string,
  );
  let recentSpends: Array<{
    id: string;
    spent_at: string;
    amount_base: number | null;
    description: string | null;
  }> = [];
  if (linkedSpendIds.length > 0) {
    const { data: spends } = await supabase
      .from("spends")
      .select("id, spent_at, amount_base, description")
      .in("id", linkedSpendIds.slice(0, 200))
      .gte("spent_at", since)
      .order("spent_at", { ascending: false })
      .limit(30);
    recentSpends = (spends ?? []) as typeof recentSpends;
  }
  const v = vendorRow.data as {
    id: string;
    canonical_name: string | null;
    raw_user_typed_name: string | null;
    brand_key: string | null;
    short_description: string | null;
    kinds: unknown;
    notes: string | null;
    last_seen_at: string | null;
    confidence: number | null;
  } | null;
  return {
    primaryQuestion: `What about ${card.data.vendor_name}?`,
    relevantData: {
      vendorCard: {
        vendor_id: vendorId,
        canonical_name:
          v?.canonical_name ?? card.data.vendor_name,
        brand_key: v?.brand_key ?? null,
        short_description: v?.short_description ?? null,
        kinds: Array.isArray(v?.kinds) ? v?.kinds : [],
        notes: v?.notes ?? null,
        last_seen_at: v?.last_seen_at ?? null,
        confidence: v?.confidence ?? null,
        recentSpends: recentSpends.map((s) => ({
          spent_at: s.spent_at,
          amount_base: Math.round(Number(s.amount_base ?? 0)),
          description: s.description,
        })),
        priceHistory: (priceRows.data ?? []).map((p) => ({
          item_label: p.item_label as string,
          unit_price_base: Math.round(Number(p.unit_price_base ?? 0)),
          observed_at: p.observed_at as string,
        })),
      },
    },
  };
}

registerChatbotContext({
  match: (path) => {
    const key = pageKeyFromPath(path);
    return key === "spending" || key.startsWith("spending.");
  },
  fetch: loadSpendingChatbotContext,
  fetchCard: loadVendorCardContext,
});

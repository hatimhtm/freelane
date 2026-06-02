// Shared dashboard data loader. Pulled out of the old monolithic
// /dashboard/page.tsx so each subtab page (Money/Commitments/State/Body)
// can call the same pipeline and pass the same props to DashboardView
// with only the per-tab "tab" flag differing.
//
// This is intentionally a single fan-out rather than per-tab queries:
// the AI brains (calm weather, forecast, pack rhythm, late-night) are
// expensive enough that we'd rather warm the cache once per dashboard
// visit than scatter four sub-fetches.

import { getDashboardData, getDashboardActiveYears } from "@/lib/data/queries";
import {
  cashflowMetrics,
  outstanding,
  outstandingTotalBase,
  dailySeries,
  landedInRange,
} from "@/lib/dashboard-calc";
import { monthlyFeeBase, holdingBalances } from "@/lib/payment-chain";
import { phtMondayOfWeek } from "@/lib/utils";
import { computeSafeToSpendFromData } from "@/lib/safe-to-spend";
import { anchorDate, periodKey, expectedBase } from "@/lib/recurring";
import { buildCashflowAtlas } from "@/lib/cashflow-atlas";
import { getCalmWeatherCached, refreshCalmWeather } from "@/lib/ai/calm-weather";
import { generateForecastStory, type ForecastStory } from "@/lib/ai/forecast-storyteller";
import { generatePackRhythm } from "@/lib/ai/pack-rhythm";
import { generateLateNightRead } from "@/lib/ai/late-night-cluster";
import { hasGemini } from "@/lib/ai/gemini";
import { computeWalletBalancesFromLedger } from "@/lib/data/wallet-balance";
import { logLedgerReadFailure } from "@/lib/data/money-ledger";
import { getForecastSummary, type ForecastSummary } from "@/lib/ai/forecast-summary";
import {
  resolveWalletAnchorStale,
  resolveAllWarnings,
  type WarningResult,
} from "@/lib/warnings/registry";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { BASE_CURRENCY_FALLBACK } from "@/lib/constants";
import type { CurrencyCode, Spend } from "@/lib/supabase/types";
import type { AlertRow } from "./dashboard-view";

const DAY_MS = 86_400_000;
const RECURRING_HORIZON_DAYS = 5;
const ALERT_LIMIT = 6;

export type DashboardProps = {
  firstName: string | null;
  currency: CurrencyCode;
  hasClients: boolean;
  year: number;
  landedMtd: number;
  spentMtd: number;
  feesMtd: number;
  outstandingTotal: number;
  walletTotal: number;
  safeToday: number;
  landedSeries: number[];
  spentSeries: number[];
  alerts: AlertRow[];
  calmWeather: Awaited<ReturnType<typeof getCalmWeatherCached>> | null;
  atlas: ReturnType<typeof buildCashflowAtlas>;
  forecastStory: ForecastStory | null;
  holdings: ReturnType<typeof holdingBalances>;
  dailyBurnByWallet: Array<[string, number]>;
  weekLanded: number;
  avgDaysToPayment: number | null;
  biggestDebtor: { name: string; total: number } | null;
  ytd: number;
  trailing30: number;
  // Phase 1.5 — IncomeStrip Week/Month/Year/Lifetime canonical 4 cells.
  // Lifetime sum of landed income across all time (PHT-aligned via the
  // same paid_at convention as landedInRange).
  lifetimeLanded: number;
  packRhythm: Awaited<ReturnType<typeof generatePackRhythm>> | null;
  lateNight: Awaited<ReturnType<typeof generateLateNightRead>> | null;
  // Phase 1.5 additions — ledger-derived metrics + warning signals.
  thirtyDayNet?: number;
  unaccountedOutflow30dBase?: number;
  walletDelta7dBase?: number;
  forecastSummary?: ForecastSummary | null;
  walletAnchorStaleSet?: Set<string>;
  // Per-wallet WarningResult map — carries the message + detailHref the
  // resolver decided on. The Set above remains for legacy callers that
  // only need the "did it fire?" boolean.
  walletAnchorStaleMap?: Map<string, WarningResult>;
  periodEndingSoon?: boolean;
  periodEndingSoonMessage?: string;
  // Real period concept lands in a future tier. Until then the State tab
  // hides the widget when this is null instead of shipping a stub.
  periodDaysRemaining?: number | null;
  recoveryInProgress?: boolean;
  recoveryProgress01?: number;
  recoveryStalled?: boolean;
  diaryRecent?: { entry_date: string; body: string; mood: number | null }[];
  // Body subtab — sleep + cigarettes per brief. Both currently null until
  // the underlying workflows wire (sleep echo / cigarettes counter).
  sleepLastNightHours?: number | null;
  sleepTrailing7dHours?: number | null;
  cigarettesToday?: number | null;
  cigarettesAvg7d?: number | null;
  openProjectsCount?: number;
  openPaymentsCount?: number;
  openPaymentsTotalBase?: number;
  closestProjectDueLabel?: string | null;
  lastClientName?: string | null;
  lastClientDaysAgo?: number | null;
  // Sadaka workflow (Phase 2). Loader reads finance.sadaka_ledger via
  // lib/sadaka/ledger.ts AND the cached sadaka_suggested_today brain so
  // the dashboard card reconciles with the Sadaka tab + Today widget.
  sadakaPoolBase?: number | null;
  sadakaConfigured?: boolean;
  sadakaSuggestedToday?: number;
  // Ledger reader degraded this render (e.g. read threw, ledger empty
  // mid-backfill, write-failures rows queued). Dashboard chrome surfaces a
  // calm banner instead of showing source-table math as if it were
  // canonical.
  dataDegraded?: boolean;
  // Active stats years for the editorial header chip strip. Computed once
  // by loadDashboardProps so every dashboard subtab shares one round-trip
  // for the chip set (the cache() dedup only helps within a single
  // request).
  activeYears?: number[];
};

export async function loadDashboardProps(): Promise<DashboardProps> {
  const {
    settings,
    projects,
    payments,
    rates,
    clients,
    methods,
    stepsByPayment,
    withdrawals,
    spends,
    spendCategories,
    spendCategoryLinks,
    recurring,
    recurringSkips,
    loanInstallments,
    openAiQuestions,
    plannedSpends,
    calmWeather: cachedCalmWeather,
  } = await getDashboardData();

  const currency = (settings?.base_currency ?? BASE_CURRENCY_FALLBACK) as CurrencyCode;
  const now = new Date();
  const recurringFee = methods.reduce((s, m) => s + monthlyFeeBase(m, rates), 0);

  const metrics = cashflowMetrics(payments, now, recurringFee, withdrawals, spends);

  // Phase 1.5: try the ledger reader first. When it has rows, holdingBalances
  // delegates to those values; otherwise it falls back to the source-table
  // math. Either way DashboardProps.holdings stays the canonical wallet
  // balance list every surface reads from.
  //
  // Failure is NOT silent: a read error logs to money_ledger_write_failures
  // with op='read' so the reconciliation pass + future "Dashboard data
  // degraded" banner can surface the drift to the user instead of
  // disappearing into an empty Map.
  let ledgerReadDegraded = false;
  const ledgerBalanceMap = await computeWalletBalancesFromLedger(methods).catch(
    (err) => {
      ledgerReadDegraded = true;
      const message = err instanceof Error ? err.message : String(err);
      void logLedgerReadFailure(`wallet-balance read: ${message}`);
      return new Map();
    },
  );
  const ledgerBalanceForChain = new Map<string, number>();
  for (const [k, v] of ledgerBalanceMap) ledgerBalanceForChain.set(k, v.balance);
  const holdings = holdingBalances(
    methods,
    payments,
    stepsByPayment,
    withdrawals,
    spends,
    ledgerBalanceForChain,
  );
  const walletTotal = Math.round(holdings.reduce((s, h) => s + h.balance, 0));

  const outstandingRows = outstanding(projects, payments, clients, rates);
  const outstandingTotal = Math.round(outstandingTotalBase(outstandingRows));

  const sts = computeSafeToSpendFromData(
    {
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
    },
    now,
  );

  const atlas = buildCashflowAtlas({
    payments,
    withdrawals,
    spends,
    recurring,
    recurringSkips,
    loanInstallments,
    plannedSpends,
    methods,
    stepsByPayment,
    rates,
    ledgerBalances: ledgerBalanceForChain,
    now,
    horizonDays: 90,
  });

  const calmWeather = await getCalmWeatherCached().catch(() => cachedCalmWeather ?? null);
  if (!calmWeather || new Date(calmWeather.expires_at).getTime() <= Date.now()) {
    void refreshCalmWeather({ force: false }).catch(() => {});
  }
  const forecastStory: ForecastStory | null = hasGemini()
    ? await generateForecastStory({
        payments,
        withdrawals,
        spends,
        recurring,
        recurringSkips,
        loanInstallments,
        plannedSpends,
        methods,
        stepsByPayment,
        rates,
        now,
      }).catch(() => null)
    : null;

  const landedSeries = dailySeries(payments, 30, now);
  const spentSeries = dailySpendSeries(spends, 30, now);

  const startOfWeek = new Date(`${phtMondayOfWeek(now)}T00:00:00+08:00`);
  const weekLanded = landedInRange(payments, startOfWeek, now);
  const startOfYear = new Date(`${now.getFullYear()}-01-01T00:00:00+08:00`);
  const ytd = landedInRange(payments, startOfYear, now);
  const trailing30 = landedInRange(payments, new Date(now.getTime() - 30 * DAY_MS), now);
  // Phase 1.5: lifetime landed = total landed income across all time. Sum
  // of net_amount_base across every landed payment. Same convention as
  // landedInRange (filters by paid_at) so the four cells stay consistent.
  const lifetimeLanded = payments
    .filter((p) => !!p.paid_at)
    .reduce((s, p) => s + Number(p.net_amount_base ?? 0), 0);
  const lags = projects
    .filter((p) => p.quoted_at && p.status === "paid")
    .map((p) => {
      const first = payments
        .filter((pay) => pay.project_id === p.id)
        .map((pay) => new Date(pay.paid_at).getTime())
        .sort((a, b) => a - b)[0];
      if (!first) return null;
      return Math.max(0, (first - new Date(p.quoted_at!).getTime()) / DAY_MS);
    })
    .filter((n): n is number => n !== null);
  const avgDaysToPayment = lags.length ? lags.reduce((a, b) => a + b, 0) / lags.length : null;

  const debtById = new Map<string, { name: string; total: number; oldestDays: number }>();
  for (const r of outstandingRows) {
    const name = r.client?.name ?? "Unknown";
    const e = debtById.get(r.project.client_id) ?? { name, total: 0, oldestDays: 0 };
    e.total += r.outstandingBase;
    if (r.daysAged > e.oldestDays) e.oldestDays = r.daysAged;
    debtById.set(r.project.client_id, e);
  }
  const biggestDebtor = Array.from(debtById.values()).sort((a, b) => b.total - a.total)[0] ?? null;

  const [packRhythm, lateNight] = await Promise.all([
    generatePackRhythm({
      spends,
      spendCategories,
      spendCategoryLinks,
      now,
    }).catch(() => null),
    generateLateNightRead({ spends, now }).catch(() => null),
  ]);

  const burnSumByWallet = new Map<string, number>();
  const burnStart = now.getTime() - 30 * DAY_MS;
  for (const s of spends) {
    const t = new Date(s.spent_at).getTime();
    if (t < burnStart || t > now.getTime()) continue;
    burnSumByWallet.set(
      s.wallet_id,
      (burnSumByWallet.get(s.wallet_id) ?? 0) + Number(s.amount_base ?? 0),
    );
  }
  const dailyBurnByWallet: Array<[string, number]> = Array.from(burnSumByWallet.entries()).map(
    ([k, v]) => [k, v / 30],
  );

  const alerts: AlertRow[] = [];

  const negatives = holdings
    .filter((h) => h.status === "over_overdraft")
    .sort((a, b) => a.balance - b.balance);
  for (const h of negatives) {
    alerts.push({
      kind: "negative-wallet",
      name: h.name,
      deficit: Math.abs(Math.round(h.balance)),
      href: "/payments",
    });
  }

  const dueSoon: {
    label: string;
    daysUntil: number;
    expectedBase: number;
    currency: CurrencyCode;
  }[] = [];
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  for (const r of recurring) {
    if (!r.active) continue;
    const settled = recurringSkips.some(
      (s) => s.recurring_spend_id === r.id && s.period_key === periodKey(r, now),
    );
    if (settled) continue;
    const anchor = anchorDate(r, now);
    anchor.setHours(0, 0, 0, 0);
    const daysUntil = Math.round((anchor.getTime() - today.getTime()) / DAY_MS);
    if (daysUntil < 0 || daysUntil > RECURRING_HORIZON_DAYS) continue;
    dueSoon.push({
      label: r.label,
      daysUntil,
      expectedBase: Math.round(expectedBase(r, rates)),
      currency: r.expected_currency as CurrencyCode,
    });
  }
  dueSoon
    .sort((a, b) => a.daysUntil - b.daysUntil)
    .slice(0, 3)
    .forEach((d) =>
      alerts.push({
        kind: "recurring-due",
        label: d.label,
        daysUntil: d.daysUntil,
        expectedBase: d.expectedBase,
        currency: d.currency,
        href: "/settings/recurring",
      }),
    );

  if (openAiQuestions.length > 0) {
    alerts.push({
      kind: "ai-questions",
      count: openAiQuestions.length,
      preview: openAiQuestions[0]?.question ?? null,
      href: "/today",
    });
  }

  // ─── Phase 1.5: ledger-derived metrics + warning signals ──────────────
  // 30d net from money_ledger and unaccounted_outflow tally for the
  // footnote. Fetched in one call when a user exists.
  let thirtyDayNet = 0;
  let unaccountedOutflow30dBase = 0;
  try {
    const supabase = await createClient();
    const user = await getAuthUser();
    if (user) {
      const since = new Date(now.getTime() - 30 * DAY_MS).toISOString();
      const { data: ledgerRows } = await supabase
        .from("money_ledger")
        .select("amount_base,kind")
        .eq("user_id", user.id)
        .is("archived_at", null)
        .gte("event_at", since);
      for (const row of ledgerRows ?? []) {
        const v = Number(row.amount_base ?? 0);
        thirtyDayNet += v;
        if (row.kind === "unaccounted_outflow" && v < 0) {
          unaccountedOutflow30dBase += Math.abs(v);
        }
      }
    }
  } catch {
    // Tolerate ledger-query failures — Phase 1.5 metrics degrade to 0.
  }
  // Approximate 7d wallet delta as the SUM of ledger movements in last 7d.
  const sevenDaysAgo = now.getTime() - 7 * DAY_MS;
  let walletDelta7dBase = 0;
  for (const sp of spends) {
    const t = new Date(sp.spent_at).getTime();
    if (t >= sevenDaysAgo && t <= now.getTime()) walletDelta7dBase -= Number(sp.amount_base ?? 0);
  }
  for (const p of payments) {
    const t = new Date(p.paid_at).getTime();
    if (t >= sevenDaysAgo && t <= now.getTime()) walletDelta7dBase += Number(p.net_amount_base ?? 0);
  }

  // Warnings: wallet anchor stale (>30d AND not overdraft-managed).
  const staleResolutions = resolveWalletAnchorStale({
    holdings: holdings.map((h) => {
      const method = methods.find((m) => m.id === h.methodId);
      return {
        methodId: h.methodId,
        name: h.name,
        anchorSetAt: (method?.opening_balance_set_at as string | null) ?? null,
        isOverdraftManaged: Number(method?.overdraft_tolerance_base ?? 0) > 0,
      };
    }),
    now,
  });
  const walletAnchorStaleSet = new Set<string>();
  const walletAnchorStaleMap = new Map<string, WarningResult>();
  for (const [id, res] of staleResolutions) {
    walletAnchorStaleMap.set(id, res);
    if (res.active) walletAnchorStaleSet.add(id);
  }

  // Scalar warnings (period / recovery / sadaka) resolved through the
  // central dispatcher. Period concept isn't wired yet, so periodEnd
  // passes null and the resolver returns inactive — no ghost pill.
  //
  // recovery_off_track + sadaka_pool_overdue branches are computed but the
  // dashboard data layer doesn't carry them on the props yet — Recovery
  // widget keeps its inline boolean for now (single source of truth lives
  // on the recovery period table once that lands), and Sadaka resolves
  // per-page in /dashboard/commitments. The dispatcher branches stay so
  // the future workflows wire in one place.
  // Pull the sadaka pool balance + suggested-today brain payload through
  // the canonical lib/sadaka readers. Both best-effort: a stale schema
  // (pre-migration 0073) returns zero/empty defaults without crashing.
  const { readPoolBalance: readSadakaPoolBalance } = await import("@/lib/sadaka/ledger");
  const { getSuggestedToday: getSadakaSuggestedToday } = await import("@/lib/sadaka/suggestion");
  const sadakaPool = await readSadakaPoolBalance().catch(() => ({
    rawBase: 0,
    displayBase: 0,
  }));
  const sadakaSuggestion = await getSadakaSuggestedToday().catch(() => ({
    suggested_amount: 0,
    reasoning: "",
    surface_today: false,
  }));

  const scalarWarnings = resolveAllWarnings({
    periodEnd: null,
    inRecovery: false,
    recoveryStalled: false,
    // Sadaka workflow is live once migrations 0071-0075 apply; the resolver
    // returns inactive when pool ≤ 0, so the dispatcher branch is safe to
    // arm unconditionally.
    sadakaWorkflowActive: true,
    sadakaPoolBase: sadakaPool.displayBase,
    sadakaGraceWindowDays: 0,
    now,
  });
  const periodWarning = scalarWarnings.period_ending_soon;

  // Forecast brain — Pro model, 24h cached. Best-effort.
  const forecastSummary = await getForecastSummary().catch(() => null);

  // Drift sentinel: if the reader threw OR there are unresolved write
  // failures, mark the data as degraded so the dashboard chrome can flag
  // it. Single targeted read against the failures table; cheap.
  let dataDegraded = ledgerReadDegraded;
  if (!dataDegraded) {
    try {
      const supabase = await createClient();
      const user = await getAuthUser();
      if (user) {
        const { data: failures } = await supabase
          .from("money_ledger_write_failures")
          .select("id")
          .eq("user_id", user.id)
          .is("resolved_at", null)
          .limit(1);
        if ((failures ?? []).length > 0) dataDegraded = true;
      }
    } catch {
      // Failures table missing on a stale schema — non-fatal.
    }
  }

  // /dashboard/commitments support data.
  const openProjects = projects.filter(
    (p) => p.status === "unpaid" || p.status === "partially_paid",
  );
  const openProjectsCount = openProjects.length;
  const closestProject = [...openProjects]
    .filter((p) => p.due_date)
    .sort(
      (a, b) =>
        new Date(a.due_date as string).getTime() -
        new Date(b.due_date as string).getTime(),
    )[0];
  const closestProjectDueLabel = closestProject?.title ?? null;
  const openPaymentsCount = outstandingRows.length;
  const openPaymentsTotalBase = outstandingTotal;

  // Last-touched client = most recent payment.
  let lastClientName: string | null = null;
  let lastClientDaysAgo: number | null = null;
  if (payments.length > 0) {
    const mostRecent = [...payments].sort(
      (a, b) => new Date(b.paid_at).getTime() - new Date(a.paid_at).getTime(),
    )[0];
    const project = projects.find((p) => p.id === mostRecent.project_id);
    const client = project ? clients.find((c) => c.id === project.client_id) : undefined;
    lastClientName = client?.name ?? null;
    const diff = (now.getTime() - new Date(mostRecent.paid_at).getTime()) / DAY_MS;
    lastClientDaysAgo = Math.round(diff);
  }

  // Diary widget (Body tab).
  let diaryRecent: { entry_date: string; body: string; mood: number | null }[] = [];
  // Sleep widget (Body tab) — driven by finance.morning_log.slept_hours.
  let sleepLastNightHours: number | null = null;
  let sleepTrailing7dHours: number | null = null;
  // Cigarettes widget (Body tab) — stick count via spend_items.quantity on
  // cigarette-category rows. Trailing 7d / today windowing matches the
  // existing late-night-cluster + pack-rhythm conventions.
  let cigarettesToday: number | null = null;
  let cigarettesAvg7d: number | null = null;
  try {
    const supabase = await createClient();
    const user = await getAuthUser();
    if (user) {
      const sinceIso7d = new Date(now.getTime() - 7 * DAY_MS).toISOString();
      const [
        { data: diaryRows },
        { data: morningRows },
      ] = await Promise.all([
        supabase
          .from("diary_entries")
          .select("entry_date,body,mood")
          .eq("user_id", user.id)
          .order("entry_date", { ascending: false })
          .limit(3),
        supabase
          .from("morning_log")
          .select("recorded_at,slept_hours")
          .eq("user_id", user.id)
          .order("recorded_at", { ascending: false })
          .limit(7),
      ]);
      diaryRecent = (diaryRows ?? []).map((r) => ({
        entry_date: r.entry_date as string,
        body: (r.body as string) ?? "",
        mood: (r.mood as number | null) ?? null,
      }));
      const morning = (morningRows ?? []) as {
        recorded_at: string;
        slept_hours: number | null;
      }[];
      if (morning.length > 0) {
        sleepLastNightHours = Number(morning[0].slept_hours ?? 0) || null;
        const valid = morning.filter((m) => Number(m.slept_hours ?? 0) > 0);
        sleepTrailing7dHours = valid.length
          ? valid.reduce((s, m) => s + Number(m.slept_hours ?? 0), 0) / valid.length
          : null;
      }

      // Cigarettes — sum spend_items.quantity on cigarette-category rows.
      // Best-effort; if no cigarettes category exists the widget falls
      // back to a null hero and the relevance gate hides it.
      try {
        const { data: cigCats } = await supabase
          .from("spend_categories")
          .select("id,name")
          .eq("user_id", user.id);
        const cigCategoryIds = ((cigCats ?? []) as { id: string; name: string }[])
          .filter((c) => /cig|smok|pack/i.test(c.name))
          .map((c) => c.id);
        if (cigCategoryIds.length > 0) {
          const { data: linkRows } = await supabase
            .from("spend_category_links")
            .select("spend_id")
            .in("category_id", cigCategoryIds);
          const spendIds = Array.from(
            new Set(((linkRows ?? []) as { spend_id: string }[]).map((r) => r.spend_id)),
          );
          if (spendIds.length > 0) {
            const { data: spendsForCigs } = await supabase
              .from("spends")
              .select("id,spent_at")
              .in("id", spendIds)
              .gte("spent_at", sinceIso7d);
            const cigSpendIds = ((spendsForCigs ?? []) as {
              id: string;
              spent_at: string;
            }[]);
            if (cigSpendIds.length > 0) {
              const { data: items } = await supabase
                .from("spend_items")
                .select("spend_id,quantity")
                .in(
                  "spend_id",
                  cigSpendIds.map((s) => s.id),
                );
              const qtyBySpend = new Map<string, number>();
              for (const it of (items ?? []) as { spend_id: string; quantity: number | null }[]) {
                qtyBySpend.set(
                  it.spend_id,
                  (qtyBySpend.get(it.spend_id) ?? 0) + Number(it.quantity ?? 0),
                );
              }
              let trailing7Total = 0;
              let todayTotal = 0;
              const phtToday = new Date(now.getTime()).toISOString().slice(0, 10);
              for (const s of cigSpendIds) {
                const q = qtyBySpend.get(s.id) ?? 0;
                trailing7Total += q;
                if ((s.spent_at as string).slice(0, 10) === phtToday) todayTotal += q;
              }
              cigarettesToday = todayTotal;
              cigarettesAvg7d = trailing7Total / 7;
            }
          }
        }
      } catch {
        // Tolerate cigarette-query failures.
      }
    }
  } catch {
    // Tolerate diary / morning_log query failures.
  }

  return {
    firstName: settings?.issuer_name?.split(" ")[0] ?? null,
    currency,
    hasClients: clients.length > 0,
    year: now.getFullYear(),
    landedMtd: Math.round(metrics.mtd),
    spentMtd: Math.round(metrics.spentMtd),
    feesMtd: Math.round(metrics.feesMtd),
    outstandingTotal,
    walletTotal,
    safeToday: Math.round(sts.safeTodayBase),
    landedSeries,
    spentSeries,
    alerts: alerts.slice(0, ALERT_LIMIT),
    calmWeather,
    atlas,
    forecastStory,
    holdings,
    dailyBurnByWallet,
    weekLanded: Math.round(weekLanded),
    avgDaysToPayment,
    biggestDebtor: biggestDebtor
      ? { name: biggestDebtor.name, total: Math.round(biggestDebtor.total) }
      : null,
    ytd: Math.round(ytd),
    trailing30: Math.round(trailing30),
    lifetimeLanded: Math.round(lifetimeLanded),
    packRhythm,
    lateNight,
    thirtyDayNet: Math.round(thirtyDayNet),
    unaccountedOutflow30dBase: Math.round(unaccountedOutflow30dBase),
    walletDelta7dBase: Math.round(walletDelta7dBase),
    forecastSummary,
    walletAnchorStaleSet,
    walletAnchorStaleMap,
    periodEndingSoon: !!periodWarning?.active,
    periodEndingSoonMessage: periodWarning?.message,
    periodDaysRemaining: null,
    recoveryInProgress: false,
    recoveryProgress01: 0,
    recoveryStalled: false,
    diaryRecent,
    sleepLastNightHours,
    sleepTrailing7dHours,
    cigarettesToday,
    cigarettesAvg7d,
    openProjectsCount,
    openPaymentsCount,
    openPaymentsTotalBase,
    closestProjectDueLabel,
    lastClientName,
    lastClientDaysAgo,
    sadakaPoolBase: sadakaPool.displayBase,
    sadakaConfigured: true,
    sadakaSuggestedToday: sadakaSuggestion.suggested_amount,
    dataDegraded,
    activeYears: await getDashboardActiveYears().catch(() => [] as number[]),
  };
}

function dailySpendSeries(spends: Spend[], days: number, now: Date): number[] {
  const out = new Array(days).fill(0);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  for (const sp of spends) {
    const d = new Date(sp.spent_at);
    const idx = Math.floor((d.getTime() - start.getTime()) / DAY_MS);
    if (idx >= 0 && idx < days) out[idx] += Number(sp.amount_base ?? 0);
  }
  return out;
}

// ─── Chatbot context ────────────────────────────────────────────────
//
// Dashboard subtabs share most of the fan-out, but each subtab is its own
// surface — the brain should know whether the user is staring at Money,
// Commitments, State, or Body. Single fetcher, subtab-aware question +
// data shape.

import {
  pageKeyFromPath,
  registerChatbotContext,
  type PageContext,
} from "@/lib/data/chat-context-registry";

const DASHBOARD_TABS = ["money", "commitments", "state", "body"] as const;
type DashboardTab = (typeof DASHBOARD_TABS)[number];

const TAB_QUESTIONS: Record<DashboardTab, string> = {
  money: "How is the month shaping up?",
  commitments: "What's already promised between now and next payday?",
  state: "What landed recently and what's still open?",
  body: "How does cigarettes + cost-of-living read this month?",
};

export async function loadDashboardChatbotContext(
  _userId: string,
  tab: DashboardTab,
): Promise<PageContext> {
  // Reuse the same fan-out the page already loads — costs nothing extra
  // because the per-request supabase memoization handles the dedup.
  const props = await loadDashboardProps();
  return {
    page: `dashboard.${tab}`,
    surface: `/dashboard/${tab}`,
    primaryQuestion: TAB_QUESTIONS[tab],
    relevantData: {
      tab,
      landedMtd: props.landedMtd,
      spentMtd: props.spentMtd,
      feesMtd: props.feesMtd,
      outstandingTotal: props.outstandingTotal,
      walletTotal: props.walletTotal,
      safeToday: props.safeToday,
      weekLanded: props.weekLanded,
      trailing30: props.trailing30,
      ytd: props.ytd,
      holdings: props.holdings.map((h) => ({
        name: h.name,
        balance: Math.round(h.balance),
        status: h.status,
      })),
      forecastVerdict:
        props.forecastStory && "verdict" in props.forecastStory
          ? (props.forecastStory as { verdict?: string }).verdict
          : null,
    },
    suggestPills: true,
  };
}

for (const tab of DASHBOARD_TABS) {
  registerChatbotContext({
    match: (path) => pageKeyFromPath(path) === `dashboard.${tab}`,
    fetch: (userId) => loadDashboardChatbotContext(userId, tab),
  });
}
// Bare /dashboard also resolves to the money tab so the chatbot always
// has a meaningful question to surface.
registerChatbotContext({
  match: (path) => pageKeyFromPath(path) === "dashboard",
  fetch: (userId) => loadDashboardChatbotContext(userId, "money"),
});

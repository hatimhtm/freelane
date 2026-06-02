// Shared payments data loader. Lifted out of the old monolithic
// /payments/page.tsx so each subtab page (Wallets/Withdrawals/History)
// can call the same pipeline and pass the same props to PaymentsView
// with only the per-tab "tab" flag differing.

import { getPaymentsData, getWalletPlatformMetadata } from "@/lib/data/queries";
import {
  paymentFee,
  chainSignature,
  sortedSteps,
  finalStep,
  holdingBalances,
} from "@/lib/payment-chain";
import { computeWalletBalancesFromLedger } from "@/lib/data/wallet-balance";
import { logLedgerReadFailure } from "@/lib/data/money-ledger";
import { resolveWalletAnchorStale } from "@/lib/warnings/registry";
import { BASE_CURRENCY_FALLBACK } from "@/lib/constants";
import type {
  CurrencyCode,
  PaymentMethod,
  WalletPlatformMetadataRow,
} from "@/lib/supabase/types";
import type { WarningResult } from "@/lib/warnings/registry";
import type {
  PaymentRow,
  ChainStepView,
  WithdrawalRow,
  HoldingRow,
} from "./payments-view";

export type PaymentsPageProps = Omit<
  Parameters<typeof import("./payments-view").PaymentsView>[0],
  "tab"
>;

export async function loadPaymentsProps(params: {
  new?: string;
  project?: string;
  withdraw?: string;
}): Promise<PaymentsPageProps> {
  const { payments, stepsByPayment, projects, clients, rates, methods, settings, currencies, withdrawals } =
    await getPaymentsData();
  const currency = (settings?.base_currency ?? BASE_CURRENCY_FALLBACK) as CurrencyCode;

  const methodsById = new Map<string, PaymentMethod>(methods.map((m) => [m.id, m]));
  const projectsById = new Map(projects.map((p) => [p.id, p]));
  const clientsById = new Map(clients.map((c) => [c.id, c]));

  // Project status mapping — Freelane stores "partially_paid" but the
  // History filter chip surfaces the shorter "partial" label, so the
  // PaymentRow.projectStatus discriminant collapses to paid / partial /
  // pending. "archived" projects show as "pending" because the chip set
  // is for active filtering, not bookkeeping.
  const statusOf = (raw: string | null | undefined): "paid" | "partial" | "pending" => {
    if (raw === "paid") return "paid";
    if (raw === "partially_paid") return "partial";
    return "pending";
  };

  const rows: PaymentRow[] = payments.map((p) => {
    const steps = sortedSteps(stepsByPayment.get(p.id) ?? []);
    const project = projectsById.get(p.project_id);
    const client = project ? clientsById.get(project.client_id) : undefined;
    const { fee, pct, net, gross } = paymentFee(p);
    const landingId = finalStep(steps)?.method_id ?? null;
    const sourceId = steps[0]?.from_method_id ?? null;
    const nameOf = (id: string | null) => (id ? methodsById.get(id)?.name ?? "Untagged" : null);
    const brandOf = (id: string | null) => (id ? methodsById.get(id)?.brand_key ?? null : null);
    return {
      id: p.id,
      projectTitle: project?.title ?? "—",
      clientName: client?.name ?? "—",
      paidAt: p.paid_at,
      amountIn: Number(p.amount),
      currencyIn: p.currency as CurrencyCode,
      netBase: net,
      grossBase: gross,
      feeBase: fee,
      feePct: pct,
      methodId: landingId,
      fromMethodId: sourceId,
      landingName: landingId ? methodsById.get(landingId)?.name ?? "Untagged" : "Untagged",
      landingBrandKey: landingId ? brandOf(landingId) : null,
      feeUnknown: p.fee_unknown ?? false,
      signature: chainSignature(steps, methodsById),
      steps: steps.map<ChainStepView>((s) => ({
        order: s.step_order,
        fromName: nameOf(s.from_method_id),
        toName: nameOf(s.method_id) ?? "Untagged",
        fromBrandKey: brandOf(s.from_method_id),
        toBrandKey: brandOf(s.method_id),
        amountIn: Number(s.amount_in),
        currencyIn: s.currency_in as CurrencyCode,
        amountOut: Number(s.amount_out),
        currencyOut: s.currency_out as CurrencyCode,
      })),
      projectStatus: statusOf(project?.status),
    };
  });

  // Phase 1.5: ledger reader first. /payments doesn't load `spends`, so we
  // pass an empty array — the ledger short-circuit moots the spends arg for
  // wallets the reader covers, and for uncovered wallets the spends-based
  // math diverges from /spending and /today (drift, but only on wallets
  // outside the ledger window).
  const paymentsLedgerBalanceMap = await computeWalletBalancesFromLedger(methods).catch(
    (err) => {
      const message = err instanceof Error ? err.message : String(err);
      void logLedgerReadFailure(`payments wallet-balance read: ${message}`);
      return new Map();
    },
  );
  const paymentsLedgerBalanceForChain = new Map<string, number>();
  for (const [k, v] of paymentsLedgerBalanceMap) paymentsLedgerBalanceForChain.set(k, v.balance);
  const holdingsRaw = holdingBalances(
    methods,
    payments,
    stepsByPayment,
    withdrawals,
    [],
    paymentsLedgerBalanceForChain,
  );
  // Decorate each holding row with the wallet's brand_key + name so the
  // S-widget grid can resolveWalletBrand without re-doing the join.
  const holdings: HoldingRow[] = holdingsRaw.map((h) => ({
    ...h,
    brandKey: methodsById.get(h.methodId)?.brand_key ?? null,
  }));
  const balanceByMethod = new Map(holdings.map((h) => [h.methodId, h.balance]));

  // Per-wallet stale-anchor warning. Mirrors the dashboard wallet-stack
  // — overdraft-managed wallets (CFG) within tolerance never warn.
  // anchorEntries built once so both the warning resolver and the detail
  // sheet pull from the same source of truth.
  const anchorEntries = methods
    .filter((m) => m.is_holding)
    .map((m) => ({
      methodId: m.id,
      name: m.name,
      anchorSetAt: m.opening_balance_set_at ?? m.opening_balance_at ?? null,
      // CFG account's overdraft tolerance > 0 means anchor staleness is
      // tracked elsewhere; suppress the stale-anchor warning so a
      // healthy CFG never paints a needless pill.
      isOverdraftManaged: (m.overdraft_tolerance_base ?? 0) > 0,
    }));
  const walletWarnings: Map<string, WarningResult> = resolveWalletAnchorStale({
    now: new Date(),
    holdings: anchorEntries,
  });
  const anchorSetAtByMethod = new Map<string, string | null>(
    anchorEntries.map((e) => [e.methodId, e.anchorSetAt]),
  );

  const withdrawalRows: WithdrawalRow[] = withdrawals.map((w) => {
    const g = Number(w.gross_base ?? 0);
    const f = Number(w.fee_base ?? 0);
    return {
      id: w.id,
      fromName: w.from_method_id ? methodsById.get(w.from_method_id)?.name ?? "Untagged" : "Untagged",
      fromBrandKey: w.from_method_id ? methodsById.get(w.from_method_id)?.brand_key ?? null : null,
      toName: w.to_method_id ? methodsById.get(w.to_method_id)?.name ?? null : null,
      toBrandKey: w.to_method_id ? methodsById.get(w.to_method_id)?.brand_key ?? null : null,
      withdrawnAt: w.withdrawn_at,
      grossBase: g,
      netBase: Number(w.net_base ?? 0),
      feeBase: f,
      feePct: g > 0 ? f / g : 0,
    };
  });

  const outstandingByProject = new Map<string, number>();
  for (const p of projects) {
    const paid = payments
      .filter((pay) => pay.project_id === p.id && pay.currency === p.currency)
      .reduce((s, pay) => s + Number(pay.amount), 0);
    outstandingByProject.set(p.id, Math.max(0, Number(p.amount) - paid));
  }
  const toOpt = (p: (typeof projects)[number]) => ({
    id: p.id,
    title: p.title,
    currency: p.currency as CurrencyCode,
    clientName: clientsById.get(p.client_id)?.name ?? "",
    outstanding: outstandingByProject.get(p.id) ?? 0,
  });

  const openProjects = projects
    .filter((p) => p.status === "unpaid" || p.status === "partially_paid")
    .map(toOpt);
  const allProjects = projects.map(toOpt);

  const activeMethods = methods.filter((m) => !m.archived);
  const holdingMethodOpts = activeMethods
    .filter((m) => m.is_holding)
    .map((m) => ({ id: m.id, name: m.name, balance: balanceByMethod.get(m.id) ?? 0 }));
  const cashMethod = activeMethods.find((m) => m.name.toLowerCase() === "cash");

  return {
    rows,
    currency,
    methods: activeMethods.map((m) => ({ id: m.id, name: m.name, brandKey: m.brand_key })),
    holdings,
    walletWarnings,
    anchorSetAtByMethod,
    withdrawals: withdrawalRows,
    holdingMethods: holdingMethodOpts,
    cashMethodId: cashMethod?.id,
    openProjects,
    allProjects,
    allCurrencies: currencies.map((c) => c.code),
    rates: rates.map((r) => ({ code: r.code, rate_to_base: Number(r.rate_to_base) })),
    openNew: params.new === "1" || !!params.project,
    openWithdraw: params.withdraw === "1",
    defaultProjectId: params.project,
  };
}

// ─── Chatbot context (Payments — Brand Identity workflow) ──
//
// Per-subtab context fetcher. The chatbot asks the user's situation per
// surface, so each subtab gets its own question. Wallet platform metadata
// (the deleted on-page leaderboard's data) flows in here so the chatbot
// can answer "cheapest way to get paid" / "should I withdraw via X?"
// without a wide card on the page.

import {
  pageKeyFromPath,
  registerChatbotContext,
  type PageContext,
} from "@/lib/data/chat-context-registry";

const PAYMENTS_SUBTABS = ["wallets", "withdrawals", "history"] as const;
type PaymentsSubtab = (typeof PAYMENTS_SUBTABS)[number];

const SUBTAB_QUESTIONS: Record<PaymentsSubtab, string> = {
  wallets: "Which wallet should I move money out of next?",
  withdrawals: "What's the cheapest rail to withdraw on right now?",
  history: "How is the fee on my recent payments trending?",
};

const BARE_QUESTION = "Which payment rail should I lean on right now?";

// Lean slice used by the chatbot. Skips warning resolution, project
// outstanding math, openProjects/allProjects mapping — the chatbot only
// needs methods + holdings + 5 recent withdrawals + 5 recent payments.
// Saves several queries per chatbot open across all 4 registered routes.
async function loadPaymentsChatbotSlice() {
  const { payments, stepsByPayment, methods, settings, withdrawals } =
    await getPaymentsData();
  const currency = (settings?.base_currency ?? BASE_CURRENCY_FALLBACK) as CurrencyCode;
  const methodsById = new Map<string, PaymentMethod>(methods.map((m) => [m.id, m]));

  const paymentsLedgerBalanceMap = await computeWalletBalancesFromLedger(methods).catch(
    (err) => {
      const message = err instanceof Error ? err.message : String(err);
      void logLedgerReadFailure(`payments chatbot wallet-balance read: ${message}`);
      return new Map();
    },
  );
  const paymentsLedgerBalanceForChain = new Map<string, number>();
  for (const [k, v] of paymentsLedgerBalanceMap) paymentsLedgerBalanceForChain.set(k, v.balance);
  const holdingsRaw = holdingBalances(
    methods,
    payments,
    stepsByPayment,
    withdrawals,
    [],
    paymentsLedgerBalanceForChain,
  );
  const holdings = holdingsRaw.map((h) => ({
    name: h.name,
    brandKey: methodsById.get(h.methodId)?.brand_key ?? null,
    balance: Math.round(h.balance),
    status: h.status,
  }));

  const recentWithdrawals = withdrawals.slice(0, 5).map((w) => {
    const g = Number(w.gross_base ?? 0);
    const f = Number(w.fee_base ?? 0);
    return {
      id: w.id,
      fromName: w.from_method_id ? methodsById.get(w.from_method_id)?.name ?? "Untagged" : "Untagged",
      toName: w.to_method_id ? methodsById.get(w.to_method_id)?.name ?? null : null,
      withdrawnAt: w.withdrawn_at,
      grossBase: Math.round(g),
      netBase: Math.round(Number(w.net_base ?? 0)),
      feeBase: Math.round(f),
      feeFraction: Number((g > 0 ? f / g : 0).toFixed(4)),
    };
  });

  const recentPayments = payments.slice(0, 5).map((p) => {
    const { fee, net, gross } = paymentFee(p);
    const steps = sortedSteps(stepsByPayment.get(p.id) ?? []);
    const landingId = finalStep(steps)?.method_id ?? null;
    return {
      id: p.id,
      paidAt: p.paid_at,
      netBase: Math.round(net),
      feeBase: Math.round(fee),
      feeFraction: Number((gross > 0 ? fee / gross : 0).toFixed(4)),
      landingName: landingId ? methodsById.get(landingId)?.name ?? "Untagged" : "Untagged",
    };
  });

  const brandKeys = Array.from(
    new Set(
      methods
        .map((m) => m.brand_key)
        .filter((k): k is string => typeof k === "string" && k.length > 0),
    ),
  );

  return { currency, brandKeys, holdings, recentWithdrawals, recentPayments };
}

export async function loadPaymentsChatbotContext(
  _userId: string,
  subtab: PaymentsSubtab | null,
): Promise<PageContext> {
  const slice = await loadPaymentsChatbotSlice();
  const platformMetadata: WalletPlatformMetadataRow[] = slice.brandKeys.length
    ? await getWalletPlatformMetadata(slice.brandKeys).catch(() => [])
    : [];
  const platformByBrand: Record<string, WalletPlatformMetadataRow> = {};
  for (const row of platformMetadata) platformByBrand[row.brand_key] = row;

  // Brain payload uses `feeFraction` (a [0,1] fraction) so it shares units
  // with WalletPlatformMetadataRow.typical_fee_fraction. The view-side
  // PaymentRow / WithdrawalRow still use `feePct` because that name is
  // baked into rendering helpers; only the chatbot-context shape is
  // disambiguated here.
  const surface = subtab ? `/payments/${subtab}` : "/payments";
  const page = subtab ? `payments.${subtab}` : "payments";
  const question = subtab ? SUBTAB_QUESTIONS[subtab] : BARE_QUESTION;

  return {
    page,
    surface,
    primaryQuestion: question,
    relevantData: {
      subtab,
      currency: slice.currency,
      holdings: slice.holdings,
      walletPlatformMetadata: platformByBrand,
      recentWithdrawals: slice.recentWithdrawals,
      recentPayments: slice.recentPayments,
    },
    suggestPills: true,
  };
}

// Side-effect registration at module evaluation. This only fires if this
// module is imported; chat-context-registry.ts (src/lib/data) statically
// imports it on every chatbot resolution path. DO NOT lazy-load this
// module — if it isn't evaluated before the chatbot opens on a non-
// payments page, the registry will be missing every payments fetcher and
// /payments routes will silently fall back to DEFAULT_CONTEXT.
for (const subtab of PAYMENTS_SUBTABS) {
  registerChatbotContext({
    match: (path) => pageKeyFromPath(path) === `payments.${subtab}`,
    fetch: (userId) => loadPaymentsChatbotContext(userId, subtab),
  });
}
registerChatbotContext({
  match: (path) => pageKeyFromPath(path) === "payments",
  fetch: (userId) => loadPaymentsChatbotContext(userId, null),
});

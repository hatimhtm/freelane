import "server-only";

import { getDashboardData } from "@/lib/data/queries";
import { computeSafeToSpendFromData } from "@/lib/safe-to-spend";
import { holdingBalances } from "@/lib/payment-chain";
import { computeWalletBalancesFromLedger } from "@/lib/data/wallet-balance";
import { logLedgerReadFailure } from "@/lib/data/money-ledger";
import {
  pageKeyFromPath,
  registerChatbotContext,
  type PageContext,
} from "@/lib/data/chat-context-registry";
import { phtToday } from "@/lib/utils";

// Today's chatbot context. Reuses the same fan-out (getDashboardData +
// computeSafeToSpendFromData) the Today page itself loads, so the chatbot
// sees exactly what the user sees — no second source of truth.

async function buildTodayContext(_userId: string): Promise<PageContext> {
  const data = await getDashboardData();
  // Phase 1.5: ledger reader first; fall through to source-table math on
  // miss. Threaded through safe-to-spend + holdingBalances so the chatbot
  // sees the same canonical wallet truth as the Today surface.
  const todayCtxLedgerBalanceMap = await computeWalletBalancesFromLedger(data.methods).catch(
    (err) => {
      const message = err instanceof Error ? err.message : String(err);
      void logLedgerReadFailure(`today-chatbot wallet-balance read: ${message}`);
      return new Map();
    },
  );
  const todayCtxLedgerBalanceForChain = new Map<string, number>();
  for (const [k, v] of todayCtxLedgerBalanceMap) todayCtxLedgerBalanceForChain.set(k, v.balance);
  const sts = computeSafeToSpendFromData({
    payments: data.payments,
    withdrawals: data.withdrawals,
    spends: data.spends,
    recurring: data.recurring,
    recurringSkips: data.recurringSkips,
    loanInstallments: data.loanInstallments,
    methods: data.methods,
    stepsByPayment: data.stepsByPayment,
    rates: data.rates,
    plannedSpends: data.plannedSpends,
    ledgerBalances: todayCtxLedgerBalanceForChain,
    // Migration 0089 — strategy reduction. Chatbot must see the same
    // Daily Safe the headlines show; otherwise it quotes a number that
    // contradicts the dial.
    activePlanStrategies: data.activePlanStrategies,
  });
  const holdings = holdingBalances(
    data.methods,
    data.payments,
    data.stepsByPayment,
    data.withdrawals,
    data.spends,
    todayCtxLedgerBalanceForChain,
  );
  const today = phtToday();
  const todaySpends = data.spends.filter(
    (s) => String(s.spent_at).slice(0, 10) === today,
  );
  const spentTodayBase = todaySpends.reduce(
    (sum, s) => sum + Number(s.amount_base ?? 0),
    0,
  );

  return {
    page: "today",
    surface: "/today",
    primaryQuestion: "What changed today, and what should I steer?",
    relevantData: {
      safeTodayBase: Math.round(sts.safeTodayBase),
      dailyAllowanceBase: Math.round(sts.dailyAllowanceBase),
      inRecovery: sts.inRecovery,
      spentTodayBase: Math.round(spentTodayBase),
      spendsToday: todaySpends.length,
      holdings: holdings.map((h) => ({
        name: h.name,
        balance: Math.round(h.balance),
        status: h.status,
      })),
    },
    suggestPills: true,
  };
}

export async function loadTodayChatbotContext(
  userId: string,
): Promise<PageContext> {
  return buildTodayContext(userId);
}

// Self-register so chat-context-registry picks this up at module load.
registerChatbotContext({
  match: (path) => pageKeyFromPath(path) === "today",
  fetch: buildTodayContext,
});

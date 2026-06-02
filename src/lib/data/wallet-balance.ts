"use server";

import { createClient } from "@/lib/supabase/server";
import type { PaymentMethod } from "@/lib/supabase/types";
import { walletStatus, type HoldingBalanceRow } from "@/lib/payment-chain";

// Freelane: canonical wallet-balance reader for the new Dashboard widgets
// (Phase 1.5).
//
// SCOPE: this reader is the source for the new /dashboard/money tiles and
// the forecast-summary brain. The wider rollout to /today, /spending,
// /payments, /plans, and the safe-to-spend math still routes through
// payment-chain.ts::holdingBalances() — which delegates to the values
// produced here when a ledger map is passed in (dashboard-data.ts:118).
//
// FORMULA:
//
//   balance(w) = opening_balance_base
//              + SUM(amount_base) WHERE wallet_id=w
//                                  AND archived_at IS NULL
//                                  AND event_at >= opening_balance_set_at
//
// IMPLEMENTATION: one fan-out query per wallet (parallel) so the
// money_ledger_user_wallet_event_idx index handles the anchor cutoff in
// SQL rather than scanning every row in JS. Cheap for a single-user app
// with thousands of rows, and matches the index's intent.
//
// CAVEAT: when no ledger rows exist for the user (fresh install, or before
// 0068 has run), this returns an empty map. payment-chain.ts's
// holdingBalances() delegation handles that fallback path explicitly.

export type LedgerWalletBalance = {
  methodId: string;
  balance: number;
  ledgerSumSinceAnchor: number;
};

// Returns one entry per holding wallet. The methods array is passed in so
// the caller stays in control of which wallets to consider (matches the
// existing holdingBalances() signature).
export async function computeWalletBalancesFromLedger(
  methods: PaymentMethod[],
): Promise<Map<string, LedgerWalletBalance>> {
  const out = new Map<string, LedgerWalletBalance>();
  const holding = methods.filter((m) => m.is_holding);
  if (holding.length === 0) return out;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return out;

  // Per-wallet anchor cutoff resolved once. The reader prefers
  // opening_balance_set_at (timestamptz, 0049) and falls back to
  // opening_balance_at (date) when the timestamp is null. When BOTH are
  // null no anchor exists — every row counts.
  const anchorByWallet = new Map<string, string | null>();
  for (const m of holding) {
    const ts = (m.opening_balance_set_at as string | null) ?? null;
    if (ts) {
      anchorByWallet.set(m.id, ts);
      continue;
    }
    const d = (m.opening_balance_at as string | null) ?? null;
    if (d) {
      // Legacy date-only anchor → PHT-midnight on the anchor day. 0068
      // stamps backfill rows at PHT noon (date + 12h) so anything ON the
      // anchor day MUST count. An end-of-day cutoff would silently drop
      // the noon-stamped row and the wallet would appear under-credited.
      anchorByWallet.set(m.id, `${d.slice(0, 10)}T00:00:00+08:00`);
    } else {
      anchorByWallet.set(m.id, null);
    }
  }

  // Fire one indexed range scan per wallet — the
  // money_ledger_user_wallet_event_idx covers
  // (user_id, wallet_id, event_at desc), so a .gte('event_at', anchor)
  // filter resolves to a single index range. All wallets fan out in
  // parallel via Promise.all.
  const queries = holding.map(async (m) => {
    const anchor = anchorByWallet.get(m.id) ?? null;
    let query = supabase
      .from("money_ledger")
      .select("amount_base")
      .eq("user_id", user.id)
      .eq("wallet_id", m.id)
      .is("archived_at", null);
    if (anchor) {
      query = query.gte("event_at", anchor);
    }
    const { data } = await query;
    let sum = 0;
    for (const row of data ?? []) {
      sum += Number(row.amount_base ?? 0);
    }
    return [m.id, sum] as const;
  });

  const settled = await Promise.all(queries);

  for (const m of holding) {
    const sum = settled.find(([id]) => id === m.id)?.[1] ?? 0;
    const opening = Number(m.opening_balance_base ?? 0);
    out.set(m.id, {
      methodId: m.id,
      ledgerSumSinceAnchor: sum,
      balance: opening + sum,
    });
  }
  return out;
}

// HoldingBalanceRow-compatible shape derived ONLY from the ledger reader.
// The received/withdrawn/spent breakdown is reconstructed from the
// ledger's signed amounts split by related_kind so callers that render a
// per-wallet in/out summary stay accurate. Where the legacy source-table
// math diverges (rare, drift-only), holdingBalances() remains the
// reconciliation entry point — but the ledger reader is no longer silently
// returning zeros for the breakdown fields.
export async function getWalletBalanceRowsFromLedger(
  methods: PaymentMethod[],
): Promise<HoldingBalanceRow[]> {
  const balances = await computeWalletBalancesFromLedger(methods);
  if (balances.size === 0) return [];
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const out: HoldingBalanceRow[] = [];
  for (const m of methods) {
    if (!m.is_holding) continue;
    const entry = balances.get(m.id);
    if (!entry) continue;
    const opening = Number(m.opening_balance_base ?? 0);
    const tolerance = Number(m.overdraft_tolerance_base ?? 0);

    // Derive received/withdrawn/spent from the same ledger window the
    // balance came from. Split is by related_kind so the breakdown stays
    // honest about WHERE the movement came from.
    const anchorTs = (m.opening_balance_set_at as string | null) ?? null;
    const dateAnchor = (m.opening_balance_at as string | null) ?? null;
    const effectiveAnchor = anchorTs
      ? anchorTs
      : dateAnchor
        ? `${dateAnchor.slice(0, 10)}T00:00:00+08:00`
        : null;

    let query = supabase
      .from("money_ledger")
      .select("amount_base,related_kind")
      .eq("user_id", user.id)
      .eq("wallet_id", m.id)
      .is("archived_at", null);
    if (effectiveAnchor) query = query.gte("event_at", effectiveAnchor);
    const { data: rows } = await query;

    let received = 0;
    let withdrawn = 0;
    let spent = 0;
    for (const row of rows ?? []) {
      const v = Number(row.amount_base ?? 0);
      const rk = row.related_kind as string | null;
      if (rk === "payment" && v > 0) received += v;
      else if (rk === "withdrawal" && v < 0) withdrawn += Math.abs(v);
      else if (rk === "spend" && v < 0) spent += Math.abs(v);
    }

    out.push({
      methodId: m.id,
      name: m.name,
      opening,
      received,
      withdrawn,
      spent,
      balance: entry.balance,
      overdraftToleranceBase: tolerance,
      status: walletStatus(entry.balance, tolerance),
    });
  }
  return out;
}

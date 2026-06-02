"use server";

import { createClient } from "@/lib/supabase/server";
import { safeRunLabeled, type ActionResult } from "@/lib/data/actions";

// Server actions powering the WalletDetailSheet — paginated ledger
// entries + a 30-day running-balance trend. Lives in its own *-actions.ts
// file so the client component can pull them in without dragging the
// monolithic actions.ts barrel through the bundle. Both actions return
// the ActionResult shape so the UI can surface real errors instead of
// the production-build "Server Components render" placeholder.

const LEDGER_PAGE_SIZE = 25;

export type WalletLedgerEntry = {
  id: string;
  eventAt: string;
  kind: string;
  amountBase: number;
  relatedKind: string | null;
  relatedId: string | null;
  note: string | null;
};

export type WalletLedgerPage = {
  entries: WalletLedgerEntry[];
  hasMore: boolean;
  nextOffset: number;
};

export type WalletTrendPoint = {
  date: string; // ISO yyyy-mm-dd
  balance: number; // running balance at end of that day
};

// Page through live (non-archived) ledger rows for a wallet, newest first.
// Page size is fixed at 25 — the caller passes an offset and we return the
// next slice + a hasMore flag. Pre-anchor activity is filtered out so the
// sheet matches the wallet-balance reader's window.
export async function loadWalletLedgerPage(
  walletId: string,
  offset = 0,
): Promise<ActionResult<WalletLedgerPage>> {
  return safeRunLabeled("freelane-action", "loadWalletLedgerPage", async () => {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthenticated");

    // Anchor cutoff — same logic as wallet-balance.ts (prefers timestamptz,
    // falls back to date). Pre-anchor ledger rows are intentionally
    // excluded so the sheet's entry list matches the headline balance.
    const { data: method } = await supabase
      .from("payment_methods")
      .select("opening_balance_set_at,opening_balance_at")
      .eq("id", walletId)
      .eq("user_id", user.id)
      .maybeSingle();
    const anchorTs = (method?.opening_balance_set_at as string | null) ?? null;
    const dateAnchor = (method?.opening_balance_at as string | null) ?? null;
    const effectiveAnchor = anchorTs
      ? anchorTs
      : dateAnchor
        ? `${dateAnchor.slice(0, 10)}T00:00:00+08:00`
        : null;

    // Fetch one extra row so we can compute hasMore without a count() query.
    let query = supabase
      .from("money_ledger")
      .select("id,event_at,kind,amount_base,related_kind,related_id,note")
      .eq("user_id", user.id)
      .eq("wallet_id", walletId)
      .is("archived_at", null)
      .order("event_at", { ascending: false })
      .range(offset, offset + LEDGER_PAGE_SIZE);
    if (effectiveAnchor) query = query.gte("event_at", effectiveAnchor);
    const { data, error } = await query;
    if (error) throw new Error(error.message);

    const rows = (data ?? []).slice(0, LEDGER_PAGE_SIZE);
    const hasMore = (data ?? []).length > LEDGER_PAGE_SIZE;
    const entries: WalletLedgerEntry[] = rows.map((r) => ({
      id: r.id as string,
      eventAt: r.event_at as string,
      kind: (r.kind as string) ?? "outflow",
      amountBase: Number(r.amount_base ?? 0),
      relatedKind: (r.related_kind as string | null) ?? null,
      relatedId: (r.related_id as string | null) ?? null,
      note: (r.note as string | null) ?? null,
    }));

    return {
      entries,
      hasMore,
      nextOffset: offset + entries.length,
    };
  });
}

// 30-day running-balance trend. Walks the ledger newest → oldest from now
// back to (now - 30d), bucketed by PHT calendar day so the sparkline reads
// "one point per day" even when the wallet had multiple transactions.
// Returns end-of-day running balance per day.
export async function loadWalletBalanceTrend(
  walletId: string,
): Promise<ActionResult<WalletTrendPoint[]>> {
  return safeRunLabeled("freelane-action", "loadWalletBalanceTrend", async () => {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthenticated");

    const { data: method } = await supabase
      .from("payment_methods")
      .select("opening_balance_base,opening_balance_set_at,opening_balance_at")
      .eq("id", walletId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!method) throw new Error("Wallet not found");
    const opening = Number(method.opening_balance_base ?? 0);
    const anchorTs = (method.opening_balance_set_at as string | null) ?? null;
    const dateAnchor = (method.opening_balance_at as string | null) ?? null;
    const effectiveAnchor = anchorTs
      ? anchorTs
      : dateAnchor
        ? `${dateAnchor.slice(0, 10)}T00:00:00+08:00`
        : null;

    // Pull every ledger row since the anchor — capped to last 90d to keep
    // the query bounded even when the wallet has years of history. The
    // sparkline only renders the last 30d but we need extra runway to seed
    // the running balance going INTO the window.
    const earliest = new Date();
    earliest.setHours(0, 0, 0, 0);
    earliest.setDate(earliest.getDate() - 90);
    const earliestIso = earliest.toISOString();
    const cutoff = effectiveAnchor && effectiveAnchor > earliestIso ? effectiveAnchor : earliestIso;

    const { data: rows, error } = await supabase
      .from("money_ledger")
      .select("event_at,amount_base")
      .eq("user_id", user.id)
      .eq("wallet_id", walletId)
      .is("archived_at", null)
      .gte("event_at", cutoff)
      .order("event_at", { ascending: true });
    if (error) throw new Error(error.message);

    // Walk forward applying each delta to the running balance. We tally
    // per PHT day so the chart shows one point per day. Days with no
    // activity inherit the prior balance (line stays flat).
    const dayBalances = new Map<string, number>();
    let running = opening;
    for (const r of rows ?? []) {
      const ts = new Date(r.event_at as string);
      // PHT bucket: shift UTC into +08:00 by adding 8 hours, then date.
      const phtDate = new Date(ts.getTime() + 8 * 60 * 60 * 1000);
      const key = phtDate.toISOString().slice(0, 10);
      running += Number(r.amount_base ?? 0);
      dayBalances.set(key, running);
    }

    // Emit one point per day for the last 30 days. Fill gaps by carrying
    // the prior known balance forward.
    const out: WalletTrendPoint[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let last = opening;
    // Seed `last` with whatever ran up before the 30-day window.
    const sortedKeys = Array.from(dayBalances.keys()).sort();
    const startBoundary = new Date(today);
    startBoundary.setDate(startBoundary.getDate() - 29);
    const startKey = startBoundary.toISOString().slice(0, 10);
    for (const k of sortedKeys) {
      if (k < startKey) last = dayBalances.get(k) ?? last;
    }

    for (let i = 29; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      if (dayBalances.has(key)) last = dayBalances.get(key)!;
      out.push({ date: key, balance: Math.round(last * 100) / 100 });
    }

    return out;
  });
}

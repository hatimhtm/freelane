"use server";

import { createClient } from "@/lib/supabase/server";

// Freelane: helper for the finance.money_ledger table (migration 0067).
//
// Every money-moving server action calls insertLedger() to mirror the
// movement onto the canonical signed-amount log. Edits go through
// replaceLedgerRow() which uses the SECURITY DEFINER RPC introduced in
// migration 0070 to atomically archive the prior row + insert the new one
// (so an edit can never end up half-archived). Direct UPDATE / DELETE on
// money_ledger rows is forbidden — the audit trail stays intact.
//
// CONSISTENCY MODEL: source-table insert and ledger insert are NOT in a
// single DB transaction on the CREATE path. The source row commits first,
// then insertLedger fires as a follow-up. If the ledger insert fails the
// source row still saved and the wallet balance can drift until the
// reconciliation pass (finance.reconcile_user_wallets) converges them.
// Every failure appends a row to finance.money_ledger_write_failures so:
//
//   1. the reconciliation pass can pick the drift up;
//   2. the dashboard surfaces a "data degraded" banner (see
//      dashboard-data.ts) instead of silently rendering source-table
//      math as if it were the ledger truth;
//   3. future AI questions can latch onto the failures table.
//
// The EDIT path uses replace_money_ledger_row (a single SECURITY DEFINER
// RPC) so it IS atomic with respect to the ledger — but again, not with
// respect to the source-table UPDATE that runs before it. The same
// reconciliation seam handles that.
//
// Reader contract: this module's writes are the ONE source the new
// dashboard widgets read from (via wallet-balance.ts). The wider rollout
// to /today, /spending, /payments, /plans, /safe-to-spend still routes
// through payment-chain.ts's holdingBalances(), which delegates here when
// a ledger map is passed in.

export type MoneyLedgerKind =
  | "income"
  | "outflow"
  | "transfer"
  | "fee"
  | "sadaka_payment"
  | "project_receipt"
  | "unaccounted_outflow"
  | "adjustment";

export type MoneyLedgerRelatedKind =
  | "payment"
  | "spend"
  | "withdrawal"
  | "sadaka"
  | "project"
  | "fee"
  | "reconciliation";

export type InsertLedgerInput = {
  kind: MoneyLedgerKind;
  amount_base: number;
  wallet_id: string | null;
  related_kind?: MoneyLedgerRelatedKind | null;
  related_id?: string | null;
  event_at?: string | null;
  note?: string | null;
  client?: Awaited<ReturnType<typeof createClient>>;
};

async function logWriteFailure(args: {
  client: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  op: "insert" | "archive" | "replace" | "read";
  relatedKind: string | null;
  relatedId: string | null;
  message: string;
}): Promise<void> {
  try {
    await args.client.from("money_ledger_write_failures").insert({
      user_id: args.userId,
      op: args.op,
      related_kind: args.relatedKind,
      related_id: args.relatedId,
      message: args.message.slice(0, 500),
    });
  } catch {
    // If even the failure log breaks (table missing on a stale schema),
    // fall back to the console so server logs still surface the drift.
    // eslint-disable-next-line no-console
    console.error("[freelane-ledger] write-failure log unavailable", {
      op: args.op,
      related: `${args.relatedKind}:${args.relatedId}`,
      message: args.message,
    });
  }
}

// Insert a single ledger row. Caller is responsible for sign: positive
// amounts flow IN to the wallet, negative amounts flow OUT. The DB-level
// CHECK constraint from 0070 rejects sign-vs-kind mismatches.
export async function insertLedger(input: InsertLedgerInput): Promise<void> {
  const supabase = input.client ?? (await createClient());
  let userId: string | null = null;
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    userId = user.id;
    const { error } = await supabase.from("money_ledger").insert({
      user_id: user.id,
      event_at: input.event_at ?? new Date().toISOString(),
      kind: input.kind,
      amount_base: Math.round(input.amount_base * 100) / 100,
      wallet_id: input.wallet_id,
      related_kind: input.related_kind ?? null,
      related_id: input.related_id ?? null,
      note: input.note ?? null,
    });
    if (error) throw error;
  } catch (err) {
    if (userId) {
      await logWriteFailure({
        client: supabase,
        userId,
        op: "insert",
        relatedKind: input.related_kind ?? null,
        relatedId: input.related_id ?? null,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

// Soft-delete a ledger row by its (related_kind, related_id). Preserves
// audit trail — never DELETE. Prefer replaceLedgerRow() when an edit is
// inserting a fresh row in the same logical step.
export async function archiveLedger(
  relatedKind: MoneyLedgerRelatedKind,
  relatedId: string,
  client?: Awaited<ReturnType<typeof createClient>>,
): Promise<void> {
  const supabase = client ?? (await createClient());
  let userId: string | null = null;
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    userId = user.id;
    const { error } = await supabase
      .from("money_ledger")
      .update({ archived_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .eq("related_kind", relatedKind)
      .eq("related_id", relatedId)
      .is("archived_at", null);
    if (error) throw error;
  } catch (err) {
    if (userId) {
      await logWriteFailure({
        client: supabase,
        userId,
        op: "archive",
        relatedKind,
        relatedId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

// Surface a ledger READ failure to the same drift-detection table the
// writer side uses. Lets the dashboard's silent fallback (when the ledger
// reader throws or returns empty) leave a trace the reconciliation pass +
// future "Dashboard data degraded" banner can latch onto.
export async function logLedgerReadFailure(
  message: string,
  client?: Awaited<ReturnType<typeof createClient>>,
): Promise<void> {
  const supabase = client ?? (await createClient());
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    await logWriteFailure({
      client: supabase,
      userId: user.id,
      op: "read",
      relatedKind: null,
      relatedId: null,
      message,
    });
  } catch {
    // Even the failure log breaking is non-fatal here.
  }
}

export type ReplaceLedgerInput = {
  related_kind: MoneyLedgerRelatedKind;
  related_id: string;
  event_at: string;
  kind: MoneyLedgerKind;
  amount_base: number;
  wallet_id: string | null;
  note?: string | null;
  client?: Awaited<ReturnType<typeof createClient>>;
};

// Atomic archive + insert via the SECURITY DEFINER RPC introduced in 0070.
// Use this on EDIT paths — it guarantees the wallet can never see a half-
// archived state where the old row is gone but the new one didn't land.
export async function replaceLedgerRow(input: ReplaceLedgerInput): Promise<void> {
  const supabase = input.client ?? (await createClient());
  let userId: string | null = null;
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    userId = user.id;
    const { error } = await supabase.rpc("replace_money_ledger_row", {
      p_related_kind: input.related_kind,
      p_related_id: input.related_id,
      p_event_at: input.event_at,
      p_kind: input.kind,
      p_amount_base: Math.round(input.amount_base * 100) / 100,
      p_wallet_id: input.wallet_id,
      p_note: input.note ?? null,
    });
    if (error) throw error;
  } catch (err) {
    if (userId) {
      await logWriteFailure({
        client: supabase,
        userId,
        op: "replace",
        relatedKind: input.related_kind,
        relatedId: input.related_id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

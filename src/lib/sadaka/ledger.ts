"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getAuthUser } from "@/lib/auth";
import { archiveLedger, logLedgerReadFailure } from "@/lib/data/money-ledger";

// Freelane Sadaka — canonical ledger reader/writer.
//
// Three responsibilities:
//   1. Read the pool balance (one number) from sadaka_ledger.
//   2. List the last N events for the Activity widget.
//   3. Insert / archive / replace ledger rows on behalf of the contribution
//      hook, the auto-detect hook, the explicit "Mark sadaka given" CTA,
//      the daily decay cron, and the "Not sadaka" reject affordance.
//
// Sign convention (mirrors finance.money_ledger):
//   contribution   → positive amount_base
//   payment        → negative amount_base
//   auto_detected  → negative amount_base
//   decay          → negative amount_base
//   adjustment     → signed (caller's responsibility)
//
// Reader contract: the Sadaka tab hero, the Today widget, AND the Dashboard
// card MUST all use readPoolBalance() so the three surfaces never drift.
// The display layer is responsible for flooring at 0 — the ledger is
// allowed to dip slightly negative when decay overshoots a partial
// contribution (and a future signed adjustment can push it negative on
// purpose).
//
// Mirroring contract with finance.money_ledger:
//   • kind='payment'       — caller is responsible for writing the matching
//                             money_ledger sadaka_payment outflow row in the
//                             same flow. This module does NOT auto-mirror —
//                             a single owner of the wallet debit prevents
//                             double-debit on the spend-toggle path (where
//                             createSpend already wrote its own outflow) and
//                             keeps the markSadakaGiven path explicit.
//   • kind='auto_detected' — does NOT mirror. The parent spend already
//                             produced its own money_ledger outflow row.
//   • kind='contribution'  — does NOT mirror. Contributions are reserve
//                             accounting, not a wallet movement.
//   • kind='decay'         — does NOT mirror. Decay is reserve accounting.
//   • kind='adjustment'    — does NOT mirror. Manual ledger surgery.
//
// Archive symmetry: archiveSadakaLedgerRow mirrors-archive ONLY for
// kind='payment' rows. Auto_detected rows never had a money_ledger mirror
// (the parent spend's outflow covers the wallet), so they don't trigger
// archiveLedger on the way out.

export type SadakaEventKind =
  | "contribution"
  | "payment"
  | "auto_detected"
  | "decay"
  | "adjustment";

export type SadakaSourceKind = "spend" | "payment" | "manual" | "cron" | null;

export type SadakaLedgerRow = {
  id: string;
  user_id: string;
  event_at: string;
  kind: SadakaEventKind;
  amount_base: number;
  source_kind: string | null;
  source_id: string | null;
  rate_used: number | null;
  reasoning: string | null;
  tentative: boolean;
  archived_at: string | null;
  note: string | null;
  created_at: string;
};

// Display-side: caller decides whether to floor at 0. The raw signed sum is
// returned alongside so reconciliation passes can see the true (possibly
// negative) state.
export type PoolBalance = {
  rawBase: number;
  displayBase: number;
};

export async function readPoolBalance(): Promise<PoolBalance> {
  const user = await getAuthUser();
  if (!user) return { rawBase: 0, displayBase: 0 };
  try {
    const supabase = await createClient();
    // Prefer the DB-side aggregate (migration 0076). When the RPC isn't
    // installed yet (older deploys) the fallback re-runs the JS-side sum.
    const { data: rpcData, error: rpcError } = await supabase.rpc(
      "sadaka_pool_raw_base",
      { p_user_id: user.id },
    );
    if (!rpcError && rpcData !== null && rpcData !== undefined) {
      const raw = Number(rpcData);
      return { rawBase: raw, displayBase: Math.max(0, raw) };
    }
    const { data, error } = await supabase
      .from("sadaka_ledger")
      .select("amount_base")
      .eq("user_id", user.id)
      .is("archived_at", null);
    if (error || !data) {
      await logLedgerReadFailure(
        `sadaka pool read failed: ${error ? error.message : "no data"}`,
        supabase,
      );
      return { rawBase: 0, displayBase: 0 };
    }
    const raw = data.reduce(
      (s, r) => s + Number((r as { amount_base: number | string }).amount_base ?? 0),
      0,
    );
    return { rawBase: raw, displayBase: Math.max(0, raw) };
  } catch (err) {
    await logLedgerReadFailure(
      `sadaka pool read threw: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { rawBase: 0, displayBase: 0 };
  }
}

// Variant for trusted server callers (cron, brain inputs) that already know
// the userId and don't want to re-auth. Uses the service client so it works
// outside of a request context (cron, nudge dispatcher, dispatcher hooks).
export async function readPoolBalanceForUser(userId: string): Promise<PoolBalance> {
  if (!userId) return { rawBase: 0, displayBase: 0 };
  try {
    const supabase = createServiceClient();
    const { data: rpcData, error: rpcError } = await supabase.rpc(
      "sadaka_pool_raw_base",
      { p_user_id: userId },
    );
    if (!rpcError && rpcData !== null && rpcData !== undefined) {
      const raw = Number(rpcData);
      return { rawBase: raw, displayBase: Math.max(0, raw) };
    }
    const { data, error } = await supabase
      .from("sadaka_ledger")
      .select("amount_base")
      .eq("user_id", userId)
      .is("archived_at", null);
    if (error || !data) return { rawBase: 0, displayBase: 0 };
    const raw = data.reduce(
      (s, r) => s + Number((r as { amount_base: number | string }).amount_base ?? 0),
      0,
    );
    return { rawBase: raw, displayBase: Math.max(0, raw) };
  } catch {
    return { rawBase: 0, displayBase: 0 };
  }
}

export async function listLedgerEvents(limit = 5): Promise<SadakaLedgerRow[]> {
  const user = await getAuthUser();
  if (!user) return [];
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("sadaka_ledger")
      .select(
        "id,user_id,event_at,kind,amount_base,source_kind,source_id,rate_used,reasoning,tentative,archived_at,note,created_at",
      )
      .eq("user_id", user.id)
      .is("archived_at", null)
      .order("event_at", { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return data as SadakaLedgerRow[];
  } catch {
    return [];
  }
}

export type InsertLedgerRowInput = {
  kind: SadakaEventKind;
  amount_base: number;
  source_kind?: string | null;
  source_id?: string | null;
  rate_used?: number | null;
  reasoning?: string | null;
  tentative?: boolean;
  note?: string | null;
  event_at?: string | null;
};

// Discriminated result so auto-detect can tell a unique-conflict (don't
// retry, the slot is taken) from a transient error (let the next mechanism
// try). Reasons:
//   - 'unique' → partial unique index rejected; a live row already covers
//                this (source_kind, source_id) pair.
//   - 'auth'   → no authenticated user.
//   - 'error'  → network / RLS / unexpected. Caller may continue to the
//                next mechanism and let the final attempt log a failure.
export type InsertLedgerRowResult =
  | { ok: true; id: string }
  | { ok: false; reason: "unique" | "auth" | "error"; message?: string };

// Best-effort: never throws. The full discriminated form. Callers that just
// need the row id can use insertSadakaLedgerRow (legacy shim below).
export async function insertSadakaLedgerRowResult(
  input: InsertLedgerRowInput,
): Promise<InsertLedgerRowResult> {
  const user = await getAuthUser();
  if (!user) return { ok: false, reason: "auth" };
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("sadaka_ledger")
      .insert({
        user_id: user.id,
        event_at: input.event_at ?? new Date().toISOString(),
        kind: input.kind,
        amount_base: Math.round(Number(input.amount_base) * 100) / 100,
        source_kind: input.source_kind ?? null,
        source_id: input.source_id ?? null,
        rate_used: input.rate_used ?? null,
        reasoning: input.reasoning ?? null,
        tentative: !!input.tentative,
        note: input.note ?? null,
      })
      .select("id")
      .single();
    if (error || !data) {
      const code = (error as { code?: string } | null)?.code;
      // 23505 — unique_violation. The partial unique on (user_id,
      // source_kind, source_id) is firing; first mechanism already won.
      if (code === "23505") {
        // eslint-disable-next-line no-console
        console.warn("[freelane-sadaka] auto-detect conflict swallowed", {
          source_kind: input.source_kind,
          source_id: input.source_id,
          kind: input.kind,
        });
        return { ok: false, reason: "unique" };
      }
      return {
        ok: false,
        reason: "error",
        message: error?.message ?? "no data",
      };
    }
    return { ok: true, id: (data as { id: string }).id };
  } catch (err) {
    return {
      ok: false,
      reason: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

// Legacy shim — returns just the id (null on any failure). Kept for the
// many call sites that don't need to distinguish unique-conflict from
// transient error.
export async function insertSadakaLedgerRow(
  input: InsertLedgerRowInput,
): Promise<string | null> {
  const r = await insertSadakaLedgerRowResult(input);
  return r.ok ? r.id : null;
}

// Soft-archive by ledger row id. Preserves audit trail. Returns true on
// success, false on auth / network / not-found.
export async function archiveSadakaLedgerRow(
  id: string,
  reason: string | null = null,
): Promise<boolean> {
  const user = await getAuthUser();
  if (!user) return false;
  try {
    const supabase = await createClient();
    // Pre-fetch the row so we can mirror the archive onto money_ledger if
    // it was a payment row that previously wrote a sadaka_payment outflow.
    const { data: existing } = await supabase
      .from("sadaka_ledger")
      .select("kind,source_kind,source_id")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();

    const { error } = await supabase
      .from("sadaka_ledger")
      .update({
        archived_at: new Date().toISOString(),
        note: reason ?? undefined,
      })
      .eq("id", id)
      .eq("user_id", user.id)
      .is("archived_at", null);
    if (error) return false;

    if (existing && (existing as { kind: string }).kind === "payment") {
      // Mirror the archive onto money_ledger so the wallet snaps back.
      await archiveLedger("sadaka", id, supabase);
    }
    return true;
  } catch {
    return false;
  }
}

// Find the live ledger row attached to a source mutation. Used by edit /
// delete paths on spends so the same source_id can be archived without
// guessing the ledger row id.
export async function findLiveLedgerRowBySource(
  sourceKind: string,
  sourceId: string,
): Promise<SadakaLedgerRow | null> {
  const user = await getAuthUser();
  if (!user) return null;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("sadaka_ledger")
      .select(
        "id,user_id,event_at,kind,amount_base,source_kind,source_id,rate_used,reasoning,tentative,archived_at,note,created_at",
      )
      .eq("user_id", user.id)
      .eq("source_kind", sourceKind)
      .eq("source_id", sourceId)
      .is("archived_at", null)
      .maybeSingle();
    if (error || !data) return null;
    return data as SadakaLedgerRow;
  } catch {
    return null;
  }
}

// Convenience for edit paths: archive any LIVE row tied to a source then
// insert a fresh one. The partial unique index covers the safety here.
export async function replaceSadakaLedgerRow(input: InsertLedgerRowInput): Promise<string | null> {
  if (input.source_kind && input.source_id) {
    const existing = await findLiveLedgerRowBySource(input.source_kind, input.source_id);
    if (existing) {
      await archiveSadakaLedgerRow(existing.id, "replaced");
    }
  }
  return insertSadakaLedgerRow(input);
}

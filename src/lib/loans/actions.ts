"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { safeRunLabeled, type ActionResult } from "@/lib/data/actions";
import { insertLedger } from "@/lib/data/money-ledger";
import { phtToday } from "@/lib/utils";
import { normalizeDirection } from "./direction";
import type { Loan } from "@/lib/supabase/types";

// Freelane Loans — server actions for the bidirectional workflow.
//
// Direction mapping (legacy ⇄ new):
//   given    = "I sent money out — they'll return it"    (legacy 'lent')
//   received = "Money came in — I'll return it"          (legacy 'borrowed')
//
// Money-ledger invariants:
//   - direction=given created FROM a spend (origin_spend_id set): the
//     spend already wrote the outflow money_ledger row. DO NOT
//     double-debit. createPersonalLoan skips the ledger write in that
//     branch.
//   - direction=given created WITHOUT a spend (no origin_spend_id): the
//     loan itself is the wallet movement. Write a spends row +
//     money_ledger outflow OR (simpler v1) write a money_ledger
//     outflow directly on origin_wallet_id keyed by related_kind=
//     'reconciliation' so the wallet balance reflects the loan.
//   - direction=received: a wallet credit lands in origin_wallet_id.
//     Write a money_ledger income row tied to related_kind='reconciliation'
//     (no payments / project_receipts row to mirror against).
//   - recordLoanReturn on given: credit return_wallet_id (income).
//   - recordLoanReturn on received: debit return_wallet_id (outflow).
//   - forgiveLoan: writes a sadaka_ledger payment for the remaining
//     balance. The original spend's outflow already debited the wallet,
//     so no money_ledger mirror is written (same exception pattern as
//     spends.is_sadaka).

async function userOrThrow() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthenticated");
  return { supabase, userId: user.id };
}

async function safeRun<T>(label: string, fn: () => Promise<T>): Promise<ActionResult<T>> {
  return safeRunLabeled("freelane-loans", label, fn);
}

function revalidateLoanSurfaces() {
  revalidatePath("/spending");
  revalidatePath("/clients/people");
  revalidatePath("/today");
  revalidatePath("/dashboard");
}

// ── createPersonalLoan ────────────────────────────────────────────────
// Creates a new finance.loans row in the new (given/received) shape.
// When sourceSpendId is provided (typical given-loan path created from
// the spend modal), the wallet outflow is owned by the parent spend.
// Without sourceSpendId, the loan itself is the wallet movement and we
// mirror the appropriate ledger row.

export type CreatePersonalLoanInput = {
  direction: "given" | "received";
  counterparty_entity_id: string;
  origin_wallet_id: string;
  principal_base: number;
  currency?: string;
  due_date?: string | null;
  notes?: string | null;
  is_for_someone_else?: boolean;
  // Optional — when the loan is created from an existing spend, the spend
  // already wrote the wallet outflow. We skip the ledger write in this
  // branch and link the loan back via origin_spend_id.
  source_spend_id?: string | null;
};

export async function createPersonalLoan(
  input: CreatePersonalLoanInput,
): Promise<ActionResult<{ id: string }>> {
  return safeRun("createPersonalLoan", async () => {
    const { supabase, userId } = await userOrThrow();
    const principalBase = Math.round(Number(input.principal_base) * 100) / 100;
    if (!(principalBase > 0)) throw new Error("Loan principal must be greater than 0.");
    if (!input.counterparty_entity_id) throw new Error("Pick a counterparty.");
    if (!input.origin_wallet_id) throw new Error("Pick the wallet the money flowed through.");
    if (input.direction !== "given" && input.direction !== "received") {
      throw new Error("Loan direction must be 'given' or 'received'.");
    }
    // direction='received' + source_spend_id is structurally impossible:
    // the source spend already wrote an outflow money_ledger row, but a
    // 'received' loan means money came IN. The loan-proposal brain biases
    // hard toward 'given' (see lib/ai/brains/loan-proposal.ts); the rare
    // legitimate 'received' case must flow through the chatbot's "Tell me
    // more" branch which builds the loan without a source spend so the
    // ledger sign matches the wallet movement.
    if (input.direction === "received" && input.source_spend_id) {
      throw new Error(
        "A 'received' loan can't be created from an existing spend (the spend was an outflow). Log the inbound transfer directly.",
      );
    }

    // Idempotency: when source_spend_id is set and a non-forgiven loan
    // already exists against it, return that loan instead of inserting
    // a duplicate. createSpend may invoke this twice (the brain hook
    // path + an explicit checkbox path); the unique-by-source guard
    // keeps writes single-owner.
    if (input.source_spend_id) {
      const { data: existing } = await supabase
        .from("loans")
        .select("id, status")
        .eq("user_id", userId)
        .eq("origin_spend_id", input.source_spend_id)
        .neq("status", "forgiven")
        .neq("status", "written_off")
        .maybeSingle();
      if (existing?.id) {
        return { id: existing.id as string };
      }
    }

    const currency = (input.currency ?? "PHP").trim() || "PHP";
    const { data: loanRow, error: insertErr } = await supabase
      .from("loans")
      .insert({
        user_id: userId,
        // Write the legacy direction synonym too so cross-cutting readers
        // (safe-to-spend AI, curiosity sweep) keep classifying correctly.
        // Migration 0106 widened the CHECK to accept the new values; the
        // legacy synonym is what older code branches on.
        direction: input.direction === "given" ? "lent" : "borrowed",
        counterparty_entity_id: input.counterparty_entity_id,
        origin_wallet_id: input.origin_wallet_id,
        origin_spend_id: input.source_spend_id ?? null,
        principal_base: principalBase,
        currency,
        borrowed_at: phtToday(),
        due_date: input.due_date ?? null,
        is_for_someone_else: !!input.is_for_someone_else,
        notes: input.notes ?? null,
        status: "open",
      })
      .select("id")
      .single();
    if (insertErr || !loanRow) throw insertErr ?? new Error("Failed to save loan.");
    const loanId = loanRow.id as string;

    // Wallet movement — only when there is no parent spend covering it.
    // direction=given without a source spend: write an outflow.
    // direction=received: always write an income (no parent flow).
    if (!input.source_spend_id) {
      try {
        if (input.direction === "given") {
          await insertLedger({
            client: supabase,
            kind: "outflow",
            amount_base: -1 * principalBase,
            wallet_id: input.origin_wallet_id,
            related_kind: "reconciliation",
            related_id: loanId,
            note: "createPersonalLoan/given",
          });
        } else {
          await insertLedger({
            client: supabase,
            kind: "income",
            amount_base: principalBase,
            wallet_id: input.origin_wallet_id,
            related_kind: "reconciliation",
            related_id: loanId,
            note: "createPersonalLoan/received",
          });
        }
      } catch (e) {
        // Ledger writer logs to money_ledger_write_failures. Don't block
        // the loan insert — reconciliation pass converges the drift. Tag
        // the swallow so a dropped mirror is grep-able in production
        // logs instead of vanishing silently.
        // eslint-disable-next-line no-console
        console.warn(
          "[loans:ledger-mirror-skip]",
          loanId,
          e instanceof Error ? e.message : String(e),
        );
      }
    }

    revalidateLoanSurfaces();
    return { id: loanId };
  });
}

// ── recordLoanReturn ──────────────────────────────────────────────────
// Delegates the three-row write (loan_returns insert + over-return guard
// + loans.status flip) to finance.record_loan_return (migration 0112).
// The RPC locks the loans row FOR UPDATE, so two concurrent submissions
// serialise instead of both passing the SELECT-then-INSERT race that
// lived in the prior shape. Idempotency: pass clientRequestId and a retry
// of the same submission returns the original row instead of inserting
// a duplicate.
//
// The wallet-mirror money_ledger write stays on the application side —
// the RPC handles the loan state machine only. Ledger failures are
// best-effort (reconciliation converges); we tag console.warn so a
// dropped mirror is visible in logs without surfacing as a hard error.

export type RecordLoanReturnInput = {
  loan_id: string;
  amount_base: number;
  return_wallet_id: string;
  notes?: string | null;
  // Optional idempotency key — the same key on a retry returns the
  // existing row instead of inserting a duplicate. The UI generates one
  // per submission (crypto.randomUUID) and replays it on retry.
  client_request_id?: string | null;
};

export async function recordLoanReturn(
  input: RecordLoanReturnInput,
): Promise<ActionResult<{ id: string; status: Loan["status"] }>> {
  return safeRun("recordLoanReturn", async () => {
    const { supabase } = await userOrThrow();
    const amount = Math.round(Number(input.amount_base) * 100) / 100;
    if (!(amount > 0)) throw new Error("Return amount must be greater than 0.");
    if (!input.return_wallet_id) throw new Error("Pick the wallet the return lands in.");

    const { data, error } = await supabase.rpc("record_loan_return", {
      p_loan_id: input.loan_id,
      p_amount_base: amount,
      p_return_wallet_id: input.return_wallet_id,
      p_notes: input.notes ?? null,
      p_client_request_id: input.client_request_id ?? null,
    });
    if (error) throw new Error(error.message);

    // The RPC returns a single-row TABLE — the client receives an array.
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      throw new Error("record_loan_return returned no row.");
    }
    const result = row as {
      id: string;
      status: Loan["status"];
      direction: string;
      return_wallet_id: string;
      amount_base: number | string;
    };

    const dir = normalizeDirection(result.direction);
    if (!dir) throw new Error("Unknown loan direction.");

    // Wallet movement — given-loan return CREDITS the return wallet
    // (money came back), received-loan return DEBITS it (paid back).
    // Best-effort: reconciliation pass converges any drift, and the
    // ledger writer logs to money_ledger_write_failures on failure.
    try {
      if (dir === "given") {
        await insertLedger({
          client: supabase,
          kind: "income",
          amount_base: amount,
          wallet_id: input.return_wallet_id,
          related_kind: "reconciliation",
          related_id: result.id,
          note: "recordLoanReturn/given",
        });
      } else {
        await insertLedger({
          client: supabase,
          kind: "outflow",
          amount_base: -1 * amount,
          wallet_id: input.return_wallet_id,
          related_kind: "reconciliation",
          related_id: result.id,
          note: "recordLoanReturn/received",
        });
      }
    } catch (e) {
      // Tag the swallowed error so a dropped mirror is grep-able in
      // production logs instead of vanishing silently.
      // eslint-disable-next-line no-console
      console.warn(
        "[loans:ledger-mirror-skip]",
        result.id,
        e instanceof Error ? e.message : String(e),
      );
    }

    revalidateLoanSurfaces();
    return { id: result.id, status: result.status };
  });
}

// ── forgiveLoan ───────────────────────────────────────────────────────
// given-only. Treats the remaining outstanding principal as a Sadaka
// contribution from the lender. Delegates the three-row write
// (sadaka_ledger payment + loan_forgivals audit + loans.status='forgiven')
// to finance.forgive_loan (migration 0111) so the writes share one
// transaction — any failure rolls back the sadaka row and leaves the
// loan in its prior status. The original spend (if any) already debited
// the wallet — the RPC does NOT mirror onto money_ledger (same exception
// as spends.is_sadaka).
//
// Idempotency: when the loan is already forgiven the RPC looks up the
// existing loan_forgivals row and returns its original sadaka_payment_id
// so the UI can re-link to the original contribution on re-render.

export type ForgiveLoanInput = {
  loan_id: string;
  reason?: string | null;
};

export async function forgiveLoan(
  input: ForgiveLoanInput,
): Promise<ActionResult<{ loan_id: string; sadaka_payment_id: string | null; amount_base: number }>> {
  return safeRun("forgiveLoan", async () => {
    const { supabase } = await userOrThrow();

    const { data, error } = await supabase.rpc("forgive_loan", {
      p_loan_id: input.loan_id,
      p_reason: input.reason ?? null,
    });
    if (error) throw new Error(error.message);

    // The RPC returns a single-row TABLE so the client receives an array.
    // Normalise to the typed action shape.
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      throw new Error("forgive_loan returned no row.");
    }
    const result = row as {
      loan_id: string;
      sadaka_payment_id: string | null;
      amount_base: number | string | null;
    };

    revalidateLoanSurfaces();
    revalidatePath("/sadaka");
    return {
      loan_id: result.loan_id,
      sadaka_payment_id: result.sadaka_payment_id ?? null,
      amount_base: Number(result.amount_base ?? 0),
    };
  });
}

// ── writeOffLoan ──────────────────────────────────────────────────────
// received-only. The lender (the user owes someone) decides the debt
// is uncollectible / forgiven externally. No Sadaka write; just a
// status flip + reason audit on the loan row's notes field.

export type WriteOffLoanInput = {
  loan_id: string;
  reason?: string | null;
};

// Client-callable read for the loan detail sheet. Wrapped in
// ActionResult so the same try/catch story applies; the sheet can show
// a polite error toast if the load fails.

export type LoanDetailPayload = {
  loan: Loan;
  returns: Array<{
    id: string;
    amount_base: number;
    return_wallet_id: string | null;
    returned_at: string;
    notes: string | null;
  }>;
  returnedBase: number;
  outstandingBase: number;
  // Counterparty hero — pulled in the same round-trip so the sheet
  // can render "{name} · {relationship}" + a deep link to
  // /clients/people/[id] without an extra fetch in the client.
  counterparty: {
    id: string;
    canonical_name: string;
    relationship: string | null;
  } | null;
};

export async function fetchLoanDetail(
  loanId: string,
): Promise<ActionResult<LoanDetailPayload>> {
  return safeRun("fetchLoanDetail", async () => {
    const { supabase, userId } = await userOrThrow();
    const [{ data: loan }, { data: returns }] = await Promise.all([
      supabase
        .from("loans")
        .select("*")
        .eq("id", loanId)
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("loan_returns")
        .select("id, amount_base, return_wallet_id, returned_at, notes")
        .eq("loan_id", loanId)
        .eq("user_id", userId)
        .order("returned_at", { ascending: false }),
    ]);
    if (!loan) throw new Error("Loan not found.");
    const loanRow = loan as Loan;
    const returnRows = (returns ?? []) as LoanDetailPayload["returns"];
    const returnedBase = returnRows.reduce(
      (s, r) => s + Number(r.amount_base ?? 0),
      0,
    );
    // Fetch the counterparty entity for the hero link. Skipped when the
    // legacy row carries only counterparty TEXT (no entity FK).
    let counterparty: LoanDetailPayload["counterparty"] = null;
    if (loanRow.counterparty_entity_id) {
      const { data: entity } = await supabase
        .from("entities")
        .select("id, canonical_name, relationship")
        .eq("id", loanRow.counterparty_entity_id)
        .eq("user_id", userId)
        .maybeSingle();
      if (entity) {
        counterparty = entity as LoanDetailPayload["counterparty"];
      }
    }
    const outstandingBase = Math.max(
      0,
      Number(loanRow.principal_base ?? 0) - returnedBase,
    );
    return {
      loan: loanRow,
      returns: returnRows,
      returnedBase,
      outstandingBase,
      counterparty,
    };
  });
}

export async function writeOffLoan(
  input: WriteOffLoanInput,
): Promise<ActionResult<{ loan_id: string }>> {
  return safeRun("writeOffLoan", async () => {
    const { supabase, userId } = await userOrThrow();
    const { data: loanRow, error: loanErr } = await supabase
      .from("loans")
      .select("id, status, direction, notes")
      .eq("id", input.loan_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (loanErr || !loanRow) throw loanErr ?? new Error("Loan not found.");
    if (loanRow.status === "written_off") {
      return { loan_id: input.loan_id };
    }
    const dir = normalizeDirection(loanRow.direction as string);
    if (dir !== "received") {
      throw new Error("Only received loans can be written off.");
    }
    const nextNotes = input.reason
      ? `${loanRow.notes ?? ""}${loanRow.notes ? "\n\n" : ""}Written off: ${input.reason}`.slice(0, 4000)
      : loanRow.notes;
    const { error } = await supabase
      .from("loans")
      .update({ status: "written_off", notes: nextNotes })
      .eq("id", input.loan_id)
      .eq("user_id", userId);
    if (error) throw error;
    revalidateLoanSurfaces();
    return { loan_id: input.loan_id };
  });
}

// Surface-area alias. The design brief calls this entry-point createLoan;
// the internal name is createPersonalLoan (kept for backward compat with
// existing call sites). Either import works.
export const createLoan = createPersonalLoan;

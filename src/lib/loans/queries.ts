import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { normalizeDirection, type LoanDirectionView } from "./direction";
import type { Loan, LoanReturn } from "@/lib/supabase/types";

// Freelane Loans — server-side readers for the new bidirectional loans
// workflow. The legacy loans surface (migrations 0020 + safe-to-spend AI
// + curiosity sweep) still goes through src/lib/data/queries.ts;
// everything new (spending list projection, entity detail panel, loan
// detail sheet) reads through here.
//
// Direction normalization (lent==given, borrowed==received) lives in
// direction.ts so client + server modules share the same helper.

// Re-export for backwards compatibility with existing callers.
export { normalizeDirection, type LoanDirectionView };

export type GetLoansForUserOpts = {
  status?: Loan["status"];
  direction?: LoanDirectionView;
};

export async function getLoansForUser(opts: GetLoansForUserOpts = {}): Promise<Loan[]> {
  const user = await getAuthUser();
  if (!user) return [];
  const supabase = await createClient();
  let q = supabase
    .from("loans")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  if (opts.status) q = q.eq("status", opts.status);
  if (opts.direction) {
    const accepted = opts.direction === "given" ? ["given", "lent"] : ["received", "borrowed"];
    q = q.in("direction", accepted);
  }
  const { data } = await q;
  return (data ?? []) as Loan[];
}

export type LoanWithReturns = {
  loan: Loan;
  returns: LoanReturn[];
  returnedBase: number;
  outstandingBase: number;
};

export async function getLoanWithReturns(loanId: string): Promise<LoanWithReturns | null> {
  const user = await getAuthUser();
  if (!user) return null;
  const supabase = await createClient();
  const [{ data: loan }, { data: returns }] = await Promise.all([
    supabase
      .from("loans")
      .select("*")
      .eq("id", loanId)
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("loan_returns")
      .select("*")
      .eq("loan_id", loanId)
      .eq("user_id", user.id)
      .order("returned_at", { ascending: false }),
  ]);
  if (!loan) return null;
  const loanRow = loan as Loan;
  const returnRows = (returns ?? []) as LoanReturn[];
  const returnedBase = returnRows.reduce((s, r) => s + Number(r.amount_base ?? 0), 0);
  const outstandingBase = Math.max(0, Number(loanRow.principal_base ?? 0) - returnedBase);
  return { loan: loanRow, returns: returnRows, returnedBase, outstandingBase };
}

export type EntityLoanTotals = {
  givenOutstandingBase: number;
  receivedOutstandingBase: number;
  givenOpenCount: number;
  receivedOpenCount: number;
};

export type EntityLoansSummary = {
  loans: Loan[];
  returnsByLoan: Map<string, LoanReturn[]>;
  totals: EntityLoanTotals;
};

const OPEN_STATUSES = new Set<Loan["status"]>([
  "open",
  "partial",
  "partially_returned",
]);

export async function getLoansForEntity(entityId: string): Promise<EntityLoansSummary> {
  const user = await getAuthUser();
  if (!user) {
    return {
      loans: [],
      returnsByLoan: new Map(),
      totals: {
        givenOutstandingBase: 0,
        receivedOutstandingBase: 0,
        givenOpenCount: 0,
        receivedOpenCount: 0,
      },
    };
  }
  const supabase = await createClient();
  const { data: loanRows } = await supabase
    .from("loans")
    .select("*")
    .eq("user_id", user.id)
    .eq("counterparty_entity_id", entityId)
    .order("created_at", { ascending: false });
  const loans = (loanRows ?? []) as Loan[];
  const loanIds = loans.map((l) => l.id);
  let returnsByLoan = new Map<string, LoanReturn[]>();
  if (loanIds.length > 0) {
    const { data: returnRows } = await supabase
      .from("loan_returns")
      .select("*")
      .in("loan_id", loanIds)
      .eq("user_id", user.id);
    for (const r of (returnRows ?? []) as LoanReturn[]) {
      const arr = returnsByLoan.get(r.loan_id) ?? [];
      arr.push(r);
      returnsByLoan.set(r.loan_id, arr);
    }
  }

  let givenOutstandingBase = 0;
  let receivedOutstandingBase = 0;
  let givenOpenCount = 0;
  let receivedOpenCount = 0;
  for (const loan of loans) {
    const dir = normalizeDirection(loan.direction);
    if (!OPEN_STATUSES.has(loan.status)) continue;
    const returns = returnsByLoan.get(loan.id) ?? [];
    const returned = returns.reduce((s, r) => s + Number(r.amount_base ?? 0), 0);
    const outstanding = Math.max(0, Number(loan.principal_base ?? 0) - returned);
    if (dir === "given") {
      givenOutstandingBase += outstanding;
      givenOpenCount += 1;
    } else if (dir === "received") {
      receivedOutstandingBase += outstanding;
      receivedOpenCount += 1;
    }
  }

  return {
    loans,
    returnsByLoan,
    totals: {
      givenOutstandingBase,
      receivedOutstandingBase,
      givenOpenCount,
      receivedOpenCount,
    },
  };
}

export async function getLoansForSpend(spendId: string): Promise<Loan[]> {
  const user = await getAuthUser();
  if (!user) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("loans")
    .select("*")
    .eq("user_id", user.id)
    .eq("origin_spend_id", spendId);
  return (data ?? []) as Loan[];
}

// Pulls loans whose origin_spend_id is in the given list. Used by the
// spending list projection to mark spend rows as loans (given-direction
// only — received loans have no origin spend by design).
export async function getLoansForSpendIds(spendIds: string[]): Promise<Loan[]> {
  if (spendIds.length === 0) return [];
  const user = await getAuthUser();
  if (!user) return [];
  const supabase = await createClient();
  // Supabase 'in' filter caps around 1k — chunk to be safe.
  const CHUNK = 500;
  const out: Loan[] = [];
  for (let i = 0; i < spendIds.length; i += CHUNK) {
    const slice = spendIds.slice(i, i + CHUNK);
    const { data } = await supabase
      .from("loans")
      .select("*")
      .eq("user_id", user.id)
      .in("origin_spend_id", slice);
    out.push(...((data ?? []) as Loan[]));
  }
  return out;
}

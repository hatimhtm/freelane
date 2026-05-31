import type { Loan, LoanInstallment, LoanStatus, Spend } from "@/lib/supabase/types";

export interface LoanWithBalance {
  loan: Loan;
  installments: LoanInstallment[];
  repaymentsBase: number;
  balanceBase: number;
  derivedStatus: LoanStatus;
  upcoming: LoanInstallment[];
  overdue: LoanInstallment[];
}

// A repayment is any spend tied back to this loan, either directly via
// loan_id OR via loan_installment_id (the installment in turn names the loan).
// If both fields point to the same loan, this still counts the spend ONCE.
export function loanRepaymentsBase(
  loan: Loan,
  spends: Spend[],
  installments: LoanInstallment[],
): number {
  const installmentIds = new Set(
    installments.filter((i) => i.loan_id === loan.id).map((i) => i.id),
  );
  let total = 0;
  for (const sp of spends) {
    const matchesLoan = sp.loan_id === loan.id;
    const matchesInstallment = sp.loan_installment_id != null && installmentIds.has(sp.loan_installment_id);
    if (matchesLoan || matchesInstallment) total += Number(sp.amount_base ?? 0);
  }
  return total;
}

export function deriveLoanStatus(loan: Loan, repaymentsBase: number): LoanStatus {
  if (repaymentsBase <= 0) return "open";
  if (repaymentsBase >= Number(loan.principal_base)) return "closed";
  return "partial";
}

// Postgres `date` "YYYY-MM-DD" → `new Date(...)` parses as UTC midnight,
// which is 08:00 PHT in Manila. For "is this overdue at 11pm today?"
// comparisons that's wrong (would bucket as overdue 16 hours before the
// local day ends). Parse explicitly as local midnight instead.
function parseLocalDate(yyyymmdd: string): Date {
  const [y, m, d] = yyyymmdd.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function loansWithBalance(
  loans: Loan[],
  installments: LoanInstallment[],
  spends: Spend[],
  now: Date = new Date(),
): LoanWithBalance[] {
  const installmentsByLoan = new Map<string, LoanInstallment[]>();
  for (const i of installments) {
    const arr = installmentsByLoan.get(i.loan_id) ?? [];
    arr.push(i);
    installmentsByLoan.set(i.loan_id, arr);
  }
  return loans.map((loan) => {
    const insts = (installmentsByLoan.get(loan.id) ?? []).sort(
      (a, b) => parseLocalDate(a.due_date).getTime() - parseLocalDate(b.due_date).getTime(),
    );
    const repaymentsBase = loanRepaymentsBase(loan, spends, insts);
    const balanceBase = Math.max(0, Number(loan.principal_base) - repaymentsBase);
    const upcoming = insts.filter((i) => i.status === "pending" && parseLocalDate(i.due_date) >= now);
    const overdue = insts.filter((i) => i.status === "pending" && parseLocalDate(i.due_date) < now);
    return {
      loan,
      installments: insts,
      repaymentsBase,
      balanceBase,
      derivedStatus: deriveLoanStatus(loan, repaymentsBase),
      upcoming,
      overdue,
    };
  });
}

// Money the user OWES others (borrowed loans not yet closed), base currency.
// Feeds the committed pool for safe-to-spend.
export function totalOwedBase(loansWithBalance: LoanWithBalance[]): number {
  return loansWithBalance
    .filter((l) => l.loan.direction === "borrowed" && l.derivedStatus !== "closed")
    .reduce((s, l) => s + l.balanceBase, 0);
}

export function totalLentBase(loansWithBalance: LoanWithBalance[]): number {
  return loansWithBalance
    .filter((l) => l.loan.direction === "lent" && l.derivedStatus !== "closed")
    .reduce((s, l) => s + l.balanceBase, 0);
}

import Foundation
import SwiftData

/// Keeps loans wired into the one money ledger, so lending/borrowing actually
/// moves wallet balances — and returns can land in a different wallet.
/// Direction: given = I lent out (money leaves me); received = I borrowed (money comes in).
@MainActor
enum LoanEngine {

    /// On create, move the principal through the origin wallet.
    static func onCreate(_ context: ModelContext, loan: Loan) {
        guard let wallet = loan.originWalletId, loan.principalBase > 0 else { return }
        let outbound = loan.direction == .given
        let principal = round2(loan.principalBase)   // ledger rows are always 2dp, like insertLedger
        let entry = LedgerEntry(
            kind: outbound ? .outflow : .income,
            amountBase: outbound ? -principal : principal,
            walletId: wallet, relatedKind: .reconciliation, relatedId: loan.id,
            eventAt: loan.startedAt,
            note: (outbound ? "Lent to " : "Borrowed from ") + loan.counterparty)
        entry.dirty = true   // invariant: every ledger row syncs — never left at the default false
        context.insert(entry)
        try? context.save()
    }

    /// Record a (possibly partial) return into a chosen wallet and update status.
    static func recordReturn(_ context: ModelContext, loan: Loan, amountBase: Double, walletId: UUID) {
        // 2dp like every ledger row, so outstanding − amount stays cent-exact across partials.
        let amount = round2(min(amountBase, loan.outstandingBase))
        guard amount > 0 else { return }
        // Given loan returned → money comes back (income). Borrowed returned → I pay back (outflow).
        let inbound = loan.direction == .given
        let entry = LedgerEntry(
            kind: inbound ? .income : .outflow,
            amountBase: inbound ? amount : -amount,
            walletId: walletId, relatedKind: .reconciliation, relatedId: loan.id,
            eventAt: .now,
            note: (inbound ? "Repaid by " : "Repaid to ") + loan.counterparty)
        entry.dirty = true   // invariant: every ledger row syncs — never left at the default false
        context.insert(entry)
        loan.outstandingBase = round2(loan.outstandingBase - amount)
        loan.status = loan.outstandingBase <= 0.001 ? .returned : .partiallyReturned
        loan.dirty = true
        try? context.save()
    }

    /// Forgive a loan you gave: the money already left your wallet, so no ledger
    /// movement — just zero the balance and mark it.
    static func forgive(_ context: ModelContext, loan: Loan) {
        loan.forgivenBase = loan.outstandingBase   // what you let go = sadaka given
        loan.forgivenAt = .now
        loan.outstandingBase = 0
        loan.status = .forgiven
        loan.dirty = true
        try? context.save()
    }

    /// On delete, tombstone the loan and archive every ledger row it created (with the same
    /// timestamp) so wallet balances snap back — and the whole thing is restorable from Trash.
    static func onDelete(_ context: ModelContext, loan: Loan) {
        SoftDelete.trash(loan, ownsLedger: true, context: context)
        try? context.save()
    }

    static func onRestore(_ context: ModelContext, loan: Loan) {
        SoftDelete.restore(loan, ownsLedger: true, context: context)
        try? context.save()
    }
}

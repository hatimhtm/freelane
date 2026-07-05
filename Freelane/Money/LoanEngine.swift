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
        // ONE settled tolerance app-wide (0.005 — see LoanGroup.isSettled): sub-cent FX/rounding
        // dust is zeroed and closed, so a loan can never be "All settled" yet still open.
        if loan.outstandingBase <= 0.005 { loan.outstandingBase = 0; loan.status = .returned }
        else { loan.status = .partiallyReturned }
        loan.dirty = true
        try? context.save()
    }

    /// Apply a return across a person's OPEN loans of ONE direction, OLDEST FIRST (FIFO), spilling
    /// partials across loans as needed. The person's debt is treated as one pool, so the user never
    /// has to pick which specific loan a repayment goes against. Returns the amount actually applied.
    @discardableResult
    static func recordPooledReturn(_ context: ModelContext, loans: [Loan], amountBase: Double, walletId: UUID) -> Double {
        var remaining = round2(amountBase)
        guard remaining > 0 else { return 0 }
        let open = loans
            .filter { $0.outstandingBase > 0.005 && $0.status != .returned && $0.status != .forgiven }
            .sorted { $0.startedAt < $1.startedAt }   // oldest first
        var applied = 0.0
        for loan in open {
            if remaining <= 0.005 { break }
            let chunk = round2(min(remaining, loan.outstandingBase))
            recordReturn(context, loan: loan, amountBase: chunk, walletId: walletId)   // ledger + status + save
            remaining = round2(remaining - chunk)
            applied = round2(applied + chunk)
        }
        return applied
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

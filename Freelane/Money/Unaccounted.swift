import Foundation
import SwiftData

/// Money that left without a record.
///
/// Recalibrating a wallet writes a balancing `.adjustment` entry: the book said one thing, reality
/// said another. That difference was deliberately kept out of the spending figures — "an adjustment,
/// not a spend" — which is correct as bookkeeping and wrong as a description of what happened. The
/// money is gone. Leaving it out makes every net figure flatter than the truth and credits you with
/// keeping money you do not have.
///
/// So it counts as spending. Nothing is fabricated to do it: no invented `Spend` rows — a row you
/// cannot identify would poison the tag and vendor tables permanently, and could never be
/// un-invented. The figure is read straight off the ledger entries that already record it, and it
/// is always reported under its own name so it is never silently blended into what you did log.
enum Unaccounted {
    /// The marker `reconcileWallet` writes. Deliberately exact: `.adjustment` is also the fallback
    /// kind for a ledger row arriving from sync before its real kind is applied, and monthly wallet
    /// fees are `.outflow` with their own note.
    static let marker = "reconcile"

    /// Net reconciliation per day. Positive = money that appeared, negative = money that vanished.
    ///
    /// Netted per **day** because a recalibration is often corrected within minutes — a sync lands,
    /// the balance moves again, you set it a second time. Same-day pairs cancel out, which is what
    /// you want; a genuine discrepancy survives. Across your ledger this collapses 40 entries into
    /// 17 days, only three of which are net positive.
    static func netByDay(_ ledger: [LedgerEntry]) -> [Date: Double] {
        let cal = PHT.calendar
        var out: [Date: Double] = [:]
        for e in ledger where e.archivedAt == nil && e.kind == .adjustment && e.note == marker {
            out[cal.startOfDay(for: e.eventAt), default: 0] += e.amountBase
        }
        return out.filter { abs($0.value) >= 0.01 }
    }

    /// Money gone, per day, as positive numbers.
    static func spentByDay(_ ledger: [LedgerEntry]) -> [Date: Double] {
        netByDay(ledger).compactMapValues { $0 < 0 ? -$0 : nil }
    }

    /// Money that turned up with no explanation, per day, as positive numbers. Not income — it is
    /// most likely something you were paid and didn't log — but it is not spending either, so it is
    /// never quietly netted off the missing side.
    static func foundByDay(_ ledger: [LedgerEntry]) -> [Date: Double] {
        netByDay(ledger).compactMapValues { $0 > 0 ? $0 : nil }
    }

    // MARK: Windowed totals

    static func spent(from: Date, to: Date, ledger: [LedgerEntry]) -> Double {
        spentByDay(ledger).filter { $0.key >= from && $0.key < to }.values.reduce(0, +)
    }

    static func spent(since: Date, ledger: [LedgerEntry]) -> Double {
        spentByDay(ledger).filter { $0.key >= since }.values.reduce(0, +)
    }

    static func found(since: Date, ledger: [LedgerEntry]) -> Double {
        foundByDay(ledger).filter { $0.key >= since }.values.reduce(0, +)
    }

    /// How many separate days carry an unexplained shortfall — the honest measure of how much of
    /// your spending is going unlogged.
    static func days(since: Date, ledger: [LedgerEntry]) -> Int {
        spentByDay(ledger).keys.filter { $0 >= since }.count
    }

    /// A short line for anywhere the figure is shown, so it always explains itself.
    static func explain(_ amount: Double, days: Int, base: String) -> String {
        guard amount > 0 else { return "" }
        return "\(CurrencyFormat.string(amount, base, compact: true)) left your wallets on \(days) day\(days == 1 ? "" : "s") with no record — from balance corrections."
    }
}

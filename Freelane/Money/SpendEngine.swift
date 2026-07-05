import Foundation
import SwiftData

extension MoneyEngine {
    /// Record an outflow (mirrors createSpend in actions.ts) + ledger mirror.
    @discardableResult
    func createSpend(walletId: UUID?, amount: Double, currency: String, description: String?,
                     vendorName: String?, category: String?, isSadaka: Bool, spentAt: Date,
                     tags: [String] = [], isBusiness: Bool = false, isHouse: Bool = false) throws -> UUID {
        guard amount > 0 else { throw EngineError.invalid("Amount must be > 0.") }
        let amountBase = rates.toBase(amount, currency)
        let s = Spend(walletId: walletId, spentAt: spentAt, amount: amount, currency: currency,
                      amountBase: round2(amountBase), spendDescription: description)
        s.vendorName = vendorName
        s.tags = tags
        s.category = category ?? tags.first
        s.isSadaka = isSadaka
        s.isBusiness = isBusiness; s.isHouse = isHouse
        s.dirty = true
        context.insert(s)
        if let w = walletId {
            insertLedger(kind: isSadaka ? .sadakaPayment : .outflow, amountBase: -amountBase, walletId: w,
                         relatedKind: .spend, relatedId: s.id, eventAt: spentAt, note: "createSpend")
        }
        try context.save()
        return s.id
    }

    /// Edit a spend in place — updates fields and replaces its ledger entry so the
    /// wallet balance stays exact.
    func updateSpend(_ id: UUID, walletId: UUID?, amount: Double, currency: String, description: String?,
                     vendorName: String?, category: String?, isSadaka: Bool, spentAt: Date, tags: [String],
                     isBusiness: Bool = false, isHouse: Bool = false) throws {
        guard amount > 0 else { throw EngineError.invalid("Amount must be > 0.") }
        guard let s = (try? context.fetch(FetchDescriptor<Spend>()))?.first(where: { $0.id == id }) else { return }
        let amountBase = round2(rates.toBase(amount, currency))
        s.walletId = walletId; s.amount = amount; s.currency = currency; s.amountBase = amountBase
        s.spendDescription = description; s.vendorName = vendorName
        s.tags = tags; s.category = category ?? tags.first; s.isSadaka = isSadaka; s.spentAt = spentAt
        s.isBusiness = isBusiness; s.isHouse = isHouse
        s.updatedAt = .now; s.dirty = true
        // Replace the ledger mirror.
        archiveLedger(relatedKind: .spend, relatedId: id)
        if let w = walletId {
            insertLedger(kind: isSadaka ? .sadakaPayment : .outflow, amountBase: -amountBase, walletId: w,
                         relatedKind: .spend, relatedId: id, eventAt: spentAt, note: "updateSpend")
        }
        try context.save()
    }

    /// Settle a recurring bill — logs a spend for `amount`(per period) × periods + `fee`,
    /// advances the rule's "paid through", learns a typical figure for variable bills, and
    /// (for fixed bills) optionally updates the rule's amount going forward.
    @discardableResult
    func markRecurringPaid(recurringId: UUID, amount: Double, fee: Double = 0, periods: Int = 1,
                           walletId: UUID?, on date: Date, updateRule: Bool = false) throws -> UUID {
        guard let r = (try? context.fetch(FetchDescriptor<Recurring>()))?.first(where: { $0.id == recurringId }) else {
            throw EngineError.invalid("Recurring rule not found.")
        }
        let n = max(1, periods)
        let perPeriod = max(0, amount)
        let f = max(0, fee)
        let total = perPeriod * Double(n) + f
        guard total > 0 else { throw EngineError.invalid("Enter the amount you paid.") }
        let notes = (n > 1 ? " (\(n) periods)" : "") + (f > 0 ? " incl. \(CurrencyFormat.string(f, r.currency, compact: true)) fee" : "")
        let id = try createSpend(walletId: walletId, amount: total, currency: r.currency,
                                 description: r.label + notes,
                                 vendorName: nil, category: r.label, isSadaka: false, spentAt: date, tags: [r.label])
        if let sp = (try? context.fetch(FetchDescriptor<Spend>()))?.first(where: { $0.id == id }) {
            sp.recurringId = r.id; sp.coversPeriods = n; sp.dirty = true
        }
        // Learn the typical amount (variable bills always; fixed bills only on request).
        if r.isVariableAmount {
            let prior = r.amount
            let smoothed = prior > 0 ? (prior + perPeriod) / 2 : perPeriod
            r.amount = (smoothed / 10).rounded() * 10            // a clean approximate figure
            r.amountBase = round2(rates.toBase(r.amount, r.currency))
            r.dirty = true   // invariant: the learned amount must sync on its own, not ride resyncRecurring's flag
        } else if updateRule {
            r.amount = perPeriod; r.amountBase = round2(rates.toBase(perPeriod, r.currency))
            r.dirty = true
        }
        // "Paid through" is DERIVED from the linked spends — never advanced from the payment
        // date — so a bill paid late settles the period it belongs to, and deleting the spend
        // later rolls it straight back. One source of truth, no separate counter to drift.
        resyncRecurring(r.id)
        return id
    }

    func deleteSpend(_ id: UUID) throws {
        guard let s = (try? context.fetch(FetchDescriptor<Spend>()))?.first(where: { $0.id == id }) else { return }
        let recurringId = s.recurringId        // capture before we tombstone it
        // Reversible: tombstone the spend and archive its ledger together (restorable from Trash/Undo).
        SoftDelete.trash(s, ownsLedger: true, context: context)
        // Hide its line-items too, so price-memory / good-deal stats stop counting a deleted receipt.
        let stamp = s.deletedAt
        for item in (try? context.fetch(FetchDescriptor<SpendItem>(predicate: #Predicate { $0.spendId == id }))) ?? [] {
            item.deletedAt = stamp; item.dirty = true
        }
        resyncRecurring(recurringId)           // a deleted bill payment makes the period due again
        try context.save()
    }

    func restoreSpend(_ id: UUID) throws {
        guard let s = (try? context.fetch(FetchDescriptor<Spend>()))?.first(where: { $0.id == id }) else { return }
        SoftDelete.restore(s, ownsLedger: true, context: context)
        for item in (try? context.fetch(FetchDescriptor<SpendItem>(predicate: #Predicate { $0.spendId == id && $0.deletedAt != nil }))) ?? [] {
            item.deletedAt = nil; item.dirty = true
        }
        resyncRecurring(s.recurringId)         // restoring it re-settles the period
        try context.save()
    }

    /// Re-derive a recurring rule's `paidThroughDate` from its live linked spends. Called
    /// after any change to a spend that settles a bill (pay / delete / restore), so the
    /// Recurring tab always reflects what's actually been recorded. Saves the context.
    func resyncRecurring(_ recurringId: UUID?) {
        guard let rid = recurringId,
              let r = (try? context.fetch(FetchDescriptor<Recurring>()))?.first(where: { $0.id == rid }) else { return }
        let spends = (try? context.fetch(FetchDescriptor<Spend>())) ?? []
        let derived = RecurringMath.recomputePaidThrough(r, spends: spends)
        if r.paidThroughDate != derived { r.paidThroughDate = derived; r.dirty = true }
        try? context.save()
    }
}

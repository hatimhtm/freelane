import Foundation
import SwiftData

extension MoneyEngine {
    /// Record an outflow (mirrors createSpend in actions.ts) + ledger mirror.
    @discardableResult
    func createSpend(walletId: UUID?, amount: Double, currency: String, description: String?,
                     vendorName: String?, category: String?, isSadaka: Bool, spentAt: Date,
                     tags: [String] = [], isBusiness: Bool = false, isHouse: Bool = false) throws -> UUID {
        guard amount > 0 else { throw EngineError.invalid("Amount must be > 0.") }
        try requireRate(currency)
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
        try requireRate(currency)
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
        RecurringMath.resyncAll(context)   // a moved bill payment can settle a different period
        try context.save()
    }

    /// A currency with no rate used to convert 1:1 ("100 GBP" booked as ₱100) and stay fx-locked
    /// that way. Refuse instead; FXService keeps a rate for every currency the forms offer.
    func requireRate(_ currency: String) throws {
        guard rates.hasRate(for: currency) else {
            throw EngineError.invalid("No exchange rate for \(currency) yet. Connect to the internet once so Freelane can fetch it.")
        }
    }

    /// Settle a recurring bill — logs a spend for `amount`(per period) × periods + `fee`,
    /// advances the rule's "paid through", learns a typical figure for variable bills, and
    /// (for fixed bills) optionally updates the rule's amount going forward.
    @discardableResult
    func markRecurringPaid(recurringId: UUID, amount: Double, fee: Double = 0, periods: Int = 1,
                           walletId: UUID?, on date: Date, updateRule: Bool = false, currency: String? = nil) throws -> UUID {
        guard let r = (try? context.fetch(FetchDescriptor<Recurring>()))?.first(where: { $0.id == recurringId }) else {
            throw EngineError.invalid("Recurring rule not found.")
        }
        // Paid in any currency; the bill keeps its own.
        let paidIn = currency ?? r.currency
        try requireRate(paidIn)
        let n = max(1, periods)
        let perPeriod = max(0, amount)
        let f = max(0, fee)
        let total = perPeriod * Double(n) + f
        guard total > 0 else { throw EngineError.invalid("Enter the amount you paid.") }
        let notes = (n > 1 ? " (\(n) periods)" : "") + (f > 0 ? " incl. \(CurrencyFormat.string(f, paidIn, compact: true)) fee" : "")
        let id = try createSpend(walletId: walletId, amount: total, currency: paidIn,
                                 description: r.label + notes,
                                 vendorName: nil, category: r.label, isSadaka: false, spentAt: date, tags: [r.label])
        if let sp = (try? context.fetch(FetchDescriptor<Spend>()))?.first(where: { $0.id == id }) {
            sp.recurringId = r.id; sp.coversPeriods = n; sp.dirty = true
        }
        // Learn the typical amount (variable bills always; fixed bills only on request).
        // What one period came to, in the bill's own currency.
        let month = paidIn == r.currency ? perPeriod : rates.toBase(perPeriod, paidIn) / max(rates.toBase(1, r.currency), 0.000001)
        if r.isVariableAmount {
            let prior = r.amount
            let smoothed = prior > 0 ? (prior + month) / 2 : month
            r.amount = (smoothed / 10).rounded() * 10            // a clean approximate figure
            r.amountBase = round2(rates.toBase(r.amount, r.currency))
            r.dirty = true   // invariant: the learned amount must sync on its own, not ride resyncAll's flag
        } else if updateRule {
            r.amount = round2(month); r.amountBase = round2(rates.toBase(month, r.currency))
            r.dirty = true
        }
        // "Paid through" is DERIVED from the linked spends — never advanced from the payment
        // date — so a bill paid late settles the period it belongs to, and deleting the spend
        // later rolls it straight back. One source of truth, no separate counter to drift.
        RecurringMath.resyncAll(context)
        try context.save()
        return id
    }

    func deleteSpend(_ id: UUID) throws {
        guard let s = (try? context.fetch(FetchDescriptor<Spend>()))?.first(where: { $0.id == id }) else { return }
        // Reversible: tombstone the spend and archive its ledger together (restorable from Trash/Undo).
        SoftDelete.trash(s, ownsLedger: true, context: context)
        // Hide its line-items too, so price-memory / good-deal stats stop counting a deleted receipt.
        let stamp = s.deletedAt
        for item in (try? context.fetch(FetchDescriptor<SpendItem>(predicate: #Predicate { $0.spendId == id }))) ?? [] {
            item.deletedAt = stamp; item.dirty = true
        }
        RecurringMath.resyncAll(context)       // a deleted bill payment makes the period due again
        try context.save()
    }

    func restoreSpend(_ id: UUID) throws {
        guard let s = (try? context.fetch(FetchDescriptor<Spend>()))?.first(where: { $0.id == id }) else { return }
        SoftDelete.restore(s, ownsLedger: true, context: context)
        for item in (try? context.fetch(FetchDescriptor<SpendItem>(predicate: #Predicate { $0.spendId == id && $0.deletedAt != nil }))) ?? [] {
            item.deletedAt = nil; item.dirty = true
        }
        RecurringMath.resyncAll(context)       // restoring it re-settles the period
        try context.save()
    }
}

/// The wallet a new outflow most likely came from: the one that paid this bill last time, else the
/// one the last spend came from, else the first holding wallet that counts toward totals. A plain
/// `.first` picked whatever sorted first, which here is the bank wire excluded from totals.
enum DefaultWallet {
    @MainActor
    static func forOutflow(_ context: ModelContext, among wallets: [Wallet], recurringId: UUID? = nil) -> UUID? {
        let usable = wallets.filter { $0.isHolding && !$0.archived && $0.deletedAt == nil }
        var d = FetchDescriptor<Spend>(predicate: #Predicate { $0.deletedAt == nil && $0.walletId != nil },
                                       sortBy: [SortDescriptor(\.spentAt, order: .reverse)])
        d.fetchLimit = 200
        let recent = ((try? context.fetch(d)) ?? []).filter { s in usable.contains { $0.id == s.walletId } }
        if let rid = recurringId, let w = recent.first(where: { $0.recurringId == rid })?.walletId { return w }
        return recent.first?.walletId ?? usable.first(where: { !$0.excludedFromTotals })?.id ?? usable.first?.id
    }

    /// Where income usually lands: the wallet the most recent payment landed in, if it's still live.
    @MainActor
    static func forIncome(_ context: ModelContext, among wallets: [Wallet]) -> UUID? {
        var d = FetchDescriptor<PaymentStep>(predicate: #Predicate { $0.isFinal && $0.methodId != nil },
                                             sortBy: [SortDescriptor(\.createdAt, order: .reverse)])
        d.fetchLimit = 1
        guard let id = (try? context.fetch(d))?.first?.methodId else { return nil }
        return wallets.contains { $0.id == id && !$0.archived && $0.deletedAt == nil } ? id : nil
    }
}

import Foundation
import SwiftData

// What the pages offer for changing or removing anything you've put in: a project, a client, a wallet, a
// payment in full, and a day's count. Each writes the same rows the phone's engine does (Engine.kt), so an
// edit on either side reads the same on the other. Deletes go to the Trash and come back with Undo.

extension MoneyEngine {
    private func fetchAll<T: PersistentModel>(_ type: T.Type) -> [T] { (try? context.fetch(FetchDescriptor<T>())) ?? [] }

    // MARK: Projects

    /// Change a project: its name, client, agreed amount and whether the work is delivered. Delivered keeps
    /// the day it was first marked; undelivered clears it.
    func updateProject(_ id: UUID, title: String, clientId: UUID?, amount: Double, currency: String, delivered: Bool) throws {
        let name = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { throw EngineError.invalid("Name the project.") }
        guard amount > 0 else { throw EngineError.invalid("Type the agreed amount.") }
        guard let p = project(id) else { return }
        p.title = name; p.clientId = clientId; p.amount = amount; p.currency = currency
        if delivered { if p.workCompletedAt == nil { p.workCompletedAt = .now } } else { p.workCompletedAt = nil }
        p.updatedAt = .now; p.dirty = true
        recomputeProjectStatus(id)
        try context.save()
    }

    func deleteProject(_ id: UUID) throws {
        guard let p = project(id) else { return }
        SoftDelete.trash(p, ownsLedger: false, context: context)
        try context.save()
    }

    func restoreProject(_ id: UUID) throws {
        guard let p = fetchAll(Project.self).first(where: { $0.id == id }) else { return }
        SoftDelete.restore(p, ownsLedger: false, context: context)
        try context.save()
    }

    // MARK: Clients

    /// Add a client, or change one: the person, the company and the currency they usually pay in.
    @discardableResult
    func saveClient(_ id: UUID?, name: String, company: String?, currency: String?) throws -> UUID {
        let n = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !n.isEmpty else { throw EngineError.invalid("Give the client a name.") }
        let co = company?.trimmingCharacters(in: .whitespacesAndNewlines)
        let c: Client
        if let id, let existing = fetchAll(Client.self).first(where: { $0.id == id }) {
            c = existing
        } else {
            c = Client(name: n)
            context.insert(c)
        }
        c.name = n
        c.company = (co?.isEmpty ?? true) ? nil : co
        c.defaultCurrency = currency
        c.updatedAt = .now; c.dirty = true
        try context.save()
        return c.id
    }

    func deleteClient(_ id: UUID) throws {
        guard let c = fetchAll(Client.self).first(where: { $0.id == id && $0.deletedAt == nil }) else { return }
        SoftDelete.trash(c, ownsLedger: false, context: context)
        try context.save()
    }

    func restoreClient(_ id: UUID) throws {
        guard let c = fetchAll(Client.self).first(where: { $0.id == id }) else { return }
        SoftDelete.restore(c, ownsLedger: false, context: context)
        try context.save()
    }

    // MARK: Wallets

    /// Change a wallet: its name, kind and whether it counts in your totals. Its balance changes by counting.
    func updateWallet(_ id: UUID, name: String, kind: WalletKind, inTotals: Bool) throws {
        let n = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !n.isEmpty else { throw EngineError.invalid("Give it a name.") }
        guard let w = fetchAll(Wallet.self).first(where: { $0.id == id }) else { return }
        w.name = n; w.kindRaw = kind.rawValue; w.excludedFromTotals = !inTotals
        w.updatedAt = .now; w.dirty = true
        try context.save()
    }

    /// The wallet leaves your totals and your lists; what happened in it stays in the ledger.
    func deleteWallet(_ id: UUID) throws {
        guard let w = fetchAll(Wallet.self).first(where: { $0.id == id && $0.deletedAt == nil }) else { return }
        SoftDelete.trash(w, ownsLedger: false, context: context)
        try context.save()
    }

    func restoreWallet(_ id: UUID) throws {
        guard let w = fetchAll(Wallet.self).first(where: { $0.id == id }) else { return }
        SoftDelete.restore(w, ownsLedger: false, context: context)
        try context.save()
    }

    // MARK: Payments

    /// Change a payment in full: who it was for, what they sent, what arrived and where, and when. Its final
    /// step follows, its income leg is replaced (the old one archived), its allocation moves with it, and both
    /// projects it touches are recomputed.
    func updatePayment(_ id: UUID, projectId: UUID?, amountIn: Double, currencyIn: String, netBase: Double, walletId: UUID, paidAt: Date) throws {
        guard amountIn > 0 else { throw EngineError.invalid("Amount must be greater than zero.") }
        try requireRate(currencyIn)
        guard let p = payment(id) else { return }
        let oldProject = p.projectId
        let net = round2(netBase)
        let gross = round2(rates.toBase(amountIn, currencyIn))
        p.projectId = projectId; p.amount = amountIn; p.currency = currencyIn; p.paidAt = paidAt
        p.netAmountBase = net; p.grossAtMarketBase = gross; p.impliedFeeBase = max(0, round2(gross - net))
        p.fxLocked = true; p.updatedAt = .now; p.dirty = true

        // What they sent is the first step's; where it landed and what arrived, the last one's (one and the
        // same for a payment that went straight to a wallet).
        let chain = steps(paymentId: id)
        if let first = chain.first, let last = chain.last {
            first.amountIn = amountIn; first.currencyIn = currencyIn; first.dirty = true
            last.methodId = walletId; last.amountOut = net; last.currencyOut = base; last.dirty = true
        } else {
            let step = PaymentStep(paymentId: id, stepOrder: 1, fromMethodId: nil, methodId: walletId, amountIn: amountIn,
                                   currencyIn: currencyIn, amountOut: net, currencyOut: base, isFinal: true)
            step.dirty = true
            context.insert(step)
        }
        if net > 0 {
            replaceLedger(relatedKind: .payment, relatedId: id, kind: .income, amountBase: net, walletId: walletId, eventAt: paidAt, note: "updatePayment")
        } else {
            archiveLedger(relatedKind: .payment, relatedId: id)
        }

        // One allocation follows the payment to its project; a split payment keeps its split, rescaled.
        let mine = allocations(paymentId: id)
        if mine.count <= 1 {
            for a in mine { context.delete(a) }
            if let projectId {
                let a = PaymentAllocation(paymentId: id, projectId: projectId, allocationAmount: amountIn, allocationCurrency: currencyIn, allocationBase: net)
                a.dirty = true
                context.insert(a)
            }
        } else {
            let total = mine.reduce(0) { $0 + max(0, $1.allocationBase) }
            var running = 0.0
            for (i, a) in mine.enumerated() {
                if i == mine.count - 1 { a.allocationBase = round2(net - running) }
                else { let s = round2(total > 0 ? net * a.allocationBase / total : net / Double(mine.count)); a.allocationBase = s; running += s }
                a.dirty = true
            }
        }
        var touched = Set(mine.map(\.projectId))
        if let oldProject { touched.insert(oldProject) }
        if let projectId { touched.insert(projectId) }
        for pid in touched { recomputeProjectStatus(pid) }
        try context.save()
    }

    // MARK: Counts

    /// Take back a day's count: its balancing legs and the zero "counted" marks are archived at one instant, so
    /// the wallets go back to what Freelane had before. A spend the count labelled stays, to delete on its own.
    @discardableResult
    func deleteCount(day: Date) throws -> Date {
        let stamp = Date.now
        let start = PHT.startOfDay(day)
        let end = PHT.calendar.date(byAdding: .day, value: 1, to: start) ?? start.addingTimeInterval(86_400)
        for e in fetchAll(LedgerEntry.self) where e.archivedAt == nil && e.kind == .adjustment && e.relatedKindRaw == nil
            && (e.note == Unaccounted.marker || e.note == "count") && e.eventAt >= start && e.eventAt < end {
            e.archivedAt = stamp; e.dirty = true
        }
        try context.save()
        return stamp
    }

    /// Bring a deleted count back: exactly the legs that delete archived.
    func restoreCount(archivedAt: Date) throws {
        for e in fetchAll(LedgerEntry.self) where e.kind == .adjustment && e.relatedKindRaw == nil && e.archivedAt == archivedAt {
            e.archivedAt = nil; e.dirty = true
        }
        try context.save()
    }
}

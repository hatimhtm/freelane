import Foundation
import SwiftData

// MARK: - Inputs (mirror PaymentChainInput / BulkPaymentRowInput from actions.ts)

struct ChainStepInput {
    var fromMethodId: UUID?
    var methodId: UUID?
    var amountIn: Double
    var currencyIn: String
    var amountOut: Double
    var currencyOut: String
    var notes: String?
}

struct ProjectAllocInput {
    var projectId: UUID
    var allocationAmount: Double
    var currency: String
    var notes: String?
}

struct PaymentChainInput {
    var projectId: UUID?
    var projects: [ProjectAllocInput]?
    var paidAt: Date
    var steps: [ChainStepInput]
    var reference: String?
    var notes: String?
}

struct BulkRow {
    var projectId: UUID
    var paidAt: Date
    var grossAmount: Double
    var grossCurrency: String
    var feeBase: Double?
    var landingMethodId: UUID?
    var fromMethodId: UUID?
    var reference: String?
    var notes: String?
}

enum EngineError: LocalizedError {
    case invalid(String)
    var errorDescription: String? {
        switch self { case .invalid(let m): return m }
    }
}

// MARK: - Money engine (faithful port of actions.ts money mutations)

@MainActor
struct MoneyEngine {
    let context: ModelContext
    let base: String
    let rates: Rates

    init(context: ModelContext) {
        self.context = context
        let settings = MoneyEngine.settings(in: context)
        self.base = settings.baseCurrency
        let rateRows = (try? context.fetch(FetchDescriptor<ExchangeRate>())) ?? []
        self.rates = Rates(base: settings.baseCurrency, rates: rateRows)
    }

    // MARK: Settings singleton

    static func settings(in context: ModelContext) -> AppSettings {
        if let s = (try? context.fetch(FetchDescriptor<AppSettings>()))?.first { return s }
        let s = AppSettings()
        context.insert(s)
        return s
    }

    // MARK: Fetch helpers (filter in-memory — robust at personal scale)

    private func all<T: PersistentModel>(_ type: T.Type) -> [T] {
        let rows = (try? context.fetch(FetchDescriptor<T>())) ?? []
        // Trashed (soft-deleted) entities must never enter money math.
        if T.self is any SoftDeletable.Type { return rows.filter { ($0 as? any SoftDeletable)?.deletedAt == nil } }
        return rows
    }
    /// Like `all` but keeps tombstoned rows — for child tables (allocations/steps) whose
    /// parent's live-ness is checked separately.
    private func allIncludingTrashed<T: PersistentModel>(_ type: T.Type) -> [T] {
        (try? context.fetch(FetchDescriptor<T>())) ?? []
    }

    func project(_ id: UUID) -> Project? { all(Project.self).first { $0.id == id } }
    func payment(_ id: UUID) -> Payment? { all(Payment.self).first { $0.id == id } }
    func steps(paymentId: UUID) -> [PaymentStep] {
        all(PaymentStep.self).filter { $0.paymentId == paymentId }.sorted { $0.stepOrder < $1.stepOrder }
    }
    func allocations(paymentId: UUID) -> [PaymentAllocation] {
        allIncludingTrashed(PaymentAllocation.self).filter { $0.paymentId == paymentId }
    }
    func allocations(projectId: UUID) -> [PaymentAllocation] {
        // Exclude allocations whose parent payment is trashed, so project paid/outstanding
        // drops a trashed payment and snaps back on restore.
        let live = Set(all(Payment.self).map { $0.id })
        return allIncludingTrashed(PaymentAllocation.self).filter { $0.projectId == projectId && live.contains($0.paymentId) }
    }
    func liveLedger(relatedKind: LedgerRelatedKind, relatedId: UUID) -> [LedgerEntry] {
        all(LedgerEntry.self).filter {
            $0.relatedKindRaw == relatedKind.rawValue && $0.relatedId == relatedId && $0.archivedAt == nil
        }
    }

    // MARK: Ledger mirror

    func insertLedger(kind: LedgerKind, amountBase: Double, walletId: UUID?,
                      relatedKind: LedgerRelatedKind?, relatedId: UUID?, eventAt: Date, note: String?) {
        let e = LedgerEntry(kind: kind, amountBase: round2(amountBase), walletId: walletId,
                            relatedKind: relatedKind, relatedId: relatedId, eventAt: eventAt, note: note)
        e.dirty = true
        context.insert(e)
    }

    /// Reconcile a wallet to a known ACTUAL balance by writing a single balancing adjustment entry
    /// (book → actual). Non-destructive: prior ledger is preserved, so history stays intact and the
    /// book balance now matches reality. For when you lost track logging in real time.
    @discardableResult
    func reconcileWallet(_ walletId: UUID, actualBase: Double) -> Double {
        let ledger = all(LedgerEntry.self)
        guard let w = all(Wallet.self).first(where: { $0.id == walletId }) else { return 0 }
        let current = WalletMath.balance(of: w, ledger: ledger)
        let delta = round2(actualBase - current)
        guard abs(delta) >= 0.01 else { return 0 }
        insertLedger(kind: .adjustment, amountBase: delta, walletId: walletId,
                     relatedKind: nil, relatedId: nil, eventAt: .now, note: "reconcile")
        try? context.save()
        return delta
    }

    /// Post this month's stored monthly wallet fee (if any) as an outflow, once per month per wallet.
    func applyMonthlyFees() {
        let ledger = all(LedgerEntry.self)
        let monthStart = PHT.startOfMonth()
        for w in all(Wallet.self) where w.monthlyFeeBase > 0 && !w.archived {
            // Already charged this month? (an adjustment note "monthly-fee" dated this month)
            let charged = ledger.contains { $0.walletId == w.id && $0.note == "monthly-fee"
                && $0.archivedAt == nil && $0.eventAt >= monthStart }
            guard !charged else { continue }
            insertLedger(kind: .outflow, amountBase: -round2(w.monthlyFeeBase), walletId: w.id,
                         relatedKind: nil, relatedId: nil, eventAt: .now, note: "monthly-fee")
        }
        try? context.save()
    }

    func archiveLedger(relatedKind: LedgerRelatedKind, relatedId: UUID) {
        for e in liveLedger(relatedKind: relatedKind, relatedId: relatedId) {
            e.archivedAt = .now
            e.dirty = true
        }
    }

    func replaceLedger(relatedKind: LedgerRelatedKind, relatedId: UUID, kind: LedgerKind,
                       amountBase: Double, walletId: UUID?, eventAt: Date, note: String?) {
        archiveLedger(relatedKind: relatedKind, relatedId: relatedId)
        insertLedger(kind: kind, amountBase: amountBase, walletId: walletId,
                     relatedKind: relatedKind, relatedId: relatedId, eventAt: eventAt, note: note)
    }

    // MARK: addPaymentWithChain (actions.ts:725)

    @discardableResult
    func addPayment(_ input: PaymentChainInput) throws -> UUID {
        guard let first = input.steps.first, let final = input.steps.last else {
            throw EngineError.invalid("A payment needs at least one step.")
        }
        guard first.amountIn > 0 else { throw EngineError.invalid("Amount must be greater than zero.") }
        let hasMulti = (input.projects?.isEmpty == false)
        let primaryProjectId: UUID? = hasMulti
            ? input.projects!.max(by: { $0.allocationAmount < $1.allocationAmount })!.projectId
            : input.projectId

        // Money (actions.ts:761–786). Round gross and net to 2dp FIRST, then derive the fee from
        // those rounded figures, so the stored invariant fee = gross − net always holds exactly
        // (and the ledger below posts the same rounded net — no sub-cent drift).
        let netBase = round2(final.currencyOut == base ? final.amountOut : rates.toBase(final.amountOut, final.currencyOut))
        let grossBase = round2(rates.toBase(first.amountIn, first.currencyIn))
        let feeBase = max(0, round2(grossBase - netBase))

        let payment = Payment(projectId: primaryProjectId, amount: first.amountIn,
                              currency: first.currencyIn, paidAt: input.paidAt)
        payment.netAmountBase = netBase
        payment.grossAtMarketBase = grossBase
        payment.impliedFeeBase = feeBase
        payment.reference = input.reference
        payment.notes = input.notes
        payment.fxLocked = true
        payment.dirty = true
        context.insert(payment)

        // Steps (actions.ts:789–802)
        for (i, s) in input.steps.enumerated() {
            let step = PaymentStep(paymentId: payment.id, stepOrder: i + 1,
                                   fromMethodId: s.fromMethodId, methodId: s.methodId,
                                   amountIn: s.amountIn, currencyIn: s.currencyIn,
                                   amountOut: s.amountOut, currencyOut: s.currencyOut,
                                   isFinal: i == input.steps.count - 1)
            step.notes = s.notes
            step.dirty = true
            context.insert(step)
        }

        // Ledger mirror (actions.ts:807–819)
        if let landing = final.methodId, netBase > 0 {
            insertLedger(kind: .income, amountBase: netBase, walletId: landing,
                         relatedKind: .payment, relatedId: payment.id,
                         eventAt: input.paidAt, note: "addPaymentWithChain")
        }

        // Allocations (actions.ts:830–880)
        if hasMulti {
            let projects = input.projects!
            let shareRaw = projects.map { rates.toBase($0.allocationAmount, $0.currency) }
            let totalShare = shareRaw.reduce(0, +)
            let netRounded = round2(netBase)
            var running = 0.0
            var rounded: [Double] = []
            var roundingRemainder = 0.0   // what the last slice absorbed beyond its raw share
            for i in projects.indices {
                if i < projects.count - 1 {
                    let raw = totalShare > 0 ? (shareRaw[i] / totalShare) * netBase : 0
                    let r = round2(raw)
                    rounded.append(r)
                    running += r
                } else {
                    let absorbed = round2(netRounded - running)
                    let rawLast = totalShare > 0 ? (shareRaw[i] / totalShare) * netBase : 0
                    // Compare against the TRUE (unrounded) proportional share — rounding
                    // rawLast first would mask sub-cent remainders that still cross 0.01.
                    roundingRemainder = round2(absorbed - rawLast)
                    rounded.append(absorbed)
                }
            }
            let lastIdx = projects.count - 1
            for (i, p) in projects.enumerated() {
                let a = PaymentAllocation(paymentId: payment.id, projectId: p.projectId,
                                          allocationAmount: p.allocationAmount,
                                          allocationCurrency: p.currency, allocationBase: rounded[i])
                // Make the rounding visible instead of letting the last slice silently absorb
                // it — so the split always reconciles to the net on inspection.
                if i == lastIdx && abs(roundingRemainder) >= 0.01 {
                    let sign = roundingRemainder > 0 ? "+" : "−"
                    let audit = "Includes \(sign)\(CurrencyFormat.string(abs(roundingRemainder), base)) rounding adjustment"
                    a.notes = [p.notes, audit].compactMap { $0?.isEmpty == false ? $0 : nil }.joined(separator: " · ")
                } else {
                    a.notes = p.notes
                }
                a.dirty = true
                context.insert(a)
            }
        } else if let pid = primaryProjectId {
            let a = PaymentAllocation(paymentId: payment.id, projectId: pid,
                                      allocationAmount: first.amountIn, allocationCurrency: first.currencyIn,
                                      allocationBase: round2(netBase))
            a.dirty = true
            context.insert(a)
        }

        // Recompute touched projects (actions.ts:882–888)
        let touched: Set<UUID> = hasMulti
            ? Set(input.projects!.map { $0.projectId })
            : Set([primaryProjectId].compactMap { $0 })
        for pid in touched { recomputeProjectStatus(pid) }

        try context.save()
        return payment.id
    }

    // MARK: addPaymentsReceivedBulk (actions.ts:981)

    @discardableResult
    func addPaymentsBulk(_ rows: [BulkRow]) -> (created: Int, errors: [(Int, String)]) {
        var created = 0
        var errors: [(Int, String)] = []
        for (i, row) in rows.enumerated() {
            do {
                guard row.grossAmount > 0 else { throw EngineError.invalid("Gross amount must be > 0.") }
                // Round gross and the entered fee to 2dp, then derive net from those — so addPayment
                // re-derives exactly this fee (no rounding-order drift on import).
                let grossBase = round2(rates.toBase(row.grossAmount, row.grossCurrency))
                let fee = round2(max(0, row.feeBase ?? 0))
                let netBase = max(0, grossBase - fee)
                let step = ChainStepInput(fromMethodId: row.fromMethodId, methodId: row.landingMethodId,
                                          amountIn: row.grossAmount, currencyIn: row.grossCurrency,
                                          amountOut: netBase, currencyOut: base, notes: nil)
                try addPayment(PaymentChainInput(projectId: row.projectId, projects: nil,
                                                 paidAt: row.paidAt, steps: [step],
                                                 reference: row.reference, notes: row.notes))
                created += 1
            } catch {
                errors.append((i, error.localizedDescription))
            }
        }
        return (created, errors)
    }

    // MARK: updatePaymentDetails (actions.ts:1090)

    func updatePaymentDetails(paymentId: UUID, netReceivedBase: Double?, methodId: UUID??,
                              fromMethodId: UUID??, feeUnknown: Bool) throws {
        guard let payment = payment(paymentId) else { throw EngineError.invalid("Payment not found.") }
        let existing = steps(paymentId: paymentId)

        let gross = payment.grossAtMarketBase ?? rates.toBase(payment.amount, payment.currency)
        let net = feeUnknown ? gross : max(0, netReceivedBase ?? payment.netAmountBase ?? gross)
        let fee = max(0, gross - net)

        payment.netAmountBase = round2(net)
        payment.grossAtMarketBase = round2(gross)
        payment.impliedFeeBase = round2(fee)
        payment.feeUnknown = feeUnknown
        payment.fxLocked = true
        payment.updatedAt = .now
        payment.dirty = true

        if let firstStep = existing.first, let finalStep = existing.last {
            if case let .some(newMethod) = methodId { finalStep.methodId = newMethod }
            if case let .some(newFrom) = fromMethodId { firstStep.fromMethodId = newFrom; firstStep.dirty = true }
            // Keep the final step's amountOut in lockstep with the edited net. The canonical
            // spec (MONEY-ENGINE.md §3.1) derives netBase FROM final.amountOut, and sync pushes
            // amount_out — leaving the old value here made a fee correction locally right but
            // silently wrong on any platform that re-derives from the chain.
            finalStep.amountOut = round2(net)
            finalStep.currencyOut = base
            finalStep.dirty = true
        } else {
            let landing: UUID?
            if case let .some(m) = methodId { landing = m } else { landing = nil }
            let from: UUID?
            if case let .some(f) = fromMethodId { from = f } else { from = nil }
            let step = PaymentStep(paymentId: paymentId, stepOrder: 1, fromMethodId: from, methodId: landing,
                                   amountIn: payment.amount, currencyIn: payment.currency,
                                   amountOut: round2(net), currencyOut: base, isFinal: true)
            step.dirty = true
            context.insert(step)
        }

        let landingWallet = steps(paymentId: paymentId).last?.methodId
        if let wallet = landingWallet, net > 0 {
            // Invariant: the income event stays dated at paidAt — editing details must not move
            // money across month windows or past a wallet's opening-balance anchor (double count).
            replaceLedger(relatedKind: .payment, relatedId: paymentId, kind: .income,
                          amountBase: net, walletId: wallet, eventAt: payment.paidAt, note: "updatePaymentDetails")
        } else {
            archiveLedger(relatedKind: .payment, relatedId: paymentId)
        }

        // Keep the project allocation(s) in lockstep with the new net, so project
        // paid/outstanding can't drift from the wallet ledger.
        let mine = ((try? context.fetch(FetchDescriptor<PaymentAllocation>())) ?? []).filter { $0.paymentId == paymentId }
        if mine.count == 1 {
            mine[0].allocationBase = round2(net); mine[0].dirty = true
        } else if mine.count > 1 {
            // Re-spread `net` across the allocations. Prefer the existing split as the
            // weight; if a prior edit zeroed every allocation (oldTotal == 0) fall back
            // to the projects' quoted base amounts, and finally to an even split — so a
            // multi-project payment can never get stranded with stale/zero allocations
            // while the ledger income is restored (which silently drifted before).
            var weights = mine.map { max(0, $0.allocationBase) }
            if weights.reduce(0, +) <= 0 {
                weights = mine.map { alloc in
                    guard let p = project(alloc.projectId) else { return 1.0 }
                    return max(0.0001, rates.toBase(p.amount, p.currency))
                }
            }
            let total = weights.reduce(0, +)
            var running = 0.0
            for (i, a) in mine.enumerated() {
                if i == mine.count - 1 { a.allocationBase = round2(net - running) }
                else { let s = round2(net * (weights[i] / total)); a.allocationBase = s; running += s }
                a.dirty = true
            }
        }

        var toRecompute = Set(mine.map { $0.projectId })
        if let pid = payment.projectId { toRecompute.insert(pid) }
        for pid in toRecompute { recomputeProjectStatus(pid) }
        try context.save()
    }

    // MARK: deletePayment (actions.ts:1230)

    func deletePayment(_ id: UUID) throws {
        guard let payment = payment(id) else { return }
        let allocs = allocations(paymentId: id)
        let touched = Set([payment.projectId].compactMap { $0 } + allocs.map { $0.projectId })

        // Reversible: tombstone the payment and archive its ledger together; KEEP its steps and
        // allocations so it can be restored intact. Recompute now drops this payment's allocations
        // (allocations(projectId:) filters out trashed parents), so projects re-open correctly.
        SoftDelete.trash(payment, ownsLedger: true, context: context)
        for pid in touched { recomputeProjectStatus(pid) }
        try context.save()
    }

    func restorePayment(_ id: UUID) throws {
        guard let payment = allIncludingTrashed(Payment.self).first(where: { $0.id == id }) else { return }
        SoftDelete.restore(payment, ownsLedger: true, context: context)
        // Allocations are visible again now the parent is live; re-open/re-pay touched projects.
        let allocs = allocations(paymentId: id)
        let touched = Set([payment.projectId].compactMap { $0 } + allocs.map { $0.projectId })
        for pid in touched { recomputeProjectStatus(pid) }
        try context.save()
    }

    // MARK: createWithdrawal (actions.ts:1806)

    /// Move money out of `fromMethodId`. If `toMethodId` is set it's a TRANSFER —
    /// the destination wallet is credited with the net that landed (fee = gross − net).
    /// If `toMethodId` is nil it's a plain cash-out.
    @discardableResult
    func createWithdrawal(fromMethodId: UUID?, toMethodId: UUID?, withdrawnAt: Date,
                          grossBase: Double, netBase: Double, notes: String?) throws -> UUID {
        guard grossBase > 0 else { throw EngineError.invalid("Amount must be > 0.") }
        // Round gross and net to 2dp FIRST, then derive fee — so fee = gross − net holds exactly in
        // stored figures AND matches the ledger (source debited gross, dest credited net).
        let g = round2(grossBase)
        let net = round2(min(max(0, netBase), grossBase))   // net can't exceed what left the source
        let fee = max(0, g - net)
        let isTransfer = toMethodId != nil
        let w = Withdrawal(fromMethodId: fromMethodId, toMethodId: toMethodId, withdrawnAt: withdrawnAt,
                           grossBase: g, netBase: net, feeBase: fee)
        w.notes = notes
        w.dirty = true
        context.insert(w)

        if let from = fromMethodId {
            insertLedger(kind: isTransfer ? .transfer : .outflow, amountBase: -g, walletId: from,
                         relatedKind: .withdrawal, relatedId: w.id,
                         eventAt: withdrawnAt, note: "createWithdrawal")
        }
        if let to = toMethodId, net > 0 {                  // credit the destination wallet
            insertLedger(kind: .transfer, amountBase: net, walletId: to,
                         relatedKind: .withdrawal, relatedId: w.id,
                         eventAt: withdrawnAt, note: "createWithdrawal.in")
        }
        try context.save()
        return w.id
    }

    /// Edit an existing transfer/withdrawal in place: archive its old ledger rows and
    /// re-mirror from the new values, so both wallet balances stay correct (was: the
    /// only fix for a wrong transfer was delete-and-redo).
    func updateWithdrawal(_ id: UUID, fromMethodId: UUID?, toMethodId: UUID?, withdrawnAt: Date,
                          grossBase: Double, netBase: Double, notes: String?) throws {
        guard let w = (try? context.fetch(FetchDescriptor<Withdrawal>()))?.first(where: { $0.id == id }) else { return }
        guard grossBase > 0 else { throw EngineError.invalid("Amount must be > 0.") }
        // Invariant (same as createWithdrawal): round gross and net FIRST, then derive fee —
        // so feeBase = grossBase − netBase holds exactly and matches the two ledger legs.
        let g = round2(grossBase)
        let net = round2(min(max(0, netBase), grossBase))
        let fee = max(0, g - net)
        let isTransfer = toMethodId != nil

        archiveLedger(relatedKind: .withdrawal, relatedId: id)
        w.fromMethodId = fromMethodId; w.toMethodId = toMethodId; w.withdrawnAt = withdrawnAt
        w.grossBase = g; w.netBase = net; w.feeBase = fee
        w.notes = notes; w.dirty = true

        if let from = fromMethodId {
            insertLedger(kind: isTransfer ? .transfer : .outflow, amountBase: -g, walletId: from,
                         relatedKind: .withdrawal, relatedId: id, eventAt: withdrawnAt, note: "updateWithdrawal")
        }
        if let to = toMethodId, net > 0 {
            insertLedger(kind: .transfer, amountBase: net, walletId: to,
                         relatedKind: .withdrawal, relatedId: id, eventAt: withdrawnAt, note: "updateWithdrawal.in")
        }
        try context.save()
    }

    func deleteWithdrawal(_ id: UUID) throws {
        guard let w = (try? context.fetch(FetchDescriptor<Withdrawal>()))?.first(where: { $0.id == id }) else { return }
        // Reversible: tombstone + archive its ledger (both wallet legs) together.
        SoftDelete.trash(w, ownsLedger: true, context: context)
        try context.save()
    }

    func restoreWithdrawal(_ id: UUID) throws {
        guard let w = allIncludingTrashed(Withdrawal.self).first(where: { $0.id == id }) else { return }
        SoftDelete.restore(w, ownsLedger: true, context: context)
        try context.save()
    }

    // MARK: recomputeProjectStatus (actions.ts:638)

    func recomputeProjectStatus(_ projectId: UUID) {
        guard let project = project(projectId), project.status != .archived else { return }
        let allocs = allocations(projectId: projectId)

        // Measure "paid" in a SINGLE currency space (project's, via base) for every
        // allocation, same- or mixed-currency. `allocationAmount` is the GROSS the
        // client paid in the allocation's currency, so comparing gross-vs-gross means
        // a fully-paid project reaches ratio 1 whether or not a fee was taken and
        // whether or not the payment currency matched the quote. (Was: same-currency
        // compared gross, mixed compared net-of-fees — so foreign-currency projects
        // could never reach "paid".)
        let projectBase = rates.toBase(project.amount, project.currency)
        let paidGrossBase = allocs.reduce(0) { $0 + rates.toBase($1.allocationAmount, $1.allocationCurrency) }
        let paidRatio = projectBase > 0 ? paidGrossBase / projectBase : 0

        // Invariant: full payment reaches "paid" despite float error — Σ(aᵢ·rate) vs (Σaᵢ)·rate
        // can differ by a few ulps, so compare with a tolerance far below any real cent.
        let next: ProjectStatus = paidRatio >= 1 - 1e-9 ? .paid : (paidRatio > 0 ? .partiallyPaid : .unpaid)
        if project.status != next {
            project.status = next
            project.completedAt = (next == .paid) ? .now : nil
            project.updatedAt = .now
            project.dirty = true
            // A deal just fully closed → offer ONE journal question about it (deduped by text).
            if next == .paid {
                let clientName = project.clientId.flatMap { cid in
                    ((try? context.fetch(FetchDescriptor<Client>())) ?? []).first { $0.id == cid }?.name
                }
                Brain.enqueueProjectPostMortem(context, projectTitle: project.title, clientName: clientName, outcome: "paid")
            }
        }
    }
}

import Foundation
import SwiftData

/// The compact "money + life right now" digest fed to the assistant so every
/// answer is grounded in real local data — the native equivalent of the web
/// app's `freelane-state-snapshot.ts`. Built on demand from SwiftData; cheap.
@MainActor
enum StateSnapshot {

    /// A short fingerprint of the financial state, used to decide whether a
    /// cached AI payload is still valid (wallet total + landed MTD + spend-today
    /// + counts, all rounded so trivial drift doesn't bust the cache).
    static func fingerprint(_ context: ModelContext) -> String {
        let d = load(context)
        let safe = SafeToSpend.compute(payments: d.payments, spends: d.spends,
                                       wallets: d.wallets, ledger: d.ledger, recurrings: d.recurrings, plans: d.plans)
        let walletTotal = Int(safe.walletTotal.rounded())
        let landed = Int(d.metrics.landedMTD.rounded())
        let spent = Int(safe.spentToday.rounded())
        return "\(walletTotal)|\(landed)|\(spent)|\(d.payments.count)|\(d.spends.count)|\(d.facts.count)"
    }

    /// The full grounding text block. Stable section order so the model reads it
    /// the same way every turn.
    static func text(_ context: ModelContext) -> String {
        let d = load(context)
        let base = d.baseCurrency
        func money(_ v: Double) -> String { CurrencyFormat.string(v, base, compact: true) }

        let safe = SafeToSpend.compute(payments: d.payments, spends: d.spends,
                                       wallets: d.wallets, ledger: d.ledger, recurrings: d.recurrings, plans: d.plans)

        var lines: [String] = []
        lines.append("FREELANE STATE — base currency \(base). All amounts in \(base) unless noted.")
        lines.append("Today (PHT): \(Brain.phtDay()).")

        // Safe to spend
        lines.append("")
        lines.append("SAFE TO SPEND")
        lines.append("- Live remaining today: \(money(safe.liveRemaining)) (started today at \(money(safe.initialForToday))).")
        lines.append("- Spent today: \(money(safe.spentToday)). Confidence: \(safe.confidence)\(safe.isLearning ? " (still learning)" : "").")

        // Wallets
        lines.append("")
        lines.append("WALLETS (\(d.wallets.filter { $0.isHolding && !$0.archived && !$0.excludedFromTotals }.count) holding, total \(money(safe.walletTotal)))")
        for w in d.wallets.filter({ $0.isHolding && !$0.archived && !$0.excludedFromTotals }).sorted(by: { WalletMath.balance(of: $0, ledger: d.ledger) > WalletMath.balance(of: $1, ledger: d.ledger) }).prefix(12) {
            let bal = WalletMath.balance(of: w, ledger: d.ledger)
            let flag = bal < -w.overdraftToleranceBase ? " [over overdraft]" : (bal < 0 ? " [within tolerance]" : "")
            lines.append("- \(w.name) (\(w.kind.label)): \(money(bal))\(flag)")
        }

        // Money this month
        lines.append("")
        lines.append("MONEY")
        lines.append("- Landed this month: \(money(d.metrics.landedMTD)) · this year: \(money(d.metrics.landedYTD)) · lifetime: \(money(d.metrics.landedLifetime)).")
        lines.append("- Fees this month: \(money(d.metrics.feesMTD)). Outstanding (owed to me): \(money(d.metrics.outstandingBase)) across \(d.metrics.activeProjects) open project(s).")

        // Top vendors (last 90 days) — a small sample of where the money actually goes, instead
        // of dumping the full ledger. Keeps the prompt slim, cheap, and private.
        let since = PHT.daysAgo(90)
        let vendorTotals = Dictionary(grouping: d.spends.filter { $0.spentAt >= since && ($0.vendorName?.isEmpty == false) },
                                      by: { $0.vendorName! }).mapValues { $0.reduce(0.0) { $0 + $1.amountBase } }
        let topVendors = vendorTotals.sorted { $0.value > $1.value }.prefix(5)
        if !topVendors.isEmpty {
            lines.append("")
            lines.append("TOP VENDORS (90d)")
            for (name, total) in topVendors { lines.append("- \(name): \(money(total))") }
        }

        // Outstanding projects (who owes)
        let open = d.projects.filter { $0.status == .unpaid || $0.status == .partiallyPaid }
        if !open.isEmpty {
            lines.append("")
            lines.append("OPEN PROJECTS")
            for p in open.sorted(by: { $0.agingAnchor < $1.agingAnchor }).prefix(10) {
                let out = ProjectMath.outstandingNative(project: p, allocations: d.allocations, rates: d.rates)
                let client = d.clients.first { $0.id == p.clientId }?.name ?? "—"
                let age = PHT.calendar.dateComponents([.day], from: p.agingAnchor, to: .now).day ?? 0
                let note = (p.notes?.isEmpty == false) ? " — note: \(p.notes!)" : ""
                lines.append("- \(p.title) for \(client): \(CurrencyFormat.string(out, p.currency, compact: true)) outstanding, open \(age)d.\(note)")
            }
        }

        // Recent spends — INCLUDING your own words (description + note), so the AI reads
        // what you actually wrote, not just vendor + category.
        let recent = d.spends.sorted { $0.spentAt > $1.spentAt }.prefix(14)
        if !recent.isEmpty {
            lines.append("")
            lines.append("RECENT SPENDS (in your words)")
            for s in recent {
                let at = s.vendorName.map { " at \($0)" } ?? ""
                let what = s.spendDescription ?? "spend"
                let cat = s.category.map { " [\($0)]" } ?? ""
                let kind = s.isSadaka ? " ·sadaka" : (s.isBusiness ? " ·business" : (s.isHouse ? " ·home" : ""))
                let note = (s.notes?.isEmpty == false) ? " (note: \(s.notes!))" : ""
                lines.append("- \(money(s.amountBase))\(at): \(what)\(cat)\(kind)\(note)")
            }
        }


        // Loans
        let loans = d.loans.filter { $0.statusRaw == "open" || $0.statusRaw == "partially_returned" }
        if !loans.isEmpty {
            lines.append("")
            lines.append("LOANS")
            for l in loans.prefix(6) {
                let dir = l.directionRaw == "given" ? "they owe me" : "I owe them"
                lines.append("- \(l.counterparty): \(money(l.outstandingBase)) outstanding (\(dir)).")
            }
        }

        // People / pets / places / things
        let entities = d.entities.filter { !$0.archived }
        if !entities.isEmpty {
            lines.append("")
            lines.append("PEOPLE & THINGS I TRACK")
            for e in entities.prefix(20) {
                let rel = e.relationship.map { " — \($0)" } ?? ""
                let efacts = d.facts.filter { $0.archivedAt == nil && $0.subjectKind == "entity" && $0.subjectId == e.id.uuidString }
                let detail = efacts.prefix(3).map { "\($0.prettyKey): \($0.value)" }.joined(separator: ", ")
                lines.append("- \(e.name) (\(e.kind.label))\(rel)\(detail.isEmpty ? "" : " · \(detail)")")
            }
        }

        // Body / wellbeing — so the assistant actually sees how I've been feeling.
        let recentBody = d.bodyLogs.filter { $0.day >= PHT.daysAgo(14) }.sorted { $0.day > $1.day }
        if !recentBody.isEmpty {
            func avg(_ vals: [Double]) -> Double? { vals.isEmpty ? nil : vals.reduce(0, +) / Double(vals.count) }
            let e = avg(recentBody.compactMap { $0.energy.map(Double.init) })
            let m = avg(recentBody.compactMap { $0.mood.map(Double.init) })
            let s = avg(recentBody.compactMap { $0.sleepHours })
            var parts: [String] = []
            if let e { parts.append("energy \(String(format: "%.1f", e))/5") }
            if let m { parts.append("mood \(String(format: "%.1f", m))/5") }
            if let s { parts.append("sleep \(String(format: "%.1f", s))h") }
            if !parts.isEmpty {
                lines.append("")
                lines.append("BODY (14-day avg): " + parts.joined(separator: ", "))
                if let latest = recentBody.first, let n = latest.notes, !n.isEmpty {
                    lines.append("- latest note: \(n)")
                }
            }
        }

        // Learned facts
        let facts = d.facts.filter { $0.archivedAt == nil && $0.subjectKind == "user" }
        if !facts.isEmpty {
            lines.append("")
            lines.append("WHAT I'VE LEARNED ABOUT YOU")
            for f in facts.sorted(by: { $0.confidence > $1.confidence }).prefix(20) {
                lines.append("- \(f.prettyKey): \(f.value)")
            }
        }

        return lines.joined(separator: "\n")
    }

    // MARK: - Loading

    struct Bundle {
        var baseCurrency: String
        var wallets: [Wallet]
        var payments: [Payment]
        var spends: [Spend]
        var projects: [Project]
        var clients: [Client]
        var ledger: [LedgerEntry]
        var allocations: [PaymentAllocation]
        var withdrawals: [Withdrawal]
        var loans: [Loan]
        var facts: [AIFact]
        var entities: [Entity]
        var recurrings: [Recurring]
        var plans: [Plan]
        var bodyLogs: [BodyLog]
        var rates: Rates
        var metrics: DashboardMetrics
    }

    static func load(_ context: ModelContext) -> Bundle {
        func all<T: PersistentModel>(_ type: T.Type) -> [T] {
            let rows = (try? context.fetch(FetchDescriptor<T>())) ?? []
            // Trashed (soft-deleted) entities are invisible to every consumer of the snapshot
            // (math, AI, signals, dashboards) — one chokepoint instead of 146 query sites.
            if T.self is any SoftDeletable.Type { return rows.filter { ($0 as? any SoftDeletable)?.deletedAt == nil } }
            return rows
        }
        let settings = all(AppSettings.self).first
        let base = settings?.baseCurrency ?? "PHP"
        let rateRows = all(ExchangeRate.self)
        let rates = Rates(base: base, rates: rateRows)
        let payments = all(Payment.self)
        let withdrawals = all(Withdrawal.self)
        let projects = all(Project.self)
        let wallets = all(Wallet.self)
        let ledger = all(LedgerEntry.self)
        // Drop allocations belonging to a trashed payment (their parent is gone from `payments`).
        let livePaymentIds = Set(payments.map { $0.id })
        let allocations = (try? context.fetch(FetchDescriptor<PaymentAllocation>()))?.filter { livePaymentIds.contains($0.paymentId) } ?? []
        let metrics = MetricsCompute.dashboard(payments: payments, withdrawals: withdrawals,
                                               projects: projects, wallets: wallets, ledger: ledger,
                                               allocations: allocations, rates: rates)
        return Bundle(baseCurrency: base, wallets: wallets, payments: payments,
                      spends: all(Spend.self), projects: projects, clients: all(Client.self),
                      ledger: ledger, allocations: allocations, withdrawals: withdrawals,
                      loans: all(Loan.self), facts: all(AIFact.self),
                      entities: all(Entity.self), recurrings: all(Recurring.self),
                      plans: all(Plan.self), bodyLogs: all(BodyLog.self), rates: rates, metrics: metrics)
    }
}

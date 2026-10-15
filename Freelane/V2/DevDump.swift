import Foundation
import SwiftData

/// Test builds only: write every row exactly as sync sends it (`rows.json`) and the figures each page
/// shows (`pictures.json`) into the test data folder. The phone's ports are checked against these, and
/// its previews render from the same rows, so the two apps can be compared number for number.
enum DevDump {
    @MainActor static func run(_ context: ModelContext) {
        guard DevMode.isSandboxed else { return }
        func all<T: PersistentModel>(_ t: T.Type) -> [T] { (try? context.fetch(FetchDescriptor<T>())) ?? [] }
        let uid = "00000000-0000-4000-8000-000000000000"

        let wallets = all(Wallet.self), ledger = all(LedgerEntry.self), recurring = all(Recurring.self)
        let spends = all(Spend.self).sorted { $0.spentAt > $1.spentAt }
        let payments = all(Payment.self), withdrawals = all(Withdrawal.self), projects = all(Project.self)
        let clients = all(Client.self), steps = all(PaymentStep.self), rates = all(ExchangeRate.self)
        let loans = all(Loan.self)
        let allocations = all(PaymentAllocation.self)

        let rows: [String: Any] = [
            "wallets": wallets.map { CloudRows.wallet($0, uid) },
            "clients": clients.map { CloudRows.client($0, uid) },
            "projects": projects.map { CloudRows.project($0, uid) },
            "payments": payments.map { CloudRows.payment($0, uid) },
            "payment_steps": steps.map { CloudRows.paymentStep($0, uid) },
            "withdrawals": withdrawals.map { CloudRows.withdrawal($0, uid) },
            "recurring": recurring.map { CloudRows.recurring($0, uid) },
            "loans": loans.map { CloudRows.loan($0, uid) },
            "spends": spends.map { CloudRows.spend($0, uid) },
            "ledger_entries": ledger.map { CloudRows.ledger($0, uid) },
            "exchange_rates": rates.map { CloudRows.rate($0, uid) },
        ]

        let base = all(AppSettings.self).first?.baseCurrency ?? "PHP"
        let r = Rates(base: base, rates: rates)
        let m = MoneyState.build(wallets: wallets, ledger: ledger, recurring: recurring, spends: spends, payments: payments,
                                 withdrawals: withdrawals, projects: projects, clients: clients, rates: r)
        let bills = BillsPicture.build(state: m, recurring: recurring, spends: spends, wallets: wallets)
        let incomes = ledger.filter { $0.kindRaw == "income" && $0.archivedAt == nil }
        let work = WorkPicture.build(payments: payments, projects: projects, clients: clients, withdrawals: withdrawals,
                                     allocations: allocations, incomes: incomes, wallets: wallets, rates: r)
        let insights = InsightsMath.build(period: .all, wallets: wallets, ledger: ledger, spends: spends, payments: payments,
                                          withdrawals: withdrawals, recurring: recurring)
        let giving = GivingMath.build(spends: spends.filter(\.isSadaka), wallets: wallets)

        func id(_ u: UUID) -> String { u.uuidString.lowercased() }
        let pictures: [String: Any] = [
            "now": iso(.now),
            "setAsideDays": SetAside.days,
            "money": [
                "total": m.total, "setAside": m.setAside, "free": m.free, "monthBillsPaid": m.monthBillsPaid,
                "wallets": m.wallets.map { ["id": id($0.id), "name": $0.name, "balance": $0.balance,
                                            "lastCounted": iso($0.lastCounted), "inTotals": $0.inTotals] },
                "bills": m.bills.map { b in
                    ["id": id(b.id), "label": b.label, "nextDue": iso(b.nextDue), "amount": b.amount, "estimate": b.estimate,
                     "setAsideFrom": iso(b.setAsideFrom), "isSetAside": b.isSetAside, "coveredUntil": iso(b.coveredUntil),
                     "lastPaid": b.lastPaid.map { ["date": iso($0.date), "amount": $0.amount] } as Any? ?? NSNull()] as [String: Any]
                },
                "needs": m.needs.map(\.id),
                "month": ["cameIn": m.month.cameIn, "wentOut": m.month.wentOut, "fees": m.month.fees, "countsFound": m.month.countsFound],
                "feed": m.feed.prefix(80).map { f in
                    ["id": f.id, "date": iso(f.date), "kind": "\(f.kind)", "title": f.title, "subtitle": f.subtitle,
                     "amount": f.amount, "inTotals": f.inTotals, "walletIds": f.walletIds.map(id)] as [String: Any]
                },
                "feedCount": m.feed.count,
            ] as [String: Any],
            "bills": [
                "dueNext": ["total": bills.dueNext.total, "estimate": bills.dueNext.estimate,
                            "month": iso(bills.dueNext.month), "sentence": bills.dueNext.sentence],
                "cards": bills.cards.map { ["id": id($0.line.id), "label": $0.line.label, "status": $0.status, "footer": $0.footer] },
                "year": bills.year.map { ["month": iso($0.month), "total": $0.total] },
                "yearTotal": bills.yearTotal,
            ] as [String: Any],
            "work": [
                "earned": work.earned, "since": iso(work.since), "count": work.count, "sentence": work.sentence,
                "months": work.months.map { ["month": iso($0.month), "total": $0.total] },
                "owed": work.owed.map { ["project": id($0.project.id), "client": $0.client, "base": $0.base, "detail": $0.detail] },
                "clients": work.clients.map { ["id": id($0.id), "title": $0.title, "subtitle": $0.subtitle, "total": $0.total] },
                "feesAtPayment": work.feesAtPayment, "feesMoving": work.feesMoving,
            ] as [String: Any],
            "insights": [
                "start": iso(insights.start), "cameIn": insights.cameIn, "logged": insights.logged, "found": insights.found,
                "fees": insights.fees,
                "months": insights.months.map { ["start": iso($0.start), "cameIn": $0.cameIn, "logged": $0.logged, "found": $0.found] },
                "categories": insights.categories.map { ["name": $0.name, "amount": $0.amount, "count": $0.count] },
                "findings": insights.findings.map(\.id),
            ] as [String: Any],
            "giving": [
                "total": giving.total, "count": giving.inPeriod.count, "start": iso(giving.start),
                "recipients": giving.recipients.map { ["name": $0.name, "total": $0.total, "count": $0.count] },
                "usualWallet": giving.usualWallet.map { ["name": $0.name, "count": $0.count] } as Any? ?? NSNull(),
            ] as [String: Any],
        ]

        let dir = URL(fileURLWithPath: DevMode.dataDir!).appendingPathComponent("dump", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        for (name, value) in [("rows.json", rows as Any), ("pictures.json", pictures as Any)] {
            if let data = try? JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys]) {
                try? data.write(to: dir.appendingPathComponent(name))
            }
        }
    }
}

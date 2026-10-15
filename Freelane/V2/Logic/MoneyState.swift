import Foundation
import SwiftData

// One snapshot of where the money stands, computed from the store. Pages read this instead of each
// re-deriving balances and bills their own way, so every screen shows the same numbers.

/// How many days before its due date a bill's money stops counting as free. His rule: a week.
enum SetAside {
    static var days: Int {
        let v = UserDefaults.standard.integer(forKey: "bills.setAsideDays")
        return v > 0 ? v : 7
    }
}

struct WalletLine: Identifiable {
    let wallet: Wallet
    let key: IdentityKey?
    let balance: Double
    let lastCounted: Date?
    var id: UUID { wallet.id }
    var name: String { wallet.name }
    var inTotals: Bool { !wallet.excludedFromTotals }
}

struct BillLine: Identifiable {
    let bill: Recurring
    let key: IdentityKey?
    let nextDue: Date?
    let amount: Double
    let estimate: Bool
    /// The day its money starts being set aside.
    let setAsideFrom: Date?
    let isSetAside: Bool
    /// Paid more than a cycle ahead (wifi paid for a year): shown as covered, never reserved.
    let coveredUntil: Date?
    let lastPaid: (date: Date, amount: Double, walletId: UUID?)?
    var id: UUID { bill.id }
    var label: String { bill.label }
}

enum NeedKind { case count(WalletLine), owed(Project, clientName: String, native: Double, currency: String, base: Double), estimate(BillLine, suggested: Double) }

struct NeedItem: Identifiable {
    let id: String
    let kind: NeedKind
}

enum FeedKind { case spend, payment, move, count, fee, gift }

struct FeedItem: Identifiable {
    let id: String
    let date: Date
    let kind: FeedKind
    let title: String
    let subtitle: String
    let amount: Double          // signed, base currency
    let badge: BadgeSubject
    var badgeGlyph: String? = nil
    var native: (amount: Double, currency: String)? = nil
    var related: UUID? = nil
    var inTotals = true
    /// Wallets this item touched (for "last activity" on a wallet).
    var walletIds: [UUID] = []
}

struct MonthFigures { var cameIn = 0.0, wentOut = 0.0, fees = 0.0, countsFound = 0.0 }

struct MoneyState {
    var wallets: [WalletLine] = []
    var total = 0.0
    var bills: [BillLine] = []
    var setAside = 0.0
    var free: Double { total - setAside }
    var needs: [NeedItem] = []
    var feed: [FeedItem] = []
    var month = MonthFigures()
    /// Every bill whose due date falls in this calendar month has been paid.
    var monthBillsPaid = false
    var nextBill: BillLine? { bills.filter { $0.coveredUntil == nil && $0.nextDue != nil }.min { $0.nextDue! < $1.nextDue! } }

    static func build(wallets: [Wallet], ledger: [LedgerEntry], recurring: [Recurring], spends: [Spend], payments: [Payment],
                      withdrawals: [Withdrawal], projects: [Project], clients: [Client], rates: Rates, now: Date = .now) -> MoneyState {
        var s = MoneyState()
        let cal = PHT.calendar
        let today = cal.startOfDay(for: now)
        let live = ledger.filter { $0.archivedAt == nil }

        // Wallets
        var lastCount: [UUID: Date] = [:]
        for e in live where e.kind == .adjustment && e.relatedKindRaw == nil {
            if let w = e.walletId { lastCount[w] = max(lastCount[w] ?? .distantPast, e.eventAt) }
        }
        let holding = wallets.filter { $0.isHolding && !$0.archived && $0.deletedAt == nil }
        s.wallets = holding.map { w in
            let counted = [lastCount[w.id], w.openingBalanceSetAt].compactMap { $0 }.max()
            return WalletLine(wallet: w, key: IdentityKey.wallet(w), balance: WalletMath.balance(of: w, ledger: live), lastCounted: counted)
        }
        .sorted { $0.balance > $1.balance }
        s.total = s.wallets.filter(\.inTotals).reduce(0) { $0 + $1.balance }

        // Bills
        let liveSpends = spends.filter { $0.deletedAt == nil }
        let bills = recurring.filter { $0.active && $0.deletedAt == nil && $0.kind == .expense }
        s.bills = bills.map { r in
            let next = RecurringMath.nextDue(r, now: now)
            let paidFor = liveSpends.filter { $0.recurringId == r.id }.max { $0.spentAt < $1.spentAt }
            var covered: Date? = nil
            if let pt = r.paidThroughDate, let n = next, n > (cal.date(byAdding: .month, value: 2, to: today) ?? today) { covered = pt }
            let from = next.flatMap { cal.date(byAdding: .day, value: -SetAside.days, to: $0) }
            let aside = covered == nil && (from.map { today >= cal.startOfDay(for: $0) } ?? false)
            return BillLine(bill: r, key: IdentityKey.bill(r.label), nextDue: next, amount: r.amountBase, estimate: r.isVariableAmount,
                            setAsideFrom: from, isSetAside: aside, coveredUntil: covered,
                            lastPaid: paidFor.map { ($0.spentAt, $0.amountBase, $0.walletId) })
        }
        .sorted { ($0.nextDue ?? .distantFuture) < ($1.nextDue ?? .distantFuture) }
        s.setAside = s.bills.filter(\.isSetAside).reduce(0) { $0 + $1.amount }
        s.monthBillsPaid = !bills.isEmpty && bills.allSatisfy { r in
            let occ = RecurringMath.anchored(r, in: today)
            guard cal.isDate(occ, equalTo: today, toGranularity: .month) else { return true }
            return (r.paidThroughDate.map { cal.startOfDay(for: $0) >= cal.startOfDay(for: occ) }) ?? false
        }

        // Needs you
        var needs: [NeedItem] = []
        if let w = s.wallets.filter({ $0.inTotals && $0.balance > 1 }).first(where: { line in
            guard let d = line.lastCounted else { return true }
            return (cal.dateComponents([.day], from: d, to: now).day ?? 0) >= 21
        }) { needs.append(NeedItem(id: "count-\(w.id)", kind: .count(w))) }
        let clientName = Dictionary(clients.map { ($0.id, $0.company?.isEmpty == false ? $0.company! : $0.name) }, uniquingKeysWith: { a, _ in a })
        for p in projects where p.deletedAt == nil && (p.status == .unpaid || p.status == .partiallyPaid) {
            guard let done = p.workCompletedAt, (cal.dateComponents([.day], from: done, to: now).day ?? 0) >= 14 else { continue }
            let name = p.clientId.flatMap { clientName[$0] } ?? "A client"
            needs.append(NeedItem(id: "owed-\(p.id)", kind: .owed(p, clientName: name, native: p.amount, currency: p.currency, base: rates.toBase(p.amount, p.currency))))
        }
        for b in s.bills where b.coveredUntil == nil {
            guard let last = b.lastPaid, b.amount > 0, abs(last.amount - b.amount) / b.amount > 0.03 else { continue }
            let suggested = (last.amount / 10).rounded(.up) * 10
            needs.append(NeedItem(id: "estimate-\(b.id)", kind: .estimate(b, suggested: suggested)))
        }
        s.needs = needs

        // This month
        let monthStart = PHT.startOfMonth(now)
        let excluded = Set(wallets.filter(\.excludedFromTotals).map(\.id))
        s.month.cameIn = payments.filter { $0.deletedAt == nil && $0.paidAt >= monthStart }.reduce(0) { $0 + ($1.netAmountBase ?? 0) }
        s.month.wentOut = liveSpends.filter { $0.spentAt >= monthStart && !($0.walletId.map(excluded.contains) ?? false) }.reduce(0) { $0 + $1.amountBase }
        s.month.fees = withdrawals.filter { $0.deletedAt == nil && $0.withdrawnAt >= monthStart }.reduce(0) { $0 + $1.feeBase }
            + payments.filter { $0.deletedAt == nil && $0.paidAt >= monthStart }.reduce(0) { $0 + ($1.impliedFeeBase ?? 0) }
        s.month.countsFound = live.filter { $0.kind == .adjustment && $0.relatedKindRaw == nil && $0.eventAt >= monthStart && !($0.walletId.map(excluded.contains) ?? false) }
            .reduce(0) { $0 + $1.amountBase }

        s.feed = Feed.build(wallets: wallets, ledger: live, spends: liveSpends, payments: payments, withdrawals: withdrawals,
                            projects: projects, clientName: clientName, recurring: recurring)
        return s
    }
}

/// The unified activity feed behind Latest and the Ledger.
enum Feed {
    static func build(wallets: [Wallet], ledger: [LedgerEntry], spends: [Spend], payments: [Payment], withdrawals: [Withdrawal],
                      projects: [Project], clientName: [UUID: String], recurring: [Recurring]) -> [FeedItem] {
        let wallet = Dictionary(wallets.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        let bill = Dictionary(recurring.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        let project = Dictionary(projects.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        let excluded = Set(wallets.filter(\.excludedFromTotals).map(\.id))
        var out: [FeedItem] = []

        for s in spends {
            let w = s.walletId.flatMap { wallet[$0] }
            let from = w.map { "from \($0.name)" } ?? "no wallet"
            if let rid = s.recurringId, let r = bill[rid] {
                out.append(FeedItem(id: "s-\(s.id)", date: s.spentAt, kind: .spend, title: r.label, subtitle: from, amount: -s.amountBase,
                                    badge: .bill(r.label), related: s.id, inTotals: !(s.walletId.map(excluded.contains) ?? false), walletIds: s.walletId.map { [$0] } ?? []))
            } else {
                let title = (s.spendDescription?.isEmpty == false ? s.spendDescription! : (s.vendorName ?? s.category ?? "Spending"))
                let sub = [s.category, from].compactMap { $0 }.joined(separator: " · ")
                out.append(FeedItem(id: "s-\(s.id)", date: s.spentAt, kind: s.isSadaka ? .gift : .spend, title: title, subtitle: sub, amount: -s.amountBase,
                                    badge: s.isSadaka ? .neutral(Sym.volunteerActivism) : .neutral(Sym.shoppingBag), related: s.id,
                                    inTotals: !(s.walletId.map(excluded.contains) ?? false), walletIds: s.walletId.map { [$0] } ?? []))
            }
        }
        for p in payments where p.deletedAt == nil {
            let proj = p.projectId.flatMap { project[$0] }
            let client = proj?.clientId.flatMap { clientName[$0] } ?? "Payment"
            let landedId = ledger.first { $0.relatedId == p.id && $0.kind == .income }?.walletId
            let landed = landedId.flatMap { wallet[$0]?.name }
            let native = "\(CurrencyFormat.symbol(p.currency))\(MoneyFormat.parts(p.amount).whole)" + (p.amount.truncatingRemainder(dividingBy: 1) == 0 ? "" : ".\(MoneyFormat.parts(p.amount).cents)")
            let sub = [proj?.title, native + (landed.map { " into \($0)" } ?? "")].compactMap { $0 }.joined(separator: " · ")
            out.append(FeedItem(id: "p-\(p.id)", date: p.paidAt, kind: .payment, title: client, subtitle: sub, amount: p.netAmountBase ?? 0,
                                badge: .person(client), native: (p.amount, p.currency), related: p.id, walletIds: landedId.map { [$0] } ?? []))
        }
        for w in withdrawals where w.deletedAt == nil {
            let from = w.fromMethodId.flatMap { wallet[$0] }, to = w.toMethodId.flatMap { wallet[$0] }
            let title = "\(from?.name ?? "?") to \(to?.name ?? "?")"
            let sub = w.feeBase > 0.004 ? "moved · \(MoneyFormat.string(w.feeBase)) in fees" : "moved"
            let badge: BadgeSubject = to.map { .wallet($0) } ?? .neutral(Sym.swapHoriz)
            out.append(FeedItem(id: "w-\(w.id)", date: w.withdrawnAt, kind: .move, title: title, subtitle: sub, amount: w.netBase,
                                badge: badge, badgeGlyph: Sym.swapHoriz, related: w.id, walletIds: [w.fromMethodId, w.toMethodId].compactMap { $0 }))
        }
        // Counts: one line per day, sub-peso rounding left out.
        let counts = ledger.filter { $0.kind == .adjustment && $0.relatedKindRaw == nil && abs($0.amountBase) >= 1 && $0.walletId.flatMap { wallet[$0] } != nil }
        let byDay = Dictionary(grouping: counts) { PHT.calendar.startOfDay(for: $0.eventAt) }
        for (day, entries) in byDay {
            let perWallet = Dictionary(grouping: entries) { $0.walletId! }.map { (w: wallet[$0.key]!, amount: $0.value.reduce(0) { $0 + $1.amountBase }) }
                .filter { abs($0.amount) >= 1 }.sorted { abs($0.amount) > abs($1.amount) }
            guard let first = perWallet.first else { continue }
            let total = perWallet.reduce(0) { $0 + $1.amount }
            let names = perWallet.map(\.w.name)
            let title = "Counted " + (names.count == 1 ? names[0] : names.dropLast().joined(separator: ", ") + " and " + names.last!)
            let sub: String
            if perWallet.count == 1 {
                sub = "\(MoneyFormat.string(abs(total))) \(total >= 0 ? "more" : "less") than Freelane had"
            } else {
                sub = perWallet.map { "\($0.w.name) \($0.amount >= 0 ? "+" : "−")\(MoneyFormat.string(abs($0.amount)))" }.joined(separator: ", ")
            }
            let latest = entries.map(\.eventAt).max() ?? day
            out.append(FeedItem(id: "c-\(Int(day.timeIntervalSince1970))", date: latest, kind: .count, title: title, subtitle: sub, amount: total,
                                badge: .wallet(first.w), badgeGlyph: Sym.factCheck, inTotals: !first.w.excludedFromTotals, walletIds: perWallet.map(\.w.id)))
        }
        for e in ledger where e.kind == .outflow && e.relatedKindRaw == nil {
            let w = e.walletId.flatMap { wallet[$0] }
            let notIn = w?.excludedFromTotals ?? false
            out.append(FeedItem(id: "f-\(e.id)", date: e.eventAt, kind: .fee, title: (w.map { "\($0.name) fee" } ?? "Fee"),
                                subtitle: notIn ? "monthly · not in your totals" : "monthly", amount: e.amountBase,
                                badge: .neutral(Sym.accountBalance), related: e.id, inTotals: !notIn, walletIds: e.walletId.map { [$0] } ?? []))
        }
        return out.sorted { $0.date > $1.date }
    }
}

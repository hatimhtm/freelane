import Foundation

// The Insights picture: money in and out per month, including what counting found, computed straight
// from the store. Nothing is estimated, and every figure on the page uses the same period.
//
// The rules, so every screen agrees:
//  · Came in    = live payments' net, by the day they were paid (the same figure as Now's "Came in").
//  · Logged     = live spends, gifts included, in wallets that count in totals (Now's "Went out").
//  · Found      = count corrections (ledger adjustments with no related item, in wallets that count in
//                 totals), netted per month. Only a month that nets negative adds to "found": money that
//                 turned up when counting is not spending and is never called spending.
//  · Fees       = payments' implied fees plus withdrawal fees (Now's "Fees").

/// The periods the page can show.
enum InsightsPeriod: String, CaseIterable, Identifiable {
    case all, year, last3
    var id: String { rawValue }
}

/// One month of the picture.
struct InsightsMonth: Identifiable, Equatable {
    let start: Date
    let isCurrent: Bool
    var cameIn = 0.0
    var logged = 0.0
    /// Money counting found missing that month, as a positive number (0 when the counts netted positive).
    var found = 0.0
    /// Money counting found that Freelane didn't know about (net positive counts). Kept apart: not spending.
    var appeared = 0.0
    var counts = 0
    var fees = 0.0
    var id: Date { start }
    var wentOut: Double { logged + found }
}

struct InsightsCategory: Identifiable, Equatable {
    let name: String
    let amount: Double
    let count: Int
    var id: String { name }
}

/// Bill payments whose category doesn't match the bill they're linked to (reported, never re-filed).
struct InsightsMisfiled: Identifiable, Equatable {
    let bill: String
    let category: String
    let amount: Double
    let count: Int
    var id: String { bill + "|" + category }
}

/// A run of words and amounts, so figures inside sentences still go through the money roles.
enum InsightsPiece: Equatable { case text(String), money(Double) }

struct InsightsFinding: Identifiable, Equatable {
    let id: String
    let glyph: String
    let title: [InsightsPiece]
    let detail: [InsightsPiece]
}

struct InsightsPicture {
    var period: InsightsPeriod = .all
    /// The periods worth offering: one that would show exactly the same months as "since …" is left out.
    var periods: [InsightsPeriod] = [.all]
    /// The first month of the period, and of everything the page has (the start of his records).
    var start: Date = PHT.startOfMonth()
    var recordsStart: Date = PHT.startOfMonth()
    var months: [InsightsMonth] = []
    var categories: [InsightsCategory] = []
    var misfiled: [InsightsMisfiled] = []
    var findings: [InsightsFinding] = []

    var cameIn: Double { months.reduce(0) { $0 + $1.cameIn } }
    var logged: Double { months.reduce(0) { $0 + $1.logged } }
    var found: Double { months.reduce(0) { $0 + $1.found } }
    var wentOut: Double { logged + found }
    var fees: Double { months.reduce(0) { $0 + $1.fees } }
    var counts: Int { months.reduce(0) { $0 + $1.counts } }
}

enum InsightsMath {

    /// The start of his records: the month his wallets were first set up (before that nothing could be
    /// counted, so "went out" can't be checked). Without wallet anchors, the first month with any entry.
    static func recordsStart(wallets: [Wallet], spends: [Spend], payments: [Payment], now: Date = .now) -> Date {
        let anchors = wallets.filter { $0.deletedAt == nil && $0.isHolding && !$0.excludedFromTotals }.compactMap(WalletMath.anchor)
        if let first = anchors.min() { return min(PHT.startOfMonth(first), PHT.startOfMonth(now)) }
        let firstEntry = (spends.filter { $0.deletedAt == nil }.map(\.spentAt) + payments.filter { $0.deletedAt == nil }.map(\.paidAt)).min()
        return min(PHT.startOfMonth(firstEntry ?? now), PHT.startOfMonth(now))
    }

    /// Where a period starts. Never before his records begin.
    static func start(of period: InsightsPeriod, records: Date, now: Date = .now) -> Date {
        let cal = PHT.calendar
        switch period {
        case .all: return records
        case .year: return max(PHT.startOfYear(now), records)
        case .last3: return max(cal.date(byAdding: .month, value: -2, to: PHT.startOfMonth(now)) ?? records, records)
        }
    }

    static func build(period wanted: InsightsPeriod, wallets: [Wallet], ledger: [LedgerEntry], spends: [Spend], payments: [Payment],
                      withdrawals: [Withdrawal], recurring: [Recurring], now: Date = .now) -> InsightsPicture {
        let cal = PHT.calendar
        var p = InsightsPicture()
        let liveSpends = spends.filter { $0.deletedAt == nil }
        let livePayments = payments.filter { $0.deletedAt == nil }
        let liveWithdrawals = withdrawals.filter { $0.deletedAt == nil }
        let excluded = Set(wallets.filter(\.excludedFromTotals).map(\.id))
        func inTotals(_ w: UUID?) -> Bool { !(w.map(excluded.contains) ?? false) }

        p.recordsStart = recordsStart(wallets: wallets, spends: liveSpends, payments: livePayments, now: now)
        // A period that would show exactly the same months as one before it isn't offered twice.
        var starts: [Date] = []
        p.periods = InsightsPeriod.allCases.filter { period in
            let s = start(of: period, records: p.recordsStart, now: now)
            guard !starts.contains(s) else { return false }
            starts.append(s)
            return true
        }
        p.period = p.periods.contains(wanted) ? wanted : .all
        p.start = start(of: p.period, records: p.recordsStart, now: now)

        // Months, oldest first, ending with this one ("so far").
        let thisMonth = PHT.startOfMonth(now)
        var index: [Date: Int] = [:]
        var m = p.start
        while m <= thisMonth {
            index[m] = p.months.count
            p.months.append(InsightsMonth(start: m, isCurrent: m == thisMonth))
            guard let next = cal.date(byAdding: .month, value: 1, to: m) else { break }
            m = next
        }
        func slot(_ d: Date) -> Int? { d <= now ? index[PHT.startOfMonth(d)] : nil }

        for pay in livePayments { if let i = slot(pay.paidAt) { p.months[i].cameIn += pay.netAmountBase ?? 0; p.months[i].fees += pay.impliedFeeBase ?? 0 } }
        for w in liveWithdrawals { if let i = slot(w.withdrawnAt) { p.months[i].fees += w.feeBase } }
        let periodSpends = liveSpends.filter { inTotals($0.walletId) && slot($0.spentAt) != nil }
        for s in periodSpends { p.months[slot(s.spentAt)!].logged += s.amountBase }

        var net: [Int: Double] = [:]
        for e in ledger where e.archivedAt == nil && e.kind == .adjustment && e.relatedKindRaw == nil && inTotals(e.walletId) {
            guard let i = slot(e.eventAt) else { continue }
            net[i, default: 0] += e.amountBase
            p.months[i].counts += 1
        }
        for (i, v) in net {
            if v < -0.004 { p.months[i].found = -v } else if v > 0.004 { p.months[i].appeared = v }
        }

        // Where logged money went: his own categories, as filed.
        var byCategory: [String: (amount: Double, count: Int)] = [:]
        for s in periodSpends {
            let name = cleaned(s.category) ?? "No category"
            byCategory[name, default: (0, 0)].amount += s.amountBase
            byCategory[name, default: (0, 0)].count += 1
        }
        p.categories = byCategory.map { InsightsCategory(name: $0.key, amount: $0.value.amount, count: $0.value.count) }
            .filter { $0.amount >= 0.005 }
            .sorted { $0.amount != $1.amount ? $0.amount > $1.amount : $0.name < $1.name }

        // Bill payments filed under another category. Links to a deleted rule still name the bill.
        let rule = Dictionary(recurring.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        var misfiled: [String: InsightsMisfiled] = [:]
        for s in periodSpends {
            guard let rid = s.recurringId, let r = rule[rid] else { continue }
            let bill = r.label.trimmingCharacters(in: .whitespacesAndNewlines)
            let cat = cleaned(s.category) ?? "No category"
            guard cat.lowercased() != bill.lowercased() else { continue }
            let key = bill + "|" + cat
            let old = misfiled[key]
            misfiled[key] = InsightsMisfiled(bill: bill, category: cat, amount: (old?.amount ?? 0) + s.amountBase, count: (old?.count ?? 0) + 1)
        }
        p.misfiled = misfiled.values.sorted { $0.amount > $1.amount }

        p.findings = findings(p, spends: periodSpends, rules: rule)
        return p
    }

    // MARK: - What stands out

    /// Only facts that hold, each a comparison he can check against his own rows.
    private static func findings(_ p: InsightsPicture, spends: [Spend], rules: [UUID: Recurring]) -> [InsightsFinding] {
        var out: [InsightsFinding] = []
        let months = p.months

        // 1. The month with the most money that left without an entry.
        if let worst = months.filter({ $0.found >= 500 }).max(by: { $0.found < $1.found }) {
            let name = Day.month(worst.start)
            let several = months.filter { $0.found >= 1 }.count > 1
            let title: String
            if worst.found > worst.logged {
                title = worst.isCurrent ? "Most of \(name) so far went unlogged" : "\(name) went mostly unlogged"
            } else if several {
                title = worst.isCurrent ? "\(name) so far has the most unlogged spending" : "\(name) had the most unlogged spending"
            } else {
                title = "Counting found money missing in \(name)"
            }
            out.append(InsightsFinding(id: "unlogged", glyph: Sym.visibilityOff, title: [.text(title)],
                                       detail: [.money(worst.found), .text(" left your wallets without an entry. Counting caught it.")]))
        }

        // 2. Income, first full month against the last full one. The month in progress never counts.
        let full = months.filter { !$0.isCurrent }
        if full.count >= 2, let first = full.first, let last = full.last, first.cameIn >= 1 {
            let change = (last.cameIn - first.cameIn) / first.cameIn
            let a = Day.month(first.start), b = Day.month(last.start)
            let pairs = zip(full, full.dropFirst())
            var title: String? = nil, glyph = Sym.trendingFlat
            if change <= -0.25 {
                title = pairs.allSatisfy({ $1.cameIn <= $0.cameIn * 1.05 }) ? "Income is slowing" : "Income fell from \(a) to \(b)"
                glyph = Sym.trendingDown
            } else if change >= 0.25 {
                title = pairs.allSatisfy({ $1.cameIn >= $0.cameIn * 0.95 }) ? "Income is growing" : "Income rose from \(a) to \(b)"
                glyph = Sym.trendingUp
            }
            if let title {
                out.append(InsightsFinding(id: "income", glyph: glyph, title: [.text(title)],
                                           detail: [.text("From "), .money(first.cameIn), .text(" in \(a) to "), .money(last.cameIn), .text(" in \(b).")]))
            }
        }

        // 3. A bill that grew a lot: its first payment in the period against its latest, one period each.
        if let bill = grownBill(spends, rules: rules) {
            let a = Day.month(bill.first.date), b = Day.month(bill.last.date)
            out.append(InsightsFinding(id: "bill", glyph: Sym.calendarMonth, title: [.text(grew(bill.label, bill.last.amount / bill.first.amount, since: a))],
                                       detail: [.money(bill.first.amount), .text(" in \(a), "), .money(bill.last.amount), .text(" in \(b).")]))
        }

        // 4. What getting paid and moving money cost, against what came in.
        if p.fees >= 1, p.cameIn >= 1 {
            let pct = p.fees / p.cameIn * 100
            let pctText = pct < 10 ? String(format: "%.1f%%", pct) : "\(Int(pct.rounded()))%"
            out.append(InsightsFinding(id: "fees", glyph: Sym.currencyExchange, title: [.text("Fees took "), .money(p.fees), .text(" " + phrase(p))],
                                       detail: [.text("\(pctText) of what came in.")]))
        }

        // Fallbacks, only when there's room: the largest logged spend, and money counting found extra.
        if out.count < 3, let big = spends.max(by: { $0.amountBase < $1.amountBase }), big.amountBase >= 1 {
            let what = cleaned(big.spendDescription).map { "“\($0)”" } ?? cleaned(big.category) ?? "A spend"
            out.append(InsightsFinding(id: "largest", glyph: Sym.shoppingBag, title: [.text("Your largest spend was "), .money(big.amountBase)],
                                       detail: [.text("\(what) on \(Day.long(big.spentAt)).")]))
        }
        if out.count < 3, let extra = months.filter({ $0.appeared >= 500 }).max(by: { $0.appeared < $1.appeared }) {
            out.append(InsightsFinding(id: "appeared", glyph: Sym.factCheck, title: [.text("Counting found money too")],
                                       detail: [.money(extra.appeared), .text(" more than Freelane had in \(Day.month(extra.start)). It isn’t counted as spending.")]))
        }
        return Array(out.prefix(4))
    }

    private struct BillPoint { let date: Date; let amount: Double }

    private static func grownBill(_ spends: [Spend], rules: [UUID: Recurring]) -> (label: String, first: BillPoint, last: BillPoint)? {
        var groups: [String: (label: String, points: [BillPoint])] = [:]
        for s in spends where s.coversPeriods <= 1 {
            guard let rid = s.recurringId, let r = rules[rid] else { continue }
            let key = IdentityKey.bill(r.label)?.rawValue ?? r.label.lowercased().trimmingCharacters(in: .whitespaces)
            var g = groups[key] ?? (r.label, [])
            if r.deletedAt == nil { g.label = r.label }
            g.points.append(BillPoint(date: s.spentAt, amount: s.amountBase))
            groups[key] = g
        }
        var best: (label: String, first: BillPoint, last: BillPoint, ratio: Double)? = nil
        for g in groups.values {
            let pts = g.points.sorted { $0.date < $1.date }
            guard let a = pts.first, let b = pts.last, a.amount >= 1,
                  PHT.startOfMonth(a.date) != PHT.startOfMonth(b.date) else { continue }
            let r = b.amount / a.amount
            guard r >= 1.5, b.amount - a.amount >= 300 else { continue }
            if r > (best?.ratio ?? 0) { best = (g.label, a, b, r) }
        }
        return best.map { ($0.label, $0.first, $0.last) }
    }

    /// "Electricity nearly quadrupled", "Water more than doubled", "Rent is up 60%", "Wifi is five times June’s".
    static func grew(_ bill: String, _ r: Double, since month: String) -> String {
        if r < 1.95 { return "\(bill) is up \(Int(((r - 1) * 100).rounded()))%" }
        let n = Int(r.rounded())
        let exact = abs(r - Double(n)) < 0.08
        let verbs = [2: "doubled", 3: "tripled", 4: "quadrupled"]
        if let verb = verbs[n] { return bill + (exact ? " " : r < Double(n) ? " nearly " : " more than ") + verb }
        let words = [5: "five", 6: "six", 7: "seven", 8: "eight", 9: "nine", 10: "ten"]
        return "\(bill) is " + (exact ? "" : r < Double(n) ? "nearly " : "over ") + "\(words[n] ?? "\(n)") times \(month)’s"
    }

    /// "since June": how the page names its period in a sentence, whichever period is chosen, so the words
    /// always say exactly which months the figures cover.
    static func phrase(_ p: InsightsPicture) -> String { "since " + monthName(p.start) }

    /// "June", or "June 2025" when it isn't this year.
    static func monthName(_ d: Date, now: Date = .now) -> String {
        PHT.calendar.component(.year, from: d) == PHT.calendar.component(.year, from: now) ? Day.month(d) : Day.monthYear(d)
    }

    /// "182k", "39.6k", "5.8k", "750": chart values.
    static func compact(_ v: Double) -> String {
        let a = abs(v)
        if a < 999.5 { return "\(Int(a.rounded()))" }
        if a < 99_950 {
            let s = String(format: "%.1f", a / 1000)
            return (s.hasSuffix(".0") ? String(s.dropLast(2)) : s) + "k"
        }
        if a < 999_500 { return "\(Int((a / 1000).rounded()))k" }
        let s = String(format: "%.1f", a / 1_000_000)
        return (s.hasSuffix(".0") ? String(s.dropLast(2)) : s) + "M"
    }
}

/// Trimmed text, or nil when there's nothing in it, so "" and nil read the same.
private func cleaned(_ s: String?) -> String? {
    guard let t = s?.trimmingCharacters(in: .whitespacesAndNewlines), !t.isEmpty else { return nil }
    return t
}

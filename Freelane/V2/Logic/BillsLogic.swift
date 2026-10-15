import SwiftUI

// Everything the Bills page shows, computed once per render from the store and the shared MoneyState.
// Nothing here is invented: amounts, dates and wallets come from the rules and the spends linked to them.

// MARK: - Words

/// Wording helpers for Bills. UK style, Manila time, like `Day`.
enum BillsText {
    private static func fmt(_ f: String) -> DateFormatter {
        let d = DateFormatter(); d.locale = Locale(identifier: "en_GB"); d.timeZone = PHT.zone; d.dateFormat = f; return d
    }
    private static let monF = fmt("MMM"), monYearF = fmt("MMM yyyy"), weekdayF = fmt("EEEE"), yearF = fmt("yyyy"), dayMonthLongF = fmt("d MMMM")

    /// "Jun"
    static func mon(_ d: Date) -> String { monF.string(from: d) }
    /// "Jul 2027"
    static func monYear(_ d: Date) -> String { monYearF.string(from: d) }
    /// "Friday"
    static func weekday(_ d: Date) -> String { weekdayF.string(from: d) }
    static func year(_ d: Date) -> String { yearF.string(from: d) }
    /// "6 June"
    static func dayMonthLong(_ d: Date) -> String { dayMonthLongF.string(from: d) }

    static func sameYear(_ a: Date, _ b: Date) -> Bool { PHT.calendar.isDate(a, equalTo: b, toGranularity: .year) }

    /// "15 Nov", or "9 Aug 2027" outside this year. Never breaks across lines.
    static func date(_ d: Date, now: Date = .now) -> String { nb(sameYear(d, now) ? Day.dayMonth(d) : Day.full(d)) }
    /// "Sun 15 Nov", or "9 Aug 2027" outside this year. Never breaks across lines.
    static func shortDate(_ d: Date, now: Date = .now) -> String { nb(sameYear(d, now) ? Day.short(d) : Day.full(d)) }
    static func nb(_ s: String) -> String { s.replacingOccurrences(of: " ", with: "\u{00A0}") }

    /// 1st, 2nd, 3rd, 4th … 11th, 12th, 13th … 21st.
    static func ordinal(_ n: Int) -> String {
        let suffix: String
        switch n % 100 {
        case 11, 12, 13: suffix = "th"
        default:
            switch n % 10 { case 1: suffix = "st"; case 2: suffix = "nd"; case 3: suffix = "rd"; default: suffix = "th" }
        }
        return "\(n)\(suffix)"
    }

    /// "a", "a and b", "a, b and c".
    static func list(_ items: [String]) -> String {
        guard items.count > 1 else { return items.first ?? "" }
        return items.dropLast().joined(separator: ", ") + " and " + items.last!
    }

    /// Common bill words read lower case inside a sentence ("rent and electricity"); names stay as typed.
    static func inSentence(_ label: String) -> String {
        let common: Set<String> = ["rent", "electricity", "water", "wifi", "wi-fi", "internet", "power", "gas", "phone",
                                   "insurance", "tuition", "school fees", "groceries", "subscription", "mobile", "cable", "trash", "garbage"]
        return common.contains(label.lowercased()) ? label.lowercased() : label
    }

    static func capitalizedFirst(_ s: String) -> String { s.prefix(1).uppercased() + s.dropFirst() }

    /// "twice", "three times" … for the "What it came to" read.
    static func times(_ n: Int) -> String {
        let words = [2: "twice", 3: "three times", 4: "four times", 5: "five times", 6: "six times", 7: "seven times",
                     8: "eight times", 9: "nine times", 10: "ten times"]
        return words[n] ?? "\(n) times"
    }

    /// "12 months", "3 weeks", "2 years".
    static func periods(_ n: Int, _ cadence: RecurringCadence) -> String {
        switch cadence {
        case .monthly: return n == 1 ? "1 month" : "\(n) months"
        case .weekly: return n == 1 ? "1 week" : "\(n) weeks"
        case .yearly: return n == 1 ? "1 year" : "\(n) years"
        }
    }

    /// What a prepayment bought, said plainly: "a year of wifi", "6 months of rent".
    static func prepaid(_ n: Int, _ cadence: RecurringCadence, _ label: String) -> String {
        let what = inSentence(label)
        if (cadence == .monthly && n == 12) || (cadence == .weekly && n == 52) { return "a year of \(what)" }
        return "\(periods(n, cadence)) of \(what)"
    }

    /// "a week", "3 days".
    static var setAsideSpan: String {
        let d = SetAside.days
        return d == 7 ? "a week" : d == 14 ? "two weeks" : d == 1 ? "a day" : "\(d) days"
    }

    /// Whole pesos with grouping and no symbol, for chart values: "2,203".
    static func figure(_ v: Double) -> String { MoneyFormat.parts(v, wholeOnly: true).whole }
}

// MARK: - Model

/// One payment toward a bill.
struct BillsPayment: Identifiable {
    let id: UUID
    let date: Date
    let amount: Double
    let periods: Int
    let wallet: String?
    /// "incl. ₱5 fee", taken from the payment's own description when it says so.
    let feeNote: String?
}

/// A bill as its history knows it. Payments are grouped by the bill's name, so a bill that was deleted and
/// set up again (Electricity, 15 Oct) keeps its whole history in one place.
struct BillsHistory {
    let key: String
    let label: String
    let cadence: RecurringCadence
    let identity: IdentityKey?
    var payments: [BillsPayment]   // oldest first
    var chart: Color { identity?.colors.chart ?? MD.outline }
    var past: Color { identity?.colors.chartPast ?? MD.outlineVariant }

    static func key(_ label: String) -> String {
        label.lowercased().split(whereSeparator: \.isWhitespace).joined(separator: " ")
    }
}

/// When a bill's last payment and its rule disagree by more than 3%.
struct BillsEstimate {
    let expected: Double
    let expectedIsEstimate: Bool
    let recent: [Double]      // the last one or two payments, oldest first
    let suggested: Double
}

/// One bill card, with every phrase the card and the detail pane need.
struct BillsCard: Identifiable {
    let line: BillLine
    let status: String
    let statusGlyph: String?
    let statusTone: StatusTone
    /// "on the 15th", or "a month" when it's paid far ahead.
    let rhythm: String
    /// "Next Sun 15 Nov · set aside from 8 Nov"
    let footer: String
    /// "Due on the 15th · October is paid"
    let subtitle: String
    /// "15th of each month"
    let dueFact: String
    /// "a week before, from 8 Nov"
    let setAsideFact: String
    let estimate: BillsEstimate?
    var id: UUID { line.id }
    var bill: Recurring { line.bill }
    var key: String { BillsHistory.key(line.label) }
}

struct BillsDueNext {
    let total: Double
    let estimate: Bool
    let month: Date
    let sentence: String
}

struct BillsPart: Identifiable {
    let key: String
    let amount: Double
    let color: Color
    var id: String { key }
}

struct BillsYearMonth: Identifiable {
    let month: Date
    let parts: [BillsPart]
    let total: Double
    let note: String?
    var id: Date { month }
}

struct BillsLegendItem: Identifiable {
    let key: String
    let label: String
    let color: Color
    var id: String { key }
}

// MARK: - Build

struct BillsPicture {
    var dueNext: BillsDueNext
    var cards: [BillsCard] = []
    var year: [BillsYearMonth] = []
    var yearTotal = 0.0
    var yearSince: Date? = nil
    var legend: [BillsLegendItem] = []
    var histories: [String: BillsHistory] = [:]

    func history(_ card: BillsCard) -> BillsHistory? { histories[card.key] }

    static func build(state: MoneyState, recurring: [Recurring], spends: [Spend], wallets: [Wallet], now: Date = .now) -> BillsPicture {
        let cal = PHT.calendar
        let today = cal.startOfDay(for: now)
        let walletName = Dictionary(wallets.map { ($0.id, $0.name) }, uniquingKeysWith: { a, _ in a })
        let rules = Dictionary(recurring.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })

        // Payment histories, by bill name. Spends linked to a rule that was later deleted still count:
        // the money was paid for that bill.
        var histories: [String: BillsHistory] = [:]
        for s in spends where s.deletedAt == nil {
            guard let rid = s.recurringId else { continue }
            let rule = rules[rid]
            if let rule, rule.kind != .expense { continue }
            let label = rule?.label ?? s.spendDescription ?? "Bill"
            let key = BillsHistory.key(label)
            let fee = s.spendDescription.flatMap { d -> String? in
                guard let r = d.range(of: "incl. ") else { return nil }
                return String(d[r.lowerBound...]).trimmingCharacters(in: .whitespaces)
            }
            let p = BillsPayment(id: s.id, date: s.spentAt, amount: s.amountBase, periods: max(1, s.coversPeriods),
                                 wallet: s.walletId.flatMap { walletName[$0] }, feeNote: fee)
            if histories[key] == nil {
                histories[key] = BillsHistory(key: key, label: label, cadence: rule?.cadence ?? .monthly,
                                              identity: IdentityKey.bill(label), payments: [])
            }
            histories[key]!.payments.append(p)
        }
        // A live rule names the group (and its schedule) when there is one.
        for b in state.bills {
            let key = BillsHistory.key(b.label)
            if let h = histories[key] {
                histories[key] = BillsHistory(key: key, label: b.label, cadence: b.bill.cadence, identity: b.key, payments: h.payments)
            }
        }
        for k in Array(histories.keys) { histories[k]!.payments.sort { $0.date < $1.date } }

        var picture = BillsPicture(dueNext: dueNext(state: state, now: now))
        picture.histories = histories
        // The bills you pay every month first, largest first; one paid far ahead goes last.
        let ordered = state.bills.sorted { a, b in
            if (a.coveredUntil == nil) != (b.coveredUntil == nil) { return a.coveredUntil == nil }
            return a.amount > b.amount
        }
        picture.cards = ordered.map { card($0, history: histories[BillsHistory.key($0.label)], today: today, now: now) }

        // Paid this year: one row per month from the first bill payment this year.
        let yearStart = PHT.startOfYear(now)
        let thisYear = histories.values.flatMap { h in h.payments.filter { $0.date >= yearStart && $0.date <= now }.map { (h, $0) } }
        if let first = thisYear.map(\.1.date).min() {
            // Steady bills first (most payments), then by what they cost; the order holds from month to month.
            let order = Dictionary(grouping: thisYear, by: { $0.0.key }).map { key, rows in
                (key: key, count: rows.count, total: rows.reduce(0) { $0 + $1.1.amount })
            }
            .sorted { ($0.count, $0.total) > ($1.count, $1.total) }
            picture.legend = order.compactMap { o in histories[o.key].map { BillsLegendItem(key: o.key, label: $0.label, color: $0.chart) } }
            var month = PHT.startOfMonth(first)
            let last = PHT.startOfMonth(now)
            var rows: [BillsYearMonth] = []
            while month <= last {
                let next = cal.date(byAdding: .month, value: 1, to: month) ?? last.addingTimeInterval(86_400 * 32)
                let inMonth = thisYear.filter { $0.1.date >= month && $0.1.date < next }
                let parts = order.compactMap { o -> BillsPart? in
                    let amount = inMonth.filter { $0.0.key == o.key }.reduce(0) { $0 + $1.1.amount }
                    guard amount > 0.004, let h = histories[o.key] else { return nil }
                    return BillsPart(key: o.key, amount: amount, color: h.chart)
                }
                let notes = inMonth.filter { $0.1.periods > 1 }.map { BillsText.prepaid($0.1.periods, $0.0.cadence, $0.0.label) }
                rows.append(BillsYearMonth(month: month, parts: parts, total: parts.reduce(0) { $0 + $1.amount },
                                           note: notes.isEmpty ? nil : notes.joined(separator: ", ")))
                month = next
            }
            picture.year = rows
            picture.yearTotal = rows.reduce(0) { $0 + $1.total }
            picture.yearSince = PHT.startOfMonth(first)
        }
        return picture
    }

    /// What comes due next calendar month: each active bill's occurrences that month, unless already paid for.
    private static func dueNext(state: MoneyState, now: Date) -> BillsDueNext {
        let cal = PHT.calendar
        let start = cal.date(byAdding: .month, value: 1, to: PHT.startOfMonth(now)) ?? now
        let end = cal.date(byAdding: .month, value: 1, to: start) ?? start
        var due: [(date: Date, line: BillLine)] = []
        for b in state.bills {
            let r = b.bill
            var occ = RecurringMath.firstOccurrence(r, onOrAfter: start), n = 0
            while occ < end, n < 8 {
                let paid = r.paidThroughDate.map { cal.startOfDay(for: $0) >= occ } ?? false
                if !paid { due.append((occ, b)) }
                occ = RecurringMath.occurrence(r, after: occ); n += 1
            }
        }
        let total = due.reduce(0) { $0 + $1.line.amount }
        let estimate = due.contains { $0.line.estimate }

        // "Water on 1 Nov, rent and electricity on 15 Nov." A bill due more than once that month is said once.
        let counts = Dictionary(grouping: due, by: { $0.line.id }).mapValues(\.count)
        let once = due.filter { counts[$0.line.id] == 1 }
        let days = Dictionary(grouping: once, by: { $0.date }).sorted { $0.key < $1.key }
        var parts = days.map { day, rows in
            let names = rows.sorted { $0.line.amount > $1.line.amount }.map { BillsText.inSentence($0.line.label) }
            return "\(BillsText.list(names)) on \(BillsText.date(day, now: now))"
        }
        var seen = Set<UUID>()
        for d in due where (counts[d.line.id] ?? 0) > 1 && seen.insert(d.line.id).inserted {
            parts.append("\(BillsText.inSentence(d.line.label)) \(counts[d.line.id]!) times")
        }
        var sentence = parts.isEmpty ? "Nothing is due in \(Day.month(start))." : BillsText.capitalizedFirst(parts.joined(separator: ", ")) + "."
        if state.monthBillsPaid { sentence += " \(Day.month(now)) is all paid." }
        return BillsDueNext(total: total, estimate: estimate, month: start, sentence: sentence)
    }

    private static func card(_ b: BillLine, history: BillsHistory?, today: Date, now: Date) -> BillsCard {
        let cal = PHT.calendar
        let r = b.bill
        let paidThrough = r.paidThroughDate.map { cal.startOfDay(for: $0) }
        let thisPeriod = RecurringMath.anchored(r, in: today)
        let day = min(max(r.dayOfMonth ?? 1, 1), 28)

        // The schedule, in words.
        let schedule: String, dueFact: String, rhythm: String
        switch r.cadence {
        case .monthly:
            schedule = "Due on the \(BillsText.ordinal(day))"; dueFact = "\(BillsText.ordinal(day)) of each month"; rhythm = "on the \(BillsText.ordinal(day))"
        case .weekly:
            let wd = BillsText.weekday(r.createdAt)
            schedule = "Due every \(wd)"; dueFact = "every \(wd)"; rhythm = "every \(wd)"
        case .yearly:
            schedule = "Due every \(BillsText.dayMonthLong(r.createdAt))"; dueFact = "\(BillsText.dayMonthLong(r.createdAt)) each year"
            rhythm = "on \(BillsText.nb(Day.dayMonth(r.createdAt)))"
        }
        let per: String = { switch r.cadence { case .monthly: return "a month"; case .weekly: return "a week"; case .yearly: return "a year" } }()

        // Where the bill stands.
        var status = "", glyph: String? = Sym.check, tone = StatusTone.ok, footer = "", standing = ""
        if let covered = b.coveredUntil {
            status = "Paid to \(BillsText.monYear(covered))"
            standing = "paid to \(BillsText.monYear(covered))"
            let big = history?.payments.last(where: { $0.periods > 1 })
            let nextText = b.nextDue.map { " · next due \(BillsText.nb(Day.full($0)))" } ?? ""
            if let big {
                footer = "\(BillsText.periods(big.periods, r.cadence)) paid on \(BillsText.date(big.date, now: now))" + nextText
            } else {
                footer = "Paid up to \(BillsText.nb(Day.full(covered)))" + nextText
            }
        } else if let pt = paidThrough, pt >= thisPeriod {
            let name = periodName(r, pt)
            if cal.isDate(pt, equalTo: today, toGranularity: r.cadence == .yearly ? .year : .month) || r.cadence == .weekly {
                status = r.cadence == .weekly ? "Paid this week" : "Paid · \(name)"
                standing = r.cadence == .weekly ? "this week is paid" : "\(name) is paid"
            } else {
                status = "Paid to \(name)"; standing = "paid to \(name)"
            }
            footer = nextFooter(b, today: today, now: now)
        } else if let due = b.nextDue {
            let dueDay = cal.startOfDay(for: due)
            if dueDay < today {
                status = "Due \(BillsText.date(due, now: now))"; glyph = Sym.schedule; tone = .note
                standing = "was due \(BillsText.shortDate(due, now: now))"
                footer = "Was due \(BillsText.shortDate(due, now: now)) · \(Day.until(due, from: now))"
            } else if b.isSetAside {
                status = "Set aside"; glyph = Sym.savings; tone = .note
                standing = "due \(BillsText.shortDate(due, now: now))"
                footer = "Due \(BillsText.shortDate(due, now: now)) · set aside since \(b.setAsideFrom.map { BillsText.date($0, now: now) } ?? "today")"
            } else {
                status = "Due \(BillsText.date(due, now: now))"; glyph = nil; tone = .quiet
                standing = "next due \(BillsText.shortDate(due, now: now))"
                footer = nextFooter(b, today: today, now: now)
            }
        } else {
            status = "No date"; glyph = nil; tone = .quiet; standing = "no date"; footer = "No due date"
        }

        var setAsideFact = "\(BillsText.setAsideSpan) before"
        if let from = b.setAsideFrom {
            setAsideFact += cal.startOfDay(for: from) <= today ? ", since \(BillsText.date(from, now: now))" : ", from \(BillsText.date(from, now: now))"
        }

        // The estimate: the last payment and the rule disagree by more than 3%.
        var estimate: BillsEstimate? = nil
        if b.coveredUntil == nil, b.amount > 0, let pays = history?.payments, let last = pays.last, last.periods == 1,
           abs(last.amount - b.amount) / b.amount > 0.03 {
            let recent = pays.suffix(2).filter { $0.periods == 1 }.map(\.amount)
            estimate = BillsEstimate(expected: b.amount, expectedIsEstimate: b.estimate, recent: recent,
                                     suggested: (last.amount / 10).rounded(.up) * 10)
        }

        return BillsCard(line: b, status: status, statusGlyph: glyph, statusTone: tone,
                         rhythm: b.coveredUntil != nil ? per : rhythm, footer: footer,
                         subtitle: "\(schedule) · \(standing)", dueFact: dueFact, setAsideFact: setAsideFact, estimate: estimate)
    }

    private static func nextFooter(_ b: BillLine, today: Date, now: Date) -> String {
        guard let due = b.nextDue else { return "No due date" }
        var s = "Next \(BillsText.shortDate(due, now: now))"
        if let from = b.setAsideFrom, PHT.calendar.startOfDay(for: from) > today { s += " · set aside from \(BillsText.date(from, now: now))" }
        return s
    }

    /// "October", "2026" — the period a payment settled, in the bill's own rhythm.
    private static func periodName(_ r: Recurring, _ d: Date) -> String {
        switch r.cadence {
        case .yearly: return BillsText.year(d)
        default: return BillsText.sameYear(d, .now) ? Day.month(d) : BillsText.monYear(d)
        }
    }
}

// MARK: - "What it came to"

enum BillsRead {
    /// One honest line about the shown payments (oldest first).
    static func line(_ ps: [BillsPayment], cadence: RecurringCadence) -> String {
        guard let last = ps.last else { return "No payments yet." }
        if ps.count == 1 { return "One payment so far, on \(BillsText.date(last.date))." }
        if let big = ps.last(where: { $0.periods > 1 }) {
            let per = MoneyFormat.string(big.amount / Double(big.periods), decimals: false)
            let unit: String = { switch cadence { case .monthly: return "a month"; case .weekly: return "a week"; case .yearly: return "a year" } }()
            return "The \(BillsText.date(big.date)) payment covered \(BillsText.periods(big.periods, cadence)), about \(per) \(unit)."
        }
        let amounts = ps.map(\.amount)
        let lo = amounts.min() ?? 0, hi = amounts.max() ?? 0
        let money = { (v: Double) in MoneyFormat.string(v, decimals: false) }
        if hi - lo < 0.5 { return "\(money(last.amount)) every time." }
        if lo > 0, hi / lo <= 1.1 { return "Between \(money(lo)) and \(money(hi)) each time." }

        let first = ps[0]
        guard first.amount > 0 else { return "Between \(money(lo)) and \(money(hi))." }
        let ratio = last.amount / first.amount
        // Where the latest level began: the run of payments, ending with the latest, within 15% of it.
        var start = ps.count - 1
        while start > 0, abs(ps[start - 1].amount / last.amount - 1) <= 0.15 { start -= 1 }
        let since = (start > 0 && start < ps.count - 1 && !PHT.calendar.isDate(ps[start].date, equalTo: first.date, toGranularity: .month))
            ? " since \(Day.month(ps[start].date))" : ""
        let month = Day.month(first.date)
        if ratio >= 1.75 { return "About \(BillsText.times(Int(ratio.rounded()))) \(month)’s bill\(since)." }
        if ratio > 1.1 { return "About \(Int(((ratio - 1) * 20).rounded()) * 5)% more than in \(month)\(since)." }
        if ratio < 0.4 { return "Down to about \(Int((ratio * 20).rounded()) * 5)% of \(month)’s bill\(since)." }
        if ratio <= 0.6 { return "About half of \(month)’s bill\(since)." }
        if ratio < 0.9 { return "About \(Int(((1 - ratio) * 20).rounded()) * 5)% less than in \(month)\(since)." }
        return "Up and down, between \(money(lo)) and \(money(hi))."
    }
}

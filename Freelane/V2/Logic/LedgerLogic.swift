import Foundation
import SwiftData

// The Ledger's own computation, all derived from the store:
//   · lines built from the shared feed, with moves between the same two wallets on one day folded together
//   · the figures for any month (the same rules as `MoneyState.month`)
//   · which bill period each bill payment settled (the same rule `RecurringMath` uses for paid-through)
//   · how a client payment reached you, following only moves that can be tied to it with confidence
//   · what Freelane had before each count, rebuilt from the rows that existed at the time

// MARK: - Filters and periods

enum LedgerFilter: String, CaseIterable, Identifiable {
    case all, spending, moneyIn, moves, counts, giving
    var id: String { rawValue }

    var title: String {
        switch self {
        case .all: return "All"; case .spending: return "Spending"; case .moneyIn: return "Money in"
        case .moves: return "Moves"; case .counts: return "Counts"; case .giving: return "Giving"
        }
    }

    func includes(_ kind: FeedKind) -> Bool {
        switch self {
        case .all: return true
        case .spending: return kind == .spend || kind == .fee
        case .moneyIn: return kind == .payment
        case .moves: return kind == .move
        case .counts: return kind == .count
        case .giving: return kind == .gift
        }
    }

    /// The empty-state phrase: "No moves in October 2026."
    var none: String {
        switch self {
        case .all: return "Nothing recorded"; case .spending: return "No spending"; case .moneyIn: return "No money in"
        case .moves: return "No moves"; case .counts: return "No counts"; case .giving: return "No giving"
        }
    }
}

enum LedgerPeriod: Hashable {
    case month(Date)    // the first instant of a month, Manila time
    case all

    var title: String {
        switch self { case .month(let d): return Day.monthYear(d); case .all: return "All time" }
    }
    /// " in October 2026", or nothing for all time.
    var phrase: String {
        switch self { case .month(let d): return " in \(Day.monthYear(d))"; case .all: return "" }
    }
    var bounds: (start: Date, end: Date) {
        switch self {
        case .all: return (.distantPast, .distantFuture)
        case .month(let s): return (s, PHT.calendar.date(byAdding: .month, value: 1, to: s) ?? .distantFuture)
        }
    }
}

// MARK: - Lines

enum LedgerRef: Hashable {
    case payment(UUID)
    case spend(UUID)
    case moves([UUID])      // oldest first
    case count(Date)        // the day, Manila time
    case fee(UUID)          // the ledger entry
}

/// One row of the Ledger list.
struct LedgerLine: Identifiable {
    let id: String
    let kind: FeedKind
    let date: Date
    let day: Date
    let title: String
    let subtitle: String
    let amount: Double
    let badge: BadgeSubject
    let badgeGlyph: String?
    let inTotals: Bool
    /// What the line changes in his total that day: money in and counts as they are, spending from wallets
    /// in his totals, and for moves only the fees lost on the way.
    let dayEffect: Double
    let ref: LedgerRef
    let cover: LedgerCover?
    let searchKey: String
}

struct LedgerDay: Identifiable {
    let day: Date
    let lines: [LedgerLine]
    var id: Date { day }
    var net: Double { lines.reduce(0) { $0 + $1.dayEffect } }
    var title: String { LedgerText.dayTitle(day) }
}

enum LedgerModel {
    static func lines(feed: [FeedItem], withdrawals: [Withdrawal], spends: [Spend], recurring: [Recurring],
                      ledger: [LedgerEntry], wallets: [Wallet], now: Date = .now) -> [LedgerLine] {
        let cal = PHT.calendar
        let moves = Dictionary(withdrawals.filter { $0.deletedAt == nil }.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        let covers = LedgerCover.all(spends: spends, recurring: recurring)
        let countedInTotals = countsInTotals(ledger: ledger, wallets: wallets)

        func moveKey(_ item: FeedItem, day: Date) -> String? {
            guard let id = item.related, let w = moves[id] else { return nil }
            return "\(Int(day.timeIntervalSince1970))|\(w.fromMethodId?.uuidString ?? "none")|\(w.toMethodId?.uuidString ?? "none")"
        }
        var groups: [String: [FeedItem]] = [:]
        for item in feed where item.kind == .move {
            if let k = moveKey(item, day: cal.startOfDay(for: item.date)) { groups[k, default: []].append(item) }
        }

        var out: [LedgerLine] = []
        out.reserveCapacity(feed.count)
        var emitted = Set<String>()
        for item in feed {
            let day = cal.startOfDay(for: item.date)
            switch item.kind {
            case .move:
                guard let k = moveKey(item, day: day) else {
                    out.append(line(item, day: day, ref: .moves(item.related.map { [$0] } ?? []), dayEffect: 0))
                    continue
                }
                guard emitted.insert(k).inserted else { continue }
                let items = groups[k] ?? [item]
                let ws = items.compactMap { $0.related.flatMap { moves[$0] } }.sorted { $0.withdrawnAt < $1.withdrawnAt }
                let fee = ws.reduce(0) { $0 + $1.feeBase }
                let net = items.reduce(0) { $0 + $1.amount }
                let sub = items.count == 1 ? item.subtitle
                    : "\(items.count) moves" + (fee > 0.004 ? " · \(MoneyFormat.string(fee)) in fees" : "")
                out.append(LedgerLine(id: "mv|\(k)", kind: .move, date: items.map(\.date).max() ?? item.date, day: day,
                                      title: item.title, subtitle: sub, amount: net, badge: item.badge, badgeGlyph: item.badgeGlyph,
                                      inTotals: true, dayEffect: -fee, ref: .moves(ws.map(\.id)), cover: nil,
                                      searchKey: searchKey([item.title, sub], amounts: [net] + ws.map(\.grossBase))))
            case .payment:
                guard let pid = item.related else { continue }
                var natives: [String] = []
                if let n = item.native { natives.append(LedgerText.native(n.amount, n.currency)) }
                out.append(line(item, day: day, ref: .payment(pid), dayEffect: item.amount, extra: natives))
            case .spend, .gift:
                guard let sid = item.related else { continue }
                let cover = covers[sid]
                var sub = cover.map { "\($0.short(now: now)) · \(item.subtitle)" } ?? item.subtitle
                if !item.inTotals { sub += " · not in your totals" }
                // A gift with no description, shop or category gets the feed's generic "Spending"; under Giving that misreads.
                let title = item.kind == .gift && item.title == "Spending" ? "Gift" : nil
                out.append(line(item, day: day, ref: .spend(sid), dayEffect: item.inTotals ? item.amount : 0, title: title, subtitle: sub, cover: cover))
            case .count:
                let sub = item.inTotals ? item.subtitle : item.subtitle + " · not in your totals"
                out.append(line(item, day: day, ref: .count(day), dayEffect: countedInTotals[day] ?? 0, subtitle: sub))
            case .fee:
                guard let eid = item.related else { continue }
                out.append(line(item, day: day, ref: .fee(eid), dayEffect: item.inTotals ? item.amount : 0))
            }
        }
        return out
    }

    /// Per day, what counting changed in wallets that are in his totals. The feed's count line sums every wallet
    /// counted that day; this leaves out wallets kept out of the totals (same filters as the feed otherwise).
    private static func countsInTotals(ledger: [LedgerEntry], wallets: [Wallet]) -> [Date: Double] {
        let cal = PHT.calendar
        let byId = Dictionary(wallets.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        var perWallet: [Date: [UUID: Double]] = [:]
        for e in ledger where e.archivedAt == nil && e.kind == .adjustment && e.relatedKindRaw == nil && abs(e.amountBase) >= 1 {
            guard let wid = e.walletId, byId[wid] != nil else { continue }
            perWallet[cal.startOfDay(for: e.eventAt), default: [:]][wid, default: 0] += e.amountBase
        }
        return perWallet.mapValues { sums in
            sums.filter { abs($0.value) >= 1 && !(byId[$0.key]?.excludedFromTotals ?? false) }.reduce(0) { $0 + $1.value }
        }
    }

    private static func line(_ item: FeedItem, day: Date, ref: LedgerRef, dayEffect: Double, title: String? = nil, subtitle: String? = nil,
                             cover: LedgerCover? = nil, extra: [String] = []) -> LedgerLine {
        let head = title ?? item.title
        let sub = subtitle ?? item.subtitle
        return LedgerLine(id: item.id, kind: item.kind, date: item.date, day: day, title: head, subtitle: sub,
                          amount: item.amount, badge: item.badge, badgeGlyph: item.badgeGlyph, inTotals: item.inTotals,
                          dayEffect: dayEffect, ref: ref, cover: cover,
                          searchKey: searchKey([head, sub] + extra, amounts: [item.amount]))
    }

    /// Lower-cased, accent-free, comma-free text the search box matches against, so "2086", "2,086" and
    /// "₱2,086.07" all find the same line.
    static func searchKey(_ parts: [String], amounts: [Double]) -> String {
        var s = parts.joined(separator: " ")
        for a in amounts { s += " " + MoneyFormat.string(abs(a)) }
        return fold(s)
    }

    static func fold(_ s: String) -> String {
        s.folding(options: [.caseInsensitive, .diacriticInsensitive, .widthInsensitive], locale: nil)
            .replacingOccurrences(of: ",", with: "")
    }

    static func filter(_ lines: [LedgerLine], by filter: LedgerFilter, in period: LedgerPeriod, matching query: String) -> [LedgerLine] {
        let (start, end) = period.bounds
        let tokens = fold(query).split(whereSeparator: \.isWhitespace).map(String.init)
        return lines.filter { l in
            guard filter.includes(l.kind), l.date >= start, l.date < end else { return false }
            return tokens.allSatisfy { l.searchKey.contains($0) }
        }
    }

    /// Lines arrive newest first, so each day's lines are already together.
    static func days(_ lines: [LedgerLine]) -> [LedgerDay] {
        var out: [LedgerDay] = []
        var current: [LedgerLine] = []
        for l in lines {
            if let last = current.last, last.day != l.day {
                out.append(LedgerDay(day: last.day, lines: current))
                current = []
            }
            current.append(l)
        }
        if let last = current.last { out.append(LedgerDay(day: last.day, lines: current)) }
        return out
    }

    /// Months that have at least one line, newest first.
    static func months(_ lines: [LedgerLine]) -> [Date] {
        let cal = PHT.calendar
        var seen = Set<Date>()
        for l in lines {
            if let m = cal.date(from: cal.dateComponents([.year, .month], from: l.day)) { seen.insert(m) }
        }
        return seen.sorted(by: >)
    }

    /// The period's figures, by the rules `MoneyState.month` uses for this month: money in is every
    /// payment's net; out is spending from wallets in the totals; fees are move fees plus the fees taken off
    /// payments; counts are wallet counts in the totals.
    static func figures(_ period: LedgerPeriod, payments: [Payment], spends: [Spend], withdrawals: [Withdrawal],
                        ledger: [LedgerEntry], wallets: [Wallet]) -> MonthFigures {
        let (a, b) = period.bounds
        let excluded = Set(wallets.filter(\.excludedFromTotals).map(\.id))
        let paid = payments.filter { $0.deletedAt == nil && $0.paidAt >= a && $0.paidAt < b }
        var f = MonthFigures()
        f.cameIn = paid.reduce(0) { $0 + ($1.netAmountBase ?? 0) }
        f.wentOut = spends.filter { $0.deletedAt == nil && $0.spentAt >= a && $0.spentAt < b && !($0.walletId.map(excluded.contains) ?? false) }
            .reduce(0) { $0 + $1.amountBase }
        f.fees = withdrawals.filter { $0.deletedAt == nil && $0.withdrawnAt >= a && $0.withdrawnAt < b }.reduce(0) { $0 + $1.feeBase }
            + paid.reduce(0) { $0 + ($1.impliedFeeBase ?? 0) }
        f.countsFound = ledger.filter {
            $0.archivedAt == nil && $0.kind == .adjustment && $0.relatedKindRaw == nil && $0.eventAt >= a && $0.eventAt < b
                && !($0.walletId.map(excluded.contains) ?? false)
        }
        .reduce(0) { $0 + $1.amountBase }
        return f
    }
}

// MARK: - Which period a bill payment settled

/// The bill period(s) a payment settled. Payments settle consecutive scheduled occurrences in the order they
/// were made, starting at the occurrence nearest the first payment: the rule `RecurringMath.recomputePaidThrough`
/// uses, so this always agrees with the bill's paid-through date.
struct LedgerCover {
    let first: Date
    let last: Date
    let periods: Int
    let cadence: RecurringCadence
    let label: String

    /// "October’s bill", "12 months from August"
    func short(now: Date = .now) -> String {
        switch cadence {
        case .monthly: return periods == 1 ? "\(month(first, now))’s bill" : "\(periods) months from \(month(first, now))"
        case .weekly: return periods == 1 ? "week of \(Day.dayMonth(first))" : "\(periods) weeks from \(Day.dayMonth(first))"
        case .yearly: return periods == 1 ? "year from \(Day.full(first))" : "\(periods) years from \(Day.full(first))"
        }
    }

    /// "covers October", "covers August to July 2027"
    func long(now: Date = .now) -> String {
        switch cadence {
        case .monthly: return periods == 1 ? "covers \(month(first, now))" : "covers \(month(first, now)) to \(Day.monthYear(last))"
        case .weekly: return periods == 1 ? "covers the week of \(Day.dayMonth(first))" : "covers \(periods) weeks from \(Day.dayMonth(first))"
        case .yearly: return periods == 1 ? "covers the year from \(Day.full(first))" : "covers \(periods) years from \(Day.full(first))"
        }
    }

    private func month(_ d: Date, _ now: Date) -> String {
        let cal = PHT.calendar
        return cal.component(.year, from: d) == cal.component(.year, from: now) ? Day.month(d) : Day.monthYear(d)
    }

    static func all(spends: [Spend], recurring: [Recurring]) -> [UUID: LedgerCover] {
        let rules = Dictionary(recurring.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        let byRule = Dictionary(grouping: spends.filter { $0.deletedAt == nil && $0.recurringId != nil }) { $0.recurringId! }
        var out: [UUID: LedgerCover] = [:]
        for (rid, paid) in byRule {
            guard let r = rules[rid] else { continue }
            let ordered = paid.sorted { ($0.spentAt, $0.createdAt) < ($1.spentAt, $1.createdAt) }
            guard let firstPaid = ordered.first?.spentAt else { continue }
            let before = RecurringMath.occurrence(r, onOrBefore: firstPaid), after = RecurringMath.occurrence(r, after: firstPaid)
            var occ = firstPaid.timeIntervalSince(before) <= after.timeIntervalSince(firstPaid) ? before : after
            for s in ordered {
                let n = max(1, s.coversPeriods)
                var last = occ
                for _ in 1..<n { last = RecurringMath.occurrence(r, after: last) }
                out[s.id] = LedgerCover(first: occ, last: last, periods: n, cadence: r.cadence, label: r.label)
                occ = RecurringMath.occurrence(r, after: last)
            }
        }
        return out
    }
}

// MARK: - How a payment reached him

struct LedgerHop: Identifiable {
    enum Mark { case person(String), wallet(Wallet), unknown }
    let id: Int
    let mark: Mark
    let title: String
    let sub: String?
    let amount: Double
    let symbol: String
    let fee: Double?
}

struct LedgerRoute {
    var hops: [LedgerHop] = []
    /// Fees recorded along the way, for every payment that travelled in the same moves.
    var fees = 0.0
    var feesKnown = true
    /// What those payments were worth at market, the base for the fee percentage.
    var gross = 0.0
    /// Other payments that left in the same move as this one.
    var together = 0
    /// Wallet names in order; empty when the landing wallet was never recorded.
    var landed: [String] = []
    var hopCount: Int { max(0, hops.count - 1) }

    /// Client paid → landed in a wallet → each onward move that can be tied to this money. A move is tied only
    /// when it left the wallet the money was in, on the same or the next day, for exactly that amount (or exactly
    /// that amount plus other payments that landed in the same wallet that day, when only one such combination
    /// fits). Anything less certain is left out rather than guessed.
    static func build(_ p: Payment, client: String?, payments: [Payment], withdrawals: [Withdrawal],
                      liveLedger: [LedgerEntry], wallets: [UUID: Wallet], steps: [PaymentStep]) -> LedgerRoute {
        var r = LedgerRoute()
        let landingOf: (UUID) -> UUID? = { pid in
            liveLedger.first { $0.relatedId == pid && $0.kind == .income && $0.relatedKindRaw == LedgerRelatedKind.payment.rawValue }?.walletId
        }
        let net = p.netAmountBase ?? 0
        let implied = p.impliedFeeBase ?? 0
        r.fees = implied
        r.feesKnown = !p.feeUnknown
        r.gross = p.grossAtMarketBase ?? net

        let via = steps.filter { $0.paymentId == p.id }.min { $0.stepOrder < $1.stepOrder }?.fromMethodId.flatMap { wallets[$0]?.name }
        let originSub = [p.currency == "PHP" ? nil : "in \(LedgerText.plural(p.currency))", via.map { "through \($0)" }]
            .compactMap { $0 }.joined(separator: ", ")
        r.hops.append(LedgerHop(id: 0, mark: client.map { LedgerHop.Mark.person($0) } ?? .unknown, title: client.map { "\($0) paid" } ?? "Paid",
                                sub: originSub.isEmpty ? nil : originSub, amount: p.amount, symbol: CurrencyFormat.symbol(p.currency), fee: nil))

        let converted = (p.currency != "PHP" && p.amount > 0) ? "converted at \(MoneyFormat.string(net / p.amount))" : nil
        guard let landing = landingOf(p.id), let lw = wallets[landing] else {
            r.hops.append(LedgerHop(id: 1, mark: .unknown, title: "No wallet recorded", sub: converted ?? "Freelane doesn’t know where it landed",
                                    amount: net, symbol: "₱", fee: implied > 0.004 ? implied : nil))
            return r
        }
        r.hops.append(LedgerHop(id: 1, mark: .wallet(lw), title: "Landed in \(lw.name)", sub: converted, amount: net, symbol: "₱",
                                fee: implied > 0.004 ? implied : nil))
        r.landed = [lw.name]

        let moves = withdrawals.filter { $0.deletedAt == nil && $0.toMethodId != nil }
        let others = payments.filter {
            $0.deletedAt == nil && $0.id != p.id && Day.daysBetween($0.paidAt, p.paidAt) == 0 && landingOf($0.id) == landing
        }
        var wallet = landing, amount = net, time = p.paidAt
        var used = Set<UUID>()
        var first = true
        while r.hops.count < 8 {
            let candidates = moves.filter { w in
                guard !used.contains(w.id), w.fromMethodId == wallet else { return false }
                let gap = Day.daysBetween(time, w.withdrawnAt)
                guard gap == 0 || gap == 1 else { return false }
                // Money can't leave before it arrived; only checkable when both carry a time of day.
                return !(LedgerText.hasTime(time) && LedgerText.hasTime(w.withdrawnAt) && w.withdrawnAt < time)
            }
            .sorted { $0.withdrawnAt < $1.withdrawnAt }

            var picked: Withdrawal? = nil
            var joined: [Payment] = []
            if let w = candidates.first(where: { abs($0.grossBase - amount) < 0.011 }) {
                // If another payment landed here that day for the same amount, the move could have carried either.
                if first && others.contains(where: { abs(($0.netAmountBase ?? 0) - w.grossBase) < 0.011 }) { break }
                picked = w
            } else if first, !others.isEmpty, others.count <= 6 {
                var matches: [(Withdrawal, [Payment])] = []
                for mask in 1..<(1 << others.count) {
                    let subset = others.enumerated().filter { mask & (1 << $0.offset) != 0 }.map(\.element)
                    let sum = amount + subset.reduce(0) { $0 + ($1.netAmountBase ?? 0) }
                    for w in candidates where abs(w.grossBase - sum) < 0.021 { matches.append((w, subset)) }
                }
                if matches.count == 1 { picked = matches[0].0; joined = matches[0].1 }
            }
            guard let w = picked, let to = w.toMethodId.flatMap({ wallets[$0] }) else { break }
            used.insert(w.id)
            var sub = Day.daysBetween(time, w.withdrawnAt) == 0 ? "same day" : "next day"
            if !joined.isEmpty { sub += " · \(joined.count + 1) payments" }
            r.hops.append(LedgerHop(id: r.hops.count, mark: .wallet(to), title: "Moved to \(to.name)", sub: sub, amount: w.netBase,
                                    symbol: "₱", fee: w.feeBase > 0.004 ? w.feeBase : nil))
            r.landed.append(to.name)
            r.fees += w.feeBase
            if !joined.isEmpty {
                r.together += joined.count
                r.fees += joined.reduce(0) { $0 + ($1.impliedFeeBase ?? 0) }
                r.gross += joined.reduce(0) { $0 + ($1.grossAtMarketBase ?? $1.netAmountBase ?? 0) }
                if joined.contains(where: \.feeUnknown) { r.feesKnown = false }
            }
            wallet = to.id; amount = w.netBase; time = w.withdrawnAt
            first = false
        }
        return r
    }
}

// MARK: - What a count found

struct LedgerCountLine: Identifiable {
    let id: UUID
    let at: Date
    let amount: Double
    /// Freelane's balance for the wallet just before this count; nil when it can't be rebuilt.
    let had: Double?
    var counted: Double? { had.map { $0 + amount } }
}

struct LedgerCountWallet: Identifiable {
    let wallet: Wallet
    let total: Double
    let lines: [LedgerCountLine]
    var id: UUID { wallet.id }
}

enum LedgerCounts {
    /// The counts behind one day's count line in the feed (same filter: whole-peso differences only).
    static func detail(day: Date, ledger: [LedgerEntry], wallets: [UUID: Wallet]) -> [LedgerCountWallet] {
        let cal = PHT.calendar
        let counts = ledger.filter {
            $0.archivedAt == nil && $0.kind == .adjustment && $0.relatedKindRaw == nil && abs($0.amountBase) >= 1
                && $0.walletId.flatMap { wallets[$0] } != nil && cal.isDate($0.eventAt, inSameDayAs: day)
        }
        return Dictionary(grouping: counts) { $0.walletId! }.compactMap { wid, entries -> LedgerCountWallet? in
            guard let w = wallets[wid] else { return nil }
            let total = entries.reduce(0) { $0 + $1.amountBase }
            guard abs(total) >= 1 else { return nil }
            let lines = entries.sorted { $0.eventAt < $1.eventAt }
                .map { LedgerCountLine(id: $0.id, at: $0.eventAt, amount: $0.amountBase, had: had(before: $0, in: w, ledger: ledger)) }
            return LedgerCountWallet(wallet: w, total: total, lines: lines)
        }
        .sorted { abs($0.total) > abs($1.total) }
    }

    /// The balance Freelane showed for the wallet when the count was saved: its opening balance plus every row
    /// that existed then (created before the count, not yet archived), counted from the opening-balance anchor,
    /// as `WalletMath.balance` does. Nil when the opening balance was set after the count, because the figure
    /// the count was compared against can no longer be rebuilt.
    static func had(before e: LedgerEntry, in w: Wallet, ledger: [LedgerEntry]) -> Double? {
        let t = e.createdAt
        if let set = w.openingBalanceSetAt, set > t { return nil }
        let anchor = WalletMath.anchor(w)
        let sum = ledger.filter { x in
            guard x.walletId == w.id, x.id != e.id, x.createdAt < t else { return false }
            if let gone = x.archivedAt, gone <= t { return false }
            if let a = anchor, x.eventAt < a { return false }
            return true
        }
        .reduce(0) { $0 + $1.amountBase }
        return (w.openingBalanceBase ?? 0) + sum
    }
}

// MARK: - Wording

enum LedgerText {
    private static let clock: DateFormatter = {
        let f = DateFormatter(); f.locale = Locale(identifier: "en_GB"); f.timeZone = PHT.zone; f.dateFormat = "HH:mm"; return f
    }()

    /// "Thursday 15 October", with the year when it isn't this year.
    static func dayTitle(_ d: Date, now: Date = .now) -> String {
        let cal = PHT.calendar
        let y = cal.component(.year, from: d)
        return y == cal.component(.year, from: now) ? Day.long(d) : "\(Day.long(d)) \(y)"
    }

    /// "22:37", or nil for a record kept by date only (saved at exactly midnight).
    static func time(_ d: Date) -> String? { hasTime(d) ? clock.string(from: d) : nil }

    static func hasTime(_ d: Date) -> Bool {
        let c = PHT.calendar.dateComponents([.hour, .minute, .second], from: d)
        return (c.hour ?? 0) != 0 || (c.minute ?? 0) != 0 || (c.second ?? 0) != 0
    }

    /// "€200.00", "¥300", "$5": the foreign original as written, cents only when there are any.
    static func native(_ amount: Double, _ currency: String) -> String {
        let p = MoneyFormat.parts(amount)
        return CurrencyFormat.symbol(currency) + p.whole + (p.cents == "00" ? "" : "." + p.cents)
    }

    /// "€200.00", always with cents, for figures that line up.
    static func nativeExact(_ amount: Double, _ currency: String) -> String {
        let p = MoneyFormat.parts(amount)
        return CurrencyFormat.symbol(currency) + p.whole + "." + p.cents
    }

    static func singular(_ code: String) -> String {
        switch code {
        case "EUR": return "euro"; case "USD": return "US dollar"; case "CNY": return "yuan"; case "MAD", "AED": return "dirham"
        case "GBP": return "pound"; case "JPY": return "yen"; case "SGD": return "Singapore dollar"; case "AUD": return "Australian dollar"
        case "PHP": return "peso"
        default: return code
        }
    }

    static func plural(_ code: String) -> String {
        switch code {
        case "EUR": return "euros"; case "USD": return "US dollars"; case "CNY": return "yuan"; case "MAD", "AED": return "dirhams"
        case "GBP": return "pounds"; case "JPY": return "yen"; case "SGD": return "Singapore dollars"; case "AUD": return "Australian dollars"
        case "PHP": return "pesos"
        default: return code
        }
    }

    /// "€200.00 at ₱70.67 to the euro"
    static func rate(native amount: Double, _ currency: String, base: Double) -> String? {
        guard currency != "PHP", amount > 0, base > 0 else { return nil }
        return "\(nativeExact(amount, currency)) at \(MoneyFormat.string(base / amount)) to the \(singular(currency))"
    }

    /// "0.8%", "<0.1%"
    static func percent(_ part: Double, of whole: Double) -> String {
        guard whole > 0 else { return "0%" }
        let p = part / whole * 100
        return p > 0 && p < 0.05 ? "<0.1%" : String(format: "%.1f%%", p)
    }
}

/// Everything the detail pane may need, as the page's queries returned it.
struct LedgerContext {
    let payments: [Payment]
    let spends: [Spend]
    let withdrawals: [Withdrawal]
    let ledger: [LedgerEntry]
    let wallets: [Wallet]
    let recurring: [Recurring]
    let projects: [Project]
    let clients: [Client]
    let steps: [PaymentStep]

    var walletMap: [UUID: Wallet] { Dictionary(wallets.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a }) }
    func wallet(_ id: UUID?) -> Wallet? { id.flatMap { i in wallets.first { $0.id == i } } }
    func project(_ id: UUID?) -> Project? { id.flatMap { i in projects.first { $0.id == i } } }
    /// The name the rest of the app shows for a client: the company when there is one, spaced as titles write it.
    func clientName(_ id: UUID?) -> String? {
        guard let c = id.flatMap({ i in clients.first { $0.id == i } }) else { return nil }
        return ClientName.display(c)
    }
}

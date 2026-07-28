import Charts
import SwiftData
import SwiftUI

// MARK: - Chart ink

/// **Chart colour is not the app palette.**
///
/// Palette v6 is a set of muted printerly inks — right for UI, and adjacent hues sit 4–6 ΔE apart,
/// where a categorical chart needs 15 before a full-colour reader can tell two series apart at a
/// glance. These are stepped for charts specifically and validated: lightness band, chroma floor,
/// colour-blind separation and contrast against the surface, in BOTH light and dark. Every series
/// also carries its name and figure as text, so identity is never colour alone.
enum ChartInk {
    /// Fixed order, never cycled. A seventh category folds into "Other" rather than inventing a hue.
    static let categorical: [Color] = [
        Color(hex: 0x2AAE70), // green
        Color(hex: 0xC08A1E), // amber
        Color(hex: 0x4880D8), // blue
        Color(hex: 0xAE5AA6), // plum
        Color(hex: 0xD65940), // coral
        Color(hex: 0x12A199), // teal
    ]
    static func slot(_ i: Int) -> Color { categorical[min(max(0, i), categorical.count - 1)] }

    /// Money in and money out. Two poles, so they read as opposites rather than as two categories.
    static let income = Color(hex: 0x2AAE70)
    static let outgo = Color(hex: 0xD65940)

    /// The same measure one period earlier. A peer series, not a ghost — a grey baseline fails the
    /// chroma floor and reads as "no data", so the prior period gets a validated second hue
    /// (green↔blue, ΔE 21.3 deutan) and a dashed stroke on top of that.
    static let prior = Color(hex: 0x4880D8)
    static let neutral = Color(hex: 0x8A8F98)
}

extension Color {
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: 1)
    }
}

/// Date formatters are expensive to build and were being made per label. One each, made once.
enum ChartLabel {
    static let monthShort = fixed("MMM")
    static let monthYear = fixed("MMM yyyy")
    static let dayMonth = fixed("d MMM")
    static let fullDate = fixed("d MMM yyyy")

    private static func fixed(_ format: String) -> DateFormatter {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.calendar = PHT.calendar
        f.timeZone = PHT.zone
        f.dateFormat = format
        return f
    }
}

// MARK: - Tracking window

/// How far back the records actually go, and which months are worth averaging.
///
/// This is the difference between a real average and a made-up one. Averaging "the last 12 months"
/// over a ledger that starts in April divides four months of income by twelve, which is not a
/// number about anything — and it was then used to colour the bars, so the colours meant nothing
/// either. Only **complete** months count: the first month is excluded when logging started
/// mid-month, and the current month is excluded because it hasn't finished.
struct TrackingWindow: Equatable {
    /// The earliest record of this kind, if there is one.
    var firstRecord: Date?
    /// The month that record falls in.
    var firstMonth: Date?
    /// True when logging started after the 1st, so that month is not a full month of data.
    var firstIsPartial = false
    /// Months that ran start to finish with logging in place — the only ones an average may use.
    var completeMonths: [Date] = []

    var hasAverage: Bool { !completeMonths.isEmpty }

    /// Says out loud what the average is made of. An average with no stated basis is a rumour.
    var basis: String {
        guard let first = completeMonths.first, let last = completeMonths.last else {
            if firstMonth != nil { return "no complete month yet" }
            return "nothing logged yet"
        }
        let span = first == last
            ? ChartLabel.monthShort.string(from: first)
            : "\(ChartLabel.monthShort.string(from: first))–\(ChartLabel.monthShort.string(from: last))"
        return "\(completeMonths.count) complete month\(completeMonths.count == 1 ? "" : "s") · \(span)"
    }

    static func of(_ dates: [Date], now: Date, cal: Calendar) -> TrackingWindow {
        var w = TrackingWindow()
        guard let first = dates.min() else { return w }
        w.firstRecord = first
        let firstMonth = PHT.startOfMonth(first)
        w.firstMonth = firstMonth
        w.firstIsPartial = cal.component(.day, from: first) > 1

        // Complete = every month from the first FULL month up to (but excluding) this one.
        let current = PHT.startOfMonth(now)
        var cursor = w.firstIsPartial
            ? (cal.date(byAdding: .month, value: 1, to: firstMonth) ?? current)
            : firstMonth
        var out: [Date] = []
        while cursor < current {
            out.append(cursor)
            guard let next = cal.date(byAdding: .month, value: 1, to: cursor) else { break }
            cursor = next
        }
        w.completeMonths = out
        return w
    }
}

// MARK: - The numbers, computed once

/// Everything every Insights card needs, worked out in a single pass.
///
/// The screen used to derive these as computed properties on the view — a dozen of them, each
/// walking the whole payment, project and allocation history, re-run on *every redraw*. Moving the
/// pointer over a chart changed one `@State` and paid for all of it again, which is why hovering
/// felt like wading. This is built once per data change and read from.
struct InsightsModel: Equatable {
    enum Scope: Int, CaseIterable {
        case month, year, lifetime

        var earnedLabel: String {
            switch self {
            case .month: return "Earned this month"
            case .year: return "Earned this year"
            case .lifetime: return "Earned · all time"
            }
        }
        var unit: String {
            switch self {
            case .month: return "month"
            case .year: return "year"
            case .lifetime: return "period"
            }
        }
    }

    // MARK: Row types

    struct MonthPoint: Identifiable, Equatable {
        var id: Date { month }
        let month: Date
        let income: Double
        let outgo: Double
        /// Partial months are never compared to an average and never coloured as good or bad.
        ///
        /// Income and spending were not necessarily logged from the same day, so they get a flag
        /// each. Sharing one flag marked May partial because *spending* started mid-May, and greyed
        /// out a month that was a complete month of income.
        let incomePartial: Bool
        let spendPartial: Bool
        let isCurrent: Bool
        var isPartial: Bool { incomePartial || spendPartial }
        var net: Double { income - outgo }
        var label: String { ChartLabel.monthShort.string(from: month) }
        var longLabel: String { ChartLabel.monthYear.string(from: month) }

        func qualifier(spending: Bool = false) -> String {
            if isCurrent { return "so far" }
            if spending ? spendPartial : incomePartial { return "partial — logging started mid-month" }
            return ""
        }
    }

    /// One step along a period — a day of the month, or a month of the year.
    struct StepPoint: Identifiable, Equatable {
        var id: Int { step }
        let step: Int
        let amount: Double   // this step alone
        let running: Double  // cumulative through this step
    }

    struct RankRow: Identifiable, Equatable {
        let id: String
        let name: String
        /// What the figure is made of — count, per-item average. Never an unlabelled number.
        let note: String
        let value: Double
        let share: Double
        let slot: Int
        /// Change against the comparable earlier window, when there is one to compare to.
        let delta: Double?
        let deltaNote: String
    }

    struct RouteRow: Identifiable, Equatable {
        let id: String
        let currency: String
        let kept: Double     // 0…1 of gross that survived the transfer
        let fee: Double
        let feeShare: Double // this currency's share of ALL fees paid — the ranked magnitude
        let count: Int
    }

    struct FeeRow: Identifiable, Equatable {
        let id: UUID
        let payer: String
        let date: Date
        let fee: Double
        let pct: Double
    }

    struct LatencyRow: Identifiable, Equatable {
        let id: String
        let name: String
        let days: Int
        let count: Int
    }

    struct QuarterRow: Identifiable, Equatable {
        let id: String
        let name: String
        let income: Double
        let outgo: Double
        let complete: Bool
        var net: Double { income - outgo }
    }

    // MARK: Scope figures

    var scope: Scope = .month
    var landed: Double = 0
    var fees: Double = 0
    var feePct: Double = 0
    var avgPayment: Double = 0
    var paymentCount: Int = 0
    var spentInScope: Double = 0
    var netInScope: Double { landed - spentInScope }

    /// Like-for-like: this period so far against the same number of days into the previous one.
    /// A month-to-date total compared against a whole finished month is not a comparison.
    var priorToDate: Double?
    var priorComplete: Double?
    var deltaPct: Double? {
        guard let p = priorToDate, p > 0 else { return nil }
        return (landed - p) / p
    }
    var deltaBasis: String {
        switch scope {
        case .month: return "vs last month by day \(stepCursor)"
        case .year: return "vs last year by \(ChartLabel.monthShort.string(from: PHT.startOfMonth()))"
        case .lifetime: return ""
        }
    }

    // MARK: Windows and averages

    var incomeWindow = TrackingWindow()
    var spendWindow = TrackingWindow()
    /// nil when there is not one complete month to average — better than a number that isn't one.
    var avgIncome: Double?
    var avgSpend: Double?
    var monthsTracked: Int = 0

    // MARK: Series

    /// Only months from the first record onward — never twelve slots with eight of them empty.
    var months: [MonthPoint] = []
    var bestMonth: MonthPoint?
    var worstMonth: MonthPoint?
    var quarters: [QuarterRow] = []
    /// All-time cumulative earnings, one point per month.
    var cumulative: [StepPoint] = []

    /// Cumulative income through the current period vs the one before, indexed by step.
    var incomeNow: [StepPoint] = []
    var incomePrior: [StepPoint] = []
    var spendNow: [StepPoint] = []
    var spendPrior: [StepPoint] = []

    var stepCount: Int = 1           // days in the month, or 12
    var stepCursor: Int = 1          // where "now" sits along it
    var stepUnit: String = "day"
    var projectedIncome: Double = 0  // run-rate to the end of the period
    var projectedSpend: Double = 0
    var canProject: Bool = false

    // MARK: Rankings

    var clients: [RankRow] = []
    var currencies: [RankRow] = []
    var routes: [RouteRow] = []
    var feeFreeRoutes: [String] = []
    var feeLeaders: [FeeRow] = []
    var latency: [LatencyRow] = []
    var latencyAverage: Int = 0
    var clientsEarning: Int = 0
    var clientsTotal: Int = 0
    var topClientShare: Double = 0
    var topClientName: String = ""
    var owedNow: Double = 0
    var owedProjects: Int = 0

    // MARK: Records (lifetime)

    var biggestPayment: (payer: String, amount: Double, date: Date)?
    var totalEarned: Double = 0
    var totalSpent: Double = 0

    // MARK: Spending

    var categories: [RankRow] = []
    var vendors: [RankRow] = []
    var spentThisMonth: Double = 0
    var spentLastMonth: Double = 0
    var spendCountThisMonth: Int = 0
    var investedThisMonth: Double = 0
    var monthlyCommitments: Double = 0
    var loansOut: Double = 0
    var biggestSpend: (name: String, amount: Double)?
    var busiestWeekday: (label: String, amount: Double, samples: Int)?
    var dailyAverage: Double = 0
    var daysLogged: Int = 0
    var daysElapsed: Int = 1

    static func == (a: InsightsModel, b: InsightsModel) -> Bool { a.stamp == b.stamp && a.scope == b.scope }
    var stamp: Int = 0

    // MARK: - Build

    static func build(scope: Scope, stamp: Int, now: Date = .now, rates: Rates,
                      payments: [Payment], withdrawals: [Withdrawal], spends: [Spend],
                      clients: [Client], projects: [Project], allocations: [PaymentAllocation],
                      recurring: [Recurring], loans: [Loan]) -> InsightsModel {
        var m = InsightsModel()
        m.scope = scope
        m.stamp = stamp
        let cal = PHT.calendar
        let currentMonth = PHT.startOfMonth(now)

        // ---- how far back the records actually go

        m.incomeWindow = TrackingWindow.of(payments.map(\.paidAt), now: now, cal: cal)
        m.spendWindow = TrackingWindow.of(spends.map(\.spentAt), now: now, cal: cal)
        let firstMonth = [m.incomeWindow.firstMonth, m.spendWindow.firstMonth].compactMap { $0 }.min()

        // ---- the window this tab is asking about

        let scopeStart: Date?
        switch scope {
        case .month: scopeStart = currentMonth
        case .year: scopeStart = PHT.startOfYear(now)
        case .lifetime: scopeStart = nil
        }

        let scoped = scopeStart.map { s in payments.filter { $0.paidAt >= s } } ?? payments
        let scopedWd = scopeStart.map { s in withdrawals.filter { $0.withdrawnAt >= s } } ?? withdrawals
        let scopedSpends = scopeStart.map { s in spends.filter { $0.spentAt >= s } } ?? spends

        m.landed = scoped.reduce(0) { $0 + ($1.netAmountBase ?? 0) }
        m.fees = scoped.filter { !$0.feeUnknown }.reduce(0) { $0 + ($1.impliedFeeBase ?? 0) }
            + scopedWd.reduce(0) { $0 + $1.feeBase }
        m.feePct = (m.landed + m.fees) > 0 ? m.fees / (m.landed + m.fees) : 0
        m.paymentCount = scoped.count
        m.avgPayment = scoped.isEmpty ? 0 : m.landed / Double(scoped.count)
        m.spentInScope = scopedSpends.reduce(0) { $0 + $1.amountBase }
        m.totalEarned = payments.reduce(0) { $0 + ($1.netAmountBase ?? 0) }
        m.totalSpent = spends.reduce(0) { $0 + $1.amountBase }

        // ---- month series, starting where the records start

        var seriesStart = firstMonth ?? currentMonth
        // Keep it readable on a long ledger, but never invent months before the first record.
        if let capped = cal.date(byAdding: .month, value: -17, to: currentMonth), seriesStart < capped {
            seriesStart = capped
        }
        var buckets: [Date: (inc: Double, out: Double)] = [:]
        var cursor = seriesStart
        while cursor <= currentMonth {
            buckets[cursor] = (0, 0)
            guard let next = cal.date(byAdding: .month, value: 1, to: cursor) else { break }
            cursor = next
        }
        for p in payments where p.paidAt >= seriesStart {
            buckets[PHT.startOfMonth(p.paidAt)]?.inc += p.netAmountBase ?? 0
        }
        for s in spends where s.spentAt >= seriesStart {
            buckets[PHT.startOfMonth(s.spentAt)]?.out += s.amountBase
        }
        // A month is partial for a series only if that series started mid-month, or if the series
        // has no record reaching back that far at all.
        func incomePartial(_ month: Date) -> Bool {
            guard let first = m.incomeWindow.firstMonth else { return true }
            if month < first { return true }
            return month == first && m.incomeWindow.firstIsPartial
        }
        func spendPartial(_ month: Date) -> Bool {
            guard let first = m.spendWindow.firstMonth else { return true }
            if month < first { return true }
            return month == first && m.spendWindow.firstIsPartial
        }
        m.months = buckets.keys.sorted().map { key in
            MonthPoint(month: key,
                       income: buckets[key]?.inc ?? 0,
                       outgo: buckets[key]?.out ?? 0,
                       incomePartial: incomePartial(key),
                       spendPartial: spendPartial(key),
                       isCurrent: key == currentMonth)
        }
        m.monthsTracked = m.months.count

        // Averages over COMPLETE months only. No complete month means no average, stated as such.
        let completeIncome = m.incomeWindow.completeMonths
        if !completeIncome.isEmpty {
            let total = completeIncome.reduce(0.0) { $0 + (buckets[$1]?.inc ?? 0) }
            m.avgIncome = total / Double(completeIncome.count)
        }
        let completeSpend = m.spendWindow.completeMonths
        if !completeSpend.isEmpty {
            let total = completeSpend.reduce(0.0) { $0 + (buckets[$1]?.out ?? 0) }
            m.avgSpend = total / Double(completeSpend.count)
        }
        let judged = m.months.filter { !$0.incomePartial && !$0.isCurrent }
        m.bestMonth = judged.max { $0.income < $1.income }
        m.worstMonth = judged.filter { $0.income > 0 }.min { $0.income < $1.income }

        // ---- all-time cumulative

        var running = 0.0
        m.cumulative = m.months.enumerated().map { i, p in
            running += p.income
            return StepPoint(step: i + 1, amount: p.income, running: running)
        }

        // ---- quarters of the current year

        let yearStart = PHT.startOfYear(now)
        let thisQuarter = (cal.component(.month, from: now) - 1) / 3
        m.quarters = (0..<4).map { q in
            let from = cal.date(byAdding: .month, value: q * 3, to: yearStart) ?? yearStart
            let to = cal.date(byAdding: .month, value: 3, to: from) ?? from
            let inc = payments.filter { $0.paidAt >= from && $0.paidAt < to }
                .reduce(0.0) { $0 + ($1.netAmountBase ?? 0) }
            let out = spends.filter { $0.spentAt >= from && $0.spentAt < to }
                .reduce(0.0) { $0 + $1.amountBase }
            return QuarterRow(id: "Q\(q + 1)", name: "Q\(q + 1)", income: inc, outgo: out,
                              complete: q < thisQuarter)
        }

        // ---- pace: this period against the same point in the last one

        switch scope {
        case .month, .lifetime:
            let start = currentMonth
            let days = cal.range(of: .day, in: .month, for: start)?.count ?? 30
            m.stepCount = days
            m.stepUnit = "day"
            m.stepCursor = cal.component(.day, from: now)
            let priorStart = cal.date(byAdding: .month, value: -1, to: start) ?? start
            let priorDays = cal.range(of: .day, in: .month, for: priorStart)?.count ?? days
            m.incomeNow = accumulate(payments, from: start, to: cal.date(byAdding: .month, value: 1, to: start) ?? now,
                                     steps: days, cal: cal, unit: .day,
                                     date: { $0.paidAt }, value: { $0.netAmountBase ?? 0 })
            m.incomePrior = accumulate(payments, from: priorStart, to: start, steps: priorDays,
                                       cal: cal, unit: .day,
                                       date: { $0.paidAt }, value: { $0.netAmountBase ?? 0 })
            m.spendNow = accumulate(spends, from: start, to: cal.date(byAdding: .month, value: 1, to: start) ?? now,
                                    steps: days, cal: cal, unit: .day,
                                    date: { $0.spentAt }, value: { $0.amountBase })
            m.spendPrior = accumulate(spends, from: priorStart, to: start, steps: priorDays,
                                      cal: cal, unit: .day,
                                      date: { $0.spentAt }, value: { $0.amountBase })
            // Only compare against a month that was actually being logged in full — and never on
            // the lifetime tab, where "the previous period" isn't a thing.
            if scope == .month, m.incomeWindow.completeMonths.contains(priorStart) {
                m.priorToDate = m.incomePrior.last { $0.step <= m.stepCursor }?.running
                m.priorComplete = m.incomePrior.last?.running
            }
        case .year:
            let start = yearStart
            m.stepCount = 12
            m.stepUnit = "month"
            m.stepCursor = cal.component(.month, from: now)
            let priorStart = cal.date(byAdding: .year, value: -1, to: start) ?? start
            m.incomeNow = accumulate(payments, from: start, to: cal.date(byAdding: .year, value: 1, to: start) ?? now,
                                     steps: 12, cal: cal, unit: .month,
                                     date: { $0.paidAt }, value: { $0.netAmountBase ?? 0 })
            m.incomePrior = accumulate(payments, from: priorStart, to: start, steps: 12, cal: cal, unit: .month,
                                       date: { $0.paidAt }, value: { $0.netAmountBase ?? 0 })
            m.spendNow = accumulate(spends, from: start, to: cal.date(byAdding: .year, value: 1, to: start) ?? now,
                                    steps: 12, cal: cal, unit: .month,
                                    date: { $0.spentAt }, value: { $0.amountBase })
            m.spendPrior = accumulate(spends, from: priorStart, to: start, steps: 12, cal: cal, unit: .month,
                                      date: { $0.spentAt }, value: { $0.amountBase })
            if let f = firstMonth, f <= priorStart {
                m.priorToDate = m.incomePrior.last { $0.step <= m.stepCursor }?.running
                m.priorComplete = m.incomePrior.last?.running
            }
        }

        // A projection needs enough of the period behind it to mean anything. Three days into a
        // month, multiplying by ten is a guess wearing a number's clothes.
        let elapsed = Double(max(1, m.stepCursor))
        let whole = Double(max(1, m.stepCount))
        m.canProject = elapsed / whole >= 0.2
        m.projectedIncome = (m.incomeNow.first { $0.step == m.stepCursor }?.running ?? 0) / elapsed * whole
        m.projectedSpend = (m.spendNow.first { $0.step == m.stepCursor }?.running ?? 0) / elapsed * whole

        // ---- who pays, in the scope on screen

        var byClient: [UUID: (total: Double, n: Int)] = [:]
        let projectClient = Dictionary(projects.map { ($0.id, $0.clientId) }, uniquingKeysWith: { a, _ in a })
        if scope == .lifetime {
            // Lifetime attributes through allocations — the only place part-paid projects are
            // apportioned correctly.
            for p in projects {
                guard let cid = p.clientId else { continue }
                let paid = ProjectMath.paidBase(project: p, allocations: allocations)
                guard paid > 0 else { continue }
                var e = byClient[cid] ?? (0, 0)
                e.total += paid; e.n += 1
                byClient[cid] = e
            }
        } else {
            for p in scoped {
                guard let pid = p.projectId, let cid = projectClient[pid] ?? nil else { continue }
                var e = byClient[cid] ?? (0, 0)
                e.total += p.netAmountBase ?? 0; e.n += 1
                byClient[cid] = e
            }
        }
        let clientName = Dictionary(clients.map { ($0.id, $0.name) }, uniquingKeysWith: { a, _ in a })
        let earners = byClient.filter { $0.value.total > 0 }
            .map { (id: $0.key, name: clientName[$0.key] ?? "Unknown", total: $0.value.total, n: $0.value.n) }
            .sorted { $0.total > $1.total }
        let clientGrand = earners.reduce(0) { $0 + $1.total }
        m.clients = earners.prefix(6).enumerated().map { i, e in
            let unitWord = scope == .lifetime ? "project" : "payment"
            return RankRow(id: e.id.uuidString, name: e.name,
                           note: "\(e.n) \(unitWord)\(e.n == 1 ? "" : "s") · avg \(CurrencyFormat.abbreviated(e.total / Double(max(1, e.n)), "PHP"))",
                           value: e.total,
                           share: clientGrand > 0 ? e.total / clientGrand : 0,
                           slot: i, delta: nil, deltaNote: "")
        }
        m.clientsEarning = earners.count
        m.clientsTotal = clients.count
        if let top = earners.first, clientGrand > 0 {
            m.topClientShare = top.total / clientGrand
            m.topClientName = top.name
        }

        // ---- money quoted but not yet paid

        for p in projects where p.status == .unpaid || p.status == .partiallyPaid {
            let quotedBase = rates.toBase(p.amount, p.currency)
            let paid = ProjectMath.paidBase(project: p, allocations: allocations)
            let left = quotedBase - paid
            if left > 0.5 { m.owedNow += left; m.owedProjects += 1 }
        }

        // ---- what currency it arrives in

        var byCurrency: [String: (net: Double, n: Int)] = [:]
        for p in scoped {
            var e = byCurrency[p.currency] ?? (0, 0)
            e.net += p.netAmountBase ?? 0
            e.n += 1
            byCurrency[p.currency] = e
        }
        let curGrand = byCurrency.values.reduce(0) { $0 + $1.net }
        m.currencies = byCurrency.filter { $0.value.net > 0 }
            .map { (code: $0.key, net: $0.value.net, n: $0.value.n) }
            .sorted { $0.net > $1.net }
            .prefix(6).enumerated().map { i, e in
                RankRow(id: e.code, name: e.code,
                        note: "\(e.n) payment\(e.n == 1 ? "" : "s") · avg \(CurrencyFormat.abbreviated(e.net / Double(max(1, e.n)), "PHP"))",
                        value: e.net, share: curGrand > 0 ? e.net / curGrand : 0,
                        slot: i, delta: nil, deltaNote: "")
            }

        // ---- the cost of each rail
        //
        // Ranked by what the fee actually costs. Rails that cost nothing are named in a line
        // rather than given a row with a full green bar and "−₱0" — three rows carrying no
        // information each is most of why this table looked broken.

        var byRoute: [String: (gross: Double, net: Double, fee: Double, n: Int)] = [:]
        for p in scoped where !p.feeUnknown {
            let net = p.netAmountBase ?? 0
            let gross = p.grossAtMarketBase ?? (net + (p.impliedFeeBase ?? 0))
            guard gross > 0 else { continue }
            var e = byRoute[p.currency] ?? (0, 0, 0, 0)
            e.gross += gross; e.net += net; e.fee += (p.impliedFeeBase ?? 0); e.n += 1
            byRoute[p.currency] = e
        }
        let feeGrand = byRoute.values.reduce(0) { $0 + $1.fee }
        m.routes = byRoute.filter { $0.value.fee > 0.005 }
            .map { key, v in
                RouteRow(id: key, currency: key,
                         kept: v.gross > 0 ? v.net / v.gross : 1,
                         fee: v.fee,
                         feeShare: feeGrand > 0 ? v.fee / feeGrand : 0,
                         count: v.n)
            }
            .sorted { $0.fee > $1.fee }
        m.feeFreeRoutes = byRoute.filter { $0.value.fee <= 0.005 }.keys.sorted()

        m.feeLeaders = scoped.filter { !$0.feeUnknown }
            .compactMap { p -> FeeRow? in
                guard let gross = p.grossAtMarketBase, gross > 0,
                      let fee = p.impliedFeeBase, fee > 0 else { return nil }
                let payer = p.projectId
                    .flatMap { projectClient[$0] ?? nil }
                    .flatMap { clientName[$0] } ?? "Payment"
                return FeeRow(id: p.id, payer: payer, date: p.paidAt, fee: fee, pct: fee / gross)
            }
            .sorted { $0.pct > $1.pct }
            .prefix(6).map { $0 }

        if let big = payments.max(by: { ($0.netAmountBase ?? 0) < ($1.netAmountBase ?? 0) }) {
            let payer = big.projectId
                .flatMap { projectClient[$0] ?? nil }
                .flatMap { clientName[$0] } ?? "Payment"
            m.biggestPayment = (payer, big.netAmountBase ?? 0, big.paidAt)
        }

        // ---- how long clients take (always lifetime — a month is not enough paid projects)

        let paymentsByProject = Dictionary(grouping: payments, by: { $0.projectId })
        var spanTotal = 0, spanCount = 0
        m.latency = clients.compactMap { c -> LatencyRow? in
            var spans: [Int] = []
            for p in projects where p.clientId == c.id && p.status == .paid {
                guard let last = paymentsByProject[p.id]?.map({ $0.paidAt }).max() else { continue }
                let days = cal.dateComponents([.day], from: p.quotedAt ?? p.createdAt, to: last).day ?? 0
                if days >= 0 { spans.append(days) }
            }
            guard !spans.isEmpty else { return nil }
            spanTotal += spans.reduce(0, +); spanCount += spans.count
            return LatencyRow(id: c.id.uuidString, name: c.name,
                              days: spans.reduce(0, +) / spans.count, count: spans.count)
        }
        .sorted { $0.days > $1.days }
        .prefix(6).map { $0 }
        m.latencyAverage = spanCount > 0 ? spanTotal / spanCount : 0

        // ---- spending detail, with last month beside it

        let lastMonthStart = cal.date(byAdding: .month, value: -1, to: currentMonth) ?? currentMonth
        let thisMonth = spends.filter { $0.spentAt >= currentMonth }
        let lastMonth = spends.filter { $0.spentAt >= lastMonthStart && $0.spentAt < currentMonth }
        m.spentThisMonth = thisMonth.reduce(0) { $0 + $1.amountBase }
        m.spentLastMonth = lastMonth.reduce(0) { $0 + $1.amountBase }
        m.spendCountThisMonth = thisMonth.count
        m.investedThisMonth = thisMonth.filter(\.isInvestment).reduce(0) { $0 + $1.amountBase }
        m.categories = rank(thisMonth, against: lastMonth) { $0.category ?? $0.tags.first ?? "Untagged" }
        m.vendors = rank(thisMonth.filter { !($0.vendorName ?? "").isEmpty },
                         against: lastMonth.filter { !($0.vendorName ?? "").isEmpty }) { $0.vendorName ?? "" }
        m.monthlyCommitments = recurring
            .filter { $0.active && $0.deletedAt == nil && $0.kind == .expense }
            .reduce(0) { $0 + $1.amountBase }
        m.loansOut = loans
            .filter { $0.deletedAt == nil && ($0.status == .open || $0.status == .partiallyReturned) }
            .reduce(0) { $0 + $1.outstandingBase }
        if let big = thisMonth.max(by: { $0.amountBase < $1.amountBase }) {
            m.biggestSpend = (big.spendDescription ?? big.vendorName ?? big.category ?? "Spend", big.amountBase)
        }
        m.daysLogged = Set(thisMonth.map { cal.startOfDay(for: $0.spentAt) }).count
        m.daysElapsed = cal.component(.day, from: now)
        m.dailyAverage = m.spentThisMonth / Double(max(1, m.daysElapsed))

        // Which weekday costs most — averaged over the days that weekday actually occurred inside
        // the tracking window, so a ledger that starts mid-April is not diluted by an empty March.
        if let from = m.spendWindow.firstRecord {
            var byWeekday: [Int: (sum: Double, days: Set<Date>)] = [:]
            for s in spends where s.spentAt >= from {
                let wd = cal.component(.weekday, from: s.spentAt)
                var e = byWeekday[wd] ?? (0, [])
                e.sum += s.amountBase
                e.days.insert(cal.startOfDay(for: s.spentAt))
                byWeekday[wd] = e
            }
            if let worst = byWeekday.max(by: { a, b in
                (a.value.sum / Double(max(1, a.value.days.count))) < (b.value.sum / Double(max(1, b.value.days.count)))
            }), worst.value.days.count >= 2 {
                m.busiestWeekday = (cal.weekdaySymbols[worst.key - 1],
                                    worst.value.sum / Double(max(1, worst.value.days.count)),
                                    worst.value.days.count)
            }
        }
        return m
    }

    /// Running total across a period, one entry per step, gaps included.
    private static func accumulate<T>(_ items: [T], from start: Date, to end: Date, steps: Int,
                                      cal: Calendar, unit: Calendar.Component,
                                      date: (T) -> Date, value: (T) -> Double) -> [StepPoint] {
        guard steps > 0 else { return [] }
        var perStep = [Double](repeating: 0, count: steps)
        for item in items {
            let d = date(item)
            guard d >= start, d < end else { continue }
            let idx = (unit == .day ? cal.component(.day, from: d) : cal.component(.month, from: d)) - 1
            guard idx >= 0, idx < steps else { continue }
            perStep[idx] += value(item)
        }
        var running = 0.0
        return (0..<steps).map { i in
            running += perStep[i]
            return StepPoint(step: i + 1, amount: perStep[i], running: running)
        }
    }

    /// Top six by value with the count, the per-item average and the change on last month.
    /// Every figure says what it is made of — a bare number in a table is not an insight.
    private static func rank(_ spends: [Spend], against prior: [Spend],
                             by key: (Spend) -> String) -> [RankRow] {
        var totals: [String: (sum: Double, n: Int)] = [:]
        for s in spends {
            var e = totals[key(s)] ?? (0, 0)
            e.sum += s.amountBase; e.n += 1
            totals[key(s)] = e
        }
        var priorTotals: [String: Double] = [:]
        for s in prior { priorTotals[key(s), default: 0] += s.amountBase }

        let all = totals.map { (name: $0.key, sum: $0.value.sum, n: $0.value.n) }.sorted { $0.sum > $1.sum }
        let grand = all.reduce(0) { $0 + $1.sum }
        guard grand > 0 else { return [] }

        func row(_ name: String, _ sum: Double, _ n: Int, _ slot: Int, _ note: String) -> RankRow {
            let was = priorTotals[name]
            let delta: Double? = (was ?? 0) > 0 ? (sum - was!) / was! : nil
            let deltaNote: String
            if let was, was > 0 {
                deltaNote = "was \(CurrencyFormat.abbreviated(was, "PHP")) last month"
            } else {
                deltaNote = "new this month"
            }
            return RankRow(id: name, name: name, note: note, value: sum,
                           share: sum / grand, slot: slot, delta: delta, deltaNote: deltaNote)
        }

        var rows = all.prefix(6).enumerated().map { i, e in
            row(e.name, e.sum, e.n,  i,
                "\(e.n) purchase\(e.n == 1 ? "" : "s") · avg \(CurrencyFormat.abbreviated(e.sum / Double(max(1, e.n)), "PHP"))")
        }
        let restRows = all.dropFirst(6)
        let rest = restRows.reduce(0) { $0 + $1.sum }
        if rest > 0 {
            rows.append(RankRow(id: "__other", name: "Everything else",
                                note: "\(restRows.count) more, \(restRows.reduce(0) { $0 + $1.n }) purchases",
                                value: rest, share: rest / grand, slot: 5, delta: nil, deltaNote: ""))
        }
        return rows
    }
}

// MARK: - Hit-testing

/// Where the pointer actually is on a chart.
///
/// The bug this replaces: the trend chart picked the month whose *start* was nearest the pointer.
/// A bar is a whole month wide, so from the 16th onward the next month's start is closer — hovering
/// the right half of June highlighted July, and every bar was wrong over more than half its width.
/// This maps the pointer to the band it is inside, which cannot be off by one.
enum ChartHit {
    static func month(atX x: CGFloat, proxy: ChartProxy, in months: [Date]) -> Date? {
        guard !months.isEmpty else { return nil }
        guard let raw = proxy.value(atX: x, as: Date.self) else { return nil }
        let band = PHT.startOfMonth(raw)
        if months.contains(band) { return band }
        if let first = months.first, band < first { return first }
        return months.last
    }

    static func step(atX x: CGFloat, proxy: ChartProxy, upTo count: Int) -> Int? {
        guard count > 0, let raw = proxy.value(atX: x, as: Double.self) else { return nil }
        return min(count, max(1, Int(raw.rounded())))
    }
}

// MARK: - Cursor overlays

/// The readout that follows the pointer. Deliberately a card, not an axis label: it names the
/// period, so a chart can never be read against the wrong month.
struct ChartTip<Content: View>: View {
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 3) { content() }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(Palette.card)
                    .shadow(color: .black.opacity(0.22), radius: 10, y: 3))
            .overlay(
                RoundedRectangle(cornerRadius: 8, style: .continuous).stroke(Palette.hairline, lineWidth: 1))
            .fixedSize()
    }
}

/// One row of a tooltip: a colour chip, a name, a figure. The chip is never the only cue.
struct ChartTipRow: View {
    var color: Color?
    var name: String
    var value: String
    var emphasise = false

    var body: some View {
        HStack(spacing: 7) {
            if let color {
                RoundedRectangle(cornerRadius: 2).fill(color).frame(width: 8, height: 8)
            }
            Text(name).font(.system(size: 10.5)).foregroundStyle(Palette.textTertiary)
            Spacer(minLength: 14)
            Text(value)
                .font(Typo.rowFigure(11.5, emphasise ? .bold : .semibold))
                .foregroundStyle(Palette.textPrimary)
        }
    }
}

/// Pointer tracking for a month-banded chart.
///
/// Two things here stop the flicker. The readout is `allowsHitTesting(false)` — without it the card
/// slides under the pointer, the plot stops receiving hover, the card disappears, and the whole
/// thing loops several times a second. And the marks themselves never change on hover: the guide
/// and the readout live in this overlay, so tracking a chart redraws two shapes rather than
/// re-rendering every bar with a new opacity.
private struct MonthCursor<Tip: View>: View {
    let proxy: ChartProxy
    let months: [Date]
    @Binding var hover: Date?
    var tip: (Date) -> Tip
    @State private var tipSize: CGSize = .zero

    var body: some View {
        GeometryReader { geo in
            let plot = proxy.plotFrame.map { geo[$0] }
            ZStack(alignment: .topLeading) {
                Rectangle().fill(.clear).contentShape(Rectangle())
                    .onContinuousHover { phase in
                        switch phase {
                        case .active(let pt):
                            guard let f = plot else { return }
                            let next = ChartHit.month(atX: pt.x - f.origin.x, proxy: proxy, in: months)
                            if next != hover { hover = next }
                        case .ended:
                            hover = nil
                        }
                    }
                if let month = hover, let f = plot, let x0 = proxy.position(forX: month) {
                    let band = f.width / CGFloat(max(1, months.count))
                    let cx = f.origin.x + x0 + band / 2
                    ZStack(alignment: .topLeading) {
                        // No highlight block behind the bar. A translucent slab the width of a
                        // month is a grey rectangle sitting on the chart — the readout names the
                        // month, which is the whole job, and it does it without painting anything.
                        tip(month)
                            .background(GeometryReader { g in
                                Color.clear.onAppear { tipSize = g.size }
                                    .onChange(of: g.size) { _, n in tipSize = n }
                            })
                            .position(x: clampX(cx, width: geo.size.width),
                                      y: f.minY + tipSize.height / 2 + 2)
                    }
                    .allowsHitTesting(false)
                }
            }
        }
    }

    private func clampX(_ x: CGFloat, width: CGFloat) -> CGFloat {
        let half = tipSize.width / 2 + 4
        return min(max(x, half), max(half, width - half))
    }
}

/// The same, for a chart whose x is a step number (day of month, month of year).
private struct StepCursor<Tip: View>: View {
    let proxy: ChartProxy
    let count: Int
    @Binding var hover: Int?
    var tip: (Int) -> Tip
    @State private var tipSize: CGSize = .zero

    var body: some View {
        GeometryReader { geo in
            let plot = proxy.plotFrame.map { geo[$0] }
            ZStack(alignment: .topLeading) {
                Rectangle().fill(.clear).contentShape(Rectangle())
                    .onContinuousHover { phase in
                        switch phase {
                        case .active(let pt):
                            guard let f = plot else { return }
                            let next = ChartHit.step(atX: pt.x - f.origin.x, proxy: proxy, upTo: count)
                            if next != hover { hover = next }
                        case .ended:
                            hover = nil
                        }
                    }
                if let step = hover, let f = plot, let x0 = proxy.position(forX: Double(step)) {
                    let cx = f.origin.x + x0
                    ZStack(alignment: .topLeading) {
                        Rectangle().fill(Palette.textPrimary.opacity(0.28))
                            .frame(width: 1, height: f.height)
                            .position(x: cx, y: f.minY + f.height / 2)
                        tip(step)
                            .background(GeometryReader { g in
                                Color.clear.onAppear { tipSize = g.size }
                                    .onChange(of: g.size) { _, n in tipSize = n }
                            })
                            .position(x: clampX(cx, width: geo.size.width),
                                      y: f.minY + tipSize.height / 2 + 2)
                    }
                    .allowsHitTesting(false)
                }
            }
        }
    }

    private func clampX(_ x: CGFloat, width: CGFloat) -> CGFloat {
        let half = tipSize.width / 2 + 4
        return min(max(x, half), max(half, width - half))
    }
}

extension View {
    func monthCursor<Tip: View>(_ months: [Date], hover: Binding<Date?>,
                                @ViewBuilder tip: @escaping (Date) -> Tip) -> some View {
        chartOverlay { proxy in
            MonthCursor(proxy: proxy, months: months, hover: hover, tip: tip)
        }
    }

    func stepCursor<Tip: View>(_ count: Int, hover: Binding<Int?>,
                               @ViewBuilder tip: @escaping (Int) -> Tip) -> some View {
        chartOverlay { proxy in
            StepCursor(proxy: proxy, count: count, hover: hover, tip: tip)
        }
    }
}

// MARK: - Shared card pieces

/// A ranked row with a magnitude bar, a stated basis, and the change on the comparable period.
/// One shape for every leaderboard on the screen — five tables each inventing their own row was
/// most of why the page looked unfinished, and none of them said what their number was made of.
struct RankBar: View {
    var index: Int
    var name: String
    var note: String = ""
    var value: String
    var share: Double
    var color: Color
    var trailing: String? = nil
    var delta: Double? = nil
    var deltaNote: String = ""
    @State private var hover = false

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Text("\(index + 1)")
                .font(Typo.rowFigure(11)).monospacedDigit()
                .foregroundStyle(Palette.textTertiary)
                .frame(width: 16, alignment: .center)
                .padding(.top, 1)
            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 8) {
                    RoundedRectangle(cornerRadius: 2).fill(color).frame(width: 8, height: 8)
                    Text(name)
                        .font(.system(size: 12.5, weight: .medium))
                        .foregroundStyle(Palette.textPrimary).lineLimit(1)
                    Spacer(minLength: 8)
                    if let trailing {
                        Text(trailing).font(.system(size: 10.5)).foregroundStyle(Palette.textTertiary)
                    }
                    Text(value)
                        .font(Typo.rowFigure(12.5))
                        .foregroundStyle(Palette.textPrimary)
                }
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Palette.wellFill)
                        Capsule().fill(color)
                            .frame(width: max(3, geo.size.width * min(1, max(0, share))))
                    }
                }
                .frame(height: 4)
                if !note.isEmpty || !deltaNote.isEmpty {
                    HStack(spacing: 8) {
                        if !note.isEmpty {
                            Text(note).font(.system(size: 10)).foregroundStyle(Palette.textTertiary)
                                .lineLimit(1)
                        }
                        Spacer(minLength: 4)
                        if let delta {
                            Text(String(format: "%+.0f%%", delta * 100))
                                .font(Typo.rowFigure(10))
                                .foregroundStyle(delta > 0 ? Palette.negative : Palette.positive)
                        }
                        if !deltaNote.isEmpty {
                            Text(deltaNote).font(.system(size: 10))
                                .foregroundStyle(Palette.textTertiary).lineLimit(1)
                        }
                    }
                }
            }
        }
        .padding(.horizontal, 10).padding(.vertical, 8)
        .background(
            RoundedRectangle(cornerRadius: Radii.row, style: .continuous)
                .fill(hover ? Palette.wellFillHover : Color.clear))
        .onHover { hover = $0 }
    }
}

/// A figure with a label and a note. Four of these in a row is a better answer than a chart of
/// four numbers.
struct StatCell: View {
    var label: String
    var value: String
    var note: String
    var tone: Color = Palette.textPrimary

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label.uppercased())
                .font(.system(size: 9, weight: .semibold)).tracking(0.6)
                .foregroundStyle(Palette.textTertiary)
            Text(value).font(Typo.rowFigure(16)).foregroundStyle(tone).lineLimit(1).minimumScaleFactor(0.7)
            Text(note).font(.system(size: 10)).foregroundStyle(Palette.textTertiary)
                .lineLimit(2).fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct StatRow<Content: View>: View {
    @ViewBuilder var content: () -> Content
    var body: some View {
        HStack(alignment: .top, spacing: 0) { content() }
    }
}

struct StatDivider: View {
    var body: some View {
        Rectangle().fill(Palette.hairline).frame(width: 1, height: 48).padding(.horizontal, 14)
    }
}

/// A key. Present whenever a chart carries more than one series — identity never rests on colour
/// alone.
struct ChartLegend: View {
    var items: [(name: String, color: Color)]

    var body: some View {
        HStack(spacing: 12) {
            ForEach(items, id: \.name) { item in
                HStack(spacing: 5) {
                    RoundedRectangle(cornerRadius: 2).fill(item.color).frame(width: 9, height: 9)
                    Text(item.name).font(.system(size: 11)).foregroundStyle(Palette.textTertiary)
                }
            }
        }
    }
}

/// The line under a chart title that says how a figure was worked out. Every average on this
/// screen carries one — an average without a stated basis is a rumour.
struct BasisNote: View {
    var text: String

    var body: some View {
        Text(text)
            .font(.system(size: 11)).foregroundStyle(Palette.textTertiary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// Two balanced columns.
///
/// `LazyVGrid` sizes every row to its tallest card, so a six-row table beside a two-row one left a
/// hole the height of four rows — the dead space all over this page. This deals the cards into two
/// running columns instead, so neither side runs long.
struct BalancedColumns: View {
    var cards: [(height: Int, view: AnyView)]
    var spacing: CGFloat = 20

    private var split: (left: [Int], right: [Int]) {
        var left: [Int] = [], right: [Int] = []
        var lh = 0, rh = 0
        for (i, c) in cards.enumerated() {
            if lh <= rh { left.append(i); lh += c.height } else { right.append(i); rh += c.height }
        }
        return (left, right)
    }

    var body: some View {
        let s = split
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .top, spacing: spacing) {
                column(s.left)
                column(s.right)
            }
            VStack(spacing: spacing) {
                ForEach(cards.indices, id: \.self) { i in cards[i].view }
            }
        }
    }

    private func column(_ indices: [Int]) -> some View {
        VStack(spacing: spacing) {
            ForEach(indices, id: \.self) { i in cards[i].view }
        }
        .frame(minWidth: 320, maxWidth: .infinity, alignment: .top)
    }
}

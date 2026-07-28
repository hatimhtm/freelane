import Charts
import SwiftData
import SwiftUI

/// The spending half of Insights.
///
/// Insights only ever showed income — what landed, from whom, through which rail. That answers
/// half of "how am I doing": you can earn well and still be going backwards. These cards are the
/// other half, and the one that matters most is `inOutCard`, because nothing else on the screen
/// tells you whether a month ended up or down.
///
/// **Chart colour is not the app palette.** Palette v6 is a set of muted printerly inks — lovely
/// for UI, and adjacent hues sit 4–6 ΔE apart, where a categorical chart needs 15 before a
/// full-colour reader can tell two series apart at a glance. `ChartInk` below is stepped for charts
/// specifically and validated: lightness band, chroma floor, colour-blind separation and contrast,
/// in BOTH light and dark. Every category also carries its name and figure as text, so identity is
/// never colour alone.
enum ChartInk {
    /// Fixed order, never cycled. A ninth category folds into "Other" rather than inventing a hue.
    static let categorical: [Color] = [
        Color(hex: 0x2AAE70), // green
        Color(hex: 0xC08A1E), // amber
        Color(hex: 0x4880D8), // blue
        Color(hex: 0xAE5AA6), // plum
        Color(hex: 0xD65940), // coral
        Color(hex: 0x12A199), // teal
    ]
    static func slot(_ i: Int) -> Color { categorical[min(i, categorical.count - 1)] }

    /// Money in and money out. Two poles, so they read as opposites rather than as two categories.
    static let income = Color(hex: 0x2AAE70)
    static let outgo = Color(hex: 0xD65940)
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

// MARK: - The numbers, computed once

/// Everything the spending cards need, worked out in one pass.
///
/// The old view recomputed a dozen derived properties on every redraw — every hover, every window
/// resize — each one walking the whole payment and spend history. That is why it felt slow. This is
/// built once per data change and read from.
struct SpendingInsights {
    struct MonthPoint: Identifiable {
        let id = UUID()
        let month: Date
        let income: Double
        let outgo: Double
        var net: Double { income - outgo }
    }
    struct Slice: Identifiable {
        let id = UUID()
        let name: String
        let total: Double
        let share: Double
        let colorIndex: Int
    }

    var months: [MonthPoint] = []
    var categories: [Slice] = []
    var vendors: [Slice] = []
    var spentThisMonth: Double = 0
    var earnedThisMonth: Double = 0
    var everydayThisMonth: Double = 0
    var investedThisMonth: Double = 0
    var monthlyCommitments: Double = 0
    var loansOut: Double = 0
    var biggestSingle: (name: String, amount: Double)?
    var busiestDay: (label: String, amount: Double)?

    static func build(spends: [Spend], payments: [Payment], recurring: [Recurring],
                      loans: [Loan], monthsBack: Int) -> SpendingInsights {
        var out = SpendingInsights()
        let cal = PHT.calendar
        let now = Date()
        guard let windowStart = cal.date(byAdding: .month, value: -(monthsBack - 1), to: PHT.startOfMonth(now))
        else { return out }

        // One bucket per month, so a month with no activity still shows as a gap rather than
        // silently closing up and making the trend look denser than it is.
        var buckets: [Date: (inc: Double, out: Double)] = [:]
        for offset in 0..<monthsBack {
            if let m = cal.date(byAdding: .month, value: offset, to: windowStart) {
                buckets[PHT.startOfMonth(m)] = (0, 0)
            }
        }
        for p in payments where p.paidAt >= windowStart {
            let k = PHT.startOfMonth(p.paidAt)
            buckets[k]?.inc += p.netAmountBase ?? 0
        }
        for s in spends where s.spentAt >= windowStart {
            let k = PHT.startOfMonth(s.spentAt)
            buckets[k]?.out += s.amountBase
        }
        out.months = buckets.keys.sorted().map {
            MonthPoint(month: $0, income: buckets[$0]?.inc ?? 0, outgo: buckets[$0]?.out ?? 0)
        }

        let monthStart = PHT.startOfMonth(now)
        let thisMonth = spends.filter { $0.spentAt >= monthStart }
        out.spentThisMonth = thisMonth.reduce(0) { $0 + $1.amountBase }
        out.investedThisMonth = thisMonth.filter(\.isInvestment).reduce(0) { $0 + $1.amountBase }
        out.everydayThisMonth = out.spentThisMonth - out.investedThisMonth
        out.earnedThisMonth = payments.filter { $0.paidAt >= monthStart }
            .reduce(0) { $0 + ($1.netAmountBase ?? 0) }

        out.categories = rank(thisMonth) { $0.category ?? $0.tags.first ?? "Untagged" }
        out.vendors = rank(thisMonth.filter { !($0.vendorName ?? "").isEmpty }) { $0.vendorName ?? "" }

        out.monthlyCommitments = recurring
            .filter { $0.active && $0.deletedAt == nil && $0.kind == .expense }
            .reduce(0) { $0 + $1.amountBase }
        out.loansOut = loans
            .filter { $0.deletedAt == nil && ($0.status == .open || $0.status == .partiallyReturned) }
            .reduce(0) { $0 + $1.outstandingBase }

        if let big = thisMonth.max(by: { $0.amountBase < $1.amountBase }) {
            out.biggestSingle = (big.spendDescription ?? big.vendorName ?? big.category ?? "Spend",
                                 big.amountBase)
        }

        // Which weekday costs most — an average, not a total, or the answer is just "the day you
        // happened to pay rent".
        var byWeekday: [Int: (sum: Double, days: Set<Date>)] = [:]
        for s in spends where s.spentAt >= windowStart {
            let wd = cal.component(.weekday, from: s.spentAt)
            var e = byWeekday[wd] ?? (0, [])
            e.sum += s.amountBase
            e.days.insert(cal.startOfDay(for: s.spentAt))
            byWeekday[wd] = e
        }
        if let worst = byWeekday.max(by: { a, b in
            (a.value.sum / Double(max(1, a.value.days.count))) < (b.value.sum / Double(max(1, b.value.days.count)))
        }) {
            let avg = worst.value.sum / Double(max(1, worst.value.days.count))
            out.busiestDay = (cal.weekdaySymbols[worst.key - 1], avg)
        }
        return out
    }

    /// Top six by value, everything else folded into "Other" — never a seventh invented hue.
    private static func rank(_ spends: [Spend], by key: (Spend) -> String) -> [Slice] {
        var totals: [String: Double] = [:]
        for s in spends { totals[key(s), default: 0] += s.amountBase }
        let all = totals.map { (name: $0.key, total: $0.value) }.sorted { $0.total > $1.total }
        let grand = all.reduce(0) { $0 + $1.total }
        guard grand > 0 else { return [] }

        var slices = all.prefix(6).enumerated().map { i, e in
            Slice(name: e.name, total: e.total, share: e.total / grand, colorIndex: i)
        }
        let rest = all.dropFirst(6).reduce(0) { $0 + $1.total }
        if rest > 0 {
            slices.append(Slice(name: "Other", total: rest, share: rest / grand, colorIndex: 5))
        }
        return slices
    }
}

// MARK: - The cards

struct SpendingInsightCards: View {
    let data: SpendingInsights
    let base: String

    @State private var hoverMonth: Date?
    @State private var hoverCategory: String?

    var body: some View {
        inOutCard
        categoriesCard
        vendorsCard
        commitmentsCard
    }

    // MARK: In vs out

    /// The one chart that answers "did this month end up or down".
    ///
    /// Two series on ONE axis — never a second y-scale, which would let any pair of shapes be made
    /// to look correlated. Income and outgo are opposite poles rather than two categories, so they
    /// take the diverging pair, and the net line beneath states the answer in words for the month
    /// under the cursor.
    private var inOutCard: some View {
        SectionCard(title: "In and out", subtitle: "Net landed against everything spent · last 12 months",
                    accent: Palette.azure,
                    trailing: AnyView(legend)) {
            if data.months.allSatisfy({ $0.income == 0 && $0.outgo == 0 }) {
                Text("Nothing to compare yet.").font(.system(size: 12)).foregroundStyle(Palette.textTertiary)
            } else {
                let focus = data.months.first { point in
                    guard let h = hoverMonth else { return false }
                    return PHT.calendar.isDate(point.month, equalTo: h, toGranularity: .month)
                } ?? data.months.last

                HStack(spacing: 10) {
                    if let f = focus {
                        Text(f.month.formatted(.dateTime.month(.abbreviated).year()))
                            .font(.system(size: 12, weight: .medium)).foregroundStyle(Palette.textSecondary)
                        Text(f.net >= 0
                             ? "up " + CurrencyFormat.string(f.net, base)
                             : "down " + CurrencyFormat.string(abs(f.net), base))
                            .font(Typo.rowFigure(13))
                            .foregroundStyle(f.net >= 0 ? ChartInk.income : ChartInk.outgo)
                    }
                    Spacer()
                }

                Chart {
                    ForEach(data.months) { m in
                        BarMark(x: .value("Month", m.month, unit: .month),
                                y: .value("In", m.income),
                                width: .fixed(9))
                            .position(by: .value("Kind", "In"), axis: .horizontal, span: .ratio(0.9))
                            .foregroundStyle(ChartInk.income)
                            .cornerRadius(3)
                        BarMark(x: .value("Month", m.month, unit: .month),
                                y: .value("Out", m.outgo),
                                width: .fixed(9))
                            .position(by: .value("Kind", "Out"), axis: .horizontal, span: .ratio(0.9))
                            .foregroundStyle(ChartInk.outgo)
                            .cornerRadius(3)
                    }
                    if let f = focus {
                        RuleMark(x: .value("Month", f.month, unit: .month))
                            .foregroundStyle(Palette.hairline)
                            .lineStyle(StrokeStyle(lineWidth: 1))
                            .zIndex(-1)
                    }
                }
                .chartXAxis { AxisMarks(values: .stride(by: .month, count: 2)) { v in
                    AxisValueLabel(format: .dateTime.month(.narrow))
                        .font(.system(size: 9)).foregroundStyle(Palette.textTertiary)
                } }
                .chartYAxis { AxisMarks(position: .leading) { v in
                    AxisGridLine().foregroundStyle(Palette.hairline)
                    AxisValueLabel {
                        if let d = v.as(Double.self) {
                            Text(CurrencyFormat.abbreviated(d, base))
                                .font(.system(size: 9)).foregroundStyle(Palette.textTertiary)
                        }
                    }
                } }
                .chartOverlay { proxy in
                    GeometryReader { geo in
                        Rectangle().fill(.clear).contentShape(Rectangle())
                            .onContinuousHover { phase in
                                switch phase {
                                case .active(let pt):
                                    guard let plot = proxy.plotFrame else { return }
                                    let x = pt.x - geo[plot].origin.x
                                    hoverMonth = proxy.value(atX: x, as: Date.self)
                                case .ended:
                                    hoverMonth = nil
                                }
                            }
                    }
                }
                .frame(height: 190)
            }
        }
    }

    /// Two series, so a legend is always present — identity never rests on colour alone.
    private var legend: AnyView {
        AnyView(HStack(spacing: 12) {
            ForEach([("In", ChartInk.income), ("Out", ChartInk.outgo)], id: \.0) { name, colour in
                HStack(spacing: 5) {
                    RoundedRectangle(cornerRadius: 2).fill(colour).frame(width: 9, height: 9)
                    Text(name).font(.system(size: 11)).foregroundStyle(Palette.textTertiary)
                }
            }
        })
    }

    // MARK: Where it goes

    private var categoriesCard: some View {
        SectionCard(title: "Where it goes", subtitle: "This month by tag", accent: Palette.violet,
                    trailing: AnyView(
                        Text(CurrencyFormat.string(data.spentThisMonth, base))
                            .font(Typo.rowFigure(12)).foregroundStyle(Palette.textSecondary))) {
            if data.categories.isEmpty {
                Text("Nothing logged this month.").font(.system(size: 12)).foregroundStyle(Palette.textTertiary)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(data.categories.enumerated()), id: \.element.id) { _, slice in
                        let hot = hoverCategory == slice.name
                        HStack(spacing: 12) {
                            RoundedRectangle(cornerRadius: 2)
                                .fill(ChartInk.slot(slice.colorIndex))
                                .frame(width: 9, height: 9)
                            Text(slice.name)
                                .font(.system(size: 12.5, weight: hot ? .semibold : .regular))
                                .foregroundStyle(Palette.textPrimary)
                                .frame(width: 120, alignment: .leading).lineLimit(1)
                            GeometryReader { geo in
                                ZStack(alignment: .leading) {
                                    Capsule().fill(Palette.wellFill).frame(height: 7)
                                    Capsule().fill(ChartInk.slot(slice.colorIndex))
                                        .frame(width: max(3, geo.size.width * slice.share), height: 7)
                                }
                                .frame(maxHeight: .infinity, alignment: .center)
                            }
                            .frame(height: 16)
                            Text("\(Int((slice.share * 100).rounded()))%")
                                .font(.system(size: 11)).foregroundStyle(Palette.textTertiary)
                                .frame(width: 36, alignment: .trailing)
                            Text(CurrencyFormat.string(slice.total, base))
                                .font(Typo.rowFigure(12)).foregroundStyle(Palette.textSecondary)
                                .frame(width: 92, alignment: .trailing)
                        }
                        .padding(.vertical, 7)
                        .background(hot ? Palette.wellFillHover : .clear)
                        .onHover { hoverCategory = $0 ? slice.name : nil }
                    }
                }

                if data.investedThisMonth > 0 {
                    Divider().overlay(Palette.hairline).padding(.vertical, 8)
                    HStack {
                        Text("Of that, investment — gear, home, things that last")
                            .font(.system(size: 11)).foregroundStyle(Palette.textTertiary)
                        Spacer()
                        Text(CurrencyFormat.string(data.investedThisMonth, base))
                            .font(Typo.rowFigure(12)).foregroundStyle(Palette.textSecondary)
                    }
                }
            }
        }
    }

    // MARK: Who you pay

    private var vendorsCard: some View {
        SectionCard(title: "Who you pay", subtitle: "This month by vendor", accent: Palette.cyan) {
            if data.vendors.isEmpty {
                Text("No vendors recorded this month.").font(.system(size: 12)).foregroundStyle(Palette.textTertiary)
            } else {
                VStack(spacing: 0) {
                    ForEach(data.vendors) { v in
                        HStack(spacing: 12) {
                            Text(v.name).font(.system(size: 12.5)).foregroundStyle(Palette.textPrimary)
                                .frame(width: 150, alignment: .leading).lineLimit(1)
                            GeometryReader { geo in
                                ZStack(alignment: .leading) {
                                    Capsule().fill(Palette.wellFill).frame(height: 7)
                                    // One hue here: these are ranked magnitudes of the same thing,
                                    // not different kinds of thing.
                                    Capsule().fill(ChartInk.slot(2).opacity(0.85))
                                        .frame(width: max(3, geo.size.width * v.share), height: 7)
                                }
                                .frame(maxHeight: .infinity, alignment: .center)
                            }
                            .frame(height: 16)
                            Text(CurrencyFormat.string(v.total, base))
                                .font(Typo.rowFigure(12)).foregroundStyle(Palette.textSecondary)
                                .frame(width: 92, alignment: .trailing)
                        }
                        .padding(.vertical, 7)
                    }
                }
            }
        }
    }

    // MARK: What is already spoken for

    /// Not a chart. Four numbers, and a chart of four numbers is decoration.
    private var commitmentsCard: some View {
        SectionCard(title: "Already spoken for", subtitle: "What leaves before you decide anything",
                    accent: Palette.warning) {
            HStack(spacing: 0) {
                stat("Every month", CurrencyFormat.string(data.monthlyCommitments, base),
                     "rent, wifi, water, power")
                divider
                stat("Owed to you", CurrencyFormat.string(data.loansOut, base), "lent and not back yet")
                divider
                stat("Biggest this month",
                     data.biggestSingle.map { CurrencyFormat.string($0.amount, base) } ?? "—",
                     data.biggestSingle?.name ?? "nothing logged")
                divider
                stat("Priciest day",
                     data.busiestDay.map { CurrencyFormat.string($0.amount, base) } ?? "—",
                     data.busiestDay.map { "\($0.label)s, on average" } ?? "not enough data")
            }
        }
    }

    private var divider: some View {
        Rectangle().fill(Palette.hairline).frame(width: 1, height: 44).padding(.horizontal, 14)
    }

    private func stat(_ label: String, _ value: String, _ note: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label.uppercased())
                .font(.system(size: 9, weight: .semibold)).tracking(0.6)
                .foregroundStyle(Palette.textTertiary)
            Text(value).font(Typo.rowFigure(16)).foregroundStyle(Palette.textPrimary).lineLimit(1)
            Text(note).font(.system(size: 10)).foregroundStyle(Palette.textTertiary).lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

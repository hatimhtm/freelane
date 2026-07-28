import Charts
import SwiftData
import SwiftUI

/// The spending half of Insights, and its own page rather than the income page with the sign
/// flipped.
///
/// Insights only ever showed income — what landed, from whom, through which rail. That answers half
/// of "how am I doing": you can earn well and still be going backwards. Every figure here comes from
/// the same `InsightsModel` the income tabs read, built once per data change, and every figure says
/// what it is made of — how many purchases, over what window, against what.
struct SpendingInsightCards: View {
    let model: InsightsModel
    let base: String

    var body: some View {
        SpendHeaderCard(model: model, base: base)
        BurnCard(model: model, base: base)
        InOutCard(model: model, base: base)
        BalancedColumns(cards: [
            (model.categories.count * 2 + 2, AnyView(CategoriesCard(model: model, base: base))),
            (model.vendors.count * 2, AnyView(VendorsCard(model: model, base: base))),
        ].filter { $0.0 > 2 })
        commitmentsCard
    }

    /// Not a chart. Four numbers, and a chart of four numbers is decoration.
    private var commitmentsCard: some View {
        SectionCard(title: "Already spoken for", subtitle: "What leaves before you decide anything",
                    accent: Palette.warning) {
            StatRow {
                StatCell(label: "Still owed, next 30 days",
                         value: CurrencyFormat.string(model.monthlyCommitments, base, compact: true),
                         note: model.prepaidNotes.isEmpty
                             ? "recurring bills actually due"
                             : "bills due · " + model.prepaidNotes.joined(separator: " · "))
                StatDivider()
                StatCell(label: "Owed to you",
                         value: CurrencyFormat.string(model.loansOut, base, compact: true),
                         note: "lent out and not back yet")
                StatDivider()
                StatCell(label: "Biggest this month",
                         value: model.biggestSpend.map { CurrencyFormat.string($0.amount, base, compact: true) } ?? "—",
                         note: model.biggestSpend?.name ?? "nothing logged")
                StatDivider()
                StatCell(label: "Priciest weekday",
                         value: model.busiestWeekday.map { CurrencyFormat.string($0.amount, base, compact: true) } ?? "—",
                         note: model.busiestWeekday.map { "\($0.label)s · average of \($0.samples) such days" }
                             ?? "not enough days logged")
            }
        }
    }
}

// MARK: - Header

/// The month in figures before any chart. Every number on this page is one of these or made from
/// them, so they lead.
private struct SpendHeaderCard: View {
    let model: InsightsModel
    let base: String

    var body: some View {
        // Like-for-like: month-to-date against the same day of last month, never against a whole
        // finished month — that comparison always reads as a collapse on the 3rd and a surge on
        // the 30th, and says nothing either time.
        let priorToDate = model.spendPrior.last { $0.step <= model.stepCursor }?.running ?? 0
        let delta = priorToDate > 0
            ? (model.spentThisMonth - priorToDate) / priorToDate : nil

        SectionCard(title: "This month", subtitle: "Everything logged since the 1st",
                    accent: Palette.warning,
                    trailing: AnyView(
                        Text(model.spendWindow.basis)
                            .font(.system(size: 11)).foregroundStyle(Palette.textTertiary))) {
            if model.unaccountedThisMonth > 0 {
                BasisNote(text: Unaccounted.explain(model.unaccountedThisMonth,
                                                    days: model.unaccountedDays, base: base)
                          + " It can't be tagged or itemised, but it was spent, so it counts here and everywhere else.")
            }
            StatRow {
                StatCell(label: "Everything that left",
                         value: CurrencyFormat.string(model.spentThisMonth, base, compact: true),
                         note: model.unaccountedThisMonth > 0
                             ? "\(CurrencyFormat.abbreviated(model.loggedThisMonth, base)) logged + \(CurrencyFormat.abbreviated(model.unaccountedThisMonth, base)) unaccounted"
                             : "\(model.spendCountThisMonth) purchase\(model.spendCountThisMonth == 1 ? "" : "s") across \(model.daysLogged) day\(model.daysLogged == 1 ? "" : "s")",
                         tone: Palette.negative)
                StatDivider()
                StatCell(label: "Per day so far",
                         value: CurrencyFormat.string(model.dailyAverage, base, compact: true),
                         note: "total ÷ \(model.daysElapsed) days elapsed")
                StatDivider()
                StatCell(label: "Last month by day \(model.stepCursor)",
                         value: priorToDate > 0
                             ? CurrencyFormat.string(priorToDate, base, compact: true) : "—",
                         note: delta.map { String(format: "you are %+.0f%% on it", $0 * 100) }
                             ?? "nothing logged by then",
                         tone: (delta ?? 0) > 0 ? Palette.negative : Palette.textPrimary)
                StatDivider()
                StatCell(label: "Typical month",
                         value: model.avgSpend.map { CurrencyFormat.string($0, base, compact: true) } ?? "—",
                         note: model.avgSpend != nil ? model.spendWindow.basis : "no complete month yet")
            }
        }
    }
}

// MARK: - Burn

/// This month, day by day, against last month's line.
///
/// The bars are what each day cost; the line below is the running total, with last month's running
/// total behind it. Same units, one axis each. It's the chart that tells you on the 14th whether
/// you can afford the rest of the month.
private struct BurnCard: View {
    let model: InsightsModel
    let base: String
    @State private var hover: Int?

    private struct Point: Identifiable {
        var id: String { "\(series)-\(step)" }
        let step: Int
        let value: Double
        let series: String
    }

    private var lines: [Point] {
        model.spendNow.prefix(model.stepCursor).map {
            Point(step: $0.step, value: $0.running, series: "This month")
        } + model.spendPrior.map {
            Point(step: $0.step, value: $0.running, series: "Last month")
        }
    }

    var body: some View {
        let priorFinal = model.spendPrior.last?.running ?? 0
        let soFar = model.spendNow.first { $0.step == model.stepCursor }?.running ?? 0
        let days = Array(model.spendNow.prefix(model.stepCursor))
        let dailyMax = max(1, days.map(\.amount).max() ?? 1)
        let runMax = max(1, max(priorFinal, days.last?.running ?? 1))

        SectionCard(title: "Day by day", subtitle: "What each day cost, and the running total",
                    accent: Palette.warning,
                    trailing: AnyView(ChartLegend(items: [
                        ("Logged", ChartInk.outgo), ("Unaccounted", ChartInk.slot(1)),
                        ("Last month", ChartInk.prior),
                    ]))) {
            BasisNote(text: verdict(soFar: soFar))

            Text("EACH DAY").font(.system(size: 9, weight: .semibold)).tracking(0.6)
                .foregroundStyle(Palette.textTertiary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 6)

            Chart {
                ForEach(days) { d in
                    // A fixed width, not a ratio. `.ratio` is a fraction of the band a mark sits
                    // in, and a continuous numeric x has no bands — the ratio resolved to nothing
                    // and the bars never drew at all.
                    BarMark(x: .value("Day", Double(d.step)), y: .value("Logged", d.logged), width: .fixed(7))
                        .foregroundStyle(ChartInk.outgo)
                        .cornerRadius(2)
                    BarMark(x: .value("Day", Double(d.step)), y: .value("Unaccounted", d.unaccounted), width: .fixed(7))
                        .foregroundStyle(ChartInk.slot(1))
                        .cornerRadius(2)
                }
                RuleMark(y: .value("Average day", model.dailyAverage))
                    .foregroundStyle(Palette.textTertiary.opacity(0.55))
                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 4]))
                    .annotation(position: .trailing, alignment: .leading, spacing: 4) {
                        Text("avg day").font(.system(size: 9)).foregroundStyle(Palette.textTertiary)
                    }
            }
            .chartXScale(domain: 0.5...Double(model.stepCount) + 0.5)
            .chartYScale(domain: 0...dailyMax * 1.25)
            .chartXAxis(.hidden)
            .chartYAxis {
                AxisMarks(position: .leading, values: .automatic(desiredCount: 3)) { value in
                    AxisGridLine().foregroundStyle(Palette.hairline)
                    AxisValueLabel {
                        if let d = value.as(Double.self) {
                            Text(CurrencyFormat.abbreviated(d, base))
                                .font(.system(size: 9.5)).foregroundStyle(Palette.textTertiary)
                        }
                    }
                }
            }
            .stepCursor(model.stepCount, hover: $hover) { step in tip(step) }
            .frame(height: 130)

            Text("ADDING UP").font(.system(size: 9, weight: .semibold)).tracking(0.6)
                .foregroundStyle(Palette.textTertiary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 12)

            Chart {
                ForEach(lines) { p in
                    LineMark(x: .value("Day", Double(p.step)), y: .value("Running total", p.value),
                             series: .value("Period", p.series))
                        .foregroundStyle(p.series == "This month" ? ChartInk.outgo : ChartInk.prior)
                        .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round,
                                               dash: p.series == "This month" ? [] : [4, 3]))
                        .interpolationMethod(.monotone)
                }
            }
            .chartXScale(domain: 0.5...Double(model.stepCount) + 0.5)
            .chartYScale(domain: 0...runMax * 1.12)
            .chartXAxis {
                AxisMarks(values: xTicks) { value in
                    AxisValueLabel {
                        if let d = value.as(Double.self) {
                            Text("\(Int(d))").font(.system(size: 9.5)).foregroundStyle(Palette.textTertiary)
                        }
                    }
                }
            }
            .chartYAxis {
                AxisMarks(position: .leading, values: .automatic(desiredCount: 3)) { value in
                    AxisGridLine().foregroundStyle(Palette.hairline)
                    AxisValueLabel {
                        if let d = value.as(Double.self) {
                            Text(CurrencyFormat.abbreviated(d, base))
                                .font(.system(size: 9.5)).foregroundStyle(Palette.textTertiary)
                        }
                    }
                }
            }
            .stepCursor(model.stepCount, hover: $hover) { step in tip(step) }
            .frame(height: 150)

            Divider().overlay(Palette.hairline).padding(.vertical, 10)

            StatRow {
                StatCell(label: "Spent so far", value: CurrencyFormat.string(soFar, base, compact: true),
                         note: "day \(model.stepCursor) of \(model.stepCount)")
                StatDivider()
                StatCell(label: "Last month by now",
                         value: CurrencyFormat.string(priorAtSamePoint, base, compact: true),
                         note: "same day, one month back")
                StatDivider()
                StatCell(label: "On this pace",
                         value: model.canProject
                             ? CurrencyFormat.string(model.projectedSpend, base, compact: true) : "—",
                         note: model.canProject ? "by month end, at today's rate" : "too early to project",
                         tone: model.canProject && priorFinal > 0 && model.projectedSpend > priorFinal
                             ? Palette.negative : Palette.textPrimary)
                StatDivider()
                StatCell(label: "Last month, whole",
                         value: priorFinal > 0 ? CurrencyFormat.string(priorFinal, base, compact: true) : "—",
                         note: priorFinal > 0 ? "what it finished at" : "nothing logged")
            }
        }
    }

    private var priorAtSamePoint: Double {
        model.spendPrior.last { $0.step <= model.stepCursor }?.running ?? 0
    }

    private func tip(_ step: Int) -> some View {
        let day = model.spendNow.first { $0.step == step }
        let ahead = step > model.stepCursor
        return ChartTip {
            Text(dayLabel(step)).font(.system(size: 10.5, weight: .semibold))
                .foregroundStyle(Palette.textSecondary)
            ChartTipRow(color: ChartInk.outgo, name: "Logged that day",
                        value: ahead ? "hasn't happened yet"
                                     : CurrencyFormat.string(day?.logged ?? 0, base, compact: true))
            if (day?.unaccounted ?? 0) > 0 {
                ChartTipRow(color: ChartInk.slot(1), name: "Unaccounted",
                            value: CurrencyFormat.string(day?.unaccounted ?? 0, base, compact: true))
            }
            ChartTipRow(color: nil, name: "Running total",
                        value: ahead ? "—" : CurrencyFormat.string(day?.running ?? 0, base, compact: true),
                        emphasise: true)
            ChartTipRow(color: ChartInk.prior, name: "Last month by then",
                        value: CurrencyFormat.string(
                            model.spendPrior.last { $0.step <= step }?.running ?? 0, base, compact: true))
        }
    }

    private func dayLabel(_ step: Int) -> String {
        let cal = PHT.calendar
        let start = PHT.startOfMonth()
        if let d = cal.date(byAdding: .day, value: step - 1, to: start) {
            return ChartLabel.dayMonth.string(from: d)
        }
        return "Day \(step)"
    }

    private var xTicks: [Double] {
        Array(stride(from: 1.0, through: Double(model.stepCount), by: 5))
    }

    private func verdict(soFar: Double) -> String {
        let prior = priorAtSamePoint
        guard prior > 0 else {
            return "Bars are what each day cost. The line below adds them up, with last month dashed behind it."
        }
        let pct = (soFar - prior) / prior * 100
        return String(format: "By day %d you had spent %@; last month by the same day it was %@ — %.0f%% %@.",
                      model.stepCursor,
                      CurrencyFormat.string(soFar, base, compact: true),
                      CurrencyFormat.string(prior, base, compact: true),
                      abs(pct), pct >= 0 ? "more" : "less")
    }
}

// MARK: - In and out

/// The one chart that answers "did that month end up or down".
///
/// Two series on ONE axis — never a second y-scale, which would let any pair of shapes be made to
/// look correlated. Income and outgo are opposite poles rather than two categories, so they take
/// the diverging pair. The series starts at the first record, not twelve months back.
private struct InOutCard: View {
    let model: InsightsModel
    let base: String
    @State private var hover: Date?

    var body: some View {
        SectionCard(title: "In and out", subtitle: "Net landed against everything spent, month by month",
                    accent: Palette.azure,
                    trailing: AnyView(ChartLegend(items: [
                        ("In", ChartInk.income), ("Logged out", ChartInk.outgo),
                        ("Unaccounted", ChartInk.slot(1)),
                    ]))) {
            if model.months.allSatisfy({ $0.income == 0 && $0.outgo == 0 }) {
                Text("Nothing to compare yet.").font(.system(size: 12)).foregroundStyle(Palette.textTertiary)
            } else {
                BasisNote(text: headline)

                let ceiling = max(1, model.months.flatMap { [$0.income, $0.outgo] }.max() ?? 1)
                Chart {
                    ForEach(model.months) { m in
                        BarMark(x: .value("Month", m.month, unit: .month),
                                y: .value("Landed", m.income),
                                width: .ratio(0.32))
                            .position(by: .value("Direction", "In"), axis: .horizontal, span: .ratio(0.76))
                            .foregroundStyle(ChartInk.income.opacity(m.incomePartial || m.isCurrent ? 0.45 : 1))
                            .cornerRadius(3)
                        BarMark(x: .value("Month", m.month, unit: .month),
                                y: .value("Spent", m.outgoLogged),
                                width: .ratio(0.32))
                            .position(by: .value("Direction", "Out"), axis: .horizontal, span: .ratio(0.76))
                            .foregroundStyle(ChartInk.outgo.opacity(m.spendPartial || m.isCurrent ? 0.45 : 1))
                            .cornerRadius(3)
                        // Money that left with no record, stacked on what you logged rather than
                        // hidden. Same bar, because it is the same money leaving.
                        BarMark(x: .value("Month", m.month, unit: .month),
                                y: .value("Unaccounted", m.unaccounted),
                                width: .ratio(0.32))
                            .position(by: .value("Direction", "Out"), axis: .horizontal, span: .ratio(0.76))
                            .foregroundStyle(ChartInk.slot(1).opacity(m.spendPartial || m.isCurrent ? 0.45 : 1))
                            .cornerRadius(3)
                    }
                }
                .chartYScale(domain: 0...(ceiling * 1.14))
                .chartXAxis {
                    AxisMarks(values: .stride(by: .month)) { value in
                        AxisValueLabel(centered: true) {
                            if let d = value.as(Date.self) {
                                Text(ChartLabel.monthShort.string(from: d))
                                    .font(.system(size: 9.5)).foregroundStyle(Palette.textTertiary)
                            }
                        }
                    }
                }
                .chartYAxis {
                    AxisMarks(position: .leading, values: .automatic(desiredCount: 4)) { value in
                        AxisGridLine().foregroundStyle(Palette.hairline)
                        AxisValueLabel {
                            if let d = value.as(Double.self) {
                                Text(CurrencyFormat.abbreviated(d, base))
                                    .font(.system(size: 9.5)).foregroundStyle(Palette.textTertiary)
                            }
                        }
                    }
                }
                .monthCursor(model.months.map(\.month), hover: $hover) { month in
                    if let p = model.months.first(where: { $0.month == month }) {
                        let q = p.isCurrent ? "so far" : (p.isPartial ? "partial month" : "")
                        ChartTip {
                            Text(p.longLabel + (q.isEmpty ? "" : " · \(q)"))
                                .font(.system(size: 10.5, weight: .semibold))
                                .foregroundStyle(Palette.textSecondary)
                            ChartTipRow(color: ChartInk.income, name: "In",
                                        value: CurrencyFormat.string(p.income, base, compact: true))
                            ChartTipRow(color: ChartInk.outgo, name: "Logged out",
                                        value: CurrencyFormat.string(p.outgoLogged, base, compact: true))
                            if p.unaccounted > 0 {
                                ChartTipRow(color: ChartInk.slot(1), name: "Unaccounted",
                                            value: CurrencyFormat.string(p.unaccounted, base, compact: true))
                            }
                            ChartTipRow(color: nil,
                                        name: p.net >= 0 ? "Kept" : "Short by",
                                        value: CurrencyFormat.string(abs(p.net), base, compact: true),
                                        emphasise: true)
                        }
                    }
                }
                .frame(height: 240)
            }
        }
    }

    private var headline: String {
        let judged = model.months.filter { !$0.isPartial && !$0.isCurrent && ($0.income > 0 || $0.outgo > 0) }
        guard !judged.isEmpty else {
            return "No month has run start to finish with logging in place yet — the faded bars are months that can't be judged."
        }
        let up = judged.filter { $0.net > 0 }.count
        return "\(up) of \(judged.count) complete month\(judged.count == 1 ? "" : "s") finished up. Faded bars are partial or still running."
    }
}

// MARK: - Where it goes

private struct CategoriesCard: View {
    let model: InsightsModel
    let base: String

    var body: some View {
        SectionCard(title: "Where it goes", subtitle: "This month by tag, with last month beside it",
                    accent: Palette.violet,
                    trailing: AnyView(
                        Text(CurrencyFormat.string(model.spentThisMonth, base, compact: true))
                            .font(Typo.rowFigure(12)).foregroundStyle(Palette.textSecondary))) {
            if model.categories.isEmpty {
                Text("Nothing logged this month.").font(.system(size: 12)).foregroundStyle(Palette.textTertiary)
            } else {
                BasisNote(text: "Each tag counts in full — a spend with two tags appears under both, so the shares describe emphasis, not a split of the total.")
                VStack(spacing: 2) {
                    ForEach(Array(model.categories.enumerated()), id: \.element.id) { i, slice in
                        RankBar(index: i, name: slice.name, note: slice.note,
                                value: CurrencyFormat.string(slice.value, base, compact: true),
                                share: slice.share, color: ChartInk.slot(slice.slot),
                                trailing: "\(Int((slice.share * 100).rounded()))%",
                                delta: slice.delta, deltaNote: slice.deltaNote)
                    }
                }
                if model.investedThisMonth > 0 {
                    Divider().overlay(Palette.hairline).padding(.vertical, 8)
                    HStack {
                        Text("Of that, investment — gear, home, things that last")
                            .font(.system(size: 11)).foregroundStyle(Palette.textTertiary)
                        Spacer()
                        Text(CurrencyFormat.string(model.investedThisMonth, base, compact: true))
                            .font(Typo.rowFigure(12)).foregroundStyle(Palette.textSecondary)
                    }
                }
            }
        }
    }
}

private struct VendorsCard: View {
    let model: InsightsModel
    let base: String

    var body: some View {
        SectionCard(title: "Who you pay", subtitle: "This month by vendor, with last month beside it",
                    accent: Palette.cyan,
                    trailing: AnyView(
                        Text("\(model.vendors.count) vendor\(model.vendors.count == 1 ? "" : "s")")
                            .font(.system(size: 11)).foregroundStyle(Palette.textTertiary))) {
            if model.vendors.isEmpty {
                Text("No vendors recorded this month.")
                    .font(.system(size: 12)).foregroundStyle(Palette.textTertiary)
            } else {
                VStack(spacing: 2) {
                    ForEach(Array(model.vendors.enumerated()), id: \.element.id) { i, v in
                        // One hue: these are ranked magnitudes of the same thing, not different
                        // kinds of thing.
                        RankBar(index: i, name: v.name, note: v.note,
                                value: CurrencyFormat.string(v.value, base, compact: true),
                                share: v.share, color: ChartInk.slot(2),
                                trailing: "\(Int((v.share * 100).rounded()))% of vendor spend",
                                delta: v.delta, deltaNote: v.deltaNote)
                    }
                }
            }
        }
    }
}

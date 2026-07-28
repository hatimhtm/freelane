import SwiftUI
import SwiftData
import Charts

/// Insights — "how is my freelance business actually doing?"
///
/// Two rules hold this screen together.
///
/// **Every figure is read from one `InsightsModel`, built once per data change.** Nothing here
/// walks the payment history; nothing recomputes because the pointer moved. Each chart keeps its
/// own hover state, so tracking a bar redraws that chart and nothing else.
///
/// **No average is taken over months that weren't being logged.** The ledger starts when it starts;
/// dividing four months of income by twelve produced a number that wasn't about anything, and it
/// was then used to colour the bars. Averages here cover complete months only and say so.
struct StatsView: View {
    @Query private var settings: [AppSettings]
    @Query private var rateRows: [ExchangeRate]
    @Query(filter: #Predicate<Payment> { $0.deletedAt == nil }) private var payments: [Payment]
    @Query(filter: #Predicate<Withdrawal> { $0.deletedAt == nil }) private var withdrawals: [Withdrawal]
    @Query(filter: #Predicate<Client> { $0.deletedAt == nil }) private var clients: [Client]
    @Query(filter: #Predicate<Project> { $0.deletedAt == nil }) private var projects: [Project]
    @Query private var allocations: [PaymentAllocation]
    @Query(filter: #Predicate<Spend> { $0.deletedAt == nil }) private var spends: [Spend]
    @Query(filter: #Predicate<Recurring> { $0.deletedAt == nil }) private var recurrings: [Recurring]
    @Query(filter: #Predicate<Loan> { $0.deletedAt == nil }) private var loans: [Loan]

    @State private var sub = 0          // open on "This month" — the hero leads with NOW
    @State private var model = InsightsModel()

    private var base: String { settings.first?.baseCurrency ?? "PHP" }

    /// A cheap digest of the data the model is built from. Counts alone miss an edited amount, so
    /// the running totals go in too — two passes over a few hundred doubles, against the dozens of
    /// nested passes this replaces.
    private var stamp: Int {
        var h = Hasher()
        h.combine(payments.count); h.combine(withdrawals.count); h.combine(spends.count)
        h.combine(clients.count); h.combine(projects.count); h.combine(allocations.count)
        h.combine(recurrings.count); h.combine(loans.count)
        h.combine(payments.reduce(0.0) { $0 + ($1.netAmountBase ?? 0) })
        h.combine(spends.reduce(0.0) { $0 + $1.amountBase })
        h.combine(allocations.reduce(0.0) { $0 + $1.allocationBase })
        return h.finalize()
    }

    private var scope: InsightsModel.Scope { InsightsModel.Scope(rawValue: min(sub, 2)) ?? .month }

    private func rebuild() {
        model = InsightsModel.build(
            scope: scope, stamp: stamp, rates: Rates(base: base, rates: rateRows),
            payments: payments, withdrawals: withdrawals, spends: spends,
            clients: clients, projects: projects, allocations: allocations,
            recurring: recurrings, loans: loans)
    }

    // MARK: Body

    var body: some View {
        Page("Insights", subtitle: "The longer view — where the money actually goes.",
             subtabs: ["This month", "This year", "Lifetime", "Spending", "Activity"], selection: $sub) {
            if sub == 4 {
                ActivityFeed()
            } else if sub == 3 {
                SpendingInsightCards(model: model, base: base)
            } else if payments.isEmpty {
                EmptyStateCard(icon: "chart.bar",
                               title: "No income yet",
                               message: "Log your first payment and Insights will start answering how the business is doing — trend, fees, and who pays the bills.")
            } else {
                hero
                // The three tabs answer three different questions, so they carry different cards.
                // "This month" is about the month in progress; "This year" is about shape across
                // the year; "Lifetime" is about the whole record.
                switch scope {
                case .month:    monthTab
                case .year:     yearTab
                case .lifetime: lifetimeTab
                }
            }
        }
        .onAppear { rebuild() }
        .onChange(of: stamp) { _, _ in rebuild() }
        .onChange(of: sub) { _, _ in if sub < 3 { rebuild() } }
    }

    // MARK: Tab compositions

    @ViewBuilder private var monthTab: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .top, spacing: 20) {
                TrendChartCard(model: model, base: base)
                pulseRail.frame(width: 262)
            }
            VStack(alignment: .leading, spacing: 20) {
                TrendChartCard(model: model, base: base)
                pulseRail
            }
        }
        PaceCard(model: model, base: base)
        BalancedColumns(cards: [
            (model.clients.count * 2, AnyView(clientsCard)),
            (model.routes.count * 2 + 2, AnyView(routesCard)),
            (4, AnyView(owedCard)),
            (model.feeLeaders.count, AnyView(feeLeaderCard)),
        ].filter { $0.0 > 0 })
    }

    @ViewBuilder private var yearTab: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .top, spacing: 20) {
                TrendChartCard(model: model, base: base)
                pulseRail.frame(width: 262)
            }
            VStack(alignment: .leading, spacing: 20) {
                TrendChartCard(model: model, base: base)
                pulseRail
            }
        }
        QuartersCard(model: model, base: base)
        BalancedColumns(cards: [
            (model.clients.count * 2, AnyView(clientsCard)),
            (model.currencies.count * 2, AnyView(currencyCard)),
            (model.routes.count * 2 + 2, AnyView(routesCard)),
            (model.feeLeaders.count, AnyView(feeLeaderCard)),
        ].filter { $0.0 > 0 })
    }

    @ViewBuilder private var lifetimeTab: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .top, spacing: 20) {
                CumulativeCard(model: model, base: base)
                pulseRail.frame(width: 262)
            }
            VStack(alignment: .leading, spacing: 20) {
                CumulativeCard(model: model, base: base)
                pulseRail
            }
        }
        recordsCard
        BalancedColumns(cards: [
            (model.clients.count * 2, AnyView(clientsCard)),
            (model.currencies.count * 2, AnyView(currencyCard)),
            (model.latency.count * 2, AnyView(latencyCard)),
            (model.routes.count * 2 + 2, AnyView(routesCard)),
        ].filter { $0.0 > 0 })
    }

    // MARK: Hero

    private var hero: some View {
        var chips: [(text: String, icon: String?, color: Color)] = []
        // Like-for-like or nothing. A month in progress compared against a finished month always
        // reads as a collapse, which is why "-25% vs last month" appeared on a record month.
        if let d = model.deltaPct {
            chips.append((String(format: "%+.0f%% %@", d * 100, model.deltaBasis),
                          d >= 0 ? "arrow.up.right" : "arrow.down.right",
                          d >= 0 ? Palette.positive : Palette.negative))
        }
        chips.append(("\(model.paymentCount) payments", "arrow.down.left", Palette.textSecondary))
        chips.append((model.netInScope >= 0
                      ? "kept " + CurrencyFormat.abbreviated(model.netInScope, base)
                      : "down " + CurrencyFormat.abbreviated(abs(model.netInScope), base),
                      model.netInScope >= 0 ? "checkmark" : "exclamationmark",
                      model.netInScope >= 0 ? Palette.positive : Palette.negative))
        let spark = model.months.map(\.income)
        return HeroTile(label: model.scope.earnedLabel, value: model.landed, code: base,
                        accent: Palette.azure,
                        spark: spark.count > 1 ? spark : [0, 0], chips: chips)
    }

    private var pulseRail: some View {
        FigureRail(title: "The numbers", items: [
            .init(id: "fees", label: "Fees paid",
                  value: CurrencyFormat.abbreviated(model.fees, base),
                  sub: String(format: "%.1f%% of gross", model.feePct * 100),
                  tone: Palette.negative, destination: .payments),
            .init(id: "spent", label: "Spent",
                  value: CurrencyFormat.abbreviated(model.spentInScope, base),
                  sub: model.landed > 0
                      ? "\(Int((model.spentInScope / model.landed * 100).rounded()))% of what landed"
                      : "nothing landed yet",
                  tone: Palette.negative, destination: .spending),
            .init(id: "avg", label: "Average payment",
                  value: CurrencyFormat.abbreviated(model.avgPayment, base),
                  sub: "across \(model.paymentCount) payments"),
            .init(id: "month", label: "Typical month",
                  value: model.avgIncome.map { CurrencyFormat.abbreviated($0, base) } ?? "—",
                  sub: model.incomeWindow.basis),
            .init(id: "top", label: "Biggest client",
                  value: model.topClientShare > 0 ? "\(Int((model.topClientShare * 100).rounded()))%" : "—",
                  sub: model.topClientName.isEmpty ? "No earnings yet" : model.topClientName,
                  destination: .clients),
            .init(id: "earning", label: "Clients earning",
                  value: "\(model.clientsEarning)",
                  sub: "of \(model.clientsTotal) total", destination: .clients),
        ])
    }

    // MARK: Cards

    private var clientsCard: some View {
        SectionCard(title: "Who pays the bills",
                    subtitle: scope == .lifetime
                        ? "Every client by what they have actually paid, all time"
                        : "By what landed from them in this \(scope.unit)",
                    accent: Palette.violet,
                    trailing: AnyView(
                        Text(model.topClientShare > 0
                             ? "\(Int((model.topClientShare * 100).rounded()))% from one client"
                             : "")
                            .font(.system(size: 11)).foregroundStyle(Palette.textTertiary))) {
            VStack(spacing: 2) {
                ForEach(Array(model.clients.enumerated()), id: \.element.id) { i, c in
                    RankBar(index: i, name: c.name, note: c.note,
                            value: CurrencyFormat.string(c.value, base, compact: true),
                            share: c.share, color: ChartInk.slot(c.slot),
                            trailing: "\(Int((c.share * 100).rounded()))% of the total")
                }
            }
        }
    }

    private var currencyCard: some View {
        SectionCard(title: "What it arrives in", subtitle: "Net landed by currency, converted to \(base)",
                    accent: Palette.indigo) {
            VStack(spacing: 2) {
                ForEach(Array(model.currencies.enumerated()), id: \.element.id) { i, c in
                    RankBar(index: i, name: c.name, note: c.note,
                            value: CurrencyFormat.string(c.value, base, compact: true),
                            share: c.share, color: ChartInk.slot(c.slot),
                            trailing: "\(Int((c.share * 100).rounded()))%")
                }
            }
        }
    }

    /// Rails that cost nothing get a line, not a row.
    ///
    /// This table used to list every currency ranked by fee, so USD and EUR sat there with "keeps
    /// 100%", "−₱0" and a full green bar — rows carrying no information. Only rails that actually
    /// cost something are ranked now, and the bar is the fee's share of all fees rather than the
    /// fraction kept, which was near-full for everything and so said nothing.
    private var routesCard: some View {
        SectionCard(title: "Cost of getting paid", subtitle: "Which rails take a cut, and how much",
                    accent: Palette.warning,
                    trailing: AnyView(
                        Text("−" + CurrencyFormat.string(model.fees, base, compact: true))
                            .font(Typo.rowFigure(12)).foregroundStyle(Palette.negative))) {
            VStack(alignment: .leading, spacing: 2) {
                if model.routes.isEmpty {
                    Text("No transfer fees in this \(scope.unit).")
                        .font(.system(size: 12)).foregroundStyle(Palette.textTertiary)
                }
                ForEach(Array(model.routes.enumerated()), id: \.element.id) { i, r in
                    RankBar(index: i, name: r.currency,
                            note: "you keep \(Int((r.kept * 100).rounded()))% of gross · \(r.count) payment\(r.count == 1 ? "" : "s")",
                            value: "−" + CurrencyFormat.string(r.fee, base, compact: true),
                            share: r.feeShare,
                            color: r.kept < 0.95 ? ChartInk.outgo : ChartInk.slot(1),
                            trailing: "\(Int((r.feeShare * 100).rounded()))% of fees")
                }
                if !model.feeFreeRoutes.isEmpty {
                    Divider().overlay(Palette.hairline).padding(.vertical, 8)
                    Text("\(model.feeFreeRoutes.joined(separator: ", ")) cost you nothing.")
                        .font(.system(size: 11)).foregroundStyle(Palette.textTertiary)
                }
            }
        }
    }

    private var feeLeaderCard: some View {
        SectionCard(title: "Fee leaderboard", subtitle: "Individual payments by effective fee — fee ÷ gross",
                    accent: Palette.negative) {
            VStack(spacing: 2) {
                ForEach(Array(model.feeLeaders.enumerated()), id: \.element.id) { i, row in
                    HStack(spacing: 12) {
                        Text("\(i + 1)")
                            .font(Typo.rowFigure(11)).monospacedDigit()
                            .foregroundStyle(Palette.textTertiary).frame(width: 16)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(row.payer).font(.system(size: 12, weight: .medium))
                                .foregroundStyle(Palette.textPrimary).lineLimit(1)
                            Text(ChartLabel.fullDate.string(from: row.date))
                                .font(.system(size: 10)).foregroundStyle(Palette.textTertiary)
                        }
                        Spacer(minLength: 8)
                        Text("−" + CurrencyFormat.string(row.fee, base, compact: true))
                            .font(Typo.rowFigure(12)).foregroundStyle(Palette.negative)
                        Text(String(format: "%.1f%%", row.pct * 100))
                            .font(Typo.rowFigure(13, .bold))
                            .foregroundStyle(row.pct > 0.05 ? Palette.negative : Palette.warning)
                            .frame(width: 52, alignment: .trailing)
                    }
                    .padding(.horizontal, 10).padding(.vertical, 8)
                }
            }
        }
    }

    private var latencyCard: some View {
        SectionCard(title: "How long they take",
                    subtitle: "Days from quote to fully paid, averaged per client · all time",
                    accent: Palette.indigo,
                    trailing: AnyView(
                        Text("\(model.latencyAverage)d overall")
                            .font(.system(size: 11)).foregroundStyle(Palette.textTertiary))) {
            let worst = max(1, model.latency.first?.days ?? 1)
            VStack(spacing: 2) {
                ForEach(Array(model.latency.enumerated()), id: \.element.id) { i, r in
                    RankBar(index: i, name: r.name,
                            note: "across \(r.count) paid project\(r.count == 1 ? "" : "s")",
                            value: "\(r.days)d",
                            share: Double(r.days) / Double(worst),
                            color: r.days >= 30 ? ChartInk.outgo : (r.days >= 14 ? ChartInk.slot(1) : ChartInk.income))
                }
            }
        }
    }

    /// Only on "This month": what is quoted and still unpaid. Money you have earned but cannot
    /// spend is the figure a month-to-date total hides.
    private var owedCard: some View {
        SectionCard(title: "Still owed to you", subtitle: "Quoted, delivered or not, and not yet paid",
                    accent: Palette.cyan) {
            StatRow {
                StatCell(label: "Outstanding", value: CurrencyFormat.string(model.owedNow, base, compact: true),
                         note: "\(model.owedProjects) open project\(model.owedProjects == 1 ? "" : "s")",
                         tone: model.owedNow > 0 ? Palette.warning : Palette.textPrimary)
                StatDivider()
                StatCell(label: "Landed so far", value: CurrencyFormat.string(model.landed, base, compact: true),
                         note: "day \(model.stepCursor) of \(model.stepCount)")
                StatDivider()
                StatCell(label: "Typical month",
                         value: model.avgIncome.map { CurrencyFormat.string($0, base, compact: true) } ?? "—",
                         note: model.incomeWindow.basis)
            }
        }
    }

    private var recordsCard: some View {
        SectionCard(title: "The record", subtitle: "Since \(model.incomeWindow.firstRecord.map { ChartLabel.fullDate.string(from: $0) } ?? "—")",
                    accent: Palette.warning) {
            StatRow {
                StatCell(label: "Earned, all time", value: CurrencyFormat.string(model.totalEarned, base, compact: true),
                         note: "\(model.paymentCount) payments")
                StatDivider()
                StatCell(label: "Spent, all time", value: CurrencyFormat.string(model.totalSpent, base, compact: true),
                         note: model.totalEarned > 0
                             ? "\(Int((model.totalSpent / model.totalEarned * 100).rounded()))% of what landed"
                             : "—",
                         tone: Palette.negative)
                StatDivider()
                StatCell(label: "Best month",
                         value: model.bestMonth.map { CurrencyFormat.string($0.income, base, compact: true) } ?? "—",
                         note: model.bestMonth?.longLabel ?? "no complete month yet")
                StatDivider()
                StatCell(label: "Biggest payment",
                         value: model.biggestPayment.map { CurrencyFormat.string($0.amount, base, compact: true) } ?? "—",
                         note: model.biggestPayment.map { "\($0.payer) · \(ChartLabel.fullDate.string(from: $0.date))" } ?? "—")
            }
        }
    }
}

// MARK: - Trend

/// Income month by month, from the first record onward.
///
/// It used to draw twelve slots regardless, so a ledger starting in April spent two thirds of the
/// chart on months that never existed — and then averaged across them. The series starts where the
/// records start, the average covers complete months only, and months that can't be judged (the
/// first partial one, and the one still running) are drawn as outlines rather than coloured
/// good-or-bad.
private struct TrendChartCard: View {
    let model: InsightsModel
    let base: String
    @State private var hover: Date?

    var body: some View {
        SectionCard(title: "Income by month", subtitle: "Net landed, after transfer fees",
                    accent: Palette.azure,
                    trailing: AnyView(
                        Text(model.avgIncome.map { "typical month " + CurrencyFormat.abbreviated($0, base) } ?? "no average yet")
                            .font(.system(size: 11)).foregroundStyle(Palette.textTertiary))) {
            if model.months.isEmpty {
                Text("No data yet.").font(.system(size: 12)).foregroundStyle(Palette.textTertiary)
            } else {
                BasisNote(text: basis)

                let ceiling = max(1, model.months.map(\.income).max() ?? 1)
                Chart {
                    ForEach(model.months) { m in
                        // No mark changes on hover — the guide and readout live in the overlay, so
                        // moving the pointer never re-renders the bars. That churn was the "colours
                        // lagging" and the flicker.
                        BarMark(x: .value("Month", m.month, unit: .month),
                                y: .value("Net landed", m.income),
                                width: .ratio(0.6))
                            .foregroundStyle(fill(for: m))
                            .cornerRadius(4)
                    }
                    if let avg = model.avgIncome {
                        RuleMark(y: .value("Typical month", avg))
                            .foregroundStyle(Palette.textTertiary.opacity(0.55))
                            .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 4]))
                    }
                }
                .chartYScale(domain: 0...(ceiling * 1.14))
                .chartXAxis {
                    AxisMarks(values: .stride(by: .month)) { value in
                        AxisValueLabel(centered: true) {
                            if let d = value.as(Date.self) {
                                Text(ChartLabel.monthShort.string(from: d))
                                    .font(.system(size: 9.5))
                                    .foregroundStyle(Palette.textTertiary)
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
                    if let point = model.months.first(where: { $0.month == month }) {
                        let q = point.qualifier()
                        ChartTip {
                            Text(point.longLabel + (q.isEmpty ? "" : " · \(q)"))
                                .font(.system(size: 10.5, weight: .semibold))
                                .foregroundStyle(Palette.textSecondary)
                            ChartTipRow(color: ChartInk.income, name: "Landed",
                                        value: CurrencyFormat.string(point.income, base, compact: true),
                                        emphasise: true)
                            ChartTipRow(color: ChartInk.outgo, name: "Spent",
                                        value: CurrencyFormat.string(point.outgo, base, compact: true))
                            if let avg = model.avgIncome, !point.incomePartial, !point.isCurrent {
                                ChartTipRow(color: nil, name: "vs typical month",
                                            value: String(format: "%+.0f%%", (point.income - avg) / avg * 100))
                            } else {
                                ChartTipRow(color: nil, name: "vs typical month", value: "not comparable")
                            }
                        }
                    }
                }
                .frame(height: 240)

                legend
            }
        }
    }

    /// Complete months are judged against the average. The rest are outlined, because an incomplete
    /// month held up against a full-month average always looks like a bad month.
    private func fill(for m: InsightsModel.MonthPoint) -> AnyShapeStyle {
        guard let avg = model.avgIncome, !m.incomePartial, !m.isCurrent else {
            return AnyShapeStyle(ChartInk.income.opacity(0.28))
        }
        return AnyShapeStyle(m.income >= avg ? ChartInk.income : ChartInk.neutral.opacity(0.65))
    }

    private var basis: String {
        guard let first = model.incomeWindow.firstRecord else { return "Nothing logged yet." }
        let start = ChartLabel.fullDate.string(from: first)
        guard model.avgIncome != nil else {
            return "Logging started \(start). No month has run start to finish yet, so there is nothing honest to average against."
        }
        var s = "Logging started \(start). The dashed line is the average of \(model.incomeWindow.basis) — "
        s += "partial and in-progress months are excluded from it and drawn faded."
        return s
    }

    private var legend: some View {
        HStack(spacing: 14) {
            legendItem(ChartInk.income, "above typical")
            legendItem(ChartInk.neutral.opacity(0.65), "below typical")
            legendItem(ChartInk.income.opacity(0.28), "partial · not judged")
            Spacer()
        }
        .padding(.top, 4)
    }

    private func legendItem(_ color: Color, _ label: String) -> some View {
        HStack(spacing: 5) {
            RoundedRectangle(cornerRadius: 2).fill(color).frame(width: 9, height: 9)
            Text(label).font(.system(size: 10.5)).foregroundStyle(Palette.textTertiary)
        }
    }
}

// MARK: - Cumulative (lifetime)

/// Everything earned, stacked up month on month. The lifetime tab's own chart — a bar per month
/// says the same thing as the other tabs; the climb says something they can't.
private struct CumulativeCard: View {
    let model: InsightsModel
    let base: String
    @State private var hover: Int?

    var body: some View {
        SectionCard(title: "Everything, adding up", subtitle: "Total earned to the end of each month",
                    accent: Palette.azure,
                    trailing: AnyView(
                        Text("\(model.monthsTracked) months tracked")
                            .font(.system(size: 11)).foregroundStyle(Palette.textTertiary))) {
            if model.cumulative.count < 2 {
                Text("Not enough months yet to draw a curve.")
                    .font(.system(size: 12)).foregroundStyle(Palette.textTertiary)
            } else {
                BasisNote(text: "From \(model.incomeWindow.firstRecord.map { ChartLabel.fullDate.string(from: $0) } ?? "the first record") to today. Each point is everything landed up to the end of that month.")

                let ceiling = max(1, model.cumulative.last?.running ?? 1)
                Chart {
                    ForEach(model.cumulative) { p in
                        AreaMark(x: .value("Month", Double(p.step)), y: .value("Total earned", p.running))
                            .foregroundStyle(LinearGradient(colors: [ChartInk.income.opacity(0.35), ChartInk.income.opacity(0.02)],
                                                            startPoint: .top, endPoint: .bottom))
                            .interpolationMethod(.monotone)
                        LineMark(x: .value("Month", Double(p.step)), y: .value("Total earned", p.running))
                            .foregroundStyle(ChartInk.income)
                            .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
                            .interpolationMethod(.monotone)
                    }
                }
                .chartXScale(domain: 1...Double(max(2, model.cumulative.count)))
                .chartYScale(domain: 0...(ceiling * 1.12))
                .chartXAxis {
                    AxisMarks(values: Array(stride(from: 1.0, through: Double(model.cumulative.count),
                                                   by: model.cumulative.count > 8 ? 2 : 1))) { value in
                        AxisValueLabel {
                            if let d = value.as(Double.self), let m = month(at: Int(d)) {
                                Text(ChartLabel.monthShort.string(from: m))
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
                .stepCursor(model.cumulative.count, hover: $hover) { step in
                    ChartTip {
                        Text(month(at: step).map { ChartLabel.monthYear.string(from: $0) } ?? "—")
                            .font(.system(size: 10.5, weight: .semibold))
                            .foregroundStyle(Palette.textSecondary)
                        ChartTipRow(color: ChartInk.income, name: "Total by then",
                                    value: CurrencyFormat.string(model.cumulative.first { $0.step == step }?.running ?? 0, base, compact: true),
                                    emphasise: true)
                        ChartTipRow(color: nil, name: "That month",
                                    value: CurrencyFormat.string(model.cumulative.first { $0.step == step }?.amount ?? 0, base, compact: true))
                    }
                }
                .frame(height: 240)
            }
        }
    }

    private func month(at step: Int) -> Date? {
        let i = step - 1
        guard i >= 0, i < model.months.count else { return nil }
        return model.months[i].month
    }
}

// MARK: - Quarters (year)

/// The year in four blocks. Twelve bars answer "which month"; four answer "is the year building or
/// fading", which is the question the year tab exists for.
private struct QuartersCard: View {
    let model: InsightsModel
    let base: String

    var body: some View {
        SectionCard(title: "The year in quarters", subtitle: "In and out, three months at a time",
                    accent: Palette.indigo,
                    trailing: AnyView(ChartLegend(items: [("In", ChartInk.income), ("Out", ChartInk.outgo)]))) {
            BasisNote(text: "Quarters that haven't finished are marked. Only whole quarters are worth comparing to each other.")

            let ceiling = max(1, model.quarters.flatMap { [$0.income, $0.outgo] }.max() ?? 1)
            Chart {
                ForEach(model.quarters) { q in
                    BarMark(x: .value("Quarter", q.name), y: .value("Landed", q.income), width: .ratio(0.34))
                        .position(by: .value("Direction", "In"), span: .ratio(0.8))
                        .foregroundStyle(ChartInk.income.opacity(q.complete ? 1 : 0.4))
                        .cornerRadius(3)
                    BarMark(x: .value("Quarter", q.name), y: .value("Spent", q.outgo), width: .ratio(0.34))
                        .position(by: .value("Direction", "Out"), span: .ratio(0.8))
                        .foregroundStyle(ChartInk.outgo.opacity(q.complete ? 1 : 0.4))
                        .cornerRadius(3)
                }
            }
            .chartYScale(domain: 0...(ceiling * 1.12))
            .chartXAxis {
                AxisMarks { value in
                    AxisValueLabel {
                        if let s = value.as(String.self) {
                            Text(s).font(.system(size: 10)).foregroundStyle(Palette.textTertiary)
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
            .frame(height: 190)

            Divider().overlay(Palette.hairline).padding(.vertical, 10)

            // The figures in text as well as bars, so nothing here depends on reading a height.
            StatRow {
                ForEach(Array(model.quarters.enumerated()), id: \.element.id) { i, q in
                    if i > 0 { StatDivider() }
                    StatCell(label: q.name + (q.complete ? "" : " · so far"),
                             value: CurrencyFormat.string(q.net, base, compact: true),
                             note: "in \(CurrencyFormat.abbreviated(q.income, base)) · out \(CurrencyFormat.abbreviated(q.outgo, base))",
                             tone: q.net >= 0 ? Palette.textPrimary : Palette.negative)
                }
            }
        }
    }
}

// MARK: - Pace

/// Where this month is heading, against the same days of the last one.
///
/// A month-to-date total can't tell you whether it's a good month; the same days of the previous
/// month can. Both lines are the same measure in the same units on one axis, and the earlier period
/// is dashed as well as a different hue so it reads as the reference even in greyscale.
private struct PaceCard: View {
    let model: InsightsModel
    let base: String
    @State private var hover: Int?

    private struct Point: Identifiable {
        var id: String { "\(series)-\(step)" }
        let step: Int
        let value: Double
        let series: String
    }

    private var unit: String { model.stepUnit == "day" ? "month" : "year" }

    private var series: [Point] {
        model.incomeNow.prefix(model.stepCursor).map {
            Point(step: $0.step, value: $0.running, series: "This \(unit)")
        } + model.incomePrior.map {
            Point(step: $0.step, value: $0.running, series: "Last \(unit)")
        }
    }

    var body: some View {
        let priorFinal = model.priorComplete ?? 0
        let nowSoFar = model.incomeNow.first { $0.step == model.stepCursor }?.running ?? 0
        let comparable = model.priorToDate != nil

        SectionCard(title: "Pace", subtitle: "Running total, day by day, against last \(unit)",
                    accent: Palette.azure,
                    trailing: AnyView(ChartLegend(items: [
                        ("This \(unit)", ChartInk.income), ("Last \(unit)", ChartInk.prior),
                    ]))) {
            BasisNote(text: verdict(soFar: nowSoFar, comparable: comparable))

            let ceiling = max(1, series.map(\.value).max() ?? 1)
            Chart {
                ForEach(series) { p in
                    LineMark(x: .value(model.stepUnit.capitalized, Double(p.step)),
                             y: .value("Running total", p.value),
                             series: .value("Period", p.series))
                        .foregroundStyle(p.series.hasPrefix("This") ? ChartInk.income : ChartInk.prior)
                        .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round,
                                               dash: p.series.hasPrefix("This") ? [] : [4, 3]))
                        .interpolationMethod(.monotone)
                }
            }
            .chartXScale(domain: 1...Double(max(2, model.stepCount)))
            .chartYScale(domain: 0...(ceiling * 1.12))
            .chartXAxis {
                AxisMarks(values: xTicks) { value in
                    AxisValueLabel {
                        if let d = value.as(Double.self) {
                            Text(xLabel(Int(d))).font(.system(size: 9.5))
                                .foregroundStyle(Palette.textTertiary)
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
            .stepCursor(model.stepCount, hover: $hover) { step in
                ChartTip {
                    Text(xTipLabel(step)).font(.system(size: 10.5, weight: .semibold))
                        .foregroundStyle(Palette.textSecondary)
                    ChartTipRow(color: ChartInk.income, name: "This \(unit)",
                                value: step <= model.stepCursor
                                    ? CurrencyFormat.string(running(model.incomeNow, step), base, compact: true)
                                    : "hasn't happened yet",
                                emphasise: true)
                    ChartTipRow(color: ChartInk.prior, name: "Last \(unit)",
                                value: comparable
                                    ? CurrencyFormat.string(running(model.incomePrior, step), base, compact: true)
                                    : "not logged")
                }
            }
            .frame(height: 215)

            Divider().overlay(Palette.hairline).padding(.vertical, 10)

            StatRow {
                StatCell(label: "Landed so far", value: CurrencyFormat.string(nowSoFar, base, compact: true),
                         note: "\(model.stepCursor) of \(model.stepCount) \(model.stepUnit)s in")
                StatDivider()
                StatCell(label: "On this pace",
                         value: model.canProject
                             ? CurrencyFormat.string(model.projectedIncome, base, compact: true) : "—",
                         note: model.canProject
                             ? "if the rest of the \(unit) matches so far"
                             : "too early in the \(unit) to project")
                StatDivider()
                StatCell(label: "Last \(unit) finished",
                         value: comparable ? CurrencyFormat.string(priorFinal, base, compact: true) : "—",
                         note: comparable ? "the line to beat" : "wasn't being logged in full")
                StatDivider()
                StatCell(label: "Typical month",
                         value: model.avgIncome.map { CurrencyFormat.string($0, base, compact: true) } ?? "—",
                         note: model.incomeWindow.basis)
            }
        }
    }

    private func running(_ points: [InsightsModel.StepPoint], _ step: Int) -> Double {
        points.last { $0.step <= step }?.running ?? 0
    }

    private var xTicks: [Double] {
        let n = model.stepCount
        if n <= 12 { return (1...max(2, n)).map(Double.init) }
        return Array(stride(from: 1.0, through: Double(n), by: 5))
    }

    private func xLabel(_ step: Int) -> String {
        model.stepUnit == "day" ? "\(step)" : monthName(step)
    }

    private func xTipLabel(_ step: Int) -> String {
        model.stepUnit == "day" ? "Day \(step)" : monthName(step)
    }

    private func monthName(_ i: Int) -> String {
        let symbols = PHT.calendar.shortMonthSymbols
        return (i >= 1 && i <= symbols.count) ? symbols[i - 1] : "\(i)"
    }

    private func verdict(soFar: Double, comparable: Bool) -> String {
        guard comparable, let priorAtSamePoint = model.priorToDate else {
            return "Last \(unit) wasn't being logged from start to finish, so there is nothing to compare this one against yet."
        }
        guard priorAtSamePoint > 0 else {
            return "Nothing had landed by this point last \(unit) — you're ahead of it."
        }
        let pct = (soFar - priorAtSamePoint) / priorAtSamePoint * 100
        let dir = pct >= 0 ? "ahead of" : "behind"
        let tail = model.canProject
            ? String(format: " On this pace the %@ finishes at %@.", unit,
                     CurrencyFormat.string(model.projectedIncome, base, compact: true))
            : ""
        return String(format: "%.0f%% %@ where you were by day %d last %@.%@",
                      abs(pct), dir, model.stepCursor, unit, tail)
    }
}

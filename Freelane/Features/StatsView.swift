import SwiftUI
import SwiftData
import Charts

/// Stats — "how is my freelance business actually doing?", top-down:
/// 1. HERO  — earned in the current scope (gold, the screen's one signature), 12-month
///    sparkline, delta vs last month.
/// 2. PULSE — supporting tiles: fees paid, avg payment, top-client concentration, clients earning.
/// 3. TREND — the 12-month income chart (hover for exact months, dashed 12-mo average).
/// 4. DETAIL — leaderboards: who pays the bills, which rails eat fees, the priciest
///    individual payments, and who pays slowly.
struct StatsView: View {
    @Query private var settings: [AppSettings]
    @Query private var rateRows: [ExchangeRate]
    @Query(filter: #Predicate<Payment> { $0.deletedAt == nil }) private var payments: [Payment]
    @Query(filter: #Predicate<Withdrawal> { $0.deletedAt == nil }) private var withdrawals: [Withdrawal]
    @Query(filter: #Predicate<Client> { $0.deletedAt == nil }) private var clients: [Client]
    @Query(filter: #Predicate<Project> { $0.deletedAt == nil }) private var projects: [Project]
    @Query private var allocations: [PaymentAllocation]

    @State private var sub = 0          // open on "This month" — the hero leads with NOW
    @State private var selMonth: Date?

    private func nearestMonth(_ d: Date) -> MonthBar? {
        byMonth.min { abs($0.month.timeIntervalSince(d)) < abs($1.month.timeIntervalSince(d)) }
    }
    private var base: String { settings.first?.baseCurrency ?? "PHP" }
    private var rates: Rates { Rates(base: base, rates: rateRows) }

    private var since: Date? {
        switch sub { case 0: return PHT.startOfMonth(); case 1: return PHT.startOfYear(); default: return nil }
    }
    private var scopedPayments: [Payment] { since.map { s in payments.filter { $0.paidAt >= s } } ?? payments }
    private var scopedWithdrawals: [Withdrawal] { since.map { s in withdrawals.filter { $0.withdrawnAt >= s } } ?? withdrawals }

    private var landed: Double { scopedPayments.reduce(0) { $0 + ($1.netAmountBase ?? 0) } }
    private var fees: Double {
        scopedPayments.filter { !$0.feeUnknown }.reduce(0) { $0 + ($1.impliedFeeBase ?? 0) }
        + scopedWithdrawals.reduce(0) { $0 + $1.feeBase }
    }
    private var feePct: Double { (landed + fees) > 0 ? fees / (landed + fees) : 0 }
    private var avg: Double { scopedPayments.isEmpty ? 0 : landed / Double(scopedPayments.count) }

    struct MonthBar: Identifiable { let id = UUID(); let month: Date; let total: Double }
    private var byMonth: [MonthBar] {
        let cal = PHT.calendar
        var map: [Date: Double] = [:]
        for p in payments {
            let comps = cal.dateComponents([.year, .month], from: p.paidAt)
            if let m = cal.date(from: comps) { map[m, default: 0] += (p.netAmountBase ?? 0) }
        }
        return map.map { MonthBar(month: $0.key, total: $0.value) }.sorted { $0.month < $1.month }.suffix(12).map { $0 }
    }
    private var monthlyAvg: Double { byMonth.isEmpty ? 0 : byMonth.reduce(0) { $0 + $1.total } / Double(byMonth.count) }

    /// This month vs last month, from the same 12-month aggregation the sparkline uses.
    private var monthDelta: (pct: Double, up: Bool)? {
        let thisM = PHT.startOfMonth()
        guard let lastM = PHT.calendar.date(byAdding: .month, value: -1, to: thisM) else { return nil }
        let cur = byMonth.first { $0.month == thisM }?.total ?? 0
        let prev = byMonth.first { $0.month == lastM }?.total ?? 0
        guard prev > 0 else { return nil }
        let pct = (cur - prev) / prev
        return (pct, pct >= 0)
    }

    // MARK: Money intelligence — net rate & fee leak by currency
    struct RouteRow: Identifiable { let id = UUID(); let currency: String; let netPct: Double; let feeBase: Double; let count: Int }
    private var routeRows: [RouteRow] {
        var g: [String: (gross: Double, net: Double, fee: Double, n: Int)] = [:]
        for p in scopedPayments where !p.feeUnknown {
            let net = p.netAmountBase ?? 0
            let gross = p.grossAtMarketBase ?? (net + (p.impliedFeeBase ?? 0))
            guard gross > 0 else { continue }
            var e = g[p.currency] ?? (0, 0, 0, 0)
            e.gross += gross; e.net += net; e.fee += (p.impliedFeeBase ?? 0); e.n += 1
            g[p.currency] = e
        }
        return g.map { RouteRow(currency: $0.key, netPct: $0.value.gross > 0 ? $0.value.net / $0.value.gross : 1, feeBase: $0.value.fee, count: $0.value.n) }
            .sorted { $0.feeBase > $1.feeBase }
    }
    private var priciest: RouteRow? { routeRows.filter { $0.count >= 1 && $0.netPct < 0.96 }.min { $0.netPct < $1.netPct } }

    struct ClientRow: Identifiable { let id = UUID(); let name: String; let earned: Double }
    /// Every client with earnings (lifetime, via project allocations), best first.
    private var clientEarnings: [ClientRow] {
        clients.map { c in
            let ps = projects.filter { $0.clientId == c.id }
            let earned = ps.reduce(0.0) { $0 + ProjectMath.paidBase(project: $1, allocations: allocations) }
            return ClientRow(name: c.name, earned: earned)
        }.filter { $0.earned > 0 }.sorted { $0.earned > $1.earned }
    }
    private var topClients: [ClientRow] { Array(clientEarnings.prefix(6)) }
    /// Concentration: how much of all earnings the single biggest client represents.
    private var topShare: (name: String, pct: Double)? {
        let total = clientEarnings.reduce(0) { $0 + $1.earned }
        guard total > 0, let top = clientEarnings.first else { return nil }
        return (top.name, top.earned / total)
    }
    private var clientTotal: Double { clientEarnings.reduce(0) { $0 + $1.earned } }

    /// Individual payments ranked by effective fee % (fee ÷ gross) — the actual reason to pick
    /// one rail over another.
    private var feeLeaders: [(payment: Payment, pct: Double)] {
        scopedPayments.filter { !$0.feeUnknown }
            .compactMap { p -> (Payment, Double)? in
                guard let gross = p.grossAtMarketBase, gross > 0, let fee = p.impliedFeeBase, fee > 0 else { return nil }
                return (p, fee / gross)
            }
            .sorted { $0.1 > $1.1 }.prefix(6).map { ($0.0, $0.1) }
    }

    private func payerName(_ p: Payment) -> String {
        guard let pid = p.projectId,
              let proj = projects.first(where: { $0.id == pid }),
              let c = clients.first(where: { $0.id == proj.clientId }) else { return "Payment" }
        return c.name
    }

    private struct LatencyRow: Identifiable { let id = UUID(); let name: String; let avgDays: Int; let n: Int }
    /// Average days from quoting a project to the client actually paying it off — who's slow, who's fast.
    private var paymentLatency: [LatencyRow] {
        clients.compactMap { c -> LatencyRow? in
            let paidProjects = projects.filter { $0.clientId == c.id && $0.status == .paid }
            var spans: [Int] = []
            for p in paidProjects {
                guard let last = payments.filter({ $0.projectId == p.id }).map({ $0.paidAt }).max() else { continue }
                let days = PHT.calendar.dateComponents([.day], from: p.quotedAt ?? p.createdAt, to: last).day ?? 0
                if days >= 0 { spans.append(days) }
            }
            guard !spans.isEmpty else { return nil }
            return LatencyRow(name: c.name, avgDays: spans.reduce(0, +) / spans.count, n: spans.count)
        }.sorted { $0.avgDays > $1.avgDays }.prefix(6).map { $0 }
    }

    // MARK: Body

    var body: some View {
        Page("Stats", subtitle: "How the business is actually doing.",
             subtabs: ["This month", "This year", "Lifetime"], selection: $sub) {
            if payments.isEmpty {
                EmptyStateCard(icon: "chart.bar",
                               title: "No income yet",
                               message: "Log your first payment and Stats will start answering how the business is doing — trend, fees, and who pays the bills.")
            } else {
                hero
                pulseGrid
                trendCard
                clientsCard
                railsCard
                feeLeaderCard
                latencyCard
            }
        }
    }

    // MARK: 1 · Hero — the answer to "how am I doing", in gold

    private var heroLabel: String {
        switch sub { case 0: return "Earned this month"; case 1: return "Earned this year"; default: return "Earned · lifetime" }
    }

    private var hero: some View {
        let spark = byMonth.map(\.total)
        var chips: [(text: String, icon: String?, color: Color)] = []
        if let d = monthDelta {
            chips.append((String(format: "%+.0f%% vs last month", d.pct * 100),
                          d.up ? "arrow.up.right" : "arrow.down.right",
                          d.up ? Palette.positive : Palette.negative))
        }
        chips.append(("\(scopedPayments.count) payments", "arrow.down.left", Palette.textSecondary))
        if fees > 0 {
            chips.append(("Fees −" + CurrencyFormat.abbreviated(fees, base), "scissors", Palette.negative))
        }
        return HeroTile(label: heroLabel, value: landed, code: base, accent: Palette.azure,
                        spark: spark.count > 1 ? spark : [0, 0], chips: chips)
    }

    // MARK: 2 · Pulse — supporting tiles

    private var pulseGrid: some View {
        let cols = [GridItem(.adaptive(minimum: 170), spacing: 12)]
        return LazyVGrid(columns: cols, spacing: 12) {
            MiniWidget(label: "Fees paid", value: CurrencyFormat.abbreviated(fees, base),
                       systemImage: "scissors", accent: Palette.negative,
                       sub: String(format: "%.1f%% of gross", feePct * 100),
                       tone: Palette.negative, destination: .payments)
            MiniWidget(label: "Avg payment", value: CurrencyFormat.abbreviated(avg, base),
                       systemImage: "equal.circle", accent: Palette.indigo,
                       sub: "across \(scopedPayments.count) payments")
            MiniWidget(label: "Top client share",
                       value: topShare.map { "\(Int($0.pct * 100))%" } ?? "—",
                       systemImage: "crown", accent: Palette.violet,
                       sub: topShare?.name ?? "No earnings yet",
                       destination: .clients)
            MiniWidget(label: "Clients earning", value: "\(clientEarnings.count)",
                       systemImage: "person.2", accent: Palette.cyan,
                       sub: "of \(clients.count) total", destination: .clients)
        }
    }

    // MARK: 3 · Trend — 12-month income, sparkline-aligned styling

    private var trendCard: some View {
        SectionCard(title: "Income trend", subtitle: "Net landed · last 12 months", accent: Palette.cyan,
                    trailing: byMonth.isEmpty ? nil : AnyView(
                        Text("12-mo avg " + CurrencyFormat.abbreviated(monthlyAvg, base))
                            .font(.system(size: 11)).foregroundStyle(Palette.textTertiary))) {
            if byMonth.isEmpty {
                Text("No data yet.").font(.system(size: 12)).foregroundStyle(Palette.textTertiary)
            } else {
                let maxV = max(1, byMonth.map(\.total).max() ?? 1)
                let selPt = selMonth.flatMap { nearestMonth($0) }
                HStack(spacing: 8) {
                    if let p = selPt {
                        Text(p.month.formatted(.dateTime.month(.abbreviated).year()))
                            .font(.system(size: 12, weight: .medium)).foregroundStyle(Palette.textSecondary)
                        Text(CurrencyFormat.string(p.total, base))
                            .font(.system(size: 14, weight: .semibold, design: .rounded)).foregroundStyle(Palette.positive)
                    } else {
                        Text("Hover a bar for the exact amount").font(.system(size: 11)).foregroundStyle(Palette.textTertiary)
                    }
                    Spacer()
                }
                Chart(byMonth) { m in
                    BarMark(x: .value("Month", m.month, unit: .month), y: .value("Net", m.total))
                        .foregroundStyle(LinearGradient(colors: [Palette.cyan, Palette.cyan.opacity(0.22)],
                                                        startPoint: .top, endPoint: .bottom))
                        .cornerRadius(4)
                        .opacity(selPt == nil || selPt?.month == m.month ? 1 : 0.35)
                    RuleMark(y: .value("Average", monthlyAvg))
                        .foregroundStyle(Palette.textTertiary.opacity(0.35))
                        .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 4]))
                    if let pt = selPt {
                        RuleMark(x: .value("Month", pt.month, unit: .month)).foregroundStyle(Palette.textTertiary.opacity(0.45))
                    }
                }
                .chartYScale(domain: 0...(maxV * 1.08))
                .chartXSelection(value: $selMonth)
                .chartYAxis { AxisMarks(position: .leading) { v in
                    AxisGridLine().foregroundStyle(Palette.hairline)
                    AxisValueLabel { if let d = v.as(Double.self) {
                        Text(CurrencyFormat.abbreviated(d, base)).font(.system(size: 10)).foregroundStyle(Palette.textTertiary)
                    } }
                } }
                .chartXAxis { AxisMarks(values: .stride(by: .month, count: 2)) { _ in
                    AxisGridLine().foregroundStyle(Palette.hairline)
                    AxisValueLabel(format: .dateTime.month(.abbreviated)).font(.system(size: 10)).foregroundStyle(Palette.textTertiary)
                } }
                .frame(height: 230)
            }
        }
    }

    // MARK: 4 · Detail — leaderboards

    /// Rank number, leaderboard style: tertiary, fixed column.
    private func rank(_ i: Int) -> some View {
        Text("\(i + 1)")
            .font(.system(size: 11, weight: .semibold, design: .rounded)).monospacedDigit()
            .foregroundStyle(Palette.textTertiary)
            .frame(width: 18, alignment: .center)
    }

    private var clientsCard: some View {
        SectionCard(title: "Who pays the bills", subtitle: "Top clients by lifetime earnings", accent: Palette.violet) {
            if topClients.isEmpty {
                Text("No earnings yet.").font(.system(size: 12)).foregroundStyle(Palette.textTertiary)
            } else {
                let maxEarned = max(1, topClients.first?.earned ?? 1)
                VStack(spacing: 8) {
                    ForEach(Array(topClients.enumerated()), id: \.element.id) { i, c in
                        HStack(spacing: 10) {
                            rank(i)
                            VStack(alignment: .leading, spacing: 5) {
                                HStack(spacing: 8) {
                                    Text(c.name).font(.system(size: 12.5, weight: .medium))
                                        .foregroundStyle(Palette.textPrimary).lineLimit(1)
                                    Spacer()
                                    if clientTotal > 0 {
                                        Text("\(Int(c.earned / clientTotal * 100))%")
                                            .font(.system(size: 10.5)).foregroundStyle(Palette.textTertiary)
                                    }
                                    Text(CurrencyFormat.string(c.earned, base, compact: true))
                                        .font(.system(size: 13, weight: .semibold, design: .rounded))
                                        .foregroundStyle(Palette.positive)
                                }
                                GeometryReader { geo in
                                    Capsule().fill(Palette.hairline)
                                        .overlay(alignment: .leading) {
                                            Capsule().fill(Palette.violet.opacity(0.75))
                                                .frame(width: geo.size.width * max(0.02, min(1, c.earned / maxEarned)))
                                        }
                                }.frame(height: 4)
                            }
                        }
                        .padding(.horizontal, 12).padding(.vertical, 9)
                        .insetRow(cornerRadius: Radii.row, hoverable: false)
                    }
                }
            }
        }
    }

    private var railsCard: some View {
        Group {
            if !routeRows.isEmpty {
                SectionCard(title: "Cost of getting paid", subtitle: "How much you keep after fees, by currency", accent: Palette.warning) {
                    if let p = priciest {
                        Label("\(p.currency) is your priciest route — you keep \(Int(p.netPct * 100))% after fees.",
                              systemImage: "exclamationmark.bubble")
                            .font(.system(size: 12)).foregroundStyle(Palette.warning)
                    }
                    VStack(spacing: 8) {
                        ForEach(Array(routeRows.enumerated()), id: \.element.id) { i, r in
                            HStack(spacing: 10) {
                                rank(i)
                                VStack(alignment: .leading, spacing: 5) {
                                    HStack(spacing: 8) {
                                        Text(r.currency).font(.system(size: 12.5, weight: .semibold)).foregroundStyle(Palette.textPrimary)
                                        Text("keeps \(Int(r.netPct * 100))%").font(.system(size: 11)).foregroundStyle(Palette.textSecondary)
                                        Spacer()
                                        Text("−\(CurrencyFormat.string(r.feeBase, base, compact: true))")
                                            .font(.system(size: 12.5, weight: .semibold, design: .rounded))
                                            .foregroundStyle(Palette.negative)
                                        Text("\(r.count) pmts").font(.system(size: 10)).foregroundStyle(Palette.textTertiary)
                                    }
                                    GeometryReader { geo in
                                        Capsule().fill(Palette.hairline)
                                            .overlay(alignment: .leading) {
                                                Capsule().fill(r.netPct >= 0.95 ? Palette.positive : Palette.warning)
                                                    .frame(width: geo.size.width * max(0, min(1, r.netPct)))
                                            }
                                    }.frame(height: 4)
                                }
                            }
                            .padding(.horizontal, 12).padding(.vertical, 9)
                            .insetRow(cornerRadius: Radii.row, hoverable: false)
                        }
                    }
                }
            }
        }
    }

    private var feeLeaderCard: some View {
        Group {
            if !feeLeaders.isEmpty {
                SectionCard(title: "Fee leaderboard", subtitle: "Your priciest payments by effective fee %", accent: Palette.negative) {
                    VStack(spacing: 8) {
                        ForEach(Array(feeLeaders.enumerated()), id: \.offset) { i, row in
                            HStack(spacing: 10) {
                                rank(i)
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(payerName(row.payment))
                                        .font(.system(size: 12.5, weight: .medium)).foregroundStyle(Palette.textPrimary).lineLimit(1)
                                    Text(row.payment.paidAt.formatted(.dateTime.month().day().year()))
                                        .font(.system(size: 10)).foregroundStyle(Palette.textTertiary)
                                }
                                Spacer()
                                Text("−\(CurrencyFormat.string(row.payment.impliedFeeBase ?? 0, base, compact: true))")
                                    .font(.system(size: 12.5, weight: .semibold, design: .rounded)).foregroundStyle(Palette.negative)
                                Text(String(format: "%.1f%%", row.pct * 100))
                                    .font(.system(size: 13, weight: .bold, design: .rounded))
                                    .foregroundStyle(row.pct > 0.05 ? Palette.negative : Palette.warning)
                                    .frame(width: 52, alignment: .trailing)
                            }
                            .padding(.horizontal, 12).padding(.vertical, 8)
                            .insetRow(cornerRadius: Radii.row, hoverable: false)
                        }
                    }
                }
            }
        }
    }

    private var latencyCard: some View {
        Group {
            if !paymentLatency.isEmpty {
                SectionCard(title: "Payment latency", subtitle: "Average days from quote to fully paid — slowest first", accent: Palette.indigo) {
                    VStack(spacing: 8) {
                        ForEach(Array(paymentLatency.enumerated()), id: \.element.id) { i, r in
                            HStack(spacing: 10) {
                                rank(i)
                                Text(r.name).font(.system(size: 12.5, weight: .medium)).foregroundStyle(Palette.textPrimary).lineLimit(1)
                                Text("\(r.n) paid").font(.system(size: 10.5)).foregroundStyle(Palette.textTertiary)
                                Spacer()
                                Text("\(r.avgDays)d").font(.system(size: 13, weight: .semibold, design: .rounded))
                                    .foregroundStyle(r.avgDays >= 30 ? Palette.negative : (r.avgDays >= 14 ? Palette.warning : Palette.positive))
                            }
                            .padding(.horizontal, 12).padding(.vertical, 9)
                            .insetRow(cornerRadius: Radii.row, hoverable: false)
                        }
                    }
                }
            }
        }
    }
}

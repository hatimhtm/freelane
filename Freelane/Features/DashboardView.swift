import SwiftUI
import SwiftData
import Charts
import UniformTypeIdentifiers

/// The main page: a bird's-eye over all of LifeOS in compact, tappable widgets
/// (money → projects → giving → body), Watch-face density. No wide cards.
struct DashboardView: View {
    @Environment(\.modelContext) private var context
    @Query private var settings: [AppSettings]
    @Query private var rateRows: [ExchangeRate]
    @Query(filter: #Predicate<Payment> { $0.deletedAt == nil }, sort: \Payment.paidAt, order: .reverse) private var payments: [Payment]
    @Query(filter: #Predicate<Withdrawal> { $0.deletedAt == nil }) private var withdrawals: [Withdrawal]
    @Query(filter: #Predicate<Project> { $0.deletedAt == nil }) private var projects: [Project]
    private var overdueProjects: Int { projects.filter { ($0.dueDate.map { $0 < PHT.startOfDay() } ?? false) && $0.status != .paid }.count }
    @Query(filter: #Predicate<Wallet> { $0.deletedAt == nil }) private var wallets: [Wallet]
    @Query private var ledger: [LedgerEntry]
    @Query private var allocations: [PaymentAllocation]
    @Query(filter: #Predicate<Client> { $0.deletedAt == nil }) private var clients: [Client]
    @Query(filter: #Predicate<Spend> { $0.deletedAt == nil }, sort: \Spend.spentAt, order: .reverse) private var spends: [Spend]
    @Query(filter: #Predicate<Loan> { $0.deletedAt == nil }) private var loans: [Loan]
    @Query(filter: #Predicate<BodyLog> { $0.deletedAt == nil }) private var bodyLogs: [BodyLog]
    @Query private var prayerLogs: [PrayerLog]
    @Query(filter: #Predicate<Recurring> { $0.deletedAt == nil }) private var recurrings: [Recurring]
    @Query(sort: \InsightLog.createdAt, order: .reverse) private var insights: [InsightLog]
    @Environment(AIManager.self) private var ai
    @Environment(\.navigate) private var navigate
    @State private var generatingInsights = false
    @AppStorage("dash.tileOrder") private var tileOrderRaw = ""
    @State private var draggingTile: String?

    private var base: String { settings.first?.baseCurrency ?? "PHP" }
    private var rates: Rates { Rates(base: base, rates: rateRows) }

    private var metrics: DashboardMetrics {
        MetricsCompute.dashboard(payments: payments, withdrawals: withdrawals, projects: projects,
                                 wallets: wallets, ledger: ledger, allocations: allocations, rates: rates)
    }
    private var safe: SafeBreakdown {
        SafeToSpend.compute(payments: payments, spends: spends, wallets: wallets, ledger: ledger, recurrings: recurrings)
    }

    private var greeting: String {
        switch PHT.calendar.component(.hour, from: .now) {
        case 5..<12: return "Good morning"
        case 12..<17: return "Good afternoon"
        default: return "Good evening"
        }
    }

    var body: some View {
        // Compute the heavy aggregates ONCE per render and thread them down. The chart's scrub
        // state now lives inside `CashFlowCard`, so hovering the chart no longer reruns the whole
        // money engine here (it used to recompute `metrics`/`safe` ~9× per hover).
        let m = metrics
        let s = safe
        let signals = focusSignals(m, s)
        return Page(greeting, subtitle: signals.isEmpty ? "All clear — everything at a glance." : "A few things need you.") {
            // Priority first: the few things actually worth a tap. When nothing needs you, the
            // calm weather banner takes this slot instead of a wall of equal-weight tiles.
            if signals.isEmpty {
                CalmWeatherBanner(safe: s, base: base, overdrawn: overdrawn, runwayDays: runway(s))
            } else {
                needsYouCard(signals)
            }
            hero(m, s)
            insightsCard
            grid(m, s)
            CashFlowCard(points: m.cashFlow, base: base)
        }
    }

    // MARK: Needs you — the prioritized attention surface

    /// One thing worth a tap right now. Severity orders them (overdrawn beats a prayer nudge).
    private struct FocusSignal: Identifiable {
        let id: String
        let icon: String
        let text: String
        let tint: Color
        let destination: Feature
        let severity: Int
    }

    /// What actually needs the user, derived only from already-computed money/life state — ranked.
    private func focusSignals(_ m: DashboardMetrics, _ s: SafeBreakdown) -> [FocusSignal] {
        var out: [FocusSignal] = []

        // Overdrawn holding wallets — the most urgent money state.
        let over = wallets.filter { $0.isHolding && !$0.archived && !$0.excludedFromTotals
            && WalletMath.balance(of: $0, ledger: ledger) < -$0.overdraftToleranceBase }
        if let w = over.first {
            let amt = abs(WalletMath.balance(of: w, ledger: ledger))
            out.append(.init(id: "overdrawn", icon: "exclamationmark.triangle.fill",
                text: over.count == 1 ? "\(w.name) is \(CurrencyFormat.abbreviated(amt, base)) overdrawn"
                                      : "\(over.count) wallets overdrawn",
                tint: Palette.negative, destination: .payments, severity: 100))
        }

        // Overdue projects.
        if overdueProjects > 0 {
            out.append(.init(id: "overdue", icon: "folder.badge.questionmark",
                text: "\(overdueProjects) project\(overdueProjects == 1 ? "" : "s") overdue",
                tint: Palette.warning, destination: .projects, severity: 80))
        }

        // Spending past today's safe-to-spend.
        if s.initialForToday > 0 && s.spentToday > s.initialForToday {
            out.append(.init(id: "overspent", icon: "cart.badge.minus",
                text: "Over today's safe-to-spend by \(CurrencyFormat.abbreviated(s.spentToday - s.initialForToday, base))",
                tint: Palette.negative, destination: .spending, severity: 70))
        } else if s.liveRemaining <= 0 {
            out.append(.init(id: "nosafe", icon: "shield.slash",
                text: "Nothing safe to spend left today", tint: Palette.warning, destination: .spending, severity: 55))
        }

        // A gentle evening nudge only — never during the day.
        if PHT.calendar.component(.hour, from: .now) >= 19 && prayedToday < 5 {
            let left = 5 - prayedToday
            out.append(.init(id: "prayers", icon: "moon.stars.fill",
                text: "\(left) prayer\(left == 1 ? "" : "s") left today",
                tint: Palette.violet, destination: .faith, severity: 30))
        }

        return out.sorted { $0.severity > $1.severity }
    }

    private func needsYouCard(_ signals: [FocusSignal]) -> some View {
        SectionCard(title: "Needs you", subtitle: "The few things worth a tap right now",
                    accent: signals.first?.tint ?? Palette.warning) {
            VStack(spacing: 8) {
                ForEach(signals.prefix(4)) { sig in
                    Button { navigate(sig.destination) } label: { signalRow(sig) }
                        .buttonStyle(.plain)
                }
            }
        }
    }

    private func signalRow(_ sig: FocusSignal) -> some View {
        HStack(spacing: 11) {
            ZStack {
                RoundedRectangle(cornerRadius: 9, style: .continuous).fill(sig.tint.opacity(0.16))
                    .frame(width: 30, height: 30)
                Image(systemName: sig.icon).font(.system(size: 13, weight: .semibold)).foregroundStyle(sig.tint)
            }
            Text(sig.text).font(.system(size: 13, weight: .medium)).foregroundStyle(Palette.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 6)
            Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold)).foregroundStyle(Palette.textTertiary)
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
    }

    // MARK: Hero

    private func hero(_ m: DashboardMetrics, _ safe: SafeBreakdown) -> some View {
        let spark = Array(m.cashFlow.suffix(30).map { $0.cumulative })
        return HeroTile(
            label: "Available across wallets",
            value: m.available, code: base, accent: Palette.azure,
            spark: spark.isEmpty ? [0, 0] : spark,
            chips: [
                ("Landed " + CurrencyFormat.abbreviated(m.landedMTD, base) + " MTD", "arrow.down", Palette.positive),
                ("Safe " + CurrencyFormat.abbreviated(safe.liveRemaining, base) + " today", "shield.lefthalf.filled", Palette.cyan),
                ("\(m.activeProjects) open projects", "folder", Palette.textSecondary),
            ])
    }

    // MARK: Cross-domain widget grid

    /// Each dashboard tile keyed by a stable id, so the grid can be reordered + persisted.
    private func tileSpecs(_ m: DashboardMetrics, _ safe: SafeBreakdown) -> [(key: String, view: AnyView)] {
        var specs: [(String, AnyView)] = [
            ("safe", AnyView(MiniWidget(label: "Safe to spend", value: CurrencyFormat.abbreviated(safe.liveRemaining, base),
                       systemImage: "shield.lefthalf.filled", accent: Palette.positive,
                       sub: "of " + CurrencyFormat.abbreviated(safe.initialForToday, base) + " today",
                       tone: Palette.positive, destination: .spending, morphID: "w.safe"))),
            ("spent", AnyView(MiniWidget(label: "Spent today", value: CurrencyFormat.abbreviated(safe.spentToday, base),
                       systemImage: "cart", accent: Palette.warning, destination: .spending, morphID: "w.spent"))),
            ("landed", AnyView(MiniWidget(label: "Landed this month", value: CurrencyFormat.abbreviated(m.landedMTD, base),
                       systemImage: "arrow.down.left", accent: Palette.positive,
                       sub: "YTD " + CurrencyFormat.abbreviated(m.landedYTD, base), destination: .payments, morphID: "w.landed"))),
            ("out", AnyView(MiniWidget(label: "Outstanding", value: CurrencyFormat.abbreviated(m.outstandingBase, base),
                       systemImage: "hourglass", accent: Palette.warning,
                       sub: "\(m.activeProjects) open", tone: Palette.warning, destination: .projects, morphID: "w.out"))),
            ("net", AnyView(MiniWidget(label: "Net · 30 days", value: CurrencyFormat.abbreviated(net30, base),
                       systemImage: "chart.line.uptrend.xyaxis", accent: Palette.azure,
                       tone: net30 < 0 ? Palette.negative : Palette.textPrimary, destination: .stats, morphID: "w.net"))),
            ("fees", AnyView(MiniWidget(label: "Fees this month", value: CurrencyFormat.abbreviated(m.feesMTD, base),
                       systemImage: "scissors", accent: Palette.negative, destination: .stats, morphID: "w.fees"))),
            ("proj", AnyView(MiniWidget(label: "Active projects", value: "\(m.activeProjects)",
                       systemImage: "folder", accent: overdueProjects > 0 ? Palette.warning : Palette.violet,
                       sub: overdueProjects > 0 ? "\(overdueProjects) overdue" : (paidThisMonth > 0 ? "\(paidThisMonth) paid this month" : nil),
                       destination: .projects, morphID: "w.proj"))),
            ("sadaka", AnyView(MiniWidget(label: "Sadaka given", value: CurrencyFormat.abbreviated(sadakaMTD, base),
                       systemImage: "heart.fill", accent: Palette.negative,
                       sub: "this month", destination: .sadaka, morphID: "w.sadaka"))),
        ]
        if loanOutstanding > 0 {
            specs.append(("loans", AnyView(MiniWidget(label: "Loans out", value: CurrencyFormat.abbreviated(loanOutstanding, base),
                       systemImage: "arrow.left.arrow.right", accent: Palette.teal,
                       sub: "\(openLoanCount) open", destination: .loans, morphID: "w.loans"))))
        }
        // Cross-link: the biggest month-over-month vendor swing (taps through to Vendors).
        if let mv = VendorTrends.biggest(spends), let d = mv.delta {
            let up = d > 0
            specs.append(("vendortrend", AnyView(MiniWidget(
                label: up ? "Spending up at" : "Spending down at", value: mv.name,
                systemImage: up ? "arrow.up.right.circle" : "arrow.down.right.circle",
                accent: up ? Palette.negative : Palette.positive,
                sub: "\(abs(Int((d * 100).rounded())))% vs last month",
                tone: up ? Palette.negative : Palette.positive,
                destination: .vendors, morphID: "w.vtrend"))))
        }
        specs.append(("sleep", AnyView(MiniWidget(label: "Sleep", value: lastSleep, systemImage: "bed.double.fill",
                       accent: Palette.indigo, sub: "last logged", destination: .body, morphID: "w.sleep"))))
        specs.append(("faith", AnyView(MiniWidget(label: "Prayers today", value: "\(prayedToday)/5", systemImage: "moon.stars.fill",
                       accent: Palette.violet, sub: prayedToday == 5 ? "complete" : nil, destination: .faith, morphID: "w.faith"))))
        return specs
    }

    private func grid(_ m: DashboardMetrics, _ safe: SafeBreakdown) -> some View {
        let cols = [GridItem(.adaptive(minimum: 158), spacing: 14)]
        let specs = tileSpecs(m, safe)
        let byKey = Dictionary(uniqueKeysWithValues: specs.map { ($0.key, $0.view) })
        // Stored order, then any new tiles appended in their natural order.
        let stored = tileOrderRaw.split(separator: ",").map(String.init)
        let order = stored.filter { byKey[$0] != nil } + specs.map { $0.key }.filter { !stored.contains($0) }
        return GlassGroup(spacing: 14) {
            LazyVGrid(columns: cols, spacing: 14) {
                ForEach(order, id: \.self) { key in
                    if let view = byKey[key] {
                        view
                            .opacity(draggingTile == key ? 0.35 : 1)
                            .onDrag { draggingTile = key; return NSItemProvider(object: key as NSString) }
                            .onDrop(of: [.text], delegate: TileDrop(key: key, order: order,
                                    dragging: $draggingTile, commit: { tileOrderRaw = $0.joined(separator: ",") }))
                    }
                }
            }
        }
    }

    /// Reorders dashboard tiles as you drag one over another; persists the new order.
    private struct TileDrop: DropDelegate {
        let key: String
        let order: [String]
        @Binding var dragging: String?
        let commit: ([String]) -> Void
        func dropEntered(info: DropInfo) {
            guard let from = dragging, from != key else { return }
            var new = order
            new.removeAll { $0 == from }
            let at = new.firstIndex(of: key) ?? new.count
            new.insert(from, at: at)
            if new != order { withAnimation(.snappy(duration: 0.2)) { commit(new) } }
        }
        func dropUpdated(info: DropInfo) -> DropProposal? { DropProposal(operation: .move) }
        func performDrop(info: DropInfo) -> Bool { dragging = nil; return true }
    }

    // MARK: AI insights (the accountant brain — accumulates over time)

    private var liveInsights: [InsightLog] { insights.filter { $0.dismissedAt == nil } }

    @ViewBuilder private var insightsCard: some View {
        let shown = Array(liveInsights.sorted { ($0.pinned ? 1 : 0, $0.createdAt) > ($1.pinned ? 1 : 0, $1.createdAt) }.prefix(4))
        SectionCard(title: "AI insights", subtitle: "What the assistant notices across your money & life",
                    accent: Palette.violet,
                    trailing: AnyView(
                        Button { refreshInsights() } label: {
                            Label(generatingInsights ? "Thinking…" : "Refresh", systemImage: "sparkles").font(.system(size: 11))
                        }.buttonStyle(.plain).foregroundStyle(Palette.violet)
                            .disabled(generatingInsights || !ai.isReady)
                            .opacity(generatingInsights || !ai.isReady ? 0.45 : 1)
                            .help(!ai.isReady ? "Add a brain in Settings → AI (local model or Gemini key) to enable insights" : "Regenerate insights from your latest data"))) {
            if shown.isEmpty {
                Text(!ai.isReady
                     ? "Add a brain in Settings → AI (local model or Gemini key), then I'll study your spending, journals, and habits and surface real insights here."
                     : "Tap Refresh and I'll read everything — your spending, journals, and patterns — and tell you what I notice. It gets sharper the more you log.")
                    .font(.system(size: 12)).foregroundStyle(Palette.textTertiary).frame(maxWidth: .infinity, alignment: .leading)
            } else {
                VStack(alignment: .leading, spacing: 9) {
                    ForEach(shown) { ins in
                        HStack(alignment: .top, spacing: 9) {
                            Image(systemName: insightIcon(ins.category)).font(.system(size: 12)).foregroundStyle(insightColor(ins.category)).frame(width: 16).padding(.top, 1)
                            Text(ins.text).font(.system(size: 12.5)).foregroundStyle(Palette.textPrimary).fixedSize(horizontal: false, vertical: true)
                            Spacer(minLength: 4)
                            Menu {
                                Button(ins.pinned ? "Unpin" : "Pin", systemImage: ins.pinned ? "pin.slash" : "pin") { ins.pinned.toggle(); ins.dirty = true; try? context.save() }
                                Button("Dismiss", systemImage: "xmark") { ins.dismissedAt = .now; ins.dirty = true; try? context.save() }
                            } label: { Image(systemName: "ellipsis").font(.system(size: 11)).foregroundStyle(Palette.textTertiary) }
                                .menuStyle(.borderlessButton).frame(width: 14)
                                .help("Pin or dismiss this insight")
                                .accessibilityLabel("Insight options")
                        }
                    }
                }
            }
        }
    }

    private func insightIcon(_ c: String) -> String {
        switch c { case "money": return "banknote.fill"; case "spending": return "cart.fill"; case "life": return "heart.fill"; default: return "lightbulb.fill" }
    }
    private func insightColor(_ c: String) -> Color {
        switch c { case "money": return Palette.positive; case "spending": return Palette.warning; case "life": return Palette.negative; default: return Palette.violet }
    }
    private func refreshInsights() {
        generatingInsights = true
        let ctx = context, mgr = ai
        Task { _ = await Brain.generateInsights(ctx, ai: mgr); await MainActor.run { generatingInsights = false } }
    }

    private var prayedToday: Int {
        let key = PHT.dayKey()
        return Set(prayerLogs.filter { $0.id.hasSuffix("|\(key)") }.map { $0.prayer }).count
    }

    // MARK: Derived values

    private var net30: Double {
        let start = PHT.daysAgo(30)
        return ledger.filter { $0.archivedAt == nil && $0.eventAt >= start }.reduce(0) { $0 + $1.amountBase }
    }
    private var overdrawn: Bool {
        wallets.filter { $0.isHolding && !$0.archived && !$0.excludedFromTotals }.contains { WalletMath.balance(of: $0, ledger: ledger) < -$0.overdraftToleranceBase }
    }
    private func runway(_ safe: SafeBreakdown) -> Double? {
        // Use the EVERYDAY pace (one-off / investment buys excluded) so a MacBook or a
        // big bill doesn't make your runway look tiny.
        let burn = SafeToSpend.typicalDailySpend(spends)
        return burn > 0 ? safe.walletTotal / burn : nil
    }
    private var sadakaMTD: Double {
        Sadaka.given(spends: spends, loans: loans, since: PHT.startOfMonth())
    }
    private var paidThisMonth: Int {
        let m = PHT.startOfMonth()
        return projects.filter { $0.status == .paid && ($0.completedAt ?? $0.updatedAt) >= m }.count
    }
    private var openLoans: [Loan] { loans.filter { $0.statusRaw == "open" || $0.statusRaw == "partially_returned" } }
    private var openLoanCount: Int { openLoans.count }
    private var loanOutstanding: Double { openLoans.reduce(0) { $0 + $1.outstandingBase } }
    private var lastSleep: String {
        guard let log = bodyLogs.filter({ $0.sleepHours != nil }).max(by: { $0.day < $1.day }),
              let h = log.sleepHours else { return "—" }
        return String(format: "%.1fh", h)
    }
}

// MARK: Cash flow chart
//
// A standalone view that OWNS its scrub state — so hovering the chart only re-renders the chart,
// not the parent Dashboard (which would otherwise recompute the whole money engine every frame).

private struct CashFlowCard: View {
    let points: [DashboardMetrics.DayPoint]
    let base: String
    @State private var scrubDate: Date?

    var body: some View {
        let pts = points
        return SectionCard(title: "Net cash flow", subtitle: "Cumulative across all wallets · 90 days",
                           accent: Palette.azure) {
            if pts.count < 2 {
                Text("Log a few payments to see your trajectory.")
                    .font(.system(size: 12)).foregroundStyle(Palette.textTertiary).frame(maxWidth: .infinity, minHeight: 60)
            } else {
                let scrubPt = scrubDate.flatMap { d in pts.min(by: { abs($0.date.timeIntervalSince(d)) < abs($1.date.timeIntervalSince(d)) }) }
                Chart {
                    ForEach(pts) { p in
                        AreaMark(x: .value("Date", p.date), y: .value("Balance", p.cumulative))
                            .interpolationMethod(.monotone)
                            .foregroundStyle(LinearGradient(colors: [Palette.azure.opacity(0.45), Palette.azure.opacity(0.02)],
                                                            startPoint: .top, endPoint: .bottom))
                        LineMark(x: .value("Date", p.date), y: .value("Balance", p.cumulative))
                            .interpolationMethod(.monotone)
                            .lineStyle(StrokeStyle(lineWidth: 2.5))
                            .foregroundStyle(LinearGradient(colors: [Palette.cyan, Palette.azure],
                                                            startPoint: .leading, endPoint: .trailing))
                    }
                    if let s = scrubPt {     // hover crosshair + value tooltip
                        RuleMark(x: .value("Date", s.date)).foregroundStyle(.white.opacity(0.22))
                            .annotation(position: .top, overflowResolution: .init(x: .fit(to: .chart), y: .disabled)) {
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(s.date, format: .dateTime.month(.abbreviated).day()).font(.system(size: 9)).foregroundStyle(Palette.textTertiary)
                                    Text(CurrencyFormat.string(s.cumulative, base, compact: true)).font(.system(size: 12, weight: .semibold, design: .rounded)).monospacedDigit().foregroundStyle(Palette.textPrimary)
                                }.padding(6).background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 8))
                            }
                        PointMark(x: .value("Date", s.date), y: .value("Balance", s.cumulative))
                            .foregroundStyle(Palette.cyan).symbolSize(70)
                    }
                }
                .chartXSelection(value: $scrubDate)
                .chartYAxis {
                    AxisMarks(position: .leading) { value in
                        AxisGridLine().foregroundStyle(.white.opacity(0.06))
                        AxisValueLabel {
                            if let v = value.as(Double.self) {
                                Text(CurrencyFormat.abbreviated(v, base)).foregroundStyle(Palette.textTertiary)
                            }
                        }
                    }
                }
                .chartXAxis {
                    AxisMarks(values: .stride(by: .day, count: 21)) { _ in
                        AxisGridLine().foregroundStyle(.white.opacity(0.05))
                        AxisValueLabel(format: .dateTime.month(.abbreviated).day()).foregroundStyle(Palette.textTertiary)
                    }
                }
                .frame(height: 220)
            }
        }
    }
}

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
    @Query private var plans: [Plan]
    @Query private var budgets: [CategoryBudget]
    @Query(sort: \InsightLog.createdAt, order: .reverse) private var insights: [InsightLog]
    @Environment(AIManager.self) private var ai
    @Environment(\.navigate) private var navigate
    @State private var generatingInsights = false
    @AppStorage("dash.tileOrder") private var tileOrderRaw = ""

    private var base: String { settings.first?.baseCurrency ?? "PHP" }
    private var rates: Rates { Rates(base: base, rates: rateRows) }

    private var metrics: DashboardMetrics {
        MetricsCompute.dashboard(payments: payments, withdrawals: withdrawals, projects: projects,
                                 wallets: wallets, ledger: ledger, allocations: allocations, rates: rates)
    }
    private var safe: SafeBreakdown {
        SafeToSpend.compute(payments: payments, spends: spends, wallets: wallets, ledger: ledger, recurrings: recurrings, plans: plans)
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
            // First run: without a wallet nothing can be logged (every capture path needs one),
            // so the landing screen leads with the one required setup step instead of ₱0 tiles.
            if wallets.filter({ $0.isHolding && !$0.archived }).isEmpty {
                EmptyStateCard(icon: "wallet.bifold",
                               title: "Start with a wallet",
                               message: "Add the places your money lives — a bank, GCash, cash. Everything you log flows through a wallet, so this one step unlocks spends, payments, and the rest of the app.",
                               actionLabel: "Add your first wallet") { navigate(.wallets) }
            } else {
                // A FRONT PAGE, not a stack of cards.
                //
                // Ordered by what you need, not by what's interesting: the balance you came for,
                // then the figures you check daily, then anything needing a decision, then what
                // the app noticed, then the shape of the quarter.
                //
                // The figures used to be a rail pinned to the right at a fixed 262pt, with a second
                // stacked branch for narrow windows. Two layouts to keep in sync, and on a wide
                // Mac window the rail was a thin strip of text beside a mostly-empty column. The
                // card grid reflows on its own — one layout, and the figures get the whole width.
                LeadFigure(
                    label: "Available across wallets",
                    amount: m.available, code: base,
                    context: leadContext(m, s),
                    spark: Array(m.cashFlow.suffix(30).map { $0.cumulative }))
                rail(m, s)
                if signals.isEmpty {
                    CalmWeatherBanner(safe: s, base: base, overdrawn: overdrawn, runwayDays: runway(s))
                } else {
                    needsYouCard(signals)
                }
                insightsCard
                CashFlowCard(points: m.cashFlow, base: base)
            }
        }
    }

    // MARK: The front page

    /// `runway` is optional (there's no runway without a spending pace) and returns a fractional
    /// Double — interpolating it raw once put "Optional(19.463007703879317)-day runway" on the
    /// front page. Build the line from parts that are each already formatted, and drop any that
    /// don't apply.
    private func leadContext(_ m: DashboardMetrics, _ s: SafeBreakdown) -> [String] {
        var bits = ["Safe " + CurrencyFormat.abbreviated(s.liveRemaining, base) + " today"]
        if let r = runway(s), r.isFinite, r > 0 { bits.append("\(Int(r.rounded()))-day runway") }
        if m.activeProjects > 0 {
            bits.append("\(m.activeProjects) open \(m.activeProjects == 1 ? "project" : "projects")")
        }
        return bits
    }

    /// The signal cards. What used to be a rail of aligned rows.
    ///
    /// The rail was better for dense comparison, but it made every number look equally fine — a
    /// tinted row at that density would have been noise, so nothing could carry a verdict. Cards
    /// can hold a tinted ground, and that ground does the reading for you: green is healthy, red
    /// needs you, plain is just a fact. You scan the colours and only stop on what isn't grey.
    private func rail(_ m: DashboardMetrics, _ s: SafeBreakdown) -> some View {
        let safeMood: SignalCard.Mood =
            s.liveRemaining <= 0 ? .bad : (s.liveRemaining < s.initialForToday * 0.25 ? .bad : .good)

        var cards: [SignalCard] = [
            SignalCard(label: "Safe to spend",
                       value: CurrencyFormat.abbreviated(s.liveRemaining, base),
                       sub: "of " + CurrencyFormat.abbreviated(s.initialForToday, base) + " today",
                       mood: safeMood, icon: "shield.lefthalf.filled", destination: .spending),
            SignalCard(label: "Spent today",
                       value: CurrencyFormat.abbreviated(s.spentToday, base), sub: nil,
                       mood: s.spentToday > s.initialForToday ? .bad : .neutral,
                       icon: "cart", destination: .spending),
            SignalCard(label: "Landed this month",
                       value: CurrencyFormat.abbreviated(m.landedMTD, base),
                       sub: "YTD " + CurrencyFormat.abbreviated(m.landedYTD, base),
                       mood: m.landedMTD > 0 ? .good : .neutral,
                       icon: "arrow.down.left", destination: .payments),
            SignalCard(label: "Owed to you",
                       value: CurrencyFormat.abbreviated(m.outstandingBase, base),
                       sub: "\(m.activeProjects) open",
                       mood: m.outstandingBase > 0 ? .bad : .neutral,
                       icon: "hourglass", destination: .projects),
            SignalCard(label: "Net · 30 days",
                       value: CurrencyFormat.abbreviated(net30, base), sub: nil,
                       mood: net30 < 0 ? .bad : .good,
                       icon: "chart.line.uptrend.xyaxis", destination: .stats),
            SignalCard(label: "Fees this month",
                       value: CurrencyFormat.abbreviated(m.feesMTD, base), sub: nil,
                       mood: m.feesMTD > 0 ? .bad : .neutral,
                       icon: "scissors", destination: .stats),
            SignalCard(label: "Active projects", value: "\(m.activeProjects)",
                       sub: overdueProjects > 0 ? "\(overdueProjects) overdue" : nil,
                       mood: overdueProjects > 0 ? .bad : .neutral,
                       icon: "folder", destination: .projects),
            SignalCard(label: "Sadaka this month",
                       value: CurrencyFormat.abbreviated(sadakaMTD, base), sub: nil,
                       mood: sadakaMTD > 0 ? .good : .neutral,
                       icon: "heart.fill", destination: .sadaka),
        ]
        if loanOutstanding > 0 {
            cards.append(SignalCard(label: "Loans out",
                                    value: CurrencyFormat.abbreviated(loanOutstanding, base),
                                    sub: "\(openLoanCount) open", mood: .neutral,
                                    icon: "arrow.left.arrow.right", destination: .loans))
        }
        if let mv = VendorTrends.biggest(spends), let d = mv.delta {
            let up = d > 0
            cards.append(SignalCard(label: up ? "Biggest riser" : "Biggest faller",
                                    value: mv.name,
                                    sub: "\(abs(Int((d * 100).rounded())))% vs last month",
                                    mood: up ? .bad : .good,
                                    icon: up ? "arrow.up.right.circle" : "arrow.down.right.circle",
                                    destination: .spending))
        }

        return LazyVGrid(columns: [GridItem(.adaptive(minimum: 168), spacing: 12)], spacing: 12) {
            ForEach(Array(cards.enumerated()), id: \.offset) { i, c in c.riseIn(i) }
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
        /// Deep-link straight to a client's detail sheet (the overdue-money signal).
        var clientId: UUID? = nil
    }

    /// The single biggest "someone owes you and it's been a while" — the #1 thing a freelancer
    /// opens the app for, previously computed everywhere and surfaced nowhere.
    private var topDebtor: (client: Client, outstanding: Double, days: Int)? {
        let live = ProjectMath.liveAllocations(allocations, payments: payments)
        var best: (Client, Double, Int)? = nil
        for c in clients where !c.archived {
            let owing = projects.filter { $0.clientId == c.id && ($0.status == .unpaid || $0.status == .partiallyPaid) }
            guard !owing.isEmpty else { continue }
            let out = owing.reduce(0.0) { $0 + rates.toBase(ProjectMath.outstandingNative(project: $1, allocations: live, rates: rates), $1.currency) }
            guard out >= 1 else { continue }
            let oldest = owing.map(\.agingAnchor).min() ?? .now
            let days = PHT.calendar.dateComponents([.day], from: oldest, to: .now).day ?? 0
            if days >= 21, out > (best?.1 ?? 0) { best = (c, out, days) }
        }
        return best.map { (client: $0.0, outstanding: $0.1, days: $0.2) }
    }

    /// What actually needs the user, derived only from already-computed money/life state — ranked.
    private func focusSignals(_ m: DashboardMetrics, _ s: SafeBreakdown) -> [FocusSignal] {
        var out: [FocusSignal] = []

        // Overdrawn holding wallets — only a MEANINGFUL overdraft (past the wallet's tolerance by
        // at least ₱1). A sub-peso / floating-point-dust negative used to surface the nonsensical
        // "₱0 overdrawn"; now trivial negatives are ignored and the real amount is shown.
        let over = wallets.filter {
            $0.isHolding && !$0.archived && !$0.excludedFromTotals
            && -WalletMath.balance(of: $0, ledger: ledger) - $0.overdraftToleranceBase >= 1
        }
        if let w = over.first {
            let amt = abs(WalletMath.balance(of: w, ledger: ledger))
            out.append(.init(id: "overdrawn", icon: "exclamationmark.triangle.fill",
                text: over.count == 1 ? "\(w.name) is \(CurrencyFormat.string(amt, base, compact: true)) overdrawn"
                                      : "\(over.count) wallets overdrawn",
                tint: Palette.negative, destination: .payments, severity: 100))
        }

        // Someone owes you and it's been ≥3 weeks — taps straight into that client (where the
        // AI nudge-drafter lives), not a generic list.
        if let d = topDebtor {
            out.append(.init(id: "debtor", icon: "person.crop.circle.badge.exclamationmark",
                text: "\(d.client.name) owes \(CurrencyFormat.string(d.outstanding, base, compact: true)) · \(d.days) days",
                tint: Palette.warning, destination: .clients, severity: 85, clientId: d.client.id))
        }

        // Overdue projects.
        if overdueProjects > 0 {
            out.append(.init(id: "overdue", icon: "folder.badge.questionmark",
                text: "\(overdueProjects) project\(overdueProjects == 1 ? "" : "s") overdue",
                tint: Palette.warning, destination: .projects, severity: 80))
        }

        // Spending past today's safe-to-spend.
        // Everyday spend only — a big one-off/investment was never part of the day's budget,
        // so it can't fire this alarm (matches the allowance's own one-off exclusion).
        if s.initialForToday > 0 && s.everydaySpentToday > s.initialForToday {
            out.append(.init(id: "overspent", icon: "cart.badge.minus",
                text: "Over today's safe-to-spend by \(CurrencyFormat.abbreviated(s.everydaySpentToday - s.initialForToday, base))",
                tint: Palette.negative, destination: .spending, severity: 70))
        } else if s.liveRemaining <= 0 {
            out.append(.init(id: "nosafe", icon: "shield.slash",
                text: "Nothing safe to spend left today", tint: Palette.warning, destination: .spending, severity: 55))
        }

        // A category blew through its monthly budget — surface the worst one.
        let totals = CategoryBudget.monthTotals(spends)
        if let worst = budgets.filter({ $0.capBase > 0 })
            .map({ (b: $0, over: (totals[$0.tag.lowercased()] ?? 0) - $0.capBase) })
            .filter({ $0.over >= 1 })
            .max(by: { $0.over < $1.over }) {
            out.append(.init(id: "budget", icon: "gauge.with.needle",
                text: "\(worst.b.tag) is \(CurrencyFormat.abbreviated(worst.over, base)) over its monthly budget",
                tint: Palette.warning, destination: .spending, severity: 60))
        }

        return out.sorted { $0.severity > $1.severity }
    }

    private func needsYouCard(_ signals: [FocusSignal]) -> some View {
        SectionCard(title: "Needs you", subtitle: "The few things worth a tap right now",
                    accent: signals.first?.tint ?? Palette.warning) {
            VStack(spacing: 8) {
                ForEach(signals.prefix(4)) { sig in
                    Button {
                        navigate(sig.destination)
                        if let cid = sig.clientId {
                            // Land on Clients with that client's detail already open. Posted a beat
                            // later so the freshly-mounted ClientsView is subscribed before it fires.
                            DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
                                NotificationCenter.default.post(name: .flOpenClient, object: nil,
                                                                userInfo: ["clientId": cid.uuidString])
                            }
                        }
                    } label: { signalRow(sig) }
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
                ("Safe " + CurrencyFormat.abbreviated(safe.liveRemaining, base) + " today", "shield.lefthalf.filled", Palette.azure),
                ("\(m.activeProjects) open projects", "folder", Palette.textSecondary),
            ])
    }

    // MARK: Cross-domain widget grid

    /// Each dashboard tile keyed by a stable id, so the grid can be reordered + persisted.
    private func tileSpecs(_ m: DashboardMetrics, _ safe: SafeBreakdown) -> [(key: String, view: AnyView)] {
        // Calm grid: tiles wear the section's ONE amber identity; color appears only when it
        // MEANS something (a negative net, an overdue count, a vendor swing) — not as decor.
        var specs: [(String, AnyView)] = [
            ("safe", AnyView(MiniWidget(label: "Safe to spend", value: CurrencyFormat.abbreviated(safe.liveRemaining, base),
                       systemImage: "shield.lefthalf.filled", accent: Palette.azure,
                       sub: "of " + CurrencyFormat.abbreviated(safe.initialForToday, base) + " today",
                       destination: .spending, morphID: "w.safe"))),
            ("spent", AnyView(MiniWidget(label: "Spent today", value: CurrencyFormat.abbreviated(safe.spentToday, base),
                       systemImage: "cart", accent: Palette.azure, destination: .spending, morphID: "w.spent"))),
            ("landed", AnyView(MiniWidget(label: "Landed MTD", value: CurrencyFormat.abbreviated(m.landedMTD, base),
                       systemImage: "arrow.down.left", accent: Palette.azure,
                       sub: "YTD " + CurrencyFormat.abbreviated(m.landedYTD, base), destination: .payments, morphID: "w.landed"))),
            ("out", AnyView(MiniWidget(label: "Outstanding", value: CurrencyFormat.abbreviated(m.outstandingBase, base),
                       systemImage: "hourglass", accent: Palette.azure,
                       sub: "\(m.activeProjects) open", destination: .projects, morphID: "w.out"))),
            ("net", AnyView(MiniWidget(label: "Net · 30 days", value: CurrencyFormat.abbreviated(net30, base),
                       systemImage: "chart.line.uptrend.xyaxis", accent: Palette.azure,
                       tone: net30 < 0 ? Palette.negative : Palette.textPrimary, destination: .stats, morphID: "w.net"))),
            ("fees", AnyView(MiniWidget(label: "Fees MTD", value: CurrencyFormat.abbreviated(m.feesMTD, base),
                       systemImage: "scissors", accent: Palette.azure, destination: .stats, morphID: "w.fees"))),
            ("proj", AnyView(MiniWidget(label: "Active", value: "\(m.activeProjects)",
                       systemImage: "folder", accent: overdueProjects > 0 ? Palette.warning : Palette.azure,
                       sub: overdueProjects > 0 ? "\(overdueProjects) overdue" : (paidThisMonth > 0 ? "\(paidThisMonth) paid this month" : nil),
                       destination: .projects, morphID: "w.proj"))),
            ("sadaka", AnyView(MiniWidget(label: "Sadaka", value: CurrencyFormat.abbreviated(sadakaMTD, base),
                       systemImage: "heart.fill", accent: Palette.azure,
                       sub: "this month", destination: .sadaka, morphID: "w.sadaka"))),
        ]
        if loanOutstanding > 0 {
            specs.append(("loans", AnyView(MiniWidget(label: "Loans out", value: CurrencyFormat.abbreviated(loanOutstanding, base),
                       systemImage: "arrow.left.arrow.right", accent: Palette.azure,
                       sub: "\(openLoanCount) open", destination: .loans, morphID: "w.loans"))))
        }
        // Cross-link: the biggest month-over-month vendor swing (taps through to Vendors).
        if let mv = VendorTrends.biggest(spends), let d = mv.delta {
            let up = d > 0
            specs.append(("vendortrend", AnyView(MiniWidget(
                label: up ? "Biggest riser" : "Biggest faller", value: mv.name,
                systemImage: up ? "arrow.up.right.circle" : "arrow.down.right.circle",
                accent: up ? Palette.negative : Palette.positive,
                sub: "\(abs(Int((d * 100).rounded())))% vs last month",
                tone: up ? Palette.negative : Palette.positive,
                destination: .spending, morphID: "w.vtrend"))))
        }
        specs.append(("sleep", AnyView(MiniWidget(label: "Sleep", value: lastSleep, systemImage: "bed.double.fill",
                       accent: Palette.azure, sub: "last logged", destination: .body, morphID: "w.sleep"))))
        return specs
    }

    private func grid(_ m: DashboardMetrics, _ safe: SafeBreakdown) -> some View {
        let cols = [GridItem(.adaptive(minimum: 158), spacing: 14)]
        let specs = tileSpecs(m, safe)
        let byKey = Dictionary(uniqueKeysWithValues: specs.map { ($0.key, $0.view) })
        // Stored order, then any new tiles appended in their natural order.
        let stored = tileOrderRaw.split(separator: ",").map(String.init)
        let order = stored.filter { byKey[$0] != nil } + specs.map { $0.key }.filter { !stored.contains($0) }
        let tiles = order.compactMap { key in byKey[key].map { Tile(id: key, view: $0) } }
        // macOS 27's native reorder API — replaces the old onDrag/DropDelegate machinery, and
        // gets the system pickup/settle animation + Golden Gate drop styling for free.
        return GlassGroup(spacing: 14) {
            LazyVGrid(columns: cols, spacing: 14) {
                ForEach(tiles) { $0.view }
                    .reorderable()
            }
            .reorderContainer(for: Tile.self) { diff in
                var new = order.filter { !diff.sources.contains($0) }
                switch diff.destination.position {
                case .before(let target):
                    let at = new.firstIndex(of: target) ?? new.count
                    new.insert(contentsOf: diff.sources, at: at)
                case .end:
                    new.append(contentsOf: diff.sources)
                }
                withAnimation(Motion.snappy) { tileOrderRaw = new.joined(separator: ",") }
            }
        }
    }

    /// One dashboard tile keyed for the reorder container.
    private struct Tile: Identifiable {
        let id: String
        let view: AnyView
    }

    // MARK: Observations — what the data actually shows, and nothing more

    private var liveInsights: [InsightLog] { insights.filter { $0.dismissedAt == nil } }

    @ViewBuilder private var insightsCard: some View {
        let shown = Array(liveInsights.sorted { ($0.pinned ? 1 : 0, $0.createdAt) > ($1.pinned ? 1 : 0, $1.createdAt) }.prefix(4))
        SectionCard(title: "What Freelane noticed", subtitle: "Only patterns it can point at in your own numbers",
                    accent: Palette.violet,
                    trailing: AnyView(
                        Button { refreshInsights() } label: {
                            Label(generatingInsights ? "Thinking…" : "Refresh", systemImage: "sparkles").font(.system(size: 11))
                        }.buttonStyle(.plain).foregroundStyle(Palette.violet)
                            .disabled(generatingInsights || !ai.isReady)
                            .opacity(generatingInsights ? 0.45 : 1)
                            .help("Recompute from your latest rows"))) {
            if shown.isEmpty {
                // No AI in this copy any more, because there is no AI in this feature: observations
                // are arithmetic over the user's own rows, so "nothing to say" means nothing moved
                // enough to be worth a sentence — not that a model failed or a key is missing.
                Text("Nothing has moved enough this month to be worth pointing at. This fills in as your spending and entries build up — every line is a comparison you can check yourself.")
                    .font(.system(size: 12)).foregroundStyle(Palette.textTertiary)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                VStack(alignment: .leading, spacing: 11) {
                    ForEach(shown) { ins in
                        ObservationRow(
                            text: ins.text,
                            pinned: ins.pinned,
                            onPin: { ins.pinned.toggle(); ins.dirty = true; try? context.save() },
                            onDismiss: { ins.dismissedAt = .now; ins.dirty = true; try? context.save() })
                    }
                }
            }
        }
    }
    private func refreshInsights() {
        generatingInsights = true
        let ctx = context, mgr = ai
        Task { _ = await Brain.generateObservations(ctx, ai: mgr); await MainActor.run { generatingInsights = false } }
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
        // What the line actually is, in a sentence, plus the one number it exists to give you.
        let net = (pts.last?.cumulative ?? 0) - (pts.first?.cumulative ?? 0)
        let up = net >= 0
        return SectionCard(
            title: up ? "You're up over 90 days" : "You're down over 90 days",
            subtitle: pts.count < 2
                ? "Every payment in and every spend out, added up day by day."
                : "\(up ? "+" : "−")\(CurrencyFormat.string(abs(net), base, compact: true)) since \(pts.first?.date.formatted(.dateTime.month().day()) ?? ""). Rising means you took in more than you spent.",
            accent: Palette.azure) {
            if pts.count < 2 {
                Text("Log a few payments to see your trajectory.")
                    .font(.system(size: 12)).foregroundStyle(Palette.textTertiary).frame(maxWidth: .infinity, minHeight: 60)
            } else {
                let scrubPt = scrubDate.flatMap { d in pts.min(by: { abs($0.date.timeIntervalSince(d)) < abs($1.date.timeIntervalSince(d)) }) }
                let lo = pts.map(\.cumulative).min() ?? 0
                let hi = pts.map(\.cumulative).max() ?? 0
                let crossesZero = lo < 0 && hi > 0

                Chart {
                    // The fill is split at zero and coloured by SIDE, not by brand.
                    //
                    // It used to be one blue gradient regardless of whether you were up or under.
                    // On a cumulative cash-flow line the single most important fact is which side
                    // of zero you're on, and the chart was spending its only colour saying nothing.
                    ForEach(pts) { p in
                        AreaMark(
                            x: .value("Date", p.date),
                            yStart: .value("Zero", 0),
                            yEnd: .value("Balance", p.cumulative))
                            .interpolationMethod(.monotone)
                            .foregroundStyle(
                                p.cumulative >= 0
                                    ? LinearGradient(colors: [Palette.positive.opacity(0.34), Palette.positive.opacity(0.02)],
                                                     startPoint: .top, endPoint: .bottom)
                                    : LinearGradient(colors: [Palette.negative.opacity(0.04), Palette.negative.opacity(0.30)],
                                                     startPoint: .top, endPoint: .bottom))
                    }

                    ForEach(pts) { p in
                        LineMark(x: .value("Date", p.date), y: .value("Balance", p.cumulative))
                            .interpolationMethod(.monotone)
                            .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
                            .foregroundStyle(Palette.textPrimary.opacity(0.75))
                    }

                    // Zero, drawn only when the line actually crosses it — a baseline you never
                    // touch is furniture.
                    if crossesZero {
                        RuleMark(y: .value("Zero", 0))
                            .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 3]))
                            .foregroundStyle(Palette.textTertiary.opacity(0.5))
                    }

                    // Where you are today — the chart's conclusion, marked.
                    if let last = pts.last, scrubPt == nil {
                        PointMark(x: .value("Date", last.date), y: .value("Balance", last.cumulative))
                            .foregroundStyle(last.cumulative >= 0 ? Palette.positive : Palette.negative)
                            .symbolSize(64)
                            .annotation(position: .top, spacing: 5, overflowResolution: .init(x: .fit(to: .chart), y: .disabled)) {
                                Text(CurrencyFormat.abbreviated(last.cumulative, base))
                                    .font(Typo.rowFigure(11)).monospacedDigit()
                                    .foregroundStyle(Palette.textSecondary)
                            }
                    }

                    if let s = scrubPt {
                        RuleMark(x: .value("Date", s.date))
                            .lineStyle(StrokeStyle(lineWidth: 1))
                            .foregroundStyle(Palette.textTertiary.opacity(0.4))
                            .annotation(position: .top, overflowResolution: .init(x: .fit(to: .chart), y: .disabled)) {
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(s.date, format: .dateTime.month(.abbreviated).day())
                                        .font(.system(size: 9)).foregroundStyle(Palette.textTertiary)
                                    Text(CurrencyFormat.string(s.cumulative, base, compact: true))
                                        .font(Typo.rowFigure(12)).monospacedDigit().foregroundStyle(Palette.textPrimary)
                                }
                                .padding(.horizontal, 8).padding(.vertical, 6)
                                .background(Palette.card, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(Palette.cardEdge, lineWidth: 0.7))
                                .shadow(color: .black.opacity(0.18), radius: 6, y: 2)
                            }
                        PointMark(x: .value("Date", s.date), y: .value("Balance", s.cumulative))
                            .foregroundStyle(s.cumulative >= 0 ? Palette.positive : Palette.negative)
                            .symbolSize(64)
                    }
                }
                .chartXSelection(value: $scrubDate)
                .chartYAxis {
                    // Three labels, no grid. The old version drew a full horizontal grid behind a
                    // filled area chart, so every ruling passed through the fill and muddied it.
                    AxisMarks(position: .leading, values: .automatic(desiredCount: 3)) { value in
                        AxisValueLabel {
                            if let v = value.as(Double.self) {
                                Text(CurrencyFormat.abbreviated(v, base))
                                    .font(.system(size: 9.5)).foregroundStyle(Palette.textTertiary)
                            }
                        }
                    }
                }
                .chartXAxis {
                    AxisMarks(values: .stride(by: .day, count: 30)) { _ in
                        AxisValueLabel(format: .dateTime.month(.abbreviated))
                            .font(.system(size: 9.5))
                            .foregroundStyle(Palette.textTertiary)
                    }
                }
                .chartPlotStyle { $0.padding(.top, 18).padding(.bottom, 2) }
                .frame(height: 220)
            }
        }
    }
}

/// One computed observation.
///
/// No leading icon: four rows each led by a differently-coloured glyph turned a card of four
/// sentences into a card of four badges, and the icon carried no information the sentence didn't.
/// A hairline rule marks the row instead, and the pin/dismiss control appears only on hover — a
/// permanently-visible ⋯ on every row is clutter on a surface whose whole job is to be read.
private struct ObservationRow: View {
    let text: String
    let pinned: Bool
    let onPin: () -> Void
    let onDismiss: () -> Void
    @State private var hovering = false

    var body: some View {
        HStack(alignment: .top, spacing: 11) {
            RoundedRectangle(cornerRadius: 1, style: .continuous)
                .fill(pinned ? Palette.azure : Palette.textTertiary.opacity(0.45))
                .frame(width: 2, height: 15)
                .padding(.top, 3)
            Text(text)
                .font(.system(size: 12.5))
                .foregroundStyle(Palette.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 6)
            HStack(spacing: 4) {
                if hovering || pinned {
                    Button(action: onPin) {
                        Image(systemName: pinned ? "pin.fill" : "pin")
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundStyle(pinned ? Palette.azure : Palette.textTertiary)
                    }.buttonStyle(.iconPress).help(pinned ? "Unpin" : "Keep this at the top")
                }
                if hovering {
                    Button(action: onDismiss) {
                        Image(systemName: "xmark")
                            .font(.system(size: 9, weight: .bold))
                            .foregroundStyle(Palette.textTertiary)
                    }.buttonStyle(.iconPress).help("Dismiss")
                }
            }
            .padding(.top, 1)
        }
        .contentShape(Rectangle())
        .onHover { hovering = $0 }
        .animation(.easeOut(duration: 0.12), value: hovering)
    }
}

import SwiftUI
import SwiftData

/// The eight places plus Settings. Order and grouping follow the rail.
enum Place: String, CaseIterable, Identifiable {
    case now, ledger, bills, wallets, work, insights, giving, journal, settings
    var id: String { rawValue }
    var title: String {
        switch self {
        case .now: return "Now"; case .ledger: return "Ledger"; case .bills: return "Bills"; case .wallets: return "Wallets"
        case .work: return "Work"; case .insights: return "Insights"; case .giving: return "Giving"; case .journal: return "Journal"
        case .settings: return "Settings"
        }
    }
    var glyph: String {
        switch self {
        case .now: return Sym.home; case .ledger: return Sym.receiptLong; case .bills: return Sym.calendarMonth
        case .wallets: return Sym.accountBalanceWallet; case .work: return Sym.work; case .insights: return Sym.insights
        case .giving: return Sym.volunteerActivism; case .journal: return Sym.autoStories; case .settings: return Sym.settings
        }
    }
    /// ⌘1…⌘8 in rail order.
    var shortcut: KeyEquivalent? {
        guard let i = Place.allCases.firstIndex(of: self), i < 8 else { return nil }
        return KeyEquivalent(Character(String(i + 1)))
    }
}

/// What the "New" menu can start.
enum NewAction: String, CaseIterable, Identifiable {
    case spending, moneyIn, move, count, payBill, journal
    var id: String { rawValue }
    var title: String {
        switch self {
        case .spending: return "Spending"; case .moneyIn: return "Money in"; case .move: return "Move money"
        case .count: return "Count wallets"; case .payBill: return "Pay a bill"; case .journal: return "Journal entry"
        }
    }
    var glyph: String {
        switch self {
        case .spending: return Sym.shoppingBag; case .moneyIn: return Sym.southWest; case .move: return Sym.swapHoriz
        case .count: return Sym.factCheck; case .payBill: return Sym.calendarMonth; case .journal: return Sym.edit
        }
    }
}

/// App-wide navigation and sheet state for v2.
@Observable final class AppState {
    var page: Place = .now
    var newMenuOpen = false
    var counting = false
    var sheet: NewAction? = nil
    func go(_ p: Place) { page = p; newMenuOpen = false }
    func start(_ a: NewAction) {
        newMenuOpen = false
        if a == .count { counting = true } else if a == .journal { page = .journal } else { sheet = a }
    }
}

/// The v2 window: rail on the window background, white panes on the right.
struct Shell: View {
    @Environment(\.modelContext) private var context
    @Environment(\.accessibilityReduceMotion) private var reduce
    @State private var app = AppState()
    @Query private var wallets: [Wallet]
    @Query private var ledger: [LedgerEntry]
    @Query private var recurring: [Recurring]
    @Query(sort: \Spend.spentAt, order: .reverse) private var spends: [Spend]
    @Query private var payments: [Payment]
    @Query private var withdrawals: [Withdrawal]
    @Query private var projects: [Project]
    @Query private var clients: [Client]
    @Query private var rateRows: [ExchangeRate]
    @Query private var settings: [AppSettings]

    /// One money picture per change in the store, shared by every page and the rail.
    private var money: MoneyState {
        MoneyState.build(wallets: wallets, ledger: ledger, recurring: recurring, spends: spends, payments: payments,
                         withdrawals: withdrawals, projects: projects, clients: clients,
                         rates: Rates(base: settings.first?.baseCurrency ?? "PHP", rates: rateRows))
    }

    var body: some View {
        let money = self.money
        ZStack(alignment: .topLeading) {
            Surface.window.ignoresSafeArea()
            HStack(spacing: 12) {
                Rail(app: app, needs: money.needs.count)
                    .frame(width: 232)
                pages(money)
                    .padding([.top, .bottom, .trailing], 12)
            }
            if app.newMenuOpen {
                NewMenu(app: app)
                    .transition(.opacity)
                    .zIndex(10)
            }
        }
        .ignoresSafeArea()
        .environment(app)
        .animation(Flow.pick(Flow.spatial, reduce: reduce), value: app.newMenuOpen)
        .background(PageShortcuts(app: app))
        .task { await LaunchV2.run(context) }
        .onAppear { if DevMode.isSandboxed, let p = ProcessInfo.processInfo.environment["FREELANE_DEV_PAGE"].flatMap(Place.init(rawValue:)) { app.page = p } }
        .onReceive(DistributedNotificationCenter.default().publisher(for: .init("app.freelane.dev." + (ProcessInfo.processInfo.environment["FREELANE_DEV_CHANNEL"] ?? "main")))) { n in
            // Test builds only: drive the window from a script ("page:ledger", "new", "count", "close").
            guard DevMode.isSandboxed, let cmd = n.object as? String else { return }
            if cmd.hasPrefix("page:"), let p = Place(rawValue: String(cmd.dropFirst(5))) { app.go(p) }
            if cmd == "new" { app.newMenuOpen = true }
            if cmd == "count" { app.counting = true }
            if cmd == "close" { app.newMenuOpen = false; app.counting = false }
        }
    }

    @ViewBuilder private func pages(_ money: MoneyState) -> some View {
        ZStack {
            switch app.page {
            case .now: NowPage(state: money)
            default: PlaceholderPage(page: app.page)
            }
        }
        .id(app.page)
        .transition(.opacity.combined(with: .offset(y: reduce ? 0 : 6)))
        .animation(Flow.pick(Flow.slow, reduce: reduce), value: app.page)
    }
}

/// Hidden buttons that give every page a keyboard shortcut, plus ⌘N for the New menu.
private struct PageShortcuts: View {
    let app: AppState
    var body: some View {
        ZStack {
            ForEach(Place.allCases) { p in
                if let k = p.shortcut {
                    Button("") { withAnimation(Flow.slow) { app.go(p) } }.keyboardShortcut(k, modifiers: .command)
                }
            }
            Button("") { withAnimation(Flow.spatial) { app.newMenuOpen.toggle() } }.keyboardShortcut("n", modifiers: .command)
            Button("") { withAnimation(Flow.slow) { app.go(.settings) } }.keyboardShortcut(",", modifiers: .command)
            Button("") { withAnimation(Flow.spatial) { app.newMenuOpen = false; app.counting = false } }.keyboardShortcut(.escape, modifiers: [])
        }
        .opacity(0).frame(width: 0, height: 0).accessibilityHidden(true)
    }
}

/// Stand-in while a page is being built.
struct PlaceholderPage: View {
    let page: Place
    var body: some View {
        Pane {
            PaneHeader(title: page.title)
            Spacer()
        }
    }
}

/// The work the app does once per launch: the essentials only.
enum LaunchV2 {
    @MainActor static func run(_ context: ModelContext) async {
        CloudSync.shared.attach(context)
        Reachability.shared.onBecameOnline = { Task { await CloudSync.shared.syncNow() } }
        Task { await CloudSync.shared.start() }
        Notify.purgeOld(context)
        TrashSweep.run(context)
        MoneyEngine(context: context).applyMonthlyFees()
        RecurringMath.resyncAll(context)
        Audit.prune(context)
        try? context.save()
        JournalWell.shared.pruneStale(context)
        Task { await FXService.refreshIfStale(context) }
        WidgetBridge.update(context)
    }
}

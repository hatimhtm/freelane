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
    var page: Place = Place(rawValue: UserDefaults.standard.string(forKey: "v2.openOn") ?? "now") ?? .now
    var newMenuOpen = false
    var counting = false
    var form: FormKind? = nil
    func go(_ p: Place) { page = p; newMenuOpen = false }
    func start(_ a: NewAction) {
        newMenuOpen = false
        switch a {
        case .count: counting = true
        case .journal: page = .journal
        case .spending: form = .spending
        case .moneyIn: form = .moneyIn(projectId: nil)
        case .move: form = .move
        case .payBill: form = .payBill(billId: nil)
        }
    }
}

/// The v2 window: rail on the window background, white panes on the right.
struct Shell: View {
    @Environment(\.modelContext) private var context
    @Environment(\.accessibilityReduceMotion) private var reduce
    @Environment(\.scenePhase) private var scenePhase
    @State private var app = AppState()
    @State private var ai = AIManager()
    @State private var undo = UndoCenter()
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
            if let f = app.form {
                FormHost(kind: f, state: money) { withAnimation(Flow.spatial) { app.form = nil } }
                    .id(f.id)
                    .transition(.opacity.combined(with: .scale(scale: 0.98)))
                    .zIndex(12)
            }
            if app.counting {
                CountSheet(state: money)
                    .transition(.opacity.combined(with: .scale(scale: 0.98)))
                    .zIndex(11)
            }
            Snackbar()
                .padding(.leading, 232 + 12)
                .zIndex(20)
        }
        .ignoresSafeArea()
        .environment(app)
        .environment(ai)
        .environment(undo)
        .animation(Flow.pick(Flow.spatial, reduce: reduce), value: app.newMenuOpen)
        .animation(Flow.pick(Flow.spatial, reduce: reduce), value: app.counting)
        .animation(Flow.pick(Flow.spatial, reduce: reduce), value: app.form)
        .background(PageShortcuts(app: app))
        .task { await LaunchV2.run(context, ai: ai) }
        .onChange(of: scenePhase) { _, phase in LaunchV2.phaseChanged(phase, context: context) }
        .onAppear { if DevMode.isSandboxed, let p = ProcessInfo.processInfo.environment["FREELANE_DEV_PAGE"].flatMap(Place.init(rawValue:)) { app.page = p } }
        // Menu commands, the menu-bar window, the capture hotkey and notification actions all arrive here.
        .onReceive(NotificationCenter.default.publisher(for: .flNew)) { n in
            withAnimation(Flow.spatial) {
                if let a = (n.userInfo?["action"] as? String).flatMap(NewAction.init(rawValue:)) { app.start(a) } else { app.newMenuOpen.toggle() }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .flLogSpend)) { _ in withAnimation(Flow.spatial) { app.start(.spending) } }
        .onReceive(NotificationCenter.default.publisher(for: .flLogPayment)) { _ in withAnimation(Flow.spatial) { app.start(.moneyIn) } }
        .onReceive(NotificationCenter.default.publisher(for: .flGo)) { n in
            if let p = (n.userInfo?["page"] as? String).flatMap(Place.init(rawValue:)) { withAnimation(Flow.slow) { app.go(p) } }
        }
        .onReceive(NotificationCenter.default.publisher(for: .flOpenFeature)) { n in
            if let f = n.userInfo?["feature"] as? String { withAnimation(Flow.slow) { app.go(Place.forOldFeature(f)) } }
        }
        .onReceive(NotificationCenter.default.publisher(for: .flOpenClient)) { _ in withAnimation(Flow.slow) { app.go(.work) } }
        .onReceive(DistributedNotificationCenter.default().publisher(for: .init("app.freelane.dev." + (ProcessInfo.processInfo.environment["FREELANE_DEV_CHANNEL"] ?? "main")))) { n in
            // Test builds only: drive the window from a script ("page:ledger", "new", "count", "close").
            guard DevMode.isSandboxed, let cmd = n.object as? String else { return }
            if cmd.hasPrefix("page:"), let p = Place(rawValue: String(cmd.dropFirst(5))) { app.go(p) }
            if cmd == "new" { app.newMenuOpen = true }
            if cmd == "count" { app.counting = true }
            if cmd == "close" { app.newMenuOpen = false; app.counting = false; app.form = nil }
            if cmd == "menubar" { DevWindow.openMenuBar() }
            switch cmd {
            case "form:spending": app.form = .spending
            case "form:moneyIn": app.form = .moneyIn(projectId: nil)
            case "form:move": app.form = .move
            case "form:payBill": app.form = .payBill(billId: nil)
            case "form:addWallet": app.form = .addWallet
            case "form:gift": app.form = .gift
            default: break
            }
        }
    }

    @ViewBuilder private func pages(_ money: MoneyState) -> some View {
        ZStack {
            switch app.page {
            case .now: NowPage(state: money)
            case .ledger: LedgerPage(state: money)
            case .wallets: WalletsPage(state: money)
            case .settings: SettingsPage(state: money)
            case .journal: JournalPage()
            case .bills: BillsPage(state: money)
            case .work: WorkPage(state: money)
            case .insights: InsightsPage(state: money)
            case .giving: GivingPage(state: money)
            default: PlaceholderPage(page: app.page)
            }
        }
        .id(app.page)
        .transition(.opacity.combined(with: .offset(y: reduce ? 0 : 6)))
        .animation(Flow.pick(Flow.slow, reduce: reduce), value: app.page)
    }
}

/// Esc closes whatever is open over the page. It only listens while something is open, so a search field
/// keeps its own Esc. (Page shortcuts and ⌘N live in the menus: `V2Commands`.)
private struct PageShortcuts: View {
    let app: AppState
    var body: some View {
        if app.newMenuOpen || app.counting || app.form != nil {
            Button("") { withAnimation(Flow.spatial) { app.newMenuOpen = false; app.counting = false; app.form = nil } }
                .keyboardShortcut(.escape, modifiers: [])
                .opacity(0).frame(width: 0, height: 0).accessibilityHidden(true)
        }
    }
}

/// The v2 snackbar: what just happened, with Undo when it can be taken back. Bottom centre of the pages.
struct Snackbar: View {
    @Environment(UndoCenter.self) private var undo
    @Environment(\.accessibilityReduceMotion) private var reduce
    var body: some View {
        VStack {
            Spacer()
            if let t = undo.toast {
                HStack(spacing: 4) {
                    Text(t.message).font(FS.font(14, 500)).foregroundStyle(MD.inverseOnSurface).lineLimit(1)
                        .padding(.trailing, 20)
                    Spacer(minLength: 0)
                    if t.canUndo {
                        Button { withAnimation(Flow.spatial) { undo.performUndo() } } label: {
                            Text("Undo").font(FS.font(14, 600, rond: 60)).foregroundStyle(MD.primaryContainer)
                                .padding(.horizontal, 12).frame(height: 36).contentShape(Capsule())
                        }
                        .buttonStyle(PressScale())
                    }
                    Button { withAnimation(Flow.spatial) { undo.clear() } } label: {
                        Icon(Sym.close, size: 20).foregroundStyle(MD.inverseOnSurface).frame(width: 36, height: 36).contentShape(Circle())
                    }
                    .buttonStyle(PressScale())
                }
                .padding(.leading, 16).padding(.trailing, 6)
                .frame(minWidth: 344, maxWidth: 560, minHeight: 48)
                .fixedSize()
                .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(MD.inverseSurface))
                .shadow(color: .black.opacity(0.18), radius: 10, y: 4)
                .padding(.bottom, 28)
                .id(t.id)
                .transition(reduce ? .opacity : .move(edge: .bottom).combined(with: .opacity))
            }
        }
        .frame(maxWidth: .infinity)
        .animation(Flow.pick(Flow.spatial, reduce: reduce), value: undo.toast?.id)
    }
}

/// The v2 menus: New and the two quick forms in File, Settings in the app menu, every place under Go.
struct V2Commands: Commands {
    var body: some Commands {
        CommandGroup(replacing: .newItem) {
            Button("New…") { post(.flNew) }.keyboardShortcut("n", modifiers: .command)
            Divider()
            Button("Spending…") { post(.flLogSpend) }.keyboardShortcut("n", modifiers: [.command, .option])
            Button("Money In…") { post(.flLogPayment) }.keyboardShortcut("n", modifiers: [.command, .shift])
            Button("Move Money…") { post(.flNew, ["action": NewAction.move.rawValue]) }
            Button("Count Wallets…") { post(.flNew, ["action": NewAction.count.rawValue]) }
            Button("Pay a Bill…") { post(.flNew, ["action": NewAction.payBill.rawValue]) }
        }
        CommandGroup(replacing: .appSettings) {
            Button("Settings…") { post(.flGo, ["page": Place.settings.rawValue]) }.keyboardShortcut(",", modifiers: .command)
        }
        CommandMenu("Go") {
            ForEach(Place.allCases.filter { $0.shortcut != nil }) { p in
                Button(p.title) { post(.flGo, ["page": p.rawValue]) }.keyboardShortcut(p.shortcut!, modifiers: .command)
            }
        }
    }
    private func post(_ name: Notification.Name, _ info: [String: String]? = nil) {
        NotificationCenter.default.post(name: name, object: nil, userInfo: info)
    }
}

extension Place {
    /// Where an older link (Siri, Spotlight, a notification) to a v1 screen lands now.
    static func forOldFeature(_ raw: String) -> Place {
        switch raw {
        case "payments", "projects", "clients": return .work
        case "wallets": return .wallets
        case "spending", "activity", "vendors", "loans": return .ledger
        case "people", "sadaka": return .giving
        case "letters": return .journal
        case "stats": return .insights
        case "settings": return .settings
        default: return .now
        }
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
    @MainActor static func run(_ context: ModelContext, ai: AIManager) async {
        Repairs.runIfNeeded(context)
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
        if !DevMode.isSandboxed { JournalWell.shared.topUp(context, ai: ai) }
        Task { await FXService.refreshIfStale(context) }
        // Bills coming due, an overdrawn wallet, a project unpaid for three weeks: macOS banners, deduped.
        if !DevMode.isSandboxed { Signals.sweep(context) }
        WidgetBridge.update(context)
    }

    /// Coming back to the app re-checks what needs you; leaving it refreshes the widget.
    @MainActor static func phaseChanged(_ phase: ScenePhase, context: ModelContext) {
        guard !DevMode.isSandboxed else { return }
        if phase == .active {
            Signals.sweep(context)
            CloudSync.shared.syncSoon()
            Task(priority: .background) { await SiriIndex.reindex() }
        } else {
            WidgetBridge.update(context)
        }
    }
}

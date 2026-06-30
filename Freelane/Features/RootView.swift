import SwiftUI
import SwiftData

// MARK: - Feature catalog (every system from the web app, reimagined natively)

enum FeatureGroup: String, CaseIterable, Identifiable {
    case overview = "Overview"
    case money = "Money"
    case people = "People"
    case life = "Life"
    case insights = "Insights"
    var id: String { rawValue }

    /// Each section owns an accent so Money / People / Life / Insights read distinct at a glance.
    var accent: Color {
        switch self {
        case .overview: return Palette.section(.overview)
        case .money:    return Palette.section(.money)
        case .people:   return Palette.section(.people)
        case .life:     return Palette.section(.life)
        case .insights: return Palette.section(.insights)
        }
    }
}

enum Feature: String, CaseIterable, Identifiable {
    case dashboard, today, agenda
    case payments, wallets, projects, spending, loans
    case clients, people, vendors
    case sadaka, faith, body, letters
    case stats, activity
    case settings

    var id: String { rawValue }

    var title: String {
        switch self {
        case .dashboard: return "Dashboard"
        case .today: return "Today"
        case .agenda: return "Agenda"
        case .payments: return "Payments"
        case .wallets: return "Wallets"
        case .projects: return "Projects"
        case .spending: return "Spending"
        case .loans: return "Loans"
        case .clients: return "Clients"
        case .people: return "People"
        case .vendors: return "Vendors"
        case .sadaka: return "Sadaka"
        case .faith: return "Faith"
        case .body: return "Body"
        case .letters: return "Journal"
        case .stats: return "Stats"
        case .activity: return "Activity"
        case .settings: return "Settings"
        }
    }

    var icon: String {
        switch self {
        case .dashboard: return "rectangle.3.group"
        case .today: return "sun.max"
        case .agenda: return "calendar"
        case .payments: return "arrow.down.left.circle"
        case .wallets: return "wallet.bifold"
        case .projects: return "folder"
        case .spending: return "cart"
        case .loans: return "arrow.left.arrow.right"
        case .clients: return "briefcase"
        case .people: return "person.2"
        case .vendors: return "storefront"
        case .sadaka: return "heart"
        case .faith: return "moon.stars"
        case .body: return "figure.run"
        case .letters: return "book.closed"
        case .stats: return "chart.bar"
        case .activity: return "clock.arrow.circlepath"
        case .settings: return "gearshape"
        }
    }

    /// A feature inherits its section's accent — so all of Money reads mint, all of Life reads
    /// orchid, etc. Coherent section identity beats a per-screen rainbow (and kills the monotony).
    var accent: Color {
        self == .settings ? Palette.section(.settings) : group.accent
    }

    var group: FeatureGroup {
        switch self {
        case .dashboard, .today, .agenda: return .overview
        case .payments, .wallets, .projects, .spending, .loans: return .money
        case .clients, .people, .vendors: return .people
        case .sadaka, .faith, .body, .letters: return .life
        case .stats, .activity: return .insights
        case .settings: return .overview
        }
    }

}

// MARK: - Root

struct RootView: View {
    @Environment(\.modelContext) private var context
    @Environment(\.scenePhase) private var scenePhase
    @State private var feature: Feature = .dashboard
    @State private var sync = SyncManager()
    @State private var ai = AIManager()
    @State private var undo = UndoCenter()
    @State private var showPalette = false
    @State private var showShortcuts = false
    @State private var showSearch = false
    @State private var splash = true
    @State private var quickSpend = false
    @State private var quickPayment = false

    var body: some View {
        NavigationSplitView {
            Sidebar(feature: $feature)
                .navigationSplitViewColumnWidth(min: 244, ideal: 258, max: 300)
        } detail: {
            ZStack {
                AppBackground()
                detail
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .id(feature)                                   // recreate per page (fresh scroll position)
                    .transition(.opacity)                          // clean crossfade — the per-section
                                                                   // `fluidAppear` cascade inside Page is the
                                                                   // real entrance, so the outer swap stays quiet
            }
            .overlay(alignment: .topTrailing) {
                BellButton(onOpenFeature: { f in withAnimation(Motion.page) { feature = f } })
                    .padding(.top, 14).padding(.trailing, 20)
            }
            .overlay(alignment: .bottomTrailing) {
                FloatingAIButton(page: feature).padding(24)
            }
            .toolbar(removing: .title)
            .toolbarBackground(.hidden, for: .windowToolbar)
        }
        // ⌘K command palette / ⌘F search.
        .background {
            Button("") { showPalette.toggle() }.keyboardShortcut("k", modifiers: .command).opacity(0)
        }
        .background {
            Button("") { showSearch.toggle() }.keyboardShortcut("f", modifiers: .command).opacity(0)
        }
        .background {     // ⌘? keyboard-shortcut HUD
            Button("") { showShortcuts.toggle() }.keyboardShortcut("/", modifiers: .command).opacity(0)
        }
        .sheet(isPresented: $showShortcuts) { ShortcutsHUD() }
        .sheet(isPresented: $showSearch) {
            SearchPalette { f in showSearch = false; withAnimation(Motion.page) { feature = f } }
        }
        .sheet(isPresented: $showPalette) {
            CommandPalette { f in showPalette = false; withAnimation(Motion.page) { feature = f } }
        }
        .sheet(isPresented: $quickSpend) { AddSpendSheet() }
        .sheet(isPresented: $quickPayment) { BulkPaymentSheet() }
        .onReceive(NotificationCenter.default.publisher(for: .flLogSpend)) { _ in quickSpend = true }
        .onReceive(NotificationCenter.default.publisher(for: .flLogPayment)) { _ in quickPayment = true }
        .onReceive(NotificationCenter.default.publisher(for: .flOpenFeature)) { note in
            if let raw = note.userInfo?["feature"] as? String, let f = Feature(rawValue: raw) {
                withAnimation(Motion.page) { feature = f }
            }
        }
        .overlay {
            if splash {
                LaunchSplash().transition(.opacity).zIndex(99)
                    .onAppear {
                        // Safety fallback only: if the launch .task ever stalls, never trap the user
                        // behind the splash. Normal dismissal happens when .task finishes.
                        DispatchQueue.main.asyncAfter(deadline: .now() + 6) {
                            withAnimation(.easeOut(duration: 0.55)) { splash = false }
                        }
                    }
            }
        }
        .overlay { UndoToastOverlay().zIndex(50) }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                // Re-scan money state on every focus (dedup keeps it quiet) so new
                // overdrafts / due bills surface immediately, not on the next calendar day.
                Signals.sweep(context)
                // Daily AI refresh on app open — once per PHT day, ANY hour, local model.
                NightShift.maybeRunOnOpen(context, ai: ai)
                // Warm the local model while you're here; instant AI when you log things.
                LocalLLM.shared.appActive()
            } else {
                // Closing the app frees the local model's RAM immediately (gaming-safe);
                // a brief focus-switch just lets its keep-alive lapse on its own.
                LocalLLM.shared.appBackgrounded(context: context, ai: ai, fullyClosed: phase == .background)
                WidgetBridge.update(context)   // keep the desktop widget fresh
            }
        }
        .environment(\.navigate, { f in withAnimation(Motion.page) { feature = f } })
        .environment(sync)
        .environment(ai)
        .environment(undo)
        .task {
            sync.attach(context: context)
            SampleData.seedIfEmpty(context)
            // First launch lands in .active before onChange can fire — warm the local model now.
            LocalLLM.shared.appActive()
            if !UserDefaults.standard.bool(forKey: "notif.seeded") {
                UserDefaults.standard.set(true, forKey: "notif.seeded")
                Notify.post(context, kind: "info", subject: "Welcome to Freelane",
                            body: "Everything lives on this Mac. Tap the ✨ on any page to ask the assistant.", feature: .dashboard)
            }
            // Drop read/dismissed notifications past the retention window (default 3 days).
            Notify.purgeOld(context)
            // Permanently clear anything that's been in Trash longer than 30 days.
            TrashSweep.run(context)
            // Charge any stored monthly wallet fees, once per month per wallet.
            MoneyEngine(context: context).applyMonthlyFees()
            // One-time: re-derive every bill's "paid through" from its linked spends, healing
            // rows saved under the old payment-date math (which could skip a month).
            if !UserDefaults.standard.bool(forKey: "recurring.paidThroughBackfilled") {
                UserDefaults.standard.set(true, forKey: "recurring.paidThroughBackfilled")
                let engine = MoneyEngine(context: context)
                for r in (try? context.fetch(FetchDescriptor<Recurring>())) ?? [] where r.deletedAt == nil {
                    engine.resyncRecurring(r.id)
                }
            }
            // Trim the audit trail to the last 90 days.
            Audit.prune(context)
            // Turn money state into notifications (aging projects, wallet alerts, sadaka).
            Signals.sweep(context)
            // Keep the AI curious — surface the next thing it doesn't understand.
            Curiosity.sweep(context)
            // Notice duplicate people (a generic "my wife" next to the real one) → suggest a merge.
            DuplicatePeople.scan(context)
            // Credit journaling coins for any entries not yet paid out (idempotent backfill).
            let entries = ((try? context.fetch(FetchDescriptor<Letter>())) ?? []).filter { $0.deletedAt == nil }
            JournalGame.reconcileCoins(entries: entries.map { ($0.id, $0.createdAt) })
            // (Removed the robotic "Today's read" number-restating notification — real insight now
            //  lives in the Dashboard "AI insights" card, which actually analyzes instead of parroting.)
            // Sweep away any old "Today's read" notifications still sitting in the bell.
            for n in ((try? context.fetch(FetchDescriptor<AppNotification>())) ?? []) where n.kind == "daily_read" && n.dismissedAt == nil {
                n.dismissedAt = .now
            }
            try? context.save()
            // Daily AI refresh — onChange(scenePhase) doesn't fire for the initial .active at launch,
            // so kick the once-per-day local refresh here too (dashboard insights, mind×money,
            // duplicate-people, journal tagging, memory digest). Runs in the background; non-blocking.
            NightShift.maybeRunOnOpen(context, ai: ai)
            // Ask once for notification permission so in-app alerts also show as real
            // macOS banners.
            if !UserDefaults.standard.bool(forKey: "notif.askedOnce") {
                UserDefaults.standard.set(true, forKey: "notif.askedOnce")
                Task { _ = await NotificationManager().requestAuthorization() }
            }
            // Keep Gemini model names current (weekly) so renames never cause downtime.
            Task { await ai.refreshModels() }
            // Learn the city's real cost of living so safe-to-spend stays relevant.
            Task { await Brain.refreshCostOfLiving(context, ai: ai) }
            // Live FX (frankfurter) + a non-pushy "good time to get paid" note.
            Task { await FXService.refreshIfStale(context) }
            // Weekly "what changed" review (once a week, surfaced as a notification).
            WeeklyReview.maybeRun(context)
            // Refresh the desktop widget snapshot.
            WidgetBridge.update(context)
            // Launch work is done — lift the splash now (instead of a blind fixed timer that could
            // reveal a still-churning UI). A max-timeout fallback in the overlay guards against a stall.
            withAnimation(.easeOut(duration: 0.45)) { splash = false }
        }
    }

    @ViewBuilder
    private var detail: some View {
        switch feature {
        case .dashboard: DashboardView()
        case .today: TodayView()
        case .agenda: AgendaView()
        case .payments: PaymentsView()
        case .wallets: WalletsView()
        case .projects: ProjectsView()
        case .spending: SpendingView()
        case .clients: ClientsView()
        case .people: PeopleView()
        case .vendors: VendorsView()
        case .sadaka: SadakaView()
        case .stats: StatsView()
        case .activity: ActivityView()
        case .loans: LoansView()
        case .faith: FaithView()
        case .body: BodyView()
        case .letters: LettersView()
        case .settings: SettingsView()
        }
    }
}

// MARK: - Sidebar

private struct Sidebar: View {
    @Binding var feature: Feature

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                wordmark
                ForEach(FeatureGroup.allCases) { group in
                    // Wallets live inside Payments now (not a separate sidebar item).
                    let items = Feature.allCases.filter { $0.group == group && $0 != .settings && $0 != .wallets }
                    if !items.isEmpty {
                        HStack(spacing: 7) {
                            Circle().fill(group.accent).frame(width: 5, height: 5)
                                .shadow(color: group.accent.opacity(0.7), radius: 3)
                            Text(group.rawValue)
                                .font(Typo.label(10)).textCase(.uppercase).kerning(1.0)
                                .foregroundStyle(Palette.textTertiary)
                        }
                        .padding(.horizontal, 18).padding(.top, Spacing.l).padding(.bottom, 6)
                        ForEach(items) { item in NavRow(item: item, selected: feature == item) { select(item) } }
                    }
                }
                Divider().overlay(.white.opacity(0.06)).padding(.horizontal, 14).padding(.vertical, 10)
                NavRow(item: .settings, selected: feature == .settings) { select(.settings) }
                Spacer(minLength: 8)
                storageChip.padding(12)
            }
        }
        .scrollIndicators(.never)
    }

    private var wordmark: some View {
        Wordmark()
            .padding(.horizontal, 16).padding(.top, 34)   // clear the window traffic-light buttons
    }

    private func select(_ item: Feature) {
        withAnimation(Motion.page) { feature = item }
    }

    private var storageChip: some View {
        HStack(spacing: 9) {
            Image(systemName: "internaldrive").font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Palette.teal)
            VStack(alignment: .leading, spacing: 1) {
                Text("Stored locally").font(.system(size: 11, weight: .semibold)).foregroundStyle(Palette.textPrimary)
                Text("No cloud · private").font(.system(size: 10)).foregroundStyle(Palette.textTertiary)
            }
            Spacer()
        }
        .padding(11)
        .glassCard(cornerRadius: 13)
    }
}

private struct NavRow: View {
    var item: Feature
    var selected: Bool
    var action: () -> Void
    @State private var hovering = false

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 13, style: .continuous)
        Button(action: action) {
            HStack(spacing: 11) {
                Image(systemName: item.icon).font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(selected ? item.accent : Palette.textSecondary).frame(width: 22)
                Text(item.title).font(.system(size: 13.5, weight: selected ? .semibold : .medium))
                    .foregroundStyle(selected ? Palette.textPrimary : (hovering ? Palette.textPrimary : Palette.textSecondary))
                Spacer(minLength: 4)
            }
            .padding(.horizontal, 12).padding(.vertical, 9)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(shape)
            .background {
                if selected {
                    shape.fill(item.accent.opacity(0.16)).overlay(shape.strokeBorder(item.accent.opacity(0.4), lineWidth: 0.8))
                        .overlay(alignment: .leading) {
                            Capsule().fill(item.accent).frame(width: 3, height: 16).shadow(color: item.accent, radius: 4).padding(.leading, 3)
                        }
                } else if hovering {
                    shape.fill(.white.opacity(0.06))
                }
            }
            .modifier(SelectedGlass(active: selected, shape: shape, tint: item.accent))
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 10).padding(.vertical, 1)
        .onHover { hovering = $0 }
    }
}

/// Applies real Liquid Glass to the selected sidebar box (nav layer).
private struct SelectedGlass: ViewModifier {
    var active: Bool
    var shape: RoundedRectangle
    var tint: Color
    func body(content: Content) -> some View {
        if active {
            content.glassEffect(Glass.regular.tint(tint.opacity(0.16)), in: shape)
        } else {
            content
        }
    }
}

// MARK: - Page scaffold

struct Page<Content: View>: View {
    var title: String
    var subtitle: String?
    var toolbar: AnyView?
    var subtabs: [String]
    var selection: Binding<Int>?
    @ViewBuilder var content: () -> Content

    init(_ title: String, subtitle: String? = nil, toolbar: AnyView? = nil,
         subtabs: [String] = [], selection: Binding<Int>? = nil,
         @ViewBuilder content: @escaping () -> Content) {
        self.title = title
        self.subtitle = subtitle
        self.toolbar = toolbar
        self.subtabs = subtabs
        self.selection = selection
        self.content = content
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Pinned header + subtabs (the "top bar") — does not scroll.
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .center) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(title).displayStyle(31)
                        if let subtitle {
                            Text(subtitle).font(.system(size: 13)).foregroundStyle(Palette.textTertiary)
                        }
                    }
                    Spacer()
                    if let toolbar { toolbar }
                }
                .padding(.trailing, 56)  // clear the global notification bell (top-trailing overlay)
                if !subtabs.isEmpty, let selection { SubtabBar(tabs: subtabs, selection: selection) }
            }
            .padding(.horizontal, 26).padding(.top, 22).padding(.bottom, 14)
            .frame(maxWidth: 1000, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .leading)

            // Scrolling content with edge-fade. Each top-level section CASCADES in (staggered
            // spring) instead of the whole page appearing as one block.
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if let selection {
                        staggered(content()).id(selection.wrappedValue)   // re-cascade when subtab changes
                            .transition(.opacity)
                    } else {
                        staggered(content())
                    }
                }
                .padding(.horizontal, 26).padding(.top, 4).padding(.bottom, 64)
                .frame(maxWidth: 1000, alignment: .leading)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .mask(
                VStack(spacing: 0) {
                    LinearGradient(colors: [.clear, .black], startPoint: .top, endPoint: .bottom).frame(height: 16)
                    Color.black
                    LinearGradient(colors: [.black, .clear], startPoint: .top, endPoint: .bottom).frame(height: 16)
                }
            )
        }
    }
}

/// Gives each top-level child of a page its own staggered entrance (capped so long
/// pages don't take seconds to settle).
@ViewBuilder
private func staggered<V: View>(_ v: V) -> some View {
    Group(subviews: v) { subviews in
        ForEach(Array(subviews.enumerated()), id: \.element.id) { i, sub in
            sub.fluidAppear(min(i, 7))
        }
    }
}

/// A glass segmented control for in-page subtabs with a fluid sliding indicator
/// (matchedGeometryEffect) — the native echo of the web app's morphing underline.
struct SubtabBar: View {
    var tabs: [String]
    @Binding var selection: Int
    @Namespace private var ns
    @State private var hovered: Int? = nil

    var body: some View {
        HStack(spacing: 4) {
            ForEach(Array(tabs.enumerated()), id: \.offset) { i, t in
                Text(t)
                    .font(.system(size: 12.5, weight: selection == i ? .semibold : .medium))
                    .foregroundStyle(selection == i ? Palette.textPrimary : (hovered == i ? Palette.textPrimary : Palette.textSecondary))
                    .padding(.horizontal, 13).padding(.vertical, 7)
                    .background {
                        if selection == i {
                            Capsule().fill(.white.opacity(0.14))
                                .overlay(Capsule().strokeBorder(.white.opacity(0.16), lineWidth: 0.7))
                                .matchedGeometryEffect(id: "subtab.pill", in: ns)
                        } else if hovered == i {
                            Capsule().fill(.white.opacity(0.05))
                        }
                    }
                    .contentShape(Capsule())
                    .onHover { hovered = $0 ? i : (hovered == i ? nil : hovered) }
                    .onTapGesture {
                        withAnimation(.spring(response: 0.34, dampingFraction: 0.78)) { selection = i }
                    }
            }
            Spacer(minLength: 0)
        }
        .padding(4)
        .navGlass(cornerRadius: 99)
        .fixedSize(horizontal: true, vertical: false)
    }
}

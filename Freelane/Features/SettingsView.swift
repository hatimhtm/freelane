import SwiftUI
import SwiftData
import AppKit

struct SettingsView: View {
    @Environment(SyncManager.self) private var sync
    @Environment(\.modelContext) private var context
    @Query private var settings: [AppSettings]
    @Query(filter: #Predicate<Wallet> { $0.deletedAt == nil }, sort: \Wallet.name) private var wallets: [Wallet]
    @Query private var ledger: [LedgerEntry]
    @Query private var rateRows: [ExchangeRate]
    @State private var recalAmounts: [UUID: String] = [:]
    @State private var recalCurrency: [UUID: String] = [:]
    @State private var recalFlash: String?
    @State private var notifs = NotificationManager()
    @State private var ai = AIManager()
    @State private var keyField = ""
    @State private var storeSize = "—"
    @State private var sub = 0
    @State private var pendingBase: String?
    @State private var baseError: String?
    @AppStorage("integ.reminders") private var remindersOn = false
    @AppStorage("integ.contacts") private var contactsOn = false
    @AppStorage("hotkey.capture.enabled") private var captureHotkey = true   // matches HotkeyManager's on-by-default
    @AppStorage("redact.health") private var redactHealth = true
    @AppStorage("redact.intimate") private var redactIntimate = true
    @AppStorage("appearance") private var appearance = "dark"
    @State private var city = UserDefaults.standard.string(forKey: "user.city") ?? ""
    @State private var backedUp = false
    @State private var showTrash = false
    @State private var showRestore = false
    @State private var cloudPassword = ""

    private let baseCurrencies = CurrencyFormat.supported

    private var lastBackup: String? {
        let fm = FileManager.default
        guard let items = try? fm.contentsOfDirectory(at: DataBackup.folder, includingPropertiesForKeys: [.creationDateKey]) else { return nil }
        let dates = items.filter { $0.pathExtension == "store" }
            .compactMap { try? $0.resourceValues(forKeys: [.creationDateKey]).creationDate }
        guard let newest = dates.max() else { return nil }
        let f = DateFormatter(); f.dateStyle = .medium; f.timeStyle = .short
        return f.string(from: newest)
    }

    var body: some View {
        let tabs = SyncManager.cloudSyncEnabled
            ? ["General", "Storage", "Notifications", "AI", "Integrations", "Cloud", "About"]
            : ["General", "Storage", "Notifications", "AI", "Integrations", "About"]
        let current = sub < tabs.count ? tabs[sub] : (tabs.last ?? "General")
        let subtitle = (SyncManager.cloudSyncEnabled && sync.connected)
            ? "Synced to your private cloud — and fully usable offline."
            : "All data lives on this Mac. No cloud, fully private."
        return Page("Settings", subtitle: subtitle, subtabs: tabs, selection: $sub) {
            switch current {
            case "General": generalCard
            case "Storage": storageCard; recalibrateCard
            case "Notifications": notificationsCard
            case "AI": aiCard
            case "Integrations": integrationsCard
            case "Cloud": cloudCard
            default: aboutCard
            }
        }
        .task {
            await notifs.refreshStatus()
            keyField = ai.apiKey
            storeSize = computeStoreSize()
        }
    }

    // MARK: Recalibrate wallets

    private var base: String { settings.first?.baseCurrency ?? "PHP" }
    private var rates: Rates { Rates(base: base, rates: rateRows) }

    /// A wallet's native currency — what you actually think of its balance in.
    private func walletCurrency(_ w: Wallet) -> String {
        w.openingBalanceCurrency ?? w.currencyOut ?? w.currencyIn ?? base
    }
    private func chosenCurrency(_ w: Wallet) -> String { recalCurrency[w.id] ?? walletCurrency(w) }

    /// Fix a wallet whose computed balance has drifted from reality. Enter the real balance in the
    /// wallet's OWN currency (MAD bank, USD Wise, USDT…) — it converts to base. Records the difference
    /// as a one-off "recalibration" adjustment in the ledger — NOT a spend, so it never touches your
    /// spending totals or safe-to-spend.
    private var recalibrateCard: some View {
        SectionCard(title: "Recalibrate wallets",
                    subtitle: "Set a wallet to its real balance, in any currency — recorded as an adjustment, not a spend",
                    accent: Palette.warning) {
            VStack(alignment: .leading, spacing: 14) {
                ForEach(wallets.filter { $0.isHolding && !$0.archived }) { w in
                    let currentBase = WalletMath.balance(of: w, ledger: ledger)
                    let cur = chosenCurrency(w)
                    let currentNative = cur == base ? currentBase : currentBase / rates.rate(for: cur)
                    VStack(alignment: .leading, spacing: 7) {
                        HStack(spacing: 10) {
                            WalletGlyph(wallet: w, size: 26)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(w.name).font(.system(size: 13, weight: .medium)).foregroundStyle(Palette.textPrimary).lineLimit(1)
                                Text("now \(CurrencyFormat.string(currentNative, cur, compact: true))" + (cur != base ? " · \(CurrencyFormat.string(currentBase, base, compact: true))" : ""))
                                    .font(.system(size: 10)).monospacedDigit().foregroundStyle(Palette.textTertiary).lineLimit(1)
                            }
                            Spacer()
                        }
                        HStack(spacing: 8) {
                            CurrencyMenu(selection: Binding(get: { chosenCurrency(w) }, set: { recalCurrency[w.id] = $0 }))
                            TextField("real balance", text: Binding(
                                get: { recalAmounts[w.id] ?? "" },
                                set: { recalAmounts[w.id] = $0 })).textFieldStyle(GlassFieldStyle())
                            Button("Fix") { recalibrate(w) }
                                .buttonStyle(.glassProminent).tint(Palette.warning)
                                .disabled(parseAmount(recalAmounts[w.id] ?? "") == nil || !rates.hasRate(for: cur))
                                .help("Set \(w.name) to the real balance you entered")
                        }
                        if !rates.hasRate(for: cur) {
                            Text("No FX rate for \(cur) yet — add one in a payment first, or use \(base).")
                                .font(.system(size: 10)).foregroundStyle(Palette.negative)
                        }
                    }
                    if w.id != wallets.filter({ $0.isHolding && !$0.archived }).last?.id { Divider().overlay(Palette.hairline) }
                }
                if let recalFlash {
                    Label(recalFlash, systemImage: "checkmark.circle.fill").font(.system(size: 12)).foregroundStyle(Palette.positive)
                }
                Text("Enter what the wallet ACTUALLY holds, in its own currency. The difference (converted to \(base)) is logged as a recalibration adjustment — shows as “ADJ” in the wallet's history; your spending and income numbers are untouched.")
                    .font(.system(size: 11)).foregroundStyle(Palette.textTertiary)
            }
        }
    }

    private func recalibrate(_ w: Wallet) {
        guard let native = parseAmount(recalAmounts[w.id] ?? "") else { return }
        let cur = chosenCurrency(w)
        let actualBase = rates.toBase(native, cur)
        let delta = MoneyEngine(context: context).reconcileWallet(w.id, actualBase: actualBase)
        recalAmounts[w.id] = ""
        WidgetBridge.update(context)
        withAnimation {
            recalFlash = abs(delta) < 0.01
                ? "\(w.name) was already correct."
                : "\(w.name) recalibrated to \(CurrencyFormat.string(native, cur, compact: true)) (Δ \(CurrencyFormat.string(delta, base, compact: true)))."
        }
    }

    // MARK: Cloud sync

    @ViewBuilder private var cloudCard: some View {
        SectionCard(title: "Cloud sync", subtitle: sync.connected
                    ? "Your data syncs to your private Supabase. Everything still works offline — changes queue and sync when you're back online."
                    : "Optional. Sync this Mac to your own private Supabase so your data is backed up and ready for other devices. Off by default.",
                    accent: Palette.section(.overview)) {
            VStack(alignment: .leading, spacing: 14) {
                // Live status line.
                HStack(spacing: 10) {
                    Image(systemName: sync.connected ? "checkmark.icloud.fill" : "icloud.slash")
                        .font(.system(size: 15)).foregroundStyle(sync.connected ? Palette.positive : Palette.textTertiary).frame(width: 22)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(sync.statusLine).font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.textPrimary)
                        if let d = sync.lastSync {
                            Text("Last synced \(d.formatted(date: .abbreviated, time: .shortened))")
                                .font(.system(size: 11)).foregroundStyle(Palette.textTertiary)
                        }
                    }
                    Spacer()
                    if sync.busy { ProgressView().controlSize(.small) }
                }

                if sync.connected {
                    HStack(spacing: 10) {
                        Button { Task { await sync.syncNow() } } label: {
                            Label("Sync now", systemImage: "arrow.triangle.2.circlepath")
                        }.buttonStyle(.glassProminent).tint(Palette.section(.overview)).disabled(sync.busy)
                        Button(role: .destructive) { sync.disconnect() } label: {
                            Label("Disconnect", systemImage: "xmark.icloud")
                        }.buttonStyle(.glass)
                    }
                } else {
                    VStack(alignment: .leading, spacing: 9) {
                        cloudField("Supabase URL", "https://xxxx.supabase.co", text: Binding(get: { sync.urlString }, set: { sync.urlString = $0 }))
                        cloudField("Anon key", "eyJhbGci…", text: Binding(get: { sync.anonKey }, set: { sync.anonKey = $0 }), secure: true)
                        cloudField("Email", "owner@freelane.local", text: Binding(get: { sync.email }, set: { sync.email = $0 }))
                        SecureField("Password", text: $cloudPassword).textFieldStyle(GlassFieldStyle())
                        Button {
                            Task { await sync.connectAndImport(password: cloudPassword); cloudPassword = "" }
                        } label: {
                            Label(sync.busy ? "Connecting…" : "Connect & import", systemImage: "icloud.and.arrow.down")
                        }
                        .buttonStyle(.glassProminent).tint(Palette.section(.overview))
                        .disabled(sync.busy || !sync.isConfigured || cloudPassword.isEmpty)
                    }
                }

                if let err = sync.lastError {
                    Text(err).font(.system(size: 11)).foregroundStyle(Palette.negative).fixedSize(horizontal: false, vertical: true)
                }
                Text("Your password is never stored — only a refresh token, in the macOS Keychain. Data lives in your own Supabase project.")
                    .font(.system(size: 11)).foregroundStyle(Palette.textTertiary).fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func cloudField(_ label: String, _ placeholder: String, text: Binding<String>, secure: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.system(size: 11, weight: .semibold)).foregroundStyle(Palette.textSecondary)
            if secure {
                SecureField(placeholder, text: text).textFieldStyle(GlassFieldStyle())
            } else {
                TextField(placeholder, text: text).textFieldStyle(GlassFieldStyle())
            }
        }
    }

    // MARK: Integrations

    private var integrationsCard: some View {
        SectionCard(title: "Apple integrations", subtitle: "All off until you turn them on — access is requested here", accent: Palette.cyan) {
            VStack(alignment: .leading, spacing: 14) {
                integToggle($remindersOn, "Reminders", "See and complete your Apple Reminders alongside Tasks.", "checklist") {
                    await EventBridge.requestReminders()
                }
                Divider().overlay(Palette.hairline)
                integToggle($contactsOn, "Contacts", "Match people in your spends (a name the AI spots) to your address book.", "person.crop.circle") {
                    await ContactsBridge.request()
                }
                Text("Granted in macOS System Settings → Privacy. Everything stays on this Mac; nothing is uploaded.")
                    .font(.system(size: 11)).foregroundStyle(Palette.textTertiary).fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func integToggle(_ flag: Binding<Bool>, _ title: String, _ desc: String, _ icon: String, request: @escaping () async -> Bool) -> some View {
        Toggle(isOn: Binding(get: { flag.wrappedValue }, set: { on in
            if on { Task { let ok = await request(); flag.wrappedValue = ok } }   // only stays on if access granted
            else { flag.wrappedValue = false }
        })) {
            HStack(spacing: 10) {
                Image(systemName: icon).font(.system(size: 14)).foregroundStyle(Palette.cyan).frame(width: 22)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.system(size: 13, weight: .medium)).foregroundStyle(Palette.textPrimary)
                    Text(desc).font(.system(size: 11)).foregroundStyle(Palette.textTertiary).fixedSize(horizontal: false, vertical: true)
                }
            }
        }.toggleStyle(.switch).tint(Palette.cyan)
    }

    // MARK: Storage

    private var storageCard: some View {
        SectionCard(title: "Storage", subtitle: "One organized folder", accent: Palette.teal) {
            VStack(alignment: .leading, spacing: 12) {
                infoRow("Location", AppPaths.root.path(percentEncoded: false))
                infoRow("Database size", storeSize)
                if let last = lastBackup { infoRow("Last backup", last) }
                HStack {
                    Button { NSWorkspace.shared.open(AppPaths.root) } label: {
                        Label("Reveal in Finder", systemImage: "folder")
                    }.buttonStyle(.glass)
                    Button {
                        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd-HHmm"
                        if DataBackup.backupNow(stamp: f.string(from: .now)) != nil { backedUp = true; DataBackup.reveal() }
                    } label: { Label(backedUp ? "Backed up ✓" : "Back up now", systemImage: "externaldrive.badge.checkmark") }
                        .buttonStyle(.glassProminent).tint(Palette.teal)
                    Button { DataExport.save(context) } label: { Label("Export CSV", systemImage: "tablecells") }
                        .buttonStyle(.glass)
                    Spacer()
                }
                HStack {
                    Button { showRestore = true } label: { Label("Restore backup…", systemImage: "arrow.counterclockwise") }
                        .buttonStyle(.glass)
                    Button { showTrash = true } label: { Label("Recently Deleted", systemImage: "trash") }
                        .buttonStyle(.glass)
                    Spacer()
                }
                Text("Back up = timestamped copies of your data on this Mac. Restore = roll back to one (current data saved first). Recently Deleted keeps anything you remove for 30 days. Export CSV = your payments, spends & transfers for Numbers/Excel.")
                    .font(.system(size: 10)).foregroundStyle(Palette.textTertiary)
            }
        }
        .sheet(isPresented: $showRestore) { RestoreBackupSheet() }
        .sheet(isPresented: $showTrash) { TrashView() }
    }

    // MARK: Notifications

    private var notificationsCard: some View {
        SectionCard(title: "Notifications", subtitle: "All-day nudges, on-device", accent: Palette.azure) {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text(notifs.authorized ? "Permission granted" : "Permission needed")
                        .font(.system(size: 12)).foregroundStyle(notifs.authorized ? Palette.positive : Palette.warning)
                    Spacer()
                    if !notifs.authorized {
                        Button("Allow") { Task { _ = await notifs.requestAuthorization(); await notifs.refreshStatus(); notifs.scheduleDailyDigest() } }
                            .buttonStyle(.glassProminent).tint(Palette.azure)
                        Button("Open System Settings") { openNotificationSettings() }.buttonStyle(.glass)
                    }
                }
                Toggle(isOn: Binding(get: { notifs.enabled }, set: { notifs.enabled = $0; notifs.scheduleDailyDigest() })) {
                    Text("Daily digest (morning · midday · evening)").font(.system(size: 13)).foregroundStyle(Palette.textPrimary)
                }
                .toggleStyle(.switch).tint(Palette.azure)
                .disabled(!notifs.authorized)
                HStack(spacing: 10) {
                    Button("Test in-app (bell)") {
                        Notify.post(context, kind: "info", subject: "Test notification",
                                    body: "This appeared in your inbox — open the bell, top-right.", feature: .dashboard)
                    }.buttonStyle(.glassProminent).tint(Palette.azure)
                    Button("Test macOS banner") { notifs.sendNow(title: "Freelane", body: "macOS notifications are working.") }
                        .buttonStyle(.glass).disabled(!notifs.authorized)
                    Spacer()
                }
                Text("In-app notifications always work and live in the bell. For macOS banners, tap Allow — if no prompt appears (the app is locally built), use Open System Settings → Freelane → turn on Allow Notifications.")
                    .font(.system(size: 11)).foregroundStyle(Palette.textTertiary)
            }
        }
    }

    private func openNotificationSettings() {
        let urls = ["x-apple.systempreferences:com.apple.Notifications-Settings.extension",
                    "x-apple.systempreferences:com.apple.preference.notifications"]
        for s in urls { if let u = URL(string: s), NSWorkspace.shared.open(u) { return } }
    }

    // MARK: AI

    private var aiCard: some View {
        VStack(spacing: 18) {
            brainHealthCard
            cloudAICard
        }
    }

    // MARK: Brain health — see at a glance if any brain keeps failing

    private var brainHealthCard: some View {
        let health = BrainHealth.shared
        let known = ["on-device", "cloud"].filter { health.stats[$0] != nil }
        return Group {
            if !known.isEmpty {
                SectionCard(title: "Brain health", subtitle: "Every AI call is tracked — a failing brain can't hide", accent: Palette.indigo) {
                    VStack(spacing: 8) {
                        ForEach(known, id: \.self) { source in
                            if let s = health.stats[source] { healthRow(source, s) }
                        }
                    }
                }
            }
        }
    }

    private func healthRow(_ source: String, _ s: BrainHealth.Stat) -> some View {
        let total = s.ok + s.fail
        let state: Color = s.consecutive >= 3 ? Palette.negative : (s.consecutive > 0 ? Palette.warning : Palette.positive)
        return HStack(spacing: 10) {
            Circle().fill(state).frame(width: 7, height: 7)
            VStack(alignment: .leading, spacing: 1) {
                Text(BrainHealth.displayName(source)).font(.system(size: 12, weight: .medium)).foregroundStyle(Palette.textPrimary)
                if let err = s.lastError, s.consecutive > 0 {
                    Text(err).font(.system(size: 10)).foregroundStyle(Palette.negative).lineLimit(2)
                } else if let at = s.lastFailAt, s.fail > 0 {
                    Text("Last failure \(at.formatted(.relative(presentation: .named)))").font(.system(size: 10)).foregroundStyle(Palette.textTertiary)
                }
            }
            Spacer()
            Text(total == 0 ? "—" : "\(s.ok)/\(total) ok")
                .font(.system(size: 11, weight: .semibold, design: .rounded)).monospacedDigit()
                .foregroundStyle(s.fail == 0 ? Palette.positive : Palette.textSecondary)
            if s.consecutive >= 3 {
                Text("FAILING").font(.system(size: 9, weight: .bold)).foregroundStyle(Palette.negative)
                    .padding(.horizontal, 6).padding(.vertical, 2).background(Palette.negative.opacity(0.16), in: Capsule())
            }
        }
        .padding(.vertical, 7).padding(.horizontal, 10)
        .insetRow(cornerRadius: Radii.field, hoverable: false)
    }

    private var cloudAICard: some View {
        SectionCard(title: "AI", subtitle: "Your brains, your tokens — cloud only when you say so", accent: Palette.violet) {
            VStack(alignment: .leading, spacing: 12) {
                Toggle(isOn: Binding(get: { ai.preferOnDevice }, set: { ai.preferOnDevice = $0 })) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text("Use Apple Intelligence on-device").font(.system(size: 13)).foregroundStyle(Palette.textPrimary)
                        Text(FoundationModelProvider.isAvailable
                             ? "Available — macOS 27's rebuilt on-device model: fast, private, works offline. This is the app's main brain."
                             : "Not available on this Mac yet.")
                            .font(.system(size: 10)).foregroundStyle(Palette.textTertiary)
                    }
                }.toggleStyle(.switch).tint(Palette.violet)
                Toggle(isOn: Binding(get: { ai.allowCloudFallback }, set: { ai.allowCloudFallback = $0 })) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text("Use Gemini (cloud) at all").font(.system(size: 13)).foregroundStyle(Palette.textPrimary)
                        Text("Off (recommended): everything — questions, tagging, summaries AND chat — runs on Apple's on-device model. Zero cloud tokens, fully private. On: Gemini assists where it's strongest.")
                            .font(.system(size: 10)).foregroundStyle(Palette.textTertiary)
                    }
                }.toggleStyle(.switch).tint(Palette.violet)
                LabeledField("Gemini API key") {
                    HStack {
                        SecureField("AIza…", text: $keyField).textFieldStyle(GlassFieldStyle())
                        Button("Save") { ai.setKey(keyField) }.buttonStyle(.glass)
                    }
                }
                // Local token meter — estimated AI usage this week.
                let usage = AIUsage.thisWeek()
                if !usage.isEmpty {
                    HStack(spacing: 6) {
                        Image(systemName: "gauge.with.dots.needle.bottom.50percent").font(.system(size: 11)).foregroundStyle(Palette.textTertiary)
                        Text("~\(AIUsage.totalThisWeek().formatted()) tokens this week").font(.system(size: 11, weight: .medium)).monospacedDigit().foregroundStyle(Palette.textSecondary)
                        Text("(" + usage.map { "\($0.source) \($0.tokens.formatted())" }.joined(separator: " · ") + ")")
                            .font(.system(size: 10)).foregroundStyle(Palette.textTertiary)
                        Spacer()
                    }
                }
                HStack(spacing: 10) {
                    Button("Test connection") { ai.setKey(keyField); Task { await ai.test() } }
                        .buttonStyle(.glassProminent).tint(Palette.violet).disabled(ai.busy)
                    if ai.busy { ProgressView().controlSize(.small) }
                    if let r = ai.lastResult { Label(r, systemImage: "checkmark.circle").font(.system(size: 12)).foregroundStyle(Palette.positive).lineLimit(1) }
                    if let e = ai.lastError { Label(e, systemImage: "xmark.circle").font(.system(size: 12)).foregroundStyle(Palette.negative).lineLimit(1) }
                    Spacer()
                }
                Divider().overlay(Palette.hairline)
                Text("PRIVACY — redact before sending to the cloud").font(.system(size: 9, weight: .semibold)).kerning(0.5).foregroundStyle(Palette.textTertiary)
                Toggle(isOn: Binding(get: { redactHealth }, set: { redactHealth = $0 })) {
                    Text("Hide health terms (doctor, therapy…)").font(.system(size: 12)).foregroundStyle(Palette.textPrimary)
                }.toggleStyle(.switch).tint(Palette.teal)
                Toggle(isOn: Binding(get: { redactIntimate }, set: { redactIntimate = $0 })) {
                    Text("Hide sensitive terms (lawyer, divorce…)").font(.system(size: 12)).foregroundStyle(Palette.textPrimary)
                }.toggleStyle(.switch).tint(Palette.teal)
                Text("On-device prompts are never redacted — nothing leaves this Mac. Redaction only applies to Gemini (cloud) calls. Your key is stored locally; the assistant runs cache-first.")
                    .font(.system(size: 11)).foregroundStyle(Palette.textTertiary).fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    // MARK: General

    private var generalCard: some View {
        SectionCard(title: "General", accent: Palette.cyan) {
            LabeledField("Base currency") {
                GlassMenuPicker(selection: Binding(
                    get: { settings.first?.baseCurrency ?? "PHP" },
                    // Changing base rescales every stored figure (see MoneyEngine.changeBaseCurrency)
                    // — confirm first, since it touches all history.
                    set: { newValue in if newValue != (settings.first?.baseCurrency ?? "PHP") { pendingBase = newValue } }),
                    options: baseCurrencies, label: { $0 })
                    .frame(width: 120)
                    .confirmationDialog("Switch base currency to \(pendingBase ?? "")?",
                                        isPresented: Binding(get: { pendingBase != nil }, set: { if !$0 { pendingBase = nil } })) {
                        Button("Convert everything to \(pendingBase ?? "")") {
                            if let nb = pendingBase {
                                do { try MoneyEngine(context: context).changeBaseCurrency(to: nb) }
                                catch { baseError = error.localizedDescription }
                            }
                            pendingBase = nil
                        }
                        Button("Cancel", role: .cancel) { pendingBase = nil }
                    } message: {
                        Text("Every amount in your history will be recomputed into \(pendingBase ?? "") at the current exchange rate. Native currencies are unchanged.")
                    }
                if let baseError {
                    Text(baseError).font(.system(size: 10)).foregroundStyle(Palette.negative)
                }
            }
            LabeledField("Appearance") {
                GlassSegment(options: ["light", "dark", "system"],
                             selection: Binding(get: { appearance }, set: { appearance = $0 }),
                             label: { $0 == "light" ? "Light" : $0 == "dark" ? "Dark" : "System" })
                Text("Warm light or warm dark — switches instantly, or follow the system.")
                    .font(.system(size: 10)).foregroundStyle(Palette.textTertiary)
            }
            LabeledField("Your city") {
                TextField("e.g. Manila, Philippines", text: $city)
                    .textFieldStyle(GlassFieldStyle())
                    .onSubmit { saveCity() }
                Text("Anchors safe-to-spend to your real local cost of living (refreshed by the AI). Was previously stuck on a default town — set yours once.")
                    .font(.system(size: 10)).foregroundStyle(Palette.textTertiary)
            }
            Toggle(isOn: Binding(get: { captureHotkey }, set: { captureHotkey = $0; HotkeyManager.shared.apply() })) {
                VStack(alignment: .leading, spacing: 1) {
                    Text("Global capture hotkey (⌃⌥Space)").font(.system(size: 13)).foregroundStyle(Palette.textPrimary)
                    Text("Pop up Log Spend from anywhere, even when Freelane is in the background.")
                        .font(.system(size: 10)).foregroundStyle(Palette.textTertiary)
                }
            }.toggleStyle(.switch).tint(Palette.teal)
        }
    }

    /// Persist the city and force the next cost-of-living refresh to re-anchor to it
    /// (clearing `col.refreshedAt` skips the 2-week refresh cooldown).
    private func saveCity() {
        let trimmed = city.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }
        UserDefaults.standard.set(trimmed, forKey: "user.city")
        UserDefaults.standard.removeObject(forKey: "col.refreshedAt")
        Task { await Brain.refreshCostOfLiving(context, ai: ai) }
    }

    private var aboutCard: some View {
        SectionCard(title: "About", accent: Palette.textSecondary) {
            VStack(alignment: .leading, spacing: 6) {
                infoRow("Version", appVersionString)
                infoRow("Platform", "macOS · Apple Silicon · Liquid Glass")
                Text("Freelane is a native app. Your finances never leave this Mac — updates come straight from GitHub.")
                    .font(.system(size: 12)).foregroundStyle(Palette.textTertiary)
                updateRow
            }
        }
    }

    @ObservedObject private var updater = UpdaterModel.shared

    private var appVersionString: String {
        let v = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.1"
        let b = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1"
        return "\(v) (\(b))"
    }

    @ViewBuilder private var updateRow: some View {
        Divider().overlay(Palette.hairline).padding(.vertical, 4)
        if updater.updateAvailable {
            HStack {
                Label("Update available\(updater.latestVersion.map { " · \($0)" } ?? "")", systemImage: "arrow.down.circle.fill")
                    .font(.system(size: 12, weight: .medium)).foregroundStyle(Palette.teal)
                Spacer()
                Button("Install Update…") { updater.checkForUpdates() }.buttonStyle(.glassProminent).controlSize(.small).tint(Palette.teal)
            }
            Text("Installing keeps all your data — it just replaces the app. Downloaded straight from GitHub, signature-verified.")
                .font(.system(size: 11)).foregroundStyle(Palette.textTertiary)
        } else {
            HStack {
                Text("Updates are manual — nothing downloads on its own.").font(.system(size: 11)).foregroundStyle(Palette.textTertiary)
                Spacer()
                Button("Check for Updates…") { updater.checkForUpdates() }
                    .buttonStyle(.glass).controlSize(.small).disabled(!updater.canCheck)
            }
        }
    }

    private func infoRow(_ label: String, _ value: String) -> some View {
        HStack(alignment: .top) {
            Text(label).font(.system(size: 12, weight: .medium)).foregroundStyle(Palette.textSecondary)
            Spacer()
            Text(value).font(.system(size: 12)).foregroundStyle(Palette.textPrimary)
                .multilineTextAlignment(.trailing).textSelection(.enabled)
        }
    }

    private func computeStoreSize() -> String {
        let fm = FileManager.default
        var total: Int64 = 0
        for suffix in ["", "-shm", "-wal"] {
            let p = AppPaths.root.appendingPathComponent("Freelane.store\(suffix)").path
            if let attrs = try? fm.attributesOfItem(atPath: p), let s = attrs[.size] as? Int64 { total += s }
        }
        return ByteCountFormatter.string(fromByteCount: total, countStyle: .file)
    }
}

/// Forgiving money parse — accepts "1,500", "1 500", " 1500 " the way a human types them.
fileprivate func parseAmount(_ s: String) -> Double? {
    Double(s.replacingOccurrences(of: ",", with: "").replacingOccurrences(of: " ", with: ""))
}

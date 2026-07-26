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
    @State private var keyDraft = ""
    @State private var testingKey = false
    @State private var keyResult: (ok: Bool, message: String)?
    @State private var modelTick = 0
    @State private var storeSize = "—"
    @State private var denied: Set<String> = []
    @State private var sub = 0
    @State private var pendingBase: String?
    @State private var baseError: String?
    @FocusState private var cityFocused: Bool
    @AppStorage("integ.reminders") private var remindersOn = false
    @AppStorage("integ.contacts") private var contactsOn = false
    @AppStorage("hotkey.capture.enabled") private var captureHotkey = true   // matches HotkeyManager's on-by-default
    @AppStorage("appearance") private var appearance = "dark"
    @State private var city = UserDefaults.standard.string(forKey: "user.city") ?? ""
    @State private var backedUp = false
    @State private var showTrash = false
    @State private var showRestore = false

    /// Only currencies the app can actually convert into.
    ///
    /// The picker used to list all fourteen supported codes. Picking one with no stored FX rate
    /// walked you through a red destructive confirmation, took a full database backup, and THEN
    /// failed with "no exchange rate yet" — a dead end reached the long way round. A currency you
    /// can't switch to doesn't belong in the menu.
    private var baseCurrencies: [String] {
        CurrencyFormat.supported.filter { $0 == base || rates.hasRate(for: $0) }
    }

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
            ? ["General", "Storage", "Notifications", "Intelligence", "Integrations", "Cloud", "About"]
            : ["General", "Storage", "Notifications", "Intelligence", "Integrations", "About"]
        let current = sub < tabs.count ? tabs[sub] : (tabs.last ?? "General")
        let subtitle = (SyncManager.cloudSyncEnabled && sync.connected)
            ? "Synced to your private cloud — and fully usable offline."
            : "Your records live on this Mac. Journalling asks Gemini."
        return Page("Settings", subtitle: subtitle, subtabs: tabs, selection: $sub) {
            switch current {
            case "General": generalCard; recalibrateCard
            case "Storage": storageCard
            case "Notifications": notificationsCard
            case "Intelligence": aiCard
            case "Integrations": integrationsCard
            default: aboutCard
            }
        }
        .task {
            await notifs.refreshStatus()
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
            VStack(alignment: .leading, spacing: 16) {
                ForEach(wallets.filter { $0.isHolding && !$0.archived }) { w in
                    let currentBase = WalletMath.balance(of: w, ledger: ledger)
                    let cur = chosenCurrency(w)
                    let currentNative = cur == base ? currentBase : currentBase / rates.rate(for: cur)
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(spacing: 12) {
                            WalletGlyph(wallet: w, size: 26)
                            VStack(alignment: .leading, spacing: 2) {
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
                                set: { recalAmounts[w.id] = $0 })).fieldWell()
                            Button("Fix") { recalibrate(w) }
                                .buttonStyle(.glassProminent).tint(Palette.azure)
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

    // The Cloud settings card lived here: ~65 lines of Supabase URL / anon key / password UI
    // behind `SyncManager.cloudSyncEnabled`, which is a compile-time `false`. The tab was never
    // built, the switch case was unreachable, and the state backing it was dead. Deleted; the
    // sync engine itself stays, ready for the day a companion app needs it.

    // MARK: Integrations

    private var integrationsCard: some View {
        VStack(spacing: 20) {
            SectionCard(title: "Apple integrations", subtitle: "All off until you turn them on — access is requested here", accent: Palette.cyan) {
                VStack(alignment: .leading, spacing: 16) {
                    integToggle($remindersOn, "Reminders", "See and complete your Apple Reminders alongside Tasks. Also feeds the AI's awareness below.", "checklist") {
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
            personalContextCard
        }
    }

    // MARK: Personal context — the AI's awareness of life outside the app

    @AppStorage("signals.messages") private var sigMessages = false
    @AppStorage("signals.safari") private var sigSafari = false
    @AppStorage("signals.calendar") private var sigCalendar = false

    private var needsFullDisk: Bool {
        (sigMessages && !LifeSignals.canRead(LifeSignals.messagesDBPath))
        || (sigSafari && !LifeSignals.canRead(LifeSignals.safariDBPath))
    }

    private var personalContextCard: some View {
        SectionCard(title: "Personal context",
                    subtitle: "Make the AI aware of your life outside the app — on-device only, always") {
            VStack(alignment: .leading, spacing: 16) {
                Text("Once a day, the on-device model reads the enabled sources and keeps only THEMES — \"apartment hunting\", \"in touch with Sarah a lot\" — never quotes. Those themes make journal questions, insights, and chat aware of your actual life. This digest is produced by Apple's on-device model and stays on this Mac; only the themes it distils are ever included when Gemini writes a question.")
                    .font(.system(size: 11)).foregroundStyle(Palette.textTertiary).fixedSize(horizontal: false, vertical: true)
                signalToggle($sigMessages, "Messages", "Who you're in touch with and what's going on — from your iMessage history.", "message")
                Divider().overlay(Palette.hairline)
                signalToggle($sigSafari, "Safari", "Your recent sites and searches — what you're figuring out lately.", "safari")
                Divider().overlay(Palette.hairline)
                integToggle($sigCalendar, "Calendar", "What's coming up in the next two weeks.", "calendar") {
                    (try? await EventBridge.store.requestFullAccessToEvents()) ?? false
                }
                if needsFullDisk {
                    HStack(spacing: 8) {
                        Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 11)).foregroundStyle(Palette.warning)
                        Text("Messages and Safari need **Full Disk Access**: System Settings → Privacy & Security → Full Disk Access → add Freelane, then relaunch.")
                            .font(.system(size: 11)).foregroundStyle(Palette.textSecondary).fixedSize(horizontal: false, vertical: true)
                        Spacer()
                        Button("Open Settings") {
                            if let u = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles") {
                                NSWorkspace.shared.open(u)
                            }
                        }.buttonStyle(.glass).controlSize(.small)
                    }
                }
                // TRANSPARENCY: show exactly what the digest currently believes, so a wrong guess
                // is visible (and correctable by refreshing) instead of silently haunting questions.
                if LifeSignals.anyOn {
                    Divider().overlay(Palette.hairline)
                    HStack {
                        Text("What it currently thinks").font(.system(size: 12, weight: .semibold)).foregroundStyle(Palette.textPrimary)
                        Spacer()
                        Button {
                            digestRefreshing = true
                            Task { await LifeSignals.refresh(context, force: true); await MainActor.run { digestRefreshing = false; digestTick += 1 } }
                        } label: {
                            Label(digestRefreshing ? "Reading…" : "Refresh now", systemImage: "arrow.triangle.2.circlepath").font(.system(size: 11))
                        }.buttonStyle(.plain).foregroundStyle(Palette.cyan).disabled(digestRefreshing)
                    }
                    Group {
                        if let d = LifeSignals.digest(context) {
                            VStack(alignment: .leading, spacing: 4) {
                                if !d.doing.isEmpty { digestLine("Life", d.doing.joined(separator: " · ")) }
                                if !d.reading.isEmpty { digestLine("Reading about", d.reading.joined(separator: " · ")) }
                                if !d.people.isEmpty { digestLine("In touch with", d.people.joined(separator: ", ")) }
                                ForEach(d.notes, id: \.self) { digestLine("Note", $0) }
                            }
                        } else {
                            Text("No digest yet — it builds once a day, or tap Refresh now.")
                                .font(.system(size: 11)).foregroundStyle(Palette.textTertiary)
                        }
                    }
                    .id(digestTick)   // re-read after a manual refresh
                }
            }
        }
    }

    @State private var digestRefreshing = false
    @State private var digestTick = 0

    private func digestLine(_ label: String, _ value: String) -> some View {
        HStack(alignment: .top, spacing: 6) {
            Text(label.uppercased()).font(.system(size: 9, weight: .bold)).kerning(0.4)
                .foregroundStyle(Palette.textTertiary).frame(width: 88, alignment: .leading).padding(.top, 2)
            Text(value).font(.system(size: 11)).foregroundStyle(Palette.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    /// Toggle for the file-based sources (no TCC prompt to await — Full Disk Access is manual).
    private func signalToggle(_ flag: Binding<Bool>, _ title: String, _ desc: String, _ icon: String) -> some View {
        Toggle(isOn: Binding(get: { flag.wrappedValue }, set: { on in
            flag.wrappedValue = on
            if on { Task { await LifeSignals.refresh(context, force: true) } }
        })) {
            HStack(spacing: 12) {
                Image(systemName: icon).font(.system(size: 13)).foregroundStyle(Palette.cyan).frame(width: 22)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.system(size: 13, weight: .medium)).foregroundStyle(Palette.textPrimary)
                    Text(desc).font(.system(size: 11)).foregroundStyle(Palette.textTertiary).fixedSize(horizontal: false, vertical: true)
                }
            }
        }.toggleStyle(.switch).tint(Palette.cyan)
    }

    /// A permission toggle that explains itself when macOS says no.
    ///
    /// If you've previously denied Reminders/Contacts/Calendar in System Settings, macOS shows no
    /// prompt at all — the request returns false immediately and the switch just snapped back with
    /// zero explanation, which reads as the app being broken. It now says what happened and offers
    /// the one place you can undo it.
    private func integToggle(_ flag: Binding<Bool>, _ title: String, _ desc: String, _ icon: String,
                             pane: String = "Privacy_Reminders",
                             request: @escaping () async -> Bool) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Toggle(isOn: Binding(get: { flag.wrappedValue }, set: { on in
                if on {
                    Task {
                        let ok = await request()
                        flag.wrappedValue = ok
                        if ok { denied.remove(title) } else { denied.insert(title) }
                    }
                } else {
                    flag.wrappedValue = false
                    denied.remove(title)
                }
            })) {
                HStack(spacing: 12) {
                    Image(systemName: icon).font(.system(size: 13)).foregroundStyle(Palette.cyan).frame(width: 22)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(title).font(.system(size: 13, weight: .medium)).foregroundStyle(Palette.textPrimary)
                        Text(desc).font(.system(size: 11)).foregroundStyle(Palette.textTertiary).fixedSize(horizontal: false, vertical: true)
                    }
                }
            }.toggleStyle(.switch).tint(Palette.cyan)

            if denied.contains(title) {
                HStack(spacing: 8) {
                    Image(systemName: "hand.raised.fill").font(.system(size: 10)).foregroundStyle(Palette.warning)
                    Text("macOS has this blocked for Freelane.")
                        .font(.system(size: 11)).foregroundStyle(Palette.textSecondary)
                    Button("Open System Settings") {
                        if let u = URL(string: "x-apple.systempreferences:com.apple.preference.security?\(pane)") {
                            NSWorkspace.shared.open(u)
                        }
                    }
                    .font(.system(size: 11)).buttonStyle(.plain).foregroundStyle(Palette.azure)
                    Spacer(minLength: 0)
                }
                .padding(.leading, 32)
            }
        }
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
                        if DataBackup.backupNow(stamp: f.string(from: .now)) != nil {
                            backedUp = true
                            storeSize = computeStoreSize()
                            // "Backed up ✓" used to latch for the rest of the session, so a second
                            // backup gave no feedback at all — you couldn't tell it had run.
                            Task { try? await Task.sleep(for: .seconds(2)); backedUp = false }
                            DataBackup.reveal()
                        }
                    } label: { Label(backedUp ? "Backed up ✓" : "Back up now", systemImage: "externaldrive.badge.checkmark") }
                        .buttonStyle(.glassProminent).tint(Palette.azure)
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
                HStack(spacing: 12) {
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
        VStack(spacing: 20) {
            // Beliefs first: it is the thing a person actually opens this tab to check.
            memoryCard
            geminiCard
            brainsCard
        }
    }

    // MARK: The three brains

    private var brainsCard: some View {
        // WHAT THIS DOES, not which engine is up.
        //
        // This was three status rows with dots, a Private Cloud toggle, a token meter and a
        // failure table — an operations dashboard for a system with one user, who cannot act on
        // any of it. The honest content is two sentences: what runs where, and whether the part
        // you have to download is ready.
        SectionCard(title: "How Freelane thinks",
                    subtitle: "Where each kind of thinking happens",
                    accent: Palette.violet) {
            VStack(alignment: .leading, spacing: 12) {
                Text("Two models share the work. Apple's built-in one stays on this Mac and handles the small, constant jobs — sorting a spend into a category, working out a bill increase — because it answers instantly and costs nothing. Gemini writes everything you actually read: your journal questions, your reflections, and the chat.")
                    .font(.system(size: 12)).foregroundStyle(Palette.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)

                Label("Your journal entries are sent to Google when the app writes a question or reads an entry. Your money records are not — those never leave this Mac.", systemImage: "arrow.up.forward.app")
                    .font(.system(size: 12, weight: .medium)).foregroundStyle(Palette.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)

                if !ai.onDeviceReady {
                    Label("Apple Intelligence is off, so the small jobs go to Gemini too — everything still works, it just needs a connection.",
                          systemImage: "info.circle")
                        .font(.system(size: 11)).foregroundStyle(Palette.textTertiary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                brainNotes
            }
        }
    }

    /// The one thing worth saying about a brain, and only when there IS something.
    ///
    /// "On-device keeps failing" used to point here, and here held nothing at all — the health card
    /// this replaces was written but never rendered, so the notification sent you to a page with no
    /// mention of the subject. This says the two things that can actually be true, in a sentence
    /// each, and shows nothing at all when both brains are behaving.
    @ViewBuilder private var brainNotes: some View {
        let health = BrainHealth.shared
        let refusedOnDevice = health.stats[AIBrainID.onDevice.rawValue]?.refused ?? 0
        let broken = AIBrainID.allCases.filter { health.isBroken($0) }

        if refusedOnDevice > 0 || !broken.isEmpty {
            Rectangle().fill(Palette.hairline).frame(height: 1).padding(.vertical, 2)
        }
        if refusedOnDevice > 0 {
            Label("Apple's model has declined \(refusedOnDevice) \(refusedOnDevice == 1 ? "request" : "requests") on safety grounds — it won't read personal writing, which is why your journal goes to Gemini instead. Nothing is broken and there's nothing to change.",
                  systemImage: "hand.raised")
                .font(.system(size: 11)).foregroundStyle(Palette.textTertiary)
                .fixedSize(horizontal: false, vertical: true)
        }
        ForEach(broken, id: \.self) { b in
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 11)).foregroundStyle(Palette.warning)
                VStack(alignment: .leading, spacing: 4) {
                    Text("\(b.label) failed too often and has been taken out of rotation. \(health.stats[b.rawValue]?.lastError ?? "")")
                        .font(.system(size: 11)).foregroundStyle(Palette.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                    Button("Try \(b.label) again") { health.reset(b) }
                        .buttonStyle(.glass).controlSize(.small)
                }
                Spacer(minLength: 0)
            }
        }
    }

    // MARK: Gemini

    private var geminiCard: some View {
        SectionCard(title: "Gemini",
                    subtitle: "The model that writes your questions",
                    accent: Palette.teal) {
            VStack(alignment: .leading, spacing: 12) {
                if GeminiConfig.hasKey && keyDraft.isEmpty {
                    HStack(spacing: 8) {
                        Image(systemName: "checkmark.circle.fill").foregroundStyle(Palette.positive)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Connected").font(.system(size: 12, weight: .medium)).foregroundStyle(Palette.textPrimary)
                            Text("Your key is in the macOS Keychain — not in the app's files, and never in a backup or export.")
                                .font(.system(size: 10)).foregroundStyle(Palette.textTertiary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        Spacer()
                    }
                    HStack(spacing: 12) {
                        Button("Test") { testGemini() }.buttonStyle(.glass).disabled(testingKey)
                        Button("Replace key") { keyDraft = " " }.buttonStyle(.glass)
                        Button("Remove", role: .destructive) {
                            GeminiConfig.apiKey = nil; keyResult = nil
                        }.buttonStyle(.glass)
                        Spacer()
                    }
                } else {
                    Text("Paste an API key from aistudio.google.com/apikey. It's stored in the macOS Keychain.")
                        .font(.system(size: 12)).foregroundStyle(Palette.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                    HStack(spacing: 8) {
                        SecureField("AIza…", text: $keyDraft).fieldWell()
                        Button("Save") {
                            GeminiConfig.apiKey = keyDraft
                            keyDraft = ""
                            testGemini()
                        }
                        .buttonStyle(.glassProminent).tint(Palette.azure)
                        .disabled(keyDraft.trimmingCharacters(in: .whitespaces).count < 20)
                    }
                }

                if testingKey {
                    HStack(spacing: 8) {
                        ProgressView().controlSize(.small)
                        Text("Asking Gemini…").font(.system(size: 11)).foregroundStyle(Palette.textSecondary)
                    }
                } else if let keyResult {
                    Label(keyResult.ok ? keyResult.message : keyResult.message,
                          systemImage: keyResult.ok ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                        .font(.system(size: 11))
                        .foregroundStyle(keyResult.ok ? Palette.positive : Palette.warning)
                        .fixedSize(horizontal: false, vertical: true)
                }

                if GeminiConfig.hasKey {
                    Divider().overlay(Palette.hairline).padding(.vertical, 2)
                    LabeledField("Quality") {
                        GlassSegment(options: GeminiConfig.Tier.allCases,
                                     selection: Binding(get: { GeminiConfig.smartModel },
                                                        set: { GeminiConfig.smartModel = $0; modelTick += 1 }),
                                     label: { $0.label })
                        Text("Used for journal questions, reflections and chat. Sorting a spend into a category always uses the cheapest tier — you never read that output.")
                            .font(.system(size: 10)).foregroundStyle(Palette.textTertiary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .id(modelTick)
                }
            }
        }
    }

    /// Prove the key works, from the app, against the model actually configured — rather than
    /// leaving the user to discover it doesn't the next time a question fails to appear.
    private func testGemini() {
        guard #available(macOS 26.0, *) else { return }
        testingKey = true; keyResult = nil
        Task {
            let brain = GeminiBrain(tier: GeminiConfig.smartModel)
            do {
                let reply = try await brain.text(AIRequest("Reply with the single word: ready.",
                                                           instructions: "You reply in one word.",
                                                           temperature: 0))
                keyResult = (true, "Working — \(GeminiConfig.smartModel.rawValue) answered “\(reply.prefix(24))”.")
            } catch {
                keyResult = (false, error.localizedDescription)
            }
            testingKey = false
        }
    }

    // MARK: Brain health — see at a glance if any brain keeps failing

    // MARK: What the app believes about you

    /// Memory made inspectable. The old build kept 253 beliefs the user could neither see nor
    /// correct — including several they had explicitly denied — and quietly wrote questions from
    /// them. Anything the app thinks it knows is now listed here and deletable in one click.
    private var memoryCard: some View {
        let beliefs = Memory.live(context)
            .filter { $0.subjectKind == "user" }
            .sorted { Memory.weight($0) > Memory.weight($1) }
        let affirmed = beliefs.filter { $0.polarity != "deny" }
        let denied = beliefs.filter { $0.polarity == "deny" }

        return SectionCard(title: "What Freelane believes about you",
                           subtitle: affirmed.isEmpty && denied.isEmpty
                               ? "Nothing yet — it learns from what you write"
                               : "\(affirmed.count) things it thinks are true · \(denied.count) it knows aren't",
                           accent: Palette.indigo) {
            VStack(alignment: .leading, spacing: 8) {
                // Scrolls instead of truncating. Showing 12 of 47 with no count and no way to see
                // the rest leaves 35 beliefs exactly as invisible as before this card existed.
                ScrollView {
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(affirmed) { f in beliefRow(f, denied: false) }
                        if !denied.isEmpty {
                            Text("THINGS YOU'VE CORRECTED IT ON").font(.system(size: 9, weight: .semibold))
                                .kerning(0.5).foregroundStyle(Palette.textTertiary).padding(.top, 6)
                            ForEach(denied) { f in beliefRow(f, denied: true) }
                        }
                    }
                }
                .frame(maxHeight: 340)
                if affirmed.isEmpty && denied.isEmpty {
                    Text("As you journal, anything durable it picks up will show here — and you can delete any of it.")
                        .font(.system(size: 12)).foregroundStyle(Palette.textTertiary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    private func beliefRow(_ f: AIFact, denied: Bool) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: denied ? "xmark.circle" : "circle.fill")
                .font(.system(size: denied ? 11 : 6))
                .foregroundStyle(denied ? Palette.negative : Palette.indigo)
                .padding(.top, denied ? 2 : 5)
            VStack(alignment: .leading, spacing: 2) {
                Text(f.value).font(.system(size: 12)).foregroundStyle(Palette.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                Text(f.source == "user_answered" ? "You told it this" : "Picked up from your writing")
                    .font(.system(size: 9)).foregroundStyle(Palette.textTertiary)
            }
            Spacer()
            Button { Memory.forget(context, f) } label: {
                Image(systemName: "trash").font(.system(size: 10)).foregroundStyle(Palette.textTertiary)
            }.buttonStyle(.iconPress).help("Forget this")
        }
        .padding(.vertical, 8).padding(.horizontal, 12)
        .insetRow(cornerRadius: Radii.field, hoverable: false)
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
                        // Destructive role, because it is: this rewrites `amountBase` on every
                        // spend, recurring, ledger entry, allocation and withdrawal in the store,
                        // with no undo. As a default button it fired on ⏎.
                        Button("Convert everything to \(pendingBase ?? "")", role: .destructive) {
                            if let nb = pendingBase {
                                // Back up FIRST. A full-database rewrite with a one-click restore
                                // sitting two tabs away and never being taken was the real problem.
                                _ = DataBackup.backupNow(stamp: "before-base-\(nb)")
                                do { try MoneyEngine(context: context).changeBaseCurrency(to: nb) }
                                catch { baseError = error.localizedDescription }
                            }
                            pendingBase = nil
                        }
                        Button("Cancel", role: .cancel) { pendingBase = nil }
                    } message: {
                        Text("Every amount in your history is recomputed into \(pendingBase ?? "") at today's rate. Native currencies are unchanged. A backup is saved first — Storage → Restore backup rolls this back.")
                    }
                if let baseError {
                    Text(baseError).font(.system(size: 10)).foregroundStyle(Palette.negative)
                } else if baseCurrencies.count <= 1 {
                    Text("Only \(base) is available until Freelane has exchange rates — they arrive with your first payment in another currency, or from the next rate refresh.")
                        .font(.system(size: 10)).foregroundStyle(Palette.textTertiary)
                } else {
                    Text("Everything you've recorded is converted. Currencies without an exchange rate yet aren't listed.")
                        .font(.system(size: 10)).foregroundStyle(Palette.textTertiary)
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
                    .fieldWell()
                    .onSubmit { saveCity() }
                        .focused($cityFocused)
                        // `onSubmit` alone meant typing a city and then clicking anywhere else —
                        // another subtab, the sidebar, the close button — showed the new text while
                        // UserDefaults kept the old one. This is the value safe-to-spend anchors
                        // its cost-of-living to, so a silently-dropped edit corrupts a headline
                        // number on the Dashboard.
                        .onChange(of: cityFocused) { _, focused in if !focused { saveCity() } }
                Text("Anchors safe-to-spend to your real local cost of living (refreshed by the AI). Was previously stuck on a default town — set yours once.")
                    .font(.system(size: 10)).foregroundStyle(Palette.textTertiary)
            }
            Toggle(isOn: Binding(get: { captureHotkey }, set: { captureHotkey = $0; HotkeyManager.shared.apply() })) {
                VStack(alignment: .leading, spacing: 2) {
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

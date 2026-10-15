import SwiftUI
import SwiftData

/// Settings: the few things worth changing, grouped, with a door to the full list.
struct SettingsPage: View {
    let state: MoneyState
    @AppStorage("appearance.v2") private var appearance = "light"
    @AppStorage("v2.openOn") private var openOn = "now"
    @State private var section = "General"
    @State private var legacy = false
    @State private var backups: [DataBackup.Item] = []
    @State private var backedUp: String?
    @State private var cloudPassword = ""
    @ObservedObject private var updater = UpdaterModel.shared

    private let sections: [(String, String)] = [("General", Sym.tune), ("Money", Sym.payments), ("Phone", Sym.phoneIphone),
                                                ("Privacy and AI", Sym.lock), ("Backups", Sym.history), ("About and updates", Sym.info)]

    var body: some View {
        Pane {
            PaneHeader(title: "Settings")
            HStack(alignment: .top, spacing: 24) {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(sections, id: \.0) { s in navItem(s.0, s.1) }
                    Spacer()
                    M3Button(title: "More settings", icon: Sym.openInNew, kind: .plain) { legacy = true }
                }
                .frame(width: 220)
                ScrollViewReader { proxy in
                    PaneScroll {
                        VStack(alignment: .leading, spacing: 16) {
                            group("General", "Look") { look }.appear(0)
                            group("Money", "Money") { money }.appear(1)
                            group("Phone", "Phone") { phone }.appear(2)
                            group("Privacy and AI", "Privacy and AI") { privacy }.appear(3)
                            group("Backups", "Backups") { backupsGroup }.appear(4)
                            group("About and updates", "About and updates") { about }.appear(5)
                        }
                        .padding(.bottom, 8)
                    }
                    .onChange(of: section) { _, s in withAnimation(Flow.slow) { proxy.scrollTo(s, anchor: .top) } }
                }
            }
            .padding(.top, 16)
        }
        .sheet(isPresented: $legacy) { SettingsView().frame(minWidth: 860, minHeight: 640) }
        .onAppear { backups = DataBackup.list() }
    }

    private func navItem(_ title: String, _ glyph: String) -> some View {
        let on = section == title
        return Button { withAnimation(Flow.fast) { section = title } } label: {
            HStack(spacing: 12) {
                Icon(glyph, size: 24, filled: on)
                Text(title).font(FS.font(14, 500, rond: 60))
                Spacer(minLength: 0)
            }
            .foregroundStyle(on ? MD.onSecondaryContainer : MD.onSurfaceVariant)
            .padding(.horizontal, 16).frame(height: 44)
            .background(Capsule().fill(on ? MD.secondaryContainer : .clear))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
    }

    private func group<C: View>(_ id: String, _ title: String, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(title).role(.sub, MD.onSurfaceVariant).padding(.top, 14).padding(.bottom, 4)
            content()
        }
        .padding(.horizontal, 20).padding(.bottom, 6)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 24, style: .continuous).fill(Surface.well))
        .id(id)
    }

    private func row<C: View>(_ title: String, _ sub: String, last: Bool = false, @ViewBuilder control: () -> C) -> some View {
        HStack(spacing: 16) {
            VStack(alignment: .leading, spacing: 1) {
                Text(title).role(.row)
                Text(sub).role(.supporting, MD.onSurfaceVariant).fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 16)
            control()
        }
        .padding(.vertical, 10).frame(minHeight: 56)
        .overlay(alignment: .bottom) { if !last { Rectangle().fill(Surface.hairline).frame(height: 1) } }
    }

    // MARK: Groups

    private var look: some View {
        VStack(spacing: 0) {
            row("Appearance", "White is the default") {
                ConnectedChoice(options: [("light", "Light"), ("dark", "Dark"), ("system", "Match the Mac")], selection: $appearance)
            }
            row("Open on", "The page Freelane shows when it starts", last: true) {
                Menu {
                    ForEach(Place.allCases.filter { $0 != .settings }) { p in Button(p.title) { openOn = p.rawValue } }
                } label: {
                    HStack(spacing: 2) { Text(Place(rawValue: openOn)?.title ?? "Now").font(FS.font(14, 600, rond: 60)); Icon(Sym.expandMore, size: 18) }
                        .foregroundStyle(MD.onSurface).padding(.leading, 12).padding(.trailing, 6).frame(height: 32)
                        .background(RoundedRectangle(cornerRadius: 8).fill(Surface.well2))
                }
                .menuStyle(.button).buttonStyle(.plain).menuIndicator(.hidden).fixedSize()
            }
        }
    }

    private var money: some View {
        VStack(spacing: 0) {
            row("Counted in", "Every wallet, whatever its currency, adds up in pesos at the day’s rate") {
                Text("Philippine peso · ₱").role(.row)
            }
            row("Wallet currencies", "What each wallet is counted in. Totals stay in pesos.", last: true) {
                FlowCurrencies(wallets: state.wallets)
            }
        }
    }

    private func stepButton(_ glyph: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) { Icon(glyph, size: 20).foregroundStyle(MD.onSurface).frame(width: 32, height: 32) }
            .buttonStyle(PlainButtonStyle2())
    }

    @ViewBuilder private var phone: some View {
        @Bindable var cloud = CloudSync.shared
        VStack(spacing: 0) {
            if cloud.isSignedIn {
                row("Synced with your Android phone", cloud.lastSync.map { "Last synced \(Day.ago($0)) at \($0.formatted(date: .omitted, time: .shortened))" } ?? cloud.status, last: cloud.lastError == nil) {
                    HStack(spacing: 8) {
                        M3Button(title: "Sync now", kind: .tonal, small: true) { Task { await CloudSync.shared.syncNow(userInitiated: true) } }
                        M3Button(title: "Sign out", kind: .plain) { CloudSync.shared.signOut() }
                    }
                }
            } else {
                row(DevMode.isSandboxed ? "Not syncing (test copy)" : "Not connected", "Sign in with the same account as the phone", last: true) {
                    HStack(spacing: 8) {
                        TextField("Email", text: $cloud.email).textFieldStyle(.roundedBorder).frame(width: 170)
                        SecureField("Password", text: $cloudPassword).textFieldStyle(.roundedBorder).frame(width: 120)
                        M3Button(title: "Connect", kind: .tonal, small: true) {
                            let pw = cloudPassword
                            Task { if await CloudSync.shared.signIn(email: CloudSync.shared.email, password: pw) { cloudPassword = "" } }
                        }
                        .disabled(DevMode.isSandboxed)
                    }
                }
            }
            if let err = cloud.lastError {
                Text(err).font(FS.font(12, 400)).foregroundStyle(MD.error).textSelection(.enabled).padding(.vertical, 10)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    private var privacy: some View {
        VStack(spacing: 0) {
            row("Journal questions come from Gemini", "Gemini reads your journal answers to ask good questions. Apple’s on-device model declines personal writing, so it can’t do this part.") {
                StatusLabel(title: GeminiConfig.hasKey ? "Key added" : "No key", glyph: GeminiConfig.hasKey ? Sym.check : Sym.info, tone: GeminiConfig.hasKey ? .ok : .quiet)
            }
            row("Money stays on this Mac", "Wallets, spending and payments are never sent anywhere except your own phone sync.", last: true) {
                Icon(Sym.lock, size: 20).foregroundStyle(MD.onSurfaceVariant)
            }
        }
    }

    private var backupsGroup: some View {
        VStack(spacing: 0) {
            row("Backed up on every launch", backups.first.map { "\(backups.count) kept · latest \(Day.ago($0.date))" } ?? "No backups yet") {
                HStack(spacing: 8) {
                    M3Button(title: backedUp == nil ? "Back up now" : "Done", kind: .tonal, small: true) {
                        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd-HHmmss"
                        if DataBackup.backupNow(stamp: f.string(from: .now)) != nil { backedUp = "ok"; backups = DataBackup.list() }
                    }
                    M3Button(title: "Show in Finder", kind: .plain) { DataBackup.reveal() }
                }
            }
            row("Restore a backup", "Pick one from the list; Freelane restarts on it. Your current data is backed up first.", last: true) {
                M3Button(title: "Restore…", kind: .plain) { legacy = true }
            }
        }
    }

    private var about: some View {
        let v = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? ""
        return VStack(spacing: 0) {
            row("Freelane \(v)", updater.updateAvailable ? "Version \(updater.latestVersion ?? "") is ready. Installing keeps all your data." : "Updates are manual: nothing downloads on its own.", last: true) {
                M3Button(title: updater.updateAvailable ? "Install update" : "Check for updates", kind: updater.updateAvailable ? .filled : .tonal, small: true) {
                    updater.checkForUpdates()
                }
                .disabled(!updater.canCheck)
            }
        }
    }
}

/// A connected button group (M3 Expressive): segments with small inner corners; the selected one is a full pill.
struct ConnectedChoice: View {
    let options: [(String, String)]
    @Binding var selection: String
    var body: some View {
        HStack(spacing: 2) {
            ForEach(Array(options.enumerated()), id: \.offset) { i, o in
                let on = selection == o.0
                Button { withAnimation(Flow.fast) { selection = o.0 } } label: {
                    HStack(spacing: 6) {
                        if on { Icon(Sym.check, size: 18).transition(.scale.combined(with: .opacity)) }
                        Text(o.1).font(FS.font(14, 600, rond: 60))
                    }
                    .foregroundStyle(on ? MD.onPrimary : MD.onSurface)
                    .padding(.horizontal, 16).frame(height: 36)
                    .background(UnevenRoundedRectangle(topLeadingRadius: on || i == 0 ? 18 : 6, bottomLeadingRadius: on || i == 0 ? 18 : 6,
                                                       bottomTrailingRadius: on || i == options.count - 1 ? 18 : 6,
                                                       topTrailingRadius: on || i == options.count - 1 ? 18 : 6, style: .continuous)
                        .fill(on ? MD.primary : Surface.well2))
                }
                .buttonStyle(.plain)
            }
        }
    }
}

/// Wallet → count currency, as small menus.
private struct FlowCurrencies: View {
    let wallets: [WalletLine]
    @State private var tick = 0
    private func key(_ w: WalletLine) -> String { "count.currency.\(w.id)" }
    private func currency(_ w: WalletLine) -> String {
        UserDefaults.standard.string(forKey: key(w)) ?? w.wallet.openingBalanceCurrency ?? w.wallet.currencyIn ?? w.wallet.currencyOut ?? "PHP"
    }
    /// "Bank wire — CFG Bank" → "CFG Bank".
    private func short(_ name: String) -> String { name.components(separatedBy: " — ").last ?? name }

    var body: some View {
        let own = wallets.filter { currency($0) != "PHP" }
        let pesos = wallets.filter { currency($0) == "PHP" }
        ChipFlow(spacing: 6) {
            ForEach(own) { w in
                Menu { picker(w) } label: { chip("\(short(w.name)) · \(currency(w))") }
                    .menuStyle(.button).buttonStyle(.plain).menuIndicator(.hidden).fixedSize()
                    .help("What \(w.name) is counted in")
            }
            if !pesos.isEmpty {
                Menu {
                    ForEach(pesos) { w in Menu(w.name) { picker(w) } }
                } label: { chip("\(own.isEmpty ? "all" : "others") · PHP") }
                    .menuStyle(.button).buttonStyle(.plain).menuIndicator(.hidden).fixedSize()
                    .help(pesos.map(\.name).joined(separator: ", "))
            }
        }
        .frame(maxWidth: 360, alignment: .trailing)
        .id(tick)
    }

    @ViewBuilder private func picker(_ w: WalletLine) -> some View {
        ForEach(CurrencyFormat.supported, id: \.self) { c in
            Button { UserDefaults.standard.set(c, forKey: key(w)); tick += 1 } label: {
                if c == currency(w) { Label(c, systemImage: "checkmark") } else { Text(c) }
            }
        }
    }

    private func chip(_ t: String) -> some View {
        Text(t).font(FS.font(12, 600, rond: 60)).foregroundStyle(MD.onSurfaceVariant)
            .padding(.horizontal, 8).frame(height: 24)
            .background(RoundedRectangle(cornerRadius: 8).fill(Surface.well2))
            .contentShape(RoundedRectangle(cornerRadius: 8))
    }
}

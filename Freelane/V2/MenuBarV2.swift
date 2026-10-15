import SwiftUI
import SwiftData
import AppKit

/// The menu-bar window: what's free under the bill rule, the next bill, every wallet, and one line to
/// log money from anywhere ("450 jollibee", "received 5000 acme gcash"). It shows what it understood
/// before you press Return, and anything logged here can be undone from here.
struct MenuBarV2: View {
    @Environment(\.modelContext) private var context
    @Environment(\.openWindow) private var openWindow
    @Environment(\.accessibilityReduceMotion) private var reduce
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

    @State private var capture = ""
    @State private var picked: UUID?
    @State private var flash: Flash?
    @State private var reminders: [RemindersCapture.Candidate] = []
    @State private var pendingReminderId: String?
    @FocusState private var typing: Bool
    @Namespace private var tiles

    /// The line under the field after a log: what happened, and a way back.
    private struct Flash {
        let id = UUID()
        let text: String
        let ok: Bool
        var undo: (() -> Void)? = nil
    }

    private var base: String { settings.first?.baseCurrency ?? "PHP" }
    private var state: MoneyState {
        MoneyState.build(wallets: wallets, ledger: ledger, recurring: recurring, spends: spends, payments: payments,
                         withdrawals: withdrawals, projects: projects, clients: clients,
                         rates: Rates(base: base, rates: rateRows))
    }

    var body: some View {
        let s = state
        let shown = s.wallets.filter(\.inTotals)
        let d = draft(s)
        VStack(alignment: .leading, spacing: 0) {
            header
            FreeBand(state: s).padding(.top, 12).appear(0)
            if let b = s.nextBill { nextBill(b).padding(.top, 8).appear(1) }
            captureCard(s, shown: shown, draft: d).padding(.top, 12).appear(2)
            if !reminders.isEmpty { reminderBlock.appear(3) }
            recent(s).appear(4)
        }
        .padding(16)
        .frame(width: 360)
        .background(Surface.pane)
        .onAppear {
            if picked == nil { picked = lastUsedWallet(shown) }
            typing = true
        }
        .task {
            guard !DevMode.isSandboxed else { return }
            reminders = await RemindersCapture.pending(base: base, currencies: CurrencyFormat.supported)
        }
    }

    // MARK: Header

    private var header: some View {
        HStack(spacing: 10) {
            Image(nsImage: NSApp.applicationIconImage).resizable().interpolation(.high).frame(width: 30, height: 30)
            VStack(alignment: .leading, spacing: 0) {
                Text("Freelane").font(FS.font(16, 600, rond: 100)).foregroundStyle(MD.onSurface)
                Text(Day.long(.now)).role(.supporting, MD.onSurfaceVariant)
            }
            Spacer()
            IconButton(glyph: Sym.openInNew, help: "Open Freelane") { openApp() }
        }
    }

    // MARK: Next bill

    private func nextBill(_ b: BillLine) -> some View {
        HStack(spacing: 12) {
            Badge(subject: .bill(b.label), size: 36)
            VStack(alignment: .leading, spacing: 1) {
                Text(b.label).role(.row).lineLimit(1)
                Text(billLine(b)).role(.supporting, MD.onSurfaceVariant).lineLimit(1)
            }
            Spacer(minLength: 8)
            Money(value: b.amount, decimals: false, estimate: b.estimate)
        }
        .padding(.leading, 10).padding(.trailing, 16).frame(height: 56)
        .background(RoundedRectangle(cornerRadius: 20, style: .continuous).fill(Surface.well))
    }

    private func billLine(_ b: BillLine) -> String {
        guard let due = b.nextDue else { return "next bill" }
        return "next bill · \(Day.until(due))" + (b.isSetAside ? " · set aside" : "")
    }

    // MARK: Capture

    private func captureCard(_ s: MoneyState, shown: [WalletLine], draft d: NaturalCapture.Draft?) -> some View {
        let into = d?.walletId ?? picked ?? lastUsedWallet(shown)
        return VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 10) {
                Icon(d?.isPayment == true ? Sym.southWest : Sym.edit, size: 20)
                    .foregroundStyle(typing ? MD.primary : MD.onSurfaceVariant)
                    .contentTransition(.opacity)
                TextField("450 jollibee", text: $capture)
                    .textFieldStyle(.plain)
                    .font(FS.font(15, 400))
                    .foregroundStyle(MD.onSurface)
                    .focused($typing)
                    .onSubmit { submit(s, shown: shown) }
                Button { submit(s, shown: shown) } label: {
                    Icon(Sym.keyboardReturn, size: 20)
                        .foregroundStyle(d == nil ? MD.onSurfaceVariant.opacity(0.5) : MD.onPrimary)
                        .frame(width: 34, height: 34)
                        .background(Circle().fill(d == nil ? Surface.well2 : MD.primary))
                        .contentShape(Circle())
                }
                .buttonStyle(PlainButtonStyle2())
                .disabled(d == nil)
                .help("Log it")
            }
            .padding(.leading, 16).padding(.trailing, 6).frame(height: 48)
            .background(Capsule().fill(Surface.pane))
            .overlay(Capsule().strokeBorder(typing ? MD.primary : .clear, lineWidth: 2))
            .animation(Flow.effects, value: typing)
            .animation(Flow.fast, value: d == nil)

            status(d, into: into, shown: shown)
                .padding(.horizontal, 6).padding(.top, 10)

            HStack(spacing: 4) {
                ForEach(shown) { w in tile(w, on: w.id == into) }
            }
            .padding(.top, 10)
            .animation(Flow.pick(Flow.spatial, reduce: reduce), value: into)
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 28, style: .continuous).fill(Surface.well))
    }

    /// One line under the field: what was just logged, else what's about to be logged, else a hint.
    @ViewBuilder private func status(_ d: NaturalCapture.Draft?, into: UUID?, shown: [WalletLine]) -> some View {
        Group {
            if let f = flash {
                HStack(spacing: 8) {
                    Icon(f.ok ? Sym.checkCircle : Sym.error, size: 18, filled: true).foregroundStyle(f.ok ? MD.primary : MD.error)
                    Text(f.text).role(.supporting, MD.onSurface).lineLimit(1)
                    Spacer(minLength: 4)
                    if let u = f.undo {
                        M3Button(title: "Undo", kind: .text, small: true) {
                            u()
                            withAnimation(Flow.fast) { flash = nil }
                        }
                    }
                }
                .id(f.id)
            } else if let d {
                let name = shown.first { $0.id == into }?.name ?? "a wallet"
                let what = d.vendor ?? d.description
                HStack(spacing: 6) {
                    Text(d.isPayment ? "Money in" : "Spending").font(FS.font(13, 600, rond: 60)).foregroundStyle(MD.primary)
                    Text(verbatim: CurrencyFormat.string(d.amount, d.currency, compact: false)).font(FS.font(13, 600)).foregroundStyle(MD.onSurface)
                    Text(([what].compactMap { $0 } + [(d.isPayment ? "into " : "from ") + name]).joined(separator: " · "))
                        .role(.supporting, MD.onSurfaceVariant).lineLimit(1)
                    Spacer(minLength: 0)
                }
                .id("draft")
            } else {
                Text("An amount and what it was. Add “received” for money in, or a wallet’s name.")
                    .role(.supporting, MD.onSurfaceVariant).lineLimit(2).fixedSize(horizontal: false, vertical: true)
                    .id("hint")
            }
        }
        .frame(minHeight: 28, alignment: .leading)
        .transition(.opacity.combined(with: .offset(y: reduce ? 0 : 4)))
        .animation(Flow.spatial, value: flash?.id)
        .animation(Flow.fast, value: d == nil)
    }

    /// A wallet you can log into, with its balance. The chosen one sits on a pill that slides between them.
    private func tile(_ w: WalletLine, on: Bool) -> some View {
        Button {
            withAnimation(Flow.pick(Flow.spatial, reduce: reduce)) { picked = w.id }
        } label: {
            VStack(spacing: 4) {
                Badge(subject: .wallet(w.wallet), size: 30)
                    .scaleEffect(on ? 1.06 : 1)
                Text(w.name).font(FS.font(11, 600, rond: 60)).foregroundStyle(on ? MD.onSecondaryContainer : MD.onSurface).lineLimit(1)
                Money(value: w.balance, role: .inline(11), decimals: false, color: on ? MD.onSecondaryContainer : MD.onSurfaceVariant)
                    .lineLimit(1).minimumScaleFactor(0.8)
            }
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity)
            .background {
                if on {
                    RoundedRectangle(cornerRadius: 18, style: .continuous).fill(MD.secondaryContainer)
                        .matchedGeometryEffect(id: "pill", in: tiles)
                }
            }
            .contentShape(RoundedRectangle(cornerRadius: 18))
        }
        .buttonStyle(PressScale())
        .help("Log into \(w.name)")
    }

    // MARK: Reminders and recent

    private var reminderBlock: some View {
        VStack(alignment: .leading, spacing: 0) {
            SectionHeader(title: "From Reminders", small: true)
            ForEach(reminders) { c in
                HStack(spacing: 12) {
                    Badge(subject: .neutral(Sym.checklist), size: 36)
                    Text(c.prefill).role(.row).lineLimit(1)
                    Spacer(minLength: 8)
                    M3Button(title: "Log", kind: .tonal, small: true) { logReminder(c) }
                }
                .padding(.leading, 6).frame(height: 48)
            }
        }
    }

    @ViewBuilder private func recent(_ s: MoneyState) -> some View {
        let items = Array(s.feed.filter { $0.kind == .spend || $0.kind == .payment }.prefix(3))
        if !items.isEmpty {
            VStack(alignment: .leading, spacing: 0) {
                SectionHeader(title: "Recent", small: true) {
                    M3Button(title: "See all", kind: .text, small: true) { openApp(page: .ledger) }
                }
                ForEach(items) { f in
                    HStack(spacing: 12) {
                        Badge(subject: f.badge, size: 36, glyph: f.badgeGlyph)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(f.title).role(.row).lineLimit(1)
                            Text(Day.ago(f.date).capitalizedFirst).role(.supporting, MD.onSurfaceVariant).lineLimit(1)
                        }
                        Spacer(minLength: 8)
                        Group { if f.kind == .payment { Money.incoming(f.amount) } else { Money.outgoing(f.amount) } }
                            .fixedSize()
                        Group {
                            if f.kind == .spend, let id = f.related, let sp = spends.first(where: { $0.id == id }) {
                                IconButton(glyph: Sym.redo, help: "Log this again") { again(sp) }
                            } else {
                                Color.clear.frame(width: 40, height: 40)
                            }
                        }
                        .padding(.trailing, -8)
                    }
                    .padding(.leading, 6).frame(height: 48)
                    .transition(.opacity.combined(with: .move(edge: .top)))
                }
            }
            .animation(Flow.pick(Flow.spatial, reduce: reduce), value: items.map(\.id))
        }
    }

    // MARK: Logging

    private func refs(_ s: MoneyState) -> [NaturalCapture.WalletRef] { s.wallets.map { .init(id: $0.id, name: $0.name) } }
    private func draft(_ s: MoneyState) -> NaturalCapture.Draft? {
        NaturalCapture.parse(capture, wallets: refs(s), currencies: CurrencyFormat.supported, base: base)
    }
    /// The wallet you last logged a spend from, else the first one.
    private func lastUsedWallet(_ shown: [WalletLine]) -> UUID? {
        let ids = Set(shown.map(\.id))
        return spends.first { $0.deletedAt == nil && $0.walletId.map(ids.contains) == true }?.walletId ?? shown.first?.id
    }

    private func submit(_ s: MoneyState, shown: [WalletLine]) {
        guard let d = draft(s) else { return }
        let wallet = d.walletId ?? picked ?? lastUsedWallet(shown)
        let engine = MoneyEngine(context: context)
        let amount = CurrencyFormat.string(d.amount, d.currency, compact: true)
        if d.isPayment {
            let step = ChainStepInput(fromMethodId: nil, methodId: wallet, amountIn: d.amount, currencyIn: d.currency,
                                      amountOut: d.amount, currencyOut: d.currency, notes: nil)
            let input = PaymentChainInput(projectId: nil, projects: nil, paidAt: .now, steps: [step],
                                          reference: d.vendor ?? d.description, notes: nil)
            guard let id = try? engine.addPayment(input) else { openFull(.flLogPayment); return }
            saved("\(amount) came in", undo: { try? MoneyEngine(context: context).deletePayment(id); refreshWidget() })
        } else {
            guard let id = try? engine.createSpend(walletId: wallet, amount: d.amount, currency: d.currency, description: d.description,
                                                   vendorName: d.vendor, category: nil, isSadaka: false, spentAt: .now) else {
                show(Flash(text: "Couldn’t save that. Opening the full form.", ok: false))
                openFull(.flLogSpend)
                return
            }
            understand(id)
            saved("Logged \(amount)" + (d.vendor ?? d.description).map { " · \($0)" }.orEmpty, undo: undoSpend(id))
        }
        if let rid = pendingReminderId {
            EventBridge.completeReminder(rid); reminders.removeAll { $0.id == rid }; pendingReminderId = nil
        }
        withAnimation(Flow.fast) { capture = "" }
    }

    /// A "log …" reminder that already has an amount is logged in one go; otherwise its words go into
    /// the field so you can add the amount.
    private func logReminder(_ c: RemindersCapture.Candidate) {
        let shown = state.wallets.filter(\.inTotals)
        if let d = c.draft, d.amount > 0,
           let id = try? MoneyEngine(context: context).createSpend(walletId: d.walletId ?? picked ?? lastUsedWallet(shown), amount: d.amount,
                                                                currency: d.currency, description: d.description, vendorName: d.vendor,
                                                                category: nil, isSadaka: false, spentAt: .now) {
            understand(id)
            EventBridge.completeReminder(c.id)
            withAnimation(Flow.spatial) { reminders.removeAll { $0.id == c.id } }
            saved("Logged \(c.prefill)", undo: undoSpend(id))
        } else {
            capture = c.prefill
            pendingReminderId = c.id
            typing = true
        }
    }

    private func again(_ s: Spend) {
        guard let id = try? MoneyEngine(context: context).createSpend(walletId: s.walletId, amount: s.amount, currency: s.currency,
                                                                     description: s.spendDescription, vendorName: s.vendorName,
                                                                     category: s.category, isSadaka: s.isSadaka, spentAt: .now) else { return }
        understand(id)
        saved("Logged \(s.vendorName ?? s.spendDescription ?? "that") again", undo: undoSpend(id))
    }

    private func saved(_ text: String, undo: @escaping () -> Void) {
        try? context.save()
        refreshWidget()
        show(Flash(text: text, ok: true, undo: undo))
    }

    /// An undoable log stays long enough to be undone; a plain notice doesn't linger.
    private func show(_ f: Flash) {
        withAnimation(Flow.spatial) { flash = f }
        let life: Double = f.undo != nil ? 8 : (f.ok ? 1.8 : 4)
        DispatchQueue.main.asyncAfter(deadline: .now() + life) {
            withAnimation(Flow.spatial) { if flash?.id == f.id { flash = nil } }
        }
    }

    /// Undo soft-deletes, so the entry lands in Trash and every balance it touched recomputes.
    private func undoSpend(_ id: UUID) -> () -> Void {
        { try? MoneyEngine(context: context).deleteSpend(id); try? context.save(); refreshWidget() }
    }

    private func understand(_ id: UUID) {
        guard !DevMode.isSandboxed else { return }
        let ctx = context
        Task { @MainActor in
            let ai = AIManager()
            guard ai.isReady else { return }
            await Brain.onSpendLogged(ctx, ai: ai, spendId: id)
        }
    }

    private func refreshWidget() { WidgetBridge.update(context) }

    // MARK: Opening the app

    private func openFull(_ name: Notification.Name) {
        openApp()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { NotificationCenter.default.post(name: name, object: nil) }
    }

    private func openApp(page: Place? = nil) {
        NSApp.activate(ignoringOtherApps: true)
        if let w = NSApp.windows.first(where: { $0.canBecomeMain && !($0 is NSPanel) }) {
            if w.isMiniaturized { w.deminiaturize(nil) }
            w.makeKeyAndOrderFront(nil)
        } else {
            openWindow(id: "main")
        }
        if let page {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
                NotificationCenter.default.post(name: .flGo, object: nil, userInfo: ["page": page.rawValue])
            }
        }
    }
}

/// The free-money band at the top of the menu-bar window.
private struct FreeBand: View {
    let state: MoneyState
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .top) {
                Money(value: state.free, role: .summary, color: MD.onPrimaryContainer)
                Spacer(minLength: 8)
                if state.monthBillsPaid {
                    HStack(spacing: 4) {
                        Icon(Sym.check, size: 16)
                        Text("Bills paid").font(FS.font(12, 600, rond: 60))
                    }
                    .foregroundStyle(MD.onPrimaryContainer)
                    .padding(.horizontal, 10).frame(height: 28)
                    .background(Capsule().fill(MD.onPrimaryContainer.opacity(0.12)))
                    .pop(delay: 0.2)
                }
            }
            Text(state.setAside > 0 ? "free to spend" : "yours to spend").role(.summaryLabel, MD.onPrimaryContainer)
            Text(sentence).role(.supporting, MD.onPrimaryContainer).padding(.top, 6).fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 20).padding(.top, 18).padding(.bottom, 16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 28, style: .continuous).fill(MD.primaryContainer))
    }

    private var sentence: String {
        let held = "\(MoneyFormat.string(state.total, decimals: false)) in your wallets"
        let reserved = state.bills.filter(\.isSetAside)
        guard !reserved.isEmpty else { return held + ". Nothing due this week." }
        return held + ", \(MoneyFormat.string(state.setAside, decimals: false)) set aside for \(reserved.map(\.label).joined(separator: ", "))."
    }
}

/// Press feedback without a hover wash, for controls that carry their own selection.
struct PressScale: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.96 : 1)
            .animation(Flow.fast, value: configuration.isPressed)
    }
}

private extension Optional where Wrapped == String {
    var orEmpty: String { self ?? "" }
}

private extension String {
    /// "yesterday" → "Yesterday"; dates stay as they are.
    var capitalizedFirst: String { prefix(1).uppercased() + dropFirst() }
}

import SwiftUI
import SwiftData
import AppKit

/// The menu-bar window: a glanceable safe-to-spend + a one-line natural-language capture
/// ("450 jollibee", "5000 rent gcash"), available from anywhere without opening the app.
struct MenuBarView: View {
    @Environment(\.modelContext) private var context
    @Query private var settings: [AppSettings]
    @Query private var rateRows: [ExchangeRate]
    @Query(filter: #Predicate<Payment> { $0.deletedAt == nil }, sort: \Payment.paidAt, order: .reverse) private var payments: [Payment]
    @Query(filter: #Predicate<Spend> { $0.deletedAt == nil }, sort: \Spend.spentAt, order: .reverse) private var spends: [Spend]
    @Query(filter: #Predicate<Wallet> { $0.deletedAt == nil }) private var wallets: [Wallet]
    @Query private var ledger: [LedgerEntry]
    @Query(filter: #Predicate<Recurring> { $0.deletedAt == nil }) private var recurrings: [Recurring]

    @State private var capture = ""
    @State private var walletId: UUID?
    @State private var note = ""
    @State private var justLogged: String?
    @State private var showDetail = false
    @State private var ai = AIManager()
    @State private var reminderCandidates: [RemindersCapture.Candidate] = []
    @State private var pendingReminderId: String?

    private var base: String { settings.first?.baseCurrency ?? "PHP" }
    private var rates: Rates { Rates(base: base, rates: rateRows) }
    private var safe: SafeBreakdown {
        SafeToSpend.compute(payments: payments, spends: spends, wallets: wallets, ledger: ledger, recurrings: recurrings)
    }
    private var holding: [Wallet] { wallets.filter { $0.isHolding && !$0.archived } }
    /// Default wallet: the one you last logged a spend into, else the first holding wallet.
    private var defaultWallet: UUID? { spends.first?.walletId ?? holding.first?.id }

    var body: some View {
        VStack(alignment: .leading, spacing: 13) {
            header
            safeCard
            Divider().overlay(.white.opacity(0.08))
            captureSection
            if !reminderCandidates.isEmpty { reminderSection }
            if !spends.isEmpty { recentSection }
        }
        .padding(16)
        .frame(width: 380)
        .appAppearance()
        .onAppear { if walletId == nil { walletId = defaultWallet } }
        .task { reminderCandidates = await RemindersCapture.pending(base: base, currencies: CurrencyFormat.supported) }
    }

    private var reminderSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("FROM REMINDERS").font(.system(size: 9.5, weight: .semibold)).kerning(0.6).foregroundStyle(Palette.textTertiary)
            ForEach(reminderCandidates) { c in
                HStack(spacing: 9) {
                    Image(systemName: "checklist").font(.system(size: 12)).foregroundStyle(Palette.azure).frame(width: 22)
                    Text(c.prefill).font(.system(size: 12, weight: .medium)).foregroundStyle(Palette.textPrimary).lineLimit(1)
                    Spacer()
                    if let d = c.draft, d.amount > 0 {
                        Text(CurrencyFormat.string(d.amount, d.currency, compact: true))
                            .font(.system(size: 11.5, weight: .semibold, design: .rounded)).foregroundStyle(Palette.textSecondary)
                    }
                    Button("Log") { logReminder(c) }.buttonStyle(.glassProminent).tint(Palette.positive).controlSize(.mini)
                }
            }
        }
    }

    private var header: some View {
        HStack(spacing: 10) {
            LogoMark(size: 26)
            Text("Freelane").font(Typo.title(15)).foregroundStyle(Palette.textPrimary)
            Spacer()
            Button { NSApp.activate(ignoringOtherApps: true) } label: { Image(systemName: "arrow.up.forward.app") }
                .buttonStyle(.iconPress).foregroundStyle(Palette.textTertiary).help("Open Freelane")
        }
    }

    private var safeCard: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("SAFE TO SPEND TODAY").font(.system(size: 9.5, weight: .semibold)).kerning(0.6).foregroundStyle(Palette.textTertiary)
            MoneyText(amount: safe.liveRemaining, code: base, size: 30, color: Palette.positive)
            Text("of \(CurrencyFormat.string(safe.initialForToday, base, compact: true)) · \(CurrencyFormat.string(safe.walletTotal, base, compact: true)) across wallets")
                .font(.system(size: 10.5)).foregroundStyle(Palette.textTertiary)
        }
        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.positive.opacity(0.10), in: RoundedRectangle(cornerRadius: Radii.field, style: .continuous))
    }

    private var captureSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("QUICK CAPTURE").font(.system(size: 9.5, weight: .semibold)).kerning(0.6).foregroundStyle(Palette.textTertiary)
                Spacer()
                if let msg = justLogged {
                    Label(msg, systemImage: "checkmark.circle.fill").font(.system(size: 10.5, weight: .medium))
                        .foregroundStyle(Palette.positive).transition(.opacity)
                }
            }
            // One line, parsed: "450 jollibee", "5000 rent gcash", "30000 client payment from acme USD wise"
            HStack(spacing: 8) {
                Image(systemName: "sparkle").font(.system(size: 12)).foregroundStyle(Palette.azure)
                TextField("450 jollibee  ·  received 5000 acme gcash", text: $capture)
                    .textFieldStyle(.plain).font(.system(size: 14))
                    .onSubmit { submit() }
            }
            .padding(.horizontal, 11).padding(.vertical, 9)
            .insetRow(cornerRadius: Radii.field, hoverable: false)

            HStack(spacing: 8) {
                GlassMenuPicker(selection: $walletId,
                                options: [UUID?.none] + holding.map { UUID?.some($0.id) },
                                label: { id in id.flatMap { i in holding.first { $0.id == i }?.name } ?? "Default wallet" })
                    .frame(maxWidth: 150)
                Spacer()
                Button { submit() } label: { Label("Log", systemImage: "return").labelStyle(.titleAndIcon) }
                    .buttonStyle(.glassProminent).tint(Palette.positive).controlSize(.small)
                    .disabled(NaturalCapture.parse(capture, wallets: walletRefs, currencies: CurrencyFormat.supported, base: base) == nil)
            }
            Text("Type an amount + what it was. Add a wallet name or currency and I'll pick them up. “payment / client” logs income.")
                .font(.system(size: 10)).foregroundStyle(Palette.textTertiary)
        }
    }

    private var recentSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("RECENT").font(.system(size: 9.5, weight: .semibold)).kerning(0.6).foregroundStyle(Palette.textTertiary)
            ForEach(spends.prefix(5)) { s in
                HStack(spacing: 9) {
                    VendorMark(name: s.vendorName ?? (s.spendDescription ?? "?"), size: 22)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(s.vendorName ?? s.spendDescription ?? "Spend").font(.system(size: 12, weight: .medium))
                            .foregroundStyle(Palette.textPrimary).lineLimit(1)
                        Text(s.spentAt.formatted(.relative(presentation: .named))).font(.system(size: 9.5)).foregroundStyle(Palette.textTertiary)
                    }
                    Spacer()
                    Text(CurrencyFormat.string(s.amountBase, base, compact: true))
                        .font(.system(size: 12, weight: .semibold, design: .rounded)).foregroundStyle(Palette.textPrimary)
                    Button { repeatSpend(s) } label: { Image(systemName: "arrow.counterclockwise") }
                        .buttonStyle(.iconPress).foregroundStyle(Palette.textTertiary).help("Log this again")
                }
            }
        }
    }

    private var walletRefs: [NaturalCapture.WalletRef] { holding.map { .init(id: $0.id, name: $0.name) } }

    private func submit() {
        guard let d = NaturalCapture.parse(capture, wallets: walletRefs, currencies: CurrencyFormat.supported, base: base) else { return }
        if d.isPayment {
            // Log a simple unassigned payment right here (no fee, lands in the wallet). Routed/
            // project-allocated payments still use the full flow in the main window.
            let landing = d.walletId ?? walletId ?? defaultWallet
            let step = ChainStepInput(fromMethodId: nil, methodId: landing,
                                      amountIn: d.amount, currencyIn: d.currency,
                                      amountOut: d.amount, currencyOut: d.currency, notes: nil)
            let ref = d.vendor ?? d.description
            let input = PaymentChainInput(projectId: nil, projects: nil, paidAt: .now,
                                          steps: [step], reference: ref, notes: nil)
            if (try? MoneyEngine(context: context).addPayment(input)) != nil {
                WidgetBridge.update(context)
                flash("Received \(CurrencyFormat.string(d.amount, d.currency, compact: true))")
                if let rid = pendingReminderId { EventBridge.completeReminder(rid); reminderCandidates.removeAll { $0.id == rid }; pendingReminderId = nil }
            } else {
                // Conversion/validation hiccup → fall back to the full flow.
                NSApp.activate(ignoringOtherApps: true)
                NotificationCenter.default.post(name: .flLogPayment, object: nil)
            }
            capture = ""
            return
        }
        let wallet = d.walletId ?? walletId ?? defaultWallet
        if let id = try? MoneyEngine(context: context).createSpend(
            walletId: wallet, amount: d.amount, currency: d.currency, description: d.description,
            vendorName: d.vendor, category: nil, isSadaka: false, spentAt: .now) {
            let ctx = context, mgr = ai
            Task { await Brain.onSpendLogged(ctx, ai: mgr, spendId: id) }
            WidgetBridge.update(context)
            flash("Logged \(CurrencyFormat.string(d.amount, d.currency, compact: true))")
            // If this capture came from a "log …" reminder, mark it done in Apple Reminders.
            if let rid = pendingReminderId {
                EventBridge.completeReminder(rid)
                reminderCandidates.removeAll { $0.id == rid }
                pendingReminderId = nil
            }
        }
        capture = ""
    }

    /// Log a "log …" reminder. If it already carries an amount, log it in one tap and complete the
    /// reminder; otherwise drop its text into the capture field so you can add the amount.
    private func logReminder(_ c: RemindersCapture.Candidate) {
        if let d = c.draft, d.amount > 0 {
            let wallet = d.walletId ?? walletId ?? defaultWallet
            if let id = try? MoneyEngine(context: context).createSpend(
                walletId: wallet, amount: d.amount, currency: d.currency, description: d.description,
                vendorName: d.vendor, category: nil, isSadaka: false, spentAt: .now) {
                let ctx = context, mgr = ai
                Task { await Brain.onSpendLogged(ctx, ai: mgr, spendId: id) }
                WidgetBridge.update(context)
                EventBridge.completeReminder(c.id)
                reminderCandidates.removeAll { $0.id == c.id }
                flash("Logged \(c.prefill)")
            }
        } else {
            capture = c.prefill
            pendingReminderId = c.id   // completed once you submit with an amount
        }
    }

    /// Re-log a previous spend (same amount/vendor/wallet, dated now).
    private func repeatSpend(_ s: Spend) {
        if let id = try? MoneyEngine(context: context).createSpend(
            walletId: s.walletId, amount: s.amount, currency: s.currency, description: s.spendDescription,
            vendorName: s.vendorName, category: s.category, isSadaka: s.isSadaka, spentAt: .now) {
            let ctx = context, mgr = ai
            Task { await Brain.onSpendLogged(ctx, ai: mgr, spendId: id) }
            WidgetBridge.update(context)
            flash("Logged \(s.vendorName ?? "spend") again")
        }
    }

    private func flash(_ msg: String) {
        withAnimation { justLogged = msg }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.6) { withAnimation { justLogged = nil } }
    }
}

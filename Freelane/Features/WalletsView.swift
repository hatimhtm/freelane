import SwiftUI
import SwiftData

struct WalletsView: View {
    @Environment(\.modelContext) private var context
    @Query private var settings: [AppSettings]
    @Query private var rateRows: [ExchangeRate]
    @Query(filter: #Predicate<Wallet> { $0.deletedAt == nil }, sort: \Wallet.name) private var wallets: [Wallet]
    @Query private var ledger: [LedgerEntry]

    @State private var showAdd = false
    @State private var showWithdraw = false
    @State private var editing: Wallet?
    @State private var selected: Wallet?

    private var base: String { settings.first?.baseCurrency ?? "PHP" }
    // Single source of truth: holding wallets only — identical to the Dashboard's
    // "Available" so balances never disagree between screens.
    private var holding: [Wallet] { wallets.filter { $0.isHolding && !$0.archived } }
    // Total ignores wallets marked "exclude from totals" — but the grid still shows them.
    private var total: Double { holding.filter { !$0.excludedFromTotals }.reduce(0) { $0 + WalletMath.balance(of: $1, ledger: ledger) } }

    var body: some View {
        Page("Wallets", subtitle: "Where your money sits right now.",
             toolbar: AnyView(toolbarButtons)) {
            if holding.isEmpty {
                EmptyStateCard(icon: "wallet.bifold", title: "No wallets yet",
                               message: "Add the places your money lives — banks, e-wallets, cash. Every payment, spend, and transfer flows through them, and balances are derived from the ledger automatically.",
                               actionLabel: "Add wallet") { showAdd = true }
            } else {
                // A BALANCE SHEET, not a card grid.
                //
                // Wallets were a grid of equal boxes, which is the worst possible shape for this
                // page: the only question it answers is "how much is where", and a grid makes you
                // compare figures that are deliberately not aligned. Sorted biggest first, in one
                // column, with each balance in a tabular figure and a share bar underneath, the
                // answer is the shape of the page.
                LeadFigure(
                    label: "Total across wallets",
                    amount: total, code: base,
                    context: {
                        var bits = ["\(holding.count) \(holding.count == 1 ? "wallet" : "wallets")"]
                        let neg = holding.filter { WalletMath.balance(of: $0, ledger: ledger) < -$0.overdraftToleranceBase - 0.005 }
                        if !neg.isEmpty { bits.append("\(neg.count) overdrawn") }
                        return bits
                    }(),
                    spark: [])

                SectionCard(title: "Where it sits", subtitle: "Biggest first", accent: Palette.indigo) {
                    VStack(spacing: 0) {
                        let sorted = holding.sorted { WalletMath.balance(of: $0, ledger: ledger) > WalletMath.balance(of: $1, ledger: ledger) }
                        let maxAbs = sorted.map { abs(WalletMath.balance(of: $0, ledger: ledger)) }.max() ?? 1
                        ForEach(Array(sorted.enumerated()), id: \.element.id) { i, w in
                            if i > 0 { Divider().overlay(Palette.hairline) }
                            WalletBalanceRow(
                                wallet: w,
                                balance: WalletMath.balance(of: w, ledger: ledger),
                                share: maxAbs > 0 ? abs(WalletMath.balance(of: w, ledger: ledger)) / maxAbs : 0,
                                base: base,
                                onTap: { selected = w })
                            .riseIn(i)
                        }
                    }
                }
            }
        }
        .sheet(isPresented: $showAdd) { AddWalletSheet() }
        .sheet(isPresented: $showWithdraw) { WithdrawalSheet() }
        .sheet(item: $editing) { EditWalletSheet(wallet: $0) }
        .sheet(item: $selected) { w in WalletDetailSheet(wallet: w, onEdit: { selected = nil; editing = w }) }
    }

    private var toolbarButtons: some View {
        HStack(spacing: 10) {
            Button { showWithdraw = true } label: {
                Label("Move money", systemImage: "arrow.left.arrow.right")
            }.buttonStyle(.glass)
            Button { showAdd = true } label: {
                Label("Add wallet", systemImage: "plus")
            }.buttonStyle(.glassProminent).tint(Palette.azure)
        }
    }

}

// MARK: - Wallet detail (ledger history + 30-day trend)

struct WalletDetailSheet: View {
    let wallet: Wallet
    var onEdit: () -> Void
    @Environment(\.dismiss) private var dismiss
    @Query private var settings: [AppSettings]
    @Query private var ledger: [LedgerEntry]

    private var base: String { settings.first?.baseCurrency ?? "PHP" }
    private var bal: Double { WalletMath.balance(of: wallet, ledger: ledger) }
    private var anchor: Date? { WalletMath.anchor(wallet) }

    /// Live ledger rows for this wallet since the anchor, newest first.
    private var rows: [LedgerEntry] {
        ledger.filter { $0.walletId == wallet.id && $0.archivedAt == nil && (anchor == nil || $0.eventAt >= anchor!) }
            .sorted { $0.eventAt > $1.eventAt }
    }
    private var received: Double { rows.filter { $0.amountBase > 0 }.reduce(0) { $0 + $1.amountBase } }
    private var out: Double { rows.filter { $0.amountBase < 0 }.reduce(0) { $0 + $1.amountBase } }

    /// 30 end-of-day running balances since the anchor (carry-forward on gaps).
    private var trend: [Double] {
        let cal = PHT.calendar
        let start = PHT.daysAgo(29)
        var running = (wallet.openingBalanceBase ?? 0)
            + rows.filter { $0.eventAt < start }.reduce(0) { $0 + $1.amountBase }
        var byDay: [Date: Double] = [:]
        for e in rows where e.eventAt >= start { byDay[cal.startOfDay(for: e.eventAt), default: 0] += e.amountBase }
        var out: [Double] = []; var day = cal.startOfDay(for: start); let today = cal.startOfDay(for: .now)
        while day <= today { running += byDay[day] ?? 0; out.append(running); day = cal.date(byAdding: .day, value: 1, to: day) ?? today.addingTimeInterval(86_400) }
        return out.isEmpty ? [running, running] : out
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 12) {
                WalletGlyph(wallet: wallet, size: 40)
                VStack(alignment: .leading, spacing: 2) {
                    Text(wallet.name).font(Typo.title(18)).foregroundStyle(Palette.textPrimary)
                    Text(wallet.kind.label).font(.system(size: 12)).foregroundStyle(Palette.textTertiary)
                }
                Spacer()
                Button { onEdit() } label: { Image(systemName: "pencil") }.buttonStyle(.glass)
                    .help("Edit wallet").accessibilityLabel("Edit wallet")
                Button { dismiss() } label: { Image(systemName: "xmark.circle.fill").font(.system(size: 20)).foregroundStyle(Palette.textTertiary) }
                    .buttonStyle(.iconPress).keyboardShortcut(.cancelAction)
                    .help("Close (Esc)").accessibilityLabel("Close")
            }.padding(18)

            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Balance").tileLabel()
                        MoneyText(amount: bal, code: base, size: 34, color: bal < -wallet.overdraftToleranceBase ? Palette.negative : Palette.textPrimary)
                        Sparkline(values: trend, color: Palette.teal).frame(height: 48)
                        HStack {
                            tag("In", received, Palette.positive)
                            tag("Out", out, Palette.negative)
                            if let a = anchor { Text("since \(a, format: .dateTime.month().day())").font(.system(size: 10)).foregroundStyle(Palette.textTertiary) }
                        }
                    }
                    .padding(16).frame(maxWidth: .infinity, alignment: .leading).glassCard(cornerRadius: Radii.tile, tint: Palette.teal)

                    SectionCard(title: "Ledger", subtitle: "\(rows.count) entries", accent: Palette.teal) {
                        if rows.isEmpty {
                            Text("No movements yet since the anchor.").font(.system(size: 12)).foregroundStyle(Palette.textTertiary)
                        } else {
                            LazyVStack(spacing: 0) {
                                ForEach(rows) { e in
                                    HStack {
                                        Text(kindLabel(e)).font(.system(size: 9, weight: .semibold))
                                            .foregroundStyle(Palette.textTertiary).padding(.horizontal, 6).padding(.vertical, 2)
                                            .background(Palette.hairline, in: Capsule())
                                        Text(e.note ?? "").font(.system(size: 12)).foregroundStyle(Palette.textSecondary).lineLimit(1)
                                        Spacer()
                                        Text((e.amountBase >= 0 ? "+" : "") + CurrencyFormat.string(e.amountBase, base, compact: true))
                                            .font(Typo.rowFigure(12)).monospacedDigit()
                                            .foregroundStyle(e.amountBase >= 0 ? Palette.positive : Palette.textPrimary)
                                            .lineLimit(1)
                                        Text(e.eventAt, format: .dateTime.month().day()).font(.system(size: 10)).foregroundStyle(Palette.textTertiary).frame(width: 44, alignment: .trailing)
                                    }.padding(.vertical, 6)
                                }
                            }
                        }
                    }
                }.padding(18)
            }
        }
        .frame(width: 500, height: 640).flagshipSheet()
    }

    private func tag(_ l: String, _ v: Double, _ c: Color) -> some View {
        HStack(spacing: 4) {
            Text(l).font(.system(size: 10, weight: .semibold)).foregroundStyle(Palette.textTertiary)
            Text(CurrencyFormat.string(abs(v), base, compact: true)).font(Typo.rowFigure(11)).monospacedDigit().foregroundStyle(c)
        }
    }
    private func kindLabel(_ e: LedgerEntry) -> String {
        switch e.kind {
        case .income, .projectReceipt: return "IN"
        case .outflow: return "OUT"
        case .sadakaPayment: return "SADAKA"
        case .fee: return "FEE"
        case .transfer: return "XFER"
        case .adjustment: return "ADJ"
        case .unaccountedOutflow: return "GAP"
        }
    }
}

// MARK: - Add wallet

struct AddWalletSheet: View {
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var kind: WalletKind = .wallet
    @State private var opening = ""
    @FocusState private var nameFocus: Bool

    var body: some View {
        SheetScaffold(title: "New wallet", accent: Palette.teal,
                      canSave: !name.trimmingCharacters(in: .whitespaces).isEmpty, onSave: save) {
            LabeledField("Name") {
                TextField("e.g. GCash", text: $name).textFieldStyle(GlassFieldStyle()).focused($nameFocus)
            }
            LabeledField("Type") {
                GlassMenuPicker(selection: $kind, options: Array(WalletKind.allCases), label: { $0.label })
            }
            LabeledField("Opening balance (base)") {
                TextField("0", text: $opening).textFieldStyle(GlassFieldStyle())
            }
        }
        .onAppear { DispatchQueue.main.async { nameFocus = true } }
    }

    private func save() {
        let w = Wallet(name: name.trimmingCharacters(in: .whitespaces), kind: kind, isHolding: true)
        // Tolerant parse — "1,500" and "1500.50" both work.
        if let v = Double(opening.replacingOccurrences(of: ",", with: "")), v != 0 {
            w.openingBalanceBase = v
            w.openingBalanceSetAt = .now
        }
        w.dirty = true
        context.insert(w)
        try? context.save()
        dismiss()
    }
}

// MARK: - Withdrawal

struct WithdrawalSheet: View {
    var existing: Withdrawal? = nil
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @Query(filter: #Predicate<Wallet> { $0.deletedAt == nil }, sort: \Wallet.name) private var wallets: [Wallet]
    @Query private var rateRows: [ExchangeRate]
    @Query private var settings: [AppSettings]

    @State private var from: UUID?
    @State private var to: UUID?                 // nil = cash out (no destination wallet)
    @State private var sent = ""
    @State private var sentCurrency = "PHP"
    @State private var received = ""
    @State private var receivedCurrency = "PHP"
    @State private var date = Date.now
    @State private var error: String?
    @FocusState private var sentFocus: Bool

    private let currencies = CurrencyFormat.supported
    private var base: String { settings.first?.baseCurrency ?? "PHP" }
    private var rates: Rates { Rates(base: base, rates: rateRows) }
    private var active: [Wallet] { wallets.filter { !$0.archived } }

    /// Tolerant amount parsing — accepts "1,500" as well as "1500.50".
    private func parsedAmount(_ raw: String) -> Double? { Double(raw.replacingOccurrences(of: ",", with: "")) }

    private var sentBase: Double { rates.toBase(parsedAmount(sent) ?? 0, sentCurrency) }
    private var receivedBase: Double { received.isEmpty ? sentBase : rates.toBase(parsedAmount(received) ?? 0, receivedCurrency) }
    private var feeBase: Double { max(0, sentBase - receivedBase) }

    var body: some View {
        SheetScaffold(title: existing == nil ? "Transfer / withdraw" : "Edit transfer", accent: Palette.warning,
                      icon: "arrow.left.arrow.right",
                      canSave: from != nil && (parsedAmount(sent) ?? 0) > 0 && from != to,
                      saveLabel: existing == nil ? "Save" : "Update", onSave: save) {
            LabeledField("From wallet") {
                GlassMenuPicker(selection: $from,
                                options: [nil] + active.map { Optional($0.id) },
                                label: { id in id.flatMap { i in wallets.first { $0.id == i }?.name } ?? "Select…" })
            }
            HStack(spacing: 12) {
                LabeledField("Amount sent") { TextField("0", text: $sent).textFieldStyle(GlassFieldStyle()).focused($sentFocus) }
                LabeledField("Currency") { CurrencyMenu(selection: $sentCurrency, options: currencies) }
            }
            LabeledField("To wallet") {
                GlassMenuPicker(selection: $to,
                                options: [nil] + active.filter { $0.id != from }.map { Optional($0.id) },
                                label: { id in id.flatMap { i in wallets.first { $0.id == i }?.name } ?? "Cash / outside (no wallet)" })
            }
            HStack(spacing: 12) {
                LabeledField(to == nil ? "Received in hand" : "Landed in destination") {
                    TextField("defaults to amount sent", text: $received).textFieldStyle(GlassFieldStyle())
                }
                LabeledField("Currency") { CurrencyMenu(selection: $receivedCurrency, options: currencies) }
            }
            LabeledField("Date") { GlassDateField(date: $date) }
            HStack {
                Text(to == nil ? "Out of wallet" : "Moving").tileLabel()
                Spacer()
                Text(CurrencyFormat.string(receivedBase, base))
                    .font(Typo.rowFigure(16)).monospacedDigit()
                    .foregroundStyle(Palette.warning).lineLimit(1).minimumScaleFactor(0.7)
                if feeBase > 0 {
                    Text("· fee " + CurrencyFormat.string(feeBase, base, compact: true))
                        .font(.system(size: 11)).monospacedDigit().foregroundStyle(Palette.negative)
                }
            }.padding(12).glassCard(cornerRadius: Radii.tile)
            if let error { Text(error).font(.caption).foregroundStyle(Palette.negative) }
        }
        .onAppear {
            sentCurrency = base; receivedCurrency = base
            if let w = existing {           // editing: stored values are in base currency
                from = w.fromMethodId; to = w.toMethodId; date = w.withdrawnAt
                sent = trimmed(w.grossBase); received = trimmed(w.netBase)
            }
            // Focus the amount — macOS selects the prefilled text, so typing replaces it.
            DispatchQueue.main.async { sentFocus = true }
        }
    }

    private func trimmed(_ v: Double) -> String {
        v == v.rounded() ? String(format: "%.0f", v) : String(format: "%.2f", v)
    }

    private func save() {
        guard sentBase > 0 else { return }
        do {
            let engine = MoneyEngine(context: context)
            if let w = existing {
                try engine.updateWithdrawal(w.id, fromMethodId: from, toMethodId: to, withdrawnAt: date,
                                            grossBase: sentBase, netBase: receivedBase, notes: w.notes)
            } else {
                try engine.createWithdrawal(fromMethodId: from, toMethodId: to, withdrawnAt: date,
                                            grossBase: sentBase, netBase: receivedBase, notes: nil)
            }
            dismiss()
        } catch { self.error = error.localizedDescription }
    }
}

/// One wallet on the balance sheet: brand mark, name, balance, and a bar showing its share of the
/// largest holding — so "most of my money is in coin.ph" is visible without reading four figures.
private struct WalletBalanceRow: View {
    let wallet: Wallet
    let balance: Double
    let share: Double
    let base: String
    let onTap: () -> Void
    @State private var hovering = false

    private var overdrawn: Bool { balance < -wallet.overdraftToleranceBase - 0.005 }

    var body: some View {
        Button(action: onTap) {
            VStack(alignment: .leading, spacing: 7) {
                HStack(spacing: 11) {
                    WalletGlyph(wallet: wallet, size: 30)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(wallet.name)
                            .font(.system(size: 13.5, weight: .medium))
                            .foregroundStyle(Palette.textPrimary).lineLimit(1)
                        Text(wallet.kind.label)
                            .font(.system(size: 10.5)).foregroundStyle(Palette.textTertiary)
                    }
                    Spacer(minLength: 10)
                    if overdrawn { StatusBadge(text: "Overdrawn", color: Palette.negative) }
                    Text(CurrencyFormat.string(balance, base))
                        .font(Typo.figure(19)).monospacedDigit()
                        .foregroundStyle(overdrawn ? Palette.negative : Palette.textPrimary)
                        .lineLimit(1).minimumScaleFactor(0.7)
                    Image(systemName: "chevron.right")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(Palette.textTertiary)
                        .opacity(hovering ? 1 : 0.25)
                }
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Palette.wellFill).frame(height: 3)
                        Capsule().fill(overdrawn ? Palette.negative : Palette.indigo)
                            .frame(width: max(2, geo.size.width * CGFloat(min(1, share))), height: 3)
                    }
                }
                .frame(height: 3)
                .padding(.leading, 41)
            }
            .padding(.vertical, 11)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .pointerStyle(.link)
        .hoverRow()
        .onHover { hovering = $0 }
        .animation(.easeOut(duration: 0.12), value: hovering)
    }
}

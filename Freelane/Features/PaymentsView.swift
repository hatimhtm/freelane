import SwiftUI
import SwiftData

struct PaymentsView: View {
    @Environment(\.modelContext) private var context
    @Environment(UndoCenter.self) private var undo
    @Query private var settings: [AppSettings]
    @Query(filter: #Predicate<Payment> { $0.deletedAt == nil }, sort: \Payment.paidAt, order: .reverse) private var payments: [Payment]
    @Query(filter: #Predicate<Withdrawal> { $0.deletedAt == nil }, sort: \Withdrawal.withdrawnAt, order: .reverse) private var withdrawals: [Withdrawal]
    @Query(filter: #Predicate<Project> { $0.deletedAt == nil }) private var projects: [Project]
    @Query(filter: #Predicate<Wallet> { $0.deletedAt == nil }) private var wallets: [Wallet]
    @Query private var steps: [PaymentStep]
    @Query private var ledger: [LedgerEntry]

    @State private var showBulk = false
    @State private var editing: Payment?
    @State private var pendingDelete: Payment?
    @State private var editingWithdrawal: Withdrawal?
    @State private var pendingDeleteWithdrawal: Withdrawal?
    @State private var sub = 0
    @State private var showAddWallet = false
    @State private var showWithdraw = false
    @State private var showRouted = false
    @State private var selectedWallet: Wallet?
    @State private var editingWallet: Wallet?
    @State private var query = ""

    private var base: String { settings.first?.baseCurrency ?? "PHP" }

    private enum Row: Identifiable {
        case payment(Payment), withdrawal(Withdrawal)
        var id: String {
            switch self {
            case .payment(let p): return "p-\(p.id)"
            case .withdrawal(let w): return "w-\(w.id)"
            }
        }
        var date: Date {
            switch self {
            case .payment(let p): return p.paidAt
            case .withdrawal(let w): return w.withdrawnAt
            }
        }
    }

    private var rows: [Row] {
        let all = (payments.map(Row.payment) + withdrawals.map(Row.withdrawal)).sorted { $0.date > $1.date }
        switch sub {
        case 1: return all.filter { if case .payment = $0 { return true }; return false }
        case 2: return all.filter { if case .withdrawal = $0 { return true }; return false }
        default: return all
        }
    }

    /// Searchable text for a row — project title / reference / wallet name / amount.
    private func searchText(_ row: Row) -> String {
        switch row {
        case .payment(let p):
            let title = projects.first { $0.id == p.projectId }?.title ?? "Payment"
            let landing = landingWallet(p) ?? ""
            return [title, p.reference ?? "", landing,
                    CurrencyFormat.string(p.netAmountBase ?? 0, base),
                    CurrencyFormat.string(p.amount, p.currency)].joined(separator: " ")
        case .withdrawal(let w):
            let from = walletName(w.fromMethodId) ?? ""
            let to = walletName(w.toMethodId) ?? ""
            return [w.toMethodId != nil ? "Transfer" : "Withdrawal", from, to,
                    CurrencyFormat.string(w.grossBase, base)].joined(separator: " ")
        }
    }
    /// History filtered by the search query (empty = everything).
    private var filteredRows: [Row] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return rows }
        return rows.filter { searchText($0).lowercased().contains(q) }
    }

    var body: some View {
        Page("Payments", subtitle: "Money in and out, ledger-accurate.",
             toolbar: AnyView(toolbarButtons),
             subtabs: ["All", "Money in", "Money out"], selection: $sub) {
            walletStrip
            let list = filteredRows
            SectionCard(title: sub == 1 ? "Payments" : (sub == 2 ? "Withdrawals" : "History"),
                        subtitle: query.isEmpty ? "\(rows.count) entries" : "\(list.count) of \(rows.count)",
                        accent: Palette.positive) {
                SearchField(text: $query, placeholder: "Search project, wallet, or amount").padding(.bottom, 10)
                if rows.isEmpty {
                    EmptyStateCard(icon: "arrow.down.left.circle", title: "No payments yet",
                                   message: "Log a payment when money lands — Freelane tracks fees, routes, and what each client has paid.")
                } else if list.isEmpty {
                    Text("No matches for “\(query)”.")
                        .font(.system(size: 13)).foregroundStyle(Palette.textTertiary)
                        .frame(maxWidth: .infinity, minHeight: 60)
                } else {
                    LazyVStack(spacing: 0) {
                        ForEach(list) { row in
                            switch row {
                            case .payment(let p): paymentRow(p)
                            case .withdrawal(let w): withdrawalRow(w)
                            }
                            if row.id != list.last?.id { Divider().overlay(Palette.hairline) }
                        }
                    }
                }
            }
        }
        .sheet(isPresented: $showBulk) { BulkPaymentSheet() }
        .sheet(isPresented: $showAddWallet) { AddWalletSheet() }
        .sheet(isPresented: $showWithdraw) { WithdrawalSheet() }
        .sheet(isPresented: $showRouted) { RoutedPaymentSheet() }
        .sheet(item: $selectedWallet) { w in WalletDetailSheet(wallet: w, onEdit: { selectedWallet = nil; editingWallet = w }) }
        .sheet(item: $editingWallet) { EditWalletSheet(wallet: $0) }
        .sheet(item: $editing) { EditPaymentSheet(payment: $0) }
        .sheet(item: $editingWithdrawal) { WithdrawalSheet(existing: $0) }
        .confirmationDialog("Delete this payment?", isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }), presenting: pendingDelete) { p in
            Button("Delete", role: .destructive) {
                try? MoneyEngine(context: context).deletePayment(p.id)
                undo.offer("payment") { try? MoneyEngine(context: context).restorePayment(p.id) }
                pendingDelete = nil
            }
            Button("Cancel", role: .cancel) { pendingDelete = nil }
        } message: { _ in Text("This removes the payment and its effect on your wallet balance.") }
        .confirmationDialog("Delete this transfer?", isPresented: Binding(get: { pendingDeleteWithdrawal != nil }, set: { if !$0 { pendingDeleteWithdrawal = nil } }), presenting: pendingDeleteWithdrawal) { w in
            Button("Delete", role: .destructive) {
                try? MoneyEngine(context: context).deleteWithdrawal(w.id)
                undo.offer("transfer") { try? MoneyEngine(context: context).restoreWithdrawal(w.id) }
                pendingDeleteWithdrawal = nil
            }
            Button("Cancel", role: .cancel) { pendingDeleteWithdrawal = nil }
        } message: { _ in Text("This removes the transfer and restores both wallet balances.") }
    }

    private var walletStrip: some View {
        let holding = wallets.filter { $0.isHolding && !$0.archived }
        let cols = [GridItem(.adaptive(minimum: 168), spacing: 12)]
        return SectionCard(title: "Wallet balances", subtitle: "Live from your ledger", accent: Palette.teal) {
            if holding.isEmpty {
                Text("No wallets yet.").font(.system(size: 12)).foregroundStyle(Palette.textTertiary)
            } else {
                LazyVGrid(columns: cols, spacing: 12) {
                    ForEach(holding) { w in
                        let bal = WalletMath.balance(of: w, ledger: ledger)
                        Button { selectedWallet = w } label: {
                            HStack(spacing: 10) {
                                WalletGlyph(wallet: w, size: 30)
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(w.name).font(.system(size: 12, weight: .medium)).foregroundStyle(Palette.textPrimary).lineLimit(1)
                                    Text(CurrencyFormat.string(bal, base, compact: true))
                                        .font(.system(size: 13, weight: .semibold, design: .rounded)).monospacedDigit()
                                        .foregroundStyle(bal < -w.overdraftToleranceBase - 0.005 ? Palette.negative : Palette.textPrimary)
                                        .lineLimit(1).minimumScaleFactor(0.7)
                                }
                                Spacer()
                            }
                            .padding(10).insetRow(cornerRadius: Radii.field)
                        }.buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private var toolbarButtons: some View {
        HStack(spacing: 10) {
            Menu {
                Button { showAddWallet = true } label: { Label("Add wallet", systemImage: "wallet.bifold") }
                Button { showWithdraw = true } label: { Label("Transfer / withdraw", systemImage: "arrow.left.arrow.right") }
            } label: { Label("Wallet", systemImage: "wallet.bifold") }
                .buttonStyle(.glass)
            // One unified entry — a simple/bulk payment, or a routed multi-hop chain.
            Menu {
                Button { showBulk = true } label: { Label("Log payment", systemImage: "arrow.down.left.circle") }
                Button { showRouted = true } label: { Label("Routed payment (multi-hop)", systemImage: "arrow.triangle.branch") }
            } label: { Label("Log payment", systemImage: "plus") }
                .buttonStyle(.glassProminent).tint(Palette.positive).menuStyle(.button)
        }
    }

    private func walletName(_ id: UUID?) -> String? {
        guard let id else { return nil }
        return wallets.first { $0.id == id }?.name
    }

    private func landingWallet(_ p: Payment) -> String? {
        let s = steps.filter { $0.paymentId == p.id }.sorted { $0.stepOrder < $1.stepOrder }
        return walletName(s.last?.methodId)
    }

    private func paymentRow(_ p: Payment) -> some View {
        let title = projects.first { $0.id == p.projectId }?.title ?? "Payment"
        let fee = p.impliedFeeBase ?? 0
        let landing = landingWallet(p)
        return HStack(spacing: 12) {
            icon("arrow.down", Palette.positive)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.system(size: 13, weight: .medium)).foregroundStyle(Palette.textPrimary).lineLimit(1)
                HStack(spacing: 6) {
                    Text(p.paidAt, format: .dateTime.month().day().year())
                    if let landing { Text("· \(landing)") }
                    Text("· \(CurrencyFormat.string(p.amount, p.currency, compact: true)) gross")
                }
                .font(.system(size: 11)).foregroundStyle(Palette.textTertiary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text("+" + CurrencyFormat.string(p.netAmountBase ?? 0, base))
                    .font(.system(size: 13.5, weight: .semibold, design: .rounded)).monospacedDigit()
                    .foregroundStyle(Palette.positive).lineLimit(1).minimumScaleFactor(0.8)
                if fee > 0 {
                    Text("−" + CurrencyFormat.string(fee, base) + " fee")
                        .font(.system(size: 10)).monospacedDigit().foregroundStyle(Palette.negative.opacity(0.9))
                }
            }
            Menu {
                Button("Edit", systemImage: "pencil") { editing = p }
                Button("Delete", systemImage: "trash", role: .destructive) { pendingDelete = p }
            } label: {
                Image(systemName: "ellipsis").foregroundStyle(Palette.textTertiary).frame(width: 24, height: 24)
            }
            .menuStyle(.borderlessButton).frame(width: 24)
            .help("Edit or delete this payment")
            .accessibilityLabel("Payment actions")
        }
        .padding(.vertical, 9)
    }

    private func withdrawalRow(_ w: Withdrawal) -> some View {
        HStack(spacing: 12) {
            icon("arrow.up", Palette.warning)
            VStack(alignment: .leading, spacing: 2) {
                Text((w.toMethodId != nil ? "Transfer" : "Withdrawal")
                     + (walletName(w.fromMethodId).map { " · \($0)" } ?? "")
                     + (walletName(w.toMethodId).map { " → \($0)" } ?? ""))
                    .font(.system(size: 13, weight: .medium)).foregroundStyle(Palette.textPrimary).lineLimit(1)
                Text(w.withdrawnAt, format: .dateTime.month().day().year())
                    .font(.system(size: 11)).foregroundStyle(Palette.textTertiary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text("−" + CurrencyFormat.string(w.grossBase, base))
                    .font(.system(size: 13.5, weight: .semibold, design: .rounded)).monospacedDigit()
                    .foregroundStyle(Palette.textPrimary).lineLimit(1).minimumScaleFactor(0.8)
                if w.feeBase > 0 {
                    Text("−" + CurrencyFormat.string(w.feeBase, base) + " fee")
                        .font(.system(size: 10)).monospacedDigit().foregroundStyle(Palette.negative.opacity(0.9))
                }
            }
            Menu {
                Button("Edit", systemImage: "pencil") { editingWithdrawal = w }
                Button("Delete", systemImage: "trash", role: .destructive) { pendingDeleteWithdrawal = w }
            } label: { Image(systemName: "ellipsis").foregroundStyle(Palette.textTertiary).frame(width: 24, height: 24) }
                .menuStyle(.borderlessButton).frame(width: 24)
                .help("Edit or delete this transfer")
                .accessibilityLabel("Transfer actions")
        }
        .padding(.vertical, 9)
    }

    private func icon(_ name: String, _ color: Color) -> some View {
        Circle().fill(color.opacity(0.18)).frame(width: 34, height: 34)
            .overlay(Image(systemName: name).font(.system(size: 12, weight: .bold)).foregroundStyle(color))
    }

}

// MARK: - Bulk entry

struct BulkPaymentSheet: View {
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @Query(filter: #Predicate<Project> { $0.deletedAt == nil }, sort: \Project.createdAt, order: .reverse) private var projects: [Project]
    @Query(filter: #Predicate<Wallet> { $0.deletedAt == nil }, sort: \Wallet.name) private var wallets: [Wallet]
    @Query private var rateRows: [ExchangeRate]
    @Query private var settings: [AppSettings]
    @Query private var rawAllocations: [PaymentAllocation]
    @Query(filter: #Predicate<Payment> { $0.deletedAt == nil }) private var livePayments: [Payment]

    // Allocations of trashed payments must never count as paid (owed prefills would lie).
    private var allocations: [PaymentAllocation] { ProjectMath.liveAllocations(rawAllocations, payments: livePayments) }

    struct DraftRow: Identifiable {
        let id = UUID()
        var projectId: UUID?
        var gross = ""
        var currency = "PHP"
        var landed = ""             // what actually landed (in landedCurrency); fee auto
        var landedCurrency = "PHP"
        var landing: UUID?
        var date = Date.now
    }

    /// Optional pre-fill (e.g. dragged a project to "Paid") — seeds the first row.
    var prefillProjectId: UUID? = nil
    var prefillGrossNative: Double? = nil
    var prefillCurrency: String = "PHP"

    @State private var draftRows: [DraftRow] = [DraftRow()]
    @State private var merge = false                 // all arrived together → one number
    @State private var mergedAmount = ""
    @State private var mergedCurrency = "PHP"
    @State private var result: String?
    @State private var seeded = false
    @FocusState private var focusedAmount: UUID?     // auto-focus the first row's amount on open
    @FocusState private var mergedFocus: Bool

    private var base: String { settings.first?.baseCurrency ?? "PHP" }
    private var rates: Rates { Rates(base: base, rates: rateRows) }
    private var openProjects: [Project] { projects.filter { $0.status == .unpaid || $0.status == .partiallyPaid } }
    private let currencies = CurrencyFormat.supported

    /// Tolerant amount parsing — accepts "1,500" as well as "1500.50".
    private func parsedAmount(_ raw: String) -> Double? { Double(raw.replacingOccurrences(of: ",", with: "")) }

    private func rowGrossBase(_ r: DraftRow) -> Double { rates.toBase(parsedAmount(r.gross) ?? 0, r.currency) }
    private var mergedLandedBase: Double { rates.toBase(parsedAmount(mergedAmount) ?? 0, mergedCurrency) }
    /// Mirrors save()'s guard: at least one row with a project AND a positive amount.
    private var canLog: Bool { draftRows.contains { $0.projectId != nil && (parsedAmount($0.gross) ?? 0) > 0 } }

    /// Net that landed for a row (in base). In merge mode the single landed total is
    /// split across rows by what each is owed. Otherwise it's the row's own landed
    /// (in its landed currency), or the gross when left blank (no fee).
    private func rowNet(_ r: DraftRow) -> Double {
        if merge {
            let totalGross = draftRows.reduce(0) { $0 + rowGrossBase($1) }
            guard totalGross > 0 else { return 0 }
            return round2(mergedLandedBase * (rowGrossBase(r) / totalGross))
        }
        if let n = parsedAmount(r.landed), n > 0 { return round2(rates.toBase(n, r.landedCurrency)) }
        return rowGrossBase(r)
    }
    private func rowFee(_ r: DraftRow) -> Double { max(0, rowGrossBase(r) - rowNet(r)) }
    private var totalNet: Double { merge ? mergedLandedBase : draftRows.reduce(0) { $0 + rowNet($1) } }
    private var totalFee: Double { draftRows.reduce(0) { $0 + rowFee($1) } }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 11) {
                GlyphChip(systemImage: "arrow.down.left.circle.fill", color: Palette.positive, size: 30)
                    .onAppear {
                        guard !seeded, let pid = prefillProjectId else { return }
                        seeded = true
                        var r = DraftRow(); r.projectId = pid; r.currency = prefillCurrency; r.landedCurrency = prefillCurrency
                        if let g = prefillGrossNative { r.gross = String(format: "%g", g) }
                        draftRows = [r]
                    }
                VStack(alignment: .leading, spacing: 1) {
                    Text("Log payment").font(Typo.title(18)).foregroundStyle(Palette.textPrimary)
                    Text("Enter what you RECEIVED — fees are figured out for you.").font(.system(size: 11)).foregroundStyle(Palette.textTertiary)
                }
                Spacer()
                Button { dismiss() } label: { Image(systemName: "xmark.circle.fill").font(.system(size: 20)).foregroundStyle(Palette.textTertiary) }
                    .buttonStyle(.iconPress).keyboardShortcut(.cancelAction)
                    .help("Close (Esc)").accessibilityLabel("Close")
            }
            .padding(.horizontal, 18).padding(.vertical, 14)
            .background(.white.opacity(0.04))
            .overlay(alignment: .bottom) { Rectangle().fill(Palette.hairline).frame(height: 0.7) }

            ScrollView {
                VStack(spacing: 12) {
                    if draftRows.count > 1 {
                        Toggle(isOn: $merge.animation(.snappy(duration: 0.2))) {
                            VStack(alignment: .leading, spacing: 1) {
                                Text("Arrived together").font(.system(size: 13, weight: .medium)).foregroundStyle(Palette.textPrimary)
                                Text("One transfer covering all of these — enter the single amount you received.").font(.system(size: 10.5)).foregroundStyle(Palette.textTertiary)
                            }
                        }.toggleStyle(.switch).tint(Palette.positive).padding(12).glassCard(cornerRadius: Radii.field)
                    }
                    if merge {
                        HStack(spacing: 10) {
                            Text("Total received").font(.system(size: 13)).foregroundStyle(Palette.textSecondary)
                            TextField("0", text: $mergedAmount).textFieldStyle(GlassFieldStyle()).frame(width: 110)
                                .focused($mergedFocus)
                            CurrencyMenu(selection: $mergedCurrency, options: currencies)
                        }.padding(12).glassCard(cornerRadius: Radii.field)
                    }
                    ForEach($draftRows) { $row in rowEditor($row) }
                    Button { draftRows.append(DraftRow()) } label: {
                        Label("Add another payment", systemImage: "plus").font(.system(size: 12, weight: .medium))
                    }.buttonStyle(.glass).padding(.top, 2)
                }
                .padding(20)
            }

            Divider().overlay(Palette.hairline)
            HStack {
                VStack(alignment: .leading, spacing: 1) {
                    Text("Total landed").tileLabel()
                    Text(CurrencyFormat.string(totalNet, base))
                        .font(.system(size: 16, weight: .semibold, design: .rounded)).monospacedDigit()
                        .foregroundStyle(Palette.positive).lineLimit(1).minimumScaleFactor(0.7)
                }
                if totalFee > 0 {
                    VStack(alignment: .leading, spacing: 1) {
                        Text("Fees (auto)").tileLabel()
                        Text(CurrencyFormat.string(totalFee, base)).font(.system(size: 14, weight: .semibold, design: .rounded)).monospacedDigit().foregroundStyle(Palette.negative).lineLimit(1)
                    }.padding(.leading, 10)
                }
                if let result { Text(result).font(.caption).foregroundStyle(Palette.negative).padding(.leading, 8) }
                Spacer()
                Button("Cancel") { dismiss() }.buttonStyle(.glass)
                Button("Log \(draftRows.count)") { save() }
                    .buttonStyle(.glassProminent).tint(Palette.positive)
                    .disabled(!canLog)
                    .keyboardShortcut(.defaultAction)   // ⏎ logs from anywhere in the sheet
                    .help(canLog ? "Log these payments (⏎)" : "Pick a project and enter an amount first")
            }.padding(16)
        }
        .frame(width: 760, height: 600)
        .flagshipSheet()
        .onAppear { DispatchQueue.main.async { focusedAmount = draftRows.first?.id } }
        .onChange(of: merge) { _, on in if on { DispatchQueue.main.async { mergedFocus = true } } }
    }

    /// A tiny uppercase caption over a control — the row editor's labeling rhythm.
    private func field<C: View>(_ label: String, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(label).font(.system(size: 9.5, weight: .semibold)).kerning(0.6)
                .textCase(.uppercase).foregroundStyle(Palette.textTertiary)
            content()
        }
    }

    /// One payment, laid out on TWO labeled lines so nothing clips:
    ///   line 1 — which project, when, (remove)
    ///   line 2 — what was owed, what actually arrived, into which wallet, fee read-back
    private func rowEditor(_ row: Binding<DraftRow>) -> some View {
        let r = row.wrappedValue
        let fee = rowFee(r)
        return VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .bottom, spacing: 10) {
                field("Project") {
                    GlassMenuPicker(selection: row.projectId,
                                    options: [nil] + openProjects.map { Optional($0.id) },
                                    label: { id in id.flatMap { i in projects.first { $0.id == i }?.title } ?? "Choose a project…" })
                    .onChange(of: row.projectId.wrappedValue) { _, pid in
                        // Auto-fill the owed amount + its currency from the project.
                        if let p = openProjects.first(where: { $0.id == pid }) {
                            let out = ProjectMath.outstandingNative(project: p, allocations: allocations, rates: rates)
                            row.gross.wrappedValue = out > 0 ? String(format: "%.0f", out) : String(format: "%.0f", p.amount)
                            row.currency.wrappedValue = p.currency
                        }
                    }
                }
                .frame(maxWidth: .infinity)
                field("Date") { GlassDateField(date: row.date, compact: true).frame(width: 118) }
                if draftRows.count > 1 {
                    Button { withAnimation(.snappy(duration: 0.2)) { draftRows.removeAll { $0.id == r.id } } } label: {
                        Image(systemName: "minus.circle.fill").font(.system(size: 16)).foregroundStyle(Palette.negative.opacity(0.8))
                    }
                    .buttonStyle(.iconPress).padding(.bottom, 7)
                    .help("Remove this payment").accessibilityLabel("Remove payment row")
                }
            }
            HStack(alignment: .bottom, spacing: 14) {
                field("Owed (gross)") {
                    HStack(spacing: 6) {
                        TextField("0", text: row.gross).textFieldStyle(GlassFieldStyle()).frame(width: 100)
                            .focused($focusedAmount, equals: r.id)
                        CurrencyMenu(selection: row.currency, options: currencies)
                    }
                }
                if merge {
                    field("Lands as") {
                        Text("≈ " + CurrencyFormat.string(rowNet(r), base, compact: true))
                            .font(.system(size: 13, weight: .semibold, design: .rounded)).monospacedDigit()
                            .foregroundStyle(Palette.positive).lineLimit(1)
                            .padding(.horizontal, 11).padding(.vertical, 9)
                            .insetRow(cornerRadius: Radii.field, hoverable: false)
                    }
                } else {
                    field("Received (net)") {
                        HStack(spacing: 6) {
                            TextField("same", text: row.landed).textFieldStyle(GlassFieldStyle()).frame(width: 100)
                                .help("What actually arrived — leave empty if no fee was taken.")
                            CurrencyMenu(selection: row.landedCurrency, options: currencies)
                        }
                    }
                }
                field("Into wallet") {
                    GlassMenuPicker(selection: row.landing,
                                    options: [nil] + wallets.filter { !$0.archived }.map { Optional($0.id) },
                                    label: { id in id.flatMap { i in wallets.first { $0.id == i }?.name } ?? "Pick…" })
                    .frame(width: 150)
                }
                Spacer(minLength: 0)
                if fee > 0.005 {
                    MetricChip(text: "fee " + CurrencyFormat.string(fee, base, compact: true),
                               systemImage: "scissors", color: Palette.negative)
                        .padding(.bottom, 7)
                }
            }
        }
        .padding(14)
        .glassCard(cornerRadius: Radii.tile)
        .animation(.snappy(duration: 0.2), value: fee > 0.005)
    }

    private func save() {
        let rows: [BulkRow] = draftRows.compactMap { r in
            guard let pid = r.projectId, let g = parsedAmount(r.gross), g > 0 else { return nil }
            // Fee is derived: gross (in base) − what landed. No manual fee, any currency.
            let fee = rowFee(r)
            return BulkRow(projectId: pid, paidAt: r.date, grossAmount: g, grossCurrency: r.currency,
                           feeBase: fee, landingMethodId: r.landing, fromMethodId: nil,
                           reference: nil, notes: nil)
        }
        guard !rows.isEmpty else { result = "Pick a project and enter an amount first."; return }
        let outcome = MoneyEngine(context: context).addPaymentsBulk(rows)
        if outcome.errors.isEmpty {
            dismiss()
        } else {
            result = "\(outcome.created) saved, \(outcome.errors.count) failed"
        }
    }
}

import SwiftUI
import SwiftData

// MARK: - Edit payment (net received / landing wallet / fee unknown)

struct EditPaymentSheet: View {
    let payment: Payment
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @Query(filter: #Predicate<Wallet> { $0.deletedAt == nil }, sort: \Wallet.name) private var wallets: [Wallet]
    @Query private var settings: [AppSettings]
    @Query private var steps: [PaymentStep]
    @Query private var rateRows: [ExchangeRate]

    @State private var net = ""
    @State private var landing: UUID?
    @State private var feeUnknown = false
    @State private var reference = ""
    @State private var notes = ""
    @State private var error: String?

    private var base: String { settings.first?.baseCurrency ?? "PHP" }
    private var rates: Rates { Rates(base: base, rates: rateRows) }
    /// Gross received in base — the ceiling the net can never exceed.
    private var grossBase: Double { payment.grossAtMarketBase ?? rates.toBase(payment.amount, payment.currency) }
    private func money(_ v: Double) -> String { CurrencyFormat.string(v, base) }

    var body: some View {
        SheetScaffold(title: "Edit payment", accent: Palette.positive, canSave: true, onSave: save) {
            LabeledField("Net received (in \(base))") {
                TextField("0", text: $net).textFieldStyle(GlassFieldStyle()).disabled(feeUnknown)
            }
            Toggle(isOn: $feeUnknown) { Text("Fee unknown (net = gross)").font(.system(size: 13)).foregroundStyle(Palette.textPrimary) }
                .toggleStyle(.switch).tint(Palette.warning)
            LabeledField("Landed in wallet") {
                GlassMenuPicker(selection: $landing,
                                options: [nil] + wallets.filter { !$0.archived }.map { Optional($0.id) },
                                label: { id in id.flatMap { i in wallets.first { $0.id == i }?.name } ?? "None" })
            }
            LabeledField("Reference") { TextField("invoice #, note to self…", text: $reference).textFieldStyle(GlassFieldStyle()) }
            LabeledField("Notes") { TextField("optional", text: $notes).textFieldStyle(GlassFieldStyle()) }
            if let error { Text(error).font(.caption).foregroundStyle(Palette.negative) }
        }
        .onAppear {
            net = String(format: "%.2f", payment.netAmountBase ?? 0)
            feeUnknown = payment.feeUnknown
            landing = steps.filter { $0.paymentId == payment.id }.sorted { $0.stepOrder < $1.stepOrder }.last?.methodId
            reference = payment.reference ?? ""; notes = payment.notes ?? ""
        }
    }

    private func save() {
        error = nil
        // When the fee is unknown we deliberately treat net = gross; otherwise the net
        // must be a real, non-blank number that can't exceed the gross. Previously a blank
        // field silently passed `nil` through and defaulted the net up to the full gross.
        var netBase: Double?
        if feeUnknown {
            netBase = nil   // engine sets net = gross
        } else {
            let trimmed = net.trimmingCharacters(in: .whitespaces)
            guard !trimmed.isEmpty, let v = Double(trimmed) else {
                error = "Enter the net amount received (or turn on “Fee unknown”)."; return
            }
            guard v >= 0 else { error = "Net received can’t be negative."; return }
            // 0.005 = half-a-cent tolerance so FX/rounding noise on the gross can't trip a
            // net that's effectively equal to it.
            guard v <= grossBase + 0.005 else {
                error = "Net received (\(money(v))) can’t exceed the gross (\(money(grossBase)))."; return
            }
            netBase = v
        }
        // Set reference/notes BEFORE the engine call so they commit in the same save the
        // engine performs (atomic) rather than a second, separately-failing try? context.save().
        payment.reference = reference.isEmpty ? nil : reference
        payment.notes = notes.isEmpty ? nil : notes
        payment.dirty = true
        do {
            try MoneyEngine(context: context).updatePaymentDetails(
                paymentId: payment.id, netReceivedBase: netBase,
                methodId: .some(landing), fromMethodId: nil, feeUnknown: feeUnknown)
            dismiss()
        } catch { self.error = error.localizedDescription }
    }
}

// MARK: - Edit project

struct EditProjectSheet: View {
    let project: Project
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @Environment(UndoCenter.self) private var undo
    @Query(filter: #Predicate<Client> { $0.deletedAt == nil }, sort: \Client.name) private var clients: [Client]
    @Query private var allMilestones: [ProjectMilestone]

    @State private var confirmDelete = false
    @State private var title = ""
    @State private var amount = ""
    @State private var currency = "PHP"
    @State private var clientId: UUID?
    @State private var status: ProjectStatus = .unpaid
    @State private var hasDue = false
    @State private var due = Date.now
    @State private var notes = ""
    @State private var newMilestone = ""
    @State private var newMilestoneAmount = ""
    @State private var delivered = false
    @State private var deliveredAt = Date.now

    private let currencies = CurrencyFormat.supported

    private var milestones: [ProjectMilestone] {
        allMilestones.filter { $0.projectId == project.id && $0.deletedAt == nil }.sorted { $0.order < $1.order }
    }

    var body: some View {
        SheetScaffold(title: "Edit project", accent: Palette.violet,
                      canSave: !title.isEmpty && Double(amount) != nil, onSave: save,
                      deleteLabel: "Delete project", onDelete: { confirmDelete = true }) {
            LabeledField("Title") { TextField("Title", text: $title).textFieldStyle(GlassFieldStyle()) }
            LabeledField("Client") {
                GlassMenuPicker(selection: $clientId,
                                options: [nil] + clients.map { Optional($0.id) },
                                label: { id in id.flatMap { i in clients.first { $0.id == i }?.name } ?? "None" })
                .onChange(of: clientId) { _, id in
                    if let c = clients.first(where: { $0.id == id }), let cur = c.defaultCurrency, !cur.isEmpty { currency = cur }
                }
            }
            HStack(spacing: 12) {
                LabeledField("Amount") { TextField("0", text: $amount).textFieldStyle(GlassFieldStyle()) }
                LabeledField("Currency") { CurrencyMenu(selection: $currency, options: currencies) }
            }
            LabeledField("Status") {
                GlassSegment(options: [ProjectStatus.unpaid, .partiallyPaid, .paid],
                             selection: $status, label: { $0.label })
            }
            Toggle(isOn: $delivered.animation()) {
                VStack(alignment: .leading, spacing: 1) {
                    Text("Work delivered").font(.system(size: 13)).foregroundStyle(Palette.textPrimary)
                    Text("Starts the “waiting to be paid” clock here — not from when you took the job.")
                        .font(.system(size: 11)).foregroundStyle(Palette.textTertiary)
                }
            }
            .toggleStyle(.switch).tint(Palette.violet)
            if delivered { LabeledField("Delivered on") { GlassDateField(date: $deliveredAt) } }
            Toggle(isOn: $hasDue.animation()) { Text("Has a due date").font(.system(size: 13)).foregroundStyle(Palette.textPrimary) }
                .toggleStyle(.switch).tint(Palette.violet)
            if hasDue { LabeledField("Due") { GlassDateField(date: $due) } }
            milestoneSection
            LabeledField("Notes") { TextField("optional", text: $notes).textFieldStyle(GlassFieldStyle()) }
        }
        .onAppear {
            title = project.title; amount = String(format: "%g", project.amount)
            currency = project.currency; clientId = project.clientId; status = project.status
            notes = project.notes ?? ""
            if let d = project.dueDate { hasDue = true; due = d }
            if let w = project.workCompletedAt { delivered = true; deliveredAt = w }
        }
        .confirmationDialog("Delete “\(project.title)”?", isPresented: $confirmDelete) {
            Button("Delete project", role: .destructive) {
                if project.status != .paid {
                    Brain.enqueueProjectPostMortem(context, projectTitle: project.title,
                                                   clientName: clients.first { $0.id == project.clientId }?.name, outcome: "fell_through")
                }
                undo.trashSimple(project, label: "project", context: context)
                dismiss()
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("It moves to Trash for 30 days — logged payments stay in your history. You can undo right away.")
        }
    }

    private var milestoneSection: some View {
        let done = milestones.filter { $0.done }.count
        return LabeledField(milestones.isEmpty ? "Milestones" : "Milestones · \(done)/\(milestones.count) done") {
            VStack(spacing: 7) {
                ForEach(milestones) { m in
                    HStack(spacing: 9) {
                        Button { m.done.toggle(); m.doneAt = m.done ? .now : nil; m.dirty = true; try? context.save() } label: {
                            Image(systemName: m.done ? "checkmark.circle.fill" : "circle")
                                .font(.system(size: 16)).foregroundStyle(m.done ? Palette.positive : Palette.textTertiary)
                        }.buttonStyle(.iconPress)
                        Text(m.title).font(.system(size: 13)).foregroundStyle(m.done ? Palette.textTertiary : Palette.textPrimary)
                            .strikethrough(m.done, color: Palette.textTertiary)
                        Spacer()
                        if m.amount > 0 { Text(CurrencyFormat.string(m.amount, currency, compact: true)).font(.system(size: 11, weight: .medium)).foregroundStyle(Palette.textTertiary) }
                        Button { context.delete(m); try? context.save() } label: { Image(systemName: "minus.circle").font(.system(size: 13)) }
                            .buttonStyle(.iconPress).foregroundStyle(Palette.negative)
                    }
                    .padding(.horizontal, 10).padding(.vertical, 7)
                    .insetRow(cornerRadius: Radii.row)
                }
                HStack(spacing: 8) {
                    TextField("Add a phase (e.g. Design, Revisions)…", text: $newMilestone).textFieldStyle(GlassFieldStyle())
                    TextField("₱", text: $newMilestoneAmount).textFieldStyle(GlassFieldStyle()).frame(width: 80)
                    Button { addMilestone() } label: { Image(systemName: "plus.circle.fill").font(.system(size: 18)).foregroundStyle(Palette.violet) }
                        .buttonStyle(.iconPress).disabled(newMilestone.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
    }

    private func addMilestone() {
        let t = newMilestone.trimmingCharacters(in: .whitespaces)
        guard !t.isEmpty else { return }
        let m = ProjectMilestone(projectId: project.id, title: t, amount: Double(newMilestoneAmount) ?? 0, order: milestones.count)
        m.dirty = true; context.insert(m); try? context.save()
        newMilestone = ""; newMilestoneAmount = ""
    }

    private func save() {
        guard let amt = Double(amount) else { return }
        project.title = title; project.amount = amt; project.currency = currency
        project.clientId = clientId; project.status = status
        project.dueDate = hasDue ? due : nil
        project.notes = notes.isEmpty ? nil : notes
        project.completedAt = status == .paid ? (project.completedAt ?? .now) : nil
        project.workCompletedAt = delivered ? deliveredAt : nil
        project.updatedAt = .now; project.dirty = true
        try? context.save()
        MoneyEngine(context: context).recomputeProjectStatus(project.id)
        try? context.save()
        dismiss()
    }
}

// MARK: - Edit wallet (incl. opening balance)

struct EditWalletSheet: View {
    let wallet: Wallet
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @Query private var ledger: [LedgerEntry]
    @Query private var settings: [AppSettings]

    @State private var name = ""
    @State private var kind: WalletKind = .wallet
    @State private var opening = ""
    @State private var isHolding = true
    @State private var archived = false
    @State private var excluded = false
    @State private var notes = ""
    @State private var reconcileTo = ""
    @State private var reconciled = false

    private var base: String { settings.first?.baseCurrency ?? "PHP" }
    private var currentBalance: Double { WalletMath.balance(of: wallet, ledger: ledger) }

    var body: some View {
        SheetScaffold(title: "Edit wallet", accent: Palette.teal, canSave: !name.isEmpty, onSave: save) {
            HStack(spacing: 12) {
                WalletGlyph(wallet: wallet, size: 40)
                Text("The logo is matched automatically from the wallet name.")
                    .font(.system(size: 11)).foregroundStyle(Palette.textTertiary)
            }
            LabeledField("Name") { TextField("Name", text: $name).textFieldStyle(GlassFieldStyle()) }
            LabeledField("Type") {
                GlassMenuPicker(selection: $kind, options: Array(WalletKind.allCases), label: { $0.label })
            }
            LabeledField("Opening balance (base)") {
                TextField("0", text: $opening).textFieldStyle(GlassFieldStyle())
            }
            LabeledField("Reconcile — set the actual balance now") {
                HStack(spacing: 8) {
                    TextField(CurrencyFormat.string(currentBalance, base, compact: true), text: $reconcileTo)
                        .textFieldStyle(GlassFieldStyle())
                    Button(reconciled ? "Done ✓" : "Reconcile") {
                        if let actual = Double(reconcileTo.trimmingCharacters(in: .whitespaces)) {
                            MoneyEngine(context: context).reconcileWallet(wallet.id, actualBase: actual)
                            reconciled = true; reconcileTo = ""
                        }
                    }.buttonStyle(.glass).disabled(Double(reconcileTo.trimmingCharacters(in: .whitespaces)) == nil)
                }
                Text("Book balance is \(CurrencyFormat.string(currentBalance, base)). Enter what's really there and we'll add one balancing entry — your history stays intact.")
                    .font(.system(size: 10.5)).foregroundStyle(Palette.textTertiary)
            }
            LabeledField("Notes") { TextField("optional", text: $notes).textFieldStyle(GlassFieldStyle()) }
            Toggle(isOn: $isHolding) { Text("Holding wallet (keeps a balance)").font(.system(size: 13)).foregroundStyle(Palette.textPrimary) }
                .toggleStyle(.switch).tint(Palette.teal)
            Toggle(isOn: $excluded) {
                VStack(alignment: .leading, spacing: 1) {
                    Text("Ignore in totals & alerts").font(.system(size: 13)).foregroundStyle(Palette.textPrimary)
                    Text("Keeps the balance visible here, but leaves it out of your available total and stops overdrawn warnings.")
                        .font(.system(size: 10.5)).foregroundStyle(Palette.textTertiary)
                }
            }.toggleStyle(.switch).tint(Palette.warning)
            Toggle(isOn: $archived) { Text("Archived").font(.system(size: 13)).foregroundStyle(Palette.textPrimary) }
                .toggleStyle(.switch).tint(Palette.negative)
        }
        .onAppear {
            name = wallet.name; kind = wallet.kind
            opening = wallet.openingBalanceBase.map { String(format: "%g", $0) } ?? ""
            isHolding = wallet.isHolding; archived = wallet.archived; notes = wallet.notes ?? ""
            excluded = wallet.excludedFromTotals
        }
    }

    private func save() {
        wallet.name = name; wallet.kind = kind; wallet.isHolding = isHolding; wallet.archived = archived
        wallet.excludedFromTotals = excluded
        wallet.notes = notes.isEmpty ? nil : notes
        let newOpening = Double(opening.trimmingCharacters(in: .whitespaces))
        if newOpening != wallet.openingBalanceBase {
            wallet.openingBalanceBase = newOpening
            // Editing the opening figure is a *historical correction*: the prior ledger must
            // keep counting. The old code moved the anchor to `.now`, which silently stranded
            // every past transaction from the balance (edit 1000→1500 over 300 of real ledger
            // gave 1500 instead of 1800). So we deliberately leave the anchor untouched. (To
            // instead set the *current* balance, use Reconcile, which writes an adjustment entry.)
            if wallet.openingBalanceSetAt == nil && wallet.openingBalanceAt == nil {
                wallet.openingBalanceSetAt = wallet.createdAt
            }
        }
        wallet.updatedAt = .now; wallet.dirty = true
        try? context.save()
        dismiss()
    }
}

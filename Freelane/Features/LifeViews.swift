import SwiftUI
import SwiftData
import Charts

// MARK: - Loans

struct LoansView: View {
    @Environment(\.modelContext) private var context
    @Environment(UndoCenter.self) private var undo
    @Query private var settings: [AppSettings]
    @Query(filter: #Predicate<Loan> { $0.deletedAt == nil }, sort: \Loan.startedAt, order: .reverse) private var loans: [Loan]
    @State private var showAdd = false
    @State private var selectedPerson: LoanPersonRef?

    private var base: String { settings.first?.baseCurrency ?? "PHP" }
    private var lentOut: Double { loans.filter { $0.direction == .given && $0.status != .returned && $0.status != .forgiven }.reduce(0) { $0 + $1.outstandingBase } }
    private var borrowed: Double { loans.filter { $0.direction == .received && $0.status != .returned && $0.status != .forgiven }.reduce(0) { $0 + $1.outstandingBase } }

    /// One entry per person (case-insensitive name), so repeated loans to the same person —
    /// the "four cards for wife" problem — collapse into a single card you can drill into.
    private var groups: [LoanGroup] {
        Dictionary(grouping: loans) { $0.counterparty.trimmingCharacters(in: .whitespaces).lowercased() }
            .map { key, ls in
                let sorted = ls.sorted { $0.startedAt > $1.startedAt }
                return LoanGroup(id: key, name: sorted.first?.counterparty ?? key, loans: sorted)
            }
            .sorted { a, b in
                // Still-open people first, then most-recent activity.
                if a.isSettled != b.isSettled { return !a.isSettled }
                return a.lastActivity > b.lastActivity
            }
    }

    var body: some View {
        Page("Loans", subtitle: "Money lent and borrowed.", toolbar: AnyView(
            Button { showAdd = true } label: { Label("New loan", systemImage: "plus") }
                .buttonStyle(.glassProminent).tint(Palette.teal))) {
            HStack(spacing: 16) {
                StatTile(label: "Owed to you", value: lentOut, code: base, systemImage: "arrow.down.left", accent: Palette.positive, chip: nil)
                StatTile(label: "You owe", value: borrowed, code: base, systemImage: "arrow.up.right", accent: Palette.negative, chip: nil)
            }
            SectionCard(title: "People", subtitle: "\(groups.count) \(groups.count == 1 ? "person" : "people")", accent: Palette.teal) {
                if groups.isEmpty {
                    EmptyStateCard(icon: "arrow.left.arrow.right", title: "No loans tracked yet",
                                   message: "Log money you've lent or borrowed and Freelane keeps the outstanding balance straight.")
                }
                else {
                    VStack(spacing: 0) {
                        ForEach(groups) { g in
                            Button { selectedPerson = LoanPersonRef(id: g.id, name: g.name) } label: {
                                HStack(spacing: 12) {
                                    Circle().fill(g.tint.opacity(0.18)).frame(width: 34, height: 34)
                                        .overlay(Image(systemName: g.icon).font(.system(size: 12, weight: .bold)).foregroundStyle(g.tint))
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(g.name).font(.system(size: 13, weight: .medium)).foregroundStyle(Palette.textPrimary)
                                        Text(g.subtitle).font(.system(size: 11)).foregroundStyle(Palette.textTertiary)
                                    }
                                    Spacer()
                                    if g.isSettled {
                                        StatusBadge(text: "Settled", color: Palette.positive)
                                    } else {
                                        Text(CurrencyFormat.string(abs(g.netOutstanding), base, compact: true))
                                            .font(.system(size: 13, weight: .semibold, design: .rounded)).foregroundStyle(g.tint)
                                    }
                                    Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold)).foregroundStyle(Palette.textTertiary)
                                }
                                .padding(.vertical, 9).hoverRow()
                            }.buttonStyle(.plain)
                            if g.id != groups.last?.id { Divider().overlay(Palette.hairline) }
                        }
                    }
                }
            }
        }
        .sheet(isPresented: $showAdd) { AddLoanSheet() }
        .sheet(item: $selectedPerson) { LoanPersonSheet(person: $0) }
    }
}

/// A lightweight reference to a borrower/lender, used to present their history sheet.
struct LoanPersonRef: Identifiable { let id: String; let name: String }

/// All loans with one person, rolled up. `netOutstanding` is positive when they owe you,
/// negative when you owe them.
struct LoanGroup: Identifiable {
    let id: String          // normalized (lowercased) name — the grouping key
    let name: String        // display spelling (most recent)
    let loans: [Loan]       // newest first

    private var lentOutstanding: Double { loans.filter { $0.direction == .given }.reduce(0) { $0 + $1.outstandingBase } }
    private var borrowedOutstanding: Double { loans.filter { $0.direction == .received }.reduce(0) { $0 + $1.outstandingBase } }
    var netOutstanding: Double { lentOutstanding - borrowedOutstanding }
    var isSettled: Bool { abs(netOutstanding) < 0.005 }
    var lastActivity: Date { loans.map { $0.startedAt }.max() ?? .distantPast }

    var tint: Color { isSettled ? Palette.textTertiary : (netOutstanding > 0 ? Palette.positive : Palette.negative) }
    var icon: String { isSettled ? "checkmark" : (netOutstanding > 0 ? "arrow.down.left" : "arrow.up.right") }
    var subtitle: String {
        let n = loans.count
        let count = "\(n) loan\(n == 1 ? "" : "s")"
        if isSettled { return "\(count) · all settled" }
        return "\(count) · \(netOutstanding > 0 ? "owes you" : "you owe")"
    }
}

struct ReturnLoanSheet: View {
    let loan: Loan
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @Query(filter: #Predicate<Wallet> { $0.deletedAt == nil }) private var wallets: [Wallet]
    @Query private var settings: [AppSettings]
    @State private var walletId: UUID?
    @State private var amount = ""

    private var base: String { settings.first?.baseCurrency ?? "PHP" }

    var body: some View {
        SheetScaffold(title: "Record return", accent: Palette.teal,
                      canSave: walletId != nil && (Double(amount) ?? 0) > 0, onSave: {
            LoanEngine.recordReturn(context, loan: loan, amountBase: Double(amount) ?? 0, walletId: walletId!)
            dismiss()
        }) {
            Text(loan.direction == .given
                 ? "\(loan.counterparty) is paying you back. Where should it land?"
                 : "You're paying \(loan.counterparty) back. Which wallet does it leave?")
                .font(.system(size: 12)).foregroundStyle(Palette.textSecondary)
            LabeledField(loan.direction == .given ? "Into wallet" : "From wallet") {
                GlassMenuPicker(selection: $walletId,
                                options: [UUID?.none] + wallets.filter { $0.isHolding && !$0.archived }.map { UUID?.some($0.id) },
                                label: { id in id.flatMap { i in wallets.first(where: { $0.id == i })?.name } ?? "Select…" })
            }
            LabeledField("Amount (\(base))") {
                TextField(CurrencyFormat.string(loan.outstandingBase, base, compact: true), text: $amount)
                    .textFieldStyle(GlassFieldStyle())
            }
            Text("Outstanding: \(CurrencyFormat.string(loan.outstandingBase, base))")
                .font(.system(size: 11)).foregroundStyle(Palette.textTertiary)
        }
        .onAppear {
            walletId = loan.originWalletId ?? wallets.first { $0.isHolding && !$0.archived }?.id
            amount = String(format: "%.2f", loan.outstandingBase)
        }
    }
}

/// Pooled return: one amount for a person, applied to their oldest open loan first (FIFO). The
/// user enters "they paid me 500" and it just works — they never pick which loan.
struct PersonReturnSheet: View {
    let loans: [Loan]        // one direction, the person's open loans
    let personName: String
    let inbound: Bool        // given → money comes back IN; received → payment goes OUT
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @Query(filter: #Predicate<Wallet> { $0.deletedAt == nil }) private var wallets: [Wallet]
    @Query private var settings: [AppSettings]
    @State private var walletId: UUID?
    @State private var amount = ""

    private var base: String { settings.first?.baseCurrency ?? "PHP" }
    private var outstanding: Double { loans.reduce(0) { $0 + $1.outstandingBase } }

    var body: some View {
        SheetScaffold(title: inbound ? "Record return" : "Record payment", accent: Palette.teal,
                      canSave: walletId != nil && (Double(amount) ?? 0) > 0, onSave: {
            LoanEngine.recordPooledReturn(context, loans: loans, amountBase: Double(amount) ?? 0, walletId: walletId!)
            dismiss()
        }) {
            Text(inbound
                 ? "\(personName) is paying you back — applied to the oldest loan first, so you don't pick which."
                 : "You're paying \(personName) back — applied to your oldest debt first.")
                .font(.system(size: 12)).foregroundStyle(Palette.textSecondary)
            LabeledField(inbound ? "Into wallet" : "From wallet") {
                GlassMenuPicker(selection: $walletId,
                                options: [UUID?.none] + wallets.filter { $0.isHolding && !$0.archived }.map { UUID?.some($0.id) },
                                label: { id in id.flatMap { i in wallets.first(where: { $0.id == i })?.name } ?? "Select…" })
            }
            LabeledField("Amount (\(base))") {
                TextField(CurrencyFormat.string(outstanding, base, compact: true), text: $amount)
                    .textFieldStyle(GlassFieldStyle())
            }
            Text("Total outstanding: \(CurrencyFormat.string(outstanding, base))")
                .font(.system(size: 11)).foregroundStyle(Palette.textTertiary)
        }
        .onAppear {
            walletId = loans.first?.originWalletId ?? wallets.first { $0.isHolding && !$0.archived }?.id
            amount = String(format: "%.2f", outstanding)
        }
    }
}

/// One person's whole loan history: every amount lent/borrowed, every repayment (pulled from
/// the ledger rows each loan created), forgiveness, and per-loan actions — so repeated loans
/// to the same person live in one place instead of scattered cards.
struct LoanPersonSheet: View {
    let person: LoanPersonRef
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @Environment(UndoCenter.self) private var undo
    @Query private var settings: [AppSettings]
    @Query(filter: #Predicate<Loan> { $0.deletedAt == nil }) private var allLoans: [Loan]
    @Query private var ledger: [LedgerEntry]
    @State private var pooled: PooledContext?
    @State private var editingLoan: Loan?
    @State private var addMore = false
    @State private var pendingDelete: Loan?

    struct PooledContext: Identifiable { let id = UUID(); let loans: [Loan]; let inbound: Bool }

    private var base: String { settings.first?.baseCurrency ?? "PHP" }
    private var loans: [Loan] {
        allLoans.filter { $0.counterparty.trimmingCharacters(in: .whitespaces).lowercased() == person.id }
                .sorted { $0.startedAt > $1.startedAt }
    }
    private var lentOutstanding: Double { loans.filter { $0.direction == .given }.reduce(0) { $0 + $1.outstandingBase } }
    private var borrowedOutstanding: Double { loans.filter { $0.direction == .received }.reduce(0) { $0 + $1.outstandingBase } }
    /// Every money movement across ALL this person's loans — the persistent history, newest first.
    private var history: [LedgerEntry] {
        let ids = Set(loans.map { $0.id })
        return ledger
            .filter { ($0.relatedId.map(ids.contains) ?? false) && $0.archivedAt == nil }
            .sorted { $0.eventAt > $1.eventAt }
    }
    private var givenOpen: [Loan] {
        loans.filter { $0.direction == .given && $0.outstandingBase > 0.005 && $0.status != .returned && $0.status != .forgiven }
    }
    private var receivedOpen: [Loan] {
        loans.filter { $0.direction == .received && $0.outstandingBase > 0.005 && $0.status != .returned && $0.status != .forgiven }
    }
    private var summaryLine: String {
        if lentOutstanding > 0.005 && borrowedOutstanding > 0.005 {
            return "\(CurrencyFormat.string(lentOutstanding, base, compact: true)) owed to you · \(CurrencyFormat.string(borrowedOutstanding, base, compact: true)) you owe"
        }
        if lentOutstanding > 0.005 { return "\(CurrencyFormat.string(lentOutstanding, base, compact: true)) owed to you" }
        if borrowedOutstanding > 0.005 { return "\(CurrencyFormat.string(borrowedOutstanding, base, compact: true)) you owe" }
        return "All settled"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 10) {
                Image(systemName: "person.crop.circle.fill").font(.system(size: 22)).foregroundStyle(Palette.teal)
                VStack(alignment: .leading, spacing: 1) {
                    Text(person.name).font(Typo.title(16)).foregroundStyle(Palette.textPrimary)
                    Text(summaryLine).font(.system(size: 11)).foregroundStyle(Palette.textTertiary)
                }
                Spacer()
                Button { addMore = true } label: { Label("Lend / borrow more", systemImage: "plus") }.buttonStyle(.glass).controlSize(.small)
                Button { dismiss() } label: { Image(systemName: "xmark.circle.fill").font(.system(size: 20)).foregroundStyle(Palette.textTertiary) }
                    .buttonStyle(.iconPress).keyboardShortcut(.cancelAction).help("Close")
            }.padding(18)
            Divider().overlay(Palette.hairline)
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    if loans.isEmpty {
                        Text("Nothing left here.").font(.system(size: 12)).foregroundStyle(Palette.textTertiary).padding(.top, 8)
                    }
                    // Pooled return — one amount, applied to the oldest loan first (no picking).
                    if !givenOpen.isEmpty || !receivedOpen.isEmpty {
                        HStack(spacing: 8) {
                            if !givenOpen.isEmpty {
                                Button { pooled = PooledContext(loans: givenOpen, inbound: true) } label: {
                                    Label("Record return", systemImage: "arrow.down.left").frame(maxWidth: .infinity)
                                }.buttonStyle(.glassProminent).tint(Palette.teal).controlSize(.large)
                            }
                            if !receivedOpen.isEmpty {
                                Button { pooled = PooledContext(loans: receivedOpen, inbound: false) } label: {
                                    Label("Record payment", systemImage: "arrow.up.right").frame(maxWidth: .infinity)
                                }.buttonStyle(.glassProminent).tint(Palette.negative).controlSize(.large)
                            }
                        }
                    }
                    if !history.isEmpty { historySection }
                    if !loans.isEmpty {
                        Text("Loans").font(.system(size: 11, weight: .semibold)).textCase(.uppercase).kerning(0.6)
                            .foregroundStyle(Palette.textTertiary).padding(.top, 2)
                    }
                    ForEach(loans) { l in loanBlock(l) }
                }.padding(18)
            }
        }
        .frame(width: 470, height: 600).flagshipSheet()
        .sheet(item: $pooled) { PersonReturnSheet(loans: $0.loans, personName: person.name, inbound: $0.inbound) }
        .sheet(item: $editingLoan) { EditLoanSheet(loan: $0) }
        .sheet(isPresented: $addMore) { AddLoanSheet(prefillName: person.name) }
        .confirmationDialog("Delete this loan?", isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }), presenting: pendingDelete) { l in
            Button("Delete", role: .destructive) {
                LoanEngine.onDelete(context, loan: l)
                undo.offer("loan") { LoanEngine.onRestore(context, loan: l) }
                pendingDelete = nil
            }
            Button("Cancel", role: .cancel) { pendingDelete = nil }
        } message: { l in Text("\(CurrencyFormat.string(l.outstandingBase, base)) outstanding · removes its wallet movement") }
    }

    /// The persistent, unified timeline — every lend and every repayment for this person, newest
    /// first — so the whole relationship stays visible in one place.
    private var historySection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("History").font(.system(size: 11, weight: .semibold)).textCase(.uppercase).kerning(0.6)
                .foregroundStyle(Palette.textTertiary)
            VStack(spacing: 6) {
                ForEach(history) { e in
                    HStack(spacing: 9) {
                        Image(systemName: e.amountBase >= 0 ? "arrow.down.left" : "arrow.up.right")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(e.amountBase >= 0 ? Palette.positive : Palette.negative).frame(width: 16)
                        Text(e.note ?? (e.amountBase >= 0 ? "Money in" : "Money out"))
                            .font(.system(size: 12)).foregroundStyle(Palette.textPrimary).lineLimit(1)
                        Spacer(minLength: 6)
                        Text(e.eventAt.formatted(.dateTime.month().day().year()))
                            .font(.system(size: 10)).foregroundStyle(Palette.textTertiary)
                        Text(CurrencyFormat.string(e.amountBase, base, compact: true))
                            .font(.system(size: 12, weight: .semibold, design: .rounded)).monospacedDigit()
                            .foregroundStyle(e.amountBase >= 0 ? Palette.positive : Palette.negative)
                            .frame(width: 78, alignment: .trailing)
                    }
                    .padding(.vertical, 7).padding(.horizontal, 10)
                    .insetRow(hoverable: false)
                }
            }
        }
        .padding(13).glassCard(cornerRadius: Radii.field)
    }

    /// A compact loan card for management (edit / forgive / delete). Repayments live in the unified
    /// history above, and returns are recorded pooled — so no per-loan return button here.
    @ViewBuilder
    private func loanBlock(_ l: Loan) -> some View {
        let open = l.status != .returned && l.status != .forgiven
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: l.direction == .given ? "arrow.down.left" : "arrow.up.right")
                    .font(.system(size: 12, weight: .bold)).foregroundStyle(l.direction == .given ? Palette.positive : Palette.negative)
                Text("\(l.direction == .given ? "Lent" : "Borrowed") \(CurrencyFormat.string(l.principalBase, base, compact: true))")
                    .font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.textPrimary)
                Spacer()
                StatusBadge(text: l.status.label, color: l.status == .returned ? Palette.positive : (l.status == .forgiven ? Palette.violet : Palette.warning))
            }
            Text(l.startedAt.formatted(.dateTime.month().day().year()) + (open ? " · \(CurrencyFormat.string(l.outstandingBase, base, compact: true)) outstanding" : ""))
                .font(.system(size: 11)).foregroundStyle(Palette.textTertiary)
            if let fb = l.forgivenBase, fb > 0 {
                Text("Forgiven \(CurrencyFormat.string(fb, base, compact: true)) — counted as sadaka").font(.system(size: 10)).foregroundStyle(Palette.violet)
            }
            HStack(spacing: 8) {
                if open && l.direction == .given {
                    Button("Forgive") { LoanEngine.forgive(context, loan: l) }.buttonStyle(.glass).controlSize(.small)
                }
                Button("Edit") { editingLoan = l }.buttonStyle(.glass).controlSize(.small)
                Spacer()
                Button(role: .destructive) { pendingDelete = l } label: { Image(systemName: "trash").font(.system(size: 11)) }
                    .buttonStyle(.iconPress).foregroundStyle(Palette.negative).help("Delete this loan")
            }.padding(.top, 2)
        }
        .padding(13).glassCard(cornerRadius: Radii.field)
    }
}

struct AddLoanSheet: View {
    var prefillName: String = ""
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @Query(filter: #Predicate<Wallet> { $0.deletedAt == nil }) private var wallets: [Wallet]
    @State private var who = ""; @State private var amount = ""; @State private var dir: LoanDirection = .given
    @State private var date = Date.now; @State private var walletId: UUID?; @State private var due: Date?

    var body: some View {
        SheetScaffold(title: who.isEmpty ? "New loan" : "New loan · \(who)", accent: Palette.teal,
                      canSave: !who.isEmpty && (Double(amount) ?? 0) > 0 && walletId != nil, onSave: {
            let l = Loan(counterparty: who, direction: dir, principalBase: Double(amount) ?? 0, startedAt: date)
            l.originWalletId = walletId; l.dueDate = due; l.dirty = true
            context.insert(l)
            LoanEngine.onCreate(context, loan: l)   // moves the wallet
            dismiss()
        }) {
            LabeledField("Person") { TextField("Who", text: $who).textFieldStyle(GlassFieldStyle()) }
            LabeledField("Direction") {
                GlassSegment(options: [LoanDirection.given, .received], selection: $dir) { $0 == .given ? "I lent out" : "I borrowed" }
            }
            LabeledField(dir == .given ? "From wallet (money leaves here)" : "Into wallet (money lands here)") {
                GlassMenuPicker(selection: $walletId,
                                options: [UUID?.none] + wallets.filter { $0.isHolding && !$0.archived }.map { UUID?.some($0.id) },
                                label: { id in id.flatMap { i in wallets.first(where: { $0.id == i })?.name } ?? "Select…" })
            }
            LabeledField("Amount (base)") { TextField("0", text: $amount).textFieldStyle(GlassFieldStyle()) }
            LabeledField("Date") { GlassDateField(date: $date) }
            LabeledField("Expected return (optional)") {
                GlassDateField(date: Binding(get: { due ?? date }, set: { due = $0 }))
            }
        }
        .onAppear {
            if who.isEmpty { who = prefillName }
            walletId = wallets.first { $0.isHolding && !$0.archived }?.id
        }
    }
}

struct EditLoanSheet: View {
    let loan: Loan
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @State private var loaded = false
    @State private var who = ""; @State private var notes = ""
    @State private var hasDue = false; @State private var due = Date.now
    var body: some View {
        SheetScaffold(title: "Edit loan", accent: Palette.teal, canSave: !who.isEmpty, onSave: {
            loan.counterparty = who; loan.notes = notes.isEmpty ? nil : notes
            loan.dueDate = hasDue ? due : nil; loan.dirty = true; try? context.save(); dismiss()
        }) {
            LabeledField("Person") { TextField("Who", text: $who).textFieldStyle(GlassFieldStyle()) }
            Toggle(isOn: $hasDue.animation()) { Text("Expected return date").font(.system(size: 13)).foregroundStyle(Palette.textPrimary) }
                .toggleStyle(.switch).tint(Palette.teal)
            if hasDue { LabeledField("Return by") { GlassDateField(date: $due) } }
            LabeledField("Notes") { TextField("optional", text: $notes).textFieldStyle(GlassFieldStyle()) }
            Text("Amount, direction and wallet are locked once logged (they moved real money). Delete + re-add to change those.")
                .font(.system(size: 10)).foregroundStyle(Palette.textTertiary)
        }
        .onAppear {
            guard !loaded else { return }; loaded = true
            who = loan.counterparty; notes = loan.notes ?? ""
            if let d = loan.dueDate { hasDue = true; due = d }
        }
    }
}

// MARK: - Body

struct BodyView: View {
    @Environment(\.modelContext) private var context
    @Query(filter: #Predicate<BodyLog> { $0.deletedAt == nil }, sort: \BodyLog.day, order: .reverse) private var logs: [BodyLog]
    @Query(filter: #Predicate<Spend> { $0.deletedAt == nil }) private var spends: [Spend]

    // The 5-second check-in — nil until tapped (or until today's log fills them in).
    @State private var energy: Int?
    @State private var mood: Int?
    @State private var sleepH: Double?
    // The slower extras — water, movement, weight, notes — live behind a quiet disclosure.
    @State private var waterMl = 0; @State private var waterSubtract = false
    @State private var workout = ""; @State private var weight = ""; @State private var notes = ""
    @State private var showDetails = false
    @State private var detailsSaved = false
    @State private var loaded = false

    private func waterFmt(_ ml: Int) -> String { ml >= 1000 ? String(format: "%g L", Double(ml) / 1000) : "\(ml) ml" }
    private func hoursFmt(_ h: Double) -> String { String(format: "%gh", h) }
    private var todayLog: BodyLog? { logs.first { PHT.calendar.isDate($0.day, inSameDayAs: PHT.startOfDay()) } }
    private var savedToday: Bool { todayLog != nil }

    private let energyWords = ["Drained", "Low", "Steady", "Good", "Wired"]
    private let moodWords = ["Rough", "Meh", "Okay", "Good", "Great"]

    var body: some View {
        Page("Body", subtitle: "Energy, sleep, mood — and how they move with your money.") {
            heroCard
            if !logs.isEmpty { trendsCard }
            recentCard
        }
        // Load today's already-saved values so the hero reflects reality on every visit.
        .onAppear {
            guard !loaded else { return }
            loaded = true
            if let t = todayLog {
                energy = t.energy; mood = t.mood; sleepH = t.sleepHours
                waterMl = t.waterMl ?? (t.waterCups.map { $0 * 250 } ?? 0)
                workout = t.workoutMinutes.map(String.init) ?? ""
                weight = t.weightKg.map { String(format: "%g", $0) } ?? ""
                notes = t.notes ?? ""
            }
        }
    }

    // MARK: the inline hero check-in (taps save instantly — no form, no sheet)

    private var heroCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(savedToday ? "Today's check-in" : "How are you right now?")
                        .font(Typo.title(17)).foregroundStyle(Palette.textPrimary)
                    Text(savedToday ? "Tap any scale to adjust — it saves instantly." : "Three taps. That's the whole check-in.")
                        .font(.system(size: 12)).foregroundStyle(Palette.textTertiary)
                }
                Spacer()
                if savedToday {
                    Label("Logged", systemImage: "checkmark.seal.fill")
                        .font(.system(size: 11, weight: .semibold)).foregroundStyle(Palette.acidLime)
                        .padding(.horizontal, 9).padding(.vertical, 4)
                        .background(Palette.acidLime.opacity(0.12), in: Capsule())
                        .overlay(Capsule().strokeBorder(Palette.acidLime.opacity(0.25), lineWidth: 0.7))
                        .transition(.opacity)
                }
            }
            scaleRow("Energy", icon: "bolt.fill", color: Palette.negative, value: energy, words: energyWords) { energy = $0; saveScales() }
            scaleRow("Mood", icon: "face.smiling", color: Palette.violet, value: mood, words: moodWords) { mood = $0; saveScales() }
            sleepRow
            detailsSection
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassCard(cornerRadius: Radii.card, tint: Palette.negative, elevated: true)
        .animation(Motion.snappy, value: savedToday)
    }

    private func scaleRow(_ label: String, icon: String, color: Color, value: Int?, words: [String], onTap: @escaping (Int) -> Void) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon).font(.system(size: 12, weight: .bold)).foregroundStyle(color)
                .frame(width: 26, height: 26)
                .background(color.opacity(0.14), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            Text(label).font(.system(size: 13, weight: .medium)).foregroundStyle(Palette.textPrimary)
            if let v = value, (1...5).contains(v) {
                Text(words[v - 1]).font(.system(size: 11, weight: .medium)).foregroundStyle(color)
            }
            Spacer()
            TapScale(value: value, color: color, onTap: onTap)
        }
        .padding(.vertical, 8).padding(.horizontal, 10)
        .insetRow(cornerRadius: Radii.field, hoverable: false)
        .animation(Motion.snappy, value: value)
    }

    private var sleepRow: some View {
        HStack(spacing: 12) {
            Image(systemName: "bed.double.fill").font(.system(size: 12, weight: .bold)).foregroundStyle(Palette.indigo)
                .frame(width: 26, height: 26)
                .background(Palette.indigo.opacity(0.14), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            Text("Sleep").font(.system(size: 13, weight: .medium)).foregroundStyle(Palette.textPrimary)
            Spacer()
            ForEach([6.0, 7.0, 8.0], id: \.self) { h in
                Button(hoursFmt(h)) { sleepH = h; saveScales() }
                    .buttonStyle(.glass).controlSize(.small)
                    .tint(sleepH == h ? Palette.indigo : nil)
            }
            HStack(spacing: 8) {
                Button { sleepH = max(0, (sleepH ?? 7.5) - 0.5); saveScales() } label: { Image(systemName: "minus") }
                    .buttonStyle(.glass).controlSize(.small)
                Text(sleepH.map(hoursFmt) ?? "—")
                    .font(.system(size: 13, weight: .semibold, design: .rounded)).monospacedDigit()
                    .foregroundStyle(sleepH == nil ? Palette.textTertiary : Palette.textPrimary)
                    .frame(minWidth: 38)
                Button { sleepH = min(16, (sleepH ?? 6.5) + 0.5); saveScales() } label: { Image(systemName: "plus") }
                    .buttonStyle(.glass).controlSize(.small)
            }
            .padding(.leading, 6)
        }
        .padding(.vertical, 8).padding(.horizontal, 10)
        .insetRow(cornerRadius: Radii.field, hoverable: false)
        .animation(Motion.snappy, value: sleepH)
    }

    /// Collapsed: a one-line summary of today's extras. Expanded: the full water /
    /// workout / weight / notes controls (everything the old form had).
    private var detailsSummary: String {
        var bits: [String] = []
        if waterMl > 0 { bits.append("💧 " + waterFmt(waterMl)) }
        if let w = Int(workout), w > 0 { bits.append("🏃 \(w)m") }
        if let kg = Double(weight) { bits.append("⚖️ \(String(format: "%g", kg)) kg") }
        if !notes.isEmpty { bits.append("📝 note") }
        return bits.isEmpty ? "Add water, workout, weight or a note" : bits.joined(separator: "   ")
    }

    private var detailsSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            Button { withAnimation(Motion.card) { showDetails.toggle() } } label: {
                HStack(spacing: 6) {
                    Image(systemName: "chevron.right").font(.system(size: 9, weight: .bold))
                        .rotationEffect(.degrees(showDetails ? 90 : 0))
                    Text(showDetails ? "Hide details" : detailsSummary).font(.system(size: 11, weight: .medium))
                }
                .foregroundStyle(Palette.textTertiary).contentShape(Rectangle())
            }.buttonStyle(.plain)
            if showDetails {
                LabeledField("Water: \(waterFmt(waterMl))") {
                    HStack(spacing: 8) {
                        GlassSegment(options: [false, true], selection: $waterSubtract) { $0 ? "Remove" : "Add" }
                        ForEach([500, 1000, 1500], id: \.self) { ml in
                            Button((waterSubtract ? "−" : "+") + waterFmt(ml)) {
                                waterMl = max(0, waterMl + (waterSubtract ? -ml : ml))
                            }.buttonStyle(.glass).controlSize(.small)
                        }
                        if waterMl > 0 { Button { waterMl = 0 } label: { Image(systemName: "arrow.counterclockwise") }.buttonStyle(.iconPress).foregroundStyle(Palette.textTertiary) }
                        Spacer()
                    }
                }
                HStack(spacing: 12) {
                    LabeledField("Workout (min)") { TextField("optional", text: $workout).textFieldStyle(GlassFieldStyle()).frame(width: 110) }
                    LabeledField("Weight (kg)") { TextField("optional", text: $weight).textFieldStyle(GlassFieldStyle()).frame(width: 110) }
                }
                LabeledField("Notes") { TextField("How are you feeling?", text: $notes).textFieldStyle(GlassFieldStyle()) }
                HStack(spacing: 10) {
                    Button("Save details") { saveDetails() }.buttonStyle(.glass).controlSize(.small)
                    if detailsSaved {
                        Label("Saved", systemImage: "checkmark.circle.fill").font(.system(size: 12)).foregroundStyle(Palette.positive).transition(.opacity)
                    }
                }
            }
        }
        .padding(.top, 2)
    }

    // MARK: trends + correlations — logging gives something BACK
    private var recent7: [BodyLog] { logs.filter { $0.day >= PHT.daysAgo(7) } }
    private var last14: [BodyLog] { logs.filter { $0.day >= PHT.daysAgo(13) }.sorted { $0.day < $1.day } }
    private func avg(_ vals: [Double]) -> Double? { vals.isEmpty ? nil : vals.reduce(0, +) / Double(vals.count) }

    private var trendsCard: some View {
        SectionCard(title: "Trends", subtitle: "14-day shape · 7-day average", accent: Palette.teal) {
            VStack(spacing: 8) {
                trendRow("Energy", icon: "bolt.fill", color: Palette.negative,
                         series: last14.compactMap { $0.energy.map(Double.init) },
                         avg: avg(recent7.compactMap { $0.energy.map(Double.init) }), unit: "/5")
                trendRow("Mood", icon: "face.smiling", color: Palette.violet,
                         series: last14.compactMap { $0.mood.map(Double.init) },
                         avg: avg(recent7.compactMap { $0.mood.map(Double.init) }), unit: "/5")
                trendRow("Sleep", icon: "bed.double.fill", color: Palette.indigo,
                         series: last14.compactMap(\.sleepHours),
                         avg: avg(recent7.compactMap(\.sleepHours)), unit: "h")
            }
            if let insight = moodMoney {
                Label(insight, systemImage: "sparkles").font(.system(size: 12)).foregroundStyle(Palette.textSecondary)
                    .padding(.top, 6).fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    /// One metric, one line: icon + label, the 14-day sparkline, the 7-day average.
    private func trendRow(_ label: String, icon: String, color: Color, series: [Double], avg: Double?, unit: String) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon).font(.system(size: 12, weight: .bold)).foregroundStyle(color)
                .frame(width: 26, height: 26)
                .background(color.opacity(0.14), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            Text(label).font(.system(size: 13, weight: .medium)).foregroundStyle(Palette.textPrimary)
            Spacer()
            if series.count >= 2 {
                Sparkline(values: series, color: color).frame(width: 150, height: 28)
            } else {
                Text("A few more days and a line appears").font(.system(size: 10)).foregroundStyle(Palette.textTertiary)
            }
            HStack(alignment: .firstTextBaseline, spacing: 1) {
                Text(avg.map { String(format: "%.1f", $0) } ?? "—")
                    .font(.system(size: 16, weight: .semibold, design: .rounded)).monospacedDigit()
                    .foregroundStyle(avg == nil ? Palette.textTertiary : Palette.textPrimary)
                Text(unit).font(.system(size: 10)).foregroundStyle(Palette.textTertiary)
            }
            .frame(width: 56, alignment: .trailing)
        }
        .padding(.vertical, 8).padding(.horizontal, 10)
        .insetRow(cornerRadius: Radii.field, hoverable: false)
    }

    // MARK: recent check-ins — a compact grid, not a wall
    private var recentCard: some View {
        SectionCard(title: "Recent check-ins", subtitle: logs.isEmpty ? nil : "\(logs.count) total", accent: Palette.violet) {
            if logs.isEmpty {
                EmptyStateCard(icon: "heart.text.square", title: "No check-ins yet",
                               message: "Tap the scales above — your first check-in takes five seconds, and the trends build from there.")
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 10)], spacing: 10) {
                    ForEach(logs) { recentCell($0) }
                }
            }
        }
    }

    private func recentCell(_ l: BodyLog) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(l.day, format: .dateTime.weekday(.abbreviated).month().day())
                .font(.system(size: 11, weight: .semibold)).foregroundStyle(Palette.textSecondary)
            HStack(spacing: 8) {
                if let e = l.energy { Text("⚡️\(e)") }
                if let m = l.mood { Text("🙂\(m)") }
                if let s = l.sleepHours { Text("😴\(String(format: "%g", s))h") }
            }
            .font(.system(size: 12)).foregroundStyle(Palette.textPrimary)
            let extras = extrasLine(l)
            if !extras.isEmpty {
                Text(extras).font(.system(size: 10)).foregroundStyle(Palette.textTertiary).lineLimit(1)
            }
        }
        .padding(11)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .insetRow(cornerRadius: Radii.field, hoverable: false)
    }

    private func extrasLine(_ l: BodyLog) -> String {
        var bits: [String] = []
        if let ml = (l.waterMl ?? l.waterCups.map { $0 * 250 }), ml > 0 { bits.append("💧" + waterFmt(ml)) }
        if let wo = l.workoutMinutes, wo > 0 { bits.append("🏃\(wo)m") }
        if let wt = l.weightKg { bits.append("⚖️\(String(format: "%g", wt))") }
        return bits.joined(separator: " · ")
    }

    /// mood × money: do you spend more on low- or good-mood days?
    private var moodMoney: String? {
        let withMood = logs.filter { $0.mood != nil }
        guard withMood.count >= 6 else { return nil }
        func daySpend(_ d: Date) -> Double {
            let key = PHT.dayKey(d)
            return spends.filter { PHT.dayKey($0.spentAt) == key }.reduce(0) { $0 + $1.amountBase }
        }
        let low = withMood.filter { $0.mood! <= 2 }.map { daySpend($0.day) }
        let high = withMood.filter { $0.mood! >= 4 }.map { daySpend($0.day) }
        guard !low.isEmpty, !high.isEmpty, let lowAvg = avg(low), let highAvg = avg(high), lowAvg + highAvg > 0 else { return nil }
        let base = "PHP"
        let lo = CurrencyFormat.string(lowAvg, base, compact: true), hi = CurrencyFormat.string(highAvg, base, compact: true)
        if lowAvg > highAvg * 1.25 { return "You tend to spend more on low-mood days (~\(lo)/day vs \(hi) on good days)." }
        if highAvg > lowAvg * 1.25 { return "You tend to spend more on good-mood days (~\(hi)/day vs \(lo) on low days)." }
        return "Your spending stays fairly steady across moods."
    }

    // MARK: saving — same upsert-today pattern as before, split so one tap persists instantly
    private func upsertToday() -> BodyLog {
        let day = PHT.startOfDay()
        if let l = logs.first(where: { PHT.calendar.isDate($0.day, inSameDayAs: day) }) { return l }
        let l = BodyLog(day: day); context.insert(l); return l
    }

    /// Tap-scale save: writes only what's been chosen, never clobbers the rest of the log.
    private func saveScales() {
        let log = upsertToday()
        if let e = energy { log.energy = e }
        if let m = mood { log.mood = m }
        if let s = sleepH { log.sleepHours = s }
        log.updatedAt = .now; log.dirty = true; try? context.save()
    }

    private func saveDetails() {
        let log = upsertToday()
        log.waterMl = waterMl > 0 ? waterMl : nil
        log.workoutMinutes = Int(workout)
        log.weightKg = Double(weight)
        log.notes = notes.isEmpty ? nil : notes
        log.updatedAt = .now; log.dirty = true; try? context.save()
        withAnimation { detailsSaved = true }
        Task { try? await Task.sleep(nanoseconds: 1_800_000_000); withAnimation { detailsSaved = false } }
    }
}

/// Five tappable steps (1–5) — the whole check-in interaction. Filled up to the
/// current value, hover brightens the candidate, a tap commits and saves.
private struct TapScale: View {
    var value: Int?
    var color: Color
    var onTap: (Int) -> Void
    @State private var hover: Int?

    var body: some View {
        HStack(spacing: 5) {
            ForEach(1...5, id: \.self) { i in
                let filled = (value ?? 0) >= i
                Button { onTap(i) } label: {
                    RoundedRectangle(cornerRadius: 7, style: .continuous)
                        .fill(filled ? AnyShapeStyle(color.opacity(i == value ? 0.95 : 0.55)) : AnyShapeStyle(hover == i ? Palette.wellFillHover : Palette.wellFill))
                        .overlay(RoundedRectangle(cornerRadius: 7, style: .continuous)
                            .strokeBorder(filled ? color.opacity(0.45) : Palette.wellStroke, lineWidth: 0.8))
                        .frame(width: 32, height: 26)
                        .overlay(Text("\(i)").font(.system(size: 11, weight: .bold, design: .rounded))
                            .foregroundStyle(filled ? .white : Palette.textTertiary))
                }
                .buttonStyle(.cardPress)
                .onHover { h in hover = h ? i : (hover == i ? nil : hover) }
            }
        }
    }
}

// MARK: - Letters

struct LettersView: View {
    @Environment(\.modelContext) private var context
    @Environment(UndoCenter.self) private var undo
    @Query(filter: #Predicate<Letter> { $0.deletedAt == nil }, sort: \Letter.createdAt, order: .reverse) private var letters: [Letter]
    // Persisted questions — they LIVE until answered or dismissed, never regenerated on app open.
    @Query(filter: #Predicate<JournalPrompt> { $0.status == "open" }, sort: \JournalPrompt.createdAt, order: .reverse) private var openPromptRows: [JournalPrompt]
    @State private var ai = AIManager()
    @State private var activeEntry: JournalEntryPrompt?   // item-driven sheet: carries the exact prompt
    @State private var reading: Letter?
    @State private var writing = false
    @State private var busyAnalyze = false
    @State private var loadingPrompts = false
    @State private var searchQuery = ""
    @State private var refillExhausted = false   // local model produced no NEW question last try — wait for a slot to open
    private let promptTarget = 5                  // always keep this many open questions ahead so journaling never stalls
    @State private var searchDate: Date?
    @State private var showCalendar = false
    @State private var showStreak = false
    @State private var selectedDay: JournalDayGroup?
    @State private var mindMoney: [String] = []
    @State private var loadingMM = false

    private func write(_ kind: String) {
        writing = true
        Task { _ = await Brain.generateLetter(context, ai: ai, kind: kind); writing = false }
    }

    private var cal: Calendar { PHT.calendar }

    private var filteredLetters: [Letter] {
        let q = searchQuery.trimmingCharacters(in: .whitespaces).lowercased()
        return letters.filter { l in
            let textOK = q.isEmpty || l.title.lowercased().contains(q) || l.body.lowercased().contains(q)
                || l.themes.joined(separator: " ").lowercased().contains(q)
            let dateOK = searchDate.map { cal.isDate(l.createdAt, inSameDayAs: $0) } ?? true
            return textOK && dateOK
        }
    }
    /// Entries grouped into ONE card per day (pinned days float up), newest first.
    private var groupedDays: [(day: Date, entries: [Letter])] {
        let dict = Dictionary(grouping: filteredLetters) { cal.startOfDay(for: $0.createdAt) }
        return dict.keys.sorted(by: >).map { d in
            (day: d, entries: dict[d]!.sorted { ($0.pinned ? 1 : 0, $0.createdAt) > ($1.pinned ? 1 : 0, $1.createdAt) })
        }
    }
    private func dayTitle(_ d: Date) -> String {
        if cal.isDateInToday(d) { return "Today" }
        if cal.isDateInYesterday(d) { return "Yesterday" }
        return d.formatted(.dateTime.weekday(.wide))
    }
    private func dayDate(_ d: Date) -> String { d.formatted(.dateTime.month().day().year()) }

    private var wroteToday: Bool { letters.contains { cal.isDateInToday($0.createdAt) } }
    private var entryDayKeys: Set<String> { Set(letters.map { JournalGame.dayKey($0.createdAt) }) }
    private var entryCounts: [String: Int] { Dictionary(letters.map { (JournalGame.dayKey($0.createdAt), 1) }, uniquingKeysWith: +) }
    private var firstEntryDate: Date? { letters.map(\.createdAt).min() }
    /// Streak counts entry days AND coin-frozen / recovered days.
    private var journalStreak: Int { JournalGame.streak(entryDays: entryDayKeys) }
    /// Recovery questions answered since a break was armed.
    private var recoveryProgress: Int {
        guard let started = JournalGame.recoveryStartedAt else { return 0 }
        return letters.filter { $0.createdAt >= started }.count
    }
    /// Arm a break + auto-restore once enough recovery questions are answered.
    private func reconcileStreak() {
        JournalGame.armRecoveryIfNeeded(entryDays: entryDayKeys)
        let req = JournalGame.recoveryRequired(missedDays: JournalGame.recoveryMissed.count)
        if JournalGame.recoveryStartedAt != nil, req > 0, recoveryProgress >= req { JournalGame.completeRecovery() }
    }

    var body: some View {
        Page("Journal", subtitle: "Your private space — every answer teaches it what to ask next.", toolbar: AnyView(
            HStack(spacing: 10) {
                // Round streak chip (journal-only, up by the bell) — tap for the streak menu.
                Button { showStreak = true } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "flame.fill").font(.system(size: 12))
                        Text("\(journalStreak)").font(.system(size: 12, weight: .bold, design: .rounded))
                    }
                    .foregroundStyle(journalStreak > 0 ? Palette.warning : Palette.textTertiary)
                    .padding(.horizontal, 10).frame(height: 30)
                }.buttonStyle(.plain).background(Palette.hairline, in: Capsule())
                    .overlay(Capsule().strokeBorder((journalStreak > 0 ? Palette.warning : .white).opacity(0.2), lineWidth: 0.8))
                Menu {
                    Button("This month") { write("month") }
                    Button("This week") { write("week") }
                    Button("This year") { write("year") }
                } label: { Label(writing ? "Writing…" : "AI reflection", systemImage: "sparkles") }
                    .menuStyle(.borderlessButton).disabled(writing || !ai.isReady)
                Button { activeEntry = JournalEntryPrompt(text: "") } label: { Image(systemName: "plus") }.buttonStyle(.glass)
            })) {
            // Your open questions — saved until you answer or dismiss them. New ones are born from
            // what you write (follow-ups) or on demand; never random, never re-pasted daily.
            SectionCard(title: "Open questions",
                        subtitle: openPromptRows.isEmpty
                            ? (!ai.isReady ? "Add a local model or AI key in Settings — or just write." : "All answered. Ask for new ones, or just write.")
                            : "Saved until you answer them — answering may spark a follow-up",
                        accent: Palette.indigo,
                        trailing: AnyView(
                            Button { loadAIPrompts(force: true) } label: {
                                Label(loadingPrompts ? "Thinking…" : "New questions", systemImage: "sparkles").font(.system(size: 11))
                            }.buttonStyle(.plain).foregroundStyle(Palette.indigo).disabled(loadingPrompts || !ai.isReady))) {
                VStack(spacing: 8) {
                    ForEach(openPromptRows) { p in promptRow(p) }
                    Button { activeEntry = JournalEntryPrompt(text: "") } label: {
                        Label("Just write — no prompt", systemImage: "pencil").frame(maxWidth: .infinity)
                    }.buttonStyle(.glass).controlSize(.small)
                }
                .animation(Motion.snappy, value: openPromptRows.map(\.id))
            }

            // Mind × money — patterns connecting how you felt and how money moved. Only shows
            // once there's enough mood-tagged writing to find something REAL.
            if !mindMoney.isEmpty || loadingMM {
                SectionCard(title: "Mind × money", subtitle: "How your mood and your money move together", accent: Palette.teal,
                            trailing: AnyView(
                                Button { refreshMindMoney(force: true) } label: {
                                    Label(loadingMM ? "Reading…" : "Refresh", systemImage: "arrow.triangle.2.circlepath").font(.system(size: 11))
                                }.buttonStyle(.plain).foregroundStyle(Palette.teal).disabled(loadingMM || !ai.isReady))) {
                    VStack(alignment: .leading, spacing: 8) {
                        if mindMoney.isEmpty {
                            Text("Reading the last eight weeks…").font(.system(size: 12)).foregroundStyle(Palette.textTertiary)
                        }
                        ForEach(mindMoney, id: \.self) { line in
                            HStack(alignment: .top, spacing: 9) {
                                Image(systemName: "waveform.path.ecg").font(.system(size: 11, weight: .semibold)).foregroundStyle(Palette.teal).padding(.top, 2)
                                Text(line).font(.system(size: 12)).foregroundStyle(Palette.textSecondary)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }
                }
            }

            if !letters.isEmpty {
                HStack(spacing: 10) {
                    SearchField(text: $searchQuery, placeholder: "Search your journal")
                    Button { showCalendar = true } label: {
                        Label(searchDate.map { $0.formatted(.dateTime.month().day()) } ?? "Any day", systemImage: "calendar")
                            .font(.system(size: 12))
                    }.buttonStyle(.glass)
                        .popover(isPresented: $showCalendar) {
                            VStack(spacing: 10) {
                                MonthCalendar(entryCounts: entryCounts, selected: searchDate,
                                              onSelect: { searchDate = $0; showCalendar = false })
                                Button("Show all days") { searchDate = nil; showCalendar = false }.buttonStyle(.glass).controlSize(.small)
                            }.padding(14).frame(width: 268)
                        }
                    if searchDate != nil {
                        Button { searchDate = nil } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(Palette.textTertiary) }.buttonStyle(.iconPress)
                    }
                }
            }
            if letters.isEmpty {
                Text("Nothing written yet — answer a prompt above, or just write.").font(.system(size: 13)).foregroundStyle(Palette.textTertiary).frame(maxWidth: .infinity, minHeight: 60)
            } else if groupedDays.isEmpty {
                Text(searchDate != nil ? "No entries on \(searchDate!.formatted(.dateTime.month().day().year()))." : "No entries match “\(searchQuery)”.")
                    .font(.system(size: 13)).foregroundStyle(Palette.textTertiary).frame(maxWidth: .infinity, minHeight: 60)
            }
            let cols = [GridItem(.adaptive(minimum: 170), spacing: 12)]
            LazyVGrid(columns: cols, spacing: 12) {
                ForEach(groupedDays, id: \.day) { g in
                    Button { selectedDay = JournalDayGroup(id: g.day, entries: g.entries) } label: { dayMiniCard(g) }
                        .buttonStyle(.cardPress)
                }
            }
        }
        .task {
            JournalGame.reconcileCoins(entries: letters.map { ($0.id, $0.createdAt) })   // backfill past entries
            reconcileStreak()
            // Mind × money: show what's cached instantly; quietly regenerate when stale.
            mindMoney = Brain.mindMoneyLines(context)
            if mindMoney.isEmpty, ai.isReady, letters.filter({ $0.sentiment != nil }).count >= 4 {
                refreshMindMoney(force: false)
            }
        }
        .onChange(of: openPromptRows.count, initial: true) { old, count in
            // Always keep a buffer of questions ahead. The moment you answer one (count drops), top
            // it back up in the background so you can keep journaling without waiting for the model.
            if count < old { refillExhausted = false }   // a slot opened → new questions are likely possible again
            if count < promptTarget, ai.isReady, !loadingPrompts, !refillExhausted { loadAIPrompts() }
        }
        .sheet(isPresented: $showStreak) { StreakMenu(entryCounts: entryCounts, firstEntry: firstEntryDate, recoveryProgress: recoveryProgress) }
        .sheet(item: $selectedDay) { day in journalDaySheet(day) }
        .sheet(item: $activeEntry) { AddLetterSheet(seedPrompt: $0.text, promptId: $0.promptId) }
        .sheet(item: $reading) { l in
            VStack(alignment: .leading, spacing: 0) {
                Text(l.title).font(Typo.title(20)).foregroundStyle(Palette.textPrimary).padding(.horizontal, 22).padding(.top, 22)
                if l.sentiment != nil || !l.themes.isEmpty {
                    HStack(spacing: 6) {
                        if let s = l.sentiment {
                            Label(s, systemImage: "sparkle").font(.system(size: 11, weight: .semibold)).foregroundStyle(Palette.indigo)
                                .padding(.horizontal, 8).padding(.vertical, 3).background(Palette.indigo.opacity(0.16), in: Capsule())
                        }
                        ForEach(l.themes, id: \.self) { t in
                            Text(t).font(.system(size: 11)).foregroundStyle(Palette.textSecondary)
                                .padding(.horizontal, 8).padding(.vertical, 3).background(Palette.hairline, in: Capsule())
                        }
                    }.padding(.horizontal, 22).padding(.top, 8)
                }
                ScrollView { Text(l.body).font(.system(size: 14)).foregroundStyle(Palette.textSecondary).frame(maxWidth: .infinity, alignment: .leading).padding(22) }
                Divider().overlay(Palette.hairline)
                HStack {
                    Button { analyze(l) } label: {
                        Label(busyAnalyze ? "Reflecting…" : (l.sentiment == nil ? "Reflect with AI" : "Re-reflect"), systemImage: "sparkles")
                    }.buttonStyle(.glass).disabled(busyAnalyze || !ai.isReady || l.body.count < 20)
                    Spacer()
                    Button("Done") { reading = nil }.buttonStyle(.glassProminent).tint(Palette.indigo)
                }.padding(16)
            }.frame(width: 520, height: 600).flagshipSheet()
        }
    }

    /// One compact card per day, listing that day's entries (stays small as days accumulate).
    /// Small, fully-clickable square card for a day — keeps the page compact as days pile up.
    private func dayMiniCard(_ g: (day: Date, entries: [Letter])) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 5) {
                Text(dayTitle(g.day)).font(.system(size: 13, weight: .bold)).foregroundStyle(Palette.textPrimary).lineLimit(1)
                if g.entries.contains(where: { $0.pinned }) { Image(systemName: "pin.fill").font(.system(size: 8)).foregroundStyle(Palette.indigo) }
                Spacer()
            }
            Text(dayDate(g.day)).font(.system(size: 9)).foregroundStyle(Palette.textTertiary)
            Text(g.entries.first?.body ?? "").font(.system(size: 11)).foregroundStyle(Palette.textSecondary)
                .lineLimit(3).multilineTextAlignment(.leading)
            Spacer(minLength: 2)
            HStack(spacing: 5) {
                Text("\(g.entries.count) \(g.entries.count == 1 ? "entry" : "entries")").font(.system(size: 9, weight: .semibold)).foregroundStyle(Palette.indigo)
                if let s = g.entries.first?.sentiment { Text("· \(s)").font(.system(size: 9)).foregroundStyle(Palette.textTertiary).lineLimit(1) }
                Spacer()
            }
        }
        .padding(13).frame(minHeight: 122, alignment: .topLeading)
        .glassCard(cornerRadius: Radii.tile, interactive: true)
        .contentShape(Rectangle())
    }

    /// A day's entries (opened by tapping a day card) — each row opens the full entry.
    private func journalDaySheet(_ day: JournalDayGroup) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 1) {
                    Text(dayTitle(day.id)).font(Typo.title(18)).foregroundStyle(Palette.textPrimary)
                    Text(dayDate(day.id)).font(.system(size: 11)).foregroundStyle(Palette.textTertiary)
                }
                Spacer()
                Button { selectedDay = nil } label: { Image(systemName: "xmark.circle.fill").font(.system(size: 20)).foregroundStyle(Palette.textTertiary) }
                    .buttonStyle(.iconPress).keyboardShortcut(.cancelAction)
            }.padding(16)
            Divider().overlay(Palette.hairline)
            ScrollView {
                VStack(spacing: 0) {
                    ForEach(day.entries) { l in
                        Button { selectedDay = nil; reading = l } label: {
                            VStack(alignment: .leading, spacing: 3) {
                                HStack {
                                    Text(l.title).font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.textPrimary).lineLimit(2).multilineTextAlignment(.leading)
                                    Spacer()
                                    Text(l.createdAt, format: .dateTime.hour().minute()).font(.system(size: 9)).foregroundStyle(Palette.textTertiary)
                                }
                                Text(l.body).font(.system(size: 12)).foregroundStyle(Palette.textSecondary).lineLimit(3).multilineTextAlignment(.leading)
                            }.padding(.vertical, 11).contentShape(Rectangle())
                        }.buttonStyle(.plain)
                        .contextMenu {
                            Button(l.pinned ? "Unpin" : "Pin", systemImage: l.pinned ? "pin.slash" : "pin") { l.pinned.toggle(); l.dirty = true; try? context.save() }
                            Button("Delete", systemImage: "trash", role: .destructive) { undo.trashSimple(l, label: "entry", context: context); selectedDay = nil }
                        }
                        if l.id != day.entries.last?.id { Divider().overlay(Palette.hairline) }
                    }
                }.padding(.horizontal, 18)
            }
        }
        .frame(width: 520, height: 560).flagshipSheet()
    }

    private func analyze(_ l: Letter) {
        busyAnalyze = true
        Task { await Brain.analyzeJournal(context, ai: ai, letter: l); busyAnalyze = false }
    }

    private func promptIcon(_ p: JournalPrompt) -> String {
        switch p.source {
        case "followup": return "arrow.turn.down.right"
        case "project":  return "folder"
        default:         return "sparkle"
        }
    }
    private func promptBadge(_ p: JournalPrompt) -> String? {
        // When a follow-up carries the answer it grew out of, name it — so you can see
        // exactly which entry the question is about, not just "something you wrote".
        if let ex = p.sourceExcerpt?.trimmingCharacters(in: .whitespacesAndNewlines), !ex.isEmpty {
            let q = ex.count > 90 ? String(ex.prefix(90)) + "…" : ex
            return "Following up on: “\(q)”"
        }
        switch p.source {
        case "followup": return "Follow-up from something you wrote"
        case "project":  return "About a project that just closed"
        default:         return nil
        }
    }

    /// One persisted question — click to answer, ♥ to teach it your taste, ✕ to dismiss for good.
    /// Action buttons are SIBLINGS of the row button (not nested) so they never open the sheet.
    private func promptRow(_ p: JournalPrompt) -> some View {
        let liked = p.feedback == "up"
        return HStack(spacing: 10) {
            Button { activeEntry = JournalEntryPrompt(text: p.text, promptId: p.id) } label: {
                HStack(spacing: 10) {
                    Image(systemName: promptIcon(p)).font(.system(size: 13)).foregroundStyle(Palette.indigo)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(p.text).font(.system(size: 12, weight: .medium)).foregroundStyle(Palette.textPrimary).multilineTextAlignment(.leading)
                        if let badge = promptBadge(p) {
                            Text(badge).font(.system(size: 10)).foregroundStyle(Palette.textTertiary)
                        }
                    }
                    Spacer()
                    Image(systemName: "square.and.pencil").font(.system(size: 11)).foregroundStyle(Palette.textTertiary)
                }.contentShape(Rectangle())
            }.buttonStyle(.plain)
            // Taste signals: ♥ = "good question, more like this" (kept open); ✕ = "not for me" (gone).
            Button { p.feedback = liked ? nil : "up"; p.dirty = true; try? context.save() } label: {
                Image(systemName: liked ? "heart.fill" : "heart")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(liked ? Palette.acidLime : Palette.textTertiary)
                    .padding(5).background(liked ? Palette.wellFillHover : Palette.wellFill, in: Circle())
            }.buttonStyle(.iconPress).help("Good question — ask more in this spirit")
            Button { dismissPrompt(p) } label: {
                Image(systemName: "xmark").font(.system(size: 9, weight: .bold)).foregroundStyle(Palette.textTertiary)
                    .padding(5).background(Palette.hairline, in: Circle())
            }.buttonStyle(.iconPress).help("Not for me — dismiss it, and the AI learns to avoid this kind")
        }
        .padding(.vertical, 7).padding(.horizontal, 10)
        .insetRow(cornerRadius: Radii.field)
        .transition(.opacity)
    }

    private func dismissPrompt(_ p: JournalPrompt) {
        p.status = "dismissed"; p.resolvedAt = .now; p.feedback = "down"; p.dirty = true
        try? context.save()
    }

    private func refreshMindMoney(force: Bool) {
        loadingMM = true
        let mgr = ai, ctx = context
        Task {
            let lines = await Brain.mindMoney(ctx, ai: mgr, force: force)
            await MainActor.run { mindMoney = lines; loadingMM = false }
        }
    }

    /// Keep the open-question well topped up to `promptTarget`, in the background, local-first, so
    /// journaling never stalls. Re-entrancy-guarded by `loadingPrompts`; over-asks to absorb dedup
    /// rejections; flags `refillExhausted` when the model returns nothing new so we don't spin.
    private func loadAIPrompts(force: Bool = false) {
        guard ai.isReady, !loadingPrompts else { return }
        let need = force ? 3 : (promptTarget - openPromptRows.count)
        guard need > 0 else { return }
        loadingPrompts = true
        let mgr = ai, ctx = context
        Task {
            let ps = await Brain.journalPrompts(ctx, ai: mgr, count: need + 2)
            await MainActor.run {
                let added = Brain.storeJournalPrompts(ctx, texts: ps, source: "ai")
                if added == 0 { refillExhausted = true }   // nothing new — wait for a slot to open before retrying
                loadingPrompts = false
            }
        }
    }
}

/// Carries the exact prompt into the writing sheet (item-driven so the right question always shows).
struct JournalEntryPrompt: Identifiable { let id = UUID(); let text: String; var promptId: UUID? = nil }

struct AddLetterSheet: View {
    var seedPrompt: String = ""
    var promptId: UUID? = nil
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @State private var body0 = ""
    @FocusState private var focused: Bool

    private var words: Int {
        body0.split(whereSeparator: \.isWhitespace).count
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // The question, set like a chapter opening — serif, roomy, pinned while you write.
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .top) {
                    Text(Date().formatted(.dateTime.weekday(.wide).month().day()))
                        .font(.system(size: 10, weight: .semibold)).kerning(1.2).textCase(.uppercase)
                        .foregroundStyle(Palette.textTertiary)
                    Spacer()
                    Button { dismiss() } label: { Image(systemName: "xmark.circle.fill").font(.system(size: 20)).foregroundStyle(Palette.textTertiary) }
                        .buttonStyle(.iconPress).keyboardShortcut(.cancelAction).help("Close (Esc)")
                }
                HStack(alignment: .top, spacing: 12) {
                    if !seedPrompt.isEmpty {
                        Capsule().fill(Palette.indigo).frame(width: 3).padding(.vertical, 3)
                    }
                    Text(seedPrompt.isEmpty ? "Whatever's on your mind." : seedPrompt)
                        .font(Typo.title(19)).foregroundStyle(Palette.textPrimary)
                        .lineSpacing(3)
                        .fixedSize(horizontal: false, vertical: true)
                }
                // The spine hugs the question's own height — without this the bar stretches
                // and drags a wall of empty space between the question and the page.
                .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.horizontal, 26).padding(.top, 20).padding(.bottom, 16)

            // The page — a quiet paper well that fills the sheet; the question never moves.
            // Placeholder paddings mirror the editor's REAL text origin (its NSTextView adds
            // a 5pt line-fragment inset) so the caret blinks exactly at the placeholder's "S".
            ZStack(alignment: .topLeading) {
                TextEditor(text: $body0)
                    .font(.system(size: 15)).lineSpacing(7).scrollContentBackground(.hidden)
                    .padding(.horizontal, 16).padding(.vertical, 14).focused($focused)
                if body0.isEmpty {
                    Text("Start writing — nobody reads this but you…")
                        .font(.system(size: 15)).italic().foregroundStyle(Palette.textTertiary)
                        .padding(.leading, 21).padding(.top, 14).allowsHitTesting(false)
                }
            }
            .insetRow(cornerRadius: Radii.tile, hoverable: false)
            .padding(.horizontal, 22)
            .onTapGesture { focused = true }   // the whole page is the click target

            // Footer — word count grows as you do; Save lights up with real content.
            HStack(spacing: 12) {
                Text(words == 0 ? "Take your time." : "\(words) word\(words == 1 ? "" : "s")")
                    .font(.system(size: 11)).monospacedDigit().foregroundStyle(Palette.textTertiary)
                    .contentTransition(.numericText())
                    .animation(Motion.snappy, value: words)
                Spacer()
                Button("Cancel") { dismiss() }.buttonStyle(.glass)
                Button("Save") { save() }.buttonStyle(.glassProminent).tint(Palette.indigo)
                    .disabled(body0.trimmingCharacters(in: .whitespaces).isEmpty).keyboardShortcut(.defaultAction)
                    .help("Save this entry (⏎)")
            }
            .padding(.horizontal, 22).padding(.vertical, 16)
        }
        .frame(width: 580, height: 620)
        .flagshipSheet()
        .onAppear { focused = true }
    }

    private func save() {
        // Title stored internally only (the prompt, or the date) — never an editable field.
        let t = seedPrompt.isEmpty ? Date().formatted(.dateTime.weekday(.wide).month().day()) : seedPrompt
        let l = Letter(title: t, body: body0, kind: "journal"); l.dirty = true
        context.insert(l)
        // Answering retires the question for good — it never comes back.
        if let pid = promptId,
           let p = ((try? context.fetch(FetchDescriptor<JournalPrompt>())) ?? []).first(where: { $0.id == pid }) {
            p.status = "answered"; p.answeredLetterId = l.id; p.resolvedAt = .now; p.dirty = true
        }
        try? context.save()
        // Award coins (idempotent across all entries — backfills any not yet paid).
        let all = ((try? context.fetch(FetchDescriptor<Letter>())) ?? []).filter { $0.deletedAt == nil }
        JournalGame.reconcileCoins(entries: all.map { ($0.id, $0.createdAt) })
        // Quiet synthesis: tag mood/themes, fold durable facts into memory, and maybe — only when
        // the entry earns it — leave ONE follow-up question for another day.
        let ctx = context, mgr = AIManager()
        if mgr.isReady {
            Task { await Brain.analyzeJournal(ctx, ai: mgr, letter: l, followUp: true) }
        }
        dismiss()
    }
}

/// A day's worth of journal entries (for the day-detail sheet).
struct JournalDayGroup: Identifiable { let id: Date; let entries: [Letter] }

/// A month calendar that reads at a glance, GitHub-style: GREEN for days you wrote (deeper green the
/// more you wrote), ICE BLUE for restored/frozen days, faint RED for days you missed inside an active
/// stretch. Bigger month-nav boxes for easy clicking.
struct MonthCalendar: View {
    let entryCounts: [String: Int]   // dayKey → number of entries
    var covered: Set<String> = []     // restored or coin-frozen days
    var firstEntry: Date? = nil       // earliest entry, so we only flag misses after you started
    var selected: Date? = nil         // highlighted day (filter mode)
    var onSelect: ((Date) -> Void)? = nil   // tappable when set (filter mode)
    @State private var month = Date()

    private var cal: Calendar { PHT.calendar }

    private func monthDays() -> [Date?] {
        let comps = cal.dateComponents([.year, .month], from: month)
        guard let first = cal.date(from: comps), let range = cal.range(of: .day, in: .month, for: first) else { return [] }
        let lead = cal.component(.weekday, from: first) - 1
        var out: [Date?] = Array(repeating: nil, count: lead)
        for day in range { out.append(cal.date(byAdding: .day, value: day - 1, to: first)) }
        return out
    }

    /// (fill, isWritten) for a day.
    private func cell(_ d: Date) -> (Color, Bool) {
        let k = JournalGame.dayKey(d)
        if let c = entryCounts[k], c > 0 {
            switch c {                                   // GitHub-style intensity
            case 1: return (Palette.positive.opacity(0.40), true)
            case 2: return (Palette.positive.opacity(0.62), true)
            case 3: return (Palette.positive.opacity(0.82), true)
            default: return (Palette.positive, true)
            }
        }
        if covered.contains(k) { return (Palette.cyan.opacity(0.55), false) }   // restored / frozen = ice
        let today = cal.startOfDay(for: Date())
        if let first = firstEntry, d >= cal.startOfDay(for: first), d < today {
            return (Palette.negative.opacity(0.22), false)                       // missed inside a stretch
        }
        return (.clear, false)
    }

    var body: some View {
        VStack(spacing: 8) {
            HStack(spacing: 8) {
                navBox("chevron.left") { month = cal.date(byAdding: .month, value: -1, to: month) ?? month }
                Spacer()
                Text(month.formatted(.dateTime.month(.wide).year())).font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.textPrimary)
                Spacer()
                navBox("chevron.right") { month = cal.date(byAdding: .month, value: 1, to: month) ?? month }
                    .opacity(cal.isDate(month, equalTo: Date(), toGranularity: .month) ? 0.35 : 1)
                    .disabled(cal.isDate(month, equalTo: Date(), toGranularity: .month))
            }
            HStack(spacing: 2) { ForEach(["S", "M", "T", "W", "T", "F", "S"], id: \.self) { Text($0).font(.system(size: 9)).foregroundStyle(Palette.textTertiary).frame(maxWidth: .infinity) } }
            let days = monthDays()
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 3), count: 7), spacing: 4) {
                ForEach(days.indices, id: \.self) { i in
                    if let d = days[i] {
                        let (fill, written) = cell(d)
                        let isSel = selected.map { cal.isDate($0, inSameDayAs: d) } ?? false
                        let tile = ZStack {
                            RoundedRectangle(cornerRadius: 6, style: .continuous).fill(fill).frame(width: 28, height: 28)
                            if isSel { RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(Palette.indigo, lineWidth: 2).frame(width: 28, height: 28) }
                            Text("\(cal.component(.day, from: d))").font(.system(size: 10, weight: written || isSel ? .bold : .regular))
                                .foregroundStyle(written ? .white : Palette.textSecondary)
                        }.frame(height: 30)
                        if let onSelect { Button { onSelect(d) } label: { tile }.buttonStyle(.plain) }
                        else { tile }
                    } else { Color.clear.frame(height: 30) }
                }
            }
            if onSelect == nil {     // legend only in the streak view
                HStack(spacing: 12) {
                    legend(Palette.positive.opacity(0.7), "wrote")
                    legend(Palette.cyan.opacity(0.55), "restored")
                    legend(Palette.negative.opacity(0.3), "missed")
                    Spacer()
                }.padding(.top, 2)
            }
        }
    }

    private func navBox(_ icon: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon).font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.textSecondary)
                .frame(width: 40, height: 30).insetRow(cornerRadius: Radii.row)
        }.buttonStyle(.iconPress)
    }
    private func legend(_ c: Color, _ label: String) -> some View {
        HStack(spacing: 4) {
            RoundedRectangle(cornerRadius: 3).fill(c).frame(width: 10, height: 10)
            Text(label).font(.system(size: 9)).foregroundStyle(Palette.textTertiary)
        }
    }
}

/// The streak menu: streak, coins, a month calendar of logged days, freeze + recovery, and a close.
struct StreakMenu: View {
    let entryCounts: [String: Int]
    let firstEntry: Date?
    let recoveryProgress: Int
    @Environment(\.dismiss) private var dismiss
    @State private var tick = 0

    private var entryDays: Set<String> { Set(entryCounts.keys) }
    private var streak: Int { JournalGame.streak(entryDays: entryDays) }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Your streak").font(Typo.title(17)).foregroundStyle(Palette.textPrimary)
                Spacer()
                Button { dismiss() } label: { Image(systemName: "xmark.circle.fill").font(.system(size: 19)).foregroundStyle(Palette.textTertiary) }.buttonStyle(.iconPress).keyboardShortcut(.cancelAction)
            }.padding(16)
            Divider().overlay(Palette.hairline)
            ScrollView {
                VStack(spacing: 14) {
                    HStack {
                        stat("flame.fill", Palette.warning, "\(streak)", "day streak")
                        Spacer()
                        stat("dollarsign.circle.fill", Palette.acidLime, "\(JournalGame.coins)", "coins")
                    }
                    if JournalGame.recoveryStartedAt != nil { recoveryCard }
                    MonthCalendar(entryCounts: entryCounts, covered: JournalGame.covered, firstEntry: firstEntry).padding(10).glassCard(cornerRadius: Radii.tile)
                    Button { _ = JournalGame.freezeToday(); tick += 1 } label: {
                        Label(JournalGame.isFrozenToday() ? "Today is frozen ✓" : "Freeze today · \(JournalGame.freezeCost) coins", systemImage: "snowflake").frame(maxWidth: .infinity)
                    }.buttonStyle(.glass).disabled(JournalGame.isFrozenToday() || JournalGame.coins < JournalGame.freezeCost)
                    Text("Coins come from answering questions — write more in a day to bank more. Spend them to freeze a day before you miss it, or to bridge a broken streak instantly.")
                        .font(.system(size: 10)).foregroundStyle(Palette.textTertiary).frame(maxWidth: .infinity, alignment: .leading)
                }.padding(16)
            }
        }
        .frame(width: 350, height: 540).flagshipSheet()
        .id(tick)
    }

    private var recoveryCard: some View {
        let missed = JournalGame.recoveryMissed.count
        let required = JournalGame.recoveryRequired(missedDays: missed)
        let done = min(recoveryProgress, required)
        let cost = missed * JournalGame.unbreakCostPerDay
        return VStack(alignment: .leading, spacing: 8) {
            Label("Streak broken — bring it back", systemImage: "exclamationmark.triangle.fill").font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.warning)
            Text("You missed \(missed) day\(missed == 1 ? "" : "s"). Answer \(required) questions to restore it — \(done)/\(required) so far.").font(.system(size: 11)).foregroundStyle(Palette.textSecondary)
            ProgressView(value: Double(done), total: Double(max(required, 1))).tint(Palette.warning)
            Button { _ = JournalGame.unbreakWithCoins(); tick += 1 } label: { Label("Bridge now · \(cost) coins", systemImage: "bolt.fill").frame(maxWidth: .infinity) }
                .buttonStyle(.glass).controlSize(.small).disabled(JournalGame.coins < cost)
        }.padding(12).background(Palette.warning.opacity(0.08), in: RoundedRectangle(cornerRadius: Radii.field, style: .continuous)).overlay(RoundedRectangle(cornerRadius: Radii.field, style: .continuous).strokeBorder(Palette.warning.opacity(0.22)))
    }

    private func stat(_ icon: String, _ color: Color, _ value: String, _ label: String) -> some View {
        HStack(spacing: 9) {
            Image(systemName: icon).font(.system(size: 24)).foregroundStyle(color)
            VStack(alignment: .leading, spacing: 0) {
                Text(value).font(.system(size: 24, weight: .bold, design: .rounded)).foregroundStyle(Palette.textPrimary)
                Text(label).font(.system(size: 10)).foregroundStyle(Palette.textTertiary)
            }
        }.frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 8).padding(.horizontal, 10).glassCard(cornerRadius: Radii.field)
    }
}

// MARK: - Faith

struct FaithView: View {
    @Environment(\.modelContext) private var context
    @Query private var prayerLogs: [PrayerLog]
    @Query private var fastLogs: [FastLog]
    @AppStorage("faith.lat") private var lat = 14.0667     // San Pablo default
    @AppStorage("faith.lng") private var lng = 121.3250
    @AppStorage("faith.method") private var method = 2
    @AppStorage("faith.notify") private var notify = false
    @AppStorage("tasbih.count") private var tasbihCount = 0
    @AppStorage("tasbih.target") private var tasbihTarget = 33
    @AppStorage("qada.prayers") private var qadaPrayers = 0
    @AppStorage("qada.fasts") private var qadaFasts = 0
    @State private var times: PrayerTimes?
    @State private var loading = false
    @State private var fromCache = false
    @State private var failed = false
    @State private var editingLoc = false
    @State private var latStr = ""
    @State private var lngStr = ""
    @State private var notifs = NotificationManager()

    private var bearing: Double { FaithService.qiblaBearing(lat: lat, lng: lng) }
    private let ramadan = FaithService.isRamadan()

    // MARK: prayer / fasting state
    private var todayKey: String { PHT.dayKey() }
    private func prayed(_ name: String) -> Bool { prayerLogs.contains { $0.prayer == name && $0.id.hasSuffix("|\(todayKey)") } }
    private var prayedCount: Int { obligatoryPrayers.filter { prayed($0) }.count }
    /// "HH:mm" → a Date today (PHT), for finding the prayer window we're inside.
    private func timeToday(_ hhmm: String) -> Date? {
        let p = hhmm.split(separator: ":")
        guard p.count == 2, let h = Int(p[0]), let m = Int(p[1]) else { return nil }
        var c = PHT.calendar.dateComponents([.year, .month, .day], from: .now)
        c.hour = h; c.minute = m
        return PHT.calendar.date(from: c)
    }
    /// The obligatory prayer whose window we're currently in (nil before Fajr, or offline).
    private var currentPrayer: String? {
        guard let t = times else { return nil }
        var current: String?
        for (name, s) in [("Fajr", t.fajr), ("Dhuhr", t.dhuhr), ("Asr", t.asr), ("Maghrib", t.maghrib), ("Isha", t.isha)] {
            if let d = timeToday(s), d <= Date() { current = name }
        }
        return current
    }
    private func toggle(_ name: String) {
        let id = "\(name)|\(todayKey)"
        if let e = prayerLogs.first(where: { $0.id == id }) { context.delete(e) }
        else { context.insert(PrayerLog(prayer: name, day: .now)) }
        try? context.save()
    }
    private func allFive(_ day: Date) -> Bool {
        let key = PHT.dayKey(day)
        let logged = Set(prayerLogs.filter { $0.id.hasSuffix("|\(key)") }.map { $0.prayer })
        return obligatoryPrayers.allSatisfy { logged.contains($0) }
    }
    private var streak: Int {
        var n = 0; var d = PHT.startOfDay()
        if !allFive(d) { d = PHT.calendar.date(byAdding: .day, value: -1, to: d) ?? d }  // don't penalize an in-progress today
        while allFive(d), n < 400 { n += 1; d = PHT.calendar.date(byAdding: .day, value: -1, to: d) ?? d }
        return n
    }
    private var fastedToday: Bool { fastLogs.first { $0.id == todayKey }?.fasted ?? false }
    private var fastedThisMonth: Int { fastLogs.filter { $0.fasted && $0.day >= PHT.startOfMonth() }.count }
    private func toggleFast() {
        if let e = fastLogs.first(where: { $0.id == todayKey }) { e.fasted.toggle(); e.dirty = true }
        else { context.insert(FastLog(day: .now, fasted: true)) }
        try? context.save()
    }

    var body: some View {
        Page("Faith", subtitle: FaithService.hijriToday() + (ramadan ? " · Ramadan Mubarak 🌙" : "")) {
            if ramadan, let t = times { ramadanCard(t) }
            verseCard
            HStack(alignment: .top, spacing: 16) {
                prayersCard.frame(maxWidth: .infinity)
                qiblaCard.frame(width: 240)
            }
            HStack(alignment: .top, spacing: 16) {
                sunnahCard.frame(maxWidth: .infinity)
                tasbihCard.frame(width: 240)
            }
            HStack(alignment: .top, spacing: 16) {
                fastingCard.frame(maxWidth: .infinity)
                qadaCard.frame(width: 240)
            }
            settingsCard
        }
        .task(id: "\(lat),\(lng),\(method),\(Int(PHT.startOfDay().timeIntervalSince1970))") { await load() }
        .task { await notifs.refreshStatus() }
    }

    // MARK: - New Faith cards (Sunnah, Tasbih, daily verse, Ramadan, Qadā)

    private var verseCard: some View {
        let v = DailyVerse.today()
        return SectionCard(title: "Verse of the day", subtitle: v.source, accent: Palette.indigo) {
            VStack(alignment: .leading, spacing: 8) {
                Text(v.arabic).font(.system(size: 22, weight: .medium)).foregroundStyle(Palette.textPrimary)
                    .frame(maxWidth: .infinity, alignment: .trailing).environment(\.layoutDirection, .rightToLeft)
                Text(v.translation).font(Typo.title(15)).foregroundStyle(Palette.textSecondary)
            }
        }
    }

    private var sunnahCard: some View {
        SectionCard(title: "Sunnah & Nafl", subtitle: "Voluntary prayers", accent: Palette.violet) {
            VStack(spacing: 6) {
                ForEach(SunnahPrayer.allCases) { p in
                    let done = prayed(p.rawValue)
                    Button { toggle(p.rawValue) } label: {
                        HStack(spacing: 10) {
                            Image(systemName: done ? "checkmark.circle.fill" : "circle")
                                .font(.system(size: 17)).foregroundStyle(done ? Palette.positive : Palette.textTertiary)
                                .frame(width: 20)
                            Image(systemName: p.icon).font(.system(size: 11)).foregroundStyle(Palette.textTertiary).frame(width: 15)
                            Text(p.rawValue).font(.system(size: 13, weight: done ? .semibold : .medium))
                                .foregroundStyle(done ? Palette.positive : Palette.textPrimary)
                            Spacer()
                            Text(p.note).font(.system(size: 11)).foregroundStyle(Palette.textTertiary)
                        }
                        .padding(.vertical, 8).padding(.horizontal, 11)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .insetRow(cornerRadius: Radii.field)
                }
            }
        }
    }

    private var tasbihCard: some View {
        SectionCard(title: "Tasbih", subtitle: "\(tasbihCount) / \(tasbihTarget)", accent: Palette.teal) {
            VStack(spacing: 10) {
                Button {
                    tasbihCount += 1
                    if tasbihCount >= tasbihTarget { /* keep showing the completed count until reset */ }
                } label: {
                    Text("\(tasbihCount)")
                        .font(.system(size: 34, weight: .bold, design: .rounded)).foregroundStyle(Palette.teal)
                        .frame(maxWidth: .infinity, minHeight: 70)
                        .background(Palette.teal.opacity(tasbihCount >= tasbihTarget ? 0.22 : 0.12), in: RoundedRectangle(cornerRadius: Radii.tile, style: .continuous))
                }.buttonStyle(.cardPress)
                ProgressView(value: Double(min(tasbihCount, tasbihTarget)), total: Double(max(tasbihTarget, 1)))
                    .progressViewStyle(.linear).tint(Palette.teal)
                HStack(spacing: 8) {
                    ForEach([33, 99], id: \.self) { t in
                        Button("\(t)") { tasbihTarget = t }.buttonStyle(.glass).controlSize(.small).tint(tasbihTarget == t ? Palette.teal : nil)
                    }
                    Spacer()
                    Button { tasbihCount = 0 } label: { Label("Reset", systemImage: "arrow.counterclockwise") }
                        .buttonStyle(.glass).controlSize(.small).tint(Palette.warning)
                        .disabled(tasbihCount == 0)
                }
            }
        }
    }

    private var qadaCard: some View {
        SectionCard(title: "Qadā", subtitle: "To make up", accent: Palette.warning) {
            VStack(spacing: 6) {
                qadaRow("Prayers", $qadaPrayers)
                qadaRow("Fasts", $qadaFasts)
            }
        }
    }
    private func qadaRow(_ label: String, _ value: Binding<Int>) -> some View {
        HStack(spacing: 8) {
            Text(label).font(.system(size: 12, weight: .medium)).foregroundStyle(Palette.textPrimary)
            Spacer()
            Button { value.wrappedValue = max(0, value.wrappedValue - 1) } label: { Image(systemName: "minus.circle.fill") }
                .buttonStyle(.iconPress).foregroundStyle(value.wrappedValue == 0 ? Palette.textTertiary : Palette.positive)
            Text("\(value.wrappedValue)").font(.system(size: 15, weight: .bold, design: .rounded)).monospacedDigit()
                .foregroundStyle(Palette.textPrimary).frame(minWidth: 24)
            Button { value.wrappedValue += 1 } label: { Image(systemName: "plus.circle.fill") }
                .buttonStyle(.iconPress).foregroundStyle(Palette.warning)
        }
        .padding(.vertical, 7).padding(.horizontal, 11)
        .insetRow(cornerRadius: Radii.field, hoverable: false)
    }

    private func ramadanCard(_ t: PrayerTimes) -> some View {
        let next = RamadanClock.next(times: t)
        let lastTen = RamadanClock.lastTenNight()
        return SectionCard(title: "Ramadan", subtitle: lastTen.map { "Last 10 nights — night \($0)" } ?? "Suhoor & Iftar", accent: Palette.indigo) {
            HStack(spacing: 16) {
                if let n = next {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(n.label.uppercased()).font(.system(size: 9, weight: .semibold)).kerning(0.5).foregroundStyle(Palette.textTertiary)
                        Text(n.target, style: .timer).font(.system(size: 26, weight: .bold, design: .rounded)).foregroundStyle(Palette.indigo)
                        Text("at \(n.target.formatted(date: .omitted, time: .shortened))").font(.system(size: 11)).foregroundStyle(Palette.textTertiary)
                    }
                }
                Spacer()
                if let n = lastTen {
                    VStack(alignment: .trailing, spacing: 2) {
                        Text("LAYLAT AL-QADR?").font(.system(size: 9, weight: .semibold)).foregroundStyle(Palette.textTertiary)
                        Text("Night \(n) of 10").font(.system(size: 15, weight: .semibold)).foregroundStyle(Palette.textPrimary)
                        Text("Seek it in the odd nights").font(.system(size: 10)).foregroundStyle(Palette.textTertiary)
                    }
                }
            }
        }
    }

    private var prayersCard: some View {
        let rows: [(name: String, icon: String, time: String, obligatory: Bool)] = [
            ("Fajr", "sunrise.fill", times?.fajr ?? "—", true),
            ("Sunrise", "sun.max.fill", times?.sunrise ?? "—", false),
            ("Dhuhr", "sun.max.fill", times?.dhuhr ?? "—", true),
            ("Asr", "sun.haze.fill", times?.asr ?? "—", true),
            ("Maghrib", "sunset.fill", times?.maghrib ?? "—", true),
            ("Isha", "moon.stars.fill", times?.isha ?? "—", true),
        ]
        let subtitle = loading ? "Loading…" : (failed ? "Offline — couldn't refresh" : (fromCache ? "Last known times" : "\(prayedCount)/5 prayed today · streak \(streak)d"))
        return SectionCard(title: "Today's prayers", subtitle: subtitle, accent: Palette.violet) {
            VStack(spacing: 6) {
                ForEach(Array(rows.enumerated()), id: \.offset) { _, r in prayerRow(r) }
                if failed {
                    Button { Task { await load() } } label: { Label("Retry", systemImage: "arrow.clockwise") }
                        .buttonStyle(.glass).padding(.top, 6)
                }
            }
        }
    }

    /// One prayer, readable at a glance: filled check = prayed, outline = not yet, and a
    /// quiet accent ring + "Now" on the window we're currently inside. Whole row toggles.
    private func prayerRow(_ r: (name: String, icon: String, time: String, obligatory: Bool)) -> some View {
        let done = r.obligatory && prayed(r.name)
        let isNow = r.obligatory && currentPrayer == r.name
        return Group {
            if r.obligatory {
                Button { toggle(r.name) } label: {
                    HStack(spacing: 10) {
                        Image(systemName: done ? "checkmark.circle.fill" : "circle")
                            .font(.system(size: 17))
                            .foregroundStyle(done ? Palette.positive : (isNow ? Palette.violet : Palette.textTertiary))
                            .frame(width: 20)
                        Text(r.name).font(.system(size: 13, weight: done || isNow ? .semibold : .medium))
                            .foregroundStyle(done ? Palette.positive : Palette.textPrimary)
                        if isNow && !done { MetricChip(text: "Now", color: Palette.violet) }
                        Spacer()
                        Text(r.time).font(.system(size: 13, weight: .semibold, design: .rounded)).monospacedDigit()
                            .foregroundStyle(isNow ? Palette.textPrimary : Palette.textSecondary)
                    }
                    .padding(.vertical, 8).padding(.horizontal, 11)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .insetRow(cornerRadius: Radii.field)
                .overlay {
                    if isNow {
                        RoundedRectangle(cornerRadius: Radii.field, style: .continuous)
                            .strokeBorder(Palette.violet.opacity(0.40), lineWidth: 1)
                    }
                }
            } else {
                // Sunrise — informational, quiet, not loggable.
                HStack(spacing: 10) {
                    Image(systemName: r.icon).font(.system(size: 12)).foregroundStyle(Palette.textTertiary).frame(width: 20)
                    Text(r.name).font(.system(size: 12)).foregroundStyle(Palette.textTertiary)
                    Spacer()
                    Text(r.time).font(.system(size: 12, weight: .medium, design: .rounded)).monospacedDigit()
                        .foregroundStyle(Palette.textTertiary)
                }
                .padding(.vertical, 4).padding(.horizontal, 11)
            }
        }
    }

    private var fastingCard: some View {
        SectionCard(title: ramadan ? "Ramadan fasting" : "Fasting", subtitle: "\(fastedThisMonth) days this month", accent: Palette.teal) {
            Button { toggleFast() } label: {
                HStack(spacing: 10) {
                    Image(systemName: fastedToday ? "checkmark.circle.fill" : "circle")
                        .font(.system(size: 17)).foregroundStyle(fastedToday ? Palette.teal : Palette.textTertiary)
                        .frame(width: 20)
                    Text(fastedToday ? "Fasted today" : "Mark today as fasted")
                        .font(.system(size: 13, weight: fastedToday ? .semibold : .medium))
                        .foregroundStyle(fastedToday ? Palette.teal : Palette.textPrimary)
                    Spacer()
                    if ramadan {
                        Text("\(fastedThisMonth)/30").font(.system(size: 17, weight: .semibold, design: .rounded))
                            .monospacedDigit().foregroundStyle(Palette.teal)
                    }
                }
                .padding(.vertical, 8).padding(.horizontal, 11)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .insetRow(cornerRadius: Radii.field)
        }
    }

    /// Reminders + location in ONE quiet card at the bottom — they're configuration,
    /// not daily practice, so they share a single pane instead of two.
    private var settingsCard: some View {
        SectionCard(title: "Reminders & location", subtitle: "Coordinates drive prayer times & qibla", accent: Palette.indigo) {
            Toggle(isOn: Binding(get: { notify }, set: { on in
                notify = on
                Task {
                    if on, !notifs.authorized { _ = await notifs.requestAuthorization() }
                    if let t = times { FaithService.scheduleNotifications(t, enabled: on && notifs.authorized) }
                }
            })) {
                Text("Notify me at Fajr, Dhuhr, Asr, Maghrib & Isha").font(.system(size: 13)).foregroundStyle(Palette.textPrimary)
            }
            .toggleStyle(.switch).tint(Palette.indigo)
            if notify && !notifs.authorized {
                Text("Allow notifications in Settings → Notifications to receive these.")
                    .font(.system(size: 11)).foregroundStyle(Palette.warning)
            }
            Divider().overlay(Palette.hairline)
            if editingLoc {
                HStack(spacing: 10) {
                    LabeledField("Latitude") { TextField("14.0667", text: $latStr).textFieldStyle(GlassFieldStyle()) }
                    LabeledField("Longitude") { TextField("121.3250", text: $lngStr).textFieldStyle(GlassFieldStyle()) }
                }
                LabeledField("Method") {
                    GlassMenuPicker(selection: $method,
                                    options: FaithService.methods.map(\.id),
                                    label: { id in FaithService.methods.first(where: { $0.id == id })?.name ?? "Method \(id)" })
                }
                HStack {
                    Button("Save") { if let la = Double(latStr) { lat = la }; if let lo = Double(lngStr) { lng = lo }; editingLoc = false }
                        .buttonStyle(.glassProminent).tint(Palette.indigo)
                    Button("Cancel") { editingLoc = false }.buttonStyle(.glass)
                }
            } else {
                HStack {
                    Image(systemName: "location.fill").font(.system(size: 11)).foregroundStyle(Palette.textTertiary)
                    Text(String(format: "%.4f, %.4f", lat, lng)).font(.system(size: 13, design: .rounded)).foregroundStyle(Palette.textPrimary)
                    Text("· \(FaithService.methods.first { $0.id == method }?.name ?? "ISNA")").font(.system(size: 12)).foregroundStyle(Palette.textTertiary)
                    Spacer()
                    Button("Edit") { latStr = String(lat); lngStr = String(lng); editingLoc = true }.buttonStyle(.glass)
                }
            }
        }
    }

    private var qiblaCard: some View {
        SectionCard(title: "Qibla", subtitle: "True north", accent: Palette.indigo) {
            VStack(spacing: 10) {
                ZStack {
                    Circle().stroke(Palette.wellStroke, lineWidth: 1).frame(width: 130, height: 130)
                    ForEach([0, 90, 180, 270], id: \.self) { a in
                        Rectangle().fill(Palette.textTertiary.opacity(0.5)).frame(width: 1, height: 8)
                            .offset(y: -61).rotationEffect(.degrees(Double(a)))
                    }
                    Image(systemName: "location.north.fill")
                        .font(.system(size: 30, weight: .bold)).foregroundStyle(Palette.acidLime)
                        .rotationEffect(.degrees(bearing))
                        .shadow(color: Palette.acidLime.opacity(0.5), radius: 6)
                }
                .frame(height: 140)
                Text("\(Int(bearing.rounded()))° from north").font(.system(size: 12, weight: .medium)).foregroundStyle(Palette.textPrimary)
                Text("Point the top of your Mac north, then turn to the arrow.").font(.system(size: 10)).foregroundStyle(Palette.textTertiary).multilineTextAlignment(.center)
            }.frame(maxWidth: .infinity)
        }
    }

    private func load() async {
        loading = true; failed = false
        if let r = await FaithService.fetch(lat: lat, lng: lng, method: method) {
            times = r.times; fromCache = r.fromCache
            await notifs.refreshStatus()
            FaithService.scheduleNotifications(r.times, enabled: notify && notifs.authorized)
        } else {
            failed = true
        }
        loading = false
    }
}

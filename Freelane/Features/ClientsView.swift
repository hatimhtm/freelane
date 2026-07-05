import SwiftUI
import SwiftData

struct ClientsView: View {
    @Environment(\.modelContext) private var context
    @Query private var settings: [AppSettings]
    @Query private var rateRows: [ExchangeRate]
    @Query(filter: #Predicate<Client> { $0.deletedAt == nil }, sort: \Client.name) private var clients: [Client]
    @Query(filter: #Predicate<Project> { $0.deletedAt == nil }) private var projects: [Project]
    @Query private var rawAllocations: [PaymentAllocation]
    @Query(filter: #Predicate<Payment> { $0.deletedAt == nil }) private var livePayments: [Payment]
    @Query private var facts: [AIFact]

    // Allocations of trashed payments must never count as paid here.
    private var allocations: [PaymentAllocation] { ProjectMath.liveAllocations(rawAllocations, payments: livePayments) }

    @State private var showAdd = false
    @State private var selected: Client?
    @State private var query = ""
    @State private var sort: ClientSort = .name
    @State private var owesOnly = false

    enum ClientSort: String, CaseIterable { case name = "Name", earned = "Earned", outstanding = "Outstanding", projects = "Projects" }

    private var base: String { settings.first?.baseCurrency ?? "PHP" }
    private var rates: Rates { Rates(base: base, rates: rateRows) }
    private var active: [Client] { clients.filter { !$0.archived } }

    private func clientEarned(_ c: Client) -> Double {
        clientProjects(c).reduce(0.0) { $0 + ProjectMath.paidBase(project: $1, allocations: allocations) }
    }
    private func clientOutstanding(_ c: Client) -> Double {
        clientProjects(c).filter { $0.status == .unpaid || $0.status == .partiallyPaid }
            .reduce(0.0) { $0 + rates.toBase(ProjectMath.outstandingNative(project: $1, allocations: allocations, rates: rates), $1.currency) }
    }

    /// Filter (search + "owes me") then sort by the chosen metric.
    private var filtered: [Client] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        var out = active.filter {
            (q.isEmpty || $0.name.lowercased().contains(q) || ($0.company ?? "").lowercased().contains(q))
            && (!owesOnly || clientOutstanding($0) > 0.01)
        }
        switch sort {
        case .name: out.sort { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
        case .earned: out.sort { clientEarned($0) > clientEarned($1) }
        case .outstanding: out.sort { clientOutstanding($0) > clientOutstanding($1) }
        case .projects: out.sort { clientProjects($0).count > clientProjects($1).count }
        }
        return out
    }

    var body: some View {
        Page("Clients", subtitle: "\(active.count) clients", toolbar: AnyView(addButton)) {
            if active.isEmpty {
                EmptyStateCard(icon: "person.crop.square", title: "No clients yet",
                               message: "Add a client to keep their projects, payments, notes, and history together.")
            } else {
                HStack(spacing: 10) {
                    SearchField(text: $query, placeholder: "Search name or company")
                    GlassMenuPicker(selection: $sort, options: ClientSort.allCases, label: { $0.rawValue })
                        .frame(width: 150)
                    Button { withAnimation { owesOnly.toggle() } } label: {
                        Text("Owes me")
                            .font(.system(size: 11.5, weight: .semibold))
                            .foregroundStyle(owesOnly ? Palette.ink : Palette.textSecondary)
                            .padding(.horizontal, 12).padding(.vertical, 7)
                            .background(owesOnly ? AnyShapeStyle(Palette.warning) : AnyShapeStyle(Palette.hairline), in: Capsule())
                            .overlay(Capsule().strokeBorder(owesOnly ? Palette.warning.opacity(0.45) : Palette.wellStroke, lineWidth: 0.8))
                            .contentShape(Capsule())
                    }
                    .buttonStyle(.plain)
                }
                let list = filtered
                if list.isEmpty {
                    Text("No matches for “\(query)”.").font(.system(size: 13)).foregroundStyle(Palette.textTertiary)
                        .frame(maxWidth: .infinity, minHeight: 60)
                }
                let cols = [GridItem(.adaptive(minimum: 232), spacing: 12)]
                GlassGroup(spacing: 12) {
                    LazyVGrid(columns: cols, spacing: 12) {
                        ForEach(list) { c in
                            Button { selected = c } label: { card(c) }.buttonStyle(.cardPress)
                        }
                    }
                }
            }
        }
        .sheet(isPresented: $showAdd) { AddClientSheet() }
        .sheet(item: $selected) { c in ClientDetailSheet(client: c) }
    }

    private var addButton: some View {
        Button { showAdd = true } label: { Label("Add client", systemImage: "plus") }
            .buttonStyle(.glassProminent).tint(Palette.cyan)
    }

    private func clientProjects(_ c: Client) -> [Project] { projects.filter { $0.clientId == c.id } }

    /// Rank a learned fact by importance, so the few visible pills are the meaningful ones —
    /// relationship/role/priority outrank trivia; long values clutter, so they sink.
    private func factWeight(_ f: AIFact) -> Double {
        var w = f.confidence
        let k = f.key.lowercased()
        if k.contains("relationship") || k.contains("role") || k.contains("how_we_met") || k.contains("nickname") || k.contains("priority") || k.contains("pays") { w += 0.6 }
        if f.value.count > 22 { w -= 0.3 }
        return w
    }

    private func card(_ c: Client) -> some View {
        let ps = clientProjects(c)
        let outstanding = ps.filter { $0.status == .unpaid || $0.status == .partiallyPaid }
            .reduce(0.0) { $0 + rates.toBase(ProjectMath.outstandingNative(project: $1, allocations: allocations, rates: rates), $1.currency) }
        let earned = ps.reduce(0.0) { $0 + ProjectMath.paidBase(project: $1, allocations: allocations) }
        let fx = facts.filter { $0.subjectKind == "client" && $0.subjectId == c.id.uuidString && $0.archivedAt == nil }
        return VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                Text(String(c.name.prefix(1)).uppercased())
                    .font(.system(size: 14, weight: .bold, design: .rounded)).foregroundStyle(.white)
                    .frame(width: 34, height: 34)
                    .background(LinearGradient(colors: [Palette.cyan, Palette.azure], startPoint: .topLeading, endPoint: .bottomTrailing),
                                in: RoundedRectangle(cornerRadius: 11, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text(c.name).font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.textPrimary).lineLimit(1)
                    if let co = c.company { Text(co).font(.system(size: 10.5)).foregroundStyle(Palette.textTertiary).lineLimit(1) }
                }
                Spacer()
            }
            HStack {
                metric("Earned", CurrencyFormat.abbreviated(earned, base), Palette.positive)
                Spacer()
                metric("Outstanding", CurrencyFormat.abbreviated(outstanding, base), outstanding > 0 ? Palette.warning : Palette.textTertiary)
                Spacer()
                metric("Projects", "\(ps.count)", Palette.textSecondary)
            }
            if !fx.isEmpty {     // AI-learned info pills — most important first, not a cluttered wall
                ClientPills(facts: fx.sorted { factWeight($0) > factWeight($1) }, total: fx.count)
            }
        }
        .padding(13).frame(minHeight: 96, alignment: .topLeading)
        .glassCard(cornerRadius: Radii.card, interactive: true, morphID: "client.\(c.id)")
        .contentShape(Rectangle())
    }

    private func metric(_ label: String, _ value: String, _ color: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.system(size: 10, weight: .semibold)).textCase(.uppercase).foregroundStyle(Palette.textTertiary)
            Text(value).font(.system(size: 14, weight: .semibold, design: .rounded)).monospacedDigit().foregroundStyle(color).lineLimit(1)
        }
    }
}

/// Client info pills with a clear hierarchy: the most important fact reads as a prominent filled
/// pill, the next two are quieter, the rest collapse into "+N". Fixes the cluttered all-equal wall.
struct ClientPills: View {
    let facts: [AIFact]
    let total: Int
    var body: some View {
        let shown = Array(facts.prefix(3))
        HStack(spacing: 6) {
            ForEach(Array(shown.enumerated()), id: \.element.id) { i, f in
                let lead = i == 0
                Text(f.value)
                    .font(.system(size: lead ? 10.5 : 9.5, weight: lead ? .semibold : .medium))
                    .foregroundStyle(lead ? Palette.cyan : Palette.textSecondary)
                    .lineLimit(1).truncationMode(.tail)
                    .frame(maxWidth: lead ? 132 : 84, alignment: .leading)
                    .padding(.horizontal, lead ? 8 : 7).padding(.vertical, lead ? 3.5 : 2.5)
                    .background(lead ? Palette.cyan.opacity(0.18) : Palette.wellFillHover, in: Capsule())
            }
            if total > shown.count {
                Text("+\(total - shown.count)").font(.system(size: 9.5, weight: .medium)).foregroundStyle(Palette.textTertiary)
            }
            Spacer(minLength: 0)
        }
    }
}

/// A row of small AI-info pills (truncating), with an optional "+N".
struct FlowChips: View {
    var items: [String]
    var more: Int = 0
    var body: some View {
        HStack(spacing: 6) {
            ForEach(Array(items.enumerated()), id: \.offset) { _, t in
                Text(t).font(.system(size: 9.5, weight: .medium)).foregroundStyle(Palette.teal)
                    .lineLimit(1).truncationMode(.tail).frame(maxWidth: 110, alignment: .leading)
                    .padding(.horizontal, 7).padding(.vertical, 3).background(Palette.teal.opacity(0.14), in: Capsule())
            }
            if more > 0 { Text("+\(more)").font(.system(size: 9.5)).foregroundStyle(Palette.textTertiary) }
            Spacer(minLength: 0)
        }
    }
}

struct AddClientSheet: View {
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var company = ""
    @State private var defaultCurrency = "PHP"
    @FocusState private var nameFocused: Bool
    @Query private var settings: [AppSettings]

    var body: some View {
        SheetScaffold(title: "New client", accent: Palette.cyan, canSave: !name.isEmpty, onSave: save) {
            LabeledField("Name") { TextField("Client name", text: $name).textFieldStyle(GlassFieldStyle()).focused($nameFocused) }
            LabeledField("Company") { TextField("optional", text: $company).textFieldStyle(GlassFieldStyle()) }
            LabeledField("Default currency") {
                CurrencyMenu(selection: $defaultCurrency)
                Text("Used as the default when you log their projects & payments — you can still change it per transaction.")
                    .font(.system(size: 10.5)).foregroundStyle(Palette.textTertiary)
            }
        }
        .onAppear {
            defaultCurrency = settings.first?.baseCurrency ?? "PHP"
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { nameFocused = true }
        }
    }

    private func save() {
        let c = Client(name: name, company: company.isEmpty ? nil : company)
        c.defaultCurrency = defaultCurrency
        c.dirty = true
        context.insert(c)
        try? context.save()
        dismiss()
    }
}

struct ClientDetailSheet: View {
    let client: Client
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @Environment(UndoCenter.self) private var undo
    @State private var ai = AIManager()
    @State private var notesSaveTask: Task<Void, Never>?
    @Query private var settings: [AppSettings]
    @Query private var rateRows: [ExchangeRate]
    @Query(filter: #Predicate<Project> { $0.deletedAt == nil }) private var projects: [Project]
    @Query private var rawAllocations: [PaymentAllocation]
    @Query(filter: #Predicate<Payment> { $0.deletedAt == nil }, sort: \Payment.paidAt, order: .reverse) private var payments: [Payment]
    @Query private var steps: [PaymentStep]

    // Allocations of trashed payments must never count as paid here.
    private var allocations: [PaymentAllocation] { ProjectMath.liveAllocations(rawAllocations, payments: payments) }
    @Query(filter: #Predicate<Wallet> { $0.deletedAt == nil }) private var walletsAll: [Wallet]
    @Query private var facts: [AIFact]

    @State private var notes = ""
    @State private var busyLearn = false
    @State private var showEdit = false
    @State private var confirmDelete = false
    @State private var nudge: String?
    @State private var busyNudge = false
    @State private var rateSignals: [String] = []
    @State private var busyRate = false

    private var base: String { settings.first?.baseCurrency ?? "PHP" }
    private var rates: Rates { Rates(base: base, rates: rateRows) }
    /// Current wall-clock time where the client is — for "don't email them at 3am" awareness.
    private var clientLocalTime: String? {
        guard let id = client.timeZoneId, let tz = TimeZone(identifier: id) else { return nil }
        let f = DateFormatter(); f.timeZone = tz; f.dateFormat = "h:mm a"
        return f.string(from: Date()) + " there"
    }
    private var ps: [Project] { projects.filter { $0.clientId == client.id } }
    private var projectIds: Set<UUID> { Set(ps.map { $0.id }) }
    private var clientPayments: [Payment] { payments.filter { $0.projectId.map { projectIds.contains($0) } ?? false } }
    private var myFacts: [AIFact] {
        let id = client.id.uuidString
        return facts.filter { $0.subjectKind == "client" && $0.subjectId == id && $0.archivedAt == nil }
    }
    // MARK: Tier-5 signals (quiet channel, pattern shifts)
    private var daysSinceLastPayment: Int? {
        clientPayments.first.map { PHT.calendar.dateComponents([.day], from: $0.paidAt, to: .now).day ?? 0 }
    }
    private func landingWalletName(_ p: Payment) -> String? {
        let s = steps.filter { $0.paymentId == p.id }.sorted { $0.stepOrder < $1.stepOrder }
        guard let id = s.last?.methodId else { return nil }
        return walletsAll.first { $0.id == id }?.name
    }
    /// Computed "heads up" signals about this client.
    private var signals: [String] {
        var out: [String] = []
        if let d = daysSinceLastPayment, d >= 45, outstanding > 0 {
            out.append("Quiet \(d) days — last payment was a while ago, and money's still owed.")
        }
        // Pay-method shift: usual landing wallet vs the most recent.
        let wallets = clientPayments.compactMap { landingWalletName($0) }
        if wallets.count >= 3 {
            let counts = Dictionary(grouping: wallets, by: { $0 }).mapValues { $0.count }
            if let usual = counts.max(by: { $0.value < $1.value })?.key, let last = wallets.first, last != usual {
                out.append("Paid via \(last) last time — usually it's \(usual).")
            }
        }
        // Project-size shift: latest vs typical paid project.
        let paidAmts = ps.filter { $0.status == .paid }.map { $0.amount }
        if paidAmts.count >= 3, let latest = ps.sorted(by: { ($0.quotedAt ?? $0.createdAt) > ($1.quotedAt ?? $1.createdAt) }).first?.amount {
            let typical = paidAmts.reduce(0, +) / Double(paidAmts.count)
            if typical > 0, abs(latest - typical) / typical > 0.4 {
                out.append(latest > typical ? "Latest project is bigger than usual (~\(Int(latest / typical * 100))% of typical)." : "Latest project is smaller than usual.")
            }
        }
        return out
    }

    private var earned: Double { ps.reduce(0) { $0 + ProjectMath.paidBase(project: $1, allocations: allocations) } }
    private var outstanding: Double {
        ps.filter { $0.status == .unpaid || $0.status == .partiallyPaid }
            .reduce(0) { $0 + rates.toBase(ProjectMath.outstandingNative(project: $1, allocations: allocations, rates: rates), $1.currency) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    statStrip
                    if !signals.isEmpty || !rateSignals.isEmpty || ai.isReady { signalsCard }
                    notesCard
                    if !myFacts.isEmpty { factsCard }
                    if !clientPayments.isEmpty { historyCard }
                    projectsCard
                    if hasContactInfo { detailsCard }
                }.padding(20)
            }
        }
        .frame(width: 500, height: 640).flagshipSheet()
        .onAppear { notes = client.notes ?? "" }
        .onDisappear { learnFromNotes() }     // notes feed AI memory when you leave
        .sheet(isPresented: $showEdit) { EditClientSheet(client: client) }
        .sheet(item: Binding(get: { nudge.map { NudgeText(text: $0) } }, set: { nudge = $0?.text })) { n in
            NudgeSheet(text: n.text)
        }
    }

    private var header: some View {
        HStack(spacing: 12) {
            Text(String(client.name.prefix(1)).uppercased())
                .font(.system(size: 18, weight: .bold, design: .rounded)).foregroundStyle(.white)
                .frame(width: 46, height: 46)
                .background(LinearGradient(colors: [Palette.cyan, Palette.azure], startPoint: .topLeading, endPoint: .bottomTrailing),
                            in: RoundedRectangle(cornerRadius: 13, style: .continuous))
            VStack(alignment: .leading, spacing: 3) {
                Text(client.name).font(Typo.title(18)).foregroundStyle(Palette.textPrimary)
                if let c = client.company { Text(c).font(.system(size: 12)).foregroundStyle(Palette.textTertiary) }
                HStack(spacing: 6) {
                    if let t = clientLocalTime {
                        Label(t, systemImage: "clock").font(.system(size: 10.5, weight: .medium))
                            .foregroundStyle(Palette.cyan).labelStyle(.titleAndIcon)
                    }
                    if client.isRetainer {
                        Text("RETAINER").font(.system(size: 9.5, weight: .bold)).foregroundStyle(Palette.teal)
                            .padding(.horizontal, 6).padding(.vertical, 2).background(Palette.teal.opacity(0.16), in: Capsule())
                    }
                }
            }
            Spacer()
            Button { showEdit = true } label: { Image(systemName: "pencil").font(.system(size: 14)) }.buttonStyle(.glass)
                .help("Edit client")
                .accessibilityLabel("Edit client")
            Menu {
                Button("Delete client", systemImage: "trash", role: .destructive) { confirmDelete = true }
            } label: { Image(systemName: "ellipsis").font(.system(size: 14)) }.buttonStyle(.glass).frame(width: 30)
                .help("More actions")
                .accessibilityLabel("More actions")
            Button { dismiss() } label: { Image(systemName: "xmark.circle.fill").font(.system(size: 20)).foregroundStyle(Palette.textTertiary) }
                .buttonStyle(.iconPress).keyboardShortcut(.cancelAction)
                .help("Close (Esc)")
                .accessibilityLabel("Close")
        }.padding(18)
        .confirmationDialog("Delete \(client.name)?", isPresented: $confirmDelete) {
            Button("Delete client", role: .destructive) {
                for p in projects where p.clientId == client.id { p.clientId = nil; p.dirty = true }  // keep projects, unlink
                undo.trashSimple(client, label: "client", context: context); dismiss()
            }
            Button("Cancel", role: .cancel) {}
        } message: { Text("Their projects are kept but unlinked. The client goes to Trash — restorable for 30 days.") }
    }

    private var statStrip: some View {
        HStack(spacing: 12) {
            stat("Landed", CurrencyFormat.abbreviated(earned, base), Palette.positive)
            stat("Outstanding", CurrencyFormat.abbreviated(outstanding, base), outstanding > 0 ? Palette.warning : Palette.textTertiary)
            stat("Projects", "\(ps.count)", Palette.textSecondary)
            if outstanding > 0 {
                Button {
                    busyNudge = true
                    Task {
                        let f = myFacts.prefix(6).map { "\($0.prettyKey): \($0.value)" }
                        nudge = await Brain.draftNudge(ai, name: client.name, outstanding: CurrencyFormat.string(outstanding, base), facts: Array(f), tone: client.nudgeTone ?? "warm")
                        busyNudge = false
                    }
                } label: { Label(busyNudge ? "Drafting…" : "Draft nudge", systemImage: "paperplane") }
                    .buttonStyle(.glassProminent).tint(Palette.cyan).disabled(busyNudge)
            }
        }
    }
    private func stat(_ l: String, _ v: String, _ c: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(l).font(.system(size: 10, weight: .semibold)).textCase(.uppercase).foregroundStyle(Palette.textTertiary)
            Text(v).font(.system(size: 15, weight: .semibold, design: .rounded)).monospacedDigit().foregroundStyle(c).lineLimit(1)
        }.frame(maxWidth: .infinity, alignment: .leading).padding(12).glassCard(cornerRadius: Radii.tile)
    }

    private var signalsCard: some View {
        SectionCard(title: "Signals", subtitle: "What's worth noticing", accent: Palette.warning) {
            if signals.isEmpty && rateSignals.isEmpty {
                Text("Nothing unusual right now.").font(.system(size: 12)).foregroundStyle(Palette.textTertiary)
            }
            ForEach(signals, id: \.self) { s in
                Label(s, systemImage: "bell.badge").font(.system(size: 12.5)).foregroundStyle(Palette.textSecondary)
                    .labelStyle(.titleAndIcon)
            }
            ForEach(rateSignals, id: \.self) { s in
                Label(s, systemImage: "dollarsign.circle").font(.system(size: 12.5)).foregroundStyle(Palette.warning)
            }
            if ai.isReady {
                Button {
                    busyRate = true
                    let material = "Notes: \(client.notes ?? "none")\nProjects: " + ps.map { "\($0.title) (\(CurrencyFormat.string($0.amount, $0.currency, compact: true)), \($0.status.label))" }.joined(separator: "; ")
                    Task { rateSignals = await Brain.rateSignals(ai, name: client.name, material: material); busyRate = false }
                } label: { Label(busyRate ? "Reading…" : "Spot rate signals (AI)", systemImage: "sparkles") }
                    .buttonStyle(.glass).disabled(busyRate)
            }
        }
    }

    private var notesCard: some View {
        SectionCard(title: "Notes", subtitle: "Saved on this Mac — and quietly learned from", accent: Palette.cyan) {
            TextField("Anything about this client — how they pay, what they like…", text: $notes, axis: .vertical)
                .lineLimit(3...10).textFieldStyle(.plain).font(.system(size: 13)).foregroundStyle(Palette.textPrimary)
                .onChange(of: notes) { _, v in
                    client.notes = v; client.dirty = true
                    notesSaveTask?.cancel()   // debounce: don't write to disk on every keystroke
                    notesSaveTask = Task { try? await Task.sleep(for: .seconds(0.6)); if !Task.isCancelled { try? context.save() } }
                }
            HStack {
                Button { learnFromNotes() } label: { Label(busyLearn ? "Learning…" : "Learn from notes", systemImage: "sparkles") }
                    .buttonStyle(.glass).disabled(busyLearn || notes.trimmingCharacters(in: .whitespaces).count < 8)
                Spacer()
            }
        }
    }

    private var factsCard: some View {
        SectionCard(title: "What the AI has learned", subtitle: "\(myFacts.count) facts", accent: Palette.teal) {
            VStack(spacing: 0) {
                ForEach(myFacts) { f in
                    HStack(alignment: .top) {
                        Text(f.prettyKey).font(.system(size: 12, weight: .medium)).foregroundStyle(Palette.textSecondary).frame(width: 130, alignment: .leading)
                        Text(f.value).font(.system(size: 12)).foregroundStyle(Palette.textPrimary)
                        Spacer()
                    }.padding(.vertical, 5)
                }
            }
        }
    }

    private var historyCard: some View {
        SectionCard(title: "Payment history", subtitle: "\(clientPayments.count) payments", accent: Palette.positive) {
            LazyVStack(spacing: 0) {
                ForEach(clientPayments) { p in
                    HStack {
                        VStack(alignment: .leading, spacing: 1) {
                            Text(projects.first { $0.id == p.projectId }?.title ?? "Payment").font(.system(size: 12.5, weight: .medium)).foregroundStyle(Palette.textPrimary).lineLimit(1)
                            Text(p.paidAt, format: .dateTime.month().day().year()).font(.system(size: 10.5)).foregroundStyle(Palette.textTertiary)
                        }
                        Spacer()
                        Text(CurrencyFormat.string(p.netAmountBase ?? 0, base, compact: true)).font(.system(size: 12.5, weight: .semibold, design: .rounded)).monospacedDigit().foregroundStyle(Palette.positive)
                    }.padding(.vertical, 6)
                }
            }
        }
    }

    private var projectsCard: some View {
        SectionCard(title: "Projects", subtitle: ps.isEmpty ? "None yet" : "\(ps.count)", accent: Palette.violet) {
            if ps.isEmpty { Text("No projects yet.").font(.system(size: 12)).foregroundStyle(Palette.textTertiary) }
            else {
                LazyVStack(spacing: 0) {
                    ForEach(ps) { p in
                        HStack {
                            Text(p.title).font(.system(size: 12.5, weight: .medium)).foregroundStyle(Palette.textPrimary).lineLimit(1)
                            Spacer()
                            Text(CurrencyFormat.string(p.amount, p.currency, compact: true)).font(.system(size: 11)).monospacedDigit().foregroundStyle(Palette.textTertiary)
                            StatusBadge(text: p.status.label, color: p.status.color)
                        }.padding(.vertical, 6)
                    }
                }
            }
        }
    }

    private var hasContactInfo: Bool {
        [client.email, client.phone, client.address, client.iban, client.swift, client.taxId].contains { ($0?.isEmpty == false) }
    }
    private var detailsCard: some View {
        let info: [(String, String?)] = [
            ("Email", client.email), ("Phone", client.phone), ("Address", client.address),
            ("City", client.city), ("Country", client.country), ("Tax ID", client.taxId),
            ("ICE", client.ice), ("RC", client.rc), ("Bank", client.bankName),
            ("Account", client.bankAccount), ("IBAN", client.iban), ("SWIFT", client.swift),
            ("Currency", client.defaultCurrency),
        ].filter { ($0.1?.isEmpty == false) }
        return SectionCard(title: "Details", accent: Palette.indigo) {
            ForEach(info, id: \.0) { row in
                HStack(alignment: .top) {
                    Text(row.0).font(.system(size: 12, weight: .medium)).foregroundStyle(Palette.textSecondary).frame(width: 84, alignment: .leading)
                    Text(row.1 ?? "").font(.system(size: 12)).foregroundStyle(Palette.textPrimary).textSelection(.enabled)
                    Spacer()
                }.padding(.vertical, 3)
            }
        }
    }

    private func learnFromNotes() {
        let n = notes.trimmingCharacters(in: .whitespaces)
        guard n.count >= 8, !busyLearn else { return }
        busyLearn = true
        let id = client.id.uuidString, name = client.name
        Task { await Brain.extractClientFacts(context, ai: ai, clientId: id, name: name, notes: n); busyLearn = false }
    }
}

private struct NudgeText: Identifiable { let id = UUID(); let text: String }

struct NudgeSheet: View {
    let text: String
    @Environment(\.dismiss) private var dismiss
    @State private var copied = false
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack { Image(systemName: "paperplane.fill").foregroundStyle(Palette.cyan); Text("Draft nudge").font(Typo.title(16)).foregroundStyle(Palette.textPrimary); Spacer() }
            Text(text).font(.system(size: 13)).foregroundStyle(Palette.textPrimary).textSelection(.enabled)
                .padding(14).frame(maxWidth: .infinity, alignment: .leading).glassCard(cornerRadius: Radii.tile)
            HStack {
                Button { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(text, forType: .string); copied = true } label: {
                    Label(copied ? "Copied" : "Copy", systemImage: copied ? "checkmark" : "doc.on.doc")
                }.buttonStyle(.glassProminent).tint(Palette.cyan)
                Spacer()
                Button("Close") { dismiss() }.buttonStyle(.glass)
            }
        }
        .padding(20).frame(width: 440).flagshipSheet()
    }
}

struct EditClientSheet: View {
    let client: Client
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""; @State private var company = ""; @State private var email = ""
    @State private var phone = ""; @State private var address = ""; @State private var city = ""
    @State private var country = ""; @State private var iban = ""; @State private var swift = ""
    @State private var defaultCurrency = ""
    @State private var timeZoneId = ""; @State private var nudgeTone = "warm"
    @State private var isRetainer = false; @State private var retainerBase = 0.0
    @FocusState private var nameFocused: Bool

    /// Common client time zones — keeps the picker short and readable.
    private let zones = ["", "America/Los_Angeles", "America/Denver", "America/Chicago", "America/New_York",
                         "America/Sao_Paulo", "Europe/London", "Europe/Paris", "Africa/Casablanca",
                         "Asia/Dubai", "Asia/Kolkata", "Asia/Singapore", "Asia/Manila", "Asia/Tokyo", "Australia/Sydney"]

    var body: some View {
        SheetScaffold(title: "Edit client", accent: Palette.cyan, canSave: !name.isEmpty, onSave: save) {
            LabeledField("Name") { TextField("Name", text: $name).textFieldStyle(GlassFieldStyle()).focused($nameFocused) }
            LabeledField("Company") { TextField("optional", text: $company).textFieldStyle(GlassFieldStyle()) }
            HStack(spacing: 10) {
                LabeledField("Email") { TextField("optional", text: $email).textFieldStyle(GlassFieldStyle()) }
                LabeledField("Phone") { TextField("optional", text: $phone).textFieldStyle(GlassFieldStyle()) }
            }
            LabeledField("Address") { TextField("optional", text: $address).textFieldStyle(GlassFieldStyle()) }
            HStack(spacing: 10) {
                LabeledField("City") { TextField("optional", text: $city).textFieldStyle(GlassFieldStyle()) }
                LabeledField("Country") { TextField("optional", text: $country).textFieldStyle(GlassFieldStyle()) }
            }
            HStack(spacing: 10) {
                LabeledField("IBAN") { TextField("optional", text: $iban).textFieldStyle(GlassFieldStyle()) }
                LabeledField("SWIFT") { TextField("optional", text: $swift).textFieldStyle(GlassFieldStyle()) }
            }
            LabeledField("Default currency") { CurrencyMenu(selection: Binding(get: { defaultCurrency.isEmpty ? "PHP" : defaultCurrency }, set: { defaultCurrency = $0 })) }
            HStack(spacing: 10) {
                LabeledField("Time zone") {
                    GlassMenuPicker(selection: $timeZoneId, options: zones,
                                    label: { $0.isEmpty ? "—" : $0.replacingOccurrences(of: "_", with: " ") })
                }
                LabeledField("Nudge tone") {
                    GlassSegment(options: ["warm", "firm", "formal"], selection: $nudgeTone, label: { $0.capitalized })
                }
            }
            LabeledField("Retainer") {
                VStack(alignment: .leading, spacing: 8) {
                    Toggle(isOn: $isRetainer) { Text("Ongoing retainer client").font(.system(size: 13)) }
                        .toggleStyle(.switch).tint(Palette.cyan)
                    if isRetainer {
                        HStack {
                            Text("Monthly").font(.system(size: 12.5)).foregroundStyle(Palette.textSecondary)
                            Spacer()
                            TextField("0", value: $retainerBase, format: .number).textFieldStyle(GlassFieldStyle()).frame(width: 120).multilineTextAlignment(.trailing)
                        }
                    }
                }
            }
        }
        .onAppear {
            name = client.name; company = client.company ?? ""; email = client.email ?? ""
            phone = client.phone ?? ""; address = client.address ?? ""; city = client.city ?? ""
            country = client.country ?? ""; iban = client.iban ?? ""; swift = client.swift ?? ""
            defaultCurrency = client.defaultCurrency ?? ""
            timeZoneId = client.timeZoneId ?? ""; nudgeTone = client.nudgeTone ?? "warm"
            isRetainer = client.isRetainer; retainerBase = client.retainerBase
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { nameFocused = true }
        }
    }
    private func save() {
        client.name = name
        client.company = company.isEmpty ? nil : company
        client.email = email.isEmpty ? nil : email
        client.phone = phone.isEmpty ? nil : phone
        client.address = address.isEmpty ? nil : address
        client.city = city.isEmpty ? nil : city
        client.country = country.isEmpty ? nil : country
        client.iban = iban.isEmpty ? nil : iban
        client.swift = swift.isEmpty ? nil : swift
        client.defaultCurrency = defaultCurrency.isEmpty ? nil : defaultCurrency
        client.timeZoneId = timeZoneId.isEmpty ? nil : timeZoneId
        client.nudgeTone = nudgeTone
        client.isRetainer = isRetainer
        client.retainerBase = isRetainer ? retainerBase : 0
        client.dirty = true; try? context.save(); dismiss()
    }
}

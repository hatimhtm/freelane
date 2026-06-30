import SwiftUI
import SwiftData

struct ProjectsView: View {
    @Environment(\.modelContext) private var context
    @Environment(UndoCenter.self) private var undo
    @Query private var settings: [AppSettings]
    @Query private var rateRows: [ExchangeRate]
    @Query(filter: #Predicate<Project> { $0.deletedAt == nil }, sort: \Project.createdAt, order: .reverse) private var projects: [Project]
    @Query(filter: #Predicate<Client> { $0.deletedAt == nil }) private var clients: [Client]
    @Query private var rawAllocations: [PaymentAllocation]
    @Query(filter: #Predicate<Payment> { $0.deletedAt == nil }) private var livePayments: [Payment]
    @Query private var milestones: [ProjectMilestone]

    // Allocations of trashed payments must never count as paid here.
    private var allocations: [PaymentAllocation] { ProjectMath.liveAllocations(rawAllocations, payments: livePayments) }

    @State private var showAdd = false
    @State private var editing: Project?
    @State private var paidOpen = false
    @State private var mode = "Board"
    @State private var pendingDeleteProject: Project?
    @State private var payProject: Project?
    @State private var query = ""

    // Native drag-and-drop: which column is being hovered as a drop target.
    @State private var dropTarget: ProjectStatus?
    // Table collapse (Paid collapsed by default)
    @State private var collapsed: Set<String> = ["paid"]

    private var base: String { settings.first?.baseCurrency ?? "PHP" }
    private var rates: Rates { Rates(base: base, rates: rateRows) }
    private func clientName(_ p: Project) -> String { clients.first { $0.id == p.clientId }?.name ?? "—" }
    /// Match a project against the search query (title / client name). Empty = all.
    private func matchesQuery(_ p: Project) -> Bool {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return true }
        return p.title.lowercased().contains(q) || clientName(p).lowercased().contains(q)
    }

    private func move(_ id: UUID, to status: ProjectStatus) {
        guard let p = projects.first(where: { $0.id == id }), p.status != status else { return }
        // Don't silently mark a project Paid while money is still owed — that's a lie to your books.
        // Pop the payment flow pre-filled with the outstanding amount instead.
        if status == .paid, ProjectMath.outstandingNative(project: p, allocations: allocations, rates: rates) > 0.01 {
            payProject = p
            return
        }
        p.status = status
        p.completedAt = status == .paid ? .now : nil
        p.dirty = true
        try? context.save()
        if status == .paid {
            Brain.enqueueProjectPostMortem(context, projectTitle: p.title, clientName: clients.first { $0.id == p.clientId }?.name, outcome: "paid")
        }
    }
    /// Handle a card dropped on a column: the payload is the project's id string.
    private func handleDrop(_ ids: [String], to status: ProjectStatus) -> Bool {
        guard let first = ids.first, let id = UUID(uuidString: first) else { return false }
        withAnimation(.snappy(duration: 0.25)) { move(id, to: status) }
        return true
    }

    // Oldest → newest keeps late payers at the top of open columns.
    private func oldestFirst(_ s: ProjectStatus) -> [Project] {
        projects.filter { $0.status == s && matchesQuery($0) }
            .sorted { $0.agingAnchor < $1.agingAnchor }
    }
    private var paid: [Project] {
        projects.filter { $0.status == .paid && matchesQuery($0) }
            .sorted { ($0.completedAt ?? $0.createdAt) > ($1.completedAt ?? $1.createdAt) }
    }

    var body: some View {
        Page("Projects", subtitle: "Drag cards between columns. Switch to Table for a spreadsheet view.",
             toolbar: AnyView(addButton)) {
            HStack(spacing: 12) {
                GlassSegment(options: ["Board", "Table"], selection: $mode) { $0 }
                if !projects.isEmpty {
                    SearchField(text: $query, placeholder: "Search project or client").frame(maxWidth: 280)
                }
                Spacer(minLength: 0)
            }
            if projects.isEmpty {
                EmptyStateCard(icon: "folder", title: "No projects yet",
                               message: "Add a project to track deliverables, what's owed, and what's landed.",
                               actionLabel: "New project") { showAdd = true }
            } else if mode == "Board" {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(alignment: .top, spacing: 16) {
                        column("Unpaid", oldestFirst(.unpaid), Palette.cyan, .unpaid)
                        column("Partially paid", oldestFirst(.partiallyPaid), Palette.warning, .partiallyPaid)
                        paidColumn
                    }
                    .padding(4)
                }
            } else {
                groupedTable
            }
        }
        .sheet(isPresented: $showAdd) { AddProjectSheet() }
        .sheet(item: $editing) { EditProjectSheet(project: $0) }
        .sheet(item: $payProject) { p in
            BulkPaymentSheet(prefillProjectId: p.id,
                             prefillGrossNative: ProjectMath.outstandingNative(project: p, allocations: allocations, rates: rates),
                             prefillCurrency: p.currency)
        }
        .confirmationDialog("Delete this project?", isPresented: Binding(get: { pendingDeleteProject != nil }, set: { if !$0 { pendingDeleteProject = nil } }), presenting: pendingDeleteProject) { p in
            Button("Delete", role: .destructive) {
                // A deal that never got paid fell through → offer a journal question about it.
                if p.status != .paid {
                    Brain.enqueueProjectPostMortem(context, projectTitle: p.title, clientName: clients.first { $0.id == p.clientId }?.name, outcome: "fell_through")
                }
                undo.trashSimple(p, label: "project", context: context); pendingDeleteProject = nil
            }
            Button("Cancel", role: .cancel) { pendingDeleteProject = nil }
        } message: { _ in Text("Removes the project. Logged payments stay in your history.") }
    }

    // Grouped, collapsible spreadsheet — Unpaid first, then Partially paid, Paid last
    // (collapsed by default, since you care about what's still owed).
    private var groupedTable: some View {
        VStack(spacing: 14) {
            tableHeaderRow
            tableGroup("Unpaid", oldestFirst(.unpaid), Palette.cyan, .unpaid)
            tableGroup("Partially paid", oldestFirst(.partiallyPaid), Palette.warning, .partiallyPaid)
            tableGroup("Paid", paid, Palette.positive, .paid)
        }
    }

    private var tableHeaderRow: some View {
        HStack(spacing: 10) {
            Text("PROJECT").frame(maxWidth: .infinity, alignment: .leading)
            Text("CLIENT").frame(width: 140, alignment: .leading)
            Text("AMOUNT").frame(width: 90, alignment: .trailing)
            Text("OUTSTANDING").frame(width: 100, alignment: .trailing)
            Text("DUE").frame(width: 84, alignment: .trailing)
        }
        .font(.system(size: 9.5, weight: .semibold)).kerning(0.5).foregroundStyle(Palette.textTertiary)
        .padding(.horizontal, 14)
    }

    @ViewBuilder private func tableGroup(_ title: String, _ items: [Project], _ accent: Color, _ status: ProjectStatus) -> some View {
        let isCollapsed = collapsed.contains(status.rawValue)
        VStack(spacing: 0) {
            Button { withAnimation(.snappy(duration: 0.22)) { if isCollapsed { collapsed.remove(status.rawValue) } else { collapsed.insert(status.rawValue) } } } label: {
                HStack(spacing: 8) {
                    Image(systemName: isCollapsed ? "chevron.right" : "chevron.down").font(.system(size: 10, weight: .bold)).foregroundStyle(Palette.textTertiary)
                    Circle().fill(accent).frame(width: 7, height: 7)
                    Text(title).font(.system(size: 12.5, weight: .semibold)).foregroundStyle(Palette.textPrimary)
                    Text("\(items.count)").font(.system(size: 11, weight: .semibold)).foregroundStyle(Palette.textTertiary)
                        .padding(.horizontal, 6).padding(.vertical, 2).background(.white.opacity(0.06), in: Capsule())
                    Spacer()
                }.padding(.horizontal, 12).padding(.vertical, 9).contentShape(Rectangle())
            }.buttonStyle(.plain)
            if !isCollapsed {
                if items.isEmpty {
                    Text("None").font(.system(size: 11.5)).foregroundStyle(Palette.textTertiary).frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 14).padding(.bottom, 8)
                } else {
                    ForEach(items) { p in
                        tableRow(p)
                        if p.id != items.last?.id { Divider().overlay(.white.opacity(0.05)) }
                    }
                }
            }
        }
        .glassCard(cornerRadius: Radii.tile, tint: accent.opacity(0.4))
    }

    private func tableRow(_ p: Project) -> some View {
        let out = ProjectMath.outstandingNative(project: p, allocations: allocations, rates: rates)
        return Button { editing = p } label: {
            HStack(spacing: 10) {
                Text(p.title).font(.system(size: 12.5, weight: .medium)).foregroundStyle(Palette.textPrimary).lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
                Text(clientName(p)).font(.system(size: 12)).foregroundStyle(Palette.textSecondary).lineLimit(1).frame(width: 140, alignment: .leading)
                Text(CurrencyFormat.string(p.amount, p.currency, compact: true)).font(.system(size: 12, weight: .medium, design: .rounded)).monospacedDigit().foregroundStyle(Palette.textPrimary).lineLimit(1).frame(width: 90, alignment: .trailing)
                Text(out > 0 ? CurrencyFormat.string(out, p.currency, compact: true) : "—").font(.system(size: 12, weight: .medium, design: .rounded)).monospacedDigit().foregroundStyle(out > 0 ? Palette.warning : Palette.textTertiary).lineLimit(1).frame(width: 100, alignment: .trailing)
                Text(p.dueDate.map { $0.formatted(.dateTime.month().day()) } ?? "—").font(.system(size: 11.5)).foregroundStyle(Palette.textTertiary).frame(width: 84, alignment: .trailing)
            }.padding(.horizontal, 14).padding(.vertical, 9).contentShape(Rectangle())
        }.buttonStyle(.plain)
        .contextMenu {
            Button("Edit", systemImage: "pencil") { editing = p }
            Button("Delete project", systemImage: "trash", role: .destructive) { pendingDeleteProject = p }
        }
    }

    private var addButton: some View {
        Button { showAdd = true } label: { Label("Add project", systemImage: "plus") }
            .buttonStyle(.glassProminent).tint(Palette.violet)
    }

    private func columnBackground(_ accent: Color, _ status: ProjectStatus) -> some View {
        let isTarget = dropTarget == status
        return RoundedRectangle(cornerRadius: 18, style: .continuous)
            .fill(.white.opacity(isTarget ? 0.08 : 0.03))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(isTarget ? accent.opacity(0.65) : .white.opacity(0.06), lineWidth: isTarget ? 1.6 : 0.7))
            .shadow(color: isTarget ? accent.opacity(0.35) : .clear, radius: 14)
            .animation(.easeOut(duration: 0.15), value: isTarget)
    }

    private func column(_ title: String, _ items: [Project], _ accent: Color, _ status: ProjectStatus) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Circle().fill(accent).frame(width: 7, height: 7).shadow(color: accent, radius: 3)
                Text(title).font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.textPrimary)
                Text("\(items.count)").font(.system(size: 11, weight: .semibold)).foregroundStyle(Palette.textTertiary)
                    .padding(.horizontal, 6).padding(.vertical, 2).background(.white.opacity(0.06), in: Capsule())
                Spacer()
            }
            if items.isEmpty {
                Text("Drop here").font(.system(size: 11)).foregroundStyle(Palette.textTertiary).padding(.vertical, 8)
            } else {
                ForEach(items) { p in draggableCard(p) }
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .frame(width: 264, alignment: .topLeading)
        .background(columnBackground(accent, status))
        .dropDestination(for: String.self, action: { ids, _ in handleDrop(ids, to: status) },
                         isTargeted: { dropTarget = $0 ? status : (dropTarget == status ? nil : dropTarget) })
        .animation(.snappy(duration: 0.3), value: items.count)
    }

    // Paid column is COLLAPSED by default (paid projects pile up forever).
    private var paidColumn: some View {
        VStack(alignment: .leading, spacing: 12) {
            Button { withAnimation(.snappy(duration: 0.2)) { paidOpen.toggle() } } label: {
                HStack(spacing: 8) {
                    Image(systemName: paidOpen ? "chevron.down" : "chevron.right")
                        .font(.system(size: 10, weight: .bold)).foregroundStyle(Palette.textTertiary)
                    Circle().fill(Palette.positive).frame(width: 7, height: 7).shadow(color: Palette.positive, radius: 3)
                    Text("Paid").font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.textPrimary)
                    Text("\(paid.count)").font(.system(size: 11, weight: .semibold)).foregroundStyle(Palette.textTertiary)
                        .padding(.horizontal, 6).padding(.vertical, 2).background(.white.opacity(0.06), in: Capsule())
                    Spacer()
                }.contentShape(Rectangle())
            }.buttonStyle(.plain)
            if paidOpen {
                ForEach(paid) { p in draggableCard(p) }
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .frame(width: paidOpen ? 264 : 200, alignment: .topLeading)
        .background(columnBackground(Palette.positive, .paid))
        .dropDestination(for: String.self, action: { ids, _ in handleDrop(ids, to: .paid) },
                         isTargeted: { dropTarget = $0 ? .paid : (dropTarget == .paid ? nil : dropTarget) })
    }

    /// A card you click to edit and drag to move — native drag-and-drop, so a click is
    /// never mistaken for a drag (the old custom gesture had that conflict). The card
    /// itself is the drag preview.
    private func draggableCard(_ p: Project) -> some View {
        Button { editing = p } label: { card(p) }
            .buttonStyle(.cardPress)
            .draggable(p.id.uuidString) {
                card(p).frame(width: 240).opacity(0.92)
                    .shadow(color: .black.opacity(0.45), radius: 16, y: 8)
            }
            .contextMenu {
                if p.status != .paid {
                    if p.workCompletedAt == nil {
                        Button { markDelivered(p, true) } label: { Label("Mark work finished", systemImage: "checkmark.seal") }
                    } else {
                        Button { markDelivered(p, false) } label: { Label("Reopen — clear delivered", systemImage: "arrow.uturn.backward") }
                    }
                }
            }
    }

    /// Mark the work delivered (or clear it) — starts the "waiting to be paid"
    /// clock from now instead of from when the deal was created.
    private func markDelivered(_ p: Project, _ on: Bool) {
        p.workCompletedAt = on ? .now : nil
        p.updatedAt = .now; p.dirty = true
        try? context.save()
    }

    private func card(_ p: Project) -> some View {
        let client = clients.first { $0.id == p.clientId }
        let clientName = client?.name ?? "—"
        let clientColor = client?.accentColor.flatMap { Color(hex: $0) } ?? Palette.cyan
        let paid = ProjectMath.paidNative(project: p, allocations: allocations, rates: rates)
        let out = ProjectMath.outstandingNative(project: p, allocations: allocations, rates: rates)
        let prog = ProjectMath.progress(project: p, allocations: allocations, rates: rates)
        let overdue = (p.dueDate.map { $0 < PHT.startOfDay() } ?? false) && p.status != .paid
        return VStack(alignment: .leading, spacing: 12) {
            HStack {
                Capsule().fill(clientColor).frame(width: 3, height: 30)   // per-client color spine
                VStack(alignment: .leading, spacing: 2) {
                    Text(p.title).font(.system(size: 14, weight: .semibold)).foregroundStyle(Palette.textPrimary).lineLimit(1)
                    HStack(spacing: 5) {
                        Circle().fill(clientColor).frame(width: 6, height: 6)
                        Text(clientName).font(.system(size: 11)).foregroundStyle(Palette.textTertiary)
                    }
                }
                Spacer()
                if overdue {
                    Text("OVERDUE").font(.system(size: 9.5, weight: .bold)).foregroundStyle(Palette.negative)
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(Palette.negative.opacity(0.16), in: Capsule())
                }
                StatusBadge(text: p.status.label, color: p.status.color)
            }
            HStack(alignment: .firstTextBaseline) {
                Text(CurrencyFormat.string(p.amount, p.currency, compact: true))
                    .font(.system(size: 22, weight: .semibold, design: .rounded)).monospacedDigit()
                    .foregroundStyle(Palette.textPrimary)
                    .lineLimit(1).minimumScaleFactor(0.6)
                Spacer()
                if out > 0 {
                    Text(CurrencyFormat.string(out, p.currency, compact: true) + " left")
                        .font(.system(size: 11, weight: .medium)).monospacedDigit()
                        .foregroundStyle(Palette.warning).lineLimit(1)
                }
            }
            ProgressView(value: prog).tint(p.status.color).scaleEffect(x: 1, y: 0.7, anchor: .center)
            HStack {
                Text("\(CurrencyFormat.string(paid, p.currency, compact: true)) received")
                    .font(.system(size: 11)).monospacedDigit().foregroundStyle(Palette.textTertiary).lineLimit(1)
                Spacer()
                let ms = milestones.filter { $0.projectId == p.id && $0.deletedAt == nil }
                if !ms.isEmpty {
                    Label("\(ms.filter { $0.done }.count)/\(ms.count) phases", systemImage: "checklist")
                        .font(.system(size: 10, weight: .medium)).foregroundStyle(Palette.violet)
                }
            }
            if let w = p.workCompletedAt {
                let days = PHT.calendar.dateComponents([.day], from: w, to: .now).day ?? 0
                Label("Delivered · waiting \(days)d", systemImage: "checkmark.seal.fill")
                    .font(.system(size: 10, weight: .medium)).foregroundStyle(Palette.positive)
            }
        }
        .padding(16)
        .frame(minHeight: 150, alignment: .topLeading)
        .glassCard(cornerRadius: Radii.card, interactive: true)
        .contextMenu {
            Button("Edit", systemImage: "pencil") { editing = p }
            Button("Delete project", systemImage: "trash", role: .destructive) { pendingDeleteProject = p }
        }
    }
}

struct AddProjectSheet: View {
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @Query(filter: #Predicate<Client> { $0.deletedAt == nil }, sort: \Client.name) private var clients: [Client]
    @Query private var settings: [AppSettings]

    @State private var title = ""
    @State private var clientId: UUID?
    @State private var amount = ""
    @State private var currency = "PHP"
    @FocusState private var titleFocus: Bool

    private let currencies = CurrencyFormat.supported

    /// Tolerant amount parsing — accepts "1,500" as well as "1500.50".
    private var parsedAmount: Double? { Double(amount.replacingOccurrences(of: ",", with: "")) }

    var body: some View {
        SheetScaffold(title: "New project", accent: Palette.violet,
                      canSave: !title.trimmingCharacters(in: .whitespaces).isEmpty && parsedAmount != nil, onSave: save) {
            LabeledField("Title") {
                TextField("Project name", text: $title).textFieldStyle(GlassFieldStyle()).focused($titleFocus)
            }
            LabeledField("Client") {
                GlassMenuPicker(selection: $clientId,
                                options: [nil] + clients.map { Optional($0.id) },
                                label: { id in id.flatMap { i in clients.first { $0.id == i }?.name } ?? "None" })
            }
            HStack(spacing: 12) {
                LabeledField("Amount") { TextField("0", text: $amount).textFieldStyle(GlassFieldStyle()) }
                LabeledField("Currency") { CurrencyMenu(selection: $currency, options: currencies) }
            }
        }
        .onAppear {
            currency = settings.first?.baseCurrency ?? "PHP"
            DispatchQueue.main.async { titleFocus = true }
        }
        .onChange(of: clientId) { _, id in
            if let c = clients.first(where: { $0.id == id }), let cur = c.defaultCurrency, !cur.isEmpty { currency = cur }
        }
    }

    private func save() {
        guard let amt = parsedAmount else { return }
        let p = Project(clientId: clientId, title: title.trimmingCharacters(in: .whitespaces), amount: amt, currency: currency)
        p.dirty = true
        context.insert(p)
        try? context.save()
        dismiss()
    }
}

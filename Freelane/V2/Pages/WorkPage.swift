import SwiftUI
import SwiftData

/// Work: what came in this year and from whom, who still owes you, and what getting paid cost.
struct WorkPage: View {
    @Environment(AppState.self) private var app
    @Environment(\.accessibilityReduceMotion) private var reduce
    let state: MoneyState
    @Query private var payments: [Payment]
    @Query private var projects: [Project]
    @Query private var clients: [Client]
    @Query private var withdrawals: [Withdrawal]
    @Query private var allocations: [PaymentAllocation]
    @Query(filter: #Predicate<LedgerEntry> { $0.kindRaw == "income" && $0.archivedAt == nil }) private var incomes: [LedgerEntry]
    @Query private var wallets: [Wallet]
    @Query private var rateRows: [ExchangeRate]
    @Query private var settings: [AppSettings]
    @State private var addingProject = false

    private var base: String { settings.first?.baseCurrency ?? "PHP" }

    var body: some View {
        let w = WorkPicture.build(payments: payments, projects: projects, clients: clients, withdrawals: withdrawals,
                                  allocations: allocations, incomes: incomes, wallets: wallets,
                                  rates: Rates(base: base, rates: rateRows))
        HStack(spacing: 12) {
            Pane {
                PaneHeader(title: "Work") {
                    M3Button(title: "New project", icon: Sym.add, kind: .tonal) { addingProject = true }
                }
                ScrollView(.vertical, showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 0) {
                        WorkBand(w: w).padding(.top, 16)
                        if !w.owed.isEmpty {
                            SectionHeader(title: "Owed to you", count: w.owed.count)
                            Segmented(items: w.owed) { o in
                                WorkOwedRow(owed: o) { withAnimation(Flow.spatial) { app.start(.moneyIn) } }
                            }
                        }
                        SectionHeader(title: "Clients")
                        if w.clients.isEmpty {
                            Text("No payments from clients yet this year.").role(.supporting, MD.onSurfaceVariant).padding(.horizontal, 4)
                        } else {
                            Segmented(items: w.clients) { c in
                                ListRow(badge: Badge(subject: .person(c.title), size: 40), title: c.title, subtitle: c.subtitle) {
                                    Money(value: c.total, role: .row, decimals: false)
                                }
                            }
                        }
                        if let u = w.unlinked {
                            Text(u).role(.supporting, MD.onSurfaceVariant).padding(.horizontal, 4).padding(.top, 10)
                        }
                    }
                    .padding(.bottom, 4)
                    .animation(Flow.pick(Flow.spatial, reduce: reduce), value: w.owed.map(\.id))
                }
            }
            .frame(minWidth: 560)
            Pane {
                PaneHeader(title: "Getting paid", big: false)
                ScrollView(.vertical, showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 0) {
                        WorkFeeCard(w: w).padding(.top, 16)
                        SectionHeader(title: "Latest payments", small: true) {
                            M3Button(title: "See all", kind: .text) { withAnimation(Flow.slow) { app.go(.ledger) } }
                        }
                        if w.latest.isEmpty {
                            Text("No payments yet.").role(.supporting, MD.onSurfaceVariant).padding(.horizontal, 4)
                        }
                        ForEach(w.latest) { WorkLatestRow(item: $0) }
                    }
                }
            }
            .frame(width: 384)
        }
        .sheet(isPresented: $addingProject) {
            WorkProjectEditor(clients: clients.filter { $0.deletedAt == nil && !$0.archived }
                                .sorted { WorkText.title($0).localizedCaseInsensitiveCompare(WorkText.title($1)) == .orderedAscending },
                              base: base)
        }
        .onReceive(DistributedNotificationCenter.default().publisher(for: .init("app.freelane.dev." + (ProcessInfo.processInfo.environment["FREELANE_DEV_CHANNEL"] ?? "main")))) { n in
            // Test builds only: open the sheet from a script ("work:new").
            guard DevMode.isSandboxed, let cmd = n.object as? String else { return }
            if cmd == "work:new" { addingProject = true }
        }
    }
}

// MARK: - Summary band

private struct WorkBand: View {
    let w: WorkPicture
    var body: some View {
        let label = w.since.map { PHT.calendar.component(.month, from: $0) == 1 ? "earned this year" : "earned since \(Day.month($0))" } ?? "earned this year"
        Band {
            HStack(alignment: .bottom, spacing: 24) {
                VStack(alignment: .leading, spacing: 0) {
                    Money(value: w.earned, role: .summary, decimals: false, color: MD.onPrimaryContainer)
                        .contentTransition(.numericText(value: w.earned))
                    Text(label).role(.summaryLabel, MD.onPrimaryContainer).padding(.top, 4)
                    Text(w.sentence).role(.body, MD.onPrimaryContainer).padding(.top, 2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                if !w.months.isEmpty {
                    WorkMonthBars(months: w.months)
                        .frame(width: min(max(320, CGFloat(w.months.count) * 36), 432))
                }
            }
        }
    }
}

/// One bar per month: the best month in primary, the rest a soft ink, this month outlined while it runs.
private struct WorkMonthBars: View {
    let months: [WorkMonth]
    @State private var grown = false
    @Environment(\.accessibilityReduceMotion) private var reduce

    var body: some View {
        let peak = months.map(\.total).max() ?? 0
        let labelAll = months.count <= 9
        HStack(alignment: .bottom, spacing: 8) {
            ForEach(months) { m in
                VStack(spacing: 4) {
                    Text(labelAll || m.isPeak || m.isCurrent ? WorkText.short(m.total) : " ")
                        .role(.small, MD.onPrimaryContainer).lineLimit(1).fixedSize()
                    bar(m)
                        .frame(maxWidth: 28)
                        .frame(height: peak > 0 ? max(m.total > 0 ? 4 : 2, 80 * m.total / peak) : 2)
                        .scaleEffect(x: 1, y: grown || reduce ? 1 : 0.001, anchor: .bottom)
                    Text(BillsText.mon(m.month)).role(.small, MD.onPrimaryContainer).lineLimit(1).fixedSize()
                }
                .frame(maxWidth: .infinity)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("\(Day.month(m.month)): \(MoneyFormat.string(m.total, decimals: false))\(m.isCurrent ? ", so far" : "")")
            }
        }
        .frame(height: 124, alignment: .bottom)
        .onAppear { withAnimation(Flow.pick(Flow.slow, reduce: reduce).delay(reduce ? 0 : 0.05)) { grown = true } }
    }

    @ViewBuilder private func bar(_ m: WorkMonth) -> some View {
        let shape = UnevenRoundedRectangle(topLeadingRadius: 6, bottomLeadingRadius: 3, bottomTrailingRadius: 3, topTrailingRadius: 6, style: .continuous)
        if m.isCurrent {
            shape.strokeBorder(m.isPeak ? MD.primary : MD.onPrimaryContainer, lineWidth: 1.5)
        } else {
            shape.fill(m.isPeak ? MD.primary : MD.onPrimaryContainer.opacity(0.28))
        }
    }
}

// MARK: - Owed to you

private struct WorkOwedRow: View {
    let owed: WorkOwed
    let markPaid: () -> Void
    var body: some View {
        HStack(spacing: 16) {
            Badge(subject: .person(owed.client), size: 48)
            VStack(alignment: .leading, spacing: 2) {
                Text("\(owed.client) · \(owed.project.title)").role(.rowLarge).lineLimit(1)
                Text(owed.detail).role(.supporting, MD.onSurfaceVariant).lineLimit(2)
            }
            Spacer(minLength: 12)
            Money(value: owed.base, role: .row, decimals: false, estimate: owed.estimate)
            M3Button(title: "Mark paid", kind: .tonal, small: true, action: markPaid)
        }
        .padding(.leading, 12).padding(.trailing, 16).padding(.vertical, 12)
        .frame(minHeight: 72)
    }
}

// MARK: - Getting paid

private struct WorkFeeCard: View {
    let w: WorkPicture
    var body: some View {
        let total = w.fees
        let share = w.earned > 0 ? total / w.earned * 100 : 0
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Money(value: total, role: .detail, decimals: false, color: MD.onTertiaryContainer)
                    .contentTransition(.numericText(value: total))
                if w.earned > 0 && total > 0 {
                    Text(share < 0.1 ? "<0.1%" : String(format: "%.1f%%", share)).role(.summaryLabel, MD.onTertiaryContainer.opacity(0.8))
                }
            }
            Text(total > 0.004
                 ? "lost on the way to you this year, when clients paid and when you moved money between wallets."
                 : "lost on the way to you this year.")
                .role(.body, MD.onTertiaryContainer)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 6)
            if total > 0.004 {
                WorkFeeSplit(first: w.feesAtPayment, second: w.feesMoving).frame(height: 12).padding(.top, 14)
                HStack(alignment: .top) {
                    key("When clients paid", w.feesAtPayment, alignment: .leading)
                    Spacer(minLength: 12)
                    key("Moving between wallets", w.feesMoving, alignment: .trailing)
                }
                .padding(.top, 8)
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 24, style: .continuous).fill(MD.tertiaryContainer))
    }

    private func key(_ label: String, _ value: Double, alignment: HorizontalAlignment) -> some View {
        VStack(alignment: alignment, spacing: 0) {
            Text(label).role(.supporting, MD.onTertiaryContainer)
            Money(value: value, role: .inline(15), decimals: false, color: MD.onTertiaryContainer)
        }
    }
}

/// The two parts of the fees as one bar: at payment (solid) and moving between wallets (lighter).
private struct WorkFeeSplit: View {
    let first: Double
    let second: Double
    var body: some View {
        GeometryReader { g in
            let total = max(first + second, 0.0001)
            let parts = [(first, MD.tertiary), (second, MD.tertiary.opacity(0.45))].filter { $0.0 > 0.004 }
            let room = g.size.width - CGFloat(max(parts.count - 1, 0)) * 3
            HStack(spacing: 3) {
                ForEach(Array(parts.enumerated()), id: \.offset) { i, p in
                    let lead = i == 0, trail = i == parts.count - 1
                    UnevenRoundedRectangle(topLeadingRadius: lead ? 6 : 3, bottomLeadingRadius: lead ? 6 : 3,
                                           bottomTrailingRadius: trail ? 6 : 3, topTrailingRadius: trail ? 6 : 3, style: .continuous)
                        .fill(p.1)
                        .frame(width: max(6, room * p.0 / total))
                }
            }
        }
        .accessibilityHidden(true)
    }
}

private struct WorkLatestRow: View {
    let item: WorkLatest
    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 1) {
                Text(item.title).role(.row).lineLimit(1)
                Text(item.subtitle).role(.supporting, MD.onSurfaceVariant).lineLimit(1)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 1) {
                Money.incoming(item.net)
                Text(item.note).role(.supporting, MD.onSurfaceVariant).lineLimit(1)
            }
        }
        .padding(.horizontal, 4)
        .frame(minHeight: 52)
    }
}

// MARK: - New project

private struct WorkProjectEditor: View {
    let clients: [Client]
    let base: String
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var clientId: UUID? = nil
    @State private var amount = ""
    @State private var currency = ""
    @State private var delivered = false

    private var client: Client? { clients.first { $0.id == clientId } }
    private var parsed: Double? { BillsWorkAmount.parse(amount) }
    private var canSave: Bool { !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && (parsed ?? 0) > 0 }
    private var code: String { currency.isEmpty ? base : currency }

    var body: some View {
        BillsWorkSheet(title: "New project", action: "Add project", canSave: canSave, onCancel: { dismiss() }, onSave: save) {
            BillsWorkField(label: "Project") {
                BillsWorkInput(placeholder: "What you’re making", text: $title, autofocus: true)
            }
            BillsWorkField(label: "Client") {
                BillsWorkMenu(title: client.map(WorkText.title) ?? "No client") {
                    if let client { Badge(subject: .person(WorkText.title(client)), size: 28) }
                } items: {
                    Button("No client") { clientId = nil }
                    Divider()
                    ForEach(clients) { c in
                        Button(WorkText.title(c)) {
                            clientId = c.id
                            if let cur = c.defaultCurrency, !cur.isEmpty { currency = cur }
                        }
                    }
                }
            }
            HStack(alignment: .top, spacing: 12) {
                BillsWorkField(label: "Agreed amount") {
                    BillsWorkInput(placeholder: "0", text: $amount, prefix: CurrencyFormat.symbol(code))
                }
                BillsWorkField(label: "Currency") {
                    BillsWorkMenu(title: code) { EmptyView() } items: {
                        ForEach(CurrencyFormat.supported, id: \.self) { c in
                            Button("\(c) · \(WorkText.currencyWord(c))") { currency = c }
                        }
                    }
                }
                .frame(width: 140)
            }
            Toggle(isOn: $delivered.animation(Flow.effects)) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("The work is delivered").role(.row)
                    Text("The days you’ve been waiting to be paid count from today.").role(.supporting, MD.onSurfaceVariant)
                }
            }
            .toggleStyle(.switch)
            .tint(MD.primary)
            .padding(.vertical, 4)
        }
    }

    private func save() {
        guard canSave, let amt = parsed else { return }
        let p = Project(clientId: clientId, title: title.trimmingCharacters(in: .whitespacesAndNewlines), amount: amt, currency: code)
        if delivered { p.workCompletedAt = .now }
        p.dirty = true
        context.insert(p)
        try? context.save()
        dismiss()
    }
}

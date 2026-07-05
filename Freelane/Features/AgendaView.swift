import SwiftUI
import SwiftData
import Charts

/// "What's coming" — one timeline across bills, loan returns, plan targets, project
/// due dates and the birthdays of people you track. The Life-OS at-a-glance future.
///
/// Layout: a "this week" money strip (due in / due out / net over the next 7 days),
/// the cash-flow forecast, then a calendar rail — day groups with a big date column
/// on the left and quiet inset rows on the right, amounts right-aligned, urgency in
/// the semantic colors (overdue = negative, due ≤3 days = warning).
struct AgendaView: View {
    @Environment(\.modelContext) private var context
    @Environment(UndoCenter.self) private var undo
    @Query private var settings: [AppSettings]
    @Query(filter: #Predicate<Recurring> { $0.deletedAt == nil }) private var recurrings: [Recurring]
    @Query(filter: #Predicate<Loan> { $0.deletedAt == nil }) private var loans: [Loan]
    @Query(filter: #Predicate<Project> { $0.deletedAt == nil }) private var projects: [Project]
    @Query(filter: #Predicate<Entity> { $0.deletedAt == nil }) private var entities: [Entity]
    @Query(filter: #Predicate<Wallet> { $0.deletedAt == nil }) private var wallets: [Wallet]
    @Query private var ledger: [LedgerEntry]

    private var base: String { settings.first?.baseCurrency ?? "PHP" }
    @AppStorage("agenda.horizon") private var horizon = 45

    @State private var showRecurring = false
    @State private var showLoan = false
    @State private var editingRecurring: Recurring?
    @State private var editingProject: Project?
    @State private var editingEntity: Entity?
    @State private var confirmRemove: Item?

    private var addMenu: some View {
        Menu {
            Button { showRecurring = true } label: { Label("Bill or income (recurring)", systemImage: "calendar.badge.clock") }
            Button { showLoan = true } label: { Label("Loan", systemImage: "arrow.left.arrow.right") }
        } label: { Label("Add", systemImage: "plus") }
            .buttonStyle(.glassProminent).tint(Palette.azure)
    }

    struct Item: Identifiable {
        let id = UUID(); let date: Date; let title: String; let detail: String
        let icon: String; let color: Color; let warn: Bool
        /// Signed base-currency flow: + money due IN, − money due OUT. nil = not a money item
        /// (calendar events, birthdays, project deadlines without a figure).
        var amount: Double? = nil
        var edit: (() -> Void)? = nil
        var remove: (() -> Void)? = nil
    }

    private var holdingTotal: Double {
        wallets.filter { $0.isHolding && !$0.archived && !$0.excludedFromTotals }.reduce(0) { $0 + WalletMath.balance(of: $1, ledger: ledger) }
    }

    private var items: [Item] {
        let today = PHT.startOfDay()
        let end = PHT.calendar.date(byAdding: .day, value: horizon, to: today)!
        var out: [Item] = []

        for r in recurrings where r.active && r.kind == .expense {
            if let d = nextRecurring(r), d <= end {
                let tight = d <= PHT.calendar.date(byAdding: .day, value: 3, to: today)! && r.amountBase > holdingTotal
                out.append(.init(date: d, title: r.label, detail: "Bill · \(cadenceLabel(r))",
                                 icon: "calendar.badge.clock", color: Palette.warning, warn: tight,
                                 amount: -r.amountBase,
                                 edit: { editingRecurring = r }, remove: { undo.trashSimple(r, label: "recurring", context: context) }))
            }
        }
        for r in recurrings where r.active && r.kind == .income {
            if let d = nextRecurring(r), d <= end {
                out.append(.init(date: d, title: r.label, detail: "Income · \(cadenceLabel(r))",
                                 icon: "arrow.down.left.circle", color: Palette.positive, warn: false,
                                 amount: r.amountBase,
                                 edit: { editingRecurring = r }, remove: { undo.trashSimple(r, label: "recurring", context: context) }))
            }
        }
        for l in loans where (l.statusRaw == "open" || l.statusRaw == "partially_returned") {
            if let d = l.dueDate, d <= end {
                let mine = l.direction == .given
                out.append(.init(date: d, title: l.counterparty,
                                 detail: mine ? "Loan · return due to you" : "Loan · you owe",
                                 icon: "arrow.left.arrow.right", color: Palette.teal, warn: !mine,
                                 amount: mine ? l.outstandingBase : -l.outstandingBase,
                                 remove: { LoanEngine.onDelete(context, loan: l); undo.offer("loan") { LoanEngine.onRestore(context, loan: l) } }))
            }
        }
        for p in projects where p.status == .unpaid || p.status == .partiallyPaid {
            if let d = p.dueDate, d <= end {
                out.append(.init(date: d, title: p.title, detail: "Project due", icon: "folder", color: Palette.cyan, warn: d < today,
                                 edit: { editingProject = p }))
            }
        }
        for e in entities where !e.archived {
            if let bd = e.importantDate {
                let next = nextAnnual(bd)
                if next <= end {
                    out.append(.init(date: next, title: e.name, detail: e.importantDateLabel ?? "Important date",
                                     icon: "gift", color: Palette.negative, warn: false,
                                     edit: { editingEntity = e }))
                }
            }
        }
        return out.sorted { $0.date < $1.date }
    }

    private func cadenceLabel(_ r: Recurring) -> String {
        switch r.cadence {
        case .monthly: return "monthly"
        case .weekly:  return "weekly"
        case .yearly:  return "yearly"
        }
    }

    // MARK: This-week money strip (derived from the same items the rail shows)

    /// Money due in / out over the next 7 days — overdue items count too (they're still due).
    private var weekSummary: (inn: Double, out: Double, count: Int) {
        let weekEnd = PHT.calendar.date(byAdding: .day, value: 7, to: PHT.startOfDay())!
        var inn = 0.0, out = 0.0, n = 0
        for i in items where i.date < weekEnd {
            guard let a = i.amount else { continue }
            if a >= 0 { inn += a } else { out += -a }
            n += 1
        }
        return (inn, out, n)
    }

    private var weekStrip: some View {
        let s = weekSummary
        let net = s.inn - s.out
        return VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(s.count == 0 ? "This week — all clear" : "This week · \(s.count) money item\(s.count == 1 ? "" : "s")").tileLabel()
                Spacer()
                horizonMenu
            }
            HStack(spacing: 16) {
                flowColumn("Due in", icon: "arrow.down.left", tint: Palette.positive,
                           text: "+" + CurrencyFormat.string(s.inn, base, compact: true),
                           valueColor: s.inn > 0 ? Palette.positive : Palette.textTertiary)
                stripDivider
                flowColumn("Due out", icon: "arrow.up.right", tint: Palette.negative,
                           text: "−" + CurrencyFormat.string(s.out, base, compact: true),
                           valueColor: s.out > 0 ? Palette.textPrimary : Palette.textTertiary)
                stripDivider
                flowColumn("Net", icon: "scalemass", tint: net >= 0 ? Palette.positive : Palette.negative,
                           text: (net < 0 ? "−" : "+") + CurrencyFormat.string(abs(net), base, compact: true),
                           valueColor: net >= 0 ? Palette.positive : Palette.negative)
                Spacer(minLength: 0)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassCard(cornerRadius: Radii.card)
    }

    private var stripDivider: some View {
        Rectangle().fill(Palette.hairline).frame(width: 1, height: 30)
    }

    private func flowColumn(_ label: String, icon: String, tint: Color, text: String, valueColor: Color) -> some View {
        HStack(spacing: 9) {
            Image(systemName: icon).font(.system(size: 11, weight: .bold)).foregroundStyle(tint)
                .frame(width: 26, height: 26)
                .background(tint.opacity(0.15), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            VStack(alignment: .leading, spacing: 1) {
                Text(label).font(.system(size: 9.5, weight: .semibold)).textCase(.uppercase).kerning(0.6)
                    .foregroundStyle(Palette.textTertiary)
                Text(text).font(.system(size: 16, weight: .semibold, design: .rounded)).monospacedDigit()
                    .foregroundStyle(valueColor)
            }
        }
    }

    /// Horizon picker, compact (lives in the strip header instead of a dangling row).
    private var horizonMenu: some View {
        Menu {
            ForEach([45, 90, 180], id: \.self) { d in
                Button { horizon = d } label: {
                    if d == horizon { Label("\(d) days", systemImage: "checkmark") } else { Text("\(d) days") }
                }
            }
        } label: {
            HStack(spacing: 5) {
                Image(systemName: "calendar").font(.system(size: 10, weight: .semibold)).foregroundStyle(Palette.textTertiary)
                Text("\(horizon) days").font(.system(size: 11.5, weight: .semibold)).foregroundStyle(Palette.textSecondary)
                Image(systemName: "chevron.down").font(.system(size: 8, weight: .bold)).foregroundStyle(Palette.textTertiary)
            }
            .padding(.horizontal, 10).padding(.vertical, 6)
            .background(Palette.hairline, in: Capsule())
            .overlay(Capsule().strokeBorder(Palette.wellStroke, lineWidth: 0.8))
            .contentShape(Capsule())
        }
        .menuStyle(.borderlessButton).fixedSize()
    }

    // MARK: Cash-flow projection (waterfall)

    struct FlowPoint: Identifiable { let id = UUID(); let date: Date; let balance: Double }

    /// Running wallet balance projected forward over the horizon: today's holdings, then every
    /// recurring bill/income occurrence + loan due-date, expanded day by day.
    private var cashProjection: [FlowPoint] {
        let cal = PHT.calendar, today = PHT.startOfDay()
        let end = cal.date(byAdding: .day, value: horizon, to: today)!
        var delta: [Date: Double] = [:]
        func add(_ d: Date, _ v: Double) { let k = cal.startOfDay(for: d); if k >= today && k <= end { delta[k, default: 0] += v } }
        func occurrences(_ r: Recurring) -> [Date] {
            guard var d = nextRecurring(r) else { return [] }
            var out: [Date] = []
            while d <= end {
                out.append(d)
                switch r.cadence {
                case .monthly: d = cal.date(byAdding: .month, value: 1, to: d) ?? end.addingTimeInterval(1)
                case .weekly:  d = cal.date(byAdding: .day, value: 7, to: d) ?? end.addingTimeInterval(1)
                case .yearly:  d = cal.date(byAdding: .year, value: 1, to: d) ?? end.addingTimeInterval(1)
                }
            }
            return out
        }
        for r in recurrings where r.active {
            let sign = r.kind == .income ? 1.0 : -1.0
            for d in occurrences(r) { add(d, sign * r.amountBase) }
        }
        for l in loans where (l.statusRaw == "open" || l.statusRaw == "partially_returned") {
            if let d = l.dueDate { add(d, (l.direction == .given ? 1.0 : -1.0) * l.outstandingBase) }
        }
        var pts: [FlowPoint] = [FlowPoint(date: today, balance: holdingTotal)]
        var running = holdingTotal, day = today
        while day <= end {
            if let dv = delta[day] { running += dv; pts.append(FlowPoint(date: day, balance: running)) }
            day = cal.date(byAdding: .day, value: 1, to: day) ?? end.addingTimeInterval(1)
        }
        pts.append(FlowPoint(date: end, balance: running))
        return pts
    }
    private var lowestPoint: FlowPoint? { cashProjection.dropFirst().min { $0.balance < $1.balance } }

    private var waterfallCard: some View {
        let pts = cashProjection, low = lowestPoint
        let dipsNegative = (low?.balance ?? 0) < 0
        return SectionCard(title: "Cash-flow forecast",
                           subtitle: "Projected balance over \(horizon) days · recurring + loans",
                           accent: dipsNegative ? Palette.negative : Palette.cyan) {
            VStack(alignment: .leading, spacing: 8) {
                if let low {
                    HStack(spacing: 6) {
                        Image(systemName: dipsNegative ? "exclamationmark.triangle.fill" : "arrow.down.to.line")
                            .font(.system(size: 11)).foregroundStyle(dipsNegative ? Palette.negative : Palette.warning)
                        Text("Lowest point: \(CurrencyFormat.string(low.balance, base, compact: true)) on \(low.date.formatted(.dateTime.month(.abbreviated).day()))")
                            .font(.system(size: 12, weight: .medium)).foregroundStyle(dipsNegative ? Palette.negative : Palette.textSecondary)
                    }
                }
                Chart {
                    ForEach(pts) { p in
                        AreaMark(x: .value("Date", p.date), y: .value("Balance", p.balance))
                            .interpolationMethod(.stepEnd)
                            .foregroundStyle(LinearGradient(colors: [Palette.cyan.opacity(0.30), Palette.cyan.opacity(0.02)], startPoint: .top, endPoint: .bottom))
                        LineMark(x: .value("Date", p.date), y: .value("Balance", p.balance))
                            .interpolationMethod(.stepEnd).lineStyle(StrokeStyle(lineWidth: 2))
                            .foregroundStyle(Palette.cyan)
                    }
                    RuleMark(y: .value("Zero", 0)).foregroundStyle(Palette.negative.opacity(0.4)).lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 3]))
                    if let low {
                        PointMark(x: .value("Date", low.date), y: .value("Balance", low.balance))
                            .foregroundStyle(dipsNegative ? Palette.negative : Palette.warning).symbolSize(60)
                    }
                }
                .chartYAxis { AxisMarks(position: .leading) { v in
                    AxisGridLine().foregroundStyle(Palette.hairline)
                    AxisValueLabel { if let d = v.as(Double.self) { Text(CurrencyFormat.abbreviated(d, base)).foregroundStyle(Palette.textTertiary) } }
                } }
                .frame(height: 170)
            }
        }
    }

    // MARK: Calendar rail

    private var dayGroups: [(day: Date, items: [Item])] {
        let dict = Dictionary(grouping: items) { PHT.calendar.startOfDay(for: $0.date) }
        return dict.keys.sorted().map { (day: $0, items: dict[$0]!) }
    }

    /// Overdue → negative, due within 3 days → warning, otherwise quiet.
    private func urgencyTint(_ day: Date) -> Color? {
        let today = PHT.startOfDay()
        if day < today { return Palette.negative }
        let days = PHT.calendar.dateComponents([.day], from: today, to: day).day ?? 0
        return days <= 3 ? Palette.warning : nil
    }

    private var timelineCard: some View {
        SectionCard(title: "Timeline",
                    subtitle: "\(items.count) upcoming · next \(horizon) days",
                    accent: Palette.indigo) {
            VStack(spacing: 0) {
                ForEach(Array(dayGroups.enumerated()), id: \.element.day) { idx, group in
                    dayRow(group)
                    if idx < dayGroups.count - 1 {
                        Divider().overlay(Palette.hairline).padding(.leading, 62)
                    }
                }
            }
        }
    }

    private func dayRow(_ group: (day: Date, items: [Item])) -> some View {
        let tint = urgencyTint(group.day)
        return HStack(alignment: .top, spacing: 14) {
            dateColumn(group.day, tint: tint)
            VStack(spacing: 6) {
                ForEach(group.items) { entryRow($0, tint: tint) }
            }
        }
        .padding(.vertical, 9)
    }

    /// The rail's left column: small weekday (or TODAY), big day number, small month.
    private func dateColumn(_ day: Date, tint: Color?) -> some View {
        let today = PHT.startOfDay()
        let isToday = day == today
        return VStack(spacing: 1) {
            Text(isToday ? "TODAY" : day.formatted(.dateTime.weekday(.abbreviated)).uppercased())
                .font(.system(size: 9, weight: .bold)).kerning(0.6)
                .foregroundStyle(tint ?? Palette.textTertiary)
            Text(day.formatted(.dateTime.day()))
                .font(.system(size: 23, weight: .semibold, design: .rounded)).monospacedDigit()
                .foregroundStyle(day < today ? Palette.negative : Palette.textPrimary)
            Text(day.formatted(.dateTime.month(.abbreviated)).uppercased())
                .font(.system(size: 9, weight: .medium))
                .foregroundStyle(Palette.textTertiary)
        }
        .frame(width: 48)
        .padding(.vertical, 3)
    }

    private func entryRow(_ i: Item, tint: Color?) -> some View {
        HStack(spacing: 10) {
            Image(systemName: i.icon).font(.system(size: 12, weight: .semibold)).foregroundStyle(i.color)
                .frame(width: 28, height: 28)
                .background(i.color.opacity(0.15), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
            VStack(alignment: .leading, spacing: 1) {
                Text(i.title).font(.system(size: 12.5, weight: .medium)).foregroundStyle(Palette.textPrimary).lineLimit(1)
                Text(i.detail).font(.system(size: 10.5)).foregroundStyle(Palette.textTertiary).lineLimit(1)
            }
            Spacer(minLength: 8)
            if i.warn {
                Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 10)).foregroundStyle(Palette.negative)
            }
            if let a = i.amount {
                Text((a >= 0 ? "+" : "−") + CurrencyFormat.string(abs(a), base, compact: true))
                    .font(.system(size: 12.5, weight: .semibold, design: .rounded)).monospacedDigit()
                    .foregroundStyle(a >= 0 ? Palette.positive : (i.warn ? Palette.negative : (tint ?? Palette.textPrimary)))
            }
            if i.edit != nil || i.remove != nil {
                Menu {
                    if let edit = i.edit { Button("Edit", systemImage: "pencil") { edit() } }
                    if i.remove != nil { Button("Delete", systemImage: "trash", role: .destructive) { confirmRemove = i } }
                } label: { Image(systemName: "ellipsis").foregroundStyle(Palette.textTertiary).frame(width: 22, height: 22) }
                    .menuStyle(.borderlessButton).frame(width: 22)
            }
        }
        .padding(.horizontal, 10).padding(.vertical, 7)
        .insetRow()
    }

    var body: some View {
        Page("Agenda", subtitle: "Your upcoming timeline — bills, income, loan returns, project deadlines & birthdays.",
             toolbar: AnyView(addMenu)) {
            weekStrip
            if cashProjection.count > 2 { waterfallCard }
            if items.isEmpty {
                EmptyStateCard(icon: "calendar", title: "Nothing on the horizon",
                               message: "This is your forward view. Use + to add a recurring bill/income, a loan, or a plan — anything with a date (also project deadlines & birthdays) lines up here automatically.",
                               actionLabel: "Add a bill or income") { showRecurring = true }
            } else {
                timelineCard
            }
        }
        .sheet(isPresented: $showRecurring) { AddRecurringSheet() }
        .sheet(isPresented: $showLoan) { AddLoanSheet() }
        .sheet(item: $editingRecurring) { AddRecurringSheet(existing: $0) }
        .sheet(item: $editingProject) { EditProjectSheet(project: $0) }
        .sheet(item: $editingEntity) { EntityDetailSheet(entity: $0) }
        .confirmationDialog("Delete this item?", isPresented: Binding(get: { confirmRemove != nil }, set: { if !$0 { confirmRemove = nil } }), presenting: confirmRemove) { item in
            Button("Delete \(item.title)", role: .destructive) { item.remove?(); confirmRemove = nil }
            Button("Cancel", role: .cancel) { confirmRemove = nil }
        } message: { _ in Text("This removes it from your timeline.") }
    }

    // MARK: date helpers

    /// Unified with the rest of the app: the next unpaid occurrence, respecting what's been
    /// paid (the old copy here ignored paid-status for monthly and reinvented the schedule).
    private func nextRecurring(_ r: Recurring) -> Date? { RecurringMath.nextDue(r) }
    private func nextAnnual(_ date: Date) -> Date {
        let cal = PHT.calendar, today = PHT.startOfDay()
        let md = cal.dateComponents([.month, .day], from: date)
        var comps = cal.dateComponents([.year], from: today); comps.month = md.month; comps.day = md.day
        var d = cal.date(from: comps) ?? today
        if d < today { d = cal.date(byAdding: .year, value: 1, to: d) ?? d }
        return d
    }
}

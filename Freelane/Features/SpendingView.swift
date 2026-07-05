import SwiftUI
import SwiftData
import Charts

struct SpendingView: View {
    @Environment(\.modelContext) private var context
    @Environment(UndoCenter.self) private var undo
    @Query private var settings: [AppSettings]
    @Query private var rateRows: [ExchangeRate]
    @Query(filter: #Predicate<Spend> { $0.deletedAt == nil }, sort: \Spend.spentAt, order: .reverse) private var spends: [Spend]
    @Query(filter: #Predicate<Wallet> { $0.deletedAt == nil }) private var wallets: [Wallet]
    @Query(filter: #Predicate<Recurring> { $0.deletedAt == nil }) private var recurrings: [Recurring]
    @State private var showAdd = false
    @State private var showAddRecurring = false
    @State private var editingRecurring: Recurring?
    @State private var payingRecurring: Recurring?
    @State private var editingSpend: Spend?
    @State private var pendingDelete: Spend?
    @State private var sub = 0
    @State private var selMonth: Date?
    @State private var query = ""
    @State private var showBudgets = false
    @Query private var budgets: [CategoryBudget]

    private var base: String { settings.first?.baseCurrency ?? "PHP" }
    /// Full-text filter over description / vendor / category / tags. Empty = everything.
    private var filteredSpends: [Spend] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return spends }
        return spends.filter {
            ($0.spendDescription ?? "").lowercased().contains(q)
            || ($0.vendorName ?? "").lowercased().contains(q)
            || ($0.category ?? "").lowercased().contains(q)
            || $0.tags.contains { $0.lowercased().contains(q) }
        }
    }
    private var monthTotal: Double {
        spends.filter { $0.spentAt >= PHT.startOfMonth() }.reduce(0) { $0 + $1.amountBase }
    }
    private var allTotal: Double { spends.reduce(0) { $0 + $1.amountBase } }
    private var monthSpends: [Spend] { spends.filter { $0.spentAt >= PHT.startOfMonth() } }
    private var investMonth: Double { monthSpends.filter { $0.isInvestment }.reduce(0) { $0 + $1.amountBase } }
    /// This month's spend per category (tags), biggest first.
    private var catData: [(name: String, total: Double)] {
        var d: [String: Double] = [:]
        for s in monthSpends {
            for t in (s.tags.isEmpty ? [s.category ?? "Untagged"] : s.tags) { d[t, default: 0] += s.amountBase }
        }
        return d.sorted { $0.value > $1.value }.prefix(10).map { ($0.key, $0.value) }
    }

    var body: some View {
        Page("Spending", subtitle: "Where your money goes.", toolbar: AnyView(addButton),
             subtabs: ["Spends", "Trends", "Recurring"], selection: $sub) {
            if sub != 2 { spendHero }
            switch sub { case 0: spendsList; case 1: trends; default: recurringList }
        }
        .sheet(isPresented: $showAdd) { AddSpendSheet() }
        .sheet(item: $editingSpend) { AddSpendSheet(existing: $0) }
        .sheet(isPresented: $showAddRecurring) { AddRecurringSheet() }
        .sheet(item: $editingRecurring) { AddRecurringSheet(existing: $0) }
        .sheet(item: $payingRecurring) { PayRecurringSheet(recurring: $0) }
        .confirmationDialog("Delete this spend?", isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }),
                            presenting: pendingDelete) { s in
            Button("Delete", role: .destructive) {
                try? MoneyEngine(context: context).deleteSpend(s.id)
                undo.offer("spend") { try? MoneyEngine(context: context).restoreSpend(s.id) }
                pendingDelete = nil
            }
            Button("Cancel", role: .cancel) { pendingDelete = nil }
        } message: { s in Text("\(s.spendDescription ?? "Spend") · \(CurrencyFormat.string(s.amountBase, base))") }
    }

    /// The screen's one hero: this month's burn, with the 6-month shape and a delta vs
    /// last month — a real "how am I doing" moment instead of two equal-weight tiles.
    private var spendHero: some View {
        let bars = monthly
        let spark = bars.map(\.total)
        var chips: [(text: String, icon: String?, color: Color)] = [
            ("\(monthSpends.count) entries", "cart", Palette.textSecondary),
        ]
        if bars.count >= 2 {
            let cur = bars[bars.count - 1].total, prev = bars[bars.count - 2].total
            if prev > 0 {
                let pct = (cur - prev) / prev
                // Pace vs a partial month is unfair — compare only when meaningful.
                chips.append((String(format: "%+.0f%% vs last month", pct * 100),
                              pct > 0 ? "arrow.up.right" : "arrow.down.right",
                              pct > 0 ? Palette.negative : Palette.positive))
            }
        }
        if investMonth > 0 {
            chips.append(("Investments " + CurrencyFormat.abbreviated(investMonth, base), "arrow.up.forward.circle", Palette.textSecondary))
        }
        return HeroTile(label: "Spent this month", value: monthTotal, code: base,
                        accent: Palette.azure, spark: spark.count > 1 ? spark : [0, 0], chips: chips)
    }

    @ViewBuilder private var categoryCard: some View {
        SectionCard(title: "Spending by category", subtitle: "This month", accent: Palette.warning) {
            if catData.isEmpty {
                Text("Nothing this month yet.").font(.system(size: 13)).foregroundStyle(Palette.textTertiary).frame(maxWidth: .infinity, minHeight: 40)
            } else {
                let maxC = catData.map(\.total).max() ?? 1
                Chart(catData, id: \.name) { c in
                    BarMark(x: .value("Spent", c.total), y: .value("Category", c.name))
                        .foregroundStyle(LinearGradient(colors: [Palette.warning, Palette.warning.opacity(0.55)], startPoint: .leading, endPoint: .trailing))
                        .cornerRadius(5)
                        .annotation(position: .trailing, alignment: .leading, spacing: 6) {
                            Text(CurrencyFormat.string(c.total, base, compact: true))
                                .font(.system(size: 10, weight: .semibold, design: .rounded)).monospacedDigit().foregroundStyle(Palette.textSecondary)
                        }
                }
                .chartXScale(domain: 0...(maxC * 1.3))
                .chartXAxis(.hidden)
                .chartYAxis { AxisMarks(position: .leading) { AxisValueLabel().foregroundStyle(Palette.textSecondary) } }
                .frame(height: CGFloat(catData.count) * 30 + 12)
            }
        }
    }

    @ViewBuilder private var spendsList: some View {
        categoryCard
        budgetsCard
        let list = filteredSpends
        SectionCard(title: "Recent spending",
                    subtitle: query.isEmpty ? "\(spends.count) entries" : "\(list.count) of \(spends.count)",
                    accent: Palette.warning) {
            SearchField(text: $query, placeholder: "Search description, vendor, or tag").padding(.bottom, 10)
            if spends.isEmpty {
                EmptyStateCard(icon: "creditcard", title: "No spending logged yet",
                               message: "Log a spend — type it naturally and the AI sorts the vendor, category, and logo for you.")
            } else if list.isEmpty {
                Text("No matches for “\(query)”.").font(.system(size: 13)).foregroundStyle(Palette.textTertiary)
                    .frame(maxWidth: .infinity, minHeight: 60)
            } else {
                LazyVStack(spacing: 0) {
                    ForEach(list) { s in
                        row(s)
                        if s.id != list.last?.id { Divider().overlay(Palette.hairline) }
                    }
                }
            }
        }
    }

    // MARK: Budgets — gentle monthly caps per category

    @ViewBuilder private var budgetsCard: some View {
        let active = budgets.filter { $0.capBase > 0 }
        SectionCard(title: "Budgets", subtitle: active.isEmpty ? "Gentle monthly caps per category" : "This month",
                    trailing: AnyView(Button("Set budgets") { showBudgets = true }.buttonStyle(.glass).controlSize(.small))) {
            if active.isEmpty {
                Text("Give a category a monthly cap and its bar lives here — a quiet nudge, not an alarm.")
                    .font(.system(size: 12)).foregroundStyle(Palette.textTertiary)
            } else {
                let totals = CategoryBudget.monthTotals(spends)
                VStack(spacing: 10) {
                    ForEach(active.sorted { ($0.capBase > 0 ? (totals[$0.tag.lowercased()] ?? 0) / $0.capBase : 0) > ($1.capBase > 0 ? (totals[$1.tag.lowercased()] ?? 0) / $1.capBase : 0) }) { b in
                        budgetRow(b, spent: totals[b.tag.lowercased()] ?? 0)
                    }
                }
            }
        }
        .sheet(isPresented: $showBudgets) { BudgetsSheet() }
    }

    private func budgetRow(_ b: CategoryBudget, spent: Double) -> some View {
        let frac = b.capBase > 0 ? spent / b.capBase : 0
        let tint: Color = frac >= 1 ? Palette.negative : (frac >= 0.8 ? Palette.warning : Palette.positive)
        return VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(b.tag).font(.system(size: 12, weight: .semibold)).foregroundStyle(Palette.textPrimary)
                Spacer()
                Text("\(CurrencyFormat.string(spent, base, compact: true)) of \(CurrencyFormat.string(b.capBase, base, compact: true))")
                    .font(.system(size: 11, weight: .medium, design: .rounded)).monospacedDigit()
                    .foregroundStyle(frac >= 1 ? Palette.negative : Palette.textSecondary)
                if frac >= 1 {
                    Text("over").font(.system(size: 9, weight: .bold)).foregroundStyle(Palette.negative)
                        .padding(.horizontal, 5).padding(.vertical, 1).background(Palette.negative.opacity(0.16), in: Capsule())
                }
            }
            ProgressView(value: min(frac, 1)).tint(tint).scaleEffect(x: 1, y: 0.7, anchor: .center)
        }
    }

    // MARK: Trends

    private var monthly: [(label: String, total: Double, date: Date)] {
        let cal = PHT.calendar
        let f = DateFormatter(); f.calendar = cal; f.timeZone = PHT.zone; f.dateFormat = "MMM"
        return stride(from: 5, through: 0, by: -1).compactMap { i -> (String, Double, Date)? in
            guard let start = cal.date(byAdding: .month, value: -i, to: PHT.startOfMonth()),
                  let end = cal.date(byAdding: .month, value: 1, to: start) else { return nil }
            let sum = spends.filter { $0.spentAt >= start && $0.spentAt < end }.reduce(0) { $0 + $1.amountBase }
            return (f.string(from: start), sum, start)
        }
    }
    private func nearestMonth(_ d: Date) -> (label: String, total: Double, date: Date)? {
        monthly.min { abs($0.date.timeIntervalSince(d)) < abs($1.date.timeIntervalSince(d)) }
    }
    private var topCats: [(name: String, total: Double)] {
        let m = PHT.startOfMonth()
        var d: [String: Double] = [:]
        for s in spends where s.spentAt >= m {
            // Pure-label: each tag counts the FULL amount (no split). Overlaps are honest.
            let labels = s.tags.isEmpty ? [s.category ?? "Untagged"] : s.tags
            for t in labels { d[t, default: 0] += s.amountBase }
        }
        return d.sorted { $0.value > $1.value }.prefix(8).map { ($0.key, $0.value) }
    }

    @ViewBuilder private var trends: some View {
        SectionCard(title: "Daily spending", subtitle: "Last 26 weeks — darker = a heavier day", accent: Palette.warning) {
            if spends.isEmpty {
                Text("Log spending to see your rhythm.").font(.system(size: 13)).foregroundStyle(Palette.textTertiary).frame(maxWidth: .infinity, minHeight: 60)
            } else {
                SpendHeatmap(spends: spends, base: base).padding(.vertical, 4)
            }
        }
        SectionCard(title: "Monthly spending", subtitle: "Last 6 months", accent: Palette.warning) {
            if spends.isEmpty {
                Text("Log spending to see trends.").font(.system(size: 13)).foregroundStyle(Palette.textTertiary).frame(maxWidth: .infinity, minHeight: 60)
            } else {
                // Exact value shown ABOVE the chart on hover — no annotation that could
                // rescale/shrink the plot.
                let maxV = max(1, monthly.map(\.total).max() ?? 1)
                let selPt = selMonth.flatMap { nearestMonth($0) }
                HStack(spacing: 8) {
                    if let p = selPt {
                        Text(p.label).font(.system(size: 12, weight: .medium)).foregroundStyle(Palette.textSecondary)
                        Text(CurrencyFormat.string(p.total, base)).font(.system(size: 14, weight: .semibold, design: .rounded)).monospacedDigit().foregroundStyle(Palette.warning)
                    } else {
                        Text("Hover a bar for the exact amount").font(.system(size: 11)).foregroundStyle(Palette.textTertiary)
                    }
                    Spacer()
                }
                Chart(monthly, id: \.date) { m in
                    BarMark(x: .value("Month", m.date, unit: .month), y: .value("Spent", m.total))
                        .foregroundStyle(LinearGradient(colors: [Palette.warning, Palette.warning.opacity(0.5)], startPoint: .top, endPoint: .bottom))
                        .cornerRadius(6)
                        .opacity(selPt == nil || selPt?.date == m.date ? 1 : 0.4)
                    if let pt = selPt {
                        RuleMark(x: .value("Month", pt.date, unit: .month)).foregroundStyle(Palette.textTertiary.opacity(0.45))
                    }
                }
                .chartYScale(domain: 0...(maxV * 1.08))       // pinned — hover can't rescale it
                .chartXSelection(value: $selMonth)
                .chartYAxis {
                    AxisMarks(position: .leading) { v in
                        AxisGridLine().foregroundStyle(Palette.hairline)
                        AxisValueLabel { if let d = v.as(Double.self) { Text(CurrencyFormat.abbreviated(d, base)).foregroundStyle(Palette.textTertiary) } }
                    }
                }
                .chartXAxis { AxisMarks(values: .stride(by: .month)) { _ in
                    AxisGridLine().foregroundStyle(Palette.hairline)
                    AxisValueLabel(format: .dateTime.month(.abbreviated)).foregroundStyle(Palette.textTertiary)
                } }
                .frame(height: 200)
            }
        }
        SectionCard(title: "Top categories", subtitle: "This month", accent: Palette.negative) {
            if topCats.isEmpty {
                Text("Nothing this month yet.").font(.system(size: 13)).foregroundStyle(Palette.textTertiary).frame(maxWidth: .infinity, minHeight: 50)
            } else {
                let max = topCats.first?.total ?? 1
                VStack(spacing: 10) {
                    ForEach(topCats, id: \.name) { c in
                        VStack(alignment: .leading, spacing: 5) {
                            HStack {
                                Text(c.name).font(.system(size: 12, weight: .medium)).foregroundStyle(Palette.textPrimary).lineLimit(1)
                                Spacer()
                                Text(CurrencyFormat.string(c.total, base, compact: true))
                                    .font(.system(size: 12, weight: .semibold, design: .rounded)).monospacedDigit().foregroundStyle(Palette.textSecondary)
                            }
                            GeometryReader { geo in
                                Capsule().fill(Palette.warning.opacity(0.25))
                                    .overlay(alignment: .leading) {
                                        Capsule().fill(Palette.warning).frame(width: geo.size.width * (max > 0 ? c.total / max : 0))
                                    }
                            }.frame(height: 6)
                        }
                    }
                }
            }
        }
    }

    private var addButton: some View {
        Button { if sub == 2 { showAddRecurring = true } else { showAdd = true } } label: {
            Label(sub == 2 ? "Add recurring" : "Log spend", systemImage: "plus")
        }
        .buttonStyle(.glassProminent).tint(Palette.warning)
    }

    @ViewBuilder private var recurringList: some View {
        let bills = RecurringMath.expectedBase(recurrings, kind: .expense, days: 30)
        let income = RecurringMath.expectedBase(recurrings, kind: .income, days: 30)
        HStack(spacing: 16) {
            StatTile(label: "Monthly bills", value: bills, code: base, systemImage: "calendar.badge.clock",
                     accent: Palette.negative, chip: ("\(recurrings.filter { $0.kind == .expense }.count)", nil), chipColor: Palette.negative)
            StatTile(label: "Monthly income", value: income, code: base, systemImage: "arrow.down.left",
                     accent: Palette.positive, chip: ("\(recurrings.filter { $0.kind == .income }.count)", nil), chipColor: Palette.positive)
        }
        SectionCard(title: "Recurring", subtitle: "Bills are reserved in your safe-to-spend", accent: Palette.warning) {
            if recurrings.isEmpty {
                EmptyStateCard(icon: "calendar.badge.clock", title: "No recurring bills or income yet",
                               message: "Add rent, subscriptions, or a regular payout so safe-to-spend plans ahead.")
            } else {
                LazyVStack(spacing: 0) {
                    ForEach(recurrings.sorted { $0.label < $1.label }) { r in
                        recurringRow(r)
                        if r.id != recurrings.last?.id { Divider().overlay(Palette.hairline) }
                    }
                }
            }
        }
    }

    private func recurringRow(_ r: Recurring) -> some View {
        let c = r.kind == .income ? Palette.positive : Palette.negative
        return HStack(spacing: 12) {
            Circle().fill(c.opacity(0.18)).frame(width: 34, height: 34)
                .overlay(Image(systemName: r.kind == .income ? "arrow.down.left" : "calendar")
                    .font(.system(size: 12, weight: .bold)).foregroundStyle(c))
            VStack(alignment: .leading, spacing: 2) {
                Text(r.label).font(.system(size: 13, weight: .medium)).foregroundStyle(r.active ? Palette.textPrimary : Palette.textTertiary).lineLimit(1)
                HStack(spacing: 6) {
                    Text("\(r.cadence.label) · \(r.kind.label)")
                    if r.isVariableAmount { Text("· varies").foregroundStyle(Palette.azure) }
                    if r.kind == .expense, let due = RecurringMath.nextDue(r) {
                        let days = PHT.calendar.dateComponents([.day], from: PHT.startOfDay(), to: PHT.startOfDay(due)).day ?? 0
                        let tag = days < 0 ? "(overdue)" : (days == 0 ? "(today)" : "(\(days)d)")
                        Text("· due \(due.formatted(.dateTime.month().day())) \(tag)")
                            .foregroundStyle(days <= 2 ? Palette.negative : Palette.textTertiary)
                    }
                }.font(.system(size: 11)).foregroundStyle(Palette.textTertiary).lineLimit(1)
            }
            Spacer()
            Text(CurrencyFormat.string(r.amountBase, base, compact: true))
                .font(.system(size: 13, weight: .semibold, design: .rounded)).monospacedDigit().foregroundStyle(c)
            if r.kind == .expense {
                Button("Pay") { payingRecurring = r }.buttonStyle(.glass).controlSize(.small)
                    .help("Log this bill as paid")
            }
            Toggle("", isOn: Binding(get: { r.active }, set: { r.active = $0; r.dirty = true; try? context.save() }))
                .labelsHidden().toggleStyle(.switch).tint(Palette.warning).controlSize(.mini)
                .help(r.active ? "Active — reserved in safe-to-spend" : "Paused")
                .accessibilityLabel("\(r.label) active")
            Menu {
                Button("Edit", systemImage: "pencil") { editingRecurring = r }
                Button("Delete", systemImage: "trash", role: .destructive) { undo.trashSimple(r, label: "recurring", context: context) }
            } label: { Image(systemName: "ellipsis").foregroundStyle(Palette.textTertiary).frame(width: 22) }.menuStyle(.borderlessButton).frame(width: 22)
                .help("More actions")
                .accessibilityLabel("More actions for \(r.label)")
        }
        .padding(.vertical, 9)
        .hoverRow()
        .onTapGesture { editingRecurring = r }
    }

    private func walletName(_ id: UUID?) -> String? { id.flatMap { i in wallets.first { $0.id == i }?.name } }

    private func row(_ s: Spend) -> some View {
        let title = s.spendDescription ?? s.vendorName ?? "Spend"
        let tagLine = s.tags.isEmpty ? s.category : s.tags.joined(separator: ", ")
        return HStack(spacing: 12) {
            if s.isSadaka {
                Circle().fill(Palette.negative.opacity(0.18)).frame(width: 34, height: 34)
                    .overlay(Image(systemName: "heart.fill").font(.system(size: 12, weight: .bold)).foregroundStyle(Palette.negative))
            } else if let v = s.vendorName, !v.isEmpty {
                VendorMark(name: v, size: 34)
            } else {
                Circle().fill(Palette.warning.opacity(0.18)).frame(width: 34, height: 34)
                    .overlay(Image(systemName: "arrow.up.right").font(.system(size: 12, weight: .bold)).foregroundStyle(Palette.warning))
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.system(size: 13, weight: .medium)).foregroundStyle(Palette.textPrimary).lineLimit(1)
                HStack(spacing: 6) {
                    Text(s.spentAt, format: .dateTime.month().day().year())
                    if let w = walletName(s.walletId) { Text("· \(w)") }
                    if let t = tagLine, !t.isEmpty { Text("· \(t)") }
                }.font(.system(size: 11)).foregroundStyle(Palette.textTertiary).lineLimit(1)
            }
            Spacer()
            Text("−" + CurrencyFormat.string(s.amountBase, base))
                .font(.system(size: 13, weight: .semibold, design: .rounded)).monospacedDigit().foregroundStyle(Palette.textPrimary)
            Menu {
                Button("Edit", systemImage: "pencil") { editingSpend = s }
                Button("Delete", systemImage: "trash", role: .destructive) { pendingDelete = s }
            } label: { Image(systemName: "ellipsis").foregroundStyle(Palette.textTertiary).frame(width: 24, height: 24) }
                .menuStyle(.borderlessButton).frame(width: 24)
                .help("More actions")
                .accessibilityLabel("More actions for \(title)")
        }
        .padding(.vertical, 9)
        .hoverRow()
        .onTapGesture { editingSpend = s }
    }
}

struct AddSpendSheet: View {
    var existing: Spend? = nil
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @Query(filter: #Predicate<Wallet> { $0.deletedAt == nil }, sort: \Wallet.name) private var wallets: [Wallet]
    @Query private var settings: [AppSettings]

    @Query(filter: #Predicate<Spend> { $0.deletedAt == nil }) private var allSpends: [Spend]
    @Query private var ledger: [LedgerEntry]
    @Query private var rateRows: [ExchangeRate]
    @Query(filter: #Predicate<SpendItem> { $0.deletedAt == nil }) private var allItems: [SpendItem]
    @State private var loaded = false
    @State private var itemized = false
    @State private var lines: [LineDraft] = [LineDraft()]
    @State private var aiVerdicts: [String: String] = [:]
    @State private var checkingDeals = false

    struct LineDraft: Identifiable { let id = UUID(); var name = ""; var qty = ""; var price = "" }
    @State private var walletId: UUID?
    @State private var lastSuggested: UUID?
    /// Once the user picks a wallet themselves, the smart-suggestion must never silently
    /// override it again (it used to flip back to the highest-headroom wallet — usually Cash —
    /// every time the amount changed, breaking the math the user had just set).
    @State private var userPickedWallet = false
    @State private var amount = ""
    @State private var currency = "PHP"
    @State private var desc = ""
    @State private var vendor = ""
    @State private var tags: Set<String> = []
    @State private var newTag = ""
    @State private var isSadaka = false
    @State private var isBusiness = false
    @State private var isHouse = false
    @State private var date = Date.now
    @State private var error: String?
    @State private var scanning = false
    @FocusState private var amountFocused: Bool

    /// Distinct vendor names you've used before, for autocomplete.
    private var vendorSuggestions: [String] {
        let q = vendor.trimmingCharacters(in: .whitespaces).lowercased()
        guard q.count >= 1 else { return [] }
        var seen = Set<String>(); var out: [String] = []
        for s in allSpends {
            guard let v = s.vendorName, !v.isEmpty, v.lowercased() != q, v.lowercased().contains(q) else { continue }
            let key = v.lowercased()
            if !seen.contains(key) { seen.insert(key); out.append(v) }
        }
        return Array(out.prefix(5))
    }

    private var holding: [Wallet] { wallets.filter { $0.isHolding && !$0.archived } }
    /// Smart routing: the wallet you usually use for these tags, else the healthiest
    /// one that comfortably covers the amount — keeps balances sane.
    private var suggestedWallet: Wallet? {
        let amt = parseAmount(amount) ?? 0
        // Tag-dominant wallet from history.
        if !tags.isEmpty {
            let tagged = allSpends.filter { !Set($0.tags).isDisjoint(with: tags) && $0.walletId != nil }
            let counts = Dictionary(grouping: tagged.compactMap { $0.walletId }, by: { $0 }).mapValues { $0.count }
            if let domId = counts.max(by: { $0.value < $1.value })?.key,
               let w = holding.first(where: { $0.id == domId }),
               WalletMath.balance(of: w, ledger: ledger) >= amt { return w }
        }
        // Else the wallet with the most headroom that still covers it.
        return holding.filter { WalletMath.balance(of: $0, ledger: ledger) >= amt }
            .max { WalletMath.balance(of: $0, ledger: ledger) < WalletMath.balance(of: $1, ledger: ledger) }
            ?? holding.max { WalletMath.balance(of: $0, ledger: ledger) < WalletMath.balance(of: $1, ledger: ledger) }
    }
    /// Update the suggestion unless the user has picked a different wallet themselves.
    private func applySuggestion() {
        guard !userPickedWallet else { return }   // user's explicit choice is sacred
        let s = suggestedWallet?.id
        if walletId == nil || walletId == lastSuggested { walletId = s }
        lastSuggested = s
    }

    private let currencies = CurrencyFormat.supported
    private var base: String { settings.first?.baseCurrency ?? "PHP" }
    private var rates: Rates { Rates(base: base, rates: rateRows) }
    private var itemizedTotal: Double { lines.compactMap { parseAmount($0.price) }.reduce(0, +) }
    private var effectiveAmount: Double { itemized ? itemizedTotal : (parseAmount(amount) ?? 0) }
    private static let seedTags = ["Food", "Eating out", "Groceries", "Transport", "Bills",
                                   "Health", "Cigarettes", "Pet", "Gifts", "Tech", "Sadaka"]
    private var knownTags: [String] {
        var set = Set(Self.seedTags)
        for s in allSpends { set.formUnion(s.tags) }
        return set.sorted()
    }

    var body: some View {
        SheetScaffold(title: existing == nil ? "Log spend" : "Edit spend", accent: Palette.warning,
                      canSave: walletId != nil && effectiveAmount > 0, onSave: save) {
            if existing == nil {
                Button {
                    scanning = true
                    ReceiptOCR.pickAndScan { result in
                        scanning = false
                        guard let r = result else { return }
                        if let a = r.amount { amount = editAmountString(a) }
                        if let v = r.vendor, vendor.isEmpty { vendor = v }
                    }
                } label: {
                    Label(scanning ? "Scanning…" : "Scan a receipt", systemImage: "doc.text.viewfinder")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.glass).controlSize(.large).disabled(scanning)
                Text("On-device OCR fills in the amount and vendor — always editable below.")
                    .font(.system(size: 10)).foregroundStyle(Palette.textTertiary)
            }
            LabeledField("From wallet") {
                GlassMenuPicker(selection: Binding(get: { walletId },
                                                   set: { walletId = $0; userPickedWallet = true }),
                                options: [UUID?.none] + holding.map { UUID?.some($0.id) },
                                label: { id in id.flatMap { i in holding.first { $0.id == i }?.name } ?? "Select…" })
                if existing == nil, walletId != nil, walletId == lastSuggested {
                    Text("Suggested — keeps your wallets balanced").font(.system(size: 10)).foregroundStyle(Palette.teal)
                }
            }
            HStack(spacing: 12) {
                LabeledField("Amount") {
                    if itemized {
                        Text(CurrencyFormat.string(itemizedTotal, currency)).font(.system(size: 15, weight: .semibold, design: .rounded))
                            .foregroundStyle(Palette.textPrimary).frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 13).padding(.vertical, 11)
                            .insetRow(cornerRadius: Radii.field, hoverable: false)
                    } else {
                        TextField("0", text: $amount).textFieldStyle(GlassFieldStyle())
                            .focused($amountFocused)
                    }
                }
                LabeledField("Currency") { CurrencyMenu(selection: $currency, options: currencies) }
            }
            if existing == nil {
                Toggle(isOn: $itemized.animation()) {
                    Text("Itemize — log a whole receipt, line by line").font(.system(size: 13)).foregroundStyle(Palette.textPrimary)
                }.toggleStyle(.switch).tint(Palette.warning)
            }
            if itemized { itemizedSection }
            LabeledField("Description") { TextField("What was it for?", text: $desc).textFieldStyle(GlassFieldStyle()) }
            LabeledField("Vendor") {
                TextField("store / who you paid", text: $vendor).textFieldStyle(GlassFieldStyle())
                if !vendorSuggestions.isEmpty {     // autocomplete from your past vendors
                    HStack(spacing: 6) {
                        ForEach(vendorSuggestions, id: \.self) { v in
                            Button { vendor = v } label: {
                                Text(v).font(.system(size: 11, weight: .medium)).foregroundStyle(Palette.warning)
                                    .padding(.horizontal, 9).padding(.vertical, 4)
                                    .background(Palette.warning.opacity(0.14), in: Capsule())
                            }.buttonStyle(.cardPress)
                        }
                        Spacer(minLength: 0)
                    }
                }
            }
            LabeledField("Tags — pick any (each counts in full)") {
                FlexTags(all: knownTags, selected: $tags)
            }
            HStack(spacing: 8) {
                TextField("New tag", text: $newTag).textFieldStyle(GlassFieldStyle())
                    .onSubmit { addNewTag() }   // ⏎ here adds the tag instead of saving the sheet
                Button("Add") { addNewTag() }
                    .buttonStyle(.glass).disabled(newTag.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            LabeledField("Date") { GlassDateField(date: $date) }
            LabeledField("Kind of spend") {
                VStack(alignment: .leading, spacing: 8) {
                    Toggle(isOn: $isSadaka) { Text("Sadaka (charity)").font(.system(size: 13)).foregroundStyle(Palette.textPrimary) }
                        .toggleStyle(.switch).tint(Palette.teal)
                    Toggle(isOn: $isBusiness) { Text("Business investment (gear, software…)").font(.system(size: 13)).foregroundStyle(Palette.textPrimary) }
                        .toggleStyle(.switch).tint(Palette.azure)
                    Toggle(isOn: $isHouse) { Text("Home / relationship (furniture, the wife…)").font(.system(size: 13)).foregroundStyle(Palette.textPrimary) }
                        .toggleStyle(.switch).tint(Palette.violet)
                    if isBusiness || isHouse {
                        Text("Counts in your total spending, but treated as an intentional investment — not your everyday pace.")
                            .font(.system(size: 10)).foregroundStyle(Palette.textTertiary)
                    }
                }
            }
            if let error { Text(error).font(.caption).foregroundStyle(Palette.negative) }
        }
        .onAppear {
            guard !loaded else { return }; loaded = true
            if let e = existing {
                walletId = e.walletId; amount = editAmountString(e.amount); currency = e.currency
                desc = e.spendDescription ?? ""; vendor = e.vendorName ?? ""
                tags = Set(e.tags); isSadaka = e.isSadaka; isBusiness = e.isBusiness; isHouse = e.isHouse; date = e.spentAt
            } else {
                currency = settings.first?.baseCurrency ?? "PHP"; applySuggestion()
            }
            // Land the cursor in the amount field once the sheet has settled.
            DispatchQueue.main.async { amountFocused = true }
        }
        .onChange(of: tags) { _, _ in if existing == nil { applySuggestion() } }
        .onChange(of: amount) { _, _ in if existing == nil { applySuggestion() } }
    }

    @State private var ai = AIManager()

    private func addNewTag() {
        let t = newTag.trimmingCharacters(in: .whitespaces)
        if !t.isEmpty { tags.insert(TagNormalizer.canonical(t, known: knownTags)); newTag = "" }
    }

    // MARK: Itemized receipt

    private var itemizedSection: some View {
        LabeledField("Items — name, qty, price. The AI remembers each item's price for you.") {
            VStack(spacing: 8) {
                ForEach($lines) { $line in lineRow($line) }
                HStack {
                    Button { lines.append(LineDraft()) } label: { Label("Add item", systemImage: "plus") }
                        .buttonStyle(.glass).controlSize(.small)
                    Spacer()
                    Button { checkDeals() } label: { Label(checkingDeals ? "Checking…" : "Ask AI: good deals?", systemImage: "sparkles") }
                        .buttonStyle(.glass).controlSize(.small)
                        .disabled(checkingDeals || !ai.isReady || lines.allSatisfy { parseAmount($0.price) == nil })
                        .help("Needs a brain (Settings → AI) and at least one priced line")
                }
            }
        }
    }

    private func checkDeals() {
        let items = lines.compactMap { l -> (name: String, unitPrice: Double)? in
            let p = parseLine(l)
            guard !p.name.isEmpty, let total = parseAmount(l.price), total > 0 else { return nil }
            return (p.name, rates.toBase(total, currency) / p.qty)
        }
        guard !items.isEmpty else { return }
        checkingDeals = true
        let mgr = ai, b = base
        Task {
            let verdicts = await Brain.receiptDealCheck(mgr, items: items, base: b)
            await MainActor.run { aiVerdicts = verdicts; checkingDeals = false }
        }
    }

    @ViewBuilder
    private func lineRow(_ line: Binding<LineDraft>) -> some View {
        let l = line.wrappedValue
        let parsed = parseLine(l)
        let total = parseAmount(l.price) ?? 0
        let unitBase = parsed.qty > 0 ? rates.toBase(total, currency) / parsed.qty : 0
        let hist = PriceMemory.history(for: parsed.name, items: allItems)
        let deal = total > 0 ? PriceMemory.judge(unitPriceBase: unitBase, history: hist) : .firstTime
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 8) {
                TextField("10 packs Camel", text: line.name).textFieldStyle(GlassFieldStyle())
                TextField("qty", text: line.qty).textFieldStyle(GlassFieldStyle()).frame(width: 46)
                TextField("price", text: line.price).textFieldStyle(GlassFieldStyle()).frame(width: 76)
                if lines.count > 1 {
                    Button { lines.removeAll { $0.id == l.id } } label: { Image(systemName: "minus.circle") }
                        .buttonStyle(.iconPress).foregroundStyle(Palette.negative)
                        .help("Remove this item")
                        .accessibilityLabel("Remove item")
                }
            }
            if total > 0, let h = hist {
                switch deal {
                case .cheaper(let p): Text("↓ \(p)% under your usual \(CurrencyFormat.string(h.avg, base, compact: true))/ea — good deal").font(.system(size: 10, weight: .medium)).foregroundStyle(Palette.positive)
                case .pricier(let p): Text("↑ \(p)% over your usual \(CurrencyFormat.string(h.avg, base, compact: true))/ea").font(.system(size: 10, weight: .medium)).foregroundStyle(Palette.warning)
                case .usual: Text("≈ your usual \(CurrencyFormat.string(h.avg, base, compact: true))/ea").font(.system(size: 10)).foregroundStyle(Palette.textTertiary)
                case .firstTime: EmptyView()
                }
            } else if parsed.qty > 1 {
                Text("\(parsed.name) · \(Int(parsed.qty))× = \(total > 0 ? CurrencyFormat.string(rates.toBase(total, currency)/parsed.qty, base, compact: true) + "/ea" : "")")
                    .font(.system(size: 10)).foregroundStyle(Palette.textTertiary)
            }
            if let v = aiVerdicts[parsed.name] {
                Label(v, systemImage: "sparkle").font(.system(size: 10, weight: .medium)).foregroundStyle(Palette.cyan).labelStyle(.titleAndIcon)
            }
        }
    }

    /// Pull quantity out of an item line. Explicit qty field wins; else a leading "N <unit>" in the
    /// name (e.g. "10 packs Camel" → qty 10, name "Camel") — a bare number is left as the name.
    private func parseLine(_ l: LineDraft) -> (qty: Double, name: String) {
        if let q = parseAmount(l.qty), q > 0 { return (q, l.name.trimmingCharacters(in: .whitespaces)) }
        let name = l.name
        let pattern = #"^\s*(\d+(?:\.\d+)?)\s*(packs?|pcs?|pieces?|kgs?|kilos?|grams?|g|bottles?|cans?|boxes?|sachets?|x)\s+(.+)$"#
        if let re = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]),
           let m = re.firstMatch(in: name, range: NSRange(name.startIndex..., in: name)),
           let qR = Range(m.range(at: 1), in: name), let nR = Range(m.range(at: 3), in: name),
           let q = Double(name[qR]) {
            return (q, String(name[nR]).trimmingCharacters(in: .whitespaces))
        }
        return (1, name.trimmingCharacters(in: .whitespaces))
    }

    /// Create the SpendItem rows for an itemized spend (the price-memory record).
    private func saveItems(spendId: UUID) {
        for l in lines {
            let p = parseLine(l)
            guard !p.name.isEmpty, let total = parseAmount(l.price), total > 0 else { continue }
            let item = SpendItem(spendId: spendId, name: p.name, quantity: p.qty,
                                 lineTotal: total, lineTotalBase: round2(rates.toBase(total, currency)),
                                 currency: currency)
            item.dirty = true; context.insert(item)
        }
        try? context.save()
    }

    private func save() {
        let amt = itemized ? itemizedTotal : (parseAmount(amount) ?? 0)
        guard amt > 0 else { return }
        do {
            let engine = MoneyEngine(context: context)
            if let e = existing {
                try engine.updateSpend(e.id, walletId: walletId, amount: amt, currency: currency,
                                       description: desc.isEmpty ? nil : desc, vendorName: vendor.isEmpty ? nil : vendor,
                                       category: tags.first, isSadaka: isSadaka, spentAt: date, tags: Array(tags),
                                       isBusiness: isBusiness, isHouse: isHouse)
                // Learning loop: remember this categorization so understandSpend stops mis-tagging it.
                if let firstTag = tags.first {
                    let text = [vendor, desc].filter { !$0.isEmpty }.joined(separator: " ")
                    Corrections.record(text: text, category: firstTag)
                }
            } else {
                // When itemizing with no description, summarize the receipt (e.g. "Salt, Rice +3 more").
                let autoDesc: String? = {
                    guard itemized, desc.isEmpty else { return desc.isEmpty ? nil : desc }
                    let names = lines.map { parseLine($0).name }.filter { !$0.isEmpty }
                    guard !names.isEmpty else { return nil }
                    return names.count <= 2 ? names.joined(separator: ", ")
                        : names.prefix(2).joined(separator: ", ") + " +\(names.count - 2) more"
                }()
                let id = try engine.createSpend(
                    walletId: walletId, amount: amt, currency: currency,
                    description: autoDesc, vendorName: vendor.isEmpty ? nil : vendor,
                    category: tags.first, isSadaka: isSadaka, spentAt: date, tags: Array(tags),
                    isBusiness: isBusiness, isHouse: isHouse)
                if itemized { saveItems(spendId: id) }
                let ctx = context, mgr = ai
                Task { await Brain.onSpendLogged(ctx, ai: mgr, spendId: id) }
            }
            WidgetBridge.update(context)   // keep the desktop widget in step on every save
            dismiss()
        } catch { self.error = error.localizedDescription }
    }
}

/// A wrapping row of toggleable tag chips.
struct FlexTags: View {
    var all: [String]
    @Binding var selected: Set<String>
    private let cols = [GridItem(.adaptive(minimum: 84), spacing: 7, alignment: .leading)]
    var body: some View {
        LazyVGrid(columns: cols, alignment: .leading, spacing: 7) {
            ForEach(all, id: \.self) { t in
                let on = selected.contains(t)
                Button { if on { selected.remove(t) } else { selected.insert(t) } } label: {
                    Text(t).font(.system(size: 11, weight: on ? .semibold : .medium))
                        .foregroundStyle(on ? Palette.ink : Palette.textSecondary)
                        .padding(.horizontal, 10).padding(.vertical, 6)
                        .frame(maxWidth: .infinity)
                        .background(on ? AnyShapeStyle(Palette.acidLime) : AnyShapeStyle(Palette.hairline), in: Capsule())
                }.buttonStyle(.cardPress)
            }
        }
    }
}

/// Settle a recurring bill from the spending side — log it now, or prepay months ahead.
struct PayRecurringSheet: View {
    let recurring: Recurring
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @Query(filter: #Predicate<Wallet> { $0.deletedAt == nil }, sort: \Wallet.name) private var wallets: [Wallet]
    @Query private var settings: [AppSettings]
    @Query(filter: #Predicate<Spend> { $0.deletedAt == nil }, sort: \Spend.spentAt, order: .reverse) private var allSpends: [Spend]
    @State private var ai = AIManager()
    @State private var loaded = false
    @State private var walletId: UUID?
    @State private var amount = ""
    @State private var fee = ""
    @State private var periods = 1
    @State private var date = Date.now
    @State private var updateRule = false
    @State private var error: String?
    @FocusState private var amountFocused: Bool

    private var base: String { settings.first?.baseCurrency ?? "PHP" }
    private var holding: [Wallet] { wallets.filter { $0.isHolding && !$0.archived } }
    private var unit: String { recurring.cadence == .weekly ? "week" : (recurring.cadence == .yearly ? "year" : "month") }
    private var amt: Double { parseAmount(amount) ?? 0 }
    private var feeVal: Double { max(0, parseAmount(fee) ?? 0) }
    private var total: Double { amt * Double(periods) + feeVal }
    private var history: [Spend] { allSpends.filter { $0.recurringId == recurring.id }.prefix(4).map { $0 } }

    private var nextDue: Date? { RecurringMath.nextDue(recurring) }
    private var daysUntilDue: Int? { nextDue.map { PHT.calendar.dateComponents([.day], from: PHT.startOfDay(), to: $0).day ?? 0 } }

    var body: some View {
        SheetScaffold(title: "Pay “\(recurring.label)”", accent: Palette.warning, icon: "calendar.badge.checkmark",
                      canSave: walletId != nil && amt > 0, onSave: save) {
            if let due = nextDue {
                HStack(spacing: 8) {
                    Image(systemName: "calendar").font(.system(size: 12, weight: .semibold)).foregroundStyle(Palette.warning)
                    Text("Due \(due.formatted(.dateTime.month().day()))").font(.system(size: 12, weight: .medium)).foregroundStyle(Palette.textPrimary)
                    if let d = daysUntilDue {
                        Text(d <= 0 ? "· due now" : "· in \(d) day\(d == 1 ? "" : "s")")
                            .font(.system(size: 11)).foregroundStyle(d <= 2 ? Palette.negative : Palette.textTertiary)
                    }
                    Spacer()
                }.padding(11).glassCard(cornerRadius: Radii.field)
            }
            HStack(spacing: 12) {
                LabeledField(recurring.isVariableAmount ? "Amount paid (the real bill)" : "Amount") {
                    TextField(recurring.isVariableAmount ? "what was it this time?" : "0", text: $amount).textFieldStyle(GlassFieldStyle())
                        .focused($amountFocused)
                }
                LabeledField("Fee (optional)") { TextField("wallet charge", text: $fee).textFieldStyle(GlassFieldStyle()) }
            }
            if recurring.isVariableAmount, recurring.amount > 0 {
                Text("Last time was about \(CurrencyFormat.string(recurring.amount, recurring.currency, compact: true)).")
                    .font(.system(size: 10)).foregroundStyle(Palette.textTertiary)
            }
            LabeledField("From wallet") {
                GlassMenuPicker(selection: $walletId,
                                options: [UUID?.none] + holding.map { UUID?.some($0.id) },
                                label: { id in id.flatMap { i in holding.first { $0.id == i }?.name } ?? "Select…" })
            }
            LabeledField("Pay ahead") {
                Stepper(value: $periods, in: 1...24) {
                    Text(periods == 1 ? "This \(unit)" : "\(periods) \(unit)s in advance")
                        .font(.system(size: 14)).foregroundStyle(Palette.textPrimary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 11).padding(.vertical, 8)
                .insetRow(cornerRadius: Radii.field, hoverable: false)
            }
            LabeledField("Date") { GlassDateField(date: $date) }
            if !recurring.isVariableAmount {
                Toggle(isOn: $updateRule) {
                    Text("Make this the new amount going forward").font(.system(size: 13)).foregroundStyle(Palette.textPrimary)
                }.toggleStyle(.switch).tint(Palette.azure)
            }
            HStack {
                Text("Total to log").tileLabel()
                Spacer()
                Text(CurrencyFormat.string(total, recurring.currency, compact: true))
                    .font(.system(size: 18, weight: .semibold, design: .rounded)).monospacedDigit().foregroundStyle(Palette.warning)
            }.padding(12).glassCard(cornerRadius: Radii.field)
            if !history.isEmpty {
                LabeledField("Recent payments") {
                    VStack(spacing: 6) {
                        ForEach(history) { s in
                            HStack {
                                Text(s.spentAt, format: .dateTime.month().day().year()).font(.system(size: 11)).foregroundStyle(Palette.textTertiary)
                                Spacer()
                                Text(CurrencyFormat.string(s.amountBase, base, compact: true)).font(.system(size: 11, weight: .medium, design: .rounded)).monospacedDigit().foregroundStyle(Palette.textSecondary)
                            }
                        }
                    }
                }
            }
            if let error { Text(error).font(.caption).foregroundStyle(Palette.negative) }
        }
        .onAppear {
            guard !loaded else { return }; loaded = true
            walletId = recurring.walletId ?? holding.first?.id
            if !recurring.isVariableAmount, recurring.amount > 0 { amount = editAmountString(recurring.amount) }
            DispatchQueue.main.async { amountFocused = true }
        }
    }

    private func save() {
        let prior = recurring.amount
        do {
            try MoneyEngine(context: context).markRecurringPaid(
                recurringId: recurring.id, amount: amt, fee: feeVal, periods: periods,
                walletId: walletId, on: date, updateRule: updateRule)
            // Variable bill creeping up? Flag it with an AI-guessed reason.
            if recurring.isVariableAmount, prior > 0, amt > prior * 1.2 {
                let ctx = context, mgr = ai, lbl = recurring.label, cur = recurring.currency
                Task { await Brain.flagBillIncrease(ctx, ai: mgr, label: lbl, prior: prior, now: amt, currency: cur) }
            }
            dismiss()
        } catch { self.error = error.localizedDescription }
    }
}

/// GitHub-style spend heatmap — one cell per day, intensity = spend that day.
struct SpendHeatmap: View {
    let spends: [Spend]
    var base: String = "PHP"
    var weeks = 26
    private let cell: CGFloat = 13, gap: CGFloat = 3

    private var data: [(date: Date, total: Double)] {
        let cal = PHT.calendar
        let today = PHT.startOfDay()
        let begin = cal.date(byAdding: .day, value: -(weeks * 7 - 1), to: today)!
        let anchor = cal.dateInterval(of: .weekOfYear, for: begin)?.start ?? begin
        var totals: [Date: Double] = [:]
        for s in spends where s.spentAt >= anchor && s.amountBase > 0 {
            totals[cal.startOfDay(for: s.spentAt), default: 0] += s.amountBase
        }
        let count = (cal.dateComponents([.day], from: anchor, to: today).day ?? 0) + 1
        return (0..<count).compactMap { i in
            cal.date(byAdding: .day, value: i, to: anchor).map { ($0, totals[cal.startOfDay(for: $0)] ?? 0) }
        }
    }

    @State private var sel: (date: Date, total: Double)?

    private func color(_ v: Double, _ maxV: Double) -> Color {
        guard v > 0 else { return Palette.hairline }
        return Palette.warning.opacity(0.28 + 0.62 * min(1, v / maxV))
    }
    private func weekdayLabel(_ row: Int, _ d: [(date: Date, total: Double)]) -> String {
        guard row < d.count else { return "" }
        let f = DateFormatter(); f.calendar = PHT.calendar; f.timeZone = PHT.zone; f.dateFormat = "EEEEE"
        return f.string(from: d[row].date)
    }

    var body: some View {
        let d = data
        let maxV = max(1, d.map(\.total).max() ?? 1)
        let cols = (d.count + 6) / 7
        return VStack(alignment: .leading, spacing: 8) {
            // Hover readout — the day + what you spent.
            HStack(spacing: 8) {
                if let s = sel {
                    Text(s.date.formatted(.dateTime.weekday(.wide).month().day())).font(.system(size: 12, weight: .medium)).foregroundStyle(Palette.textSecondary)
                    Text(s.total > 0 ? CurrencyFormat.string(s.total, base) : "nothing spent").font(.system(size: 13, weight: .semibold, design: .rounded)).monospacedDigit().foregroundStyle(s.total > 0 ? Palette.warning : Palette.textTertiary)
                } else {
                    Text("Hover a day to see what you spent").font(.system(size: 11)).foregroundStyle(Palette.textTertiary)
                }
                Spacer()
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: gap) {
                    VStack(spacing: gap) {       // weekday labels
                        ForEach(0..<7, id: \.self) { row in
                            Text(weekdayLabel(row, d)).font(.system(size: 9)).foregroundStyle(Palette.textTertiary)
                                .frame(width: 14, height: cell, alignment: .trailing)
                        }
                    }
                    ForEach(0..<cols, id: \.self) { w in
                        VStack(spacing: gap) {
                            ForEach(0..<7, id: \.self) { row in
                                let idx = w * 7 + row
                                if idx < d.count {
                                    let isSel = sel.map { PHT.calendar.isDate($0.date, inSameDayAs: d[idx].date) } ?? false
                                    RoundedRectangle(cornerRadius: 2.5, style: .continuous)
                                        .fill(color(d[idx].total, maxV))
                                        .frame(width: cell, height: cell)
                                        .overlay(RoundedRectangle(cornerRadius: 2.5).strokeBorder(Palette.textPrimary.opacity(isSel ? 0.85 : 0), lineWidth: 1))
                                        .onHover { if $0 { sel = (d[idx].date, d[idx].total) } }
                                } else { Color.clear.frame(width: cell, height: cell) }
                            }
                        }
                    }
                }.padding(.vertical, 2)
            }
        }
    }
}

struct AddRecurringSheet: View {
    var existing: Recurring? = nil
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @Query private var settings: [AppSettings]
    @Query private var rateRows: [ExchangeRate]
    @State private var loaded = false
    @State private var label = ""
    @State private var amount = ""
    @State private var currency = "PHP"
    @State private var kind: RecurringKind = .expense
    @State private var cadence: RecurringCadence = .monthly
    @State private var dayOfMonth = 1
    @State private var date = Date.now
    @State private var isVariable = false
    @FocusState private var labelFocused: Bool

    private var base: String { settings.first?.baseCurrency ?? "PHP" }
    private let currencies = CurrencyFormat.supported

    var body: some View {
        SheetScaffold(title: existing == nil ? "New recurring" : "Edit recurring", accent: Palette.warning,
                      canSave: !label.isEmpty && (isVariable || parseAmount(amount) != nil), onSave: save) {
            LabeledField("Label") { TextField("e.g. Rent, Netflix, Electricity", text: $label).textFieldStyle(GlassFieldStyle()).focused($labelFocused) }
            LabeledField("Type") { GlassSegment(options: Array(RecurringKind.allCases), selection: $kind) { $0.label } }
            LabeledField("Cadence") { GlassSegment(options: Array(RecurringCadence.allCases), selection: $cadence) { $0.label } }
            Toggle(isOn: $isVariable.animation()) {
                VStack(alignment: .leading, spacing: 1) {
                    Text("Amount varies (electricity, water…)").font(.system(size: 13)).foregroundStyle(Palette.textPrimary)
                    Text("Enter the real amount when you pay. The app learns a typical figure to reserve, and flags it if it's creeping up.")
                        .font(.system(size: 10)).foregroundStyle(Palette.textTertiary)
                }
            }.toggleStyle(.switch).tint(Palette.azure)
            HStack(spacing: 12) {
                LabeledField(isVariable ? "Typical amount (estimate)" : "Amount") {
                    TextField(isVariable ? "e.g. 470 — optional" : "0", text: $amount).textFieldStyle(GlassFieldStyle())
                }
                LabeledField("Currency") { CurrencyMenu(selection: $currency, options: currencies) }
            }
            if cadence == .monthly {
                LabeledField("Day of month") {
                    Stepper(value: $dayOfMonth, in: 1...28) {
                        Text("Day \(dayOfMonth)").font(.system(size: 14)).foregroundStyle(Palette.textPrimary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 11).padding(.vertical, 8)
                    .insetRow(cornerRadius: Radii.field, hoverable: false)
                }
            } else {
                LabeledField("First / next date") { GlassDateField(date: $date) }
            }
        }
        .onAppear {
            guard !loaded else { return }; loaded = true
            if let e = existing {
                label = e.label; amount = e.amount > 0 ? editAmountString(e.amount) : ""; currency = e.currency
                kind = e.kind; cadence = e.cadence; dayOfMonth = e.dayOfMonth ?? 1; isVariable = e.isVariableAmount
            } else { currency = base }
            DispatchQueue.main.async { labelFocused = true }
        }
    }

    private func save() {
        let amt = parseAmount(amount) ?? 0
        let rates = Rates(base: base, rates: rateRows)
        let ab = round2(rates.toBase(amt, currency))
        let day = cadence == .monthly ? dayOfMonth : nil
        if let e = existing {
            e.label = label; e.amount = amt; e.currency = currency; e.amountBase = ab
            e.kind = kind; e.cadence = cadence; e.dayOfMonth = day; e.isVariableAmount = isVariable; e.dirty = true
        } else {
            let r = Recurring(label: label, kind: kind, cadence: cadence, amount: amt,
                              currency: currency, amountBase: ab)
            r.dayOfMonth = day; r.isVariableAmount = isVariable; r.dirty = true; context.insert(r)
        }
        try? context.save(); dismiss()
    }
}

// MARK: - Forgiving amount input

/// Forgiving money parse — accepts "1,500", "1 500", " 1500 " the way a human types them.
fileprivate func parseAmount(_ s: String) -> Double? {
    Double(s.replacingOccurrences(of: ",", with: "").replacingOccurrences(of: " ", with: ""))
}

/// Clean editable string for a stored amount ("2500", "2500.5" — never "2500.0").
fileprivate func editAmountString(_ v: Double) -> String {
    v.truncatingRemainder(dividingBy: 1) == 0 ? String(format: "%.0f", v) : String(v)
}

// MARK: - Budgets editor

/// Set gentle monthly caps per category. Rows are the union of categories you actually
/// spend in (last 90 days, biggest first) and any tags that already have a budget —
/// leave a cap empty (or 0) to remove it.
struct BudgetsSheet: View {
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @Query private var settings: [AppSettings]
    @Query(filter: #Predicate<Spend> { $0.deletedAt == nil }) private var spends: [Spend]
    @Query private var budgets: [CategoryBudget]
    @State private var caps: [String: String] = [:]   // display tag → cap text

    private var base: String { settings.first?.baseCurrency ?? "PHP" }

    /// Candidate categories: last 90 days of tag spend, biggest first, plus budgeted tags.
    private var candidates: [String] {
        let start = PHT.daysAgo(90)
        var totals: [String: Double] = [:]
        var display: [String: String] = [:]           // lowercased → first display spelling
        for s in spends where s.spentAt >= start {
            for t in (s.tags.isEmpty ? [s.category ?? "Untagged"] : s.tags) {
                totals[t.lowercased(), default: 0] += s.amountBase
                if display[t.lowercased()] == nil { display[t.lowercased()] = t }
            }
        }
        for b in budgets where display[b.tag.lowercased()] == nil { display[b.tag.lowercased()] = b.tag }
        let ranked = totals.sorted { $0.value > $1.value }.map { display[$0.key] ?? $0.key }
        let extra = budgets.map(\.tag).filter { t in !ranked.contains { $0.lowercased() == t.lowercased() } }
        return Array((ranked + extra).prefix(14))
    }

    var body: some View {
        SheetScaffold(title: "Monthly budgets", accent: Palette.azure, icon: "gauge.with.needle",
                      canSave: true, onSave: save) {
            Text("A cap is a quiet marker, not a lock — the bar turns amber at 80% and red when you pass it.")
                .font(.system(size: 12)).foregroundStyle(Palette.textTertiary)
            ForEach(candidates, id: \.self) { tag in
                HStack(spacing: 10) {
                    Text(tag).font(.system(size: 13, weight: .medium)).foregroundStyle(Palette.textPrimary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Text(CurrencyFormat.symbol(base)).font(.system(size: 12)).foregroundStyle(Palette.textTertiary)
                    TextField("no cap", text: Binding(
                        get: { caps[tag] ?? "" },
                        set: { caps[tag] = $0 }))
                        .textFieldStyle(GlassFieldStyle()).frame(width: 110)
                }
            }
        }
        .onAppear {
            for b in budgets where b.capBase > 0 {
                let display = candidates.first { $0.lowercased() == b.tag.lowercased() } ?? b.tag
                caps[display] = b.capBase.truncatingRemainder(dividingBy: 1) == 0
                    ? String(format: "%.0f", b.capBase) : String(b.capBase)
            }
        }
    }

    private func save() {
        for tag in candidates {
            let raw = (caps[tag] ?? "").replacingOccurrences(of: ",", with: "").trimmingCharacters(in: .whitespaces)
            let cap = Double(raw) ?? 0
            let existing = budgets.first { $0.tag.lowercased() == tag.lowercased() }
            if cap > 0 {
                if let b = existing {
                    if b.capBase != cap { b.capBase = cap; b.updatedAt = .now; b.dirty = true }
                } else {
                    context.insert(CategoryBudget(tag: tag, capBase: cap))
                }
            } else if let b = existing {
                context.delete(b)
            }
        }
        try? context.save()
        dismiss()
    }
}

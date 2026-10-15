import SwiftUI
import SwiftData

/// Bills: what comes due next month, every bill as a card, what they cost this year, and the chosen bill in detail.
struct BillsPage: View {
    @Environment(\.modelContext) private var context
    @Environment(\.accessibilityReduceMotion) private var reduce
    let state: MoneyState
    @Query private var recurring: [Recurring]
    @Query(sort: \Spend.spentAt) private var spends: [Spend]
    @Query private var wallets: [Wallet]
    @Query private var rateRows: [ExchangeRate]
    @Query private var settings: [AppSettings]
    @State private var selected: UUID?
    @State private var editing: BillsEditTarget?
    @State private var deleting: Recurring?
    @FocusState private var gridFocused: Bool

    private var base: String { settings.first?.baseCurrency ?? "PHP" }

    var body: some View {
        let picture = BillsPicture.build(state: state, recurring: recurring, spends: spends, wallets: wallets)
        // Until he picks one, show the bill that wants a decision (a new estimate), else the next one due.
        let current = picture.cards.first { $0.id == selected } ?? picture.cards.first { $0.estimate != nil } ?? picture.cards.first
        HStack(spacing: 12) {
            Pane {
                PaneHeader(title: "Bills") {
                    M3Button(title: "Add a bill", icon: Sym.add, kind: .tonal) { editing = .new }
                }
                PaneScroll {
                    VStack(alignment: .leading, spacing: 0) {
                        BillsSummary(due: picture.dueNext).padding(.top, 16)
                        if picture.cards.isEmpty {
                            BillsNoBills().padding(.top, 16)
                        } else {
                            grid(picture.cards, current: current?.id).padding(.top, 16)
                        }
                        BillsYear(months: picture.year, legend: picture.legend, total: picture.yearTotal, since: picture.yearSince)
                    }
                    .padding(.bottom, 4)
                }
            }
            .frame(minWidth: 560)
            Pane {
                if let current {
                    BillsDetail(card: current, history: picture.history(current),
                                onUse: { use($0, on: current.bill) },
                                onEdit: { editing = .edit(current.bill) },
                                onDelete: { deleting = current.bill })
                } else {
                    PaneHeader(title: "No bills yet", big: false)
                    Text("Bills you add show here: when each is due, when its money is set aside and what it came to.")
                        .role(.body, MD.onSurfaceVariant).padding(.top, 8)
                }
            }
            .frame(width: 384)
        }
        .sheet(item: $editing) { target in
            BillsEditor(target: target, wallets: liveWallets, base: base, rates: Rates(base: base, rates: rateRows)) { id in
                withAnimation(Flow.pick(Flow.spatial, reduce: reduce)) { selected = id }
            }
        }
        .confirmationDialog(deleting.map { "Delete \($0.label)?" } ?? "Delete this bill?",
                            isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
                            titleVisibility: .visible, presenting: deleting) { r in
            Button("Delete", role: .destructive) { delete(r) }
            Button("Cancel", role: .cancel) { deleting = nil }
        } message: { _ in
            Text("Freelane stops expecting it. Its past payments stay in your history.")
        }
        .onReceive(DistributedNotificationCenter.default().publisher(for: .init("app.freelane.dev." + (ProcessInfo.processInfo.environment["FREELANE_DEV_CHANNEL"] ?? "main")))) { n in
            // Test builds only: open the sheet or pick a card from a script ("bills:add", "bills:select:wifi").
            guard DevMode.isSandboxed, let cmd = n.object as? String else { return }
            if cmd == "bills:add" { editing = .new }
            if cmd == "bills:use", let c = current, let e = c.estimate { use(e.suggested, on: c.bill) }
            if cmd.hasPrefix("bills:select:") {
                let name = String(cmd.dropFirst(13)).lowercased()
                selected = picture.cards.first { $0.line.label.lowercased() == name }?.id
            }
        }
    }

    private var liveWallets: [Wallet] {
        wallets.filter { $0.isHolding && !$0.archived && $0.deletedAt == nil }.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    // MARK: Grid

    private func grid(_ cards: [BillsCard], current: UUID?) -> some View {
        let rows = stride(from: 0, to: cards.count, by: 2).map { Array(cards[$0..<min($0 + 2, cards.count)]) }
        return Grid(horizontalSpacing: 12, verticalSpacing: 12) {
            ForEach(rows, id: \.first!.id) { row in
                GridRow {
                    ForEach(row) { c in
                        BillsCardView(card: c, selected: c.id == current) { select(c.id) }
                    }
                    if row.count == 1 { Color.clear.frame(maxWidth: .infinity, maxHeight: 1) }
                }
            }
        }
        .animation(Flow.pick(Flow.spatial, reduce: reduce), value: cards.map(\.id))
        .focusable()
        .focused($gridFocused)
        .focusEffectDisabled()
        .onKeyPress(.leftArrow) { move(-1, in: cards, from: current) }
        .onKeyPress(.rightArrow) { move(1, in: cards, from: current) }
        .onKeyPress(.upArrow) { move(-2, in: cards, from: current) }
        .onKeyPress(.downArrow) { move(2, in: cards, from: current) }
        .onKeyPress(.return) {
            guard let c = cards.first(where: { $0.id == current }) else { return .ignored }
            editing = .edit(c.bill); return .handled
        }
        .onAppear { gridFocused = true }
    }

    private func select(_ id: UUID) {
        gridFocused = true
        withAnimation(Flow.pick(Flow.spatial, reduce: reduce)) { selected = id }
    }

    private func move(_ step: Int, in cards: [BillsCard], from current: UUID?) -> KeyPress.Result {
        guard let i = cards.firstIndex(where: { $0.id == current }) else { return .ignored }
        let j = i + step
        guard cards.indices.contains(j) else { return .handled }
        withAnimation(Flow.pick(Flow.spatial, reduce: reduce)) { selected = cards[j].id }
        return .handled
    }

    // MARK: Actions

    /// "Use ₱2,090": the rule takes the suggested amount, saved and marked for sync.
    private func use(_ suggested: Double, on r: Recurring) {
        let rates = Rates(base: base, rates: rateRows)
        selected = r.id   // keep this bill in view once its estimate no longer singles it out
        withAnimation(Flow.pick(Flow.spatial, reduce: reduce)) {
            if r.currency == base { r.amount = suggested } else { r.amount = round2(suggested / max(rates.rate(for: r.currency), 0.000_001)) }
            r.amountBase = suggested
            r.updatedAt = .now
            r.dirty = true
        }
        try? context.save()
    }

    private func delete(_ r: Recurring) {
        withAnimation(Flow.pick(Flow.spatial, reduce: reduce)) {
            SoftDelete.trash(r, ownsLedger: false, context: context)
            r.updatedAt = .now
            if selected == r.id { selected = nil }
        }
        try? context.save()
        deleting = nil
    }
}

enum BillsEditTarget: Identifiable {
    case new
    case edit(Recurring)
    var id: String { if case .edit(let r) = self { return r.id.uuidString }; return "new" }
}

// MARK: - Summary band

private struct BillsSummary: View {
    let due: BillsDueNext
    var body: some View {
        Band {
            VStack(alignment: .leading, spacing: 0) {
                Money(value: due.total, role: .summary, decimals: false, color: MD.onPrimaryContainer)
                    .contentTransition(.numericText(value: due.total))
                Text("comes due in \(Day.month(due.month))").role(.summaryLabel, MD.onPrimaryContainer).padding(.top, 4)
                Text(due.sentence).role(.body, MD.onPrimaryContainer).padding(.top, 2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

private struct BillsNoBills: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("No bills yet").role(.row)
            Text("Add rent, electricity or anything else that repeats. Freelane sets its money aside in the \(BillsText.setAsideSpan) before it’s due.")
                .role(.supporting, MD.onSurfaceVariant)
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 24, style: .continuous).fill(Surface.well))
    }
}

// MARK: - Bill card

private struct BillsCardView: View {
    let card: BillsCard
    let selected: Bool
    let action: () -> Void

    var body: some View {
        let amount = card.line.amount
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                Badge(subject: .bill(card.line.label), size: 48)
                Text(card.line.label).role(.row).lineLimit(1)
                Spacer(minLength: 8)
                StatusLabel(title: card.status, glyph: card.statusGlyph, tone: card.statusTone)
            }
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Money(value: amount, role: .card, decimals: abs(amount - amount.rounded()) > 0.004, estimate: card.line.estimate)
                    .contentTransition(.numericText(value: amount))
                Text(card.rhythm).role(.supporting, MD.onSurfaceVariant)
            }
            HStack(alignment: .top, spacing: 6) {
                Icon(Sym.eventUpcoming, size: 20).foregroundStyle(MD.onSurfaceVariant)
                Text(card.footer).role(.supporting, MD.onSurfaceVariant).lineLimit(2).padding(.top, 1)
            }
        }
        .padding(.top, 16).padding(.bottom, 16).padding(.leading, 16).padding(.trailing, 20)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(RoundedRectangle(cornerRadius: 24, style: .continuous).fill(selected ? MD.secondaryContainer : Surface.well))
        .animation(Flow.effects, value: selected)
        .pressable(RoundedRectangle(cornerRadius: 24, style: .continuous), action: action)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(selected ? [.isButton, .isSelected] : [.isButton])
    }
}

// MARK: - Paid this year

private struct BillsYear: View {
    let months: [BillsYearMonth]
    let legend: [BillsLegendItem]
    let total: Double
    let since: Date?
    @State private var grown = false
    @Environment(\.accessibilityReduceMotion) private var reduce

    var body: some View {
        let peak = months.map(\.total).max() ?? 0
        VStack(alignment: .leading, spacing: 0) {
            SectionHeader(title: "Paid this year") {
                if let since, total > 0 {
                    let when = PHT.calendar.component(.month, from: since) == 1 ? "this year" : "since \(Day.month(since))"
                    Text("\(MoneyFormat.string(total, decimals: false)) \(when)").role(.supporting, MD.onSurfaceVariant)
                }
            }
            if months.isEmpty {
                Text("No bills paid yet this year.").role(.supporting, MD.onSurfaceVariant).padding(.horizontal, 4)
            } else {
                ForEach(months) { m in
                    HStack(spacing: 12) {
                        Text(BillsText.mon(m.month)).role(.small, MD.onSurfaceVariant).frame(width: 36, alignment: .leading)
                        GeometryReader { g in
                            BillsStack(parts: m.parts, width: peak > 0 ? g.size.width * m.total / peak : 0)
                                .scaleEffect(x: grown || reduce ? 1 : 0.001, y: 1, anchor: .leading)
                        }
                        .frame(height: 20)
                        VStack(alignment: .trailing, spacing: 0) {
                            Money(value: m.total, role: .row, decimals: false)
                            if let note = m.note {
                                Text(note).role(.supporting, MD.onSurfaceVariant).lineLimit(1).fixedSize()
                            }
                        }
                        .frame(width: 84, alignment: .trailing)
                    }
                    .frame(height: 32)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("\(Day.month(m.month)): \(MoneyFormat.string(m.total, decimals: false))" + (m.note.map { ", \($0)" } ?? ""))
                }
                HStack(spacing: 16) {
                    ForEach(legend) { l in
                        HStack(spacing: 6) {
                            RoundedRectangle(cornerRadius: 3, style: .continuous).fill(l.color).frame(width: 10, height: 10)
                            Text(l.label).role(.small, MD.onSurfaceVariant)
                        }
                    }
                }
                .padding(.top, 8).padding(.leading, 48)
                .accessibilityHidden(true)
            }
        }
        .onAppear { withAnimation(Flow.pick(Flow.slow, reduce: reduce).delay(reduce ? 0 : 0.05)) { grown = true } }
    }
}

/// One month's stacked bar: a segment per bill in its chart colour, 2pt apart, round at the ends.
private struct BillsStack: View {
    let parts: [BillsPart]
    let width: CGFloat
    var body: some View {
        let total = parts.reduce(0) { $0 + $1.amount }
        let room = max(0, width - CGFloat(max(parts.count - 1, 0)) * 2)
        HStack(spacing: 2) {
            ForEach(Array(parts.enumerated()), id: \.element.id) { i, p in
                let first = i == 0, last = i == parts.count - 1
                UnevenRoundedRectangle(topLeadingRadius: first ? 10 : 4, bottomLeadingRadius: first ? 10 : 4,
                                       bottomTrailingRadius: last ? 10 : 4, topTrailingRadius: last ? 10 : 4, style: .continuous)
                    .fill(p.color)
                    .frame(width: max(4, total > 0 ? room * p.amount / total : 0), height: 20)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Detail pane

private struct BillsDetail: View {
    let card: BillsCard
    let history: BillsHistory?
    let onUse: (Double) -> Void
    let onEdit: () -> Void
    let onDelete: () -> Void

    var body: some View {
        let pays = history?.payments ?? []
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 14) {
                Badge(subject: .bill(card.line.label), size: 44)
                VStack(alignment: .leading, spacing: 2) {
                    Text(card.line.label).role(.pane).lineLimit(1)
                    Text(card.subtitle).role(.supporting, MD.onSurfaceVariant).lineLimit(2).fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
                Menu {
                    Button("Edit bill…", action: onEdit)
                    Divider()
                    Button("Delete bill…", role: .destructive, action: onDelete)
                } label: {
                    Icon(Sym.moreVert, size: 24).foregroundStyle(MD.onSurfaceVariant)
                        .frame(width: 40, height: 40).contentShape(Circle())
                }
                .menuStyle(.button).buttonStyle(PlainButtonStyle2()).menuIndicator(.hidden).fixedSize()
                .help("More")
            }
            .frame(minHeight: 48)
            .padding(.top, 20)
            PaneScroll {
                VStack(alignment: .leading, spacing: 0) {
                    BillsCameTo(payments: Array(pays.suffix(6)), cadence: history?.cadence ?? card.bill.cadence,
                                chart: history?.chart ?? MD.outline, past: history?.past ?? MD.outlineVariant)
                        .padding(.top, 20)
                    if let e = card.estimate {
                        BillsEstimateRow(estimate: e) { onUse(e.suggested) }
                            .padding(.top, 12)
                            .transition(.opacity.combined(with: .scale(scale: 0.96, anchor: .top)))
                    }
                    VStack(spacing: 0) {
                        BillsFact(label: "Due", value: card.dueFact)
                        BillsFact(label: "Set aside", value: card.setAsideFact)
                        BillsFact(label: "Paid from", value: pays.last.map { p in p.wallet.map { "\($0) last time" } ?? "no wallet recorded" } ?? "not paid yet", last: true)
                    }
                    .padding(.top, 12)
                    if !pays.isEmpty {
                        Text("Paid").role(.sub, MD.onSurface).padding(.horizontal, 4).padding(.top, 20).padding(.bottom, 4)
                        let recent = Array(pays.suffix(3).reversed())
                        ForEach(Array(recent.enumerated()), id: \.element.id) { i, p in
                            BillsPaidRow(payment: p, cadence: history?.cadence ?? .monthly, last: i == recent.count - 1)
                        }
                    }
                }
            }
        }
    }
}

/// "What it came to": the last few payments as bars, latest in the bill's chart colour, with one plain read.
private struct BillsCameTo: View {
    let payments: [BillsPayment]
    let cadence: RecurringCadence
    let chart: Color
    let past: Color

    var body: some View {
        let peak = payments.map(\.amount).max() ?? 0
        let byMonth = Set(payments.map { BillsText.monYear($0.date) }).count == payments.count
        VStack(alignment: .leading, spacing: 0) {
            Text("What it came to").role(.sub, MD.onSurface)
            Text(BillsRead.line(payments, cadence: cadence)).role(.supporting, MD.onSurfaceVariant)
                .fixedSize(horizontal: false, vertical: true)
            if !payments.isEmpty {
                HStack(alignment: .bottom, spacing: 14) {
                    ForEach(Array(payments.enumerated()), id: \.offset) { i, p in
                        VStack(spacing: 4) {
                            Text(BillsText.figure(p.amount)).role(.small, MD.onSurface).lineLimit(1).fixedSize()
                            UnevenRoundedRectangle(topLeadingRadius: 6, bottomLeadingRadius: 3, bottomTrailingRadius: 3, topTrailingRadius: 6, style: .continuous)
                                .fill(i == payments.count - 1 ? chart : past)
                                .frame(maxWidth: 34)
                                .frame(height: peak > 0 ? max(4, 108 * p.amount / peak) : 4)
                        }
                        .frame(maxWidth: .infinity)
                    }
                }
                .frame(height: 132, alignment: .bottom)
                .padding(.horizontal, 4)
                .padding(.top, 12)
                HStack(spacing: 14) {
                    ForEach(Array(payments.enumerated()), id: \.offset) { _, p in
                        Text(byMonth ? BillsText.mon(p.date) : Day.dayMonth(p.date)).role(.small, MD.onSurfaceVariant)
                            .lineLimit(1).fixedSize().frame(maxWidth: .infinity)
                    }
                }
                .padding(.horizontal, 4).padding(.top, 6)
                .accessibilityHidden(true)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 20, style: .continuous).fill(Surface.well))
        .accessibilityElement(children: .combine)
    }
}

/// "Freelane expects ~₱2,000. The last two came to ₱2,203 and ₱2,086." and a button that adopts the new figure.
private struct BillsEstimateRow: View {
    let estimate: BillsEstimate
    let action: () -> Void

    var body: some View {
        let e = estimate
        let m = { (v: Double, est: Bool) in Money(value: v, role: .inline(14), decimals: false, estimate: est).text }
        let recent: Text = e.recent.count >= 2
            ? Text("The last two came to ") + m(e.recent[0], false) + Text(" and ") + m(e.recent[1], false) + Text(".")
            : Text("The last one came to ") + m(e.recent.first ?? 0, false) + Text(".")
        HStack(spacing: 12) {
            (Text("Freelane expects ") + m(e.expected, e.expectedIsEstimate) + Text(". ") + recent)
                .role(.body)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
            M3Button(title: "Use \(MoneyFormat.string(e.suggested, decimals: false))", kind: .tonal, small: true, action: action)
        }
        .padding(.vertical, 14).padding(.horizontal, 16)
        .background(RoundedRectangle(cornerRadius: 20, style: .continuous).fill(Surface.well))
    }
}

/// A 44pt key–value row; the last one in a group has no divider.
private struct BillsFact: View {
    let label: String
    let value: String
    var last = false
    var body: some View {
        HStack {
            Text(label).role(.supporting, MD.onSurfaceVariant)
            Spacer(minLength: 16)
            Text(value).role(.body).multilineTextAlignment(.trailing).lineLimit(1)
        }
        .padding(.horizontal, 4)
        .frame(height: 44)
        .overlay(alignment: .bottom) { if !last { Rectangle().fill(Surface.hairline).frame(height: 1) } }
    }
}

private struct BillsPaidRow: View {
    let payment: BillsPayment
    let cadence: RecurringCadence
    let last: Bool
    /// "from Wise, incl. ₱5 fee", "from Wise · 12 months"
    private var from: String {
        var s = payment.wallet.map { "from \($0)" } ?? "no wallet"
        if let fee = payment.feeNote { s += ", \(fee)" }
        if payment.periods > 1 { s += " · \(BillsText.periods(payment.periods, cadence))" }
        return s
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(BillsText.shortDate(payment.date)).role(.body)
            Text(from).role(.supporting, MD.onSurfaceVariant).lineLimit(1)
            Spacer(minLength: 12)
            Money(value: payment.amount, role: .row)
        }
        .padding(.horizontal, 4)
        .frame(height: 44)
        .overlay(alignment: .bottom) { if !last { Rectangle().fill(Surface.hairline).frame(height: 1) } }
    }
}

// MARK: - Add or edit a bill

private struct BillsEditor: View {
    let target: BillsEditTarget
    let wallets: [Wallet]
    let base: String
    let rates: Rates
    let onSaved: (UUID) -> Void
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var amount = ""
    @State private var day = 1
    @State private var variable = false
    @State private var walletId: UUID? = nil
    @State private var loaded = false

    private var existing: Recurring? { if case .edit(let r) = target { return r }; return nil }
    private var currency: String { existing?.currency ?? base }
    private var parsed: Double? { BillsWorkAmount.parse(amount) }
    private var canSave: Bool { !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && (parsed ?? 0) > 0 }

    var body: some View {
        BillsWorkSheet(title: existing == nil ? "New bill" : "Edit bill", action: existing == nil ? "Add bill" : "Save",
                       canSave: canSave, onCancel: { dismiss() }, onSave: save) {
            BillsWorkField(label: "Name") {
                BillsWorkInput(placeholder: "Rent, electricity, wifi…", text: $name, autofocus: true)
            }
            BillsWorkField(label: variable ? "Usual amount" : "Amount") {
                BillsWorkInput(placeholder: "0", text: $amount, prefix: CurrencyFormat.symbol(currency))
            }
            if existing?.cadence ?? .monthly == .monthly {
                BillsWorkField(label: "Due") {
                    HStack(spacing: 4) {
                        Text("On the \(BillsText.ordinal(day)) of each month").font(FS.font(15, 400)).foregroundStyle(MD.onSurface)
                            .contentTransition(.numericText(value: Double(day)))
                        Spacer(minLength: 8)
                        IconButton(glyph: Sym.remove, help: "A day earlier") { withAnimation(Flow.fast) { day = max(1, day - 1) } }
                            .disabled(day <= 1).opacity(day <= 1 ? 0.38 : 1)
                        IconButton(glyph: Sym.add, help: "A day later") { withAnimation(Flow.fast) { day = min(28, day + 1) } }
                            .disabled(day >= 28).opacity(day >= 28 ? 0.38 : 1)
                    }
                    .padding(.leading, 16).padding(.trailing, 4)
                    .frame(height: 48)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(BillsWorkSheetStyle.field))
                }
            }
            Toggle(isOn: $variable.animation(Flow.effects)) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("The amount changes").role(.row)
                    Text("Freelane sets aside the usual amount and shows it as an estimate (~).").role(.supporting, MD.onSurfaceVariant)
                }
            }
            .toggleStyle(.switch)
            .tint(MD.primary)
            .padding(.vertical, 4)
            BillsWorkField(label: "Usually paid from") {
                BillsWorkMenu(title: wallets.first { $0.id == walletId }?.name ?? "No wallet") {
                    if let w = wallets.first(where: { $0.id == walletId }) { Badge(subject: .wallet(w), size: 28) }
                } items: {
                    Button("No wallet") { walletId = nil }
                    Divider()
                    ForEach(wallets) { w in Button(w.name) { walletId = w.id } }
                }
            }
        }
        .onAppear(perform: load)
    }

    private func load() {
        guard !loaded else { return }
        loaded = true
        if let e = existing {
            name = e.label
            amount = e.amount > 0 ? BillsWorkAmount.edit(e.amount) : ""
            day = min(max(e.dayOfMonth ?? 1, 1), 28)
            variable = e.isVariableAmount
            walletId = e.walletId
        } else {
            day = min(PHT.calendar.component(.day, from: .now), 28)
        }
    }

    private func save() {
        guard canSave, let amt = parsed else { return }
        let label = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let r: Recurring
        if let e = existing {
            r = e
            r.label = label
            r.amount = amt
            r.amountBase = round2(rates.toBase(amt, r.currency))
        } else {
            r = Recurring(label: label, kind: .expense, cadence: .monthly, amount: amt, currency: base, amountBase: round2(amt))
            context.insert(r)
        }
        if r.cadence == .monthly { r.dayOfMonth = day }
        r.isVariableAmount = variable
        r.walletId = walletId
        r.updatedAt = .now
        r.dirty = true
        RecurringMath.resyncAll(context)   // a new due day moves which periods the payments settle
        try? context.save()
        onSaved(r.id)
        dismiss()
    }
}

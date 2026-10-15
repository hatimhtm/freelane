import SwiftUI
import SwiftData

/// Ledger: every money movement by day, filtered by kind, month and search, with the selected entry
/// explained in the pane on the right.
struct LedgerPage: View {
    let state: MoneyState
    @Environment(\.accessibilityReduceMotion) private var reduce
    @Query private var payments: [Payment]
    @Query private var spends: [Spend]
    @Query private var withdrawals: [Withdrawal]
    @Query private var ledger: [LedgerEntry]
    @Query private var wallets: [Wallet]
    @Query private var recurring: [Recurring]
    @Query private var projects: [Project]
    @Query private var clients: [Client]
    @Query private var steps: [PaymentStep]

    @State private var filter: LedgerFilter = .all
    @State private var period: LedgerPeriod? = nil
    @State private var query = ""
    @State private var selection = LedgerSelection()
    @FocusState private var focus: LedgerFocus?

    var body: some View {
        let all = LedgerModel.lines(feed: state.feed, withdrawals: withdrawals, spends: spends, recurring: recurring,
                                    ledger: ledger, wallets: wallets)
        let months = LedgerModel.months(all)
        let period = self.period ?? months.first.map { LedgerPeriod.month($0) } ?? .all
        let shown = LedgerModel.filter(all, by: filter, in: period, matching: query)
        let days = LedgerModel.days(shown)
        let ids = shown.map(\.id)
        let listKey = "\(filter.rawValue)|\(period.title)"
        let watch = LedgerShown(key: listKey + "|" + query, ids: ids)
        HStack(spacing: 12) {
            ScrollViewReader { proxy in
                Pane {
                    PaneHeader(title: "Ledger") {
                        LedgerSearchField(text: $query, focus: $focus) { move($0, days: days, proxy: proxy) }
                    }
                    chips(months: months, period: period)
                    LedgerSummary(figures: LedgerModel.figures(period, payments: payments, spends: spends, withdrawals: withdrawals,
                                                               ledger: ledger, wallets: wallets))
                        .padding(.top, 12)
                    LedgerList(days: days, listKey: listKey, selection: selection, empty: emptyLine(period),
                               widen: widen(from: period)) { click($0) }
                        .focusable()
                        .focused($focus, equals: .list)
                        .focusEffectDisabled()
                        .onKeyPress(.upArrow) { move(-1, days: days, proxy: proxy); return .handled }
                        .onKeyPress(.downArrow) { move(1, days: days, proxy: proxy); return .handled }
                }
            }
            .frame(minWidth: 560)
            Pane {
                LedgerDetail(lines: Dictionary(all.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a }), selection: selection,
                             ctx: LedgerContext(payments: payments, spends: spends, withdrawals: withdrawals, ledger: ledger, wallets: wallets,
                                                recurring: recurring, projects: projects, clients: clients, steps: steps))
            }
            .frame(width: 384)
        }
        .defaultFocus($focus, .list)
        .background { shortcuts }
        .onAppear { reconcile(old: nil, new: watch, animated: false) }
        .onChange(of: watch) { old, new in reconcile(old: old, new: new) }
        .onReceive(DistributedNotificationCenter.default().publisher(for: .init("app.freelane.dev." + (ProcessInfo.processInfo.environment["FREELANE_DEV_CHANNEL"] ?? "main")))) { n in
            guard DevMode.isSandboxed, let cmd = n.object as? String else { return }
            devDrive(cmd, lines: all, months: months)
        }
    }

    /// Test builds only (sandboxed data): drive the page from a script, e.g.
    /// "ledger:month:all;ledger:filter:moves;ledger:search:wise;ledger:select:Website redesign".
    private func devDrive(_ cmd: String, lines: [LedgerLine], months: [Date]) {
        var f = filter, p = period ?? months.first.map { LedgerPeriod.month($0) } ?? .all, q = query
        for part in cmd.split(separator: ";").map(String.init) where part.hasPrefix("ledger:") {
            let arg = part.dropFirst(7)
            if arg.hasPrefix("filter:"), let v = LedgerFilter(rawValue: String(arg.dropFirst(7))) { f = v }
            if arg == "month:all" { p = .all }
            if arg.hasPrefix("month:"), let m = months.first(where: { Day.monthYear($0).lowercased() == arg.dropFirst(6).lowercased() }) { p = .month(m) }
            if arg.hasPrefix("search:") { q = String(arg.dropFirst(7)) }
            filter = f; period = p; query = q
            if arg.hasPrefix("select:") {
                let needle = arg.dropFirst(7).lowercased()
                let shown = LedgerModel.filter(lines, by: f, in: p, matching: q)
                if let hit = shown.first(where: { ($0.title + " " + $0.subtitle).lowercased().contains(needle) }) { selection.id = hit.id }
            }
        }
    }

    // MARK: Filters

    private func chips(months: [Date], period: LedgerPeriod) -> some View {
        HStack(spacing: 8) {
            ForEach(LedgerFilter.allCases) { f in
                FilterChip(title: f.title, selected: filter == f) { change { filter = f } }
            }
            Spacer(minLength: 8)
            LedgerMonthMenu(months: months, period: period) { p in change { self.period = p } }
        }
        .padding(.top, 16)
    }

    private func emptyLine(_ period: LedgerPeriod) -> String {
        let q = query.trimmingCharacters(in: .whitespaces)
        guard q.isEmpty else {
            return "Nothing matches “\(q)”" + (filter == .all ? "" : " under \(filter.title)") + period.phrase + "."
        }
        return filter.none + period.phrase + "."
    }

    /// "Look in all time" under an empty month.
    private func widen(from period: LedgerPeriod) -> (() -> Void)? {
        guard period != .all else { return nil }
        return { change { self.period = .all } }
    }

    private var shortcuts: some View {
        Button("") { focus = .search }
            .keyboardShortcut("f", modifiers: .command)
            .opacity(0).frame(width: 0, height: 0).accessibilityHidden(true)
    }

    // MARK: Selection

    private func change(_ body: () -> Void) {
        withAnimation(Flow.pick(Flow.spatial, reduce: reduce)) { body() }
    }

    private func select(_ id: String?) {
        guard selection.id != id else { return }
        withAnimation(Flow.pick(Flow.effects, reduce: reduce)) { selection.id = id }
    }

    private func click(_ id: String) {
        if focus != .list { focus = .list }
        select(id)
    }

    /// ↑/↓: the next line in the list, scrolled into view (with its day's header when moving up into a new day).
    private func move(_ delta: Int, days: [LedgerDay], proxy: ScrollViewProxy) {
        let ids = days.flatMap { $0.lines.map(\.id) }
        guard !ids.isEmpty else { return }
        let i = selection.id.flatMap { ids.firstIndex(of: $0) }
        let target = ids[i.map { min(max($0 + delta, 0), ids.count - 1) } ?? 0]
        select(target)
        let opensDay = delta < 0 ? days.first(where: { $0.lines.first?.id == target })?.day : nil
        withAnimation(Flow.pick(Flow.spatial, reduce: reduce)) {
            if let opensDay { proxy.scrollTo(opensDay) } else { proxy.scrollTo(target) }
        }
    }

    /// Keeps a line selected: the same one if it's still shown; after a deletion, the one that took its place;
    /// after a new filter, the first.
    private func reconcile(old: LedgerShown?, new: LedgerShown, animated: Bool = true) {
        if let id = selection.id, new.ids.contains(id) { return }
        let next: String?
        if new.ids.isEmpty {
            next = nil
        } else if let old, old.key == new.key, let id = selection.id, let i = old.ids.firstIndex(of: id) {
            next = new.ids[min(i, new.ids.count - 1)]
        } else {
            next = new.ids.first
        }
        if animated { select(next) } else { selection.id = next }
    }
}

@Observable final class LedgerSelection {
    var id: String? = nil
}

enum LedgerFocus: Hashable { case list, search }

private struct LedgerShown: Equatable {
    let key: String
    let ids: [String]
}

// MARK: - Header pieces

/// The header's search field: filters as you type (title, supporting line and amount). ⌘F focuses it,
/// ↑/↓ still move the selection, Return hands the keyboard back to the list, Escape clears it.
private struct LedgerSearchField: View {
    @Binding var text: String
    var focus: FocusState<LedgerFocus?>.Binding
    let onArrow: (Int) -> Void

    var body: some View {
        HStack(spacing: 12) {
            Icon(Sym.search, size: 24).foregroundStyle(MD.onSurface)
            ZStack(alignment: .leading) {
                if text.isEmpty {
                    Text("Search").font(FS.font(15, 400)).foregroundStyle(MD.onSurfaceVariant).allowsHitTesting(false)
                }
                TextField("", text: $text)
                    .textFieldStyle(.plain)
                    .font(FS.font(15, 400))
                    .foregroundStyle(MD.onSurface)
                    .focused(focus, equals: .search)
                    .onKeyPress(.upArrow) { onArrow(-1); return .handled }
                    .onKeyPress(.downArrow) { onArrow(1); return .handled }
                    .onKeyPress(.escape) {
                        if text.isEmpty { focus.wrappedValue = .list } else { text = "" }
                        return .handled
                    }
                    .onSubmit { focus.wrappedValue = .list }
                    .accessibilityLabel("Search the ledger")
            }
            if text.isEmpty {
                Text("⌘F").font(FS.font(12, 500, rond: 60)).foregroundStyle(MD.onSurfaceVariant.opacity(0.7))
            } else {
                Button { text = "" } label: {
                    Icon(Sym.close, size: 20).foregroundStyle(MD.onSurfaceVariant).frame(width: 32, height: 32)
                }
                .buttonStyle(PlainButtonStyle2())
                .help("Clear the search")
                .transition(.opacity)
            }
        }
        .padding(.leading, 18).padding(.trailing, text.isEmpty ? 18 : 10)
        .frame(width: 260, height: 48)
        .background(Capsule().fill(Surface.well))
        .contentShape(Capsule())
        .onTapGesture { if focus.wrappedValue != .search { focus.wrappedValue = .search } }
        .animation(Flow.effects, value: text.isEmpty)
    }
}

/// "October 2026 ⌄": months that have entries, newest first, and All time.
private struct LedgerMonthMenu: View {
    let months: [Date]
    let period: LedgerPeriod
    let pick: (LedgerPeriod) -> Void

    var body: some View {
        Menu {
            Picker("Period", selection: Binding(get: { period }, set: { pick($0) })) {
                Text("All time").tag(LedgerPeriod.all)
                Divider()
                ForEach(months, id: \.self) { m in
                    Text(Day.monthYear(m)).tag(LedgerPeriod.month(m))
                }
            }
            .pickerStyle(.inline)
            .labelsHidden()
        } label: {
            HStack(spacing: 6) {
                Text(period.title).font(TextRole.label.font)
                Icon(Sym.expandMore, size: 18)
            }
            .foregroundStyle(MD.onSurface)
            .padding(.leading, 12).padding(.trailing, 8)
            .frame(height: 32)
            .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Surface.well))
            .contentShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .menuIndicator(.hidden)
        .fixedSize()
        .help("Show another month")
    }
}

/// "Came in ₱12,000   Went out ₱4,500   Fees ₱120   Counts found +₱300" for the shown period.
private struct LedgerSummary: View {
    let figures: MonthFigures
    var body: some View {
        HStack(spacing: 24) {
            item("Came in", figures.cameIn)
            item("Went out", figures.wentOut)
            item("Fees", figures.fees)
            item("Counts found", figures.countsFound, signed: true)
        }
        .padding(.horizontal, 4)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func item(_ label: String, _ v: Double, signed: Bool = false) -> some View {
        let r = v.rounded()
        let sign: MoneySign = signed ? (r > 0 ? .plus : r < 0 ? .minus : .none) : .none
        let name = Text(verbatim: label + " ").font(TextRole.supporting.font).foregroundStyle(MD.onSurfaceVariant)
        let money = Money(value: abs(v), role: .inline(13), sign: sign, decimals: false).text
        return Text("\(name)\(money)")
            .lineLimit(1)
            .fixedSize()
            .contentTransition(.numericText(value: v))
            .accessibilityElement(children: .combine)
    }
}

// MARK: - The list

private struct LedgerList: View {
    let days: [LedgerDay]
    let listKey: String
    let selection: LedgerSelection
    let empty: String
    let widen: (() -> Void)?
    let onSelect: (String) -> Void

    var body: some View {
        ZStack(alignment: .top) {
            Group {
                if days.isEmpty {
                    LedgerEmpty(line: empty, widen: widen)
                } else {
                    ScrollView(.vertical, showsIndicators: false) {
                        LazyVStack(alignment: .leading, spacing: 0) {
                            ForEach(days) { d in
                                LedgerDaySection(day: d, selection: selection, onSelect: onSelect)
                            }
                        }
                        .padding(.bottom, 24)
                    }
                }
            }
            .id(listKey)
            .transition(.opacity)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        // Rows fade out at the edges instead of being cut: under the summary line, and into the pane's foot.
        .mask {
            VStack(spacing: 0) {
                LinearGradient(colors: [.clear, .black], startPoint: .top, endPoint: .bottom).frame(height: 10)
                Color.black
                LinearGradient(colors: [.black, .clear], startPoint: .top, endPoint: .bottom).frame(height: 24)
            }
        }
        .padding(.bottom, -24)
    }
}

private struct LedgerDaySection: View {
    let day: LedgerDay
    let selection: LedgerSelection
    let onSelect: (String) -> Void

    var body: some View {
        let net = day.net
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                Text(day.title).role(.sub, MD.onSurfaceVariant)
                Spacer(minLength: 12)
                Money(value: abs(net), role: .row, sign: net > 0.004 ? .plus : net < -0.004 ? .minus : .none, color: MD.onSurfaceVariant)
            }
            .padding(.horizontal, 4).padding(.top, 24).padding(.bottom, 8)
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)
            Segmented(items: day.lines, selected: selection.id) { line in
                LedgerLineRow(line: line, selected: selection.id == line.id) { onSelect(line.id) }
                    .id(line.id)
            }
        }
        .id(day.day)
    }
}

private struct LedgerLineRow: View {
    let line: LedgerLine
    let selected: Bool
    let action: () -> Void
    @State private var hovering = false
    @GestureState private var pressed = false

    var body: some View {
        ListRow(badge: Badge(subject: line.badge, size: 40, glyph: line.badgeGlyph), title: line.title, subtitle: line.subtitle) {
            amount
        }
        .contentShape(Rectangle())
        .overlay(Rectangle().fill(MD.onSurface.opacity(pressed ? 0.10 : hovering ? 0.05 : 0)).allowsHitTesting(false))
        .onHover { hovering = $0 }
        // Select on press, as Mac lists do. The pressed wash is gesture state, so a cancelled press clears it.
        .gesture(DragGesture(minimumDistance: 0)
            .updating($pressed) { _, state, _ in state = true }
            .onChanged { v in if v.translation == .zero { action() } })
        .animation(Flow.effects, value: hovering)
        .animation(Flow.effects, value: pressed)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
        .accessibilityAction { action() }
    }

    @ViewBuilder private var amount: some View {
        switch line.kind {
        case .move:
            Money.moved(line.amount)
        case .payment:
            Money.incoming(line.amount)
        case .count:
            if !line.inTotals {
                Money(value: abs(line.amount), role: .row, sign: line.amount >= 0 ? .plus : .minus, color: MD.onSurfaceVariant)
            } else if line.amount >= 0 {
                Money.incoming(line.amount)
            } else {
                Money.outgoing(line.amount)
            }
        default:
            Money(value: abs(line.amount), role: .row, sign: .minus, color: line.inTotals ? MD.onSurface : MD.onSurfaceVariant)
        }
    }
}

private struct LedgerEmpty: View {
    let line: String
    let widen: (() -> Void)?
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(line).role(.body, MD.onSurfaceVariant)
            if let widen {
                M3Button(title: "Look in all time", kind: .text, action: widen)
                    .padding(.leading, -12)
            }
        }
        .padding(.horizontal, 4).padding(.top, 24)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

// MARK: - Detail pane

private struct LedgerDetail: View {
    let lines: [String: LedgerLine]
    let selection: LedgerSelection
    let ctx: LedgerContext
    @Environment(\.accessibilityReduceMotion) private var reduce

    var body: some View {
        ZStack(alignment: .topLeading) {
            if let line = selection.id.flatMap({ lines[$0] }) {
                LedgerDetailBody(line: line, ctx: ctx)
                    .id(line.id)
                    .transition(.opacity.combined(with: .offset(y: reduce ? 0 : 4)))
            } else {
                LedgerNothingSelected().transition(.opacity)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

private struct LedgerDetailBody: View {
    let line: LedgerLine
    let ctx: LedgerContext

    var body: some View {
        switch line.ref {
        case .payment(let id):
            if let p = ctx.payments.first(where: { $0.id == id && $0.deletedAt == nil }) {
                LedgerPaymentDetail(payment: p, ctx: ctx)
            } else {
                LedgerGone()
            }
        case .spend(let id):
            if let s = ctx.spends.first(where: { $0.id == id && $0.deletedAt == nil }) {
                LedgerSpendDetail(spend: s, line: line, ctx: ctx)
            } else {
                LedgerGone()
            }
        case .moves(let ids):
            let moves = ids.compactMap { id in ctx.withdrawals.first { $0.id == id && $0.deletedAt == nil } }
            if moves.isEmpty {
                LedgerGone()
            } else {
                LedgerMoveDetail(moves: moves, line: line, ctx: ctx)
            }
        case .count(let day):
            LedgerCountDetail(day: day, line: line, ctx: ctx)
        case .fee(let id):
            if let e = ctx.ledger.first(where: { $0.id == id && $0.archivedAt == nil }) {
                LedgerFeeDetail(entry: e, line: line, ctx: ctx)
            } else {
                LedgerGone()
            }
        }
    }
}

/// The detail pane's frame: a 48pt header row 20pt from the top (badge, title, optional menu), the supporting
/// line under the title, then the scrolling body.
private struct LedgerDetailFrame<Trailing: View, Content: View>: View {
    let badge: Badge
    let title: String
    let subtitle: String
    @ViewBuilder var trailing: Trailing
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 14) {
                badge
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).role(.pane).lineLimit(1).truncationMode(.tail).help(title)
                    Text(subtitle).role(.supporting, MD.onSurfaceVariant).lineLimit(1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                trailing
            }
            .frame(minHeight: 48)
            .padding(.top, 20)
            ScrollView(.vertical, showsIndicators: false) {
                VStack(alignment: .leading, spacing: 0) { content }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.bottom, 24)
            }
            .padding(.bottom, -24)
        }
    }
}

// MARK: Payment

private struct LedgerPaymentDetail: View {
    let payment: Payment
    let ctx: LedgerContext

    var body: some View {
        let p = payment
        let project = ctx.project(p.projectId)
        let client = ctx.clientName(project?.clientId)
        let net = p.netAmountBase ?? 0
        let route = LedgerRoute.build(p, client: client, payments: ctx.payments, withdrawals: ctx.withdrawals,
                                      liveLedger: ctx.ledger.filter { $0.archivedAt == nil }, wallets: ctx.walletMap, steps: ctx.steps)
        let subtitle = [project == nil ? nil : client, "paid \(LedgerText.dayTitle(p.paidAt))"].compactMap { $0 }.joined(separator: " · ")
        LedgerDetailFrame(badge: Badge(subject: client.map { BadgeSubject.person($0) } ?? .neutral(Sym.payments), size: 48),
                          title: project?.title ?? client ?? "Payment", subtitle: subtitle) {
            LedgerPaymentMenu(payment: p, wallet: route.landed.first)
        } content: {
            Money.incoming(net, .detail)
                .padding(.top, 20)
            if let rate = LedgerText.rate(native: p.amount, p.currency, base: net) {
                Text(rate).role(.supporting, MD.onSurfaceVariant).padding(.top, 4)
            }
            LedgerRouteCard(route: route).padding(.top, 20)
            LedgerFacts(items: facts(project: project, client: client, route: route)).padding(.top, 16)
            if let notes = p.notes, !notes.isEmpty { LedgerNotes(text: notes).padding(.top, 16) }
        }
    }

    private func facts(project: Project?, client: String?, route: LedgerRoute) -> [LedgerFactItem] {
        var out: [LedgerFactItem] = []
        if let project {
            out.append(LedgerFactItem("Project", Text(project.title + " · " + LedgerText.native(project.amount, project.currency))))
        }
        if let client, let cid = project?.clientId {
            let cal = PHT.calendar
            let year = cal.component(.year, from: payment.paidAt)
            let theirs = Set(ctx.projects.filter { $0.clientId == cid }.map(\.id))
            let paid = ctx.payments.filter {
                $0.deletedAt == nil && ($0.projectId.map(theirs.contains) ?? false) && cal.component(.year, from: $0.paidAt) == year
            }
            let total = paid.reduce(0) { $0 + ($1.netAmountBase ?? 0) }
            let label = year == cal.component(.year, from: .now) ? "\(client) this year" : "\(client) in \(year)"
            let money = Money(value: total, role: .inline(14), decimals: false).text
            let count = paid.count == 1 ? "1 payment" : "\(paid.count) payments"
            out.append(LedgerFactItem(label, Text("\(money) · \(count)")))
        }
        out.append(LedgerFactItem("Landed in", Text(route.landed.isEmpty ? "Not recorded" : route.landed.joined(separator: ", then "))))
        return out
    }
}

/// ⋮ on a payment: Delete, through the engine's soft delete (to the Trash, ledger archived, project status
/// recomputed), with Undo.
private struct LedgerPaymentMenu: View {
    let payment: Payment
    let wallet: String?
    @Environment(\.modelContext) private var context
    @Environment(UndoCenter.self) private var undo: UndoCenter?

    var body: some View {
        LedgerActions(edit: nil, what: "payment",
                      message: wallet.map { "It moves to the Trash and comes off \($0)’s balance." } ?? "It moves to the Trash.") {
            let id = payment.id, ctx = context
            try? MoneyEngine(context: ctx).deletePayment(id)
            try? ctx.save()
            undo?.offer("payment") { try? MoneyEngine(context: ctx).restorePayment(id); try? ctx.save() }
        }
    }
}

/// ⋮ in a detail header: Edit when there's a form for it, and Delete after a confirmation.
private struct LedgerActions: View {
    var edit: (() -> Void)?
    let what: String
    let message: String
    let delete: () -> Void
    @State private var confirming = false

    var body: some View {
        Menu {
            if let edit {
                Button("Edit…", action: edit)
                Divider()
            }
            Button("Delete…", role: .destructive) { confirming = true }
        } label: {
            Icon(Sym.moreVert, size: 24).foregroundStyle(MD.onSurfaceVariant)
                .frame(width: 40, height: 40)
                .contentShape(Circle())
        }
        .menuStyle(.button)
        .buttonStyle(PlainButtonStyle2())
        .menuIndicator(.hidden)
        .fixedSize()
        .help("More")
        .confirmationDialog(what.first?.isNumber == true ? "Delete these \(what)?" : "Delete this \(what)?", isPresented: $confirming) {
            Button("Delete", role: .destructive, action: delete)
            Button("Cancel", role: .cancel) {}
        } message: {
            Text(message)
        }
    }
}

/// "How it reached you": the client's payment, where it landed, each move it can be tied to, and the fees.
private struct LedgerRouteCard: View {
    let route: LedgerRoute

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                Text("How it reached you").role(.sub)
                Spacer(minLength: 8)
                Text(route.hopCount == 1 ? "1 hop" : "\(route.hopCount) hops").role(.supporting, MD.onSurfaceVariant)
            }
            .padding(.bottom, 12)
            ForEach(Array(route.hops.enumerated()), id: \.element.id) { i, hop in
                LedgerHopRow(hop: hop, last: i == route.hops.count - 1)
            }
            LedgerCostLine(route: route)
        }
        .padding(.horizontal, 16).padding(.top, 16).padding(.bottom, 12)
        .background(RoundedRectangle(cornerRadius: 20, style: .continuous).fill(Surface.well))
    }
}

private struct LedgerHopRow: View {
    let hop: LedgerHop
    let last: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            mark
            VStack(alignment: .leading, spacing: 0) {
                Text(hop.title).role(.sub).lineLimit(1)
                if let sub = hop.sub { Text(sub).role(.supporting, MD.onSurfaceVariant).lineLimit(2) }
            }
            .padding(.top, 4)
            .frame(maxWidth: .infinity, alignment: .leading)
            VStack(alignment: .trailing, spacing: 0) {
                Money(value: hop.amount, role: .row, sign: .none, symbol: hop.symbol)
                if let fee = hop.fee {
                    Text("\(MoneyFormat.string(fee)) fee").role(.supporting, MD.onSurfaceVariant)
                }
            }
            .padding(.top, 4)
        }
        .padding(.bottom, last ? 12 : 14)
        .background(alignment: .topLeading) {
            if !last {
                Capsule().fill(MD.primary.opacity(0.28))
                    .frame(width: 2)
                    .frame(maxHeight: .infinity)
                    .padding(.top, 30).padding(.bottom, 2)
                    .padding(.leading, 13)
            }
        }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder private var mark: some View {
        switch hop.mark {
        case .person(let name): Badge(subject: .person(name), size: 28)
        case .wallet(let w): Badge(subject: .wallet(w), size: 28)
        case .unknown: Badge(subject: .neutral(Sym.help), size: 28)
        }
    }
}

private struct LedgerCostLine: View {
    let route: LedgerRoute

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 12) {
                Icon(Sym.currencyExchange, size: 20).foregroundStyle(MD.onSurfaceVariant).frame(width: 28)
                Text("Fees on the way").role(.sub).frame(maxWidth: .infinity, alignment: .leading)
                value
            }
            if route.together > 0 {
                Text(route.together == 1 ? "For both payments that moved together" : "For all \(route.together + 1) payments that moved together")
                    .role(.supporting, MD.onSurfaceVariant)
                    .padding(.leading, 40)
            }
        }
        .padding(.top, 12)
        .overlay(alignment: .top) { Rectangle().fill(Surface.hairline).frame(height: 1) }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder private var value: some View {
        if !route.feesKnown {
            Text("Not recorded").role(.supporting, MD.onSurfaceVariant)
        } else if route.fees < 0.005 {
            Text("None recorded").role(.supporting, MD.onSurfaceVariant)
        } else {
            let money = Money(value: route.fees, role: .row).text
            let share = Text(verbatim: " · " + LedgerText.percent(route.fees, of: route.gross))
                .font(FS.font(15, 600, rond: 100, tabular: true)).foregroundStyle(MD.onSurface)
            Text("\(money)\(share)")
        }
    }
}

// MARK: Spending, bills, giving

private struct LedgerSpendDetail: View {
    let spend: Spend
    let line: LedgerLine
    let ctx: LedgerContext
    @Environment(AppState.self) private var app
    @Environment(\.modelContext) private var modelContext
    @Environment(UndoCenter.self) private var undo: UndoCenter?

    var body: some View {
        let s = spend
        let verb = s.recurringId != nil ? "paid" : s.isSadaka ? "given" : "spent"
        LedgerDetailFrame(badge: Badge(subject: line.badge, size: 48, glyph: line.badgeGlyph), title: line.title,
                          subtitle: "\(verb) \(LedgerText.dayTitle(s.spentAt))") {
            LedgerActions(edit: s.recurringId == nil ? { app.form = .editSpend(s.id) } : nil,
                          what: s.isSadaka ? "gift" : s.recurringId != nil ? "bill payment" : "spend",
                          message: ctx.wallet(s.walletId).map { "It moves to the Trash and goes back into \($0.name)’s balance." } ?? "It moves to the Trash.") {
                let id = s.id, mc = modelContext
                try? MoneyEngine(context: mc).deleteSpend(id)
                undo?.offer(s.isSadaka ? "gift" : "spend") { try? MoneyEngine(context: mc).restoreSpend(id) }
            }
        } content: {
            Money(value: s.amountBase, role: .detail, sign: .minus, color: line.inTotals ? MD.onSurface : MD.onSurfaceVariant)
                .padding(.top, 20)
            if let rate = LedgerText.rate(native: s.amount, s.currency, base: s.amountBase) {
                Text(rate).role(.supporting, MD.onSurfaceVariant).padding(.top, 4)
            }
            if !line.inTotals {
                StatusLabel(title: "Not in your totals", tone: .quiet).padding(.top, 8)
            }
            LedgerFacts(items: facts).padding(.top, 16)
            if let notes = s.notes, !notes.isEmpty { LedgerNotes(text: notes).padding(.top, 16) }
        }
    }

    private var facts: [LedgerFactItem] {
        let s = spend
        var out: [LedgerFactItem] = []
        let when = LedgerText.dayTitle(s.spentAt) + (LedgerText.time(s.spentAt).map { ", \($0)" } ?? "")
        out.append(LedgerFactItem("When", Text(when)))
        let wallet = ctx.wallet(s.walletId)
        out.append(LedgerFactItem("Wallet", Text(wallet.map { $0.name + ($0.excludedFromTotals ? " · not in your totals" : "") } ?? "No wallet")))
        if let vendor = s.vendorName, !vendor.isEmpty, vendor != line.title {
            out.append(LedgerFactItem("Where", Text(vendor)))
        }
        let tags = s.tags.isEmpty ? (s.category.map { [$0] } ?? []) : s.tags
        if !tags.isEmpty {
            out.append(LedgerFactItem(tags.count == 1 ? "Category" : "Categories", Text(tags.joined(separator: ", "))))
        }
        if let cover = line.cover {
            out.append(LedgerFactItem("Bill", Text("\(cover.label) · \(cover.long())")))
        }
        if s.isSadaka { out.append(LedgerFactItem("Counted as", Text("Giving"))) }
        return out
    }
}

// MARK: Moves

private struct LedgerMoveDetail: View {
    let moves: [Withdrawal]
    let line: LedgerLine
    let ctx: LedgerContext
    @Environment(\.modelContext) private var modelContext
    @Environment(UndoCenter.self) private var undo: UndoCenter?

    var body: some View {
        let first = moves[0]
        let from = ctx.wallet(first.fromMethodId), to = ctx.wallet(first.toMethodId)
        let received = moves.reduce(0) { $0 + $1.netBase }
        let day = LedgerText.dayTitle(first.withdrawnAt)
        LedgerDetailFrame(badge: Badge(subject: line.badge, size: 48, glyph: line.badgeGlyph), title: line.title,
                          subtitle: moves.count == 1 ? "moved \(day)" : "\(moves.count) moves · \(day)") {
            LedgerActions(edit: nil, what: moves.count == 1 ? "move" : "\(moves.count) moves",
                          message: "It moves to the Trash, and both wallets go back to what they held before.") {
                let ids = moves.map(\.id), mc = modelContext
                for id in ids { try? MoneyEngine(context: mc).deleteWithdrawal(id) }
                try? mc.save()
                undo?.offer(ids.count == 1 ? "move" : "\(ids.count) moves") {
                    for id in ids { try? MoneyEngine(context: mc).restoreWithdrawal(id) }
                    try? mc.save()
                }
            }
        } content: {
            Money.moved(received, .detail).padding(.top, 20)
            Text(to.map { "received in \($0.name)" } ?? "received").role(.supporting, MD.onSurfaceVariant).padding(.top, 4)
            if moves.count > 1 { LedgerMovesCard(moves: moves).padding(.top, 20) }
            LedgerFacts(items: facts(from: from, to: to)).padding(.top, 16)
            if let note = legNote(from: from, to: to) { LedgerCaution(text: note).padding(.top, 16) }
            let notes = moves.compactMap(\.notes).filter { !$0.isEmpty }
            if !notes.isEmpty { LedgerNotes(text: notes.joined(separator: "\n")).padding(.top, 16) }
        }
    }

    private func facts(from: Wallet?, to: Wallet?) -> [LedgerFactItem] {
        let sent = moves.reduce(0) { $0 + $1.grossBase }
        let received = moves.reduce(0) { $0 + $1.netBase }
        let fee = moves.reduce(0) { $0 + $1.feeBase }
        func name(_ w: Wallet?) -> String { w.map { $0.name + ($0.excludedFromTotals ? " · not in your totals" : "") } ?? "Not recorded" }
        var out = [LedgerFactItem("From", Text(name(from))), LedgerFactItem("To", Text(name(to)))]
        if moves.count == 1, let t = LedgerText.time(moves[0].withdrawnAt) { out.append(LedgerFactItem("At", Text(t))) }
        out.append(LedgerFactItem("Sent", Money(value: sent, role: .inline(14)).text))
        out.append(LedgerFactItem("Received", Money(value: received, role: .inline(14)).text))
        let feeMoney = Money(value: fee, role: .inline(14)).text
        let feeShare = LedgerText.percent(fee, of: sent)
        out.append(LedgerFactItem(moves.count == 1 ? "Fee" : "Fees", fee < 0.005 ? Text("None") : Text("\(feeMoney) · \(feeShare)")))
        return out
    }

    /// A move whose arriving half never reached the ledger (some imported moves only debit the source).
    private func legNote(from: Wallet?, to: Wallet?) -> String? {
        let live = ctx.ledger.filter { $0.archivedAt == nil }
        let missing = moves.filter { w in
            guard let dest = w.toMethodId, w.netBase > 0.004 else { return false }
            return !live.contains { $0.relatedId == w.id && $0.walletId == dest && $0.amountBase > 0 }
        }
        guard !missing.isEmpty, let to, let from else { return nil }
        let which = missing.count == moves.count ? (moves.count == 1 ? "this move" : "these moves") : "\(missing.count) of these moves"
        return "Only the \(from.name) side of \(which) is in the ledger, so \(to.name)’s balance never received \(missing.count == 1 ? "it" : "them")."
    }
}

private struct LedgerMovesCard: View {
    let moves: [Withdrawal]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                Text("Each move").role(.sub)
                Spacer(minLength: 8)
                Text("received").role(.supporting, MD.onSurfaceVariant)
            }
            .padding(.bottom, 12)
            ForEach(Array(moves.enumerated()), id: \.element.id) { i, w in
                HStack(alignment: .top, spacing: 12) {
                    VStack(alignment: .leading, spacing: 0) {
                        Text(LedgerText.time(w.withdrawnAt) ?? "No time").role(.sub)
                        Text("\(MoneyFormat.string(w.grossBase)) sent").role(.supporting, MD.onSurfaceVariant)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    VStack(alignment: .trailing, spacing: 0) {
                        Money(value: w.netBase, role: .row, sign: .none)
                        if w.feeBase > 0.004 {
                            Text("\(MoneyFormat.string(w.feeBase)) fee").role(.supporting, MD.onSurfaceVariant)
                        }
                    }
                }
                .padding(.bottom, i == moves.count - 1 ? 0 : 12)
                .accessibilityElement(children: .combine)
            }
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: 20, style: .continuous).fill(Surface.well))
    }
}

// MARK: Counts

private struct LedgerCountDetail: View {
    let day: Date
    let line: LedgerLine
    let ctx: LedgerContext

    var body: some View {
        let counted = LedgerCounts.detail(day: day, ledger: ctx.ledger, wallets: ctx.walletMap)
        let total = line.amount
        let what = total >= 0 ? "more than Freelane had" : "less than Freelane had"
        LedgerDetailFrame(badge: Badge(subject: line.badge, size: 48, glyph: line.badgeGlyph), title: line.title,
                          subtitle: "counted \(LedgerText.dayTitle(day))") {
            EmptyView()
        } content: {
            Group {
                if !line.inTotals {
                    Money(value: abs(total), role: .detail, sign: total >= 0 ? .plus : .minus, color: MD.onSurfaceVariant)
                } else if total >= 0 {
                    Money.incoming(total, .detail)
                } else {
                    Money.outgoing(total, .detail)
                }
            }
            .padding(.top, 20)
            Text(counted.count > 1 ? "\(what), across \(counted.count) wallets" : what)
                .role(.supporting, MD.onSurfaceVariant).padding(.top, 4)
            if !counted.isEmpty { LedgerCountCard(wallets: counted).padding(.top, 20) }
        }
    }
}

private struct LedgerCountCard: View {
    let wallets: [LedgerCountWallet]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                Text("What you counted").role(.sub)
                Spacer(minLength: 8)
                Text(wallets.count == 1 ? "1 wallet" : "\(wallets.count) wallets").role(.supporting, MD.onSurfaceVariant)
            }
            .padding(.bottom, 12)
            ForEach(Array(wallets.enumerated()), id: \.element.id) { i, cw in
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 12) {
                        Badge(subject: .wallet(cw.wallet), size: 28)
                        Text(cw.wallet.name).role(.sub).frame(maxWidth: .infinity, alignment: .leading)
                        total(cw)
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        ForEach(cw.lines) { l in
                            Text(describe(l, wallet: cw.wallet, many: cw.lines.count > 1))
                                .role(.supporting, MD.onSurfaceVariant)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        if cw.wallet.excludedFromTotals {
                            Text("not in your totals").role(.supporting, MD.onSurfaceVariant)
                        }
                    }
                    .padding(.leading, 40)
                }
                .padding(.bottom, i == wallets.count - 1 ? 0 : 14)
                .accessibilityElement(children: .combine)
            }
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: 20, style: .continuous).fill(Surface.well))
    }

    @ViewBuilder private func total(_ cw: LedgerCountWallet) -> some View {
        if cw.wallet.excludedFromTotals {
            Money(value: abs(cw.total), role: .row, sign: cw.total >= 0 ? .plus : .minus, color: MD.onSurfaceVariant)
        } else if cw.total >= 0 {
            Money.incoming(cw.total)
        } else {
            Money.outgoing(cw.total)
        }
    }

    /// "Freelane had ₱0.00, you counted ₱500.00", or with several counts that day "22:10 · had ₱0.00, counted ₱1,200.00".
    private func describe(_ l: LedgerCountLine, wallet: Wallet, many: Bool) -> String {
        let at = many ? LedgerText.time(l.at).map { "\($0) · " } ?? "" : ""
        guard let had = l.had, let counted = l.counted else {
            let diff = (l.amount >= 0 ? "+" : "−") + MoneyFormat.string(abs(l.amount))
            return "\(at)\(diff), counted before \(wallet.name)’s starting balance was set"
        }
        return many ? "\(at)had \(MoneyFormat.string(had)), counted \(MoneyFormat.string(counted))"
            : "Freelane had \(MoneyFormat.string(had)), you counted \(MoneyFormat.string(counted))"
    }
}

// MARK: Fees

private struct LedgerFeeDetail: View {
    let entry: LedgerEntry
    let line: LedgerLine
    let ctx: LedgerContext

    var body: some View {
        let wallet = ctx.wallet(entry.walletId)
        LedgerDetailFrame(badge: Badge(subject: line.badge, size: 48, glyph: line.badgeGlyph), title: line.title,
                          subtitle: "charged \(LedgerText.dayTitle(entry.eventAt))") {
            EmptyView()
        } content: {
            Money(value: abs(entry.amountBase), role: .detail, sign: .minus, color: line.inTotals ? MD.onSurface : MD.onSurfaceVariant)
                .padding(.top, 20)
            if !line.inTotals {
                StatusLabel(title: "Not in your totals", tone: .quiet).padding(.top, 8)
            }
            LedgerFacts(items: [
                LedgerFactItem("Wallet", Text(wallet?.name ?? "Not recorded")),
                LedgerFactItem("Kind", Text(entry.note == "monthly-fee" ? "Monthly wallet fee" : "Fee")),
                LedgerFactItem("Charged", Text(LedgerText.dayTitle(entry.eventAt))),
            ])
            .padding(.top, 16)
        }
    }
}

// MARK: Shared detail pieces

private struct LedgerFactItem: Identifiable {
    let label: String
    let value: Text
    var id: String { label }
    init(_ label: String, _ value: Text) { self.label = label; self.value = value }
}

/// Key–value rows, 44pt, hairlines between them (the last has none).
private struct LedgerFacts: View {
    let items: [LedgerFactItem]
    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(items.enumerated()), id: \.element.id) { i, item in
                HStack(alignment: .firstTextBaseline, spacing: 16) {
                    Text(item.label).role(.supporting, MD.onSurfaceVariant).lineLimit(1).fixedSize()
                    item.value.font(TextRole.sub.font).foregroundStyle(MD.onSurface)
                        .lineLimit(2).multilineTextAlignment(.trailing)
                        .frame(maxWidth: .infinity, alignment: .trailing)
                }
                .padding(.horizontal, 4).padding(.vertical, 12)
                .frame(minHeight: 44)
                .overlay(alignment: .bottom) {
                    if i < items.count - 1 { Rectangle().fill(Surface.hairline).frame(height: 1) }
                }
                .accessibilityElement(children: .combine)
            }
        }
    }
}

private struct LedgerNotes: View {
    let text: String
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Notes").role(.supporting, MD.onSurfaceVariant)
            Text(text).role(.body).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 4)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// A plain-spoken note about something in the records that doesn't add up.
private struct LedgerCaution: View {
    let text: String
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Icon(Sym.info, size: 20).foregroundStyle(MD.onTertiaryContainer)
            Text(text).role(.supporting, MD.onTertiaryContainer).fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(MD.tertiaryContainer))
    }
}

private struct LedgerNothingSelected: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Nothing selected").role(.pane).frame(height: 48).padding(.top, 20)
            Text("Choose an entry on the left to see its details.").role(.body, MD.onSurfaceVariant)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct LedgerGone: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("No longer here").role(.pane).frame(height: 48).padding(.top, 20)
            Text("This entry has been removed from your records.").role(.body, MD.onSurfaceVariant)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

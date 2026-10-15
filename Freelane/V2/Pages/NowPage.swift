import SwiftUI
import SwiftData

/// Now: what you hold, what's free, what needs you.
struct NowPage: View {
    @Environment(AppState.self) private var app
    let state: MoneyState

    var body: some View {
        let s = state
        HStack(spacing: 12) {
            Pane {
                PaneHeader(title: "Now", subtitle: Day.long(.now)) { SearchPill() }
                ScrollView(.vertical, showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 0) {
                        Hero(state: s).padding(.top, 16)
                        if !s.needs.isEmpty {
                            SectionHeader(title: "Needs you", count: s.needs.count)
                            Segmented(items: s.needs) { NeedRow(item: $0) }
                        }
                        SectionHeader(title: "Latest") {
                            M3Button(title: "See all", kind: .text) { withAnimation(Flow.slow) { app.go(.ledger) } }
                        }
                        Segmented(items: Array(s.feed.prefix(s.needs.count >= 3 ? 2 : 4))) { FeedRow(item: $0) }
                    }
                }
            }
            .frame(minWidth: 560)
            Pane {
                WalletsSide(state: s)
            }
            .frame(width: 384)
        }
    }
}

/// The search field in the header (opens search).
struct SearchPill: View {
    var body: some View {
        HStack(spacing: 12) {
            Icon(Sym.search, size: 24).foregroundStyle(MD.onSurface)
            Text("Search").role(.body, MD.onSurfaceVariant).font(FS.font(15, 400))
            Spacer()
            Text("⌘F").font(FS.font(12, 500, rond: 60)).foregroundStyle(MD.onSurfaceVariant.opacity(0.7))
        }
        .padding(.horizontal, 18)
        .frame(width: 260, height: 48)
        .background(Capsule().fill(Surface.well))
    }
}

// MARK: - Hero

private struct Hero: View {
    let state: MoneyState
    var body: some View {
        Band(hero: true) {
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 4) {
                        Money(value: state.free, role: .hero, color: MD.onPrimaryContainer)
                            .contentTransition(.numericText(value: state.free))
                        Text(state.setAside > 0 ? "free to spend" : "yours to spend").role(.heroLabel, MD.onPrimaryContainer)
                        sentence.role(.body, MD.onPrimaryContainer).padding(.top, 2)
                    }
                    Spacer(minLength: 16)
                    if state.monthBillsPaid {
                        Sticker(glyph: Sym.check, text: "\(Day.month(.now))’s\nbills paid")
                            .transition(.scale(scale: 0.6).combined(with: .opacity))
                    }
                }
                BillTrack(bills: state.bills).padding(.top, 20)
                HStack(spacing: 8) {
                    Capsule().fill(MD.onPrimaryContainer.opacity(0.32)).frame(width: 22, height: 8)
                    Text("Each bill is set aside in the \(SetAside.days == 7 ? "week" : "\(SetAside.days) days") before it’s due")
                        .font(FS.font(12, 400)).foregroundStyle(MD.onPrimaryContainer)
                }
                .padding(.top, 8)
            }
        }
    }

    private var sentence: Text {
        let reserved = state.bills.filter(\.isSetAside)
        if !reserved.isEmpty {
            let names = reserved.map(\.label).joined(separator: ", ")
            return Text("\(MoneyFormat.string(state.setAside, decimals: false)) is set aside for \(names).")
        }
        if let next = state.nextBill, let due = next.nextDue {
            return Text("Nothing is due this week. \(next.label) is next: ")
                + Text(verbatim: (next.estimate ? "~" : "") + MoneyFormat.string(next.amount, decimals: false)).font(FS.font(14, 600))
                + Text(" on \(Day.long(due).replacingOccurrences(of: " ", with: "\u{00A0}", options: [], range: nil)).")
        }
        return Text("No bills on the calendar.")
    }
}

/// The next 30 days with each bill on its day and its set-aside week drawn on the track.
private struct BillTrack: View {
    let bills: [BillLine]
    private let span = 30.0

    private var groups: [(date: Date, bills: [BillLine])] {
        let upcoming = bills.filter { $0.coveredUntil == nil && $0.nextDue != nil && Day.daysBetween(.now, $0.nextDue!) <= Int(span) }
        let byDay = Dictionary(grouping: upcoming) { PHT.calendar.startOfDay(for: $0.nextDue!) }
        return byDay.keys.sorted().map { ($0, byDay[$0]!) }
    }

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width - 23
            let x = { (d: Date) -> CGFloat in 9 + CGFloat(min(max(Double(Day.daysBetween(.now, d)) / span, 0), 1)) * w }
            ZStack(alignment: .topLeading) {
                Capsule().fill(MD.onPrimaryContainer.opacity(0.13)).frame(width: w + 5, height: 10).offset(x: 9, y: 9)
                ForEach(groups, id: \.date) { g in
                    let x0 = 9 + CGFloat(Double(max(Day.daysBetween(.now, g.date) - SetAside.days, 0)) / span) * w
                    Capsule().fill(MD.onPrimaryContainer.opacity(0.32)).frame(width: max(x(g.date) - x0, 10), height: 10).offset(x: x0, y: 9)
                }
                Circle().fill(MD.primary).frame(width: 18, height: 18).overlay(Circle().stroke(MD.primaryContainer, lineWidth: 4)).offset(y: 5)
                pin(label(title: "Today", sub: Day.short(.now), align: .leading), x: 0, y: 34, .topLeading)
                ForEach(Array(groups.enumerated()), id: \.element.date) { i, g in
                    let edge: Alignment = x(g.date) > w * 0.8 ? .topTrailing : (x(g.date) < w * 0.15 ? .topLeading : .top)
                    let markerX = edge == .topTrailing ? x(g.date) + 9 : x(g.date)
                    pin(HStack(spacing: 4) { ForEach(g.bills) { b in Badge(subject: .bill(b.label), size: 28) } }, x: markerX, y: 0, edge)
                    pin(label(title: g.bills.map { "\($0.label) \($0.estimate ? "~" : "")\(MoneyFormat.string($0.amount, decimals: false))" }.joined(separator: " · "),
                              sub: Day.short(g.date), align: edge == .topTrailing ? .trailing : edge == .topLeading ? .leading : .center),
                        x: markerX, y: 34, edge)
                }
            }
            .frame(width: geo.size.width, height: 70, alignment: .topLeading)
        }
        .frame(height: 70)
    }

    /// Places a view so its `edge` sits at (x, y) without widening the layout.
    private func pin<V: View>(_ v: V, x: CGFloat, y: CGFloat, _ edge: Alignment) -> some View {
        Color.clear.frame(width: 1, height: 1)
            .overlay(alignment: edge) { v.fixedSize() }
            .offset(x: x, y: y)
    }

    private func label(title: String, sub: String, align: HorizontalAlignment) -> some View {
        VStack(alignment: align, spacing: 0) {
            Text(title).font(FS.font(13, 600))
            Text(sub).font(FS.font(13, 400))
        }
        .foregroundStyle(MD.onPrimaryContainer)
    }
}

// MARK: - Needs you

private struct NeedRow: View {
    @Environment(AppState.self) private var app
    let item: NeedItem
    var body: some View {
        switch item.kind {
        case .count(let w):
            row(badge: Badge(subject: .wallet(w.wallet), size: 48), title: "Count \(w.name)",
                sub: Text("Freelane thinks it holds ") + Text(verbatim: MoneyFormat.string(w.balance)).font(FS.font(13, 600)) +
                    Text(w.lastCounted == nil ? ". You’ve never checked it against the \(w.name) app." : ". Last counted \(Day.ago(w.lastCounted!))."),
                action: "Count") { withAnimation(Flow.spatial) { app.counting = true } }
        case .owed(let p, let client, let native, let currency, _):
            let days = p.workCompletedAt.map { Day.daysBetween($0, .now) } ?? 0
            row(badge: Badge(subject: .person(client), size: 48), title: "\(client) owes you \(CurrencyFormat.symbol(currency))\(MoneyFormat.parts(native).whole)",
                sub: Text("For \(p.title.lowercased().hasPrefix("the") ? p.title : "the " + p.title.lowercased()), delivered \(Day.dayMonth(p.workCompletedAt ?? p.createdAt)). It’s been \(days) days."),
                action: "Mark paid") { withAnimation(Flow.slow) { app.go(.work) } }
        case .estimate(let b, let suggested):
            row(badge: Badge(subject: .bill(b.label), size: 48), title: "\(b.label) came to \(MoneyFormat.string(b.lastPaid?.amount ?? 0, decimals: false))",
                sub: Text("Use \(MoneyFormat.string(suggested, decimals: false)) as next month’s estimate instead of \(MoneyFormat.string(b.amount, decimals: false))?"),
                action: "Use \(MoneyFormat.string(suggested, decimals: false))") {
                    b.bill.amount = suggested; b.bill.amountBase = suggested; b.bill.updatedAt = .now; b.bill.dirty = true
                }
        }
    }

    private func row(badge: Badge, title: String, sub: Text, action: String, perform: @escaping () -> Void) -> some View {
        HStack(spacing: 16) {
            badge
            VStack(alignment: .leading, spacing: 2) {
                Text(title).role(.rowLarge).lineLimit(1)
                sub.role(.supporting, MD.onSurfaceVariant).lineLimit(2)
            }
            Spacer(minLength: 12)
            M3Button(title: action, kind: .tonal, small: true, action: perform)
        }
        .padding(.leading, 12).padding(.trailing, 16).padding(.vertical, 12)
        .frame(minHeight: 72)
    }
}

// MARK: - Feed rows

struct FeedRow: View {
    let item: FeedItem
    var body: some View {
        ListRow(badge: Badge(subject: item.badge, size: 40, glyph: item.badgeGlyph),
                title: item.title, subtitle: subtitle) {
            amount
        }
    }
    private var subtitle: String {
        let when = Day.ago(item.date)
        return (when == "today" || when == "yesterday" ? when.capitalized : when) + " · " + item.subtitle
    }
    @ViewBuilder private var amount: some View {
        switch item.kind {
        case .move: Money.moved(item.amount)
        case .payment: Money.incoming(item.amount)
        case .count: item.amount >= 0 ? Money.incoming(item.amount) : Money.outgoing(item.amount)
        case .fee: Money(value: abs(item.amount), role: .row, sign: .minus, color: item.inTotals ? MD.onSurface : MD.onSurfaceVariant)
        default: Money.outgoing(item.amount)
        }
    }
}

// MARK: - Side pane

private struct WalletsSide: View {
    let state: MoneyState
    @Environment(AppState.self) private var app
    var body: some View {
        PaneHeader(title: "Wallets", big: false) {
            Text(verbatim: MoneyFormat.string(state.total)).font(FS.font(16, 600, rond: 100)).foregroundStyle(MD.onSurfaceVariant)
        }
        ScrollView(.vertical, showsIndicators: false) {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(state.wallets.filter(\.inTotals)) { w in
                    ListRow(badge: Badge(subject: .wallet(w.wallet)), title: w.name,
                            subtitle: w.lastCounted.map { "counted \(Day.ago($0))" } ?? "never counted", height: 52) {
                        Money(value: w.balance)
                    }
                    .padding(.horizontal, -8)
                    .pressable(RoundedRectangle(cornerRadius: 12)) { withAnimation(Flow.slow) { app.go(.wallets) } }
                }
                let upcoming = state.bills
                if !upcoming.isEmpty {
                    SectionHeader(title: "Coming up", small: true) {
                        Text(state.setAside > 0 ? "\(MoneyFormat.string(state.setAside, decimals: false)) set aside" : "not set aside yet").role(.supporting, MD.onSurfaceVariant)
                    }
                    ForEach(upcoming) { b in
                        ListRow(badge: Badge(subject: .bill(b.label)), title: b.label, subtitle: billSub(b), height: 52) {
                            if b.coveredUntil == nil { Money(value: b.amount, decimals: false, estimate: b.estimate) }
                        }
                        .padding(.horizontal, -8)
                    }
                }
                let owed = state.needs.compactMap { n -> (String, Project, Double, String, Double)? in
                    if case let .owed(p, c, native, cur, base) = n.kind { return (c, p, native, cur, base) }; return nil
                }
                if !owed.isEmpty {
                    SectionHeader(title: "Owed to you", small: true)
                    ForEach(owed, id: \.1.id) { o in
                        ListRow(badge: Badge(subject: .person(o.0)), title: o.0,
                                subtitle: "\(CurrencyFormat.symbol(o.3))\(MoneyFormat.parts(o.2).whole) · \(o.1.title.lowercased()) · \(Day.daysBetween(o.1.workCompletedAt ?? o.1.createdAt, .now)) days", height: 52) {
                            Money(value: o.4, decimals: false, estimate: o.3 != "PHP")
                        }
                        .padding(.horizontal, -8)
                    }
                }
                MonthCard(month: state.month).padding(.top, 24)
            }
        }
    }

    private func billSub(_ b: BillLine) -> String {
        if let c = b.coveredUntil { return "paid up to \(Day.full(c))" }
        guard let d = b.nextDue else { return "no date" }
        return "\(Day.short(d)) · \(Day.until(d))" + (b.isSetAside ? " · set aside" : "")
    }
}

private struct MonthCard: View {
    let month: MonthFigures
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("\(Day.month(.now)) so far").role(.sub, MD.onSurfaceVariant)
            HStack {
                fig("Came in", month.cameIn)
                Spacer()
                fig("Went out", month.wentOut)
                Spacer()
                fig("Fees", month.fees)
            }
        }
        .padding(.horizontal, 16).padding(.top, 12).padding(.bottom, 14)
        .background(RoundedRectangle(cornerRadius: 20, style: .continuous).fill(Surface.well))
    }
    private func fig(_ label: String, _ v: Double) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).role(.supporting, MD.onSurfaceVariant)
            Money(value: v, role: .inline(17), decimals: false)
        }
    }
}

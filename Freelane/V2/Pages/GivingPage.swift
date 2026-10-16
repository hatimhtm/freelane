import SwiftUI
import SwiftData

/// Giving: sadaka, kept as gifts. What he gave this year, every gift, and a few plain facts.
struct GivingPage: View {
    let state: MoneyState
    @Environment(AppState.self) private var app
    @Environment(\.accessibilityReduceMotion) private var reduce
    @Query(filter: #Predicate<Spend> { $0.isSadaka }, sort: \Spend.spentAt, order: .reverse) private var marked: [Spend]
    @Query private var wallets: [Wallet]
    @State private var showAll = false

    /// How many gifts the list shows before "See all".
    private let latest = 8

    var body: some View {
        let p = GivingMath.build(spends: marked, wallets: wallets)
        HStack(spacing: 12) {
            Pane {
                PaneHeader(title: "Giving") {
                    M3Button(title: "Record a gift", icon: Sym.add, kind: .tonal) {
                        withAnimation(Flow.pick(Flow.spatial, reduce: reduce)) { app.form = .gift }
                    }
                    .help("Record a gift as spending marked sadaka")
                }
                ScrollViewReader { proxy in
                    PaneScroll {
                        VStack(alignment: .leading, spacing: 0) {
                            GivingBand(picture: p).padding(.top, 16).appear(0)
                            SectionHeader(title: "Gifts") {
                                if p.gifts.count > latest {
                                    M3Button(title: showAll ? "Show latest \(latest)" : "See all \(p.gifts.count)", kind: .text) {
                                        withAnimation(Flow.pick(Flow.spatial, reduce: reduce)) { showAll.toggle() }
                                    }
                                    .contentTransition(.opacity)
                                }
                            }
                            if p.gifts.isEmpty {
                                Text("Gifts you record show up here.")
                                    .role(.body, MD.onSurfaceVariant)
                                    .padding(.horizontal, 4)
                            } else {
                                GivingList(gifts: showAll ? p.gifts : Array(p.gifts.prefix(latest))).appear(2)
                            }
                        }
                        .padding(.bottom, 8)
                    }
                    .onChange(of: showAll) { _, all in
                        // The rest of the list opens below the fold: glide it into view so the change is seen.
                        guard all, p.gifts.count > latest else { return }
                        let first = p.gifts[latest].id
                        DispatchQueue.main.async {
                            withAnimation(Flow.pick(Flow.slow, reduce: reduce)) { proxy.scrollTo(first, anchor: .center) }
                        }
                    }
                }
            }
            .frame(minWidth: 560)
            Pane { GivingSide(picture: p).appear(1) }
                .frame(width: 384)
        }
        .onReceive(DistributedNotificationCenter.default().publisher(for: .init("app.freelane.dev." + (ProcessInfo.processInfo.environment["FREELANE_DEV_CHANNEL"] ?? "main")))) { n in
            // Test builds only: "giving:all" expands the list, "giving:latest" folds it.
            guard DevMode.isSandboxed, let cmd = n.object as? String else { return }
            if cmd == "giving:all" { withAnimation(Flow.spatial) { showAll = true } }
            if cmd == "giving:latest" { withAnimation(Flow.spatial) { showAll = false } }
        }
    }
}

// MARK: - Summary band

private struct GivingBand: View {
    let picture: GivingPicture
    var body: some View {
        let p = picture
        Band {
            HStack(alignment: .bottom, spacing: 24) {
                VStack(alignment: .leading, spacing: 0) {
                    Money(value: p.total.rounded(), role: .summary, decimals: false, color: MD.onPrimaryContainer)
                        .contentTransition(.numericText(value: p.total.rounded()))
                    Text(p.start.map { "given since " + InsightsMath.monthName($0) } ?? "given this year")
                        .role(.summaryLabel, MD.onPrimaryContainer)
                        .padding(.top, 4)
                    Text(sentence).role(.body, MD.onPrimaryContainer)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 2)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                if !p.months.isEmpty {
                    GivingMonthChart(months: p.months)
                        .frame(width: GivingMonthChart.width(for: p.months.count), height: GivingMonthChart.height)
                }
            }
        }
        .accessibilityElement(children: .combine)
    }

    private var sentence: String {
        let p = picture
        guard let largest = p.largest else {
            if let last = p.gifts.first { return "Nothing given yet this year. The last gift was on \(Day.full(last.date))." }
            return "No gifts recorded yet."
        }
        let when = Day.month(largest.date)
        let what = largest.hasDescription ? "“\(GivingFormat.short(largest.title))”" : MoneyFormat.string(largest.amount, decimals: false)
        if p.inPeriod.count == 1 { return "One gift: \(what) in \(when)." }
        return "\(p.inPeriod.count) gifts. The largest was \(what) in \(when)."
    }
}

/// Month bars inside the band. Every label sits inside the band: the plot is sized to hold the tallest bar,
/// its value above and the month below.
private struct GivingMonthChart: View {
    let months: [GivingMonth]
    static let height: CGFloat = 108
    static func width(for n: Int) -> CGFloat { min(380, max(160, CGFloat(n) * 72)) }

    var body: some View {
        let top = max(months.map(\.total).max() ?? 0, 1)
        let best = months.filter { $0.total > 0 }.max { $0.total < $1.total }?.id
        GeometryReader { geo in
            let n = CGFloat(max(months.count, 1))
            let gap: CGFloat = months.count > 8 ? 6 : 12
            let column = (geo.size.width - gap * (n - 1)) / n
            let maxBar = GivingMonthChart.height - 16 - 4 - 4 - 16
            HStack(alignment: .bottom, spacing: gap) {
                ForEach(months) { m in
                    VStack(spacing: 4) {
                        Text(InsightsMath.compact(m.total)).role(.small, MD.onPrimaryContainer)
                            .fixedSize()
                            .opacity(column >= 30 || m.id == best ? 1 : 0)
                        UnevenRoundedRectangle(topLeadingRadius: 6, bottomLeadingRadius: 3, bottomTrailingRadius: 3, topTrailingRadius: 6, style: .continuous)
                            .fill(m.id == best ? MD.primary : MD.onPrimaryContainer.opacity(0.28))
                            .frame(width: min(40, column), height: m.total >= 0.5 ? max(4, CGFloat(m.total / top) * maxBar) : 0)
                        Text(InsightsFormat.month(m.start) + (m.isCurrent && column >= 60 ? " so far" : ""))
                            .role(.small, MD.onPrimaryContainer)
                            .lineLimit(1).fixedSize()
                    }
                    .frame(width: column, height: GivingMonthChart.height, alignment: .bottom)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("\(Day.month(m.start))\(m.isCurrent ? " so far" : ""): \(MoneyFormat.string(m.total, decimals: false)) in \(m.count) \(m.count == 1 ? "gift" : "gifts")")
                }
            }
        }
    }
}

enum GivingFormat {
    /// A description cut to fit a sentence, at a word boundary.
    static func short(_ s: String, limit: Int = 42) -> String {
        guard s.count > limit else { return s }
        let cut = s.prefix(limit)
        let base = cut.lastIndex(of: " ").map { cut[..<$0] } ?? cut
        return base.trimmingCharacters(in: .punctuationCharacters.union(.whitespaces)) + "…"
    }

    /// "1 Sep · €141.10 from Wise", "21 Aug · from Cash". Older years get the year.
    static func line(_ g: GivingGift) -> String {
        let sameYear = PHT.calendar.component(.year, from: g.date) == PHT.calendar.component(.year, from: .now)
        var parts = [sameYear ? Day.dayMonth(g.date) : Day.full(g.date)]
        let source = g.walletName.map { "from \($0)" } ?? "no wallet"
        if let n = g.native {
            parts.append(MoneyFormat.string(n.amount, sign: .none, symbol: CurrencyFormat.symbol(n.currency)) + " " + source)
        } else {
            parts.append(source)
        }
        return parts.joined(separator: " · ")
    }
}

// MARK: - Gifts

/// The gifts as one segmented group. Rows fold in and out in place when the list expands.
private struct GivingList: View {
    let gifts: [GivingGift]
    @Environment(AppState.self) private var app
    @Environment(\.modelContext) private var context
    @Environment(UndoCenter.self) private var undo
    var body: some View {
        VStack(spacing: 3) {
            ForEach(Array(gifts.enumerated()), id: \.element.id) { i, g in
                let first = i == 0, last = i == gifts.count - 1
                let shape = UnevenRoundedRectangle(topLeadingRadius: first ? 20 : 6, bottomLeadingRadius: last ? 20 : 6,
                                                   bottomTrailingRadius: last ? 20 : 6, topTrailingRadius: first ? 20 : 6, style: .continuous)
                ListRow(badge: Badge(subject: .neutral(Sym.volunteerActivism), size: 40), title: g.title, subtitle: GivingFormat.line(g)) {
                    Money(value: g.amount, role: .row)
                }
                .background(shape.fill(Surface.well))
                .pressable(Rectangle()) { withAnimation(Flow.spatial) { app.form = .editSpend(g.id) } }
                .clipShape(shape)
                .contextMenu {
                    Button("Edit gift…") { withAnimation(Flow.spatial) { app.form = .editSpend(g.id) } }
                    Divider()
                    Button("Delete gift", role: .destructive) {
                        let id = g.id, ctx = context
                        guard (try? MoneyEngine(context: ctx).deleteSpend(id)) != nil else { return }
                        undo.offer("gift") { try? MoneyEngine(context: ctx).restoreSpend(id) }
                        WidgetBridge.update(ctx)
                    }
                }
                .id(g.id)
                .transition(.asymmetric(insertion: .opacity.combined(with: .offset(y: -6)), removal: .opacity))
                .accessibilityElement(children: .combine)
            }
        }
    }
}

// MARK: - This year

private struct GivingSide: View {
    let picture: GivingPicture
    var body: some View {
        let p = picture
        PaneHeader(title: "This year", big: false)
        if p.inPeriod.isEmpty {
            Text(p.gifts.isEmpty ? "Nothing recorded yet." : "Nothing given yet this year.")
                .role(.body, MD.onSurfaceVariant)
                .padding(.horizontal, 4).padding(.top, 8)
        } else {
            VStack(spacing: 0) {
                if let m = p.mostGiven {
                    GivingFact(label: "Most given", value: Text("\(Text(verbatim: Day.month(m.start) + (m.isCurrent ? " so far" : "") + " · "))\(money(m.total, decimals: false))"))
                }
                if let last = p.inPeriod.first {
                    GivingFact(label: "Last gift", value: Text(Day.dayMonthLong(last.date)))
                }
                if let w = p.usualWallet {
                    GivingFact(label: "Usually from", value: Text("\(w.name), \(w.count) of \(p.inPeriod.count)"))
                }
                if let start = p.start {
                    GivingFact(label: "Since " + InsightsMath.monthName(start),
                               value: Text("\(money(p.total, decimals: true))\(Text(verbatim: " in \(p.inPeriod.count) \(p.inPeriod.count == 1 ? "gift" : "gifts")"))"),
                               last: true)
                }
            }
            .padding(.top, 8)
            let who = p.recipients
            if who.filter({ !$0.isOthers }).count >= 1 && who.count >= 2 {
                SectionHeader(title: "Who you gave to", small: true)
                VStack(spacing: 10) {
                    let most = who.map(\.total).max() ?? 1
                    ForEach(Array(who.enumerated()), id: \.element.id) { i, r in
                        GivingWho(recipient: r, fraction: r.total / max(most, 1)).appear(i + 4)
                    }
                }
            } else if p.top.count >= 2 {
                let top = p.top
                SectionHeader(title: "Largest gifts", small: true)
                VStack(spacing: 10) {
                    ForEach(top) { g in GivingLargest(gift: g, fraction: g.amount / max(top[0].amount, 1)) }
                }
            }
        }
    }

    private func money(_ v: Double, decimals: Bool) -> Text {
        Money(value: v, role: .inline(14), decimals: decimals).text
    }
}

/// A fact row whose value can carry an amount in the money role. Hairline between rows, none after the last.
private struct GivingFact: View {
    let label: String
    let value: Text
    var last = false
    var body: some View {
        HStack {
            Text(label).role(.supporting, MD.onSurfaceVariant)
            Spacer(minLength: 16)
            value.role(.body).multilineTextAlignment(.trailing).lineLimit(1)
        }
        .padding(.horizontal, 4)
        .frame(height: 44)
        .overlay(alignment: .bottom) { if !last { Rectangle().fill(Surface.hairline).frame(height: 1) } }
        .accessibilityElement(children: .combine)
    }
}

/// A person he gave to, with what they received this year.
private struct GivingWho: View {
    let recipient: GivingRecipient
    let fraction: Double
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(recipient.name).role(.body).lineLimit(1)
                Spacer(minLength: 8)
                Money(value: recipient.total, role: .row, decimals: false)
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Surface.well2)
                    Capsule().fill(recipient.isOthers ? MD.primary.opacity(0.55) : MD.primary).frame(width: max(8, geo.size.width * fraction))
                        .grow(axis: .horizontal)
                }
            }
            .frame(height: 8)
        }
        .padding(.horizontal, 4)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(recipient.name): \(MoneyFormat.string(recipient.total)) in \(recipient.count) \(recipient.count == 1 ? "gift" : "gifts")")
    }
}

private struct GivingLargest: View {
    let gift: GivingGift
    let fraction: Double
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(gift.title).role(.body).lineLimit(1)
                Text(Day.dayMonth(gift.date)).role(.supporting, MD.onSurfaceVariant).fixedSize()
                Spacer(minLength: 8)
                Money(value: gift.amount, role: .row, decimals: false)
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Surface.well2)
                    Capsule().fill(MD.primary).frame(width: max(8, geo.size.width * fraction))
                }
            }
            .frame(height: 8)
        }
        .padding(.horizontal, 4)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(gift.title), \(Day.long(gift.date)): \(MoneyFormat.string(gift.amount))")
    }
}

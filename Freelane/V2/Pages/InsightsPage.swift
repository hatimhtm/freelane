import SwiftUI
import SwiftData

/// Insights: the honest picture of money in and out, including what counting found.
/// One period drives every figure on the page.
struct InsightsPage: View {
    let state: MoneyState
    @Environment(\.accessibilityReduceMotion) private var reduce
    @Query private var wallets: [Wallet]
    @Query private var ledger: [LedgerEntry]
    @Query private var spends: [Spend]
    @Query private var payments: [Payment]
    @Query private var withdrawals: [Withdrawal]
    @Query private var recurring: [Recurring]
    @State private var period: InsightsPeriod = InsightsPage.savedPeriod
    @State private var menuOpen = false
    @State private var pinnedMonth: Int? = nil   // test builds only: show one month's figures without hovering

    private static let periodKey = "v2.insights.period"
    private static var savedPeriod: InsightsPeriod {
        DevMode.isSandboxed ? .all : InsightsPeriod(rawValue: UserDefaults.standard.string(forKey: periodKey) ?? "") ?? .all
    }

    var body: some View {
        let p = InsightsMath.build(period: period, wallets: wallets, ledger: ledger, spends: spends, payments: payments,
                                   withdrawals: withdrawals, recurring: recurring)
        HStack(spacing: 12) {
            Pane {
                PaneHeader(title: "Insights") {
                    InsightsPeriodChip(title: InsightsPage.name(p.period, p), open: menuOpen, choosable: p.periods.count > 1) {
                        withAnimation(Flow.pick(Flow.fast, reduce: reduce)) { menuOpen.toggle() }
                    }
                    .anchorPreference(key: InsightsChipAnchor.self, value: .bounds) { $0 }
                }
                ScrollView(.vertical, showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 0) {
                        InsightsBand(picture: p).padding(.top, 16)
                        InsightsInOut(months: p.months, pinned: pinnedMonth.flatMap { p.months.indices.contains($0) ? p.months[$0].id : nil })
                            .padding(.top, 16)
                        InsightsCategories(picture: p)
                    }
                    .padding(.bottom, 8)
                }
            }
            .frame(minWidth: 560)
            Pane { InsightsSide(findings: p.findings) }
                .frame(width: 384)
        }
        .overlayPreferenceValue(InsightsChipAnchor.self) { anchor in
            GeometryReader { geo in
                if menuOpen, let anchor {
                    let r = geo[anchor]
                    ZStack(alignment: .topLeading) {
                        Color.clear.contentShape(Rectangle())
                            .onTapGesture { withAnimation(Flow.pick(Flow.fast, reduce: reduce)) { menuOpen = false } }
                        InsightsPeriodMenu(options: p.periods.map { ($0, InsightsPage.name($0, p), InsightsPage.span($0, p)) }, selected: p.period,
                                           choose: choose, close: { withAnimation(Flow.pick(Flow.fast, reduce: reduce)) { menuOpen = false } })
                            .frame(width: InsightsPeriodMenu.width)
                            .offset(x: r.maxX - InsightsPeriodMenu.width, y: r.maxY + 6)
                    }
                    .transition(.opacity)
                }
            }
        }
        .onReceive(DistributedNotificationCenter.default().publisher(for: .init("app.freelane.dev." + (ProcessInfo.processInfo.environment["FREELANE_DEV_CHANNEL"] ?? "main")))) { n in
            // Test builds only: "insights:all|year|last3", "insights:menu", "insights:month:<n>".
            guard DevMode.isSandboxed, let cmd = n.object as? String, cmd.hasPrefix("insights:") else { return }
            let arg = String(cmd.dropFirst(9))
            if let p = InsightsPeriod(rawValue: arg) { choose(p) }
            if arg == "menu" { menuOpen = true }
            if arg.hasPrefix("month:") { pinnedMonth = Int(arg.dropFirst(6)) }
        }
    }

    private func choose(_ p: InsightsPeriod) {
        withAnimation(Flow.pick(Flow.spatial, reduce: reduce)) { period = p; menuOpen = false }
        if !DevMode.isSandboxed { UserDefaults.standard.set(p.rawValue, forKey: InsightsPage.periodKey) }
    }

    /// The menu's name for a period: "Since June", "This year", "Last 3 months".
    static func name(_ period: InsightsPeriod, _ p: InsightsPicture) -> String {
        switch period {
        case .all: return "Since " + InsightsMath.monthName(p.recordsStart)
        case .year: return "This year"
        case .last3: return "Last 3 months"
        }
    }

    /// The months a period covers, for the menu: "Jun – Oct".
    static func span(_ period: InsightsPeriod, _ p: InsightsPicture) -> String {
        let from = InsightsMath.start(of: period, records: p.recordsStart)
        let a = InsightsFormat.month(from), b = InsightsFormat.month(.now)
        return a == b ? a : "\(a) – \(b)"
    }
}

/// Month names for charts: "Jun", in Manila time, the way `Day` writes dates.
enum InsightsFormat {
    private static let short: DateFormatter = {
        let d = DateFormatter(); d.locale = Locale(identifier: "en_GB"); d.timeZone = PHT.zone; d.dateFormat = "MMM"; return d
    }()
    static func month(_ d: Date) -> String { short.string(from: d) }

    /// Words and amounts as one Text, every amount set in the inline money role.
    static func text(_ pieces: [InsightsPiece], size: CGFloat, color: Color) -> Text {
        pieces.reduce(Text(verbatim: "")) { acc, piece in
            switch piece {
            case .text(let s): return Text("\(acc)\(Text(verbatim: s))")
            case .money(let v): return Text("\(acc)\(Money(value: v, role: .inline(size), decimals: false, color: color).text)")
            }
        }
    }
}

// MARK: - Period chip and its menu

private struct InsightsChipAnchor: PreferenceKey {
    static let defaultValue: Anchor<CGRect>? = nil
    static func reduce(value: inout Anchor<CGRect>?, nextValue: () -> Anchor<CGRect>?) { value = value ?? nextValue() }
}

private struct InsightsPeriodChip: View {
    let title: String
    let open: Bool
    var choosable = true
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Text(title)
                if choosable { Icon(Sym.expandMore, size: 20).rotationEffect(.degrees(open ? 180 : 0)) }
            }
            .font(TextRole.label.font)
            .foregroundStyle(open ? MD.onSecondaryContainer : MD.onSurface)
            .padding(.leading, 12).padding(.trailing, choosable ? 8 : 12).frame(height: 32)
            .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(open ? MD.secondaryContainer : Surface.well))
            .contentShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .buttonStyle(InsightsChipStyle())
        .disabled(!choosable)
        .animation(Flow.fast, value: open)
        .help("Choose the months this page shows")
        .accessibilityLabel("Period: \(title)")
    }
}

private struct InsightsChipStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.modifier(StateLayer(shape: AnyShape(RoundedRectangle(cornerRadius: 8, style: .continuous)), pressed: configuration.isPressed, scales: false))
    }
}

/// A small M3 menu under the chip. ↑/↓ move, Return chooses, Esc closes.
private struct InsightsPeriodMenu: View {
    static let width: CGFloat = 268
    let options: [(period: InsightsPeriod, name: String, span: String)]
    let selected: InsightsPeriod
    let choose: (InsightsPeriod) -> Void
    let close: () -> Void
    @State private var cursor: InsightsPeriod? = nil
    @State private var shown = false
    @FocusState private var focused: Bool
    @Environment(\.accessibilityReduceMotion) private var reduce

    var body: some View {
        VStack(spacing: 2) {
            ForEach(options, id: \.period) { o in
                let on = o.period == selected
                Button { choose(o.period) } label: {
                    HStack(spacing: 12) {
                        Icon(Sym.check, size: 20).opacity(on ? 1 : 0)
                        Text(o.name).role(.body, on ? MD.onSecondaryContainer : MD.onSurface).lineLimit(1).fixedSize()
                        Spacer(minLength: 8)
                        Text(o.span).role(.supporting, on ? MD.onSecondaryContainer : MD.onSurfaceVariant).lineLimit(1).fixedSize()
                    }
                    .foregroundStyle(on ? MD.onSecondaryContainer : MD.onSurface)
                    .padding(.horizontal, 12).frame(height: 44)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(on ? MD.secondaryContainer : .clear))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(MD.onSurface.opacity(cursor == o.period && !on ? 0.08 : 0)))
                    .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
                .buttonStyle(InsightsMenuItemStyle())
                .onHover { if $0 { cursor = o.period } }
            }
        }
        .padding(6)
        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Surface.dialog))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Surface.hairline.opacity(0.6), lineWidth: 1))
        .shadow(color: .black.opacity(0.10), radius: 2, y: 1)
        .shadow(color: .black.opacity(0.12), radius: 14, y: 6)
        .scaleEffect(shown || reduce ? 1 : 0.92, anchor: .topTrailing)
        .opacity(shown ? 1 : 0)
        .focusable()
        .focusEffectDisabled()
        .focused($focused)
        .onAppear {
            cursor = selected; focused = true
            withAnimation(Flow.pick(Flow.fast, reduce: reduce)) { shown = true }
        }
        .onKeyPress(.downArrow) { move(1); return .handled }
        .onKeyPress(.upArrow) { move(-1); return .handled }
        .onKeyPress(.return) { choose(cursor ?? selected); return .handled }
        .onKeyPress(.space) { choose(cursor ?? selected); return .handled }
        .onKeyPress(.escape) { close(); return .handled }
    }

    private func move(_ d: Int) {
        let all = options.map(\.period)
        guard !all.isEmpty else { return }
        let i = all.firstIndex(of: cursor ?? selected) ?? 0
        cursor = all[(i + d + all.count) % all.count]
    }
}

private struct InsightsMenuItemStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.modifier(StateLayer(shape: AnyShape(RoundedRectangle(cornerRadius: 12, style: .continuous)), pressed: configuration.isPressed, scales: false))
    }
}

// MARK: - Summary band

private struct InsightsBand: View {
    let picture: InsightsPicture
    var body: some View {
        // The parts are rounded first, so the sentence adds up to the figure above it.
        let logged = picture.logged.rounded(), found = picture.found.rounded()
        Band {
            VStack(alignment: .leading, spacing: 0) {
                Money(value: logged + found, role: .summary, decimals: false, color: MD.onPrimaryContainer)
                    .contentTransition(.numericText(value: logged + found))
                Text("went out " + InsightsMath.phrase(picture)).role(.summaryLabel, MD.onPrimaryContainer)
                    .contentTransition(.opacity)
                    .padding(.top, 4)
                sentence(logged: logged, found: found).role(.body, MD.onPrimaryContainer)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 2)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private func sentence(logged: Double, found: Double) -> Text {
        let ink = MD.onPrimaryContainer
        if logged + found < 0.5 { return Text("Nothing was logged, and counting found nothing missing.") }
        if found >= 0.5 {
            return InsightsFormat.text([.money(logged), .text(" of it was logged. Counting your wallets found the other "), .money(found), .text(".")], size: 14, color: ink)
        }
        if picture.counts > 0 { return Text("All of it was logged. Counting your wallets found nothing missing.") }
        return Text("All of it was logged. Your wallets weren’t counted \(InsightsMath.phrase(picture)), so nothing else could be found.")
    }
}

// MARK: - In and out, month by month

private struct InsightsInOut: View {
    let months: [InsightsMonth]
    var pinned: Date? = nil
    @State private var hover: Date? = nil
    @State private var grown = false
    @Environment(\.accessibilityReduceMotion) private var reduce

    private let plotHeight: CGFloat = 166

    var body: some View {
        let top = max(months.map { max($0.cameIn, $0.wentOut) }.max() ?? 0, 1)
        let focus = hover ?? pinned
        VStack(alignment: .leading, spacing: 0) {
            Text("In and out, month by month").role(.sub)
            GeometryReader { geo in
                let n = CGFloat(max(months.count, 1))
                let gap: CGFloat = months.count > 8 ? 10 : 20
                let group = (geo.size.width - gap * (n - 1)) / n
                let bar = min(40, max(8, (group - 6) / 2))
                HStack(alignment: .bottom, spacing: gap) {
                    ForEach(months) { m in
                        InsightsMonthBars(month: m, top: top, barWidth: bar, maxBar: plotHeight - 20, grown: grown || reduce,
                                          showValues: bar >= 26 || focus == m.id)
                            .frame(width: group, height: plotHeight, alignment: .bottom)
                            .opacity(focus == nil || focus == m.id ? 1 : 0.45)
                            .transition(.opacity.combined(with: .scale(scale: 0.9, anchor: .bottom)))
                            .accessibilityElement(children: .ignore)
                            .accessibilityLabel(InsightsInOut.spoken(m))
                    }
                }
                .contentShape(Rectangle())
                .onContinuousHover { phase in
                    // One handler for the whole plot, so moving between months never flickers through "none".
                    var next: Date? = nil
                    if case .active(let pt) = phase, !months.isEmpty {
                        let i = Int((pt.x + gap / 2) / (group + gap))
                        next = months[min(max(i, 0), months.count - 1)].id
                    }
                    if next != hover { withAnimation(Flow.effects) { hover = next } }
                }
            }
            .frame(height: plotHeight)
            .padding(.top, 10)
            HStack(spacing: months.count > 8 ? 10 : 20) {
                ForEach(months) { m in
                    Text(InsightsFormat.month(m.start) + (m.isCurrent ? " so far" : ""))
                        .role(.small, focus == m.id ? MD.onSurface : MD.onSurfaceVariant)
                        .lineLimit(1).minimumScaleFactor(0.8)
                        .frame(maxWidth: .infinity)
                }
            }
            .padding(.top, 6)
            ZStack(alignment: .leading) {
                if let f = focus, let m = months.first(where: { $0.id == f }) {
                    detail(m).transition(.opacity)
                } else {
                    legend.transition(.opacity)
                }
            }
            .frame(height: 20, alignment: .leading)
            .padding(.top, 12)
            .animation(Flow.effects, value: focus)
        }
        .padding(.horizontal, 20).padding(.top, 16).padding(.bottom, 14)
        .background(RoundedRectangle(cornerRadius: 24, style: .continuous).fill(Surface.well))
        .onAppear {
            guard !grown else { return }
            if reduce { grown = true } else { withAnimation(Flow.slow.delay(0.05)) { grown = true } }
        }
    }

    private var legend: some View {
        HStack(spacing: 18) {
            key(InsightsInOutColors.came, "Came in")
            key(InsightsInOutColors.logged, "Went out, logged")
            key(InsightsInOutColors.found, "Went out, found by counting")
        }
    }

    private func key(_ color: Color, _ title: String) -> some View {
        HStack(spacing: 6) {
            RoundedRectangle(cornerRadius: 3, style: .continuous).fill(color).frame(width: 10, height: 10)
            Text(title).role(.supporting, MD.onSurfaceVariant)
        }
    }

    /// The hovered month's exact figures, in place of the legend.
    private func detail(_ m: InsightsMonth) -> some View {
        let ink = MD.onSurfaceVariant
        return HStack(spacing: 14) {
            Text(Day.month(m.start) + (m.isCurrent ? " so far" : "")).role(.supporting, MD.onSurface)
            HStack(spacing: 6) {
                RoundedRectangle(cornerRadius: 3, style: .continuous).fill(InsightsInOutColors.came).frame(width: 10, height: 10)
                InsightsFormat.text([.text("Came in "), .money(m.cameIn)], size: 13, color: ink).role(.supporting, ink)
            }
            HStack(spacing: 6) {
                RoundedRectangle(cornerRadius: 3, style: .continuous).fill(InsightsInOutColors.logged).frame(width: 10, height: 10)
                InsightsFormat.text([.text("Logged "), .money(m.logged)], size: 13, color: ink).role(.supporting, ink)
            }
            if m.found >= 0.5 {
                HStack(spacing: 6) {
                    RoundedRectangle(cornerRadius: 3, style: .continuous).fill(InsightsInOutColors.found).frame(width: 10, height: 10)
                    InsightsFormat.text([.text("Found by counting "), .money(m.found)], size: 13, color: ink).role(.supporting, ink)
                }
            } else if m.appeared >= 0.5 {
                InsightsFormat.text([.text("Counting found "), .money(m.appeared), .text(" more than Freelane had")], size: 13, color: ink).role(.supporting, ink)
            }
        }
        .lineLimit(1)
    }

    static func spoken(_ m: InsightsMonth) -> String {
        let name = Day.month(m.start) + (m.isCurrent ? " so far" : "")
        var s = "\(name): came in \(MoneyFormat.string(m.cameIn, decimals: false)), went out \(MoneyFormat.string(m.wentOut, decimals: false))"
        s += ", \(MoneyFormat.string(m.logged, decimals: false)) logged"
        if m.found >= 0.5 { s += " and \(MoneyFormat.string(m.found, decimals: false)) found by counting" }
        return s
    }
}

/// One month: what came in beside what went out (logged, with what counting found stacked on top).
private struct InsightsMonthBars: View {
    let month: InsightsMonth
    let top: Double
    let barWidth: CGFloat
    let maxBar: CGFloat
    let grown: Bool
    let showValues: Bool

    var body: some View {
        HStack(alignment: .bottom, spacing: 6) {
            column(month.cameIn) {
                piece(month.cameIn, InsightsInOutColors.came, topRadius: 6, bottomRadius: 3)
            }
            column(month.wentOut) {
                VStack(spacing: 2) {
                    if month.found >= 0.5 { piece(month.found, InsightsInOutColors.found, topRadius: 6, bottomRadius: month.logged >= 0.5 ? 2 : 3) }
                    if month.logged >= 0.5 { piece(month.logged, InsightsInOutColors.logged, topRadius: month.found >= 0.5 ? 2 : 6, bottomRadius: 3) }
                }
            }
        }
    }

    private func column<Bar: View>(_ value: Double, @ViewBuilder bar: () -> Bar) -> some View {
        VStack(spacing: 4) {
            Text(InsightsMath.compact(value)).role(.small, MD.onSurfaceVariant)
                .fixedSize()
                .opacity(showValues ? 1 : 0)
            bar()
        }
        .frame(width: barWidth)
    }

    private func height(_ v: Double) -> CGFloat {
        guard grown, v >= 0.5 else { return 0 }
        return max(3, CGFloat(v / top) * maxBar)
    }

    private func piece(_ v: Double, _ color: Color, topRadius: CGFloat, bottomRadius: CGFloat) -> some View {
        UnevenRoundedRectangle(topLeadingRadius: topRadius, bottomLeadingRadius: bottomRadius, bottomTrailingRadius: bottomRadius,
                               topTrailingRadius: topRadius, style: .continuous)
            .fill(color)
            .frame(width: barWidth, height: height(v))
    }
}

private enum InsightsInOutColors {
    static let came = MD.tertiary
    static let logged = MD.primary
    static let found = MD.primary.opacity(0.35)
}

// MARK: - Where logged money went

private struct InsightsCategories: View {
    let picture: InsightsPicture
    var body: some View {
        let all = picture.categories
        let shown = all.count <= 8 ? all : Array(all.prefix(7))
        let rest = all.dropFirst(shown.count)
        let largest = max(all.first?.amount ?? 1, 1)
        VStack(alignment: .leading, spacing: 0) {
            SectionHeader(title: "Where logged money went") {
                if !picture.misfiled.isEmpty {
                    InsightsFormat.text(misfiledPieces, size: 13, color: MD.onSurfaceVariant)
                        .role(.supporting, MD.onSurfaceVariant)
                        .lineLimit(1)
                        .help(misfiledHelp)
                }
            }
            if all.isEmpty {
                Text("Nothing was logged \(InsightsMath.phrase(picture)).").role(.body, MD.onSurfaceVariant).padding(.horizontal, 4)
            }
            ForEach(Array(shown.enumerated()), id: \.element.id) { i, c in
                InsightsCategoryRow(category: c, fraction: c.amount / largest, strong: i < 3)
                    .transition(.opacity)
            }
            if !rest.isEmpty {
                let restTotal = rest.reduce(0) { $0 + $1.amount }
                InsightsFormat.text([.text("and \(rest.count) smaller categories, "), .money(restTotal), .text(" together")], size: 13, color: MD.onSurfaceVariant)
                    .role(.supporting, MD.onSurfaceVariant)
                    .padding(.horizontal, 4).padding(.top, 6)
            }
        }
    }

    /// Bill payments filed under another category stay where he filed them; the header says so, so the
    /// rows never quietly disagree with the Bills page. "₱700 paid to the Wifi bill is filed under Bills".
    private var misfiledPieces: [InsightsPiece] {
        let items = picture.misfiled
        if items.count == 1, let m = items.first {
            return [.money(m.amount), .text(" paid to the \(m.bill) bill is filed under \(m.category)")]
        }
        return [.text("\(items.reduce(0) { $0 + $1.count }) bill payments are filed under other categories")]
    }

    private var misfiledHelp: String {
        picture.misfiled.map { "\(MoneyFormat.string($0.amount)) paid to the \($0.bill) bill is filed under \($0.category)" }.joined(separator: "\n")
    }
}

private struct InsightsCategoryRow: View {
    let category: InsightsCategory
    let fraction: Double
    let strong: Bool
    var body: some View {
        HStack(spacing: 12) {
            Text(category.name.prefix(1).uppercased() + category.name.dropFirst()).role(.body).lineLimit(1)
                .frame(width: 140, alignment: .leading)
            GeometryReader { geo in
                Capsule()
                    .fill(MD.primary.opacity(strong ? 1 : 0.55))
                    .frame(width: max(14, geo.size.width * fraction), height: 14)
                    .frame(maxHeight: .infinity, alignment: .center)
            }
            .frame(height: 14)
            Money(value: category.amount, role: .row, decimals: false)
                .frame(width: 96, alignment: .trailing)
        }
        .padding(.horizontal, 4)
        .frame(height: 30)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(category.name): \(MoneyFormat.string(category.amount, decimals: false)), \(category.count) \(category.count == 1 ? "entry" : "entries")")
    }
}

// MARK: - What stands out

private struct InsightsSide: View {
    let findings: [InsightsFinding]
    var body: some View {
        PaneHeader(title: "What stands out", big: false)
        if findings.isEmpty {
            Text("Nothing stands out yet. As months fill in, what changes shows up here.")
                .role(.body, MD.onSurfaceVariant)
                .padding(.horizontal, 4).padding(.top, 12)
        } else {
            Segmented(items: findings) { InsightsFindingRow(finding: $0) }
                .padding(.top, 12)
        }
        Text("Each figure here comes straight from your ledger and counts. Nothing is estimated.")
            .role(.supporting, MD.onSurfaceVariant)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 4).padding(.top, 14)
    }
}

private struct InsightsFindingRow: View {
    let finding: InsightsFinding
    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            Icon(finding.glyph, size: 20)
                .foregroundStyle(MD.onSecondaryContainer)
                .frame(width: 40, height: 40)
                .background(Circle().fill(MD.secondaryContainer))
            VStack(alignment: .leading, spacing: 2) {
                InsightsFormat.text(finding.title, size: 14, color: MD.onSurface).role(.sub, MD.onSurface)
                InsightsFormat.text(finding.detail, size: 13, color: MD.onSurfaceVariant).role(.supporting, MD.onSurfaceVariant)
            }
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 16).padding(.vertical, 14)
        .accessibilityElement(children: .combine)
    }
}

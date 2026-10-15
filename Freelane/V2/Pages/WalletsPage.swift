import SwiftUI
import SwiftData

/// Wallets: where the money sits, and counting it.
struct WalletsPage: View {
    @Environment(AppState.self) private var app
    let state: MoneyState
    @Query private var ledger: [LedgerEntry]

    private var counted: [WalletLine] { state.wallets.filter(\.inTotals) }
    private var outside: [WalletLine] { state.wallets.filter { !$0.inTotals } }

    var body: some View {
        Pane {
            PaneHeader(title: "Wallets") {
                M3Button(title: "Add a wallet", kind: .text) { withAnimation(Flow.spatial) { app.form = .addWallet } }
                M3Button(title: "Count", icon: Sym.factCheck, kind: .filled) { withAnimation(Flow.spatial) { app.counting = true } }
                    .keyboardShortcut("k", modifiers: [.command, .shift])
            }
            PaneScroll {
                VStack(alignment: .leading, spacing: 0) {
                    summary.padding(.top, 16).appear(0)
                    grid.padding(.top, 16)
                    recentCounts.appear(6)
                    outsideTotals.appear(7)
                }
            }
        }
    }

    // MARK: Summary band

    private var summary: some View {
        let total = state.total
        let top = counted.first
        let share = (top?.balance ?? 0) / max(total, 1)
        let thisWeek = counted.filter { $0.lastCounted.map { Day.daysBetween($0, .now) < 7 } ?? false }.count
        return Band {
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 4) {
                        Money(value: total, role: .summary, color: MD.onPrimaryContainer)
                        Text(summaryLine(top: top, share: share)).role(.summaryLabel, MD.onPrimaryContainer)
                    }
                    Spacer()
                    StatusLabel(title: "\(thisWeek) of \(counted.count) counted this week", glyph: Sym.factCheck, tone: .note)
                }
                SplitBar(lines: counted, total: total).padding(.top, 16)
            }
        }
    }

    private func summaryLine(top: WalletLine?, share: Double) -> String {
        guard let top else { return "no wallets yet" }
        let n = counted.count
        if share >= 0.8 { return "in \(n) wallets, nearly all of it in \(top.name)" }
        if share >= 0.5 { return "in \(n) wallets, most of it in \(top.name)" }
        return "in \(n) wallets"
    }

    // MARK: Cards

    private var grid: some View {
        let lines = counted
        return Grid(horizontalSpacing: 12, verticalSpacing: 12) {
            if let first = lines.first {
                GridRow {
                    WalletCard(line: first, role: role(first), big: true, activity: activity(for: first)).gridCellColumns(2).appear(1)
                    if lines.count > 1 { WalletCard(line: lines[1], role: role(lines[1]), activity: activity(for: lines[1])).appear(2) } else { Color.clear }
                }
            }
            let rest = Array(lines.dropFirst(2))
            ForEach(0..<Int((Double(rest.count) / 3).rounded(.up)), id: \.self) { r in
                GridRow {
                    ForEach(0..<3, id: \.self) { c in
                        let i = r * 3 + c
                        if i < rest.count { WalletCard(line: rest[i], role: role(rest[i]), activity: activity(for: rest[i])).appear(3 + i) } else { Color.clear }
                    }
                }
            }
        }
    }

    /// What a wallet is for, when the records make it plain: the one holding most of the money, and the
    /// one clients' payments land in.
    private func role(_ line: WalletLine) -> String? {
        if line.id == counted.first?.id, line.balance / max(state.total, 1) >= 0.5 { return "your main wallet" }
        let since = Calendar.current.date(byAdding: .day, value: -120, to: .now) ?? .distantPast
        let landings = Dictionary(grouping: ledger.filter { $0.archivedAt == nil && $0.kind == .income && $0.relatedKindRaw == LedgerRelatedKind.payment.rawValue && $0.eventAt >= since },
                                  by: { $0.walletId })
        if let top = landings.max(by: { $0.value.count < $1.value.count }), top.key == line.id, top.value.count >= 2 { return "where client money lands" }
        return nil
    }

    /// The latest thing that happened in a wallet, said the way you'd say it.
    private func activity(for line: WalletLine) -> (glyph: String, text: String)? {
        // The latest real money event; a count stands in for it only when it came on a later day and found
        // a real amount (₱100 or more), so small top-ups don't hide what actually happened.
        let mine = state.feed.filter { $0.walletIds.contains(line.id) && $0.kind != .fee }
        let event = mine.first { $0.kind != .count }
        let countNet = { (d: Date) in
            ledger.filter { PHT.calendar.isDate($0.eventAt, inSameDayAs: d) && $0.walletId == line.id && $0.archivedAt == nil
                && $0.kind == .adjustment && $0.note == Unaccounted.marker }.reduce(0) { $0 + $1.amountBase }
        }
        let count = mine.first { $0.kind == .count }.flatMap { c in
            abs(countNet(c.date)) >= 100 && (event.map { !PHT.calendar.isDate(c.date, inSameDayAs: $0.date) && c.date > $0.date } ?? true) ? c : nil
        }
        guard let a = count ?? event ?? mine.first else { return nil }
        let when = Day.ago(a.date)
        let day = { (e: LedgerEntry) in PHT.calendar.isDate(e.eventAt, inSameDayAs: a.date) && e.walletId == line.id && e.archivedAt == nil }
        switch a.kind {
        case .count:
            let net = countNet(a.date)
            return (Sym.factCheck, "Counted \(MoneyFormat.string(abs(net))) \(net >= 0 ? "more" : "less") than Freelane had")
        case .move:
            if a.walletIds.first == line.id {
                let sent = -ledger.filter { day($0) && $0.relatedKindRaw == LedgerRelatedKind.withdrawal.rawValue && $0.amountBase < 0 }.reduce(0) { $0 + $1.amountBase }
                let to = a.walletIds.last.flatMap { id in state.wallets.first { $0.id == id }?.name } ?? "another wallet"
                return (Sym.swapHoriz, "Moved \(MoneyFormat.string(sent > 0 ? sent : abs(a.amount))) to \(to) \(when)")
            }
            let from = a.walletIds.first.flatMap { id in state.wallets.first { $0.id == id }?.name } ?? "another wallet"
            return (Sym.swapHoriz, "\(MoneyFormat.string(abs(a.amount))) from \(from) \(when)")
        case .payment:
            return (Sym.southWest, "\(a.title) paid \(MoneyFormat.string(abs(a.amount))) \(when)")
        case .gift:
            return (Sym.volunteerActivism, "Gave \(MoneyFormat.string(abs(a.amount))) \(when)")
        default:
            if case .bill(let label) = a.badge {
                let bill = label.lowercased()
                let glyph = IdentityKey.bill(label)?.billGlyph ?? Sym.receiptLong
                return Day.daysBetween(a.date, .now) < 7
                    ? (glyph, "Paid \(bill) \(when), \(MoneyFormat.string(abs(a.amount)))")
                    : (glyph, "Paid \(Day.month(a.date))’s \(bill)")
            }
            // "Bike connector" reads as "bike connector" mid-sentence; names ("Perfect Ratio Cafe", "Jollibee") keep their capitals.
            let words = a.title.split(separator: " ")
            let plain = words.count >= 2 && words[1].first?.isLowercase == true
            return (Sym.history, "Last spent \(when), " + (plain ? a.title.prefix(1).lowercased() + a.title.dropFirst() : a.title))
        }
    }

    // MARK: Outside your totals

    @ViewBuilder private var outsideTotals: some View {
        if !outside.isEmpty {
            SectionHeader(title: "Not in your totals") {
                Text("kept apart from what you can spend").role(.supporting, MD.onSurfaceVariant)
            }
            Segmented(items: outside) { w in
                ListRow(badge: Badge(subject: .wallet(w.wallet)), title: w.name,
                        subtitle: w.lastCounted.map { "counted \(Day.ago($0))" } ?? "never counted") {
                    Money(value: w.balance, color: MD.onSurfaceVariant)
                }
            }
        }
    }

    // MARK: Recent counts

    @ViewBuilder private var recentCounts: some View {
        let days = Unaccounted.netByDay(ledger.filter { e in counted.contains { $0.id == e.walletId } })
            .sorted { $0.key > $1.key }.prefix(3)
        if !days.isEmpty {
            SectionHeader(title: "Recent counts") {
                Text("money Freelane hadn’t heard about").role(.supporting, MD.onSurfaceVariant)
            }
            HStack(spacing: 3) {
                ForEach(Array(days.enumerated()), id: \.element.key) { i, d in
                    let names = walletNames(on: d.key)
                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 1) {
                            Text(Day.short(d.key)).role(.row).font(FS.font(14, 600))
                            Text(names).role(.supporting, MD.onSurfaceVariant).lineLimit(1)
                        }
                        Spacer(minLength: 8)
                        d.value >= 0 ? Money.incoming(d.value) : Money.outgoing(d.value)
                    }
                    .padding(.horizontal, 16).padding(.vertical, 12)
                    .frame(maxWidth: .infinity)
                    .background(UnevenRoundedRectangle(topLeadingRadius: i == 0 ? 20 : 6, bottomLeadingRadius: i == 0 ? 20 : 6,
                                                       bottomTrailingRadius: i == days.count - 1 ? 20 : 6, topTrailingRadius: i == days.count - 1 ? 20 : 6,
                                                       style: .continuous).fill(Surface.well))
                }
            }
        }
    }

    private func walletNames(on day: Date) -> String {
        let ids = Set(ledger.filter { $0.archivedAt == nil && $0.kind == .adjustment && $0.note == Unaccounted.marker && PHT.calendar.isDate($0.eventAt, inSameDayAs: day) }.compactMap(\.walletId))
        return counted.filter { ids.contains($0.id) }.map(\.name).joined(separator: ", ")
    }
}

/// Where the money sits, as one bar: wallets with a real share get a labelled segment, the rest a quiet tail.
private struct SplitBar: View {
    let lines: [WalletLine]
    let total: Double
    var body: some View {
        let big = lines.filter { $0.balance / max(total, 1) >= 0.03 }
        let rest = lines.filter { $0.balance / max(total, 1) < 0.03 }
        let restSum = rest.reduce(0) { $0 + max($1.balance, 0) }
        VStack(alignment: .trailing, spacing: 6) {
            GeometryReader { geo in
                HStack(spacing: 3) {
                    ForEach(Array(big.enumerated()), id: \.element.id) { i, w in
                        let width = max(geo.size.width * w.balance / max(total, 1) - 3, 64)
                        Text(i == 0 ? "\(w.name) · \(MoneyFormat.string(w.balance, decimals: false))" : MoneyFormat.string(w.balance, decimals: false))
                            .font(FS.font(14, 600, rond: 60)).foregroundStyle(.white).lineLimit(1)
                            .padding(.horizontal, 14)
                            .frame(width: width, height: 40, alignment: .leading)
                            .background(UnevenRoundedRectangle(topLeadingRadius: i == 0 ? 20 : 6, bottomLeadingRadius: i == 0 ? 20 : 6,
                                                               bottomTrailingRadius: rest.isEmpty && i == big.count - 1 ? 20 : 6,
                                                               topTrailingRadius: rest.isEmpty && i == big.count - 1 ? 20 : 6, style: .continuous)
                                .fill(w.key?.colors.mark ?? MD.primary))
                            .grow(i, axis: .horizontal)
                    }
                    if !rest.isEmpty {
                        UnevenRoundedRectangle(topLeadingRadius: 6, bottomLeadingRadius: 6, bottomTrailingRadius: 20, topTrailingRadius: 20, style: .continuous)
                            .fill(MD.onPrimaryContainer.opacity(0.3)).frame(width: 8, height: 40)
                    }
                }
            }
            .frame(height: 40)
            if !rest.isEmpty {
                Text("\(listNames(rest.map(\.name))) hold \(MoneyFormat.string(restSum)) between them")
                    .role(.supporting, MD.onPrimaryContainer.opacity(0.85))
            }
        }
    }
    private func listNames(_ n: [String]) -> String {
        n.count <= 1 ? (n.first ?? "") : n.dropLast().joined(separator: ", ") + " and " + n.last!
    }
}

/// One wallet. The biggest wallet gets a double-width card with this month's in and out.
private struct WalletCard: View {
    @Environment(AppState.self) private var app
    let line: WalletLine
    var role: String? = nil
    var big = false
    let activity: (glyph: String, text: String)?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 12) {
                Badge(subject: .wallet(line.wallet), size: 48)
                VStack(alignment: .leading, spacing: 1) {
                    Text(line.name).role(.row)
                    Text(kindLine).role(.supporting, MD.onSurfaceVariant).lineLimit(1)
                }
            }
            Money(value: line.balance, role: .card).padding(.top, 2)
            status
            if big {
                HStack(spacing: 32) {
                    flow("In this month", monthIn)
                    flow("Out this month", monthOut)
                }
                .padding(.top, 4)
            }
            Spacer(minLength: 0)
            footer
        }
        .padding(.horizontal, 20).padding(.vertical, 16)
        .frame(maxWidth: .infinity, minHeight: 172, alignment: .topLeading)
        .background(RoundedRectangle(cornerRadius: 24, style: .continuous).fill(Surface.well))
        .opacity(line.inTotals ? 1 : 0.75)
        .contentShape(RoundedRectangle(cornerRadius: 24))
        .contextMenu {
            Button("Count \(line.name)") { withAnimation(Flow.spatial) { app.counting = true } }
        }
    }

    @Query private var ledger: [LedgerEntry]
    private var monthLegs: [LedgerEntry] {
        let start = PHT.startOfMonth()
        return ledger.filter { $0.walletId == line.id && $0.archivedAt == nil && $0.eventAt >= start && $0.kind != .adjustment }
    }
    private var monthIn: Double { monthLegs.filter { $0.amountBase > 0 }.reduce(0) { $0 + $1.amountBase } }
    private var monthOut: Double { -monthLegs.filter { $0.amountBase < 0 }.reduce(0) { $0 + $1.amountBase } }
    private func flow(_ label: String, _ v: Double) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).role(.supporting, MD.onSurfaceVariant)
            Money(value: v)
        }
    }

    private var kindLine: String {
        if role == "where client money lands" { return role! }
        let kind: String
        switch line.wallet.kind {
        case .cash: kind = "in hand"
        case .bank: kind = "bank"
        case .exchange: kind = "exchange"
        default: kind = "e-wallet"
        }
        return role.map { "\(kind) · \($0)" } ?? kind
    }

    @ViewBuilder private var status: some View {
        if !line.inTotals {
            StatusLabel(title: "Not in your totals", glyph: Sym.visibilityOff, tone: .quiet)
        } else if let d = line.lastCounted {
            let days = Day.daysBetween(d, .now)
            if days < 7 { StatusLabel(title: "Counted \(Day.ago(d))", glyph: Sym.check, tone: .ok) }
            else { StatusLabel(title: "Counted \(Day.dayMonth(d))", glyph: Sym.schedule, tone: .quiet) }
        } else {
            StatusLabel(title: "Never counted", glyph: Sym.pending, tone: .note)
        }
    }

    @ViewBuilder private var footer: some View {
        if let a = activity {
            HStack(spacing: 6) {
                Icon(a.glyph, size: 20).foregroundStyle(MD.onSurfaceVariant)
                Text(a.text).role(.supporting, MD.onSurfaceVariant).lineLimit(1)
            }
        }
    }
}

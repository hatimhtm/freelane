import SwiftUI
import SwiftData

struct TodayView: View {
    @Query private var settings: [AppSettings]
    @Query private var rateRows: [ExchangeRate]
    @Query(filter: #Predicate<Payment> { $0.deletedAt == nil }, sort: \Payment.paidAt, order: .reverse) private var payments: [Payment]
    @Query(filter: #Predicate<Spend> { $0.deletedAt == nil }, sort: \Spend.spentAt, order: .reverse) private var spends: [Spend]
    @Query(filter: #Predicate<Wallet> { $0.deletedAt == nil }) private var wallets: [Wallet]
    @Query private var ledger: [LedgerEntry]
    @Query(filter: #Predicate<Project> { $0.deletedAt == nil }) private var projects: [Project]
    @Query private var allocations: [PaymentAllocation]
    @Query(filter: #Predicate<Recurring> { $0.deletedAt == nil }) private var recurrings: [Recurring]

    @State private var showPay = false
    @State private var showSpend = false
    @State private var reminders: [ReminderItem] = []

    /// Consecutive days (ending today, or yesterday if today's not logged yet) with at least one
    /// spend logged — the gravity that makes you open it daily.
    private var logStreak: Int {
        let days = Set(spends.map { PHT.dayKey($0.spentAt) })
        var n = 0, d = PHT.startOfDay()
        if !days.contains(PHT.dayKey(d)) { d = PHT.calendar.date(byAdding: .day, value: -1, to: d) ?? d }
        while days.contains(PHT.dayKey(d)), n < 500 { n += 1; d = PHT.calendar.date(byAdding: .day, value: -1, to: d) ?? d }
        return n
    }

    private var safe: SafeBreakdown {
        SafeToSpend.compute(payments: payments, spends: spends, wallets: wallets, ledger: ledger, recurrings: recurrings)
    }

    private var base: String { settings.first?.baseCurrency ?? "PHP" }
    private var rates: Rates { Rates(base: base, rates: rateRows) }

    private var overdrawn: Bool {
        wallets.filter { $0.isHolding && !$0.archived && !$0.excludedFromTotals }.contains { WalletMath.balance(of: $0, ledger: ledger) < -$0.overdraftToleranceBase }
    }
    private var runwayDays: Double? {
        // Everyday pace (one-off / investment buys excluded) — a big purchase shouldn't
        // make your runway look tiny.
        let burn = SafeToSpend.typicalDailySpend(spends)
        return burn > 0 ? safe.walletTotal / burn : nil
    }

    // MARK: Today-only detail
    private var todaySpends: [Spend] { spends.filter { $0.spentAt >= PHT.startOfDay() } }
    private var todayPayments: [Payment] { payments.filter { $0.paidAt >= PHT.startOfDay() } }
    private var landedToday: Double { todayPayments.reduce(0) { $0 + ($1.netAmountBase ?? 0) } }
    private func projectTitle(_ p: Payment) -> String { projects.first { $0.id == p.projectId }?.title ?? "Payment" }

    private var todayDetail: some View {
        HStack(alignment: .top, spacing: 16) {
            SectionCard(title: "Spent today", subtitle: todaySpends.isEmpty ? nil : "\(todaySpends.count) item\(todaySpends.count == 1 ? "" : "s")", accent: Palette.warning) {
                if todaySpends.isEmpty {
                    Text("Nothing spent today.").font(.system(size: 12)).foregroundStyle(Palette.textTertiary)
                } else {
                    VStack(spacing: 8) {
                        ForEach(todaySpends.prefix(6)) { s in
                            HStack(spacing: 8) {
                                Text(s.vendorName ?? s.spendDescription ?? "Spend").font(.system(size: 12.5)).foregroundStyle(Palette.textPrimary).lineLimit(1)
                                if s.isSadaka { Text("sadaka").font(.system(size: 9, weight: .semibold)).foregroundStyle(Palette.teal) }
                                Spacer()
                                Text("−" + CurrencyFormat.string(s.amountBase, base, compact: true))
                                    .font(.system(size: 12.5, weight: .semibold, design: .rounded)).monospacedDigit()
                                    .foregroundStyle(Palette.textPrimary).lineLimit(1)
                            }
                        }
                    }
                }
            }.frame(maxWidth: .infinity)

            SectionCard(title: "Money in today", subtitle: landedToday > 0 ? CurrencyFormat.string(landedToday, base, compact: true) : nil, accent: Palette.positive) {
                if todayPayments.isEmpty {
                    Text("No payments today.").font(.system(size: 12)).foregroundStyle(Palette.textTertiary)
                } else {
                    VStack(spacing: 8) {
                        ForEach(todayPayments.prefix(6)) { p in
                            HStack(spacing: 8) {
                                Text(projectTitle(p)).font(.system(size: 12.5)).foregroundStyle(Palette.textPrimary).lineLimit(1)
                                Spacer()
                                Text("+" + CurrencyFormat.string(p.netAmountBase ?? 0, base, compact: true))
                                    .font(.system(size: 12.5, weight: .semibold, design: .rounded)).monospacedDigit()
                                    .foregroundStyle(Palette.positive).lineLimit(1)
                            }
                        }
                    }
                }
            }.frame(maxWidth: .infinity)
        }
    }

    private var safeHero: some View {
        let s = safe
        return VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                GlyphChip(systemImage: "shield.lefthalf.filled", color: Palette.positive, size: 28)
                Text("Safe to spend today").tileLabel()
                Spacer()
                if s.confidence != "steady" { MetricChip(text: s.confidence, systemImage: "sparkles", color: Palette.warning) }
            }
            MoneyText(amount: s.liveRemaining, code: base, size: 44, color: Palette.positive)
            Text("started today at \(CurrencyFormat.string(s.initialForToday, base, compact: true)) · \(CurrencyFormat.string(s.walletTotal, base, compact: true)) across wallets")
                .font(.system(size: 12)).foregroundStyle(Palette.textTertiary)
            if !s.note.isEmpty {
                Text(s.note).font(.system(size: 11)).foregroundStyle(Palette.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Sparkline(values: sparkline, color: Palette.positive).frame(height: 50)
        }
        .padding(18).frame(maxWidth: .infinity, alignment: .leading)
        .glassCard(cornerRadius: 22, tint: Palette.positive, elevated: true)
    }

    private var greeting: String {
        switch PHT.calendar.component(.hour, from: .now) {
        case 5..<12: return "Good morning"
        case 12..<17: return "Good afternoon"
        default: return "Good evening"
        }
    }

    var body: some View {
        Page(greeting, subtitle: Date.now.formatted(.dateTime.weekday(.wide).month().day()),
             toolbar: AnyView(actions)) {
            HStack(alignment: .top, spacing: 16) {     // money first
                safeHero.frame(maxWidth: .infinity)
                VStack(spacing: 16) {
                    StatTile(label: "Spent today", value: safe.spentToday, code: base, systemImage: "cart",
                             accent: Palette.warning,
                             chip: logStreak >= 2 ? ("\(logStreak)-day logging streak", "flame.fill") : nil,
                             chipColor: Palette.warning)
                    StatTile(label: "Landed today", value: landedToday, code: base, systemImage: "arrow.down.left",
                             accent: Palette.positive, chip: nil)
                }
                .frame(width: 230)
            }
            if !reminders.isEmpty { remindersCard }
            todayDetail
            HStack(alignment: .top, spacing: 16) {
                dueCard.frame(maxWidth: .infinity)
                activityCard.frame(maxWidth: .infinity)
            }
            verseCard
            CalmWeatherBanner(safe: safe, base: base, overdrawn: overdrawn, runwayDays: runwayDays)
        }
        .sheet(isPresented: $showPay) { BulkPaymentSheet() }
        .sheet(isPresented: $showSpend) { AddSpendSheet() }
        .task {
            if Integrations.remindersOn { reminders = await EventBridge.incompleteReminders() }
        }
    }

    /// A quiet daily ayah to close the day's view (mirrors the Faith page's verse of the day).
    private var verseCard: some View {
        let v = DailyVerse.today()
        return SectionCard(title: "Verse of the day", subtitle: v.source, accent: Palette.indigo) {
            VStack(alignment: .leading, spacing: 6) {
                Text(v.arabic).font(.system(size: 18, weight: .medium)).foregroundStyle(Palette.textPrimary)
                    .frame(maxWidth: .infinity, alignment: .trailing).environment(\.layoutDirection, .rightToLeft)
                Text(v.translation).font(.system(size: 13)).foregroundStyle(Palette.textSecondary)
            }
        }
    }

    // MARK: Apple Reminders (when the integration is on)
    private var remindersCard: some View {
        SectionCard(title: "Reminders", subtitle: "\(reminders.count)", accent: Palette.indigo) {
            VStack(spacing: 0) {
                ForEach(reminders.prefix(6)) { r in
                    HStack(spacing: 10) {
                        Button {
                            EventBridge.completeReminder(r.id)
                            reminders.removeAll { $0.id == r.id }
                        } label: { Image(systemName: "circle").font(.system(size: 16)).foregroundStyle(Palette.textTertiary) }
                            .buttonStyle(.iconPress)
                            .help("Mark complete in Apple Reminders")
                            .accessibilityLabel("Mark reminder complete")
                        Text(r.title).font(.system(size: 13)).foregroundStyle(Palette.textPrimary).lineLimit(1)
                        Spacer()
                        if let d = r.due {
                            Text(d, format: .dateTime.month().day())
                                .font(.system(size: 11)).foregroundStyle(d < PHT.startOfDay() ? Palette.negative : Palette.textTertiary)
                        }
                    }.padding(.vertical, 7)
                    if r.id != reminders.prefix(6).last?.id { Divider().overlay(Palette.hairline) }
                }
            }
        }
    }

    private var actions: some View {
        HStack(spacing: 10) {
            Button { showSpend = true } label: { Label("Log spend", systemImage: "cart") }.buttonStyle(.glass)
            Button { showPay = true } label: { Label("Log payment", systemImage: "plus") }
                .buttonStyle(.glassProminent).tint(Palette.positive)
        }
    }

    private var sparkline: [Double] {
        let start = PHT.daysAgo(30)
        let cal = PHT.calendar
        var running = ledger.filter { $0.archivedAt == nil && $0.eventAt < start }.reduce(0) { $0 + $1.amountBase }
        var byDay: [Date: Double] = [:]
        for e in ledger where e.archivedAt == nil && e.eventAt >= start {
            byDay[cal.startOfDay(for: e.eventAt), default: 0] += e.amountBase
        }
        var out: [Double] = []
        var d = cal.startOfDay(for: start)
        let today = cal.startOfDay(for: .now)
        while d <= today { running += byDay[d] ?? 0; out.append(running); d = cal.date(byAdding: .day, value: 1, to: d)! }
        return out.isEmpty ? [0, 0] : out
    }

    private var dueCard: some View {
        // Allocations of trashed payments must never count as paid here.
        let liveAllocs = ProjectMath.liveAllocations(allocations, payments: payments)
        let open = projects.filter { $0.status == .unpaid || $0.status == .partiallyPaid }
            .sorted { rates.toBase(ProjectMath.outstandingNative(project: $0, allocations: liveAllocs, rates: rates), $0.currency)
                    > rates.toBase(ProjectMath.outstandingNative(project: $1, allocations: liveAllocs, rates: rates), $1.currency) }
        return SectionCard(title: "Awaiting payment", subtitle: "\(open.count) open", accent: Palette.azure) {
            if open.isEmpty { hint("All caught up. ✨") }
            else {
                VStack(spacing: 10) {
                    ForEach(Array(open.prefix(5))) { p in
                        HStack {
                            Text(p.title).font(.system(size: 12.5, weight: .medium)).foregroundStyle(Palette.textPrimary).lineLimit(1)
                            Spacer()
                            Text(CurrencyFormat.string(ProjectMath.outstandingNative(project: p, allocations: liveAllocs, rates: rates), p.currency, compact: true))
                                .font(.system(size: 12.5, weight: .semibold, design: .rounded)).monospacedDigit()
                                .foregroundStyle(Palette.warning).lineLimit(1)
                        }
                    }
                }
            }
        }
    }

    private enum Item: Identifiable {
        case pay(Payment), spend(Spend)
        var id: String { switch self { case .pay(let p): return "p\(p.id)"; case .spend(let s): return "s\(s.id)" } }
        var date: Date { switch self { case .pay(let p): return p.paidAt; case .spend(let s): return s.spentAt } }
    }

    private var activityCard: some View {
        let items = (payments.prefix(8).map(Item.pay) + spends.prefix(8).map(Item.spend))
            .sorted { $0.date > $1.date }.prefix(7)
        return SectionCard(title: "Recent activity", accent: Palette.positive) {
            if items.isEmpty { hint("Nothing yet.") }
            else {
                VStack(spacing: 0) {
                    ForEach(Array(items)) { item in
                        switch item {
                        case .pay(let p):
                            line(icon: "arrow.down", color: Palette.positive,
                                 title: projects.first { $0.id == p.projectId }?.title ?? "Payment",
                                 date: p.paidAt, amount: "+" + CurrencyFormat.string(p.netAmountBase ?? 0, base), amountColor: Palette.positive)
                        case .spend(let s):
                            line(icon: "arrow.up.right", color: Palette.warning,
                                 title: s.spendDescription ?? s.vendorName ?? "Spend",
                                 date: s.spentAt, amount: "−" + CurrencyFormat.string(s.amountBase, base), amountColor: Palette.textPrimary)
                        }
                    }
                }
            }
        }
    }

    private func line(icon: String, color: Color, title: String, date: Date, amount: String, amountColor: Color) -> some View {
        HStack(spacing: 11) {
            Circle().fill(color.opacity(0.18)).frame(width: 30, height: 30)
                .overlay(Image(systemName: icon).font(.system(size: 11, weight: .bold)).foregroundStyle(color))
            VStack(alignment: .leading, spacing: 1) {
                Text(title).font(.system(size: 12.5, weight: .medium)).foregroundStyle(Palette.textPrimary).lineLimit(1)
                Text(date, format: .dateTime.month().day()).font(.system(size: 10)).foregroundStyle(Palette.textTertiary)
            }
            Spacer()
            Text(amount).font(.system(size: 12.5, weight: .semibold, design: .rounded)).monospacedDigit()
                .foregroundStyle(amountColor).lineLimit(1)
        }
        .padding(.vertical, 7)
    }

    private func hint(_ t: String) -> some View {
        Text(t).font(.system(size: 12)).foregroundStyle(Palette.textTertiary).frame(maxWidth: .infinity, minHeight: 50)
    }
}

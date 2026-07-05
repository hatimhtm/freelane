import SwiftUI
import SwiftData

/// Legacy standalone route (the sidebar now reaches this through Insights ▸ Activity).
/// Kept so any stale selection or deep link still lands somewhere sensible.
struct ActivityView: View {
    var body: some View {
        Page("Activity", subtitle: "The money audit trail.") { ActivityFeed() }
    }
}

/// The money audit trail — every payment, spend and transfer, grouped by day
/// ("Today", "Yesterday", then weekday + date). Each day is a SectionCard whose
/// subtitle carries the day's totals, so even a collapsed day tells you something.
/// Rows: kind icon chip · what happened · detail (vendor / category / from → to) ·
/// amount + time right-aligned. Embeddable (lives inside Insights as a subtab).
struct ActivityFeed: View {
    @Query private var settings: [AppSettings]
    @Query(filter: #Predicate<Payment> { $0.deletedAt == nil }, sort: \Payment.paidAt, order: .reverse) private var payments: [Payment]
    @Query(filter: #Predicate<Spend> { $0.deletedAt == nil }, sort: \Spend.spentAt, order: .reverse) private var spends: [Spend]
    @Query(filter: #Predicate<Withdrawal> { $0.deletedAt == nil }, sort: \Withdrawal.withdrawnAt, order: .reverse) private var withdrawals: [Withdrawal]
    @Query(filter: #Predicate<Project> { $0.deletedAt == nil }) private var projects: [Project]
    @Query(filter: #Predicate<Wallet> { $0.deletedAt == nil }) private var wallets: [Wallet]

    private var base: String { settings.first?.baseCurrency ?? "PHP" }

    private enum Event: Identifiable {
        case pay(Payment), spend(Spend), withdrawal(Withdrawal)
        var id: String {
            switch self { case .pay(let p): return "p\(p.id)"; case .spend(let s): return "s\(s.id)"; case .withdrawal(let w): return "w\(w.id)" }
        }
        var date: Date {
            switch self { case .pay(let p): return p.paidAt; case .spend(let s): return s.spentAt; case .withdrawal(let w): return w.withdrawnAt }
        }
    }

    @State private var filter = 0
    @State private var expanded: Set<Date> = []
    @State private var query = ""
    @State private var showTrash = false

    private var allEvents: [Event] {
        (payments.map(Event.pay) + spends.map(Event.spend) + withdrawals.map(Event.withdrawal)).sorted { $0.date > $1.date }
    }
    /// Searchable text for an event — vendor, description, project, category, amount.
    private func searchText(_ e: Event) -> String {
        switch e {
        case .pay(let p): return [(projects.first { $0.id == p.projectId }?.title), p.reference, String(format: "%.0f", p.netAmountBase ?? 0)].compactMap { $0 }.joined(separator: " ")
        case .spend(let s): return [s.vendorName, s.spendDescription, s.category, String(format: "%.0f", s.amountBase)].compactMap { $0 }.joined(separator: " ")
        case .withdrawal(let w): return [walletName(w.fromMethodId), walletName(w.toMethodId), String(format: "%.0f", w.grossBase)].compactMap { $0 }.joined(separator: " ")
        }
    }
    private var events: [Event] {
        let typed: [Event]
        switch filter {
        case 1: typed = allEvents.filter { if case .pay = $0 { return true }; return false }
        case 2: typed = allEvents.filter { if case .pay = $0 { return false }; return true }
        default: typed = allEvents
        }
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return typed }
        return typed.filter { searchText($0).lowercased().contains(q) }
    }
    private var grouped: [(day: Date, items: [Event])] {
        let cal = PHT.calendar
        let dict = Dictionary(grouping: events) { cal.startOfDay(for: $0.date) }
        return dict.keys.sorted(by: >).map { (day: $0, items: dict[$0]!) }
    }
    private var searching: Bool { !query.trimmingCharacters(in: .whitespaces).isEmpty }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 10) {
                GlassSegment(options: [0, 1, 2], selection: $filter) { ["All", "Money in", "Money out"][$0] }
                SearchField(text: $query, placeholder: "Search vendor, project, amount…")
                if !query.isEmpty { Text("\(events.count) match\(events.count == 1 ? "" : "es")").font(.system(size: 11)).foregroundStyle(Palette.textTertiary) }
                Spacer(minLength: 0)
                Button { showTrash = true } label: { Label("Trash", systemImage: "trash") }.buttonStyle(.glass)
            }
            if events.isEmpty {
                if query.isEmpty {
                    EmptyStateCard(icon: "clock.arrow.circlepath", title: "Nothing logged yet",
                                   message: "Payments, spends and transfers you log appear here, newest first.")
                } else {
                    Text("No matches for “\(query)”.").font(.system(size: 13)).foregroundStyle(Palette.textTertiary).frame(maxWidth: .infinity, minHeight: 100)
                }
            }
            ForEach(Array(grouped.prefix(40)), id: \.day) { group in
                dayCard(group)
            }
        }
        // Most recent few days arrive open; older days are a click away (their subtitle
        // already carries the day's totals, so collapsed ≠ blank).
        .onAppear { if expanded.isEmpty { expanded = Set(grouped.prefix(3).map(\.day)) } }
        .sheet(isPresented: $showTrash) { TrashView() }
    }

    // MARK: Day cards

    private func dayCard(_ group: (day: Date, items: [Event])) -> some View {
        let isOpen = searching || expanded.contains(group.day)
        let isToday = PHT.calendar.isDate(group.day, inSameDayAs: PHT.startOfDay())
        return SectionCard(title: dayLabel(group.day),
                           subtitle: daySubtitle(group.items),
                           accent: isToday ? Palette.azure : Palette.textSecondary,
                           trailing: searching ? nil : AnyView(
                            Button { toggle(group.day) } label: {
                                Image(systemName: isOpen ? "chevron.up" : "chevron.down")
                                    .font(.system(size: 11, weight: .semibold)).foregroundStyle(Palette.textTertiary)
                                    .frame(width: 22, height: 22).contentShape(Rectangle())
                            }.buttonStyle(.iconPress))) {
            if isOpen {
                VStack(spacing: 5) {
                    ForEach(group.items) { row($0) }
                }
            }
        }
    }

    /// "Today" / "Yesterday" / "Tuesday, Jun 9".
    private func dayLabel(_ day: Date) -> String {
        let cal = PHT.calendar, today = PHT.startOfDay()
        if cal.isDate(day, inSameDayAs: today) { return "Today" }
        if let y = cal.date(byAdding: .day, value: -1, to: today), cal.isDate(day, inSameDayAs: y) { return "Yesterday" }
        return day.formatted(.dateTime.weekday(.wide).month(.abbreviated).day())
    }

    /// "3 events · +₱12,000 · −₱840" — the day at a glance, even collapsed.
    private func daySubtitle(_ items: [Event]) -> String {
        var inn = 0.0, out = 0.0
        for e in items {
            switch e {
            case .pay(let p): inn += p.netAmountBase ?? 0
            case .spend(let s): out += s.amountBase
            case .withdrawal(let w): out += w.grossBase
            }
        }
        var parts = ["\(items.count) event\(items.count == 1 ? "" : "s")"]
        if inn > 0 { parts.append("+" + CurrencyFormat.string(inn, base, compact: true)) }
        if out > 0 { parts.append("−" + CurrencyFormat.string(out, base, compact: true)) }
        return parts.joined(separator: " · ")
    }

    private func toggle(_ day: Date) {
        if expanded.contains(day) { expanded.remove(day) } else { expanded.insert(day) }
    }

    private func walletName(_ id: UUID?) -> String? { id.flatMap { i in wallets.first { $0.id == i }?.name } }

    // MARK: Rows

    private struct RowSpec {
        let icon: String; let tint: Color
        let title: String; let detail: String?
        let amount: String; let amountColor: Color
    }

    private func spec(_ e: Event) -> RowSpec {
        switch e {
        case .pay(let p):
            let project = projects.first { $0.id == p.projectId }?.title
            let ref = (p.reference?.isEmpty == false) ? p.reference : nil
            return RowSpec(icon: "arrow.down.left", tint: Palette.positive,
                           title: project ?? "Payment received",
                           detail: project != nil ? ["Payment", ref].compactMap { $0 }.joined(separator: " · ") : ref,
                           amount: "+" + CurrencyFormat.string(p.netAmountBase ?? 0, base, compact: true),
                           amountColor: Palette.positive)
        case .spend(let s):
            let title = s.spendDescription ?? s.vendorName ?? "Spend"
            var bits: [String] = [s.isSadaka ? "Sadaka" : "Spend"]
            if let v = s.vendorName, s.spendDescription != nil { bits.append(v) }   // vendor demoted when a description leads
            if let c = s.category, !c.isEmpty { bits.append(c) }
            return RowSpec(icon: s.isSadaka ? "heart.fill" : "cart", tint: s.isSadaka ? Palette.negative : Palette.warning,
                           title: title, detail: bits.joined(separator: " · "),
                           amount: "−" + CurrencyFormat.string(s.amountBase, base, compact: true),
                           amountColor: Palette.textPrimary)
        case .withdrawal(let w):
            let from = walletName(w.fromMethodId), to = walletName(w.toMethodId)
            let detail: String?
            if let from, let to { detail = "\(from) → \(to)" }
            else if let from { detail = "From \(from)" }
            else { detail = to.map { "To \($0)" } }
            return RowSpec(icon: "arrow.left.arrow.right", tint: Palette.teal,
                           title: to != nil ? "Transfer" : "Withdrawal", detail: detail,
                           amount: "−" + CurrencyFormat.string(w.grossBase, base, compact: true),
                           amountColor: Palette.textPrimary)
        }
    }

    private func row(_ e: Event) -> some View {
        let s = spec(e)
        return HStack(spacing: 11) {
            Image(systemName: s.icon).font(.system(size: 12, weight: .semibold)).foregroundStyle(s.tint)
                .frame(width: 28, height: 28)
                .background(s.tint.opacity(0.15), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
            VStack(alignment: .leading, spacing: 1) {
                Text(s.title).font(.system(size: 12, weight: .medium)).foregroundStyle(Palette.textPrimary).lineLimit(1)
                if let d = s.detail, !d.isEmpty {
                    Text(d).font(.system(size: 10)).foregroundStyle(Palette.textTertiary).lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 1) {
                Text(s.amount).font(.system(size: 12, weight: .semibold, design: .rounded)).monospacedDigit()
                    .foregroundStyle(s.amountColor)
                Text(e.date.formatted(.dateTime.hour().minute()))
                    .font(.system(size: 10)).foregroundStyle(Palette.textTertiary)
            }
        }
        .padding(.horizontal, 10).padding(.vertical, 7)
        .insetRow()
    }
}

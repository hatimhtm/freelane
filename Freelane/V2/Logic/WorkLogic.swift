import SwiftUI

// Everything the Work page shows, computed once per render from payments, projects, clients and withdrawals.
// The page reads one calendar year, from its first payment, so the band, the month bars, the client list and
// the fees all add up to the same thing.

enum WorkText {
    /// "euros", "yuan", "dollars"
    static func currencyWord(_ code: String) -> String {
        switch code {
        case "PHP": return "pesos"
        case "EUR": return "euros"
        case "USD": return "dollars"
        case "CNY": return "yuan"
        case "MAD", "AED": return "dirhams"
        case "GBP": return "pounds"
        case "JPY": return "yen"
        case "SGD": return "Singapore dollars"
        case "AUD": return "Australian dollars"
        default: return code
        }
    }

    /// The client's own figure: "¥200", "€50", "$5.50".
    static func native(_ v: Double, _ code: String) -> String {
        let p = MoneyFormat.parts(v)
        return CurrencyFormat.symbol(code) + p.whole + (p.cents == "00" ? "" : "." + p.cents)
    }

    /// Chart values: "34k", "182k", "3.5k", "800".
    static func short(_ v: Double) -> String {
        let a = abs(v)
        if a >= 999_500 { return String(format: "%.1fM", a / 1_000_000).replacingOccurrences(of: ".0M", with: "M") }
        if a >= 9_950 { return "\(Int((a / 1000).rounded()))k" }
        if a >= 1_000 { return String(format: "%.1fk", a / 1000).replacingOccurrences(of: ".0k", with: "k") }
        return "\(Int(a.rounded()))"
    }

    static func count(_ n: Int, _ one: String, _ many: String) -> String { "\(n) \(n == 1 ? one : many)" }

    static func list(_ items: [String]) -> String { BillsText.list(items) }

    /// What a client is called on screen: the company if there is one, else the person.
    static func title(_ c: Client) -> String {
        if let co = c.company?.trimmingCharacters(in: .whitespacesAndNewlines), !co.isEmpty { return co }
        return c.name
    }
}

struct WorkMonth: Identifiable {
    let month: Date
    let total: Double
    var isPeak = false
    var isCurrent = false
    var id: Date { month }
}

struct WorkOwed: Identifiable {
    let project: Project
    let client: String
    let base: Double
    let estimate: Bool
    /// "¥200, delivered 14 Sep, 32 days ago"
    let detail: String
    var id: UUID { project.id }
}

struct WorkClient: Identifiable {
    let id: UUID
    let title: String
    let subtitle: String
    let total: Double
}

struct WorkLatest: Identifiable {
    let id: UUID
    let title: String
    let subtitle: String
    let net: Double
    /// "into Wise", or "₱157.22 fee" when the client's payment lost something on the way.
    let note: String
}

struct WorkPicture {
    var earned = 0.0
    var since: Date? = nil
    var count = 0
    var sentence = ""
    var months: [WorkMonth] = []
    var owed: [WorkOwed] = []
    var clients: [WorkClient] = []
    var unlinked: String? = nil
    var feesAtPayment = 0.0
    var feesMoving = 0.0
    var fees: Double { feesAtPayment + feesMoving }
    var latest: [WorkLatest] = []

    static func build(payments: [Payment], projects: [Project], clients: [Client], withdrawals: [Withdrawal],
                      allocations: [PaymentAllocation], incomes: [LedgerEntry], wallets: [Wallet], rates: Rates,
                      now: Date = .now) -> WorkPicture {
        var w = WorkPicture()
        let cal = PHT.calendar
        let yearStart = PHT.startOfYear(now)
        let live = payments.filter { $0.deletedAt == nil }
        let year = live.filter { $0.paidAt >= yearStart }.sorted { $0.paidAt < $1.paidAt }
        let project = Dictionary(projects.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        let client = Dictionary(clients.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        let walletName = Dictionary(wallets.map { ($0.id, $0.name) }, uniquingKeysWith: { a, _ in a })
        func clientOf(_ p: Payment) -> Client? { p.projectId.flatMap { project[$0] }?.clientId.flatMap { client[$0] } }

        w.earned = year.reduce(0) { $0 + ($1.netAmountBase ?? 0) }
        w.count = year.count
        w.since = year.first.map { PHT.startOfMonth($0.paidAt) }

        // One bar per month since the first payment.
        if let first = w.since {
            var month = first
            let current = PHT.startOfMonth(now)
            while month <= current {
                let next = cal.date(byAdding: .month, value: 1, to: month) ?? current.addingTimeInterval(86_400 * 32)
                let total = year.filter { $0.paidAt >= month && $0.paidAt < next }.reduce(0) { $0 + ($1.netAmountBase ?? 0) }
                w.months.append(WorkMonth(month: month, total: total, isCurrent: month == current))
                month = next
            }
            if let peak = w.months.indices.max(by: { w.months[$0].total < w.months[$1].total }), w.months[peak].total > 0 {
                w.months[peak].isPeak = true
            }
        }

        // Clients with payments this year, biggest first.
        let linked = Dictionary(grouping: year.compactMap { p in clientOf(p).map { ($0, p) } }, by: { $0.0.id })
        w.clients = linked.compactMap { id, rows -> WorkClient? in
            guard let c = rows.first?.0 else { return nil }
            let ps = rows.map(\.1)
            let words = Dictionary(grouping: ps, by: \.currency).sorted { $0.value.count > $1.value.count }.map { WorkText.currencyWord($0.key) }
            let last = ps.map(\.paidAt).max() ?? now
            var parts: [String] = []
            if let co = c.company?.trimmingCharacters(in: .whitespacesAndNewlines), !co.isEmpty { parts.append(c.name) }
            parts.append(WorkText.list(words))
            parts.append(WorkText.count(ps.count, "payment", "payments"))
            parts.append(ps.count == 1 ? Day.dayMonth(last) : "last \(Day.dayMonth(last))")
            return WorkClient(id: id, title: WorkText.title(c), subtitle: parts.joined(separator: " · "),
                              total: ps.reduce(0) { $0 + ($1.netAmountBase ?? 0) })
        }
        .sorted { $0.total > $1.total }

        // Payments that reach no client: no project, a project without a client, or a project that no longer exists.
        let loose = year.filter { clientOf($0) == nil }
        if loose.count == 1, let p = loose.first {
            w.unlinked = "\(w.clients.isEmpty ? "One" : "One more") payment of \(MoneyFormat.string(p.netAmountBase ?? 0, decimals: false)) on \(Day.dayMonth(p.paidAt)) isn’t linked to a client."
        } else if loose.count > 1 {
            let total = loose.reduce(0) { $0 + ($1.netAmountBase ?? 0) }
            w.unlinked = "\(loose.count)\(w.clients.isEmpty ? "" : " more") payments, \(MoneyFormat.string(total, decimals: false)) in all, aren’t linked to a client."
        }

        w.sentence = sentence(w, looseCount: loose.count)

        // Owed: every unpaid or part-paid project with money still outstanding, oldest first.
        let liveAllocations = ProjectMath.liveAllocations(allocations, payments: live)
        w.owed = projects.filter { $0.deletedAt == nil && ($0.status == .unpaid || $0.status == .partiallyPaid) }
            .sorted { $0.agingAnchor < $1.agingAnchor }
            .compactMap { p -> WorkOwed? in
                let out = ProjectMath.outstandingNative(project: p, allocations: liveAllocations, rates: rates)
                guard out > 0.004 else { return nil }
                let who = p.clientId.flatMap { client[$0] }.map(WorkText.title) ?? "No client"
                var detail = out < p.amount - 0.004
                    ? "\(WorkText.native(out, p.currency)) of \(WorkText.native(p.amount, p.currency)) left"
                    : WorkText.native(out, p.currency)
                if let done = p.workCompletedAt {
                    let n = Day.daysBetween(done, now)
                    detail += n <= 0 ? ", delivered today" : n == 1 ? ", delivered yesterday" : ", delivered \(Day.dayMonth(done)), \(n) days ago"
                } else {
                    detail += ", not delivered yet"
                }
                return WorkOwed(project: p, client: who, base: rates.toBase(out, p.currency), estimate: p.currency != rates.base, detail: detail)
            }

        // What getting paid cost this year: what clients' payments lost on arrival, and moving it between wallets.
        w.feesAtPayment = year.reduce(0) { $0 + ($1.impliedFeeBase ?? 0) }
        w.feesMoving = withdrawals.filter { $0.deletedAt == nil && $0.withdrawnAt >= yearStart }.reduce(0) { $0 + $1.feeBase }

        // Latest payments, newest first.
        var landed: [UUID: UUID] = [:]
        for e in incomes where e.archivedAt == nil && e.kind == .income {
            if let r = e.relatedId, let wid = e.walletId, landed[r] == nil { landed[r] = wid }
        }
        w.latest = live.sorted { $0.paidAt > $1.paidAt }.prefix(8).map { p in
            let proj = p.projectId.flatMap { project[$0] }
            var sub = [clientOf(p).map(WorkText.title) ?? "no client", Day.dayMonth(p.paidAt)]
            if p.currency != rates.base { sub.append(WorkText.native(p.amount, p.currency)) }
            let fee = p.impliedFeeBase ?? 0
            let note = fee > 0.004 ? "\(MoneyFormat.string(fee)) fee"
                : (landed[p.id].flatMap { walletName[$0] }.map { "into \($0)" } ?? "no wallet")
            return WorkLatest(id: p.id, title: proj?.title ?? "Payment", subtitle: sub.joined(separator: " · "),
                              net: p.netAmountBase ?? 0, note: note)
        }
        return w
    }

    /// "30 payments from 5 clients, most of it from Acme Studio. June was the best month; October is quiet so far."
    private static func sentence(_ w: WorkPicture, looseCount: Int) -> String {
        guard w.count > 0 else { return "No payments yet this year." }
        var s: String
        let payments = WorkText.count(w.count, "payment", "payments")
        if let top = w.clients.first {
            if w.clients.count == 1 && looseCount == 0 {
                s = "\(payments), all from \(top.title)."
            } else {
                let share = w.earned > 0 ? top.total / w.earned : 0
                s = "\(payments) from \(WorkText.count(w.clients.count, "client", "clients")), "
                    + (share > 0.5 ? "most of it from \(top.title)." : "the most from \(top.title).")
            }
        } else {
            s = "\(payments), none linked to a client yet."
        }

        // The best month, and whether this month is running well below the months before it.
        guard w.months.count >= 3, let peak = w.months.first(where: \.isPeak) else { return s }
        let done = w.months.filter { !$0.isCurrent }
        let average = done.isEmpty ? 0 : done.reduce(0) { $0 + $1.total } / Double(done.count)
        let current = w.months.last(where: { $0.isCurrent })
        let quiet = current.map { $0.total < average * 0.5 } ?? false
        if peak.isCurrent {
            s += " \(Day.month(peak.month)) is already the best month."
        } else if quiet, let current {
            s += " \(Day.month(peak.month)) was the best month; \(Day.month(current.month)) is quiet so far."
        } else {
            s += " \(Day.month(peak.month)) was the best month."
        }
        return s
    }
}

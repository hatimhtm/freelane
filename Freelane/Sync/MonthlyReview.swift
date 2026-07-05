import Foundation
import SwiftData

/// The month-end ritual: on the first open in a new PHT month, a "your month, closed"
/// notification — landed, spent, net, the delta vs the month before, where the money went,
/// and what fees ate. The monthly sibling of WeeklyReview (which covers week-to-week shifts).
@MainActor
enum MonthlyReview {
    static func maybeRun(_ context: ModelContext) {
        // Quiet hours — same rule as the weekly: never before 8am or after 9pm.
        let hour = PHT.calendar.component(.hour, from: Date())
        guard hour >= 8 && hour < 21 else { return }

        let cal = PHT.calendar
        let thisMonth = PHT.startOfMonth()
        guard let lastMonth = cal.date(byAdding: .month, value: -1, to: thisMonth) else { return }

        // Once per month, keyed by the month being REVIEWED — so it fires on whatever day
        // the app is first opened in the new month, then stays quiet until the next one.
        let key = monthKey(lastMonth)
        guard UserDefaults.standard.string(forKey: "monthly.reviewedKey") != key else { return }
        UserDefaults.standard.set(key, forKey: "monthly.reviewedKey")

        let base = (try? context.fetch(FetchDescriptor<AppSettings>()).first)?.baseCurrency ?? "PHP"
        if let summary = buildSummary(context, base: base, monthStart: lastMonth, monthEnd: thisMonth) {
            let name = lastMonth.formatted(.dateTime.month(.wide))
            Notify.post(context, kind: "monthly_review", subject: "\(name), closed — your month in review",
                        body: summary, priority: 1, feature: .stats)
        }
    }

    static func buildSummary(_ context: ModelContext, base: String, monthStart: Date, monthEnd: Date) -> String? {
        let cal = PHT.calendar
        let payments = ((try? context.fetch(FetchDescriptor<Payment>())) ?? []).filter { $0.deletedAt == nil }
        let spends = ((try? context.fetch(FetchDescriptor<Spend>())) ?? []).filter { $0.deletedAt == nil }
        func money(_ v: Double) -> String { CurrencyFormat.string(v, base, compact: true) }

        let landed = payments.filter { $0.paidAt >= monthStart && $0.paidAt < monthEnd }.reduce(0) { $0 + ($1.netAmountBase ?? 0) }
        let spent = spends.filter { $0.spentAt >= monthStart && $0.spentAt < monthEnd }.reduce(0) { $0 + $1.amountBase }
        // An empty month closes silently — no nagging over nothing.
        guard landed > 0 || spent > 0 else { return nil }

        var parts: [String] = []
        parts.append("Landed \(money(landed)), spent \(money(spent)) → net \(landed - spent >= 0 ? "+" : "−")\(money(abs(landed - spent)))")

        // vs the month before.
        if let prior = cal.date(byAdding: .month, value: -1, to: monthStart) {
            let landedPrior = payments.filter { $0.paidAt >= prior && $0.paidAt < monthStart }.reduce(0) { $0 + ($1.netAmountBase ?? 0) }
            let spentPrior = spends.filter { $0.spentAt >= prior && $0.spentAt < monthStart }.reduce(0) { $0 + $1.amountBase }
            if landedPrior > 0 {
                let d = Int(((landed - landedPrior) / landedPrior) * 100)
                parts.append("income \(d >= 0 ? "+" : "")\(d)% vs \(prior.formatted(.dateTime.month(.abbreviated)))")
            }
            if spentPrior > 0 {
                let d = Int(((spent - spentPrior) / spentPrior) * 100)
                parts.append("spending \(d >= 0 ? "+" : "")\(d)%")
            }
        }

        // Where the money went (top category), and what fees ate.
        var cats: [String: Double] = [:]
        for s in spends where s.spentAt >= monthStart && s.spentAt < monthEnd {
            for t in (s.tags.isEmpty ? [s.category ?? "Untagged"] : s.tags) { cats[t, default: 0] += s.amountBase }
        }
        if let top = cats.max(by: { $0.value < $1.value }), top.value > 0 {
            parts.append("most on \(top.key) (\(money(top.value)))")
        }
        let fees = payments.filter { $0.paidAt >= monthStart && $0.paidAt < monthEnd && !$0.feeUnknown }
            .reduce(0) { $0 + ($1.impliedFeeBase ?? 0) }
        if fees > 0 { parts.append("fees took \(money(fees))") }

        return parts.joined(separator: " · ") + "."
    }

    private static func monthKey(_ d: Date) -> String {
        let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX")
        f.calendar = PHT.calendar; f.timeZone = PHT.zone; f.dateFormat = "yyyy-MM"
        return f.string(from: d)
    }
}

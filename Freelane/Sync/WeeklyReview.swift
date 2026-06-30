import Foundation
import SwiftData

/// A once-a-week "what changed" — focuses on shifts vs last week (income, spend
/// pace, a new vendor, the biggest category), delivered as a notification.
@MainActor
enum WeeklyReview {
    static func maybeRun(_ context: ModelContext) {
        // Quiet hours — never surface a proactive nudge before 8am or after 9pm.
        let hour = PHT.calendar.component(.hour, from: Date())
        guard hour >= 8 && hour < 21 else { return }

        let last = UserDefaults.standard.double(forKey: "review.lastAt")
        if !(last > 0 && Date.now.timeIntervalSince1970 - last < 7 * 86400) {
            let base = (try? context.fetch(FetchDescriptor<AppSettings>()).first)?.baseCurrency ?? "PHP"
            UserDefaults.standard.set(Date.now.timeIntervalSince1970, forKey: "review.lastAt")
            if let summary = buildSummary(context, base: base) {
                Notify.post(context, kind: "weekly_review", subject: "Your week — what changed",
                            body: summary, priority: 1, feature: .activity)
            }
        }
        maybeAnomaly(context)
    }

    /// A spending-anomaly whisper: if the last 7 days ran well above the trailing 4-week
    /// weekly average, post a calm heads-up. Once per week, quiet-hours-respecting.
    static func maybeAnomaly(_ context: ModelContext) {
        let last = UserDefaults.standard.double(forKey: "anomaly.lastAt")
        if last > 0, Date.now.timeIntervalSince1970 - last < 7 * 86400 { return }
        let base = (try? context.fetch(FetchDescriptor<AppSettings>()).first)?.baseCurrency ?? "PHP"
        let spends = (try? context.fetch(FetchDescriptor<Spend>())) ?? []
        let cal = PHT.calendar, now = Date()
        guard let weekAgo = cal.date(byAdding: .day, value: -7, to: now),
              let fourWeeksAgo = cal.date(byAdding: .day, value: -35, to: now) else { return }
        let recent = spends.filter { $0.deletedAt == nil && $0.spentAt >= weekAgo }.reduce(0) { $0 + $1.amountBase }
        let prior = spends.filter { $0.deletedAt == nil && $0.spentAt >= fourWeeksAgo && $0.spentAt < weekAgo }.reduce(0) { $0 + $1.amountBase }
        let priorWeekly = prior / 4
        UserDefaults.standard.set(now.timeIntervalSince1970, forKey: "anomaly.lastAt")
        guard priorWeekly > 0, recent > priorWeekly * 1.4 else { return }
        let pct = Int((recent / priorWeekly - 1) * 100)
        Notify.post(context, kind: "anomaly", subject: "Spending ran hot this week",
                    body: "You spent \(CurrencyFormat.string(recent, base, compact: true)) — about \(pct)% above your usual week. Worth a glance, no alarm.",
                    priority: 1, feature: .spending)
    }

    static func buildSummary(_ context: ModelContext, base: String) -> String? {
        let cal = PHT.calendar
        let thisWeek = PHT.startOfWeek()
        guard let lastWeek = cal.date(byAdding: .day, value: -7, to: thisWeek) else { return nil }
        let payments = (try? context.fetch(FetchDescriptor<Payment>())) ?? []
        let spends = (try? context.fetch(FetchDescriptor<Spend>())) ?? []

        func money(_ v: Double) -> String { CurrencyFormat.string(v, base, compact: true) }
        let incomeThis = payments.filter { $0.paidAt >= thisWeek }.reduce(0) { $0 + ($1.netAmountBase ?? 0) }
        let incomeLast = payments.filter { $0.paidAt >= lastWeek && $0.paidAt < thisWeek }.reduce(0) { $0 + ($1.netAmountBase ?? 0) }
        let spendThis = spends.filter { $0.spentAt >= thisWeek }.reduce(0) { $0 + $1.amountBase }
        let spendLast = spends.filter { $0.spentAt >= lastWeek && $0.spentAt < thisWeek }.reduce(0) { $0 + $1.amountBase }

        // Nothing happened → skip (don't nag with an empty week).
        guard incomeThis > 0 || spendThis > 0 else { return nil }

        var parts: [String] = []
        if incomeThis > 0 {
            let delta = incomeLast > 0 ? Int(((incomeThis - incomeLast) / incomeLast) * 100) : 0
            parts.append("Landed \(money(incomeThis))" + (incomeLast > 0 ? " (\(delta >= 0 ? "+" : "")\(delta)% vs last week)" : ""))
        }
        if spendThis > 0 {
            let delta = spendLast > 0 ? Int(((spendThis - spendLast) / spendLast) * 100) : 0
            parts.append("spent \(money(spendThis))" + (spendLast > 0 ? " (\(delta >= 0 ? "+" : "")\(delta)%)" : ""))
        }
        // Biggest category this week (tags, counted in full).
        var cats: [String: Double] = [:]
        for s in spends where s.spentAt >= thisWeek {
            for t in (s.tags.isEmpty ? [s.category ?? "Untagged"] : s.tags) { cats[t, default: 0] += s.amountBase }
        }
        if let top = cats.max(by: { $0.value < $1.value }) { parts.append("most on \(top.key)") }
        // A new vendor that didn't appear before this week.
        let before = Set(spends.filter { $0.spentAt < thisWeek }.compactMap { $0.vendorName?.lowercased() })
        let newVendor = spends.filter { $0.spentAt >= thisWeek }.compactMap { $0.vendorName }
            .first { !before.contains($0.lowercased()) }
        if let nv = newVendor { parts.append("first time at \(nv)") }

        return parts.joined(separator: " · ") + "."
    }
}

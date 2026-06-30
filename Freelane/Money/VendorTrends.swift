import Foundation

/// Month-over-month spend movement per vendor — the "you're up 40% at Jollibee this month"
/// signal that makes spending data talk. Shared by the Vendors screen (per-row trend chips) and
/// the Dashboard (the single biggest mover, as a tappable tile) so the two screens stay in sync.
enum VendorTrends {
    struct Mover: Identifiable {
        let name: String
        let thisMonth: Double
        let lastMonth: Double
        var id: String { name }

        /// Fractional change vs last month (0.4 = up 40%). nil when there's no meaningful baseline
        /// (nothing last month) or the move is too small to bother surfacing (< 10%).
        var delta: Double? {
            guard lastMonth >= 1 else { return nil }
            let d = (thisMonth - lastMonth) / lastMonth
            return abs(d) >= 0.10 ? d : nil
        }

        /// Absolute change in base currency — a big peso swing matters more than a big % on pennies.
        var swing: Double { thisMonth - lastMonth }
    }

    /// Per-vendor this-month vs last-month totals, keyed by vendor name.
    static func movers(_ spends: [Spend]) -> [String: Mover] {
        let monthStart = PHT.startOfMonth()
        let lastStart = PHT.calendar.date(byAdding: .month, value: -1, to: monthStart) ?? monthStart
        var thisM: [String: Double] = [:], lastM: [String: Double] = [:]
        for s in spends {
            guard s.deletedAt == nil, let name = s.vendorName, !name.isEmpty else { continue }
            if s.spentAt >= monthStart { thisM[name, default: 0] += s.amountBase }
            else if s.spentAt >= lastStart { lastM[name, default: 0] += s.amountBase }
        }
        var out: [String: Mover] = [:]
        for name in Set(thisM.keys).union(lastM.keys) {
            out[name] = Mover(name: name, thisMonth: thisM[name] ?? 0, lastMonth: lastM[name] ?? 0)
        }
        return out
    }

    /// The single most notable mover — the largest absolute swing among significant (≥10%) moves.
    static func biggest(_ spends: [Spend]) -> Mover? {
        movers(spends).values.filter { $0.delta != nil }.max(by: { abs($0.swing) < abs($1.swing) })
    }
}

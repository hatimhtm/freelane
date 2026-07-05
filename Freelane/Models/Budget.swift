import Foundation
import SwiftData

/// A monthly soft cap for one spending category/tag — the gentle-budget concept.
/// Matching is case-insensitive against the same tag/category aggregation Spending's
/// category chart uses, so a budget always tracks exactly what the chart shows.
@Model
final class CategoryBudget {
    @Attribute(.unique) var id: UUID
    var tag: String
    var capBase: Double        // per PHT month, in base currency; <= 0 means no budget
    var createdAt: Date
    var updatedAt: Date
    var dirty: Bool = false    // sync invariant parity with every other mutable model

    init(id: UUID = UUID(), tag: String, capBase: Double) {
        self.id = id
        self.tag = tag
        self.capBase = capBase
        self.createdAt = .now
        self.updatedAt = .now
    }
}

extension CategoryBudget {
    /// This month's spend against this budget, from the same tag aggregation the chart uses.
    @MainActor
    static func monthTotals(_ spends: [Spend]) -> [String: Double] {
        var d: [String: Double] = [:]
        let start = PHT.startOfMonth()
        for s in spends where s.deletedAt == nil && s.spentAt >= start {
            for t in (s.tags.isEmpty ? [s.category ?? "Untagged"] : s.tags) {
                d[t.lowercased(), default: 0] += s.amountBase
            }
        }
        return d
    }
}

import Foundation

/// Remembers what you've paid per item over time (from `SpendItem` history) and judges whether a
/// new price is a good deal — entirely from YOUR own buying history, no internet needed. This is
/// the invisible "price memory": nothing on a page, just recalled when you log the item again.
enum PriceMemory {
    struct History { let avg: Double; let min: Double; let last: Double; let count: Int }

    /// Past per-unit prices (in base) for an item name, newest first.
    static func history(for name: String, items: [SpendItem]) -> History? {
        let key = SpendItem.normalize(name)
        guard key.count >= 2 else { return nil }
        let matches = items.filter { $0.deletedAt == nil && $0.nameKey == key && $0.quantity > 0 }
            .sorted { $0.createdAt > $1.createdAt }
        guard !matches.isEmpty else { return nil }
        let prices = matches.map { $0.unitPriceBase }
        return History(avg: prices.reduce(0, +) / Double(prices.count),
                       min: prices.min() ?? 0, last: prices.first ?? 0, count: prices.count)
    }

    enum Deal: Equatable {
        case cheaper(pct: Int)   // notably below your usual
        case pricier(pct: Int)   // notably above your usual
        case usual               // about what you normally pay
        case firstTime           // never logged before
    }

    /// Judge a per-unit price against your own history.
    static func judge(unitPriceBase: Double, history: History?) -> Deal {
        guard let h = history, h.avg > 0 else { return .firstTime }
        let ratio = unitPriceBase / h.avg
        if ratio <= 0.92 { return .cheaper(pct: Int((1 - ratio) * 100)) }
        if ratio >= 1.10 { return .pricier(pct: Int((ratio - 1) * 100)) }
        return .usual
    }
}

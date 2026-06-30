import Foundation
import SwiftData

/// An outflow. Denormalizes vendor/category to text for a simpler native model
/// (the web app's link tables aren't needed for a single-user local app).
@Model
final class Spend {
    @Attribute(.unique) var id: UUID
    var deletedAt: Date? = nil   // soft-delete tombstone — nil = live; set = in Trash (P1 restore/undo)
    var walletId: UUID?
    var spentAt: Date
    var amount: Double
    var currency: String
    var amountBase: Double
    var spendDescription: String?
    var vendorName: String?
    var category: String?          // kept = first tag, for back-compat displays
    var tags: [String] = []        // pure labels — each counts FULL, never split
    var isSadaka: Bool
    var isBusiness: Bool = false        // investment in work (gear, software…) — counts, but not "everyday"
    var isHouse: Bool = false           // investment in home/relationship (furniture…) — counts, but not "everyday"
    var notes: String?
    var recurringId: UUID? = nil       // settled from a recurring rule
    var coversPeriods: Int = 1         // how many periods this payment prepaid

    /// An intentional investment, not day-to-day spending.
    var isInvestment: Bool { isBusiness || isHouse }
    var createdAt: Date

    var updatedAt: Date
    var dirty: Bool

    init(id: UUID = UUID(), walletId: UUID?, spentAt: Date, amount: Double, currency: String,
         amountBase: Double, spendDescription: String? = nil) {
        self.id = id
        self.walletId = walletId
        self.spentAt = spentAt
        self.amount = amount
        self.currency = currency
        self.amountBase = amountBase
        self.spendDescription = spendDescription
        self.isSadaka = false
        self.createdAt = .now
        self.updatedAt = .now
        self.dirty = false
    }
}

@Model
final class Vendor {
    @Attribute(.unique) var id: UUID
    var deletedAt: Date? = nil   // soft-delete tombstone — nil = live; set = in Trash (P1 restore/undo)
    var name: String
    var kind: String?
    var brandColor: String?
    var brandGlyph: String?
    var archived: Bool
    var createdAt: Date

    var updatedAt: Date
    var dirty: Bool

    init(id: UUID = UUID(), name: String) {
        self.id = id
        self.name = name
        self.archived = false
        self.createdAt = .now
        self.updatedAt = .now
        self.dirty = false
    }
}

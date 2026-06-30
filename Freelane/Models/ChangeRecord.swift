import Foundation
import SwiftData

/// An append-only audit trail of safety-relevant changes (delete / restore / permanent-delete,
/// and money edits). Lets you answer "what happened to this, and when?" — and is the substrate
/// for a fuller who/what/when log later. Kept lightweight; pruned to the last 90 days.
@Model
final class ChangeRecord {
    @Attribute(.unique) var id: UUID
    var at: Date
    var action: String        // deleted · restored · purged · edited
    var entityType: String     // Spend · Payment · Project …
    var entityId: UUID?
    var summary: String

    init(action: String, entityType: String, entityId: UUID?, summary: String) {
        self.id = UUID()
        self.at = .now
        self.action = action
        self.entityType = entityType
        self.entityId = entityId
        self.summary = summary
    }
}

enum Audit {
    /// Record one change. Safe to call from any mutation; never throws.
    static func log(_ context: ModelContext, action: String, type: String, id: UUID?, summary: String) {
        context.insert(ChangeRecord(action: action, entityType: type, entityId: id, summary: summary))
    }

    /// Last `limit` records, newest first.
    static func recent(_ context: ModelContext, limit: Int = 40) -> [ChangeRecord] {
        var d = FetchDescriptor<ChangeRecord>(sortBy: [SortDescriptor(\.at, order: .reverse)])
        d.fetchLimit = limit
        return (try? context.fetch(d)) ?? []
    }

    /// Drop entries older than 90 days. Run at launch.
    static func prune(_ context: ModelContext) {
        guard let cutoff = PHT.calendar.date(byAdding: .day, value: -90, to: .now) else { return }
        let d = FetchDescriptor<ChangeRecord>(predicate: #Predicate { $0.at < cutoff })
        for r in (try? context.fetch(d)) ?? [] { context.delete(r) }
    }
}

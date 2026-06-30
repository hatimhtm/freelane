import Foundation
import SwiftData

/// Anything the user can put in the Trash and restore. Every conformer has a stable `id`,
/// a `deletedAt` tombstone (nil = live, set = trashed), and the `dirty` sync flag.
protocol SoftDeletable: AnyObject {
    var id: UUID { get }
    var deletedAt: Date? { get set }
    var dirty: Bool { get set }
}

extension Client: SoftDeletable {}
extension Project: SoftDeletable {}
extension Wallet: SoftDeletable {}
extension Payment: SoftDeletable {}
extension Withdrawal: SoftDeletable {}
extension Spend: SoftDeletable {}
extension Vendor: SoftDeletable {}
extension Loan: SoftDeletable {}
extension BodyLog: SoftDeletable {}
extension Letter: SoftDeletable {}
extension Entity: SoftDeletable {}
extension Recurring: SoftDeletable {}

/// Reversible delete. Tombstones the entity and, if it owns ledger entries, archives the
/// CURRENTLY-LIVE ones with the SAME timestamp as the tombstone — so `restore` can re-activate
/// exactly those rows and leave older edit-archived rows archived. All math (StateSnapshot /
/// engine `all<T>`) already excludes tombstoned entities and archived ledger, so a trashed
/// item instantly drops out of balances, totals, forecasts, and signals — and snaps back on
/// restore. The row is never hard-removed until 30-day purge.
enum SoftDelete {

    /// Move an entity to the Trash. `ownsLedger` true for Spend/Payment/Withdrawal/Loan.
    static func trash(_ entity: any SoftDeletable, ownsLedger: Bool, context: ModelContext) {
        let stamp = Date.now
        entity.deletedAt = stamp
        entity.dirty = true
        if ownsLedger {
            let rid = entity.id
            let desc = FetchDescriptor<LedgerEntry>(predicate: #Predicate { $0.relatedId == rid && $0.archivedAt == nil })
            for le in (try? context.fetch(desc)) ?? [] { le.archivedAt = stamp; le.dirty = true }
        }
        let type = String(describing: Swift.type(of: entity))
        Audit.log(context, action: "deleted", type: type, id: entity.id, summary: "\(type) moved to Trash")
    }

    /// Bring an entity back from the Trash, re-activating the ledger rows this delete archived
    /// (matched by the tombstone timestamp, so unrelated archives stay archived).
    static func restore(_ entity: any SoftDeletable, ownsLedger: Bool, context: ModelContext) {
        guard let stamp = entity.deletedAt else { return }
        if ownsLedger {
            let rid = entity.id
            let desc = FetchDescriptor<LedgerEntry>(predicate: #Predicate { $0.relatedId == rid && $0.archivedAt == stamp })
            for le in (try? context.fetch(desc)) ?? [] { le.archivedAt = nil; le.dirty = true }
        }
        entity.deletedAt = nil
        entity.dirty = true
        let type = String(describing: Swift.type(of: entity))
        Audit.log(context, action: "restored", type: type, id: entity.id, summary: "\(type) restored from Trash")
    }

    /// Hard-remove the ledger rows an entity created (used by permanent delete / purge).
    static func purgeLedger(relatedId: UUID, context: ModelContext) {
        let desc = FetchDescriptor<LedgerEntry>(predicate: #Predicate { $0.relatedId == relatedId })
        for le in (try? context.fetch(desc)) ?? [] { context.delete(le) }
    }

    /// On PERMANENT delete, remove/clean up the child rows that reference this entity so a purge
    /// can't leave dangling orphans (line-items pointing at a gone spend, allocations/milestones
    /// pointing at a gone project, projects pointing at a gone client). Call before context.delete.
    static func purgeChildren(type: String, id: UUID, context: ModelContext) {
        switch type {
        case "Spend":
            for it in (try? context.fetch(FetchDescriptor<SpendItem>(predicate: #Predicate { $0.spendId == id }))) ?? [] { context.delete(it) }
        case "Project":
            for a in (try? context.fetch(FetchDescriptor<PaymentAllocation>(predicate: #Predicate { $0.projectId == id }))) ?? [] { context.delete(a) }
            for m in (try? context.fetch(FetchDescriptor<ProjectMilestone>(predicate: #Predicate { $0.projectId == id }))) ?? [] { context.delete(m) }
        case "Client":
            for p in (try? context.fetch(FetchDescriptor<Project>(predicate: #Predicate { $0.clientId == id }))) ?? [] { p.clientId = nil; p.dirty = true }
        default: break
        }
    }

    /// Record a permanent deletion in the audit trail — so a purge (manual or 30-day sweep) is
    /// never silent. `withLedger` notes that the entity's ledger rows were erased with it, so a
    /// vanished balance is always traceable to a logged "purged" event. (The audit insert and the
    /// deletes share one context.save(), so they commit atomically — no audit-without-delete.)
    static func auditPurge(_ context: ModelContext, type: String, id: UUID, withLedger: Bool = false) {
        let detail = withLedger ? "\(type) and its ledger entries permanently deleted" : "\(type) permanently deleted"
        Audit.log(context, action: "purged", type: type, id: id, summary: detail)
    }
}

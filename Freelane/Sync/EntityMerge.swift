import Foundation
import SwiftData

/// Merging duplicate people/entities, and noticing likely duplicates the AI created
/// (e.g. a generic "my wife" alongside the real "Celine" you added).
@MainActor
enum EntityMerge {
    /// Does this name read like a placeholder the AI coined rather than a real name?
    static func looksGeneric(_ name: String) -> Bool {
        let n = name.lowercased().trimmingCharacters(in: .whitespaces)
        if n.hasPrefix("my ") { return true }
        return ["wife", "husband", "spouse", "partner", "mom", "dad", "mother", "father",
                "brother", "sister", "son", "daughter", "friend", "boss", "client",
                "neighbor", "neighbour", "landlord", "doctor"].contains(n)
    }

    /// Merge `from` into `target`: fill target's blanks, combine notes, move AI facts, trash `from`.
    static func merge(_ from: Entity, into target: Entity, context: ModelContext) {
        guard from.id != target.id else { return }
        if (target.relationship?.isEmpty ?? true), let r = from.relationship, !r.isEmpty { target.relationship = r }
        if target.importantDate == nil { target.importantDate = from.importantDate; target.importantDateLabel = from.importantDateLabel }
        let notes = [target.notes, from.notes].compactMap { $0 }.map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        if !notes.isEmpty { target.notes = Array(NSOrderedSet(array: notes)).compactMap { $0 as? String }.joined(separator: "\n") }
        // Keep the real name over a placeholder.
        if looksGeneric(target.name) && !looksGeneric(from.name) { target.name = from.name }
        target.confidence = max(target.confidence, from.confidence)
        target.introduced = target.introduced || from.introduced
        if let le = from.lastEventAt, (target.lastEventAt ?? .distantPast) < le { target.lastEventAt = le }
        target.updatedAt = .now; target.dirty = true

        // Move AI-learned facts from `from` → `target` (upsert respects any the target already has).
        let fromId = from.id.uuidString, toId = target.id.uuidString
        let facts = (try? context.fetch(FetchDescriptor<AIFact>())) ?? []
        for f in facts where f.subjectKind == "entity" && f.subjectId == fromId && f.archivedAt == nil {
            Brain.upsertFact(context, subjectKind: "entity", subjectId: toId, key: f.key, value: f.value, confidence: f.confidence, source: f.source)
            context.delete(f)
        }
        from.deletedAt = .now; from.dirty = true   // soft-delete → restorable from Trash
        try? context.save()
    }

    /// Stable key for an unordered pair of entities.
    static func pairKey(_ a: UUID, _ b: UUID) -> String { [a.uuidString, b.uuidString].sorted().joined(separator: "|") }

    /// Pairs the user explicitly marked "not the same person" — never suggest them again.
    static var notSamePairs: Set<String> {
        get { Set(UserDefaults.standard.string(forKey: "people.notSame")?.split(separator: "\n").map(String.init) ?? []) }
        set { UserDefaults.standard.set(newValue.sorted().joined(separator: "\n"), forKey: "people.notSame") }
    }
    static func markNotSame(keep: UUID, members: [UUID]) {
        var s = notSamePairs
        for m in members { s.insert(pairKey(keep, m)) }
        notSamePairs = s
    }
}

/// Notices likely-duplicate people the AI created and nudges the user to merge. Runs in the
/// launch sweep; deduped so it asks once per pair.
@MainActor
enum DuplicatePeople {
    static func scan(_ context: ModelContext) {
        let entities = ((try? context.fetch(FetchDescriptor<Entity>())) ?? []).filter { $0.deletedAt == nil && !$0.archived }
        guard entities.count > 1 else { return }
        for g in entities where EntityMerge.looksGeneric(g.name) {
            // The relationship a generic entity stands for ("my wife" → wife).
            let rel = (g.relationship?.lowercased()).flatMap { $0.isEmpty ? nil : $0 }
                ?? g.name.lowercased().replacingOccurrences(of: "my ", with: "")
            guard !rel.isEmpty else { continue }
            // A real-named person who shares that relationship (or whose name IS the relationship word).
            if let match = entities.first(where: { other in
                other.id != g.id && !EntityMerge.looksGeneric(other.name)
                && ((other.relationship?.lowercased() == rel) || other.name.lowercased() == rel)
            }) {
                let pair = [g.id.uuidString, match.id.uuidString].sorted().joined(separator: "|")
                Notify.postUnique(context, dedupKey: "merge:\(pair)", kind: "merge_people",
                                  subject: "Two people might be the same",
                                  body: "“\(g.name)” and “\(match.name)” both look like your \(rel). Open People to merge them into one.",
                                  priority: 1, feature: .people)
            }
        }
    }
}

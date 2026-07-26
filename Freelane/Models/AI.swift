import Foundation
import SwiftData

// MARK: - AI fact store (ai_user_facts)

/// A single structured thing the assistant has learned. Replaces the dead
/// `Client.memoryJSON` field with a real, queryable store the brains read back.
/// Subjects: user / client / vendor / project / plan / entity.
@Model
final class AIFact {
    @Attribute(.unique) var id: String      // "\(subjectKind):\(subjectId ?? "_"):\(key)"
    var subjectKind: String
    var subjectId: String?
    var key: String                         // snake_case, e.g. "wake_time"
    var value: String                       // plain text answer
    var confidence: Double                  // 0...1
    var source: String                      // user_answered | inferred | seeded
    var evidence: String?
    var createdAt: Date
    var updatedAt: Date
    var archivedAt: Date?
    /// "affirm" (default) or "deny". A DENIAL is a standing record that something is not true —
    /// stored as its own row rather than as another fact, so the store can never hold a belief and
    /// its negation at the same time. Optional so SwiftData migrates the existing store in place.
    /// See `Memory` for the rules; nothing outside that type should set this.
    var polarity: String?

    init(subjectKind: String = "user", subjectId: String? = nil, key: String,
         value: String, confidence: Double = 1.0, source: String = "user_answered",
         evidence: String? = nil) {
        // ONE authority for the address, shared with every reader — see `Memory.factID`. This used
        // to build the id inline, which was fine while the readers did the same thing inline, and
        // stopped being fine the moment one of them started normalising the key and the others
        // didn't. A row written to an address nobody looks up is a fact that silently doesn't exist.
        self.id = Memory.factID(subjectKind, subjectId, key)
        self.subjectKind = subjectKind
        self.subjectId = subjectId
        self.key = key
        self.value = value
        self.confidence = confidence
        self.source = source
        self.evidence = evidence
        self.createdAt = .now
        self.updatedAt = .now
    }

    /// Human label for a snake_case key ("wake_time" → "Wake time").
    var prettyKey: String {
        key.split(separator: "_").map { $0.prefix(1).uppercased() + $0.dropFirst() }.joined(separator: " ")
    }
}

// MARK: - Brain cache (ai_brain_cache)

/// Cache-first AI payloads. A row is fresh only when (a) generated on the same
/// PHT day, (b) not past `staleAt`, and (c) the input `fingerprint` still matches.
/// Mirrors the web app's regeneration triggers so AI never runs on every load.
@Model
final class BrainCache {
    @Attribute(.unique) var key: String     // brain key, optionally scoped with "::"
    var payload: String                      // JSON or plain text
    var generatedAt: Date
    var staleAt: Date?
    var fingerprint: String?

    init(key: String, payload: String, generatedAt: Date = .now,
         staleAt: Date? = nil, fingerprint: String? = nil) {
        self.key = key
        self.payload = payload
        self.generatedAt = generatedAt
        self.staleAt = staleAt
        self.fingerprint = fingerprint
    }
}

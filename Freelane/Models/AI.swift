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

    init(subjectKind: String = "user", subjectId: String? = nil, key: String,
         value: String, confidence: Double = 1.0, source: String = "user_answered",
         evidence: String? = nil) {
        // ':' is the id separator — escape it in components so an AI-generated key/id containing
        // a colon can't collide with (and clobber) an unrelated fact under the unique id.
        func esc(_ s: String) -> String { s.replacingOccurrences(of: ":", with: "_") }
        self.id = "\(esc(subjectKind)):\(esc(subjectId ?? "_")):\(esc(key))"
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

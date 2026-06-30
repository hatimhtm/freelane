import Foundation
import SwiftData

/// In-app notification (local). Mirrors the web app's notifications_inbox:
/// read/dismiss states, priority, optional AI-question payload (choices / free-text).
@Model
final class AppNotification {
    @Attribute(.unique) var id: UUID
    var kind: String
    var subject: String
    var body: String?
    var priority: Int          // 0 calm, 1 attention, 2 escalated
    var createdAt: Date
    var readAt: Date?
    var dismissedAt: Date?
    var snoozedUntil: Date? = nil   // hidden from the bell until this time (snooze)
    // AI clarifying-question payload
    var isQuestion: Bool
    var choices: [String]
    var freeText: Bool
    var answer: String?
    var linkFeature: String?   // Feature.rawValue to deep-link to
    var factKey: String?       // when answered, fold into AIFact under this user key
    var dedupKey: String?      // suppress duplicates of the same signal
    // Curiosity routing
    var questionKind: String?  // "entity_discovery" | "entity_clarify" | "fact" | nil
    var candidateName: String? // for entity_discovery: the name we noticed
    var entityId: String?      // for entity_clarify: which entity this enriches
    var factSubjectKind: String? // "user" | "entity" — where the answer's fact lands

    init(id: UUID = UUID(), kind: String, subject: String, body: String? = nil, priority: Int = 0) {
        self.id = id
        self.kind = kind
        self.subject = subject
        self.body = body
        self.priority = priority
        self.createdAt = .now
        self.isQuestion = false
        self.choices = []
        self.freeText = false
    }
}

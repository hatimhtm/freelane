import Foundation
import SwiftData

/// Anything in your life the app tracks money/meaning around — people, pets,
/// places, things, or anything it doesn't understand yet. Open by design: the AI
/// keeps discovering and asking about whatever shows up.
enum EntityKind: String, CaseIterable, Codable, Sendable {
    case person, pet, place, thing, concept, unknown

    var label: String {
        switch self {
        case .person: return "Person"
        case .pet: return "Pet"
        case .place: return "Place"
        case .thing: return "Thing"
        case .concept: return "Concept"
        case .unknown: return "Unsorted"
        }
    }
    var icon: String {
        switch self {
        case .person: return "person.fill"
        case .pet: return "pawprint.fill"
        case .place: return "mappin.circle.fill"
        case .thing: return "shippingbox.fill"
        case .concept: return "sparkles"
        case .unknown: return "questionmark.circle.fill"
        }
    }
}

@Model
final class Entity {
    @Attribute(.unique) var id: UUID
    var deletedAt: Date? = nil   // soft-delete tombstone — nil = live; set = in Trash (P1 restore/undo)
    var name: String
    var kindRaw: String
    var relationship: String?
    var notes: String?
    var importantDate: Date?
    var importantDateLabel: String?      // "Birthday", "Anniversary"…
    var discoveredFrom: String?          // the raw signal that surfaced it
    var confidence: Double               // 0…1; 1.0 = you confirmed it
    var introduced: Bool                 // you've seen/confirmed it exists
    var archived: Bool
    var lastEventAt: Date?
    var createdAt: Date
    var updatedAt: Date
    var dirty: Bool

    var kind: EntityKind {
        get { EntityKind(rawValue: kindRaw) ?? .unknown }
        set { kindRaw = newValue.rawValue }
    }

    init(id: UUID = UUID(), name: String, kind: EntityKind = .unknown,
         confidence: Double = 1.0, introduced: Bool = true, discoveredFrom: String? = nil) {
        self.id = id
        self.name = name
        self.kindRaw = kind.rawValue
        self.confidence = confidence
        self.introduced = introduced
        self.discoveredFrom = discoveredFrom
        self.archived = false
        self.createdAt = .now
        self.updatedAt = .now
        self.dirty = false
    }
}

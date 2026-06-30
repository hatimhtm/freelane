import Foundation
import SwiftData

// MARK: - Plans (savings goals)

@Model
final class Plan {
    @Attribute(.unique) var id: UUID
    var title: String
    var targetAmount: Double
    var savedAmount: Double
    var targetDate: Date?
    var notes: String?
    var archived: Bool
    var monthlySetAside: Double = 0     // reserved from safe-to-spend each month
    var strategy: String?               // AI's one-line plan to reach it
    var priceLow: Double?               // AI price estimate range
    var priceHigh: Double?
    var createdAt: Date
    var updatedAt: Date
    var dirty: Bool

    init(id: UUID = UUID(), title: String, targetAmount: Double, savedAmount: Double = 0) {
        self.id = id; self.title = title; self.targetAmount = targetAmount; self.savedAmount = savedAmount
        self.archived = false; self.createdAt = .now; self.updatedAt = .now; self.dirty = false
    }
    var progress: Double { targetAmount > 0 ? min(1, savedAmount / targetAmount) : 0 }
    var remaining: Double { max(0, targetAmount - savedAmount) }
}

// MARK: - Loans

enum LoanDirection: String, Codable, CaseIterable { case given, received
    var label: String { self == .given ? "Lent out" : "Borrowed" } }
enum LoanStatus: String, Codable, CaseIterable { case open, partiallyReturned = "partially_returned", returned, forgiven
    var label: String { switch self { case .open: return "Open"; case .partiallyReturned: return "Partial"; case .returned: return "Returned"; case .forgiven: return "Forgiven" } } }

@Model
final class Loan {
    @Attribute(.unique) var id: UUID
    var deletedAt: Date? = nil   // soft-delete tombstone — nil = live; set = in Trash (P1 restore/undo)
    var counterparty: String
    var directionRaw: String
    var principalBase: Double
    var outstandingBase: Double
    var statusRaw: String
    var startedAt: Date
    var dueDate: Date?
    var originWalletId: UUID?     // money lent left here / borrowed landed here
    var forgivenBase: Double?     // amount outstanding when forgiven (counts as sadaka given)
    var forgivenAt: Date?
    var notes: String?
    var createdAt: Date
    var updatedAt: Date
    var dirty: Bool

    var direction: LoanDirection { get { LoanDirection(rawValue: directionRaw) ?? .given } set { directionRaw = newValue.rawValue } }
    var status: LoanStatus { get { LoanStatus(rawValue: statusRaw) ?? .open } set { statusRaw = newValue.rawValue } }

    init(id: UUID = UUID(), counterparty: String, direction: LoanDirection, principalBase: Double, startedAt: Date = .now) {
        self.id = id; self.counterparty = counterparty; self.directionRaw = direction.rawValue
        self.principalBase = principalBase; self.outstandingBase = principalBase
        self.statusRaw = LoanStatus.open.rawValue; self.startedAt = startedAt
        self.createdAt = .now; self.updatedAt = .now; self.dirty = false
    }
}

// MARK: - Habits

@Model
final class Habit {
    @Attribute(.unique) var id: UUID
    var name: String
    var emoji: String?
    var archived: Bool
    var createdAt: Date
    var updatedAt: Date
    var dirty: Bool

    init(id: UUID = UUID(), name: String, emoji: String? = nil) {
        self.id = id; self.name = name; self.emoji = emoji
        self.archived = false; self.createdAt = .now; self.updatedAt = .now; self.dirty = false
    }
}

@Model
final class HabitEntry {
    @Attribute(.unique) var id: String   // "\(habitId)|yyyy-MM-dd"
    var habitId: UUID
    var day: Date
    var done: Bool
    var dirty: Bool

    init(habitId: UUID, day: Date, done: Bool = true) {
        let key = ISO8601DateFormatter().string(from: day).prefix(10)
        self.id = "\(habitId.uuidString)|\(key)"
        self.habitId = habitId; self.day = day; self.done = done; self.dirty = false
    }
}

// MARK: - Body / wellbeing

@Model
final class BodyLog {
    @Attribute(.unique) var id: UUID
    var deletedAt: Date? = nil   // soft-delete tombstone — nil = live; set = in Trash (P1 restore/undo)
    var day: Date
    var energy: Int?       // 1–5
    var sleepHours: Double?
    var mood: Int?         // 1–5
    var waterCups: Int? = nil       // legacy (glasses) — superseded by waterMl
    var waterMl: Int? = nil         // water intake in millilitres (preset 500ml / 1L / 1.5L)
    var workoutMinutes: Int? = nil  // minutes moved
    var weightKg: Double? = nil     // body weight
    var notes: String?
    var createdAt: Date
    var updatedAt: Date
    var dirty: Bool

    init(id: UUID = UUID(), day: Date) {
        self.id = id; self.day = day; self.createdAt = .now; self.updatedAt = .now; self.dirty = false
    }
}

// MARK: - Faith (prayer & fasting tracking)

/// One obligatory prayer marked prayed on a given day. Existence = prayed (mirrors the
/// daily-log pattern). The five tracked prayers are Fajr/Dhuhr/Asr/Maghrib/Isha.
@Model
final class PrayerLog {
    @Attribute(.unique) var id: String   // "Fajr|2026-06-08"
    var prayer: String
    var day: Date
    var loggedAt: Date
    var dirty: Bool

    init(prayer: String, day: Date) {
        self.id = "\(prayer)|\(PHT.dayKey(day))"
        self.prayer = prayer; self.day = day; self.loggedAt = .now; self.dirty = false
    }
}

/// A day's fast (Ramadan or voluntary). Existence with fasted=true = fasted that day.
@Model
final class FastLog {
    @Attribute(.unique) var id: String   // "2026-06-08"
    var day: Date
    var fasted: Bool
    var notes: String?
    var dirty: Bool

    init(day: Date, fasted: Bool = true) {
        self.id = PHT.dayKey(day); self.day = day; self.fasted = fasted; self.dirty = false
    }
}

// MARK: - Letters (editorial / reflections)

@Model
final class Letter {
    @Attribute(.unique) var id: UUID
    var deletedAt: Date? = nil   // soft-delete tombstone — nil = live; set = in Trash (P1 restore/undo)
    var title: String
    var body: String
    var kind: String
    var pinned: Bool
    var sentiment: String? = nil      // AI: one-word mood, e.g. "hopeful", "drained"
    var themesRaw: String? = nil      // AI: up to 3 themes, comma-joined
    var createdAt: Date
    var updatedAt: Date
    var dirty: Bool

    var themes: [String] { (themesRaw ?? "").split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty } }

    init(id: UUID = UUID(), title: String, body: String, kind: String = "reflection") {
        self.id = id; self.title = title; self.body = body; self.kind = kind
        self.pinned = false; self.createdAt = .now; self.updatedAt = .now; self.dirty = false
    }
}

// MARK: - Journal prompts (persisted questions)

/// A journal question that LIVES until you answer or dismiss it — never regenerated on app open.
/// Sources: "ai" (requested batch), "followup" (born from something you wrote). Answered and
/// dismissed prompts are kept as history so the AI never asks the same thing twice.
@Model
final class JournalPrompt {
    @Attribute(.unique) var id: UUID
    var text: String
    var source: String            // "ai" | "followup" | "project"
    var status: String            // "open" | "answered" | "dismissed"
    var answeredLetterId: UUID? = nil   // the entry that answered it
    var feedback: String? = nil   // "up" (good question) | "down" (not for me) — teaches the AI taste
    var sourceLetterId: UUID? = nil   // for "followup": the entry this question grew out of
    var sourceExcerpt: String? = nil  // for "followup": a short quote of what they wrote, so the question is never shown context-free
    var createdAt: Date
    var resolvedAt: Date? = nil
    var dirty: Bool

    init(id: UUID = UUID(), text: String, source: String = "ai") {
        self.id = id; self.text = text; self.source = source
        self.status = "open"; self.createdAt = .now; self.dirty = false
    }
}

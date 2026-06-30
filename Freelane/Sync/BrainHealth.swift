import Foundation
import SwiftData

/// Per-brain reliability ledger — local (Ollama), on-device (Apple), cloud (Gemini).
/// Every AI attempt is recorded, so a silently-failing brain becomes VISIBLE:
///   · Settings → AI shows each brain's success/failure counts and its last error.
///   · Three consecutive failures raise ONE notification (and re-arm only after a recovery),
///     so the user learns "the local model keeps failing" without being spammed.
@MainActor @Observable
final class BrainHealth {
    static let shared = BrainHealth()

    struct Stat: Codable {
        var ok = 0
        var fail = 0
        var consecutive = 0
        var lastError: String?
        var lastFailAt: Date?
        var notified = false
    }

    private(set) var stats: [String: Stat] = [:]
    private static let key = "brain.health"

    private init() {
        if let data = UserDefaults.standard.data(forKey: Self.key),
           let decoded = try? JSONDecoder().decode([String: Stat].self, from: data) {
            stats = decoded
        }
    }

    private func persist() {
        if let data = try? JSONEncoder().encode(stats) {
            UserDefaults.standard.set(data, forKey: Self.key)
        }
    }

    func success(_ source: String) {
        var s = stats[source] ?? Stat()
        s.ok += 1; s.consecutive = 0; s.notified = false   // recovery re-arms the alert
        stats[source] = s
        persist()
    }

    func failure(_ source: String, error: Error) {
        var s = stats[source] ?? Stat()
        s.fail += 1; s.consecutive += 1
        s.lastError = String(error.localizedDescription.prefix(160))
        s.lastFailAt = .now
        // 3 strikes → tell the user once, until the brain recovers. Decide before the single
        // persist so we write UserDefaults just once per failure.
        let shouldNotify = s.consecutive >= 3 && !s.notified
        if shouldNotify { s.notified = true }
        stats[source] = s
        persist()
        if shouldNotify {
            let name = Self.displayName(source)
            Notify.post(AppContainer.shared.mainContext, kind: "warning",
                        subject: "\(name) keeps failing",
                        body: "\(s.consecutive) failures in a row — last error: \(s.lastError ?? "unknown"). Other brains are covering for it; check Settings → AI.",
                        priority: 1, feature: .settings)
        }
    }

    static func displayName(_ source: String) -> String {
        switch source {
        case "local": return "Your local model"
        case "on-device": return "Apple's on-device model"
        default: return "Gemini (cloud)"
        }
    }
}

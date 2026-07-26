import Foundation
import SwiftData
#if canImport(FoundationModels)
import FoundationModels
#endif

/// Per-brain reliability ledger — on-device, Private Cloud Compute, local model.
/// Every AI attempt is recorded, so a silently-failing brain becomes VISIBLE:
///   · Settings → Intelligence shows each brain's success/failure counts and its last error.
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
        /// Times this brain REFUSED rather than broke — see `isRefusal`. Counted apart from
        /// `fail` and deliberately never notified: nothing is wrong and there is nothing to fix.
        var refused = 0
    }

    /// A refusal is a policy outcome, not a malfunction.
    ///
    /// Apple's on-device model has a safety filter that can't be configured or opted out of, and it
    /// throws `guardrailViolation` on first-person emotional writing — which is exactly what a
    /// journal entry is. Treating that as a failure was wrong twice over: it told the user their AI
    /// was broken when it was working as designed, and it pointed them at a Settings page where
    /// nothing could be changed. The router still falls through to the next brain; that's the whole
    /// remedy, and it needs no announcement.
    nonisolated static func isRefusal(_ error: Error) -> Bool {
        #if canImport(FoundationModels)
        if #available(macOS 26.0, *),
           let g = error as? LanguageModelSession.GenerationError,
           case .guardrailViolation = g { return true }
        #endif
        return error.localizedDescription.localizedCaseInsensitiveContains("guardrail")
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

    func success(_ brain: AIBrainID) { success(brain.rawValue) }
    func failure(_ brain: AIBrainID, error: Error) { failure(brain.rawValue, error: error) }

    /// CIRCUIT BREAKER: a brain that keeps failing is dropped from the chains until the user
    /// re-enables it.
    ///
    /// This exists because Apple's Private Cloud Compute reports itself `available` on this macOS
    /// build and then fails every single call with `LanguageModelError -1` — so availability alone
    /// is not evidence a brain works. Without this the app kept routing to it, kept falling through,
    /// and kept posting "keeps failing" notifications for something the user cannot fix.
    ///
    /// The second condition is the one that was missing. Requiring `ok == 0` meant a brain only
    /// ever tripped if it had NEVER worked — so one that succeeded at short transactional prompts
    /// and hard-failed at long ones stayed at the head of the chain for good, burning a doomed call
    /// on every single request. Eight in a row is broken enough, whatever it managed last week.
    func isBroken(_ brain: AIBrainID) -> Bool {
        guard let s = stats[brain.rawValue] else { return false }
        if s.ok == 0 && s.consecutive >= 3 { return true }
        return s.consecutive >= 8
    }

    /// Give a brain another chance (Settings → "Try again").
    func reset(_ brain: AIBrainID) {
        stats[brain.rawValue] = Stat()
        persist()
    }

    func success(_ source: String) {
        var s = stats[source] ?? Stat()
        s.ok += 1; s.consecutive = 0; s.notified = false   // recovery re-arms the alert
        stats[source] = s
        persist()
    }

    /// This brain declined the content. Recorded, never announced, never counted against its
    /// health — and `consecutive` is left alone so a run of refusals can't masquerade as an outage.
    func refusal(_ brain: AIBrainID) {
        var s = stats[brain.rawValue] ?? Stat()
        s.refused += 1
        stats[brain.rawValue] = s
        persist()
    }

    func failure(_ source: String, error: Error) {
        // A refusal reaching here would be a routing bug (the router filters them first), but
        // guard anyway: this is the path that puts a scary notification in front of the user.
        guard !Self.isRefusal(error) else {
            AIBrainID(rawValue: source).map { refusal($0) }
            return
        }
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
            // The error already ends in a full stop of its own — appending another produced
            // "…were triggered.." in the one message whose job is to look considered.
            let why = (s.lastError ?? "unknown").trimmingCharacters(in: .whitespaces)
            let tail = why.hasSuffix(".") || why.hasSuffix("!") || why.hasSuffix("?") ? "" : "."
            Notify.post(AppContainer.shared.mainContext, kind: "warning",
                        subject: "\(name) keeps failing",
                        body: "\(s.consecutive) in a row — \(why)\(tail) Another brain is doing its work, so nothing is stuck. Settings → Intelligence has the details.",
                        priority: 1, feature: .settings)
        }
    }

    static func displayName(_ source: String) -> String {
        AIBrainID(rawValue: source)?.label ?? source
    }
}

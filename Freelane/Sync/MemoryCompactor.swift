import Foundation
import SwiftData

/// Keeps the belief store lean. Memory is a curated asset, not a hoard: the app writes beliefs
/// automatically, and this trims them back so prompts stay small and the picture stays current.
///
/// It no longer builds a "core digest" string. That digest was assembled from `key: value` pairs,
/// which is how raw timestamp keys ended up inside journal questions — and once distilled, a wrong
/// belief became unattributable and impossible to correct. Prompts now read `Memory.brief()`
/// directly: real rows, values only, each one individually deniable by the user.
@MainActor
enum MemoryCompactor {

    /// Due every ~3 days. Cheap no-op otherwise.
    static func runIfDue(_ context: ModelContext, ai: AIManager) async {
        let last = UserDefaults.standard.double(forKey: "memory.compactedAt")
        guard Date.now.timeIntervalSince1970 - last > 3 * 86_400, ai.isReady else { return }
        await consolidate(context, ai: ai)
        UserDefaults.standard.set(Date.now.timeIntervalSince1970, forKey: "memory.compactedAt")
    }

    /// Merge near-duplicates and retire stale guesses. Deliberately conservative, and it operates
    /// on ONE thing only — wordiness. Deciding what is *true* is not a job for a background pass.
    private static func consolidate(_ context: ModelContext, ai: AIManager) async {
        let facts = Memory.live(context)
            .filter { $0.subjectKind == "user" && $0.polarity != "deny" }
            .sorted { $0.updatedAt > $1.updatedAt }
            .prefix(60)
            .map { $0 }
        guard facts.count >= 8 else { return }

        // Duplicate retirement is MECHANICAL — token overlap, no model involved. A model asked to
        // pick what to delete from a user's memory will eventually delete something it shouldn't.
        var kept: [(AIFact, Set<String>)] = []
        var retired = 0
        for f in facts {
            let toks = Memory.contentTokens(f.value)
            if let twin = kept.first(where: { Memory.jaccard($0.1, toks) >= 0.62 }) {
                // Same subject said twice — keep the one we trust more, retire the other.
                let loser = Memory.weight(twin.0) >= Memory.weight(f) ? f : twin.0
                loser.archivedAt = .now; loser.updatedAt = .now
                retired += 1
                continue
            }
            kept.append((f, toks))
        }

        // Guesses that have decayed past usefulness stop being shown at all.
        for f in facts where f.archivedAt == nil && Memory.weight(f) < 0.12 {
            f.archivedAt = .now; f.updatedAt = .now
            retired += 1
        }
        if retired > 0 {
            try? context.save()
            moneyLog.notice("Memory: consolidation retired \(retired, privacy: .public) duplicate/stale beliefs.")
        }
    }
}

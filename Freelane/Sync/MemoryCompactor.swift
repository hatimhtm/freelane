import Foundation
import SwiftData

/// Hermes-style continual memory (after NousResearch's hermes-agent): memory is a CURATED
/// asset, not a hoard. The app already extracts facts automatically; this layer keeps that
/// store lean and cheap to use:
///   1. CONSOLIDATE — merge near-duplicates, rewrite rambling values terse, retire trivia
///      and facts contradicted by newer ones. Archived, never deleted — always reversible.
///   2. DISTILL — compress everything into one ~100-word CORE DIGEST that every prompt can
///      carry instead of re-sending dozens of raw facts each call (surgical context
///      injection: digest always, a few fresh facts for detail).
/// Runs from NightShift on the failover chain — local/on-device brains, zero cloud tokens.
@MainActor
enum MemoryCompactor {

    /// The compact "what I know about my user" block prompts inject. Thread-safe read
    /// (UserDefaults), so non-MainActor prompt builders can use it too.
    nonisolated static var digest: String {
        UserDefaults.standard.string(forKey: "memory.coreDigest") ?? ""
    }

    /// Due every ~3 days. Cheap no-op otherwise.
    static func runIfDue(_ context: ModelContext, ai: AIManager) async {
        let last = UserDefaults.standard.double(forKey: "memory.compactedAt")
        guard Date.now.timeIntervalSince1970 - last > 3 * 86_400, ai.isReady else { return }
        await consolidate(context, ai: ai)
        await rebuildDigest(context, ai: ai)
        UserDefaults.standard.set(Date.now.timeIntervalSince1970, forKey: "memory.compactedAt")
    }

    // MARK: Pass 1 — curate the fact store

    private static func consolidate(_ context: ModelContext, ai: AIManager) async {
        let facts = (((try? context.fetch(FetchDescriptor<AIFact>())) ?? [])
            .filter { $0.archivedAt == nil }
            .sorted { $0.updatedAt > $1.updatedAt }
            .prefix(80)).map { $0 }
        guard facts.count >= 8 else { return }   // nothing worth curating yet
        let listing = facts.enumerated().map { i, f in
            "\(i). [\(f.subjectKind)] \(f.key): \(f.value)"
        }.joined(separator: "\n")
        let prompt = """
        You curate the long-term memory of a personal life-OS. Below is its fact store.
        Compact it WITHOUT losing real information:
        - "rewrite": facts whose value rambles — restate it terse (≤12 words), keeping every
          number, name, and date that matters.
        - "drop": facts that are trivial, expired, or duplicated/contradicted by a NEWER fact
          (lower index = newer).
        Be conservative: when unsure, leave a fact untouched. Reply with ONLY JSON:
        {"rewrite":[{"i":<index>,"value":"<terse value>"}],"drop":[<indexes>]}
        Facts:
        \(listing)
        """
        guard let raw = try? await ai.fast.generate(prompt: prompt),
              let jsonStr = AIJSON.firstObject(in: raw),
              let data = jsonStr.data(using: .utf8),
              let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return }

        var changed = false
        for r in (obj["rewrite"] as? [[String: Any]] ?? []) {
            guard let i = r["i"] as? Int, facts.indices.contains(i),
                  let v = (r["value"] as? String)?.trimmingCharacters(in: .whitespaces),
                  !v.isEmpty, v.count < facts[i].value.count else { continue }   // compaction only, never expansion
            facts[i].value = v
            changed = true
        }
        // GUARDRAILS on drops: archive only, the user's own answers are sacred, and one bad
        // model pass can never gut the store (cap = a quarter of it).
        let dropCap = max(2, facts.count / 4)
        let drops = (obj["drop"] as? [Any] ?? []).compactMap { $0 as? Int }.prefix(dropCap)
        for i in drops {
            guard facts.indices.contains(i), facts[i].source != "user_answered" else { continue }
            facts[i].archivedAt = .now
            changed = true
        }
        if changed { try? context.save() }
    }

    // MARK: Pass 2 — distill the core digest

    private static func rebuildDigest(_ context: ModelContext, ai: AIManager) async {
        let factLines = ((try? context.fetch(FetchDescriptor<AIFact>())) ?? [])
            .filter { $0.archivedAt == nil }
            .sorted { $0.updatedAt > $1.updatedAt }.prefix(60)
            .map { "[\($0.subjectKind)] \($0.key): \($0.value)" }
        let letters = ((try? context.fetch(FetchDescriptor<Letter>())) ?? [])
            .filter { $0.deletedAt == nil }.sorted { $0.createdAt > $1.createdAt }.prefix(10)
        let themes = Array(Set(letters.flatMap { $0.themes })).prefix(10).joined(separator: ", ")
        guard factLines.count >= 6 else { return }   // too thin to distill — keep the old digest
        let facts = factLines.joined(separator: "\n")
        let prompt = """
        Distill everything below into the CORE MEMORY of a personal assistant — the things that
        genuinely matter about its one user. Max 100 words, telegraphic lines, keep every number
        and name that matters, no filler, no headers, plain text only.
        Known facts:
        \(facts)
        Recent journal themes: \(themes.isEmpty ? "(none)" : themes)
        """
        guard let out = try? await ai.fast.generate(prompt: prompt) else { return }
        let clean = out.trimmingCharacters(in: .whitespacesAndNewlines)
        // A digest that's empty, bloated, or obviously raw JSON would poison every prompt.
        guard clean.count >= 40, clean.count <= 900, !clean.contains("{") else { return }
        UserDefaults.standard.set(clean, forKey: "memory.coreDigest")
    }
}

import Foundation
#if canImport(FoundationModels)
import FoundationModels
#endif

/// On-device Apple Intelligence provider (macOS 26 FoundationModels). Used FIRST for fast,
/// private, offline tasks — classification, intent, short summaries, JSON-shape extraction —
/// falling back to Gemini for heavy reasoning or when the on-device model isn't available.
struct FoundationModelProvider: AIProvider {
    var displayName: String { "Apple Intelligence (on-device)" }

    /// Whether the on-device model is usable right now (hardware + Apple Intelligence enabled).
    static var isAvailable: Bool {
        #if canImport(FoundationModels)
        if #available(macOS 26.0, *) {
            switch SystemLanguageModel.default.availability {
            case .available: return true
            default: return false
            }
        }
        #endif
        return false
    }

    func generate(prompt: String) async throws -> String {
        #if canImport(FoundationModels)
        if #available(macOS 26.0, *), Self.isAvailable {
            let session = LanguageModelSession()
            let response = try await session.respond(to: prompt)
            return response.content
        }
        #endif
        throw AIError.onDeviceUnavailable
    }
}

/// A rough, local token meter — there's no exact count for on-device, so we estimate ≈ chars/4
/// for prompt + response, bucketed by source (on-device vs cloud) per ISO week. Enough to answer
/// "how much AI am I using this week?" without any network call.
enum AIUsage {
    static func record(source: String, promptChars: Int, responseChars: Int) {
        let tokens = max(0, (promptChars + responseChars) / 4)
        guard tokens > 0 else { return }
        let key = "ai.usage." + weekKey()
        var dict = (UserDefaults.standard.dictionary(forKey: key) as? [String: Int]) ?? [:]
        dict[source, default: 0] += tokens
        UserDefaults.standard.set(dict, forKey: key)
    }

    /// (source → estimated tokens) for the current week, biggest first.
    static func thisWeek() -> [(source: String, tokens: Int)] {
        let dict = (UserDefaults.standard.dictionary(forKey: "ai.usage." + weekKey()) as? [String: Int]) ?? [:]
        return dict.map { ($0.key, $0.value) }.sorted { $0.1 > $1.1 }
    }
    static func totalThisWeek() -> Int { thisWeek().reduce(0) { $0 + $1.tokens } }

    private static func weekKey() -> String {
        var c = Calendar(identifier: .gregorian); c.timeZone = PHT.zone; c.firstWeekday = 2
        let comps = c.dateComponents([.yearForWeekOfYear, .weekOfYear], from: Date())
        return "\(comps.yearForWeekOfYear ?? 0)-W\(comps.weekOfYear ?? 0)"
    }
}

/// Wraps any provider and records an estimated token count after each call.
struct MeteredProvider: AIProvider {
    let wrapped: AIProvider
    let source: String
    var displayName: String { wrapped.displayName }
    func generate(prompt: String) async throws -> String {
        let out = try await wrapped.generate(prompt: prompt)
        AIUsage.record(source: source, promptChars: prompt.count, responseChars: out.count)
        return out
    }
}

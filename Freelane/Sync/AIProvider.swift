import Foundation
import Observation

/// Abstraction so the AI backend can be swapped (cloud now, local later).
protocol AIProvider {
    var displayName: String { get }
    func generate(prompt: String) async throws -> String
}

enum AIError: LocalizedError {
    case notConfigured, onDeviceUnavailable, http(Int, String), badResponse
    var errorDescription: String? {
        switch self {
        case .notConfigured: return "No Gemini API key set."
        case .onDeviceUnavailable: return "On-device model isn't available on this Mac."
        case .http(let c, let b): return "Gemini error \(c): \(b)"
        case .badResponse: return "Unexpected AI response."
        }
    }
}

enum GeminiTier { case heavy, fast }

/// Tries each brain in order; the first success wins. Every attempt — success or failure —
/// is recorded in BrainHealth (visibility + 3-strikes notification), usage is metered under
/// the source that actually answered, and a dead local server is marked down so it isn't
/// retried on every call (it self-heals on the next probe).
struct FailoverProvider: AIProvider {
    let chain: [(source: String, provider: AIProvider)]
    var displayName: String { chain.first?.provider.displayName ?? "AI" }

    func generate(prompt: String) async throws -> String {
        var lastError: Error = AIError.notConfigured
        for link in chain {
            do {
                let out = try await link.provider.generate(prompt: prompt)
                await BrainHealth.shared.success(link.source)
                AIUsage.record(source: link.source, promptChars: prompt.count, responseChars: out.count)
                return out
            } catch {
                lastError = error
                // "No key set" isn't a brain failing — don't count it, don't alert on it.
                if case AIError.notConfigured = error { continue }
                await BrainHealth.shared.failure(link.source, error: error)
                if link.source == "local", (error as? URLError) != nil {
                    // Transport failure = server's gone, not a bad request → stand down until re-probe.
                    await MainActor.run { LocalLLM.shared.noteTransportFailure() }
                }
            }
        }
        throw lastError
    }
}

/// Resolves the CURRENT best Gemini model names from Google's live model list, so
/// when Google renames/retires models the app keeps working with no code change.
/// Two tiers (heavy = reasoning/narrative, fast = classify/extract), cached, and
/// re-resolved weekly or on a 404. Falls back to sane defaults if the list is
/// unavailable (offline, billing block, etc.).
enum GeminiModels {
    static let defaultHeavy = "gemini-2.5-pro"
    static let defaultFast = "gemini-2.5-flash"

    static func model(_ tier: GeminiTier) -> String {
        let key = tier == .heavy ? "gemini.model.heavy" : "gemini.model.fast"
        return UserDefaults.standard.string(forKey: key) ?? (tier == .heavy ? defaultHeavy : defaultFast)
    }
    private static func setModel(_ tier: GeminiTier, _ name: String) {
        UserDefaults.standard.set(name, forKey: tier == .heavy ? "gemini.model.heavy" : "gemini.model.fast")
    }

    /// Weekly refresh (skips if checked recently). `force` bypasses the throttle.
    static func refresh(apiKey: String, force: Bool = false) async {
        guard !apiKey.isEmpty else { return }
        let last = UserDefaults.standard.double(forKey: "gemini.modelsCheckedAt")
        if !force, Date.now.timeIntervalSince1970 - last < 7 * 86400 { return }
        var req = URLRequest(url: URL(string: "https://generativelanguage.googleapis.com/v1beta/models")!)
        req.setValue(apiKey, forHTTPHeaderField: "x-goog-api-key")   // key in header, not URL query (less log-prone)
        guard let (data, _) = try? await URLSession.shared.data(for: req),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let arr = json["models"] as? [[String: Any]] else { return }   // keep last/defaults on any failure
        let bad = ["embedding", "vision", "aqa", "image", "tts", "audio", "customtools"]
        let names: [String] = arr.compactMap { m in
            guard let name = (m["name"] as? String)?.replacingOccurrences(of: "models/", with: ""),
                  name.hasPrefix("gemini"),
                  (m["supportedGenerationMethods"] as? [String])?.contains("generateContent") == true,
                  !name.hasSuffix("-latest"),               // listed but 404s on generateContent
                  !bad.contains(where: { name.contains($0) }) else { return nil }
            return name
        }
        guard !names.isEmpty else { return }
        if let h = pick(names, mustContain: ["pro"]) { setModel(.heavy, h) }
        if let f = pick(names, mustContain: ["flash-lite"]) ?? pick(names, mustContain: ["flash"]) { setModel(.fast, f) }
        UserDefaults.standard.set(Date.now.timeIntervalSince1970, forKey: "gemini.modelsCheckedAt")
    }

    /// Newest STABLE model matching a needle (a preview is used only if no stable
    /// exists) — newest-stable auto-upgrades as Google ships GA models, without
    /// risking preview names that may not be callable.
    private static func pick(_ names: [String], mustContain: [String]) -> String? {
        let cands = names.filter { n in mustContain.contains { n.contains($0) } }
        let stable = cands.filter { stability($0) == 1 }
        let pool = stable.isEmpty ? cands : stable
        return pool.max { version($0) < version($1) }
    }
    private static func version(_ name: String) -> Double {
        var num = ""; var seenDot = false
        for ch in name {
            if ch.isNumber { num.append(ch) }
            else if ch == "." && !num.isEmpty && !seenDot { num.append("."); seenDot = true }
            else if !num.isEmpty { break }
        }
        return Double(num) ?? 0
    }
    private static func stability(_ name: String) -> Int {
        (name.contains("exp") || name.contains("preview")) ? 0 : 1
    }
}

/// Google Gemini via REST. Self-healing: a 404 (renamed/retired model) re-resolves
/// the model list and retries once, so there's no downtime when Google changes names.
struct GeminiProvider: AIProvider {
    var apiKey: String
    var tier: GeminiTier = .fast
    var displayName: String { "Google Gemini (\(GeminiModels.model(tier)))" }

    func generate(prompt: String) async throws -> String {
        guard !apiKey.isEmpty else { throw AIError.notConfigured }
        let primary = GeminiModels.model(tier)
        do {
            return try await call(model: primary, prompt: prompt)
        } catch AIError.http(404, _) {
            // Model renamed/retired → re-resolve from the live list and retry.
            await GeminiModels.refresh(apiKey: apiKey, force: true)
            let resolved = GeminiModels.model(tier)
            if resolved != primary, let r = try? await call(model: resolved, prompt: prompt) { return r }
            // Last resort: the known-good built-in default, so AI is never fully down.
            let fallback = tier == .heavy ? GeminiModels.defaultHeavy : GeminiModels.defaultFast
            return try await call(model: fallback, prompt: prompt)
        }
    }

    private func call(model: String, prompt: String) async throws -> String {
        let url = URL(string: "https://generativelanguage.googleapis.com/v1beta/models/\(model):generateContent")!
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(apiKey, forHTTPHeaderField: "x-goog-api-key")   // key in header, not URL query (less log-prone)
        req.httpBody = try JSONSerialization.data(withJSONObject: ["contents": [["parts": [["text": prompt]]]]])
        let (data, resp) = try await URLSession.shared.data(for: req)
        guard let http = resp as? HTTPURLResponse else { throw AIError.badResponse }
        guard (200..<300).contains(http.statusCode) else {
            throw AIError.http(http.statusCode, String(String(data: data, encoding: .utf8)?.prefix(240) ?? ""))
        }
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        let candidates = json?["candidates"] as? [[String: Any]]
        let content = candidates?.first?["content"] as? [String: Any]
        let parts = content?["parts"] as? [[String: Any]]
        return (parts?.first?["text"] as? String) ?? ""
    }
}

@MainActor
@Observable
final class AIManager {
    enum Backend: String, CaseIterable, Identifiable { case gemini; var id: String { rawValue } }

    var backend: Backend { didSet { UserDefaults.standard.set(backend.rawValue, forKey: "ai.backend") } }
    // Read from the local file (no keychain prompt). One-time migration from the old
    // Keychain location happens in setKey/init below.
    var apiKey: String { KeyStore.get() ?? "" }
    var lastResult: String?
    var busy = false
    var lastError: String?

    init() {
        // On-device backend was removed (2026-06-08); always Gemini now, so AI can't
        // silently break for a user who once toggled the old "on-device" option.
        backend = .gemini
    }

    func setKey(_ key: String) {
        KeyStore.set(key.isEmpty ? nil : key)         // local file — no keychain prompt
        let k = key
        Task { await GeminiModels.refresh(apiKey: k, force: true) }   // resolve models for the new key
    }

    /// Prefer the on-device model for fast tasks (private, free, offline). On by default.
    var preferOnDevice: Bool {
        get { UserDefaults.standard.object(forKey: "ai.preferOnDevice") as? Bool ?? true }
        set { UserDefaults.standard.set(newValue, forKey: "ai.preferOnDevice") }
    }
    /// May background jobs fall back to Gemini? OFF by default: cloud tokens are spent only
    /// when the user explicitly chats. Background work (tagging, curiosity questions,
    /// summaries) runs on the local model / Apple's on-device model — or simply waits and
    /// NightShift catches up once a free brain is available.
    /// Stored (not computed) so @Observable tracks it and the Settings toggle refreshes live.
    var allowCloudFallback: Bool = UserDefaults.standard.object(forKey: "ai.allowCloudFallback") as? Bool ?? false {
        didSet { UserDefaults.standard.set(allowCloudFallback, forKey: "ai.allowCloudFallback") }
    }

    /// Could a BACKGROUND prompt actually reach Google's cloud? Only if the user opted into
    /// cloud fallback AND a key is set. Drives redaction: text is scrubbed of sensitive terms
    /// exactly when it might leave the machine — local Ollama and Apple's on-device model are
    /// both on-device and need no scrubbing. (The explicit chat path gates cloud separately.)
    var cloudReachable: Bool { allowCloudFallback && !apiKey.isEmpty }

    /// True if SOME provider can run a background task. Cloud counts only when the user has
    /// explicitly allowed background fallback.
    var isReady: Bool {
        LocalLLM.shared.ready || (preferOnDevice && FoundationModelProvider.isAvailable)
            || (allowCloudFallback && !apiKey.isEmpty)
    }

    /// Fast tier (most calls: classify / extract / short summary): a FAILOVER CHAIN —
    /// local Gemma first (free, private, no context cap, no guardrail refusals), then Apple's
    /// on-device model. Gemini joins the chain ONLY if background fallback is enabled.
    /// A job logged before the local brain wakes up — or while it's down — simply lands on
    /// the next brain; an empty chain throws .notConfigured and the job skips cleanly.
    var provider: AIProvider {
        var chain: [(String, AIProvider)] = []
        if LocalLLM.shared.ready { chain.append(("local", OllamaProvider())) }
        if preferOnDevice, FoundationModelProvider.isAvailable { chain.append(("on-device", FoundationModelProvider())) }
        if allowCloudFallback, !apiKey.isEmpty { chain.append(("cloud", GeminiProvider(apiKey: apiKey, tier: .fast))) }
        return FailoverProvider(chain: chain)
    }
    var fast: AIProvider { provider }

    /// Heavy tier (reasoning / narrative): local first here too — slower than Gemini, but
    /// free and private; "slow is better than burning tokens". On-device backs it up, and
    /// Gemini only joins by explicit opt-in.
    var heavy: AIProvider {
        var chain: [(String, AIProvider)] = []
        if LocalLLM.shared.ready { chain.append(("local", OllamaProvider())) }
        if FoundationModelProvider.isAvailable { chain.append(("on-device", FoundationModelProvider())) }
        if allowCloudFallback, !apiKey.isEmpty { chain.append(("cloud", GeminiProvider(apiKey: apiKey, tier: .heavy))) }
        return FailoverProvider(chain: chain)
    }

    func refreshModels() async { await GeminiModels.refresh(apiKey: apiKey) }

    /// "Test connection" in the Gemini card tests GEMINI specifically (the local model has
    /// its own status dot) — even when cloud is excluded from the background chains.
    func test() async {
        busy = true; lastError = nil; lastResult = nil
        defer { busy = false }
        do { lastResult = try await GeminiProvider(apiKey: apiKey, tier: .fast)
            .generate(prompt: "Reply with exactly: Freelane AI is connected.") }
        catch { lastError = error.localizedDescription }
    }
}

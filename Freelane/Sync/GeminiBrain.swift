import Foundation
#if canImport(FoundationModels)
import FoundationModels
#endif

/// Google's Gemini, over the REST API — the app's writing brain.
///
/// This replaces a 4.3 GB Qwen3-8B running locally through MLX. That model was chosen so the app
/// would owe nothing to a network, and on the small structured jobs it was fine. On the one job
/// that matters most it was not: handed a page of real context it invented a team the user has
/// never had, wrote "What else is in your purchasing history right now?" as a journalling
/// question, and took long enough that questions had to be generated a fortnight ahead to hide the
/// wait. Against the same prompt and the same entries, Gemini answers in four seconds with
/// "Were you able to get the money for the fridge?".
///
/// The trade is real and was made deliberately: journal entries now leave the Mac. Every piece of
/// copy in the app that claimed otherwise has been rewritten rather than quietly left standing.
enum GeminiConfig {
    static let keychainKey = "gemini.apiKey"

    /// Models the app offers. `flash` is the default because this app makes many small calls and
    /// flash answers in ~4s; `pro` is there for anyone who would rather wait for a better sentence.
    enum Tier: String, CaseIterable {
        case flashLite = "gemini-3.5-flash-lite"
        case flash     = "gemini-3.5-flash"
        case pro       = "gemini-pro-latest"

        var label: String {
            switch self {
            case .flashLite: return "Fast (flash-lite)"
            case .flash:     return "Balanced (flash)"
            case .pro:       return "Best (pro)"
            }
        }
    }

    static var apiKey: String? {
        get { Keychain.get(keychainKey).flatMap { $0.isEmpty ? nil : $0 } }
        set { Keychain.set(newValue?.trimmingCharacters(in: .whitespacesAndNewlines), for: keychainKey) }
    }
    static var hasKey: Bool { apiKey != nil }

    /// The model used for anything a person will read. Stored as a raw string so an unknown value
    /// from a future build degrades to the default instead of crashing.
    static var smartModel: Tier {
        get { Tier(rawValue: UserDefaults.standard.string(forKey: "gemini.model") ?? "") ?? .flash }
        set { UserDefaults.standard.set(newValue.rawValue, forKey: "gemini.model") }
    }
    /// Cheap, constant work — tagging a spend, reading a receipt. Always the lite tier: these run
    /// dozens of times a day and none of their output is ever read as prose.
    static var fastModel: Tier { .flashLite }
}

enum GeminiError: LocalizedError {
    case noKey
    case http(Int, String)
    case empty
    case blocked(String)

    var errorDescription: String? {
        switch self {
        case .noKey:               return "No Gemini API key yet — add one in Settings → Intelligence."
        case .http(let code, let m):
            // 429 and 403 are the two a person can actually act on, so they say what to do.
            if code == 429 { return "Gemini is rate-limited right now. It'll work again shortly." }
            if code == 403 { return "Gemini rejected the API key. Check it in Settings → Intelligence." }
            return "Gemini returned \(code): \(m)"
        case .empty:               return "Gemini returned an empty answer."
        case .blocked(let reason): return "Gemini declined this request (\(reason))."
        }
    }
}

#if canImport(FoundationModels)

@available(macOS 26.0, *)
struct GeminiBrain: AIBrain {
    /// Which tier this instance talks to — set by the router, not by the caller.
    var tier: GeminiConfig.Tier

    let id = AIBrainID.cloud
    var displayName: String { "Gemini" }
    var isAvailable: Bool { GeminiConfig.hasKey }

    // MARK: Prose

    func text(_ req: AIRequest) async throws -> String { try await text(req, tools: []) }

    /// Tools are ignored: the Apple brains can call back into the app mid-generation, and Gemini
    /// could too, but every tool this app exposes reads state that `StateSnapshot` already puts in
    /// the prompt. A round trip to fetch what was already sent is latency for nothing.
    func text(_ req: AIRequest, tools: [any Tool]) async throws -> String {
        try await generate(req, json: false)
    }

    // MARK: Structured

    /// Gemini's JSON mode, decoded through the same bridge the MLX brain used: text → JSON →
    /// `GeneratedContent` → the `@Generable` type. That path is proven against every schema in the
    /// app, so nothing downstream had to change to accept a different brain.
    func object<T: Generable & Sendable>(_ type: T.Type, _ req: AIRequest, jsonShape: String) async throws -> T {
        let shaped = AIRequest(
            req.prompt + """


            Reply with ONE JSON object and nothing else.
            Its shape: \(jsonShape)
            Every value must be real content for this request. Never copy the shape description itself.
            """,
            instructions: req.instructions,
            temperature: req.temperature,
            maxTokens: req.maxTokens)

        for pass in 0..<2 {
            let raw = try await generate(shaped, json: true)
            if let json = AIJSON.firstObject(in: raw),
               let content = try? GeneratedContent(json: json),
               let value = try? T(content) {
                return value
            }
            // JSON mode makes this rare, but a model can still answer with a bare array or a
            // string. One retry at low temperature, then give up so the router can fall through.
            guard pass == 0 else { break }
        }
        throw AIError.badResponse(id)
    }

    // MARK: The call

    private func generate(_ req: AIRequest, json: Bool) async throws -> String {
        guard let key = GeminiConfig.apiKey else { throw GeminiError.noKey }

        var body: [String: Any] = [
            "contents": [["role": "user", "parts": [["text": req.prompt]]]],
        ]
        if let instructions = req.instructions, !instructions.isEmpty {
            body["systemInstruction"] = ["parts": [["text": instructions]]]
        }
        var cfg: [String: Any] = [:]
        if let t = req.temperature { cfg["temperature"] = t }
        if let m = req.maxTokens { cfg["maxOutputTokens"] = m }
        if json { cfg["responseMimeType"] = "application/json" }
        if !cfg.isEmpty { body["generationConfig"] = cfg }

        // The key travels as a header, not in the URL — a query-string key ends up in any proxy
        // log and in crash reports.
        var url = URLComponents(string: "https://generativelanguage.googleapis.com/v1beta/models/\(tier.rawValue):generateContent")!
        url.queryItems = nil
        var request = URLRequest(url: url.url!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(key, forHTTPHeaderField: "x-goog-api-key")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        request.timeoutInterval = 45

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw GeminiError.empty }
        guard (200..<300).contains(http.statusCode) else {
            let msg = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])
                .flatMap { ($0?["error"] as? [String: Any])?["message"] as? String } ?? ""
            throw GeminiError.http(http.statusCode, String(msg.prefix(140)))
        }

        guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw GeminiError.empty
        }
        // A safety block comes back 200 with no candidate, so it has to be read out explicitly or
        // it looks like an empty answer.
        if let feedback = root["promptFeedback"] as? [String: Any],
           let reason = feedback["blockReason"] as? String {
            throw GeminiError.blocked(reason)
        }
        guard let candidates = root["candidates"] as? [[String: Any]], let first = candidates.first else {
            throw GeminiError.empty
        }
        if let finish = first["finishReason"] as? String, finish == "SAFETY" || finish == "PROHIBITED_CONTENT" {
            throw GeminiError.blocked(finish)
        }
        let parts = (first["content"] as? [String: Any])?["parts"] as? [[String: Any]] ?? []
        let text = parts.compactMap { $0["text"] as? String }.joined()
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw GeminiError.empty }
        return trimmed
    }
}

#endif

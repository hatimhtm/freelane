import Foundation
import Observation
#if canImport(FoundationModels)
import FoundationModels
#endif

// MARK: - The brains
//
//   cloud       Gemini, over the REST API. The writing brain: journal questions, letters, chat,
//               anything a person reads. Needs a network and an API key, and this is the brain
//               that sees journal entries — which is why the app no longer claims your writing
//               never leaves the Mac.
//   on-device   Apple's system foundation model. Instant, free, offline. Small: fine at tagging a
//               spend, weak at writing, and its safety filter refuses personal writing outright.
//               The offline fallback for cheap structured work, never for the journal.
//   private     Apple Private Cloud Compute. Wired up, off by default — it reports itself available
//               on this macOS build and then fails every call.
//
// Three rules hold this together, each from a specific failure:
//
//  1. STRUCTURE IS ENFORCED, NOT REQUESTED. Apple's brains decode against a `@Generable` schema.
//     Gemini is held to it by JSON mode plus the same parse-and-bridge the MLX brain used.
//  2. A BRAIN THAT FAILS IS VISIBLE. Every attempt is recorded. A feature that produced nothing
//     says so, naming the brain — silent empty states are what made the app feel broken.
//  3. A REFUSAL IS NOT A FAILURE. A brain declining content has not malfunctioned; the fall-through
//     to the next one is the whole remedy, and it is not worth a notification.
//
// Retired: a 4.3 GB Qwen3-8B via MLX. It owed nothing to a network, and on structured work it was
// adequate — but it invented a team the user has never had, wrote "What else is in your purchasing
// history right now?" as a journalling question, and was slow enough that questions had to be
// generated a fortnight ahead to hide the wait.

/// Which brain answered. Also the key used for health and usage accounting.
enum AIBrainID: String, Sendable, CaseIterable {
    /// `local` is retired — the 4.3 GB MLX model it named was removed in 2.14. The case survives
    /// so stored health/usage rows keyed by its raw value still decode instead of being dropped.
    case onDevice, privateCloud, local, cloud

    var label: String {
        switch self {
        case .onDevice:     return "On-device"
        case .privateCloud: return "Private Cloud"
        case .local:        return "Local model"
        case .cloud:        return "Gemini"
        }
    }
    /// Shown when a feature has to explain which brain did the work.
    var shortLabel: String {
        switch self {
        case .onDevice:     return "on-device"
        case .privateCloud: return "private cloud"
        case .local:        return "local model"
        case .cloud:        return "Gemini"
        }
    }
    /// Retired brains stay out of every chain and every status display.
    var isRetired: Bool { self == .local }
}

enum AIError: LocalizedError {
    case noBrainAvailable
    case brainUnavailable(AIBrainID, String)
    case badResponse(AIBrainID)
    case quotaExhausted

    var errorDescription: String? {
        switch self {
        case .noBrainAvailable:
            return "No AI brain is available. Add a Gemini API key in Settings → Intelligence."
        case .brainUnavailable(let id, let why):
            return "\(id.label) isn't available: \(why)"
        case .badResponse(let id):
            return "\(id.label) returned something unusable."
        case .quotaExhausted:
            return "Private Cloud quota is used up for now."
        }
    }
}

/// One unit of work for a brain. Instructions are the standing role (cached across calls by the
/// session); the prompt is the request. Splitting them matters: Apple's models treat instructions
/// as higher-trust than prompt text, which is the correct place for the app's hard rules.
struct AIRequest: Sendable {
    var instructions: String?
    var prompt: String
    var temperature: Double?
    var maxTokens: Int?

    init(_ prompt: String, instructions: String? = nil, temperature: Double? = nil, maxTokens: Int? = nil) {
        self.prompt = prompt
        self.instructions = instructions
        self.temperature = temperature
        self.maxTokens = maxTokens
    }
}

#if canImport(FoundationModels)

@available(macOS 26.0, *)
protocol AIBrain: Sendable {
    var id: AIBrainID { get }
    var displayName: String { get }
    var isAvailable: Bool { get }
    /// Free-form prose (letters, chat answers).
    func text(_ req: AIRequest) async throws -> String
    /// Prose, with tools the model may call for exact figures before answering.
    func text(_ req: AIRequest, tools: [any Tool]) async throws -> String
    /// A value of an exact shape. On Apple brains this is schema-constrained decoding; the reply
    /// physically cannot violate `T`.
    func object<T: Generable & Sendable>(_ type: T.Type, _ req: AIRequest, jsonShape: String) async throws -> T
}

@available(macOS 26.0, *)
extension AIBrain {
    /// Brains without tool support just answer from the prompt — their answers are grounded in the
    /// snapshot the caller already built, rather than in live lookups.
    func text(_ req: AIRequest, tools: [any Tool]) async throws -> String { try await text(req) }
}

// MARK: - Apple brains

/// Shared body for the two Apple brains — they differ only in which model the session is built on.
@available(macOS 26.0, *)
private enum AppleRun {
    static func options(_ req: AIRequest) -> GenerationOptions {
        GenerationOptions(temperature: req.temperature, maximumResponseTokens: req.maxTokens)
    }
}

@available(macOS 26.0, *)
struct OnDeviceBrain: AIBrain {
    let id = AIBrainID.onDevice
    var displayName: String { "Apple Intelligence (on-device)" }

    static var availability: SystemLanguageModel.Availability { SystemLanguageModel.default.availability }
    static var isReady: Bool { if case .available = availability { return true }; return false }
    /// Why it can't be used, in words a person can act on.
    static var unavailableReason: String? {
        guard case .unavailable(let r) = availability else { return nil }
        switch r {
        case .deviceNotEligible:            return "this Mac doesn't support Apple Intelligence"
        case .appleIntelligenceNotEnabled:  return "Apple Intelligence is turned off in System Settings"
        case .modelNotReady:                return "the model is still downloading"
        @unknown default:                   return "it isn't ready"
        }
    }
    var isAvailable: Bool { Self.isReady }

    func text(_ req: AIRequest) async throws -> String { try await text(req, tools: []) }

    func text(_ req: AIRequest, tools: [any Tool]) async throws -> String {
        guard isAvailable else { throw AIError.brainUnavailable(id, Self.unavailableReason ?? "unavailable") }
        let session = LanguageModelSession(model: SystemLanguageModel.default, tools: tools, instructions: req.instructions)
        return try await session.respond(to: req.prompt, options: AppleRun.options(req)).content
    }

    func object<T: Generable & Sendable>(_ type: T.Type, _ req: AIRequest, jsonShape: String) async throws -> T {
        guard isAvailable else { throw AIError.brainUnavailable(id, Self.unavailableReason ?? "unavailable") }
        let session = LanguageModelSession(model: SystemLanguageModel.default, instructions: req.instructions)
        return try await session.respond(to: req.prompt, generating: T.self, options: AppleRun.options(req)).content
    }
}

/// Apple Private Cloud Compute — the smart tier. Same privacy contract as on-device (Apple cannot
/// read or retain what is sent), so unlike the third-party cloud this replaced, personal context
/// does NOT have to be stripped before it goes here.
@available(macOS 27.0, *)
struct PrivateCloudBrain: AIBrain {
    let id = AIBrainID.privateCloud
    var displayName: String { "Apple Private Cloud Compute" }

    static var model: PrivateCloudComputeLanguageModel { PrivateCloudComputeLanguageModel() }
    static var isReady: Bool { model.isAvailable }
    static var unavailableReason: String? {
        guard case .unavailable(let r) = model.availability else { return nil }
        switch r {
        case .deviceNotEligible: return "this Mac isn't eligible"
        case .systemNotReady:    return "the system isn't ready yet"
        @unknown default:        return "it isn't ready"
        }
    }
    var isAvailable: Bool { Self.isReady }

    func text(_ req: AIRequest) async throws -> String { try await text(req, tools: []) }

    func text(_ req: AIRequest, tools: [any Tool]) async throws -> String {
        guard isAvailable else { throw AIError.brainUnavailable(id, Self.unavailableReason ?? "unavailable") }
        let session = LanguageModelSession(model: Self.model, tools: tools, instructions: req.instructions)
        return try await session.respond(to: req.prompt, options: AppleRun.options(req)).content
    }

    func object<T: Generable & Sendable>(_ type: T.Type, _ req: AIRequest, jsonShape: String) async throws -> T {
        guard isAvailable else { throw AIError.brainUnavailable(id, Self.unavailableReason ?? "unavailable") }
        let session = LanguageModelSession(model: Self.model, instructions: req.instructions)
        return try await session.respond(to: req.prompt, generating: T.self, options: AppleRun.options(req)).content
    }
}

// MARK: - Failover

/// Tries each brain in order and returns the first real answer. Records every attempt so the app
/// can tell the user which brain worked and which didn't, instead of rendering an empty box.
@available(macOS 26.0, *)
struct AIRouter: Sendable {
    let chain: [any AIBrain]
    var displayName: String { chain.first?.displayName ?? "AI" }
    var isAvailable: Bool { chain.contains { $0.isAvailable } }

    func text(_ req: AIRequest, tools: [any Tool] = []) async throws -> String {
        try await attempt { brain in
            let out = try await brain.text(req, tools: tools)
            let trimmed = out.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { throw AIError.badResponse(brain.id) }
            AIUsage.record(brain: brain.id, promptChars: req.prompt.count, responseChars: trimmed.count)
            return trimmed
        }
    }

    func object<T: Generable & Sendable>(_ type: T.Type, _ req: AIRequest, jsonShape: String) async throws -> T {
        try await attempt { brain in
            let out = try await brain.object(T.self, req, jsonShape: jsonShape)
            AIUsage.record(brain: brain.id, promptChars: req.prompt.count, responseChars: 400)
            return out
        }
    }

    /// The failover loop. A brain that is simply *absent* (no local model downloaded, Apple
    /// Intelligence off) is skipped without being counted as a failure — otherwise the health
    /// indicator would cry wolf about a brain the user never enabled.
    private func attempt<R: Sendable>(_ body: @Sendable (any AIBrain) async throws -> R) async throws -> R {
        var lastError: Error = AIError.noBrainAvailable
        for brain in chain {
            guard brain.isAvailable else { continue }
            do {
                let r = try await body(brain)
                await BrainHealth.shared.success(brain.id)
                return r
            } catch {
                lastError = error
                // A brain that DECLINED the content hasn't malfunctioned — the fall-through to the
                // next brain is the correct and complete response. Scoring it as a failure is what
                // produced "On-device keeps failing" for journal entries Apple's safety filter will
                // never accept, on a loop, about something the user cannot change.
                if BrainHealth.isRefusal(error) {
                    await BrainHealth.shared.refusal(brain.id)
                } else {
                    await BrainHealth.shared.failure(brain.id, error: error)
                }
            }
        }
        throw lastError
    }
}

// MARK: - Usage metering

/// A rough local token meter — there is no exact count for on-device, so we estimate ≈ chars/4,
/// bucketed by brain per ISO week. Enough to answer "how much AI am I using?" with no network call.
enum AIUsage {
    static func record(brain: AIBrainID, promptChars: Int, responseChars: Int) {
        let tokens = max(0, (promptChars + responseChars) / 4)
        guard tokens > 0 else { return }
        let key = "ai.usage." + weekKey()
        var dict = (UserDefaults.standard.dictionary(forKey: key) as? [String: Int]) ?? [:]
        dict[brain.rawValue, default: 0] += tokens
        UserDefaults.standard.set(dict, forKey: key)
    }

    /// (brain → estimated tokens) for the current week, biggest first.
    static func thisWeek() -> [(brain: AIBrainID, tokens: Int)] {
        let dict = (UserDefaults.standard.dictionary(forKey: "ai.usage." + weekKey()) as? [String: Int]) ?? [:]
        return dict.compactMap { k, v in AIBrainID(rawValue: k).map { ($0, v) } }.sorted { $0.1 > $1.1 }
    }
    static func totalThisWeek() -> Int { thisWeek().reduce(0) { $0 + $1.tokens } }

    private static func weekKey() -> String {
        var c = Calendar(identifier: .gregorian); c.timeZone = PHT.zone; c.firstWeekday = 2
        let comps = c.dateComponents([.yearForWeekOfYear, .weekOfYear], from: Date())
        return "\(comps.yearForWeekOfYear ?? 0)-W\(comps.weekOfYear ?? 0)"
    }
}

// MARK: - The manager the app talks to

@MainActor
@Observable
final class AIManager {
    init() {}

    // MARK: Availability

    var cloudReady: Bool { GeminiConfig.hasKey }
    var onDeviceReady: Bool { if #available(macOS 26.0, *) { return OnDeviceBrain.isReady } else { return false } }
    var privateCloudReady: Bool { if #available(macOS 27.0, *) { return PrivateCloudBrain.isReady } else { return false } }

    /// True when SOMETHING can answer. Every AI feature checks this before it renders a control.
    var isReady: Bool { cloudReady || onDeviceReady || privateCloudReady }

    /// Why nothing is available — shown verbatim in empty states so a dead control always explains
    /// itself. (The old build just disabled the button and left the user guessing.)
    var unavailableReason: String {
        if !cloudReady {
            return "Add your Gemini API key in Settings → Intelligence — it's what writes your questions."
        }
        if #available(macOS 26.0, *), let r = OnDeviceBrain.unavailableReason {
            return "Apple Intelligence is unavailable — \(r)."
        }
        return "No AI brain is available yet. Add a Gemini API key in Settings → Intelligence."
    }

    /// May work be sent to Apple Private Cloud Compute?
    ///
    /// OFF by default, and that is a finding rather than a preference: on this macOS build PCC
    /// reports itself available to a locally-signed app and then fails every call with
    /// `LanguageModelError -1`. It is left wired up behind a switch so it costs nothing to turn on
    /// the day Apple opens it, but the app does not depend on it and does not pester about it.
    var usePrivateCloud: Bool = UserDefaults.standard.object(forKey: "ai.usePrivateCloud") as? Bool ?? false {
        didSet { UserDefaults.standard.set(usePrivateCloud, forKey: "ai.usePrivateCloud") }
    }

    /// Should this brain be in a chain at all? Excludes anything the circuit breaker has tripped,
    /// so a brain that is present-but-broken can't sit at the head of the chain wasting every call.
    private func usable(_ id: AIBrainID) -> Bool { !id.isRetired && !BrainHealth.shared.isBroken(id) }

    // MARK: Chains

    /// Cheap, frequent, structural work — tagging, extraction, reading a receipt.
    ///
    /// Apple's on-device model LEADS here, and only here. It is instant and free, these calls
    /// happen dozens of times a day, and none of their output is read as prose — so its weakness at
    /// writing costs nothing and its being free costs nothing. Gemini backs it up, which also means
    /// this tier keeps working with no network right up until Apple's model declines something.
    var fast: AIRouter {
        guard #available(macOS 26.0, *) else { return AIRouter(chain: []) }
        var chain: [any AIBrain] = []
        if usable(.onDevice) { chain.append(OnDeviceBrain()) }
        if usable(.cloud), GeminiConfig.hasKey { chain.append(GeminiBrain(tier: GeminiConfig.fastModel)) }
        if usePrivateCloud, usable(.privateCloud), #available(macOS 27.0, *) { chain.append(PrivateCloudBrain()) }
        return AIRouter(chain: chain)
    }

    /// Anything a person will actually read — questions, letters, chat. Gemini leads, because this
    /// is the whole reason it's here.
    var smart: AIRouter {
        guard #available(macOS 26.0, *) else { return AIRouter(chain: []) }
        var chain: [any AIBrain] = []
        if usable(.cloud), GeminiConfig.hasKey { chain.append(GeminiBrain(tier: GeminiConfig.smartModel)) }
        if usePrivateCloud, usable(.privateCloud), #available(macOS 27.0, *) { chain.append(PrivateCloudBrain()) }
        if usable(.onDevice) { chain.append(OnDeviceBrain()) }
        return AIRouter(chain: chain)
    }

    /// Anything that reads what you WROTE about yourself — journal entries, reflections, moods.
    ///
    /// Deliberately EXCLUDES Apple's on-device model rather than merely demoting it. Its safety
    /// filter cannot be configured and it throws `guardrailViolation` on first-person emotional
    /// writing, which is what a journal is — so leaving it on the end of this chain only means a
    /// guaranteed refusal on the way to somewhere useful. Offline, journal analysis simply waits.
    var personal: AIRouter {
        guard #available(macOS 26.0, *) else { return AIRouter(chain: []) }
        var chain: [any AIBrain] = []
        if usable(.cloud), GeminiConfig.hasKey { chain.append(GeminiBrain(tier: GeminiConfig.smartModel)) }
        if usePrivateCloud, usable(.privateCloud), #available(macOS 27.0, *) { chain.append(PrivateCloudBrain()) }
        return AIRouter(chain: chain)
    }

    /// Which brain a smart request would hit right now — for the status line in Settings.
    var smartLead: AIBrainID? {
        if cloudReady, usable(.cloud) { return .cloud }
        if usePrivateCloud, privateCloudReady, usable(.privateCloud) { return .privateCloud }
        if onDeviceReady, usable(.onDevice) { return .onDevice }
        return nil
    }
}

#endif

import Foundation
import Observation
#if canImport(FoundationModels)
import FoundationModels
#endif
#if canImport(MLXLMCommon)
import MLX
import MLXLMCommon
import MLXLLM
import Hub
#endif

// MARK: - The local brain
//
// A quantised Qwen3-4B running IN THIS PROCESS through MLX — no server, no separate app, no
// Ollama. The weights are fetched once from Hugging Face into Application Support and loaded
// straight onto the GPU; after that the brain works with the network off and has no quota.
//
// It exists for exactly two moments: no internet, and Private Cloud quota spent. Those are the
// moments the old build silently produced nothing, which is most of what "it breaks" meant.
//
// Structured output is the interesting part. This model has no schema-constrained decoding, so it
// is asked for a shape in words and its reply is parsed into the SAME `@Generable` type the Apple
// brains produce — via `GeneratedContent(json:)`. One type, one validation path, two very
// different engines underneath. Callers never learn which one answered.

/// Which weights we run.
///
/// Qwen3-8B at 4-bit: ~4.6 GB on disk, ~5.5 GB resident while generating, 25-35 tok/s on an M3 Pro.
/// It is the app's ONLY writing brain, which is why it isn't the 4B — Apple's Private Cloud Compute
/// turned out to be unavailable to a locally-signed app on this macOS build (four calls, four
/// `LanguageModelError -1`, zero successes), so everything a person reads is written here.
///
/// Sized deliberately against an 18 GB machine that also runs Xcode: 8 GB-class models (Gemma 3 12B,
/// Qwen3 14B) write slightly warmer prose but leave too little headroom and halve the speed. This is
/// the largest model that never makes the Mac feel slower.
enum LocalModelSpec {
    static let repoID = "mlx-community/Qwen3-8B-4bit"
    static let displayName = "Qwen3 8B"
    static let approxBytes: Int64 = 4_600_000_000
    static var approxSizeLabel: String {
        ByteCountFormatter.string(fromByteCount: approxBytes, countStyle: .file)
    }
}

@MainActor
@Observable
final class LocalModelStore {
    static let shared = LocalModelStore()

    enum State: Equatable {
        case unavailable(String)     // MLX not compiled in
        case notInstalled
        /// Downloaded but not resident. Distinct from `notInstalled` on purpose: without it,
        /// "Free up memory" left the card saying "about 4.6 GB, downloaded once and then yours"
        /// beside a Download button, for weights already sitting on disk — so the honest reading
        /// was that the button had just deleted a multi-gigabyte download.
        case onDisk
        case downloading(Double)     // 0...1
        case loading                 // weights on disk, moving onto the GPU
        case ready
        case failed(String)

        var isReady: Bool { self == .ready }
    }

    private(set) var state: State = .notInstalled
    /// Set once the weights are resident; nil otherwise. `AIManager` reads this to decide whether
    /// the local link belongs in a chain at all.
    private(set) var brain: (any AIBrain)?

    private var loadTask: Task<Void, Never>?

    private init() {
        #if canImport(MLXLMCommon)
        state = Self.weightsOnDisk ? .onDisk : .notInstalled
        // Weights already downloaded from a previous run → bring them up quietly in the background
        // so the first AI call of the session doesn't pay the load cost.
        if Self.weightsOnDisk, autoLoad { install() }
        #else
        state = .unavailable("This build was compiled without the local model.")
        #endif
    }

    var isReady: Bool { state.isReady && brain != nil }

    /// Has the user ever installed it? Kept in defaults so Settings can offer "Download" vs
    /// "Loading…" correctly before any file check.
    var autoLoad: Bool {
        get { UserDefaults.standard.bool(forKey: "ai.local.installed") }
        set { UserDefaults.standard.set(newValue, forKey: "ai.local.installed") }
    }

    // MARK: Storage

    /// Weights live beside the store in Application Support — NOT in Caches, which is where the
    /// MLX default would have put them and where macOS is free to delete a 2.3 GB download under
    /// disk pressure. Excluded from backups: they're re-downloadable, and they'd bloat Time Machine.
    static var modelsDir: URL {
        var dir = AppPaths.root.appendingPathComponent("Models", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? dir.setResourceValues(values)
        return dir
    }

    static var weightsOnDisk: Bool {
        let repo = modelsDir.appending(path: "models").appending(path: LocalModelSpec.repoID)
        return FileManager.default.fileExists(atPath: repo.appending(path: "config.json").path)
    }

    var installedBytes: Int64 { Self.bytes(at: Self.modelsDir.appending(path: "models")) }

    static func bytes(at url: URL) -> Int64 {
        guard let e = FileManager.default.enumerator(at: url, includingPropertiesForKeys: [.fileSizeKey]) else { return 0 }
        var total: Int64 = 0
        for case let fileURL as URL in e {
            total += Int64((try? fileURL.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0)
        }
        return total
    }

    /// Delete every downloaded model that ISN'T the one we're about to run.
    ///
    /// Hugging Face lays repos out as `models/<org>/<name>`, so this walks one level deep and
    /// removes any directory whose path isn't the current `repoID`. Called on every install, which
    /// also means changing `LocalModelSpec.repoID` in a future version cleans up after itself with
    /// no migration code.
    @discardableResult
    static func removeOtherModels() -> Int64 {
        let root = modelsDir.appending(path: "models")
        let fm = FileManager.default
        guard let orgs = try? fm.contentsOfDirectory(at: root, includingPropertiesForKeys: nil) else { return 0 }
        let keep = root.appending(path: LocalModelSpec.repoID).standardizedFileURL.path
        var freed: Int64 = 0
        for org in orgs {
            guard let repos = try? fm.contentsOfDirectory(at: org, includingPropertiesForKeys: nil) else { continue }
            for repo in repos where repo.standardizedFileURL.path != keep {
                let size = bytes(at: repo)
                if (try? fm.removeItem(at: repo)) != nil {
                    freed += size
                    moneyLog.notice("Local model: removed superseded weights, freed \(size / 1_000_000, privacy: .public) MB.")
                }
            }
            // Tidy the org folder if it's now empty.
            if let left = try? fm.contentsOfDirectory(at: org, includingPropertiesForKeys: nil), left.isEmpty {
                try? fm.removeItem(at: org)
            }
        }
        return freed
    }

    // MARK: Lifecycle

    /// Download (if needed) and load the weights. Safe to call repeatedly — a run in flight wins.
    func install() {
        #if canImport(MLXLMCommon)
        guard loadTask == nil, !isReady else { return }
        autoLoad = true
        state = Self.weightsOnDisk ? .loading : .downloading(0)
        loadTask = Task { [weak self] in
            do {
                // Any previously-downloaded model is deleted before this one lands. Weights are
                // multi-gigabyte and there is never a reason to keep a superseded set — leaving the
                // old 4B beside the new 8B would silently cost 7 GB on a machine that doesn't have
                // it to spare.
                Self.removeOtherModels()

                // A quantised model needs headroom beyond its file size for the KV cache. Without a
                // cap MLX will happily push the GPU into swap and drag the whole Mac down — which
                // is the exact complaint that started this rewrite.
                MLX.GPU.set(cacheLimit: 256 * 1024 * 1024)

                let hub = HubApi(downloadBase: Self.modelsDir)
                let container = try await loadModelContainer(
                    hub: hub,
                    configuration: ModelConfiguration(id: LocalModelSpec.repoID)
                ) { progress in
                    Task { @MainActor [weak self] in
                        guard let self, case .downloading = self.state else { return }
                        self.state = .downloading(progress.fractionCompleted)
                    }
                }
                await MainActor.run {
                    guard let self else { return }
                    self.brain = LocalBrain(container: container)
                    self.state = .ready
                    self.loadTask = nil
                }
            } catch {
                await MainActor.run {
                    guard let self else { return }
                    self.brain = nil
                    self.state = .failed(String(error.localizedDescription.prefix(180)))
                    self.loadTask = nil
                }
            }
        }
        #endif
    }

    /// Drop the weights from memory but keep them on disk (Settings → "Unload").
    func unload() {
        loadTask?.cancel(); loadTask = nil
        brain = nil
        state = Self.weightsOnDisk ? .onDisk : .notInstalled
        #if canImport(MLXLMCommon)
        MLX.GPU.clearCache()
        #endif
    }

    /// Delete the download entirely.
    func remove() {
        unload()
        autoLoad = false
        try? FileManager.default.removeItem(at: Self.modelsDir.appending(path: "models"))
        state = .notInstalled
    }
}

// MARK: - The brain itself

#if canImport(MLXLMCommon) && canImport(FoundationModels)

/// One generation at a time, process-wide.
///
/// MLX drives a single Metal command queue. Two generations in flight at once race on the command
/// buffer's active encoder and Metal *aborts the process* — `MTLReleaseAssertionFailure` inside
/// `setCurrentCommandEncoder`, SIGABRT, no catchable error. It took a real crash to find, and the
/// trigger was ordinary-looking code: the journal generates its questions with a `TaskGroup`, one
/// per territory, which is exactly right for Apple's brains and fatal for this one.
///
/// A plain `actor` is NOT sufficient here — actors are reentrant, so an `await` inside the critical
/// section lets the next caller straight in, which is precisely the window that crashes. This is a
/// real mutual-exclusion gate with a FIFO queue of continuations.
actor LocalGenerationGate {
    static let shared = LocalGenerationGate()
    private var busy = false
    private var waiting: [CheckedContinuation<Void, Never>] = []

    private func acquire() async {
        if !busy { busy = true; return }
        await withCheckedContinuation { waiting.append($0) }
    }

    private func release() {
        if waiting.isEmpty { busy = false }
        else { waiting.removeFirst().resume() }   // hand the lock straight to the next in line
    }

    /// Run `body` with exclusive access to the GPU. Releases on throw as well as on return.
    func run<T: Sendable>(_ body: @Sendable () async throws -> T) async throws -> T {
        await acquire()
        defer { release() }
        return try await body()
    }
}

@available(macOS 26.0, *)
struct LocalBrain: AIBrain {
    let id = AIBrainID.local
    let container: ModelContainer
    var displayName: String { "\(LocalModelSpec.displayName) (on this Mac)" }
    var isAvailable: Bool { true }   // only ever constructed once the weights are resident

    private func params(_ req: AIRequest) -> GenerateParameters {
        GenerateParameters(maxTokens: req.maxTokens ?? 700,
                           temperature: Float(req.temperature ?? 0.7))
    }

    func text(_ req: AIRequest) async throws -> String {
        let container = self.container
        let p = params(req)
        let instructions = req.instructions
        let prompt = req.prompt
        return try await LocalGenerationGate.shared.run {
            let session = ChatSession(container, instructions: instructions, generateParameters: p)
            return try await session.respond(to: prompt)
        }
    }

    /// Structured output without guided decoding: describe the shape in words, then parse the
    /// reply into the very same `@Generable` type Apple's brains return. One retry with a blunter
    /// instruction covers the usual failure (a code fence or a sentence of preamble); after that we
    /// throw, so a caller sees a real error instead of silently rendering nothing.
    func object<T: Generable & Sendable>(_ type: T.Type, _ req: AIRequest, jsonShape: String) async throws -> T {
        let shapeRule = """

        Reply with ONE JSON object and nothing else — no prose before or after it, no code fence.
        Its shape: \(jsonShape)
        Every value must be real content for this request. Never copy the shape description itself.
        """
        var attempt = AIRequest(req.prompt + shapeRule, instructions: req.instructions,
                                temperature: req.temperature ?? 0.4, maxTokens: req.maxTokens)
        for pass in 0..<2 {
            let raw = try await text(attempt)
            if let json = AIJSON.firstObject(in: raw),
               let content = try? GeneratedContent(json: json),
               let value = try? T(content) {
                return value
            }
            guard pass == 0 else { break }
            attempt = AIRequest(
                req.prompt + shapeRule + "\n\nYour previous reply could not be parsed. Start your reply with { and end it with }.",
                instructions: req.instructions, temperature: 0.2, maxTokens: req.maxTokens)
        }
        throw AIError.badResponse(id)
    }
}

#endif

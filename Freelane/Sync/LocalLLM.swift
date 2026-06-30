import Foundation
import SwiftData
import IOKit
import IOKit.ps
import AppKit

// MARK: - Ollama provider

/// Local model via Ollama's HTTP API (default http://127.0.0.1:11434). Each request carries a
/// keep_alive so RESIDENCY follows usage: while you're in the app the model stays warm; when
/// you leave, the governor below unloads it and your RAM comes back (gaming-safe).
/// Thread-safe by construction: reads only nonisolated statics (UserDefaults-backed), so it can
/// be called from any actor without hopping to the main thread.
struct OllamaProvider: AIProvider {
    var displayName: String { "Local · \(LocalLLM.modelName)" }

    func generate(prompt: String) async throws -> String {
        let body: [String: Any] = [
            "model": LocalLLM.modelName,
            "prompt": prompt,
            "stream": false,
            "keep_alive": LocalLLM.activeKeepAlive,
            "options": ["temperature": 0.2],
        ]
        var req = URLRequest(url: LocalLLM.endpoint("api/generate"))
        req.httpMethod = "POST"
        req.timeoutInterval = 180   // cold load (3–10s) + long prompt is fine; never hang forever
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, resp) = try await URLSession.shared.data(for: req)
        guard let http = resp as? HTTPURLResponse else { throw AIError.badResponse }
        guard (200..<300).contains(http.statusCode) else {
            throw AIError.http(http.statusCode, String(String(data: data, encoding: .utf8)?.prefix(240) ?? ""))
        }
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        guard let out = json?["response"] as? String, !out.isEmpty else { throw AIError.badResponse }
        return out
    }
}

// MARK: - The coexistence governor

/// Decides WHEN the local model may occupy RAM, so it never competes with the user's real life:
///   · App in use      → model warm (rolling keep_alive) — journal tagging etc. is instant.
///   · App left/closed → model UNLOADED (keep_alive 0) — zero footprint while gaming/working.
///   · Mac idle on AC  → a quiet catch-up window: load, drain the backlog (NightShift), unload.
/// Idle is real idle: no keyboard/mouse for 10+ minutes, external power, thermals nominal.
@MainActor @Observable
final class LocalLLM {
    static let shared = LocalLLM()

    /// Rolling residency while the app is in use; the OS reclaims it 15m after the last call.
    static let activeKeepAlive = "15m"

    // Persisted config — exposed as nonisolated statics too, so providers on any thread can
    // read them without an actor hop (UserDefaults is thread-safe).
    nonisolated static var isEnabled: Bool { UserDefaults.standard.bool(forKey: "local.enabled") }
    nonisolated static var modelName: String { UserDefaults.standard.string(forKey: "local.model") ?? "gemma4:e4b" }
    nonisolated static func endpoint(_ path: String) -> URL {
        let raw = UserDefaults.standard.string(forKey: "local.host") ?? "http://127.0.0.1:11434"
        let base = URL(string: raw) ?? URL(string: "http://127.0.0.1:11434")!
        return base.appendingPathComponent(path)
    }

    // Stored (not computed) so @Observable tracks them and the Settings UI refreshes live;
    // didSet mirrors to UserDefaults, which the nonisolated statics read.
    var enabled: Bool = UserDefaults.standard.bool(forKey: "local.enabled") {
        didSet {
            UserDefaults.standard.set(enabled, forKey: "local.enabled")
            if enabled { Task { await probe(force: true) } } else { serverUp = false }
        }
    }
    var model: String = UserDefaults.standard.string(forKey: "local.model") ?? "gemma4:e4b" {
        didSet { UserDefaults.standard.set(model, forKey: "local.model") }
    }

    /// Live state for routing + the Settings card.
    private(set) var serverUp = false
    private(set) var installedModels: [String] = []
    private var lastProbe = Date.distantPast
    private var idleTask: Task<Void, Never>?
    private var preloadTask: Task<Void, Never>?   // the warm-up ping; cancellable so it can't re-warm after release
    private var reprobeScheduled = false           // coalesces transport-failure re-probes into one

    /// Is the CHOSEN model actually pulled? Routing to a missing model would 404 every job.
    var modelInstalled: Bool { installedModels.contains(model) }

    /// The server stopped answering (quit, crashed, network refused). Mark it down so jobs
    /// fail over instantly instead of waiting on timeouts — and quietly re-probe in 60s so
    /// it heals on its own when Ollama comes back. Coalesced: a burst of failed jobs schedules
    /// ONE re-probe, not one per failure.
    func noteTransportFailure() {
        serverUp = false
        guard !reprobeScheduled else { return }
        reprobeScheduled = true
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(60))
            self?.reprobeScheduled = false
            await self?.probe(force: true)
        }
    }

    /// Routing gate: the fast tier prefers local whenever this is true.
    var ready: Bool { enabled && serverUp && modelInstalled }

    func url(_ path: String) -> URL { Self.endpoint(path) }

    private init() {
        // If the app dies for any reason, give the RAM back.
        NotificationCenter.default.addObserver(forName: NSApplication.willTerminateNotification,
                                               object: nil, queue: .main) { _ in
            LocalLLM.shared.releaseNow()
        }
    }

    // MARK: Probing + residency

    /// Is Ollama there? Cached 30s so routing checks are free.
    func probe(force: Bool = false) async {
        guard enabled else { serverUp = false; return }
        guard force || Date.now.timeIntervalSince(lastProbe) > 30 else { return }
        lastProbe = .now
        var req = URLRequest(url: url("api/tags")); req.timeoutInterval = 2
        guard let (data, resp) = try? await URLSession.shared.data(for: req),
              (resp as? HTTPURLResponse)?.statusCode == 200,
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let models = json["models"] as? [[String: Any]] else { serverUp = false; return }
        serverUp = true
        installedModels = models.compactMap { $0["name"] as? String }.sorted()
        // Smart default: if the configured model isn't pulled but others are, adopt the best
        // available (prefer a Gemma) instead of silently routing into 404s.
        if !installedModels.isEmpty, !installedModels.contains(model) {
            model = installedModels.first { $0.lowercased().contains("gemma") } ?? installedModels[0]
        }
    }

    /// App came to the front: make sure the model is (or is becoming) warm. The warm-up runs in
    /// a stored, cancellable Task and is de-duplicated, so rapid focus toggling can't stack
    /// overlapping preloads — and a release can cancel it before it re-warms (see releaseNow).
    func appActive() {
        idleTask?.cancel(); idleTask = nil
        guard enabled, preloadTask == nil else { return }
        preloadTask = Task { [weak self] in
            guard let self else { return }
            defer { self.preloadTask = nil }
            await self.probe(force: true)
            guard self.serverUp, !Task.isCancelled else { return }
            var req = URLRequest(url: self.url("api/generate")); req.timeoutInterval = 120
            req.httpMethod = "POST"
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try? JSONSerialization.data(withJSONObject:
                ["model": self.model, "keep_alive": LocalLLM.activeKeepAlive])   // empty prompt = pure preload
            _ = try? await URLSession.shared.data(for: req)
        }
    }

    /// App left the front. Two cases, deliberately different:
    ///   · just unfocused (.inactive — you clicked another app): do NOTHING destructive; the
    ///     rolling 15m keep_alive self-expires, so a quick tab-away never costs a cold reload.
    ///   · actually gone (.background — windows closed / app hidden): free the RAM right now.
    /// Either way, start watching for a true-idle window to catch up quietly.
    func appBackgrounded(context: ModelContext, ai: AIManager, fullyClosed: Bool) {
        guard enabled else { return }
        if fullyClosed { releaseNow() }
        startIdleWatch(context: context, ai: ai)
    }

    /// keep_alive 0 → Ollama unloads the model right now (server itself stays, ~0 RAM).
    func releaseNow() {
        preloadTask?.cancel(); preloadTask = nil   // don't let an in-flight warm-up re-load after we unload
        guard enabled, serverUp else { return }
        var req = URLRequest(url: url("api/generate")); req.timeoutInterval = 5
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["model": model, "keep_alive": 0])
        Task { _ = try? await URLSession.shared.data(for: req) }
    }

    // MARK: True-idle catch-up

    private func startIdleWatch(context: ModelContext, ai: AIManager) {
        idleTask?.cancel()
        idleTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(300))
                guard let self, !Task.isCancelled else { return }
                guard await self.isTrueIdleWindow() else { continue }
                // Quiet window: drain the brain backlog once, then give the RAM back.
                await NightShift.runIfDue(context, ai: ai, anyHour: true)
                self.releaseNow()
            }
        }
    }

    /// No human input for 10+ min, on external power, thermals nominal. The moment any of
    /// these flips (e.g. a game starts heating the machine, or the user comes back), no work.
    private func isTrueIdleWindow() async -> Bool {
        guard enabled else { return false }
        guard Self.systemIdleSeconds() >= 600 else { return false }
        guard Self.onACPower else { return false }
        guard ProcessInfo.processInfo.thermalState == .nominal else { return false }
        await probe()
        return serverUp
    }

    /// Seconds since the last keyboard/mouse event, from IOKit's HIDIdleTime.
    static func systemIdleSeconds() -> TimeInterval {
        var iterator: io_iterator_t = 0
        guard IOServiceGetMatchingServices(kIOMainPortDefault,
                                           IOServiceMatching("IOHIDSystem"), &iterator) == KERN_SUCCESS else { return 0 }
        defer { IOObjectRelease(iterator) }
        let entry = IOIteratorNext(iterator)
        guard entry != 0 else { return 0 }
        defer { IOObjectRelease(entry) }
        var props: Unmanaged<CFMutableDictionary>?
        guard IORegistryEntryCreateCFProperties(entry, &props, kCFAllocatorDefault, 0) == KERN_SUCCESS,
              let dict = props?.takeRetainedValue() as? [String: Any],
              let raw = dict["HIDIdleTime"] as? Int64 else { return 0 }
        return TimeInterval(raw) / 1_000_000_000
    }

    static var onACPower: Bool {
        IOPSCopyExternalPowerAdapterDetails() != nil
    }
}

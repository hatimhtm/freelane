import AppKit
import Foundation
import SwiftData

/// Two-way sync between this Mac and the phone, with Postgres in the middle.
///
/// This replaces the dormant `SyncManager` path, which was written against the old web app's
/// `finance` schema and never spoke the tables the phone uses. Those live in `public` behind an
/// `fl_` prefix, alongside another app's tables, because PostgREST on that project only exposes
/// `public`.
///
/// Shape:
///   • **Push** — every row flagged `dirty` goes up, then the flag is cleared. The app already sets
///     `dirty` on edit in well over a hundred places, so this needs no new plumbing in the views.
///   • **Pull** — everything changed since a watermark comes down, and is applied only if it is
///     newer than what we hold. That last check is what stops an echo of our own push from
///     overwriting an edit made a second later.
///   • **Cadence** — on launch, on wake, and every 20 seconds while the app is frontmost. Also
///     immediately after a local save, so a change made here is on the phone in about a second.
///
/// Conflict rule is last-write-wins on `updatedAt`. Safe here in a way it usually isn't: one person
/// with two devices can only be typing on one of them.
///
/// Three models have no `updatedAt` at all (`LedgerEntry`, `InsightLog`, `ExchangeRate`), so their
/// sync timestamp is derived from what they do have. Stamping `now()` instead would mark every row
/// as changed on every push — which is exactly the storm that made the phone re-pull the whole
/// store in a loop.
@MainActor
@Observable
final class CloudSync {
    static let shared = CloudSync()

    // The publishable key identifies the project; it grants nothing. Every table has RLS keyed on
    // `user_id = auth.uid()`, so this is safe to ship in the binary.
    private let baseURL = URL(string: "https://pgmmyzcsmmepxteepfjy.supabase.co")!
    private let apiKey = "sb_publishable_I19DrCBciCMeQaEOS9qlMQ_o_q4dwEw"

    var status: String = "Not connected"
    var busy = false
    var lastSync: Date?
    var lastError: String?

    private var accessToken: String?
    private var userId: String?
    private var context: ModelContext?
    private var timer: Timer?
    private var running = false
    private var queued = false
    private var saveObserver: NSObjectProtocol?
    private var pendingPush: Task<Void, Never>?
    /// True while sync is writing. Saves it makes must not trigger another sync.
    private var applyingRemote = false

    private let watermarkKey = "cloud.watermark"
    /// How far the pull has got. Internal so the mapping extension can read and advance it.
    var watermarkValue: String {
        UserDefaults.standard.string(forKey: watermarkKey) ?? "1970-01-01T00:00:00Z"
    }
    func setWatermark(_ value: String) {
        UserDefaults.standard.set(value, forKey: watermarkKey)
    }

    var email: String {
        get { UserDefaults.standard.string(forKey: "cloud.email") ?? "" }
        set { UserDefaults.standard.set(newValue, forKey: "cloud.email") }
    }

    var isSignedIn: Bool { accessToken != nil }

    // MARK: - Lifecycle

    func attach(_ context: ModelContext) {
        self.context = context
    }

    func start() async {
        await restoreSession()
        guard isSignedIn else {
            status = "Sign in to sync"
            return
        }
        await syncNow()
        startTimer()
        observeSaves()
    }

    /// Push on every save.
    ///
    /// The 20-second timer is a safety net, not the mechanism. What makes the phone feel live is
    /// this: SwiftData announces every save, and each one queues a push. Debounced in `syncSoon`,
    /// because a single user action often saves more than once.
    private func observeSaves() {
        guard saveObserver == nil else { return }
        saveObserver = NotificationCenter.default.addObserver(
            forName: ModelContext.didSave, object: nil, queue: .main
        ) { _ in
            Task { @MainActor in
                // Sync itself ends by saving. Without this guard that save re-triggers sync, which
                // saves again — the app pulls forever and the status never leaves "Pulling…".
                guard !CloudSync.shared.applyingRemote else { return }
                CloudSync.shared.syncSoon()
            }
        }
    }

    private func startTimer() {
        timer?.invalidate()
        // Frequent enough that the phone feels live, rare enough that it is invisible.
        // Always, whether or not the window is in front. Skipping background windows meant an app
        // sitting open on a second screen never noticed anything from the phone — the check is
        // eight small requests, and being wrong about your balance costs more than the traffic.
        timer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in
            Task { @MainActor in await self?.syncNow() }
        }
    }

    func stop() {
        timer?.invalidate()
        timer = nil
        if let o = saveObserver { NotificationCenter.default.removeObserver(o); saveObserver = nil }
    }

    // MARK: - Auth

    func signIn(email: String, password: String) async -> Bool {
        self.email = email
        do {
            let body = try JSONSerialization.data(withJSONObject: ["email": email, "password": password])
            var req = URLRequest(url: baseURL.appending(path: "auth/v1/token"))
            req.url?.append(queryItems: [URLQueryItem(name: "grant_type", value: "password")])
            req.httpMethod = "POST"
            req.setValue(apiKey, forHTTPHeaderField: "apikey")
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = body

            let (data, resp) = try await URLSession.shared.data(for: req)
            guard let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode),
                  let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let token = json["access_token"] as? String
            else {
                lastError = "Sign-in failed. Check the email and password."
                return false
            }
            accessToken = token
            userId = (json["user"] as? [String: Any])?["id"] as? String
            if let refresh = json["refresh_token"] as? String {
                Keychain.set(refresh, for: "cloud.refreshToken")
            }
            status = "Connected"
            await syncNow()
            startTimer()
            return true
        } catch {
            lastError = error.localizedDescription
            return false
        }
    }

    private func restoreSession() async {
        guard accessToken == nil, let refresh = Keychain.get("cloud.refreshToken") else { return }
        do {
            let body = try JSONSerialization.data(withJSONObject: ["refresh_token": refresh])
            var req = URLRequest(url: baseURL.appending(path: "auth/v1/token"))
            req.url?.append(queryItems: [URLQueryItem(name: "grant_type", value: "refresh_token")])
            req.httpMethod = "POST"
            req.setValue(apiKey, forHTTPHeaderField: "apikey")
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = body
            let (data, resp) = try await URLSession.shared.data(for: req)
            guard let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode),
                  let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
            else { return }
            accessToken = json["access_token"] as? String
            userId = (json["user"] as? [String: Any])?["id"] as? String
            if let r = json["refresh_token"] as? String { Keychain.set(r, for: "cloud.refreshToken") }
            status = "Connected"
        } catch {
            // Stay local. The data is all here; the user can reconnect from Settings.
        }
    }

    func signOut() {
        accessToken = nil
        userId = nil
        Keychain.set(nil, for: "cloud.refreshToken")
        UserDefaults.standard.removeObject(forKey: watermarkKey)
        stop()
        status = "Not connected"
    }

    // MARK: - The loop

    /// Push, then pull. Push first so a change made here is on the server before we ask what moved —
    /// otherwise the watermark can jump past our own unsent row.
    /// `userInitiated` is the only thing that shows a spinner. A background poll that finds
    /// nothing should be indistinguishable from the app doing nothing at all — showing progress for
    /// it made a resting app look permanently busy, which is worse than not syncing.
    func syncNow(userInitiated: Bool = false) async {
        guard let context, let token = accessToken, let uid = userId else { return }
        if running { queued = true; return }
        running = true
        if userInitiated { busy = true }
        defer {
            running = false
            busy = false
            if queued { queued = false; Task { await syncNow() } }
        }

        applyingRemote = true
        defer { applyingRemote = false }

        do {
            // A check that finds nothing says nothing. The poll runs every 20 seconds, so
            // announcing each one made a resting app look like it was stuck in a loop — the
            // status never settled on "Synced" long enough to read.
            let pushed = try await push(context: context, token: token, uid: uid)
            if pushed > 0 { status = "Sending \(pushed)…" }
            let pulled = try await pull(context: context, token: token, uid: uid)
            if pulled > 0 { status = "Receiving \(pulled)…" }

            lastSync = .now
            lastError = nil
            status = pushed + pulled > 0 ? "Synced" : "Up to date"
        } catch {
            lastError = error.localizedDescription
            status = "Sync failed"
        }
    }

    /// Called right after a local save so an edit reaches the phone in about a second rather than
    /// on the next tick.
    func syncSoon() {
        guard isSignedIn else { return }
        pendingPush?.cancel()
        // One user action often saves more than once; coalesce them into a single push.
        pendingPush = Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(600))
            guard !Task.isCancelled else { return }
            await syncNow()
        }
    }

    // MARK: - HTTP

    private func request(_ path: String, method: String, token: String, body: Data? = nil,
                         query: [URLQueryItem] = [], prefer: String? = nil) async throws -> Data {
        var req = URLRequest(url: baseURL.appending(path: "rest/v1/\(path)"))
        if !query.isEmpty { req.url?.append(queryItems: query) }
        req.httpMethod = method
        req.setValue(apiKey, forHTTPHeaderField: "apikey")
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let prefer { req.setValue(prefer, forHTTPHeaderField: "Prefer") }
        req.httpBody = body
        req.timeoutInterval = 30

        let (data, resp) = try await URLSession.shared.data(for: req)
        let code = (resp as? HTTPURLResponse)?.statusCode ?? -1
        guard (200..<300).contains(code) else {
            let text = String(data: data, encoding: .utf8) ?? ""
            throw NSError(domain: "CloudSync", code: code,
                          userInfo: [NSLocalizedDescriptionKey:
                                     "\(method) \(path) → \(code)  \(text.prefix(300))"])
        }
        return data
    }

    func upsert(_ table: String, rows: [[String: Any]], token: String) async throws {
        guard !rows.isEmpty else { return }
        for chunk in stride(from: 0, to: rows.count, by: 200).map({ Array(rows[$0..<min($0 + 200, rows.count)]) }) {
            let body = try JSONSerialization.data(withJSONObject: chunk)
            _ = try await request(table, method: "POST", token: token, body: body,
                                  prefer: "resolution=merge-duplicates,return=minimal")
        }
    }

    func fetchRows(_ table: String, token: String, uid: String, since: String) async throws -> [[String: Any]] {
        let data = try await request(table, method: "GET", token: token, query: [
            URLQueryItem(name: "select", value: "*"),
            URLQueryItem(name: "user_id", value: "eq.\(uid)"),
            URLQueryItem(name: "updated_at", value: "gt.\(zulu(since))"),
            URLQueryItem(name: "order", value: "updated_at.asc"),
        ])
        return (try JSONSerialization.jsonObject(with: data) as? [[String: Any]]) ?? []
    }
}

// MARK: - Encoding helpers

private let isoFormatter: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    f.timeZone = TimeZone(secondsFromGMT: 0)
    return f
}()

/// Normalise any offset spelling to a literal `Z`.
///
/// `+00:00` and `Z` mean the same instant, but only one of them survives being put in a URL: `+`
/// is a legal query character meaning space, so the server reads the timestamp as malformed and
/// rejects the whole request. Everything this app emits ends in `Z`.
private func zulu(_ s: String) -> String {
    s.replacingOccurrences(of: "+00:00", with: "Z").replacingOccurrences(of: "+0000", with: "Z")
}

private let isoPlain: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime]
    return f
}()

func iso(_ d: Date?) -> Any {
    guard let d else { return NSNull() }
    return zulu(isoFormatter.string(from: d))
}

func parseDate(_ v: Any?) -> Date? {
    guard let s = v as? String else { return nil }
    return isoFormatter.date(from: s) ?? isoPlain.date(from: s)
}

/// Always UTC, always `Z`, never an offset — the form that survives a URL round trip.
func isoString(_ d: Date) -> String { zulu(isoFormatter.string(from: d)) }

func parseUUID(_ v: Any?) -> UUID? {
    guard let s = v as? String else { return nil }
    return UUID(uuidString: s)
}

func uuidOrNull(_ id: UUID?) -> Any { id?.uuidString.lowercased() ?? NSNull() }
func strOrNull(_ s: String?) -> Any { s ?? NSNull() }
func numOrNull(_ d: Double?) -> Any { d ?? NSNull() }

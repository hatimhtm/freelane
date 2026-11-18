import AppKit
import Foundation
import OSLog
import SwiftData

/// Counts and errors only, never a row's contents: `log stream --predicate 'subsystem == "app.freelane.mac"'`.
let syncLog = Logger(subsystem: "app.freelane.mac", category: "sync")

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
    private var napGuard: NSObjectProtocol?
    /// Spends, payments, moves and loans the last pull saw deleted, held here or not: a money line
    /// pointing at one of them is retired even when its record itself was purged on this Mac.
    var deletedSeen: [UUID: Date] = [:]
    /// When the last sync ran, so the poll can stand back while the live link is joined.
    private var lastPoll = Date.distantPast
    private var wakeObservers: [NSObjectProtocol] = []
    /// True while sync is writing. Saves it makes must not trigger another sync.
    private var applyingRemote = false
    /// When the current access token stops being accepted. Supabase issues them for one hour.
    private var tokenExpiresAt: Date?

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
        guard !DevMode.isSandboxed else { status = "Offline copy"; return }
        hasSavedSignIn = Keychain.get("cloud.refreshToken") != nil
        // Opening the app is when you look at the numbers, so the first sync is a full one and shows.
        // With no network yet (straight after a wake), the session comes back on a later tick: the
        // timer starts whenever a saved sign-in exists, not only when it could be restored now.
        await restoreSession()
        guard isSignedIn || hasSavedSignIn else {
            status = "Sign in to sync"
            return
        }
        startTimer()
        observeSaves()
        await syncNow(userInitiated: true, full: true)
    }

    /// A sign-in this Mac kept, whether or not it could be renewed yet. Read from the Keychain once
    /// at launch and kept up to date by sign-in and sign-out, so drawing the button never asks it.
    private(set) var hasSavedSignIn = false

    /// What the Sync button shows.
    enum Phase: Equatable { case signedOut, syncing, failed, offline, synced }
    var phase: Phase {
        if busy { return .syncing }
        if !isSignedIn && !hasSavedSignIn { return .signedOut }
        if !Reachability.shared.online { return .offline }
        if lastError != nil { return .failed }
        return .synced
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
            // Sync itself ends by saving. Without this guard that save re-triggers sync, which
            // saves again. Read the flag NOW, on the posting (main) thread: inside the Task it was
            // read after syncNow had already reset it, so every pull scheduled another sync.
            let fromSync = MainActor.assumeIsolated { CloudSync.shared.applyingRemote }
            guard !fromSync else { return }
            Task { @MainActor in CloudSync.shared.syncSoon() }
        }
    }

    private func startTimer() {
        timer?.invalidate()
        // Every 10 seconds, whether or not the window is in front: the check is a few small
        // requests, and being wrong about your balance costs more than the traffic.
        let t = Timer(timeInterval: 10, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                // While the live link is joined it carries the phone's changes; the poll only checks
                // every 30 seconds then, in case the link went quiet without saying so.
                if RealtimeLink.shared.joined, Date.now.timeIntervalSince(self.lastPoll) < 30 { return }
                await self.syncNow()
            }
        }
        t.tolerance = 1
        // .common so it also fires while a menu or a scroll is tracking the mouse.
        RunLoop.main.add(t, forMode: .common)
        timer = t
        keepAwake()
        observeWakeAndFocus()
    }

    /// macOS naps an app whose windows are hidden or behind others: its timers slide by minutes,
    /// which is why the Mac only caught up with the phone after sitting open for ten or twenty
    /// minutes. While signed in, this opts out of App Nap. It never keeps the Mac itself awake.
    private func keepAwake() {
        guard napGuard == nil else { return }
        napGuard = ProcessInfo.processInfo.beginActivity(
            options: [.userInitiatedAllowingIdleSystemSleep],
            reason: "Keeping your money in sync with your phone")
    }

    /// Coming back from sleep, or to the app, syncs at once instead of waiting for the next tick.
    /// After a wake the network takes a few seconds to return, so it tries again a little later too.
    private func observeWakeAndFocus() {
        guard wakeObservers.isEmpty else { return }
        let ws = NSWorkspace.shared.notificationCenter
        wakeObservers.append(ws.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { _ in
            Task { @MainActor in
                // A socket from before the sleep is dead even if it hasn't said so yet.
                RealtimeLink.shared.drop()
                for wait in [2, 6, 15] {
                    try? await Task.sleep(for: .seconds(wait))
                    await CloudSync.shared.syncNow()
                }
            }
        })
        wakeObservers.append(NotificationCenter.default.addObserver(forName: NSApplication.didBecomeActiveNotification, object: nil, queue: .main) { _ in
            Task { @MainActor in CloudSync.shared.syncSoon() }
        })
    }

    func stop() {
        timer?.invalidate()
        timer = nil
        if let o = saveObserver { NotificationCenter.default.removeObserver(o); saveObserver = nil }
        for o in wakeObservers {
            NSWorkspace.shared.notificationCenter.removeObserver(o)
            NotificationCenter.default.removeObserver(o)
        }
        wakeObservers = []
        if let g = napGuard { ProcessInfo.processInfo.endActivity(g); napGuard = nil }
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
            noteExpiry(json)
            if let refresh = json["refresh_token"] as? String {
                Keychain.set(refresh, for: "cloud.refreshToken")
                hasSavedSignIn = true
            }
            status = "Connected"
            lastError = nil
            startTimer()
            observeSaves()
            await syncNow(userInitiated: true, full: true)
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
            noteExpiry(json)
            if let r = json["refresh_token"] as? String { Keychain.set(r, for: "cloud.refreshToken") }
            status = "Connected"
        } catch {
            // Stay local. The data is all here; the user can reconnect from Settings.
        }
    }

    private func noteExpiry(_ json: [String: Any]) {
        // `expires_in` is seconds. Default to an hour, which is what Supabase issues.
        let seconds = (json["expires_in"] as? Double) ?? 3600
        tokenExpiresAt = Date().addingTimeInterval(seconds)
    }

    /// Swap the refresh token for a new access token.
    ///
    /// Without this the app worked for exactly one hour and then failed with "JWT expired" until it
    /// was relaunched — a session that silently dies is worse than one that never starts, because
    /// you go on believing your devices agree.
    ///
    /// Refresh tokens ROTATE: each use invalidates the previous one, so the replacement must be
    /// stored or the next refresh fails too.
    @discardableResult
    private func refreshAccessToken() async -> Bool {
        guard let refresh = Keychain.get("cloud.refreshToken") else { return false }
        do {
            let body = try JSONSerialization.data(withJSONObject: ["refresh_token": refresh])
            var req = URLRequest(url: baseURL.appending(path: "auth/v1/token"))
            req.url?.append(queryItems: [URLQueryItem(name: "grant_type", value: "refresh_token")])
            req.httpMethod = "POST"
            req.setValue(apiKey, forHTTPHeaderField: "apikey")
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = body
            let (data, resp) = try await URLSession.shared.data(for: req)
            guard (resp as? HTTPURLResponse).map({ (200..<300).contains($0.statusCode) }) == true,
                  let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let token = json["access_token"] as? String
            else { return false }
            accessToken = token
            userId = (json["user"] as? [String: Any])?["id"] as? String ?? userId
            noteExpiry(json)
            if let r = json["refresh_token"] as? String { Keychain.set(r, for: "cloud.refreshToken") }
            return true
        } catch {
            return false
        }
    }

    func signOut() {
        RealtimeLink.shared.drop()
        accessToken = nil
        userId = nil
        Keychain.set(nil, for: "cloud.refreshToken")
        hasSavedSignIn = false
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
    /// `full` re-reads every row instead of only what changed since the last pull, so anything a
    /// past sync missed comes back. It's what the Sync button and opening the app do.
    func syncNow(userInitiated: Bool = false, full: Bool = false) async {
        guard let context else { return }
        if running {
            // A button press must never be swallowed by a background tick that happens to be
            // running: wait for it, then do the full sync that was asked for.
            guard userInitiated else { queued = true; return }
            busy = true
            while running { try? await Task.sleep(for: .milliseconds(100)) }
        }
        running = true
        if userInitiated { busy = true }
        defer {
            running = false
            busy = false
            if queued { queued = false; Task { await syncNow() } }
        }
        // Launched with no network: the session couldn't be renewed then. Try again now.
        if accessToken == nil, hasSavedSignIn { await restoreSession() }
        guard let token = accessToken, let uid = userId else {
            if userInitiated {
                lastError = hasSavedSignIn ? "Couldn't reach the server. Check the connection and try again."
                                           : "Not signed in. Sign in under Settings › Phone."
            }
            return
        }

        // Renew a few minutes early rather than waiting to be refused.
        if let exp = tokenExpiresAt, exp.timeIntervalSinceNow < 300 {
            await refreshAccessToken()
        }
        // The live link: opened if it dropped, and given the renewed token.
        if let live = accessToken, let who = userId { RealtimeLink.shared.ensure(token: live, uid: who) }
        lastPoll = .now

        applyingRemote = true
        defer { applyingRemote = false }

        // A check that finds nothing says nothing. The poll runs every 20 seconds, so announcing
        // each one made a resting app look like it was stuck in a loop.
        // Push and pull fail separately: one row the server rejects used to stop every pull too,
        // so the Mac quietly stopped hearing from the phone.
        var pushed = 0, pulled = 0
        var failure: String?
        do {
            pushed = try await push(context: context, token: token, uid: uid)
            if pushed > 0 { status = "Sending \(pushed)…" }
        } catch { failure = error.localizedDescription }
        do {
            pulled = try await pull(context: context, token: token, uid: uid, full: full)
            if pulled > 0 { status = "Receiving \(pulled)…" }
        } catch { failure = failure ?? error.localizedDescription }
        // Money lines left live after their spend, payment, move or loan was deleted are retired,
        // and the retirement goes straight up so the phone drops them too.
        let retired = retireOrphanLegs(context)
        if retired > 0 {
            syncLog.info("retired \(retired) money lines of deleted records")
            try? context.save()
            if let more = try? await push(context: context, token: token, uid: uid) { pushed += more }
        }

        if pushed + pulled > 0 || failure != nil {
            syncLog.info("sync · sent \(pushed) · received \(pulled)\(failure.map { " · failed: \($0.prefix(160))" } ?? "", privacy: .public)")
        }
        if full, failure == nil { logNumbers(context) }
        if let failure {
            lastError = failure
            status = "Sync failed"
        } else {
            lastSync = .now
            lastError = nil
            status = pushed + pulled > 0 ? "Synced" : "Up to date"
        }
    }

    /// A money line belongs to its spend, payment, move or loan: once that record is deleted, the
    /// line must stop counting. Some deletes in the past retired the record but left its line live on
    /// the server, so a wallet ran short by that amount on whichever device held the line. This retires
    /// such lines (dated when their record was deleted) and marks them to send.
    func retireOrphanLegs(_ ctx: ModelContext) -> Int {
        let live = ((try? ctx.fetch(FetchDescriptor<LedgerEntry>(predicate: #Predicate { $0.archivedAt == nil }))) ?? [])
            .filter { $0.relatedId != nil }
        guard !live.isEmpty else { return 0 }
        var gone: [UUID: Date] = [:]
        for x in (try? ctx.fetch(FetchDescriptor<Spend>(predicate: #Predicate { $0.deletedAt != nil }))) ?? [] { gone[x.id] = x.deletedAt }
        for x in (try? ctx.fetch(FetchDescriptor<Payment>(predicate: #Predicate { $0.deletedAt != nil }))) ?? [] { gone[x.id] = x.deletedAt }
        for x in (try? ctx.fetch(FetchDescriptor<Withdrawal>(predicate: #Predicate { $0.deletedAt != nil }))) ?? [] { gone[x.id] = x.deletedAt }
        for x in (try? ctx.fetch(FetchDescriptor<Loan>(predicate: #Predicate { $0.deletedAt != nil }))) ?? [] { gone[x.id] = x.deletedAt }
        for (id, at) in deletedSeen where gone[id] == nil { gone[id] = at }
        guard !gone.isEmpty else { return 0 }
        var n = 0
        for l in live {
            guard let rid = l.relatedId, let at = gone[rid] else { continue }
            l.archivedAt = at
            l.dirty = true
            n += 1
        }
        return n
    }

    /// After a full sync, each wallet's balance as this Mac counts it, into the system log, so the
    /// two devices can be compared figure by figure. Local to this Mac, never sent anywhere.
    private func logNumbers(_ ctx: ModelContext) {
        let wallets = ((try? ctx.fetch(FetchDescriptor<Wallet>())) ?? []).filter { $0.isHolding && !$0.archived && $0.deletedAt == nil }
        let ledger = (try? ctx.fetch(FetchDescriptor<LedgerEntry>())) ?? []
        let parts = wallets.sorted { $0.name < $1.name }
            .map { "\($0.name) \(String(format: "%.2f", WalletMath.balance(of: $0, ledger: ledger)))" }
        syncLog.info("check · \(parts.joined(separator: " · "), privacy: .public)")
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
                         query: [URLQueryItem] = [], prefer: String? = nil,
                         isRetry: Bool = false) async throws -> Data {
        // Always the live token — the one handed in may have expired mid-sync.
        let bearer = accessToken ?? token
        var req = URLRequest(url: baseURL.appending(path: "rest/v1/\(path)"))
        if !query.isEmpty { req.url?.append(queryItems: query) }
        req.httpMethod = method
        req.setValue(apiKey, forHTTPHeaderField: "apikey")
        req.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let prefer { req.setValue(prefer, forHTTPHeaderField: "Prefer") }
        req.httpBody = body
        req.timeoutInterval = 30

        let (data, resp) = try await URLSession.shared.data(for: req)
        let code = (resp as? HTTPURLResponse)?.statusCode ?? -1

        // An expired token is recoverable, so recover rather than reporting failure.
        if code == 401, !isRetry, await refreshAccessToken() {
            return try await request(path, method: method, token: accessToken ?? token,
                                     body: body, query: query, prefer: prefer, isRetry: true)
        }

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

    /// Every row changed since `since`, page by page: the server hands back at most 1,000 rows a
    /// request, and the ledger alone is near that, so a full re-read in one request lost the newest.
    func fetchRows(_ table: String, token: String, uid: String, since: String) async throws -> [[String: Any]] {
        let page = 500
        var all: [[String: Any]] = []
        while true {
            let data = try await request(table, method: "GET", token: token, query: [
                URLQueryItem(name: "select", value: "*"),
                URLQueryItem(name: "user_id", value: "eq.\(uid)"),
                URLQueryItem(name: "updated_at", value: "gt.\(zulu(since))"),
                URLQueryItem(name: "order", value: "updated_at.asc,id.asc"),
                URLQueryItem(name: "limit", value: "\(page)"),
                URLQueryItem(name: "offset", value: "\(all.count)"),
            ])
            let rows = (try JSONSerialization.jsonObject(with: data) as? [[String: Any]]) ?? []
            all += rows
            if rows.count < page { return all }
        }
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
func zulu(_ s: String) -> String {
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

func parseUUID(_ v: Any?) -> UUID? {
    guard let s = v as? String else { return nil }
    return UUID(uuidString: s)
}

func uuidOrNull(_ id: UUID?) -> Any { id?.uuidString.lowercased() ?? NSNull() }
func strOrNull(_ s: String?) -> Any { s ?? NSNull() }
func numOrNull(_ d: Double?) -> Any { d ?? NSNull() }

import Foundation
import SQLite3
import EventKit
import Contacts
import SwiftData

/// The PERSONAL CONTEXT layer — with explicit per-source opt-in, the AI becomes aware of what's
/// happening in the user's life OUTSIDE the app: Messages, Safari (history + searches), Calendar,
/// and Reminders. No new screens; the sources are digested once a day into a compact context
/// sheet that the existing AI surfaces (journal questions, insights, chat) read.
///
/// HARD PRIVACY RULES:
///  · Every source is OFF until enabled in Settings → Integrations.
///  · The digest is produced by the ON-DEVICE model directly (never the failover chain), and the
///    raw extracts never leave this function.
///  · Downstream prompts include the digest ONLY while cloud fallback is unreachable — this
///    content can never ride a prompt to Gemini, even with cloud enabled elsewhere.
///  · Signals, not quotes: the model is instructed to output themes/names, never message text.
enum LifeSignals {

    static var messagesOn: Bool { UserDefaults.standard.bool(forKey: "signals.messages") }
    static var safariOn: Bool { UserDefaults.standard.bool(forKey: "signals.safari") }
    static var calendarOn: Bool { UserDefaults.standard.bool(forKey: "signals.calendar") }
    static var anyOn: Bool { messagesOn || safariOn || calendarOn || Integrations.remindersOn }

    // MARK: - The digest (what the rest of the app reads)

    struct Digest: Codable {
        var themes: [String] = []   // "apartment hunting", "planning Cebu trip"
        var people: [String] = []   // most-contacted names
        var notes: [String] = []    // what a thoughtful friend would remember this week
    }

    /// The freshest stored digest — display/prompt read, never hits AI or the raw sources.
    @MainActor
    static func digest(_ context: ModelContext) -> Digest? {
        guard anyOn, let raw = Brain.cachedStable(context, key: "life_signals"),
              let data = raw.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(Digest.self, from: data)
    }

    /// The formatted prompt section. Callers MUST gate on `!ai.cloudReachable` — see privacy rules.
    @MainActor
    static func contextSection(_ context: ModelContext) -> String? {
        guard let d = digest(context), !(d.themes.isEmpty && d.people.isEmpty && d.notes.isEmpty) else { return nil }
        var lines = ["WHAT'S GOING ON IN THEIR LIFE RIGHT NOW (from their Mac, on-device only)"]
        if !d.themes.isEmpty { lines.append("- Current threads: " + d.themes.joined(separator: "; ")) }
        if !d.people.isEmpty { lines.append("- In touch with most: " + d.people.joined(separator: ", ")) }
        if !d.notes.isEmpty { lines.append(contentsOf: d.notes.map { "- \($0)" }) }
        return lines.joined(separator: "\n")
    }

    // MARK: - Refresh (once a day, on-device)

    static func refresh(_ context: ModelContext, force: Bool = false) async {
        guard anyOn else { return }
        let last = UserDefaults.standard.double(forKey: "signals.refreshedAt")
        if !force, Date.now.timeIntervalSince1970 - last < 20 * 3600 { return }
        guard FoundationModelProvider.isAvailable else { return }   // on-device ONLY, by design

        var sections: [String] = []
        if messagesOn, let m = messagesSource() { sections.append(m) }
        if safariOn, let s = safariSource() { sections.append(s) }
        if calendarOn, let c = await calendarSource() { sections.append(c) }
        if Integrations.remindersOn {
            let rems = await EventBridge.incompleteReminders().prefix(10)
            if !rems.isEmpty {
                sections.append("OPEN REMINDERS:\n" + rems.map { r in
                    "- \(r.title)" + (r.due.map { " (due \($0.formatted(.dateTime.month().day())))" } ?? "")
                }.joined(separator: "\n"))
            }
        }
        guard !sections.isEmpty else { return }

        let prompt = """
        You are building a compact, private context sheet about one person from raw signals off
        their own computer. Reply with ONLY a JSON object shaped like {"themes": [array of up to 8
        short strings], "people": [array of up to 5 names], "notes": [array of up to 4 short strings]}.
        - themes: what's currently going on in their life ("apartment hunting", "planning a Cebu trip",
          "busy stretch at work") — plain words, 2-5 words each.
        - people: who they're actually in touch with most, names only.
        - notes: what a thoughtful friend would remember this week (an upcoming event, a decision
          they seem to be weighing) — one short sentence each.
        Only what the data clearly supports — never invent, never moralize. NEVER quote message text
        verbatim. Never echo this format description.

        RAW SIGNALS:
        \(sections.joined(separator: "\n\n"))
        """
        guard let raw = try? await FoundationModelProvider().generate(prompt: prompt),
              let jsonStr = AIJSON.firstObject(in: raw),
              let data = jsonStr.data(using: .utf8),
              var d = try? JSONDecoder().decode(Digest.self, from: data) else { return }
        d.themes = d.themes.filter { AIJSON.isRealText($0, minLetters: 4) }.map { String($0.prefix(60)) }
        d.people = d.people.map { $0.trimmingCharacters(in: .whitespaces) }.filter { $0.count >= 2 && $0.count <= 40 }
        d.notes = d.notes.filter { AIJSON.isRealText($0) }.map { String($0.prefix(120)) }
        guard let out = try? JSONEncoder().encode(d), let payload = String(data: out, encoding: .utf8) else { return }
        await MainActor.run {
            Brain.store(context, key: "life_signals", payload: payload, ttl: 2 * 86400)
        }
        UserDefaults.standard.set(Date.now.timeIntervalSince1970, forKey: "signals.refreshedAt")
    }

    // MARK: - Sources (raw extracts; never leave this file)

    private static var home: URL { FileManager.default.homeDirectoryForCurrentUser }
    /// Seconds between the Unix epoch and Apple's 2001-01-01 reference date.
    private static let appleEpoch = 978_307_200.0

    /// Can we actually read a TCC-protected database? (Full Disk Access check for Settings.)
    static func canRead(_ path: String) -> Bool {
        var db: OpaquePointer?
        let ok = sqlite3_open_v2(path, &db, SQLITE_OPEN_READONLY, nil) == SQLITE_OK
            && sqlite3_exec(db, "SELECT 1", nil, nil, nil) == SQLITE_OK
        if db != nil { sqlite3_close(db) }
        return ok
    }
    static var messagesDBPath: String { home.appendingPathComponent("Library/Messages/chat.db").path }
    static var safariDBPath: String { home.appendingPathComponent("Library/Safari/History.db").path }

    /// Last 14 days of Messages, shrunk to who + how much + a bounded text sample for theming.
    private static func messagesSource() -> String? {
        let cutoffNs = (Date.now.timeIntervalSince1970 - appleEpoch - 14 * 86400) * 1_000_000_000
        guard let rows = queryRows(dbPath: messagesDBPath, sql: """
            SELECT h.id, m.text, m.is_from_me FROM message m
            JOIN handle h ON m.handle_id = h.ROWID
            WHERE m.date > ? AND m.text IS NOT NULL AND length(m.text) > 0
            ORDER BY m.date DESC LIMIT 300
            """, binds: [cutoffNs]), !rows.isEmpty else { return nil }
        var counts: [String: Int] = [:]
        var sample: [String] = []
        for r in rows {
            guard let handle = r[0], let text = r[1] else { continue }
            counts[handle, default: 0] += 1
            if sample.count < 80 {
                let who = r[2] == "1" ? "me" : "them"
                sample.append("[\(who)] " + String(text.prefix(110)).replacingOccurrences(of: "\n", with: " "))
            }
        }
        let top = counts.sorted { $0.value > $1.value }.prefix(6)
            .map { "\(contactName(for: $0.key) ?? $0.key) (\($0.value) msgs)" }
        return """
        MESSAGES (14 days): most in touch with: \(top.joined(separator: ", "))
        Recent snippets (for themes only — never quote back):
        \(sample.joined(separator: "\n"))
        """
    }

    /// Last 14 days of Safari: top sites + the search queries themselves (the honest signal).
    private static func safariSource() -> String? {
        let cutoff = Date.now.timeIntervalSince1970 - appleEpoch - 14 * 86400
        guard let rows = queryRows(dbPath: safariDBPath, sql: """
            SELECT i.url FROM history_visits v
            JOIN history_items i ON v.history_item = i.id
            WHERE v.visit_time > ? ORDER BY v.visit_time DESC LIMIT 600
            """, binds: [cutoff]), !rows.isEmpty else { return nil }
        var domains: [String: Int] = [:]
        var searches: [String] = []
        for r in rows {
            guard let raw = r[0], let url = URL(string: raw) else { continue }
            if let host = url.host()?.replacingOccurrences(of: "www.", with: "") { domains[host, default: 0] += 1 }
            if let comps = URLComponents(url: url, resolvingAgainstBaseURL: false),
               let q = comps.queryItems?.first(where: { ["q", "query", "search_query", "p"].contains($0.name) })?.value,
               q.count > 2, searches.count < 40, !searches.contains(q) {
                searches.append(q)
            }
        }
        let top = domains.sorted { $0.value > $1.value }.prefix(10).map { "\($0.key) ×\($0.value)" }
        var out = "SAFARI (14 days): top sites: \(top.joined(separator: ", "))"
        if !searches.isEmpty { out += "\nSearches: \(searches.joined(separator: " · "))" }
        return out
    }

    /// The next 14 days of calendar events (titles + days only).
    @MainActor
    private static func calendarSource() async -> String? {
        let status = EKEventStore.authorizationStatus(for: .event)
        if status != .fullAccess {
            guard (try? await EventBridge.store.requestFullAccessToEvents()) == true else { return nil }
        }
        let start = Date.now
        guard let end = PHT.calendar.date(byAdding: .day, value: 14, to: start) else { return nil }
        let pred = EventBridge.store.predicateForEvents(withStart: start, end: end, calendars: nil)
        let events = EventBridge.store.events(matching: pred).prefix(15)
        guard !events.isEmpty else { return nil }
        let lines = events.map { "- \($0.startDate.formatted(.dateTime.month().day())): \($0.title ?? "(event)")" }
        return "CALENDAR (next 14 days):\n" + lines.joined(separator: "\n")
    }

    /// Phone/email handle → contact name, when Contacts is connected.
    private static func contactName(for handle: String) -> String? {
        guard Integrations.contactsOn,
              CNContactStore.authorizationStatus(for: .contacts) == .authorized else { return nil }
        let store = CNContactStore()
        let keys = [CNContactGivenNameKey, CNContactFamilyNameKey] as [CNKeyDescriptor]
        let pred: NSPredicate = handle.contains("@")
            ? CNContact.predicateForContacts(matchingEmailAddress: handle)
            : CNContact.predicateForContacts(matching: CNPhoneNumber(stringValue: handle))
        guard let c = (try? store.unifiedContacts(matching: pred, keysToFetch: keys))?.first else { return nil }
        let full = [c.givenName, c.familyName].filter { !$0.isEmpty }.joined(separator: " ")
        return full.isEmpty ? nil : full
    }

    // MARK: - Tiny read-only SQLite helper

    private static func queryRows(dbPath: String, sql: String, binds: [Double]) -> [[String?]]? {
        var db: OpaquePointer?
        guard sqlite3_open_v2(dbPath, &db, SQLITE_OPEN_READONLY, nil) == SQLITE_OK, let db else {
            return nil   // most commonly: Full Disk Access not granted
        }
        defer { sqlite3_close(db) }
        sqlite3_busy_timeout(db, 500)
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK, let stmt else { return nil }
        defer { sqlite3_finalize(stmt) }
        for (i, b) in binds.enumerated() { sqlite3_bind_double(stmt, Int32(i + 1), b) }
        var rows: [[String?]] = []
        while sqlite3_step(stmt) == SQLITE_ROW {
            var row: [String?] = []
            for c in 0..<sqlite3_column_count(stmt) {
                row.append(sqlite3_column_text(stmt, c).map { String(cString: $0) })
            }
            rows.append(row)
        }
        return rows
    }
}

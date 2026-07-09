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

    /// v2 (the v1 digest conflated reading with living — "browsed a singing-contest article"
    /// became "practicing for a singing competition"). `doing` may only come from their OWN
    /// activity (messages, calendar, reminders); `reading` is what they merely looked at.
    struct Digest: Codable {
        var doing: [String] = []     // real life threads ("apartment hunting", "trip on the 24th")
        var reading: [String] = []   // browsing interests — NOT things they did
        var people: [String] = []    // most-contacted real names
        var notes: [String] = []     // what a thoughtful friend would remember this week
    }

    /// The freshest stored digest — display/prompt read, never hits AI or the raw sources.
    @MainActor
    static func digest(_ context: ModelContext) -> Digest? {
        guard anyOn, let raw = Brain.cachedStable(context, key: "life_signals.v2"),
              let data = raw.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(Digest.self, from: data)
    }

    /// The formatted prompt section. Callers MUST gate on `!ai.cloudReachable` — see privacy rules.
    @MainActor
    static func contextSection(_ context: ModelContext) -> String? {
        guard let d = digest(context),
              !(d.doing.isEmpty && d.reading.isEmpty && d.people.isEmpty && d.notes.isEmpty) else { return nil }
        var lines = ["WHAT'S GOING ON IN THEIR LIFE (on-device digest — treat carefully)"]
        if !d.doing.isEmpty { lines.append("- Life threads (from their real activity): " + d.doing.joined(separator: "; ")) }
        if !d.reading.isEmpty {
            lines.append("- Reading/researching lately — things they LOOKED AT, not things they did or plan: "
                         + d.reading.joined(separator: "; "))
        }
        if !d.people.isEmpty { lines.append("- In touch with most: " + d.people.joined(separator: ", ")) }
        if !d.notes.isEmpty { lines.append(contentsOf: d.notes.map { "- \($0)" }) }
        lines.append("RULE: never assert anything here as an event or plan in their life unless it's a Life thread — and even those, mention lightly. When unsure, ignore this section entirely.")
        return lines.joined(separator: "\n")
    }

    // MARK: - Refresh (once a day, on-device)

    static func refresh(_ context: ModelContext, force: Bool = false) async {
        guard anyOn else { return }
        let last = UserDefaults.standard.double(forKey: "signals.refreshedAt")
        if !force, Date.now.timeIntervalSince1970 - last < 20 * 3600 { return }
        guard FoundationModelProvider.isAvailable else { return }   // on-device ONLY, by design

        // Sources are split by EPISTEMIC WEIGHT: what they DID (messages/calendar/reminders)
        // vs what they merely LOOKED AT (browsing). v1 mixed them and the model asserted news
        // articles as the user's own plans.
        var lived: [String] = []
        var looked: [String] = []
        if messagesOn, let m = messagesSource() { lived.append(m) }
        if calendarOn, let c = await calendarSource() { lived.append(c) }
        if Integrations.remindersOn {
            let rems = await EventBridge.incompleteReminders().prefix(10)
            if !rems.isEmpty {
                lived.append("OPEN REMINDERS:\n" + rems.map { r in
                    "- \(r.title)" + (r.due.map { " (due \($0.formatted(.dateTime.month().day())))" } ?? "")
                }.joined(separator: "\n"))
            }
        }
        if safariOn, let s = safariSource() { looked.append(s) }
        guard !(lived.isEmpty && looked.isEmpty) else { return }

        let prompt = """
        You are building a compact, private context sheet about one person from raw signals off
        their own computer. Reply with ONLY a JSON object shaped like {"doing": [array of up to 5
        short strings], "reading": [array of up to 5 short strings], "people": [array of up to 5
        names], "notes": [array of up to 3 short strings]}.

        HARD RULES — this sheet must be trustworthy, a wrong guess is worse than an empty field:
        - "doing" comes ONLY from the THEIR OWN LIFE section (their messages, calendar, reminders).
          Each entry needs at least TWO supporting signals. Never place browsing here.
        - "reading" comes from the BROWSING section: topics they're looking into. Reading about a
          thing is NOT doing it — a news story, a show, a sports event they read about belongs
          here or nowhere. Skip one-off visits, news-of-the-day, and entertainment headlines.
        - "people" = real person NAMES they exchange messages with. Never service or app names,
          never abbreviations or fragments. If you only see a phone number or a fragment, omit it.
        - "notes" = one-sentence reminders a thoughtful friend would keep (an upcoming event they
          are ATTENDING per calendar, a decision they're weighing in their own words).
        - Never invent, never embellish, never quote message text verbatim. Fewer, surer entries
          always beat more. Never echo this format description.

        === THEIR OWN LIFE (messages / calendar / reminders) ===
        \(lived.isEmpty ? "(no sources enabled)" : lived.joined(separator: "\n\n"))

        === BROWSING (things they looked at — weakest signal) ===
        \(looked.isEmpty ? "(no sources enabled)" : looked.joined(separator: "\n\n"))
        """
        guard let raw = try? await FoundationModelProvider().generate(prompt: prompt),
              let jsonStr = AIJSON.firstObject(in: raw),
              let data = jsonStr.data(using: .utf8),
              var d = try? JSONDecoder().decode(Digest.self, from: data) else { return }
        d.doing = d.doing.filter { AIJSON.isRealText($0, minLetters: 4) }.map { String($0.prefix(60)) }
        d.reading = d.reading.filter { AIJSON.isRealText($0, minLetters: 4) }.map { String($0.prefix(60)) }
        d.people = d.people.map { $0.trimmingCharacters(in: .whitespaces) }.filter { plausiblePersonName($0) }
        d.notes = d.notes.filter { AIJSON.isRealText($0) }.map { String($0.prefix(120)) }
        guard let out = try? JSONEncoder().encode(d), let payload = String(data: out, encoding: .utf8) else { return }
        await MainActor.run {
            Brain.store(context, key: "life_signals.v2", payload: payload, ttl: 2 * 86400)
        }
        UserDefaults.standard.set(Date.now.timeIntervalSince1970, forKey: "signals.refreshedAt")
    }

    /// Code-level backstop for the "people" list — v1 stored handle fragments ("Att", "Dm") and
    /// even "Claude" as people. A name needs to look like one, and never an AI/app/service.
    private static func plausiblePersonName(_ s: String) -> Bool {
        guard s.count >= 4, s.count <= 40 else { return false }
        guard s.rangeOfCharacter(from: .decimalDigits) == nil else { return false }
        let lower = s.lowercased()
        let services: Set<String> = ["claude", "chatgpt", "gemini", "siri", "gcash", "wise", "maya",
                                     "grab", "shopee", "lazada", "apple", "google", "globe", "smart", "dito"]
        guard !services.contains(lower) else { return false }
        return s.rangeOfCharacter(from: CharacterSet(charactersIn: "aeiouAEIOU")) != nil
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
            guard let host = url.host()?.replacingOccurrences(of: "www.", with: "") else { continue }
            domains[host, default: 0] += 1
            // Search terms ONLY from actual search engines — a bare `?q=`/`?p=` on a random site
            // is a pagination/tracking param, and v1's harvest of those junk params is exactly
            // where the phantom themes ("singing competition") came from.
            let param: String? =
                host.contains("google.") ? "q"
                : host.contains("bing.com") ? "q"
                : host.contains("duckduckgo.com") ? "q"
                : host.contains("youtube.com") ? "search_query"
                : host.contains("search.yahoo.") ? "p"
                : nil
            if let param,
               let comps = URLComponents(url: url, resolvingAgainstBaseURL: false),
               let q = comps.queryItems?.first(where: { $0.name == param })?.value,
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

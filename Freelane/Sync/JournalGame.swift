import Foundation

/// Gamified journaling. A streak you protect with earned coins, plus a GRADUAL recovery so a missed
/// day — or a trip — doesn't wipe out weeks of effort. Fully local (UserDefaults). "Covered" days are
/// ones bridged either by spending coins (freeze) or by answering recovery questions.
enum JournalGame {
    private static let d = UserDefaults.standard

    // MARK: Coins (the hidden currency)
    static var coins: Int {
        get { d.integer(forKey: "journal.coins") }
        set { d.set(max(0, newValue), forKey: "journal.coins") }
    }
    /// Reward for the Nth entry of a day (1-based): 5, 3, 2, 1, 1… — first pays most, extras still pay.
    static func reward(forRank n: Int) -> Int { n <= 1 ? 5 : max(1, 4 - (n - 1)) }

    /// Entry IDs already paid out — so coins are credited exactly once, even retroactively.
    static var creditedEntryIDs: Set<String> {
        get { Set(d.string(forKey: "journal.creditedIDs")?.split(separator: "\n").map(String.init) ?? []) }
        set { d.set(newValue.joined(separator: "\n"), forKey: "journal.creditedIDs") }
    }

    /// Credit coins for ANY uncredited entries (backfills past ones too). Idempotent — each entry is
    /// paid once, ranked within its day for the diminishing reward. Returns coins newly granted.
    @discardableResult
    static func reconcileCoins(entries: [(id: UUID, createdAt: Date)]) -> Int {
        var credited = creditedEntryIDs
        let cal = PHT.calendar
        let byDay = Dictionary(grouping: entries) { cal.startOfDay(for: $0.createdAt) }
        var earned = 0
        for (_, dayEntries) in byDay {
            for (idx, e) in dayEntries.sorted(by: { $0.createdAt < $1.createdAt }).enumerated() {
                let key = e.id.uuidString
                guard !credited.contains(key) else { continue }
                earned += reward(forRank: idx + 1)
                credited.insert(key)
            }
        }
        if earned > 0 { coins += earned; creditedEntryIDs = credited }
        return earned
    }

    static let freezeCost = 12          // coins to freeze today
    static let unbreakCostPerDay = 10   // coins per missed day to bridge instantly

    // MARK: Covered days (frozen or recovered)
    static var covered: Set<String> {
        get { Set(d.string(forKey: "journal.covered")?.split(separator: "\n").map(String.init) ?? []) }
        set { d.set(newValue.sorted().joined(separator: "\n"), forKey: "journal.covered") }
    }
    static func dayKey(_ date: Date) -> String {
        let c = PHT.calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    /// Every day that counts toward the streak: days you wrote + covered days.
    static func countedDays(entryDays: Set<String>) -> Set<String> { entryDays.union(covered) }

    /// Consecutive counted days ending today (or yesterday as a grace day).
    static func streak(entryDays: Set<String>) -> Int {
        let days = countedDays(entryDays: entryDays)
        guard !days.isEmpty else { return 0 }
        let cal = PHT.calendar
        var cursor = cal.startOfDay(for: Date())
        if !days.contains(dayKey(cursor)) {
            cursor = cal.date(byAdding: .day, value: -1, to: cursor)!
            if !days.contains(dayKey(cursor)) { return 0 }
        }
        var n = 0
        while days.contains(dayKey(cursor)) { n += 1; cursor = cal.date(byAdding: .day, value: -1, to: cursor)! }
        return n
    }

    // MARK: Freeze (spend coins to cover today)
    @discardableResult
    static func freezeToday() -> Bool {
        guard coins >= freezeCost else { return false }
        coins -= freezeCost
        var c = covered; c.insert(dayKey(Date())); covered = c
        return true
    }
    static func isFrozenToday() -> Bool { covered.contains(dayKey(Date())) }

    // MARK: Recovery — bridge a broken gap, gradually
    /// The live break: missed days between your last counted day and today (with one grace day for
    /// yesterday). Returns the missed day keys + how long the streak was before it broke.
    static func brokenGap(entryDays: Set<String>) -> (missed: [String], priorStreak: Int)? {
        let days = countedDays(entryDays: entryDays)
        guard !days.isEmpty else { return nil }
        let cal = PHT.calendar
        let today = cal.startOfDay(for: Date())
        if days.contains(dayKey(today)) || days.contains(dayKey(cal.date(byAdding: .day, value: -1, to: today)!)) {
            return nil   // today or yesterday counts → streak still alive
        }
        var cursor = cal.date(byAdding: .day, value: -1, to: today)!   // from yesterday backward
        var missed: [String] = []; var guardN = 0
        while !days.contains(dayKey(cursor)) && guardN < 90 { missed.append(dayKey(cursor)); cursor = cal.date(byAdding: .day, value: -1, to: cursor)!; guardN += 1 }
        guard days.contains(dayKey(cursor)) else { return nil }   // nothing before → no streak to recover
        var prior = 0; var c2 = cursor
        while days.contains(dayKey(c2)) { prior += 1; c2 = cal.date(byAdding: .day, value: -1, to: c2)! }
        return (missed, prior)
    }

    /// Questions to answer to bridge a gap — gradual: 3 for one day, 5 for two, more beyond.
    static func recoveryRequired(missedDays: Int) -> Int {
        switch missedDays {
        case ...0: return 0
        case 1: return 3
        case 2: return 5
        default: return 5 + (missedDays - 2) * 3
        }
    }

    // Persistent recovery — armed when a break is first seen, so it survives you resuming writing
    // (once you write today, the live gap disappears but recovery must continue).
    static var recoveryStartedAt: Date? {
        get { let v = d.double(forKey: "journal.recoveryStartedAt"); return v > 0 ? Date(timeIntervalSince1970: v) : nil }
        set { d.set(newValue?.timeIntervalSince1970 ?? 0, forKey: "journal.recoveryStartedAt") }
    }
    static var recoveryMissed: [String] {
        get { d.string(forKey: "journal.recoveryMissed")?.split(separator: "\n").map(String.init).filter { !$0.isEmpty } ?? [] }
        set { d.set(newValue.joined(separator: "\n"), forKey: "journal.recoveryMissed") }
    }
    /// Arm recovery the first time a live break is detected. Safe to call repeatedly (no-op once armed).
    static func armRecoveryIfNeeded(entryDays: Set<String>) {
        guard recoveryStartedAt == nil, let gap = brokenGap(entryDays: entryDays) else { return }
        recoveryMissed = gap.missed
        recoveryStartedAt = Date()
    }
    static func clearRecovery() { recoveryStartedAt = nil; recoveryMissed = [] }

    static func completeRecovery() {
        var c = covered; recoveryMissed.forEach { c.insert($0) }; covered = c
        clearRecovery()
    }
    /// Spend coins to bridge the armed gap instantly.
    @discardableResult
    static func unbreakWithCoins() -> Bool {
        let missed = recoveryMissed
        let cost = missed.count * unbreakCostPerDay
        guard coins >= cost, !missed.isEmpty else { return false }
        coins -= cost
        completeRecovery()
        return true
    }
}

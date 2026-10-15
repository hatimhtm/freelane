import Foundation

/// Date wording used across v2, always in Manila time.
enum Day {
    private static func fmt(_ f: String) -> DateFormatter {
        let d = DateFormatter(); d.locale = Locale(identifier: "en_GB"); d.timeZone = PHT.zone; d.dateFormat = f; return d
    }
    private static let long = fmt("EEEE d MMMM"), short = fmt("EEE d MMM"), dayMonth = fmt("d MMM"), month = fmt("MMMM"), monthYear = fmt("MMMM yyyy"), dmy = fmt("d MMM yyyy")

    /// "Friday 16 October"
    static func long(_ d: Date) -> String { long.string(from: d) }
    /// "Sun 1 Nov"
    static func short(_ d: Date) -> String { short.string(from: d) }
    /// "1 Nov"
    static func dayMonth(_ d: Date) -> String { dayMonth.string(from: d) }
    /// "October"
    static func month(_ d: Date) -> String { month.string(from: d) }
    static func monthYear(_ d: Date) -> String { monthYear.string(from: d) }
    /// "9 Jul 2027"
    static func full(_ d: Date) -> String { dmy.string(from: d) }

    static func daysBetween(_ a: Date, _ b: Date) -> Int {
        PHT.calendar.dateComponents([.day], from: PHT.calendar.startOfDay(for: a), to: PHT.calendar.startOfDay(for: b)).day ?? 0
    }
    /// "today", "tomorrow", "in 16 days"
    static func until(_ d: Date, from now: Date = .now) -> String {
        let n = daysBetween(now, d)
        switch n { case 0: return "today"; case 1: return "tomorrow"; case ..<0: return "\(-n) days ago"; default: return "in \(n) days" }
    }
    /// "yesterday", "counted 23 Sep"
    static func ago(_ d: Date, from now: Date = .now) -> String {
        let n = daysBetween(d, now)
        switch n { case 0: return "today"; case 1: return "yesterday"; default: return dayMonth(d) }
    }
}

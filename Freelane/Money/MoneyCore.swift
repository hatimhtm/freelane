import Foundation
import os

/// One logger for money-math anomalies that must never fail silently.
let moneyLog = Logger(subsystem: "app.freelane.mac", category: "money")

// MARK: - Rounding & currency helpers

/// Round to 2 decimal places — matches `Math.round(x * 100) / 100` in the web app.
@inline(__always)
func round2(_ x: Double) -> Double { (x * 100).rounded() / 100 }

/// Snapshot of exchange rates: code → rateToBase (amountNative * rate = amountBase).
struct Rates {
    let base: String
    private let table: [String: Double]

    init(base: String, rates: [ExchangeRate]) {
        self.base = base
        var t: [String: Double] = [:]
        for r in rates { t[r.code] = r.rateToBase }
        t[base] = 1
        self.table = t
    }

    /// Convert a native amount into base currency.
    ///
    /// A known rate (incl. `base` itself, which is seeded to 1) converts normally. An
    /// *unknown* currency used to silently fall back to ×1 — which let a missing FX rate
    /// masquerade as a real conversion and quietly misstate every base total. We now warn
    /// loudly (and the caller can see, via `hasRate`, whether the number is trustworthy).
    /// The ×1 is kept only as a last resort so the figure isn't zeroed.
    func toBase(_ amount: Double, _ currency: String) -> Double {
        if let r = table[currency] { return amount * r }
        moneyLog.warning("Rates.toBase: no FX rate for \(currency, privacy: .public) (base \(self.base, privacy: .public)); using 1:1 — base totals may be wrong.")
        return amount
    }

    /// Whether a real (non-fallback) rate exists for this code — lets UI flag suspect conversions.
    func hasRate(for code: String) -> Bool { table[code] != nil }

    func rate(for code: String) -> Double { table[code] ?? 1 }
}

// MARK: - Currency formatting

enum CurrencyFormat {
    static let symbols: [String: String] = [
        "PHP": "₱", "USD": "$", "EUR": "€", "MAD": "DH", "CNY": "¥",
        "GBP": "£", "JPY": "¥", "AED": "د.إ", "SGD": "S$", "AUD": "A$",
        "USDT": "₮", "USDC": "$",
    ]

    /// Every currency the app offers in pickers. Live FX must cover all of these so
    /// nothing silently converts 1:1 (see `Rates.toBase`). Stablecoins are pegged to USD.
    static let supported = ["PHP", "USD", "EUR", "MAD", "CNY", "GBP", "JPY", "AED", "SGD", "AUD", "USDT", "USDC"]
    /// Codes the fiat FX feed (frankfurter/ECB) does NOT carry — pegged to USD instead.
    static let usdPegged: Set<String> = ["USDT", "USDC"]

    static func symbol(_ code: String) -> String { symbols[code] ?? code }

    /// "₱12,340.50" style. Drops the decimals when whole and `compact` is true.
    static func string(_ amount: Double, _ code: String, compact: Bool = false) -> String {
        // Snap floating-point dust to zero so a balance that rounds to 0.00 never
        // renders as "-0.00" (anything under half a cent is zero at 2-decimal display).
        let amount = abs(amount) < 0.005 ? 0 : amount
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.maximumFractionDigits = (compact && amount == amount.rounded()) ? 0 : 2
        f.minimumFractionDigits = (compact && amount == amount.rounded()) ? 0 : 2
        let n = f.string(from: NSNumber(value: amount)) ?? "\(amount)"
        return symbol(code) + n
    }

    /// "₱12.3k" / "₱1.2M" for tight stat tiles.
    static func abbreviated(_ amount: Double, _ code: String) -> String {
        let sym = symbol(code)
        let a = abs(amount)
        let sign = amount < 0 ? "-" : ""
        switch a {
        case 1_000_000...:
            return "\(sign)\(sym)\(String(format: "%.1fM", a / 1_000_000))"
        case 10_000...:
            return "\(sign)\(sym)\(String(format: "%.0fk", a / 1_000))"
        case 1_000...:
            return "\(sign)\(sym)\(String(format: "%.1fk", a / 1_000))"
        default:
            return "\(sign)\(sym)\(String(format: "%.0f", a))"
        }
    }
}

// MARK: - Date helpers (PHT windowing, matching the web app's UTC+8 day math)

enum PHT {
    static var zone: TimeZone { TimeZone(identifier: "Asia/Manila") ?? TimeZone(secondsFromGMT: 8 * 3600)! }

    static var calendar: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = zone
        return c
    }

    static func startOfDay(_ date: Date = .now) -> Date { calendar.startOfDay(for: date) }

    static func startOfMonth(_ date: Date = .now) -> Date {
        let comps = calendar.dateComponents([.year, .month], from: date)
        return calendar.date(from: comps) ?? date
    }

    static func startOfYear(_ date: Date = .now) -> Date {
        let comps = calendar.dateComponents([.year], from: date)
        return calendar.date(from: comps) ?? date
    }

    static func startOfWeek(_ date: Date = .now) -> Date {
        var c = calendar
        c.firstWeekday = 2 // Monday
        let comps = c.dateComponents([.yearForWeekOfYear, .weekOfYear], from: date)
        return c.date(from: comps) ?? date
    }

    static func daysAgo(_ n: Int, from date: Date = .now) -> Date {
        calendar.date(byAdding: .day, value: -n, to: startOfDay(date)) ?? date
    }

    /// "yyyy-MM-dd" in PHT — a stable per-day key for daily logs (prayers, fasting…).
    static func dayKey(_ date: Date = .now) -> String {
        // Invariant: the day key is locale-independent (fixed Latin digits) so stored keys survive locale changes.
        let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX")
        f.calendar = calendar; f.timeZone = zone; f.dateFormat = "yyyy-MM-dd"
        return f.string(from: date)
    }
}

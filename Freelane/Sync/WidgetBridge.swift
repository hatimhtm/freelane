import Foundation
import SwiftData
import WidgetKit

/// Writes a small JSON snapshot the widget reads (sandbox is off, so the widget
/// reads it directly from Application Support), then asks WidgetKit to reload.
@MainActor
enum WidgetBridge {
    struct Payload: Codable {
        var safeToday: Double, initialToday: Double, walletTotal: Double
        var outstanding: Double, landedMTD: Double, symbol: String, updatedAt: Date
        var bills: [WBill] = []
        // Next scheduled income — for the Next Income widget.
        var nextPayLabel: String? = nil
        var nextPayAmount: Double? = nil
        var nextPayDue: String? = nil
        // Faith — for the Next Prayer widget: the 5 times "HH:mm" (Fajr…Isha), a precomputed
        // "next" for fallback, and today's Hijri date.
        var prayerTimes: [String]? = nil
        var nextPrayerName: String? = nil
        var nextPrayerTime: String? = nil
        var hijri: String? = nil
    }
    struct WBill: Codable { var label: String; var amount: Double; var due: String }

    static func update(_ context: ModelContext) {
        let d = StateSnapshot.load(context)
        let safe = SafeToSpend.compute(payments: d.payments, spends: d.spends, wallets: d.wallets,
                                       ledger: d.ledger, recurrings: d.recurrings, plans: d.plans)
        // The next 3 upcoming bills — for the large widget.
        let bills = d.recurrings.filter { $0.active && $0.kind == .expense }
            .compactMap { r -> (Date, WBill)? in
                guard let due = RecurringMath.nextDue(r) else { return nil }
                return (due, WBill(label: r.label, amount: r.amountBase, due: due.formatted(.dateTime.month().day())))
            }
            .sorted { $0.0 < $1.0 }.prefix(3).map { $0.1 }
        // The soonest scheduled income — for the Next Income widget.
        let nextInc = d.recurrings.filter { $0.active && $0.kind == .income && $0.deletedAt == nil }
            .compactMap { r -> (Date, String, Double)? in
                RecurringMath.nextDue(r).map { ($0, r.label, r.amountBase) }
            }
            .min { $0.0 < $1.0 }
        // Faith — cached prayer times for the saved location + the next upcoming prayer.
        let prayer = Self.prayerInfo()
        let payload = Payload(
            safeToday: safe.liveRemaining, initialToday: safe.initialForToday, walletTotal: safe.walletTotal,
            outstanding: d.metrics.outstandingBase, landedMTD: d.metrics.landedMTD,
            symbol: CurrencyFormat.symbol(d.baseCurrency), updatedAt: .now, bills: Array(bills),
            nextPayLabel: nextInc?.1, nextPayAmount: nextInc?.2,
            nextPayDue: nextInc.map { $0.0.formatted(.dateTime.month().day()) },
            prayerTimes: prayer?.times, nextPrayerName: prayer?.nextName, nextPrayerTime: prayer?.nextTime,
            hijri: FaithService.hijriToday())
        if let data = try? JSONEncoder().encode(payload) {
            try? data.write(to: Self.widgetFileURL)
            // Mirror to the plain app-support path too (harmless), so either resolver finds it.
            try? data.write(to: AppPaths.root.appendingPathComponent("widget.json"))
        }
        WidgetCenter.shared.reloadAllTimelines()
    }

    /// Cached prayer times for the saved Faith location + the next upcoming prayer of the five.
    /// Reads the same UserDefaults keys the Faith screen writes (faith.lat/lng/method).
    private static func prayerInfo() -> (times: [String], nextName: String?, nextTime: String?)? {
        let u = UserDefaults.standard
        let lat = u.object(forKey: "faith.lat") as? Double ?? 14.0667
        let lng = u.object(forKey: "faith.lng") as? Double ?? 121.3250
        let method = u.object(forKey: "faith.method") as? Int ?? 2
        guard let t = FaithService.cached(lat: lat, lng: lng, method: method) else { return nil }
        let names = ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"]
        let times = [t.fajr, t.dhuhr, t.asr, t.maghrib, t.isha]
        let cal = PHT.calendar
        func at(_ hhmm: String) -> Date? {
            let p = hhmm.split(separator: ":")
            guard p.count == 2, let h = Int(p[0]), let m = Int(p[1]) else { return nil }
            var c = cal.dateComponents([.year, .month, .day], from: .now); c.hour = h; c.minute = m
            return cal.date(from: c)
        }
        let now = Date()
        for (n, hhmm) in zip(names, times) where (at(hhmm) ?? .distantPast) > now {
            return (times, n, hhmm)
        }
        return (times, "Fajr", times.first)   // all five passed today → tomorrow's Fajr
    }

    /// Prefer the App Group container (shared with the sandboxed widget); fall back to
    /// the app's Application Support folder if no group is configured yet.
    static let appGroup = "group.app.freelane.mac"
    static var widgetFileURL: URL {
        if let g = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup) {
            return g.appendingPathComponent("widget.json")
        }
        return AppPaths.root.appendingPathComponent("widget.json")
    }
}

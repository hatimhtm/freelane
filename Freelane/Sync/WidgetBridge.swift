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
        // v2: free money under the bill rule, what's set aside and for what, and whether this month's bills are paid.
        var free: Double? = nil
        var setAside: Double? = nil
        var setAsideFor: String? = nil
        var billsPaidMonth: String? = nil
    }
    struct WBill: Codable {
        var label: String; var amount: Double; var due: String
        var until: String? = nil      // "in 16 days"
        var estimate: Bool? = nil
    }

    static func update(_ context: ModelContext) {
        guard !DevMode.isSandboxed else { return }   // a test copy must never repaint the real widget
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
        // v2's picture, the same numbers the app and the menu bar show.
        let v2 = picture(context)
        let upcoming = v2.bills.filter { $0.coveredUntil == nil && $0.nextDue != nil }.prefix(4).map { b in
            WBill(label: b.label, amount: b.amount, due: Day.dayMonth(b.nextDue!), until: Day.until(b.nextDue!), estimate: b.estimate)
        }
        let reserved = v2.bills.filter(\.isSetAside).map(\.label)
        var payload = Payload(
            safeToday: safe.liveRemaining, initialToday: safe.initialForToday, walletTotal: v2.total,
            outstanding: d.metrics.outstandingBase, landedMTD: d.metrics.landedMTD,
            symbol: CurrencyFormat.symbol(d.baseCurrency), updatedAt: .now, bills: upcoming.isEmpty ? Array(bills) : Array(upcoming),
            nextPayLabel: nextInc?.1, nextPayAmount: nextInc?.2,
            nextPayDue: nextInc.map { $0.0.formatted(.dateTime.month().day()) },
            prayerTimes: prayer?.times, nextPrayerName: prayer?.nextName, nextPrayerTime: prayer?.nextTime,
            hijri: FaithService.hijriToday())
        payload.free = v2.free
        payload.setAside = v2.setAside
        payload.setAsideFor = reserved.isEmpty ? nil : ListFormatter.localizedString(byJoining: reserved)
        payload.billsPaidMonth = v2.monthBillsPaid ? Day.month(.now) : nil
        if let data = try? JSONEncoder().encode(payload) {
            try? data.write(to: Self.widgetFileURL)
            // Mirror to the plain app-support path too (harmless), so either resolver finds it.
            try? data.write(to: AppPaths.root.appendingPathComponent("widget.json"))
        }
        WidgetCenter.shared.reloadAllTimelines()
    }

    /// The v2 money picture, built from the store the same way the window builds it.
    private static func picture(_ context: ModelContext) -> MoneyState {
        func all<T: PersistentModel>(_ t: T.Type) -> [T] { (try? context.fetch(FetchDescriptor<T>())) ?? [] }
        let base = all(AppSettings.self).first?.baseCurrency ?? "PHP"
        return MoneyState.build(wallets: all(Wallet.self), ledger: all(LedgerEntry.self), recurring: all(Recurring.self),
                                spends: all(Spend.self).sorted { $0.spentAt > $1.spentAt }, payments: all(Payment.self),
                                withdrawals: all(Withdrawal.self), projects: all(Project.self), clients: all(Client.self),
                                rates: Rates(base: base, rates: all(ExchangeRate.self)))
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

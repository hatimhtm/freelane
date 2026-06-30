import Foundation
@preconcurrency import UserNotifications

struct PrayerTimes: Equatable, Codable {
    var fajr, sunrise, dhuhr, asr, maghrib, isha: String
}

/// The five obligatory prayers we track (Sunrise is shown but not "prayed").
let obligatoryPrayers = ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"]

/// Prayer times (Aladhan REST, cached for offline), qibla bearing, the Hijri date, and
/// prayer-time reminder scheduling — all real.
enum FaithService {
    static let methods: [(id: Int, name: String)] = [
        (2, "ISNA"), (3, "Muslim World League"), (5, "Egyptian"),
        (4, "Umm al-Qura"), (1, "Karachi"), (8, "Gulf"), (12, "France")
    ]

    /// Result of a fetch: the times + whether they came live or from the offline cache.
    struct Result { let times: PrayerTimes; let fromCache: Bool }

    private static func cacheKey(_ lat: Double, _ lng: Double, _ method: Int) -> String {
        "faith.times.\(String(format: "%.3f", lat)),\(String(format: "%.3f", lng)),\(method)"
    }
    static func cached(lat: Double, lng: Double, method: Int) -> PrayerTimes? {
        guard let data = UserDefaults.standard.data(forKey: cacheKey(lat, lng, method)) else { return nil }
        return try? JSONDecoder().decode(PrayerTimes.self, from: data)
    }

    /// Fetch today's times; on any network failure, fall back to the last cached times so
    /// the UI never sits at a silent "—".
    static func fetch(lat: Double, lng: Double, method: Int) async -> Result? {
        let f = DateFormatter()
        f.calendar = PHT.calendar; f.timeZone = PHT.zone; f.dateFormat = "dd-MM-yyyy"
        let date = f.string(from: .now)
        let fallback = cached(lat: lat, lng: lng, method: method)
        guard let url = URL(string: "https://api.aladhan.com/v1/timings/\(date)?latitude=\(lat)&longitude=\(lng)&method=\(method)") else {
            return fallback.map { Result(times: $0, fromCache: true) }
        }
        guard let (data, _) = try? await URLSession.shared.data(from: url),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let dataObj = json["data"] as? [String: Any],
              let t = dataObj["timings"] as? [String: String] else {
            return fallback.map { Result(times: $0, fromCache: true) }
        }
        func clean(_ k: String) -> String {
            (t[k] ?? "—").components(separatedBy: " ").first ?? "—"   // strip "(PHT)" suffix
        }
        let times = PrayerTimes(fajr: clean("Fajr"), sunrise: clean("Sunrise"), dhuhr: clean("Dhuhr"),
                                asr: clean("Asr"), maghrib: clean("Maghrib"), isha: clean("Isha"))
        if let enc = try? JSONEncoder().encode(times) {
            UserDefaults.standard.set(enc, forKey: cacheKey(lat, lng, method))
        }
        return Result(times: times, fromCache: false)
    }

    /// Are we in Ramadan (Hijri month 9) right now?
    static func isRamadan() -> Bool {
        var cal = Calendar(identifier: .islamicUmmAlQura)
        cal.timeZone = PHT.zone
        return cal.component(.month, from: .now) == 9
    }

    private static func hourMinute(_ hhmm: String) -> (Int, Int)? {
        let parts = hhmm.split(separator: ":")
        guard parts.count == 2, let h = Int(parts[0]), let m = Int(parts[1]) else { return nil }
        return (h, m)
    }

    /// (Re)schedule a daily reminder at each obligatory prayer time. Identifiers are
    /// "prayer-<name>" so they coexist with the daily digest. No-op (and clears) when off.
    static func scheduleNotifications(_ times: PrayerTimes, enabled: Bool) {
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: obligatoryPrayers.map { "prayer-\($0)" })
        guard enabled else { return }
        let byName: [String: String] = ["Fajr": times.fajr, "Dhuhr": times.dhuhr, "Asr": times.asr,
                                        "Maghrib": times.maghrib, "Isha": times.isha]
        for name in obligatoryPrayers {
            guard let t = byName[name], let (h, m) = hourMinute(t) else { continue }
            var comps = DateComponents(); comps.hour = h; comps.minute = m
            let c = UNMutableNotificationContent()
            c.title = "\(name) 🕌"; c.body = "It's time for \(name)."; c.sound = .default
            let trig = UNCalendarNotificationTrigger(dateMatching: comps, repeats: true)
            center.add(UNNotificationRequest(identifier: "prayer-\(name)", content: c, trigger: trig))
        }
    }

    /// Initial great-circle bearing to the Kaaba, degrees clockwise from true north.
    static func qiblaBearing(lat: Double, lng: Double) -> Double {
        let kLat = 21.4225 * .pi / 180, kLng = 39.8262 * .pi / 180
        let p1 = lat * .pi / 180, l1 = lng * .pi / 180
        let dL = kLng - l1
        let y = sin(dL) * cos(kLat)
        let x = cos(p1) * sin(kLat) - sin(p1) * cos(kLat) * cos(dL)
        let deg = atan2(y, x) * 180 / .pi
        return (deg + 360).truncatingRemainder(dividingBy: 360)
    }

    static func hijriToday() -> String {
        var cal = Calendar(identifier: .islamicUmmAlQura)
        cal.locale = Locale(identifier: "en")
        let df = DateFormatter()
        df.calendar = cal; df.locale = Locale(identifier: "en"); df.timeZone = PHT.zone
        df.dateFormat = "d MMMM yyyy"
        return df.string(from: .now) + " AH"
    }
}

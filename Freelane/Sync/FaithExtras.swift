import Foundation

/// Voluntary (Sunnah/Nafl) prayers tracked alongside the five obligatory — logged through the same
/// PrayerLog (its `prayer` string is free-form).
enum SunnahPrayer: String, CaseIterable, Identifiable {
    case tahajjud = "Tahajjud", witr = "Witr", duha = "Duha"
    var id: String { rawValue }
    var icon: String {
        switch self { case .tahajjud: return "moon.zzz.fill"; case .witr: return "moon.fill"; case .duha: return "sun.and.horizon.fill" }
    }
    var note: String {
        switch self { case .tahajjud: return "Night prayer"; case .witr: return "After Isha"; case .duha: return "Forenoon" }
    }
}

/// A daily rotating ayah / hadith for the Today + Faith cards — bundled (no network), Arabic +
/// translation, day-indexed so it changes each day and is stable within a day.
struct DailyVerse {
    let arabic: String
    let translation: String
    let source: String

    static let all: [DailyVerse] = [
        .init(arabic: "إِنَّ مَعَ الْعُسْرِ يُسْرًا", translation: "Indeed, with hardship comes ease.", source: "Qur'an 94:6"),
        .init(arabic: "فَاذْكُرُونِي أَذْكُرْكُمْ", translation: "So remember Me; I will remember you.", source: "Qur'an 2:152"),
        .init(arabic: "وَقُل رَّبِّ زِدْنِي عِلْمًا", translation: "And say: My Lord, increase me in knowledge.", source: "Qur'an 20:114"),
        .init(arabic: "إِنَّ اللَّهَ مَعَ الصَّابِرِينَ", translation: "Indeed, Allah is with the patient.", source: "Qur'an 2:153"),
        .init(arabic: "وَمَن يَتَّقِ اللَّهَ يَجْعَل لَّهُ مَخْرَجًا", translation: "Whoever is mindful of Allah, He will make a way out for them.", source: "Qur'an 65:2"),
        .init(arabic: "إِنَّمَا الْأَعْمَالُ بِالنِّيَّاتِ", translation: "Actions are but by intention.", source: "Hadith — Bukhari"),
        .init(arabic: "الدِّينُ النَّصِيحَةُ", translation: "Religion is sincerity.", source: "Hadith — Muslim"),
        .init(arabic: "خَيْرُكُمْ مَنْ تَعَلَّمَ الْقُرْآنَ وَعَلَّمَهُ", translation: "The best of you are those who learn the Qur'an and teach it.", source: "Hadith — Bukhari"),
        .init(arabic: "مَنْ لَا يَرْحَمُ لَا يُرْحَمُ", translation: "Whoever does not show mercy will not be shown mercy.", source: "Hadith — Bukhari"),
        .init(arabic: "وَأَن لَّيْسَ لِلْإِنسَانِ إِلَّا مَا سَعَىٰ", translation: "Man shall have nothing but what he strives for.", source: "Qur'an 53:39"),
        .init(arabic: "رَبَّنَا آتِنَا فِي الدُّنْيَا حَسَنَةً", translation: "Our Lord, give us good in this world.", source: "Qur'an 2:201"),
        .init(arabic: "وَهُوَ مَعَكُمْ أَيْنَ مَا كُنتُمْ", translation: "And He is with you wherever you are.", source: "Qur'an 57:4"),
        .init(arabic: "تَبَسُّمُكَ فِي وَجْهِ أَخِيكَ صَدَقَةٌ", translation: "Your smile for your brother is charity.", source: "Hadith — Tirmidhi"),
        .init(arabic: "الْمُسْلِمُ مَنْ سَلِمَ النَّاسُ مِنْ لِسَانِهِ وَيَدِهِ", translation: "The Muslim is one from whose tongue and hand people are safe.", source: "Hadith — Bukhari"),
    ]

    static func today() -> DailyVerse {
        let day = Calendar(identifier: .gregorian).ordinality(of: .day, in: .year, for: Date()) ?? 1
        return all[day % all.count]
    }
}

/// A tap-counter for after-prayer dhikr (SubhanAllah ×33 …). Count + target in UserDefaults so it
/// survives navigation; resets when the target is reached or by the user.
enum Tasbih {
    static var count: Int {
        get { UserDefaults.standard.integer(forKey: "tasbih.count") }
        set { UserDefaults.standard.set(max(0, newValue), forKey: "tasbih.count") }
    }
    static var target: Int {
        get { let t = UserDefaults.standard.integer(forKey: "tasbih.target"); return t == 0 ? 33 : t }
        set { UserDefaults.standard.set(newValue, forKey: "tasbih.target") }
    }
    static func tap() { count += 1 }
    static func reset() { count = 0 }
}

/// Qadā — prayers / fasts owed and being made up. Simple counters (no schema change), nudged down
/// as you make them up.
enum Qada {
    static var prayers: Int {
        get { UserDefaults.standard.integer(forKey: "qada.prayers") }
        set { UserDefaults.standard.set(max(0, newValue), forKey: "qada.prayers") }
    }
    static var fasts: Int {
        get { UserDefaults.standard.integer(forKey: "qada.fasts") }
        set { UserDefaults.standard.set(max(0, newValue), forKey: "qada.fasts") }
    }
}

/// Suhoor/Iftar clock during Ramadan, derived from the day's prayer times (suhoor ends at Fajr,
/// iftar is at Maghrib). Returns the next relevant countdown.
enum RamadanClock {
    /// (label, target time string "HH:mm") for the next event, or nil if times unavailable.
    static func next(times: PrayerTimes) -> (label: String, target: Date)? {
        let cal = PHT.calendar
        func at(_ hhmm: String) -> Date? {
            let p = hhmm.split(separator: ":"); guard p.count == 2, let h = Int(p[0]), let m = Int(p[1]) else { return nil }
            var c = cal.dateComponents([.year, .month, .day], from: .now); c.hour = h; c.minute = m
            return cal.date(from: c)
        }
        guard let fajr = at(times.fajr), let maghrib = at(times.maghrib) else { return nil }
        let now = Date()
        if now < fajr { return ("Suhoor ends", fajr) }
        if now < maghrib { return ("Iftar in", maghrib) }
        return ("Suhoor ends", cal.date(byAdding: .day, value: 1, to: fajr) ?? fajr)
    }

    /// Which of the last 10 nights of Ramadan it is (1...10), or nil if not yet. Uses Hijri day.
    static func lastTenNight() -> Int? {
        var hijri = Calendar(identifier: .islamicUmmAlQura); hijri.timeZone = PHT.zone
        let comps = hijri.dateComponents([.month, .day], from: Date())
        guard comps.month == 9, let day = comps.day, day >= 21 else { return nil }
        return day - 20   // day 21 → night 1 of the last ten
    }
}

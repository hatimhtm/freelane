import Foundation

/// Quran reading: surah list + ayah text from alquran.cloud (cached for offline, like the prayer
/// times), plus a local reading position so you can pick up where you left off. No 6 MB bundle —
/// each surah is fetched once and cached.
struct Surah: Codable, Identifiable, Equatable {
    let number: Int
    let name: String          // Arabic
    let englishName: String
    let englishTranslation: String
    let ayahs: Int
    var id: Int { number }
}

struct Ayah: Codable, Identifiable, Equatable {
    let numberInSurah: Int
    let arabic: String
    let translation: String
    var id: Int { numberInSurah }
}

enum QuranService {
    // MARK: Reading position (UserDefaults)
    static var surah: Int {
        get { let s = UserDefaults.standard.integer(forKey: "quran.surah"); return s == 0 ? 1 : s }
        set { UserDefaults.standard.set(newValue, forKey: "quran.surah") }
    }
    static var ayah: Int {
        get { let a = UserDefaults.standard.integer(forKey: "quran.ayah"); return a == 0 ? 1 : a }
        set { UserDefaults.standard.set(newValue, forKey: "quran.ayah") }
    }
    static func setPosition(surah s: Int, ayah a: Int) { surah = s; ayah = a }

    /// Distinct surahs the user has opened — a rough "progress".
    static func markRead(surah s: Int) {
        var set = Set(UserDefaults.standard.array(forKey: "quran.read") as? [Int] ?? [])
        set.insert(s)
        UserDefaults.standard.set(Array(set), forKey: "quran.read")
    }
    static var readCount: Int { (UserDefaults.standard.array(forKey: "quran.read") as? [Int])?.count ?? 0 }

    // MARK: Surah list (cached)
    static func surahList() async -> [Surah] {
        if let cached = load([Surah].self, "quran.surahlist"), !cached.isEmpty { return cached }
        guard let url = URL(string: "https://api.alquran.cloud/v1/surah"),
              let (data, _) = try? await URLSession.shared.data(from: url),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let arr = json["data"] as? [[String: Any]] else { return [] }
        let list: [Surah] = arr.compactMap { d in
            guard let n = d["number"] as? Int, let name = d["name"] as? String,
                  let en = d["englishName"] as? String, let ayahs = d["numberOfAyahs"] as? Int else { return nil }
            return Surah(number: n, name: name, englishName: en,
                         englishTranslation: d["englishNameTranslation"] as? String ?? "", ayahs: ayahs)
        }
        save(list, "quran.surahlist")
        return list
    }

    /// Ayahs of one surah (Arabic + English), cached per surah.
    static func ayahs(surah n: Int) async -> [Ayah] {
        let key = "quran.surah.\(n)"
        if let cached = load([Ayah].self, key), !cached.isEmpty { return cached }
        guard let url = URL(string: "https://api.alquran.cloud/v1/surah/\(n)/editions/quran-uthmani,en.asad"),
              let (data, _) = try? await URLSession.shared.data(from: url),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let editions = json["data"] as? [[String: Any]], editions.count >= 2,
              let ar = (editions[0]["ayahs"] as? [[String: Any]]),
              let en = (editions[1]["ayahs"] as? [[String: Any]]) else { return [] }
        var out: [Ayah] = []
        for i in 0..<min(ar.count, en.count) {
            let num = ar[i]["numberInSurah"] as? Int ?? (i + 1)
            out.append(Ayah(numberInSurah: num,
                            arabic: ar[i]["text"] as? String ?? "",
                            translation: en[i]["text"] as? String ?? ""))
        }
        save(out, key)
        return out
    }

    // MARK: Tiny cache
    private static func load<T: Decodable>(_ type: T.Type, _ key: String) -> T? {
        guard let data = UserDefaults.standard.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(T.self, from: data)
    }
    private static func save<T: Encodable>(_ value: T, _ key: String) {
        if let data = try? JSONEncoder().encode(value) { UserDefaults.standard.set(data, forKey: key) }
    }
}

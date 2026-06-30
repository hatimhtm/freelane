import Foundation

/// Robust JSON extraction from model output. Replaces the old key-scanning regex helpers, which
/// failed silently on a stray quote or nested object. Finds the first BALANCED `{…}` (ignoring
/// braces inside strings), so it survives ```json fences, leading prose, and trailing text.
enum AIJSON {
    static func decode<T: Decodable>(_ type: T.Type, from raw: String) -> T? {
        guard let obj = firstObject(in: raw), let data = obj.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(T.self, from: data)
    }

    static func firstObject(in s: String) -> String? {
        guard let start = s.firstIndex(of: "{") else { return nil }
        var depth = 0, inString = false, escaped = false
        var i = start
        while i < s.endIndex {
            let ch = s[i]
            if escaped { escaped = false }
            else if ch == "\\" { escaped = true }
            else if ch == "\"" { inString.toggle() }
            else if !inString {
                if ch == "{" { depth += 1 }
                else if ch == "}" { depth -= 1; if depth == 0 { return String(s[start...i]) } }
            }
            i = s.index(after: i)
        }
        return nil   // unbalanced → no usable object
    }
}

/// The structured result of `understandSpend` — what the model returns about one logged spend.
/// Snake_case keys match the prompt's requested shape.
struct UnderstoodSpend: Codable {
    var category: String?
    var merchant: String?
    var merchant_type: String?
    var domain: String?
    var person_name: String?
    var confidence: Double?

    var safeCategory: String { (category ?? "").trimmingCharacters(in: .whitespaces) }
    var safeMerchant: String { (merchant ?? "").trimmingCharacters(in: .whitespaces) }
    var safeMerchantType: String { (merchant_type ?? "unknown").lowercased() }
    var safeDomain: String { (domain ?? "").trimmingCharacters(in: .whitespaces) }
    var safePerson: String { (person_name ?? "").trimmingCharacters(in: .whitespaces) }
    var safeConfidence: Double { confidence ?? 0.5 }
}

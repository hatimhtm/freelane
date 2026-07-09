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

    /// True when a model-returned string is real content — not an echoed placeholder. The macOS 27
    /// on-device model can copy an example shape literally ("…", "...", "question 1"), which is
    /// valid JSON and non-empty, so shape checks alone don't catch it. Rule: enough actual letters
    /// to be a sentence. Every parser that STORES model text must pass through this.
    static func isRealText(_ s: String, minLetters: Int = 8) -> Bool {
        let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        guard t.count >= 10 else { return false }
        // An echoed schema description ("<one question or empty string>") is not content.
        guard !t.hasPrefix("<"), !t.hasPrefix("[") else { return false }
        let letters = t.unicodeScalars.filter { CharacterSet.letters.contains($0) }.count
        guard letters >= minLetters else { return false }
        // An echoed template artifact, not content ("question 1", "insight 2", "text", "prompt 3").
        let lowered = t.lowercased()
        let artifacts = ["question", "insight", "prompt", "text", "string", "example"]
        if artifacts.contains(where: { lowered == $0 }) { return false }
        if artifacts.contains(where: { a in lowered.hasPrefix(a) && t.count <= a.count + 3 }) { return false }
        return true
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

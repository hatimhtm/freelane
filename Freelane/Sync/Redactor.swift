import Foundation

/// Pre-prompt privacy pass: replaces sensitive words with `<sensitive>` BEFORE any text is sent
/// to a cloud model. Health/medical/relationship-private terms are redacted by default; the user
/// can disable categories. On-device prompts are never redacted (they never leave the Mac).
enum Redactor {
    /// Keyword groups → the categories the user can toggle off (default ON).
    static let groups: [String: [String]] = [
        "health":   ["psychiatrist", "psychologist", "therapy", "therapist", "doctor", "clinic",
                     "hospital", "medication", "prescription", "rehab", "counseling", "counsellor"],
        "intimate": ["divorce", "lawyer", "affair", "abortion", "addiction"],
    ]

    static func categoryEnabled(_ cat: String) -> Bool {
        UserDefaults.standard.object(forKey: "redact.\(cat)") as? Bool ?? true
    }
    static func setCategory(_ cat: String, _ on: Bool) { UserDefaults.standard.set(on, forKey: "redact.\(cat)") }

    /// Redact for a CLOUD prompt. No-op when the on-device model handles the call (private).
    static func forCloud(_ text: String, onDevice: Bool) -> String {
        guard !onDevice else { return text }
        var out = text
        for (cat, words) in groups where categoryEnabled(cat) {
            for w in words {
                // Whole-word, case-insensitive.
                if let re = try? NSRegularExpression(pattern: "\\b\(NSRegularExpression.escapedPattern(for: w))\\b", options: [.caseInsensitive]) {
                    let range = NSRange(out.startIndex..., in: out)
                    out = re.stringByReplacingMatches(in: out, range: range, withTemplate: "<sensitive>")
                }
            }
        }
        return out
    }
}

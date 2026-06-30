import Foundation

/// Learning loop: when you re-categorize a spend, we remember the correction and feed the most
/// recent ones back into the next `understandSpend` prompt as few-shot examples — so the AI stops
/// repeating the same mistake. Stored locally (last 30), most-recent wins.
enum Corrections {
    private static let key = "ai.corrections"

    static func record(text: String, category: String) {
        let t = text.trimmingCharacters(in: .whitespaces)
        let c = category.trimmingCharacters(in: .whitespaces)
        guard !t.isEmpty, !c.isEmpty else { return }
        var list = (UserDefaults.standard.array(forKey: key) as? [[String: String]]) ?? []
        list.removeAll { ($0["text"] ?? "").caseInsensitiveCompare(t) == .orderedSame }
        list.append(["text": t, "category": c])
        if list.count > 30 { list.removeFirst(list.count - 30) }
        UserDefaults.standard.set(list, forKey: key)
    }

    /// A few-shot block of the last N corrections, to prepend to a categorization prompt.
    static func fewShot(_ n: Int = 8) -> String {
        let list = (UserDefaults.standard.array(forKey: key) as? [[String: String]]) ?? []
        guard !list.isEmpty else { return "" }
        let lines = list.suffix(n).map { "  \"\($0["text"] ?? "")\" → \($0["category"] ?? "")" }
        return "\nThe user has corrected these before — prefer these mappings:\n" + lines.joined(separator: "\n")
    }
}

/// How to route an AI inference by its confidence.
/// - high → commit silently (trust it)
/// - medium → preview in the inbox for one-tap approval (Transaction Inbox, Phase X)
/// - low → ask, batched into the Maintenance/curiosity queue (don't auto-apply)
enum ConfidenceBand {
    case high, medium, low

    static func of(_ confidence: Double) -> ConfidenceBand {
        switch confidence {
        case 0.75...: return .high
        case 0.45..<0.75: return .medium
        default: return .low
        }
    }
}

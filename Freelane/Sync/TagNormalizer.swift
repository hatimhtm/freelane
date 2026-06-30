import Foundation

/// Keeps tags from fragmenting: "eating out", "Eating Out", and "eating_out" all collapse to the
/// same key, so a newly-typed tag snaps to an existing one instead of creating a near-duplicate.
enum TagNormalizer {
    /// Comparison key: letters/numbers only, lowercased (drops spaces, case, punctuation).
    static func key(_ s: String) -> String {
        String(s.lowercased().filter { $0.isLetter || $0.isNumber })
    }

    /// The canonical form to store: an existing tag with the same key wins; otherwise the trimmed input.
    static func canonical(_ input: String, known: [String]) -> String {
        let k = key(input)
        if let match = known.first(where: { key($0) == k }) { return match }
        return input.trimmingCharacters(in: .whitespaces)
    }
}

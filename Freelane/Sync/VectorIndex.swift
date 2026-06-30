import Foundation
import NaturalLanguage
import SwiftData

/// On-device semantic search using Apple's built-in sentence embeddings (NaturalLanguage —
/// no CoreML model files to ship). Lets the assistant find spends/letters by MEANING, not just
/// keywords ("that vet bill" finds "Paws & Claws checkup"). Embeddings are computed on demand and
/// bounded; storing them per-row as a `[Float]` blob is a future perf upgrade.
enum VectorIndex {
    private static let embedder = NLEmbedding.sentenceEmbedding(for: .english)
    static var isAvailable: Bool { embedder != nil }

    static func vector(_ text: String) -> [Double]? {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !t.isEmpty else { return nil }
        return embedder?.vector(for: t)
    }

    static func cosine(_ a: [Double], _ b: [Double]) -> Double {
        guard a.count == b.count, !a.isEmpty else { return 0 }
        var dot = 0.0, na = 0.0, nb = 0.0
        for i in a.indices { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
        let denom = (na.squareRoot() * nb.squareRoot())
        return denom > 0 ? dot / denom : 0
    }

    /// Top spends most semantically similar to `query` (recent 300, live only).
    @MainActor
    static func searchSpends(_ query: String, context: ModelContext, limit: Int = 8) -> [(spend: Spend, score: Double)] {
        guard let qv = vector(query) else { return [] }
        var d = FetchDescriptor<Spend>(sortBy: [SortDescriptor(\.spentAt, order: .reverse)])
        d.fetchLimit = 300
        let spends = ((try? context.fetch(d)) ?? []).filter { $0.deletedAt == nil }
        return spends.compactMap { s -> (Spend, Double)? in
            let text = [s.vendorName, s.spendDescription, s.notes].compactMap { $0 }.joined(separator: " ")
            guard let v = vector(text) else { return nil }
            return (s, cosine(qv, v))
        }
        .filter { $0.1 > 0.3 }
        .sorted { $0.1 > $1.1 }
        .prefix(limit).map { ($0.0, $0.1) }
    }
}

/// A semantic-search tool the model can call (composes with the other AITools).
struct SemanticSpendSearchTool: AITool {
    let name = "semantic_search_spends"
    let summary = "Find spends by MEANING (not just exact words), e.g. 'pet expenses', 'eating out with friends'."
    var properties: [String: Any] {
        ["query": ["type": "string", "description": "what to find, in natural language"]]
    }
    @MainActor func run(_ args: [String: Any], context: ModelContext) async -> String {
        let q = args["query"] as? String ?? ""
        let hits = VectorIndex.searchSpends(q, context: context)
        guard !hits.isEmpty else { return "No semantically similar spends found." }
        let base = (try? context.fetch(FetchDescriptor<AppSettings>()))?.first?.baseCurrency ?? "PHP"
        return hits.map { "\($0.spend.spentAt.formatted(.dateTime.month().day())) \($0.spend.vendorName ?? $0.spend.spendDescription ?? "?") \(CurrencyFormat.string($0.spend.amountBase, base, compact: true))" }
            .joined(separator: "\n")
    }
}

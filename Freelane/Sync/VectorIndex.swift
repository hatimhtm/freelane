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

#if canImport(FoundationModels)
import FoundationModels

/// Semantic search as a callable tool — it finds "that vet bill" inside "Paws & Claws checkup",
/// which keyword search never will. Runs against the same Sendable snapshot as the other tools, so
/// it never touches SwiftData off the main actor; embeddings are computed only if the model
/// actually reaches for this tool.
@available(macOS 26.0, *)
struct SemanticSpendSearchTool: Tool {
    let name = "semantic_search_spends"
    let description = "Find the person's spends by MEANING rather than exact words — for example 'pet expenses' or 'eating out with friends'. Use this when a keyword search would miss the point."
    let data: AIToolData

    @Generable
    struct Arguments {
        @Guide(description: "What to find, in natural language.")
        var query: String
    }

    func call(arguments: Arguments) async throws -> String {
        guard let qv = VectorIndex.vector(arguments.query) else {
            return "Semantic search isn't available on this Mac."
        }
        let hits = data.spends.prefix(300).compactMap { row -> (AIToolData.SpendRow, Double)? in
            guard let v = VectorIndex.vector(row.label) else { return nil }
            return (row, VectorIndex.cosine(qv, v))
        }
        .filter { $0.1 > 0.3 }
        .sorted { $0.1 > $1.1 }
        .prefix(8)

        guard !hits.isEmpty else { return "No spends were semantically similar to \"\(arguments.query)\"." }
        return hits.map { "\($0.0.date.formatted(.dateTime.month().day())) \($0.0.label) \(data.money($0.0.amount))" }
            .joined(separator: "\n")
    }
}
#endif

import Foundation
import SwiftData

/// A capability the model can CALL to fetch real data, instead of us pre-stuffing the whole
/// ledger into the prompt. "Ask my money" becomes: model decides what it needs → calls a tool →
/// we run it locally → feed the result back → model answers. Cheaper, more correct, retrieval-first.
protocol AITool {
    var name: String { get }
    var summary: String { get }
    /// JSON-Schema "properties" object for the tool's arguments.
    var properties: [String: Any] { get }
    @MainActor func run(_ args: [String: Any], context: ModelContext) async -> String
}

// MARK: - Concrete tools

struct SearchSpendsTool: AITool {
    let name = "search_spends"
    let summary = "Search recent spends by keyword/vendor and/or a day window; returns matches with amounts."
    var properties: [String: Any] {
        ["query": ["type": "string", "description": "vendor or keyword, empty for all"],
         "days": ["type": "integer", "description": "look-back window in days (default 90)"]]
    }
    @MainActor func run(_ args: [String: Any], context: ModelContext) async -> String {
        let q = (args["query"] as? String ?? "").lowercased()
        let days = (args["days"] as? Int) ?? ((args["days"] as? Double).map(Int.init) ?? 90)
        let since = PHT.daysAgo(max(1, days))
        var d = FetchDescriptor<Spend>(sortBy: [SortDescriptor(\.spentAt, order: .reverse)])
        d.fetchLimit = 400
        let spends = ((try? context.fetch(d)) ?? []).filter { $0.deletedAt == nil && $0.spentAt >= since }
        let base = (try? context.fetch(FetchDescriptor<AppSettings>()))?.first?.baseCurrency ?? "PHP"
        let matches = spends.filter { s in
            q.isEmpty || (s.vendorName ?? "").lowercased().contains(q) || (s.spendDescription ?? "").lowercased().contains(q)
                || s.tags.contains { $0.lowercased().contains(q) }
        }.prefix(40)
        guard !matches.isEmpty else { return "No spends matched." }
        let total = matches.reduce(0) { $0 + $1.amountBase }
        let rows = matches.map { "\($0.spentAt.formatted(.dateTime.month().day())) \($0.vendorName ?? $0.spendDescription ?? "?") \(CurrencyFormat.string($0.amountBase, base, compact: true))" }
        return "\(matches.count) matches, total \(CurrencyFormat.string(total, base, compact: true)):\n" + rows.joined(separator: "\n")
    }
}

struct WalletBalanceTool: AITool {
    let name = "get_wallet_balances"
    let summary = "Current balance of each holding wallet, plus the total."
    var properties: [String: Any] { [:] }
    @MainActor func run(_ args: [String: Any], context: ModelContext) async -> String {
        let d = StateSnapshot.load(context)
        let base = d.baseCurrency
        let live = d.wallets.filter { $0.isHolding && !$0.archived }
        let rows = live.map { "\($0.name): \(CurrencyFormat.string(WalletMath.balance(of: $0, ledger: d.ledger), base, compact: true))" }
        let total = live.reduce(0) { $0 + WalletMath.balance(of: $1, ledger: d.ledger) }
        return rows.joined(separator: "\n") + "\nTotal: \(CurrencyFormat.string(total, base, compact: true))"
    }
}

struct ProjectionTool: AITool {
    let name = "run_projection"
    let summary = "Project the wallet total forward N days: + expected recurring income, − expected bills, − recent daily spend pace."
    var properties: [String: Any] {
        ["days": ["type": "integer", "description": "horizon in days (default 60)"]]
    }
    @MainActor func run(_ args: [String: Any], context: ModelContext) async -> String {
        let days = max(7, (args["days"] as? Int) ?? ((args["days"] as? Double).map(Int.init) ?? 60))
        let d = StateSnapshot.load(context)
        let base = d.baseCurrency
        func money(_ v: Double) -> String { CurrencyFormat.string(v, base, compact: true) }
        let safe = SafeToSpend.compute(payments: d.payments, spends: d.spends, wallets: d.wallets, ledger: d.ledger, recurrings: d.recurrings, plans: d.plans)
        let income = RecurringMath.expectedBase(d.recurrings, kind: .income, days: days)
        let bills = RecurringMath.expectedBase(d.recurrings, kind: .expense, days: days)
        let recent = d.spends.filter { $0.spentAt >= PHT.daysAgo(30) }.reduce(0.0) { $0 + $1.amountBase }
        let spend = (recent / 30.0) * Double(days)
        let end = safe.walletTotal + income - bills - spend
        return "Over \(days)d: start \(money(safe.walletTotal)), +\(money(income)) income, −\(money(bills)) bills, −\(money(spend)) spending pace → ends ~\(money(end))."
    }
}

/// Runs Gemini's function-calling loop: the model may call tools (possibly several times) before
/// producing a final text answer. Bounded iterations so it always terminates.
enum ToolRunner {
    static let tools: [AITool] = [SearchSpendsTool(), WalletBalanceTool(), ProjectionTool(), SemanticSpendSearchTool()]

    @MainActor
    static func answer(_ question: String, system: String, context: ModelContext, apiKey: String, maxHops: Int = 4) async -> String? {
        guard !apiKey.isEmpty else { return nil }
        let byName = Dictionary(uniqueKeysWithValues: tools.map { ($0.name, $0) })
        let declarations: [[String: Any]] = tools.map { t in
            // Gemini's function schema requires a `required` array on the parameters object.
            // All our tool args are optional, so `required: []`.
            ["name": t.name, "description": t.summary,
             "parameters": ["type": "object", "properties": t.properties, "required": [String]()]]
        }
        var contents: [[String: Any]] = [
            ["role": "user", "parts": [["text": system + "\n\nQuestion: " + question]]]
        ]
        let model = GeminiModels.model(.heavy)
        for _ in 0..<maxHops {
            guard let resp = try? await call(model: model, apiKey: apiKey, contents: contents, tools: declarations) else { return nil }
            // A function call?
            if let fc = resp.functionCall {
                let tool = byName[fc.name]
                let result = await tool?.run(fc.args, context: context) ?? "Unknown tool."
                contents.append(["role": "model", "parts": [["functionCall": ["name": fc.name, "args": fc.args]]]])
                contents.append(["role": "user", "parts": [["functionResponse": ["name": fc.name, "response": ["result": result]]]]])
                continue
            }
            if let text = resp.text, !text.isEmpty { return text }
            return nil
        }
        return nil   // ran out of hops
    }

    private struct Reply { var text: String?; var functionCall: (name: String, args: [String: Any])? }

    private static func call(model: String, apiKey: String, contents: [[String: Any]], tools: [[String: Any]]) async throws -> Reply {
        let url = URL(string: "https://generativelanguage.googleapis.com/v1beta/models/\(model):generateContent")!
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(apiKey, forHTTPHeaderField: "x-goog-api-key")   // key in header, not URL query (less log-prone)
        req.httpBody = try JSONSerialization.data(withJSONObject: [
            "contents": contents,
            "tools": [["functionDeclarations": tools]],
        ])
        let (data, resp) = try await URLSession.shared.data(for: req)
        guard let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { throw AIError.badResponse }
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        let parts = (((json?["candidates"] as? [[String: Any]])?.first?["content"] as? [String: Any])?["parts"] as? [[String: Any]]) ?? []
        for p in parts {
            if let fc = p["functionCall"] as? [String: Any], let name = fc["name"] as? String {
                return Reply(text: nil, functionCall: (name, (fc["args"] as? [String: Any]) ?? [:]))
            }
        }
        let text = parts.compactMap { $0["text"] as? String }.joined()
        return Reply(text: text, functionCall: nil)
    }
}

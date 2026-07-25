import Foundation
import SwiftData
#if canImport(FoundationModels)
import FoundationModels
#endif

// MARK: - Tools the assistant can call
//
// Retrieval beats recall: instead of stuffing the whole ledger into every prompt and hoping the
// model reads it correctly, the model decides what it needs, calls a tool, and we run the real
// query locally. Exact figures, small prompts.
//
// This used to be a hand-rolled Gemini function-calling loop — HTTP round trips, a bespoke JSON
// schema per tool, and a manual hop counter. FoundationModels does tool calling natively on BOTH
// Apple brains, so the loop is gone and tools now work on-device and offline too, which the
// cloud-only version never did.
//
// One concurrency rule, and it is not negotiable: `Tool.call` runs off the main actor, and
// `ModelContext` is not Sendable. So every tool captures a plain, immutable snapshot of the rows
// it needs, taken on the main actor before the session starts. No tool ever touches SwiftData.

#if canImport(FoundationModels)

/// The rows the tools are allowed to see, flattened into Sendable value types once per chat turn.
struct AIToolData: Sendable {
    struct SpendRow: Sendable {
        var date: Date, label: String, tags: [String], amount: Double
    }
    struct WalletRow: Sendable {
        var name: String, balance: Double
    }
    var base: String = "PHP"
    var spends: [SpendRow] = []
    var wallets: [WalletRow] = []
    var walletTotal: Double = 0
    var expectedIncome60: Double = 0
    var expectedBills60: Double = 0
    var dailyPace: Double = 0

    func money(_ v: Double) -> String { CurrencyFormat.string(v, base, compact: true) }

    @MainActor
    static func load(_ context: ModelContext) -> AIToolData {
        let d = StateSnapshot.load(context)
        var out = AIToolData(base: d.baseCurrency)
        out.spends = d.spends
            .filter { $0.deletedAt == nil && $0.spentAt >= PHT.daysAgo(365) }
            .sorted { $0.spentAt > $1.spentAt }
            .prefix(600)
            .map { .init(date: $0.spentAt,
                         label: $0.vendorName ?? $0.spendDescription ?? "—",
                         tags: $0.tags,
                         amount: $0.amountBase) }
        let live = d.wallets.filter { $0.isHolding && !$0.archived }
        out.wallets = live.map { .init(name: $0.name, balance: WalletMath.balance(of: $0, ledger: d.ledger)) }
        out.walletTotal = out.wallets.reduce(0) { $0 + $1.balance }
        out.expectedIncome60 = RecurringMath.expectedBase(d.recurrings, kind: .income, days: 60)
        out.expectedBills60 = RecurringMath.expectedBase(d.recurrings, kind: .expense, days: 60)
        let recent = d.spends.filter { $0.spentAt >= PHT.daysAgo(30) }.reduce(0.0) { $0 + $1.amountBase }
        out.dailyPace = recent / 30.0
        return out
    }
}

// MARK: Individual tools

@available(macOS 26.0, *)
struct SearchSpendsTool: Tool {
    let name = "search_spends"
    let description = "Search the person's own spending by keyword, vendor or category over a day window. Returns the matching rows and their total."
    let data: AIToolData

    @Generable
    struct Arguments {
        @Guide(description: "Vendor, keyword or category to match. Empty string matches everything.")
        var query: String
        @Guide(description: "How many days back to look.", .range(1...365))
        var days: Int
    }

    func call(arguments: Arguments) async throws -> String {
        let q = arguments.query.lowercased().trimmingCharacters(in: .whitespaces)
        let since = Calendar(identifier: .gregorian).date(byAdding: .day, value: -max(1, arguments.days), to: .now) ?? .distantPast
        let matches = data.spends.filter { row in
            row.date >= since && (q.isEmpty
                || row.label.lowercased().contains(q)
                || row.tags.contains { $0.lowercased().contains(q) })
        }
        guard !matches.isEmpty else { return "No spends matched \"\(arguments.query)\" in the last \(arguments.days) days." }
        let total = matches.reduce(0) { $0 + $1.amount }
        let rows = matches.prefix(40).map {
            "\($0.date.formatted(.dateTime.month().day())) \($0.label) \(data.money($0.amount))"
        }
        return "\(matches.count) matches over \(arguments.days) days, total \(data.money(total)):\n" + rows.joined(separator: "\n")
    }
}

@available(macOS 26.0, *)
struct WalletBalanceTool: Tool {
    let name = "get_wallet_balances"
    let description = "The current balance of each of the person's wallets, plus the total across all of them."
    let data: AIToolData

    @Generable struct Arguments {}

    func call(arguments: Arguments) async throws -> String {
        guard !data.wallets.isEmpty else { return "No wallets are set up yet." }
        let rows = data.wallets.map { "\($0.name): \(data.money($0.balance))" }
        return rows.joined(separator: "\n") + "\nTotal: \(data.money(data.walletTotal))"
    }
}

@available(macOS 26.0, *)
struct ProjectionTool: Tool {
    let name = "run_projection"
    let description = "Project the person's total wallet balance forward: adds expected recurring income, subtracts expected bills and their recent daily spending pace."
    let data: AIToolData

    @Generable
    struct Arguments {
        @Guide(description: "How many days ahead to project.", .range(7...365))
        var days: Int
    }

    func call(arguments: Arguments) async throws -> String {
        let days = arguments.days
        let scale = Double(days) / 60.0
        let income = data.expectedIncome60 * scale
        let bills = data.expectedBills60 * scale
        let spend = data.dailyPace * Double(days)
        let end = data.walletTotal + income - bills - spend
        return "Over \(days) days: start \(data.money(data.walletTotal)), +\(data.money(income)) income, −\(data.money(bills)) bills, −\(data.money(spend)) spending pace → ends around \(data.money(end))."
    }
}

/// Everything the assistant can reach for, built from one snapshot.
@available(macOS 26.0, *)
enum AIToolbox {
    static func tools(_ data: AIToolData) -> [any Tool] {
        [SearchSpendsTool(data: data), WalletBalanceTool(data: data),
         ProjectionTool(data: data), SemanticSpendSearchTool(data: data)]
    }
}

#endif

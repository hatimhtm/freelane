import Foundation
import SwiftData
import AppKit
import UniformTypeIdentifiers

/// Export your money history to a CSV you can open in Numbers/Excel — payments in,
/// spends out, and transfers, newest first. Pure local, via a Save panel.
@MainActor
enum DataExport {
    static func transactionsCSV(_ context: ModelContext) -> String {
        func all<T: PersistentModel>(_ t: T.Type) -> [T] { (try? context.fetch(FetchDescriptor<T>())) ?? [] }
        let base = all(AppSettings.self).first?.baseCurrency ?? "PHP"
        let wallets = all(Wallet.self)
        let projects = all(Project.self)
        let steps = all(PaymentStep.self)
        func walletName(_ id: UUID?) -> String { id.flatMap { wid in wallets.first { $0.id == wid }?.name } ?? "" }

        struct Row { let date: Date; let cols: [String] }
        var rows: [Row] = []

        for p in all(Payment.self) {
            let project = projects.first { $0.id == p.projectId }?.title ?? "Payment"
            let landing = steps.filter { $0.paymentId == p.id }.sorted { $0.stepOrder < $1.stepOrder }.last?.methodId
            rows.append(Row(date: p.paidAt, cols: ["Payment in", project, "Income", walletName(landing),
                                                   f(p.netAmountBase ?? 0), base, f(p.amount), p.currency]))
        }
        for s in all(Spend.self) {
            let desc = s.vendorName ?? s.spendDescription ?? "Spend"
            let cat = s.tags.isEmpty ? (s.category ?? "") : s.tags.joined(separator: "/")
            rows.append(Row(date: s.spentAt, cols: ["Spend", desc, cat, walletName(s.walletId),
                                                    f(-s.amountBase), base, f(s.amount), s.currency]))
        }
        for w in all(Withdrawal.self) {
            let label = w.toMethodId != nil ? "Transfer" : "Withdrawal"
            let route = [walletName(w.fromMethodId), walletName(w.toMethodId)].filter { !$0.isEmpty }.joined(separator: " → ")
            rows.append(Row(date: w.withdrawnAt, cols: [label, route, "", walletName(w.fromMethodId),
                                                        f(-w.grossBase), base, "", ""]))
        }

        rows.sort { $0.date > $1.date }
        let df = DateFormatter(); df.calendar = PHT.calendar; df.timeZone = PHT.zone; df.dateFormat = "yyyy-MM-dd"
        var out = "Date,Type,Description,Category,Wallet,Amount (\(base)),Base currency,Native amount,Native currency\n"
        for r in rows {
            let cells = [df.string(from: r.date)] + r.cols
            out += cells.map(escape).joined(separator: ",") + "\n"
        }
        return out
    }

    static func save(_ context: ModelContext) {
        let csv = transactionsCSV(context)
        let panel = NSSavePanel()
        panel.allowedContentTypes = [.commaSeparatedText]
        let df = DateFormatter(); df.dateFormat = "yyyy-MM-dd"
        panel.nameFieldStringValue = "freelane-transactions-\(df.string(from: .now)).csv"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        try? csv.write(to: url, atomically: true, encoding: .utf8)
    }

    private static func f(_ v: Double) -> String { String(format: "%.2f", v) }
    private static func escape(_ s: String) -> String {
        (s.contains(",") || s.contains("\"") || s.contains("\n")) ? "\"\(s.replacingOccurrences(of: "\"", with: "\"\""))\"" : s
    }
}

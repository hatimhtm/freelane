import Foundation

/// Parses a single natural-language capture line into a spend (or payment) draft.
/// Examples it handles:
///   "450 jollibee"                          → ₱450 spend at Jollibee
///   "5000 rent gcash"                       → ₱5,000 "rent", wallet GCash
///   "30000 client payment from acme USD wise" → $30,000 payment, wallet Wise
/// Heuristics only — no network. The AI (`understandSpend`) still refines category/vendor
/// after the row is created; this just gets a clean draft from one line, instantly.
enum NaturalCapture {

    struct Draft {
        var amount: Double
        var currency: String
        var walletId: UUID?
        var vendor: String?
        var description: String?
        var isPayment: Bool
    }

    /// Lightweight wallet descriptor so this stays free of SwiftData types.
    struct WalletRef { let id: UUID; let name: String }

    // Deliberately NOT just "client" (would mis-flag "client lunch 200" as income) — require a
    // real payment verb/noun.
    private static let paymentWords: Set<String> = ["payment", "paid", "invoice", "landed", "received"]

    static func parse(_ raw: String, wallets: [WalletRef], currencies: [String], base: String) -> Draft? {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }
        let lower = text.lowercased()
        var tokens = text.split(whereSeparator: { $0 == " " || $0 == "\t" }).map(String.init)

        // 1) Amount — the first token that reads as a number (strip ₱ $ , etc.).
        var amount: Double?
        var amountIdx: Int?
        for (i, tok) in tokens.enumerated() {
            let cleaned = tok.filter { $0.isNumber || $0 == "." }
            if !cleaned.isEmpty, cleaned.contains(where: { $0.isNumber }), let v = Double(cleaned), v > 0 {
                // ignore pure years / 4-digit that are clearly not money? keep simple: accept.
                amount = v; amountIdx = i; break
            }
        }
        guard let amt = amount, let aIdx = amountIdx else { return nil }
        tokens.remove(at: aIdx)

        // 2) Currency — an explicit ISO/code token wins; else base.
        var currency = base
        if let codeIdx = tokens.firstIndex(where: { currencies.contains($0.uppercased()) }) {
            currency = tokens[codeIdx].uppercased(); tokens.remove(at: codeIdx)
        }

        // 3) Wallet — longest wallet name first; match a contiguous substring ("Google Pay") OR
        //    all of its words appearing as tokens (so word order doesn't matter).
        var walletId: UUID?
        var matchedWalletWords: Set<String> = []
        let tokenSet = Set(tokens.map { $0.lowercased() })
        for w in wallets.sorted(by: { $0.name.count > $1.name.count }) {
            let wn = w.name.lowercased()
            let wnWords = Set(wn.split(separator: " ").map(String.init))
            if lower.contains(wn) || (!wnWords.isEmpty && wnWords.isSubset(of: tokenSet)) {
                walletId = w.id
                matchedWalletWords = wnWords
                break
            }
        }
        if walletId != nil {
            tokens.removeAll { matchedWalletWords.contains($0.lowercased()) }
        }

        let isPayment = paymentWords.contains { lower.contains($0) }
        // Drop connective noise so the leftover reads cleanly as a vendor/description.
        let noise: Set<String> = ["from", "at", "in", "to", "for", "the", "a", "of", "on", "landed"]
        let rest = tokens.filter { !noise.contains($0.lowercased()) }.joined(separator: " ").trimmingCharacters(in: .whitespaces)

        // For a spend, the leftover is the vendor (no separate description); for a payment it's a
        // reference/description (no vendor).
        let label: String? = rest.isEmpty ? nil : rest
        return Draft(amount: amt, currency: currency, walletId: walletId,
                     vendor: isPayment ? nil : label,
                     description: isPayment ? label : nil,
                     isPayment: isPayment)
    }
}

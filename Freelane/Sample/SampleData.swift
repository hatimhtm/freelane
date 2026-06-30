import Foundation
import SwiftData

/// Demo dataset for a brand-new, empty install. DISABLED by default: the sample
/// rows are ordinary `Wallet`/`Client`/`Project`/`Payment` records, indistinguishable
/// from real ones, and the importer now MERGES (never wipes) — so seeding into a real
/// store would permanently double-count income. Only seeds when the developer flag
/// `freelane.debugSeedSamples` is set. Real users start empty.
enum SampleData {
    static let marker = "freelane.sampleSeeded"

    static let seededOnce = "freelane.sampleSeededOnce"

    @MainActor
    static func seedIfEmpty(_ context: ModelContext) {
        // Off unless explicitly enabled for development. This is the single path that
        // could pollute real financial data, so it stays disabled in normal use.
        guard UserDefaults.standard.bool(forKey: "freelane.debugSeedSamples") else { return }
        if UserDefaults.standard.bool(forKey: marker) { return }
        if UserDefaults.standard.bool(forKey: seededOnce) { return }
        let wallets = (try? context.fetch(FetchDescriptor<Wallet>())) ?? []
        guard wallets.isEmpty else { return }
        UserDefaults.standard.set(true, forKey: seededOnce)

        let settings = MoneyEngine.settings(in: context)
        settings.baseCurrency = "PHP"

        // FX (rate_to_base = base per 1 unit of currency)
        let rates = [("USD", 1.0 / 57.5), ("EUR", 1.0 / 62.0), ("MAD", 1.0 / 5.7)]
        for (code, r) in rates {
            // stored inverse: amountNative * rateToBase = base  → rateToBase = base-per-native
            context.insert(ExchangeRate(code: code, rateToBase: 1.0 / r))
        }

        // Wallets
        let gcash = Wallet(name: "GCash", kind: .wallet); gcash.openingBalanceBase = 4_200; gcash.openingBalanceSetAt = PHT.daysAgo(120)
        let wise = Wallet(name: "Wise", kind: .bank); wise.openingBalanceBase = 18_500; wise.openingBalanceSetAt = PHT.daysAgo(120)
        let coin = Wallet(name: "Coins.ph", kind: .crypto); coin.openingBalanceBase = 2_000; coin.openingBalanceSetAt = PHT.daysAgo(120)
        let cash = Wallet(name: "Cash", kind: .cash); cash.openingBalanceBase = 1_500; cash.openingBalanceSetAt = PHT.daysAgo(120)
        [gcash, wise, coin, cash].forEach { context.insert($0) }

        // Clients
        let acme = Client(name: "Northwind Studio", company: "Northwind")
        let lumen = Client(name: "Lumen Labs", company: "Lumen")
        [acme, lumen].forEach { context.insert($0) }

        // Projects
        let p1 = Project(clientId: acme.id, title: "Brand identity system", amount: 45_000, currency: "PHP")
        p1.quotedAt = PHT.daysAgo(40)
        let p2 = Project(clientId: lumen.id, title: "Marketing site", amount: 1_800, currency: "USD")
        p2.quotedAt = PHT.daysAgo(20)
        let p3 = Project(clientId: acme.id, title: "Motion reel", amount: 22_000, currency: "PHP")
        p3.quotedAt = PHT.daysAgo(8)
        [p1, p2, p3].forEach { context.insert($0) }

        try? context.save()

        // Payments via the real engine so ledger/allocations/status all populate.
        let engine = MoneyEngine(context: context)
        _ = try? engine.addPayment(.init(
            projectId: p1.id, projects: nil, paidAt: PHT.daysAgo(30),
            steps: [.init(fromMethodId: nil, methodId: wise.id, amountIn: 22_500, currencyIn: "PHP",
                          amountOut: 22_300, currencyOut: "PHP", notes: nil)],
            reference: "50% deposit", notes: nil))
        _ = try? engine.addPayment(.init(
            projectId: p2.id, projects: nil, paidAt: PHT.daysAgo(12),
            steps: [.init(fromMethodId: nil, methodId: wise.id, amountIn: 900, currencyIn: "USD",
                          amountOut: 50_800, currencyOut: "PHP", notes: nil)],
            reference: nil, notes: nil))
        _ = try? engine.addPayment(.init(
            projectId: p1.id, projects: nil, paidAt: PHT.daysAgo(3),
            steps: [.init(fromMethodId: nil, methodId: gcash.id, amountIn: 22_500, currencyIn: "PHP",
                          amountOut: 22_350, currencyOut: "PHP", notes: nil)],
            reference: "final", notes: nil))

        _ = try? engine.createWithdrawal(fromMethodId: wise.id, toMethodId: cash.id,
                                     withdrawnAt: PHT.daysAgo(6), grossBase: 10_000, netBase: 9_950, notes: "ATM")

        try? context.save()
    }
}

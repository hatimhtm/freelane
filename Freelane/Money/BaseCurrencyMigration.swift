import Foundation
import SwiftData

extension MoneyEngine {
    /// Switch the base currency for the WHOLE app, correctly. Base conversion is linear, so
    /// every stored *base* figure is rescaled by a single factor and the FX table is re-based;
    /// native amounts (each in their own currency) are untouched. Previously the Settings picker
    /// only relabeled the base without rescaling or even saving — leaving every total mislabelled
    /// over old-magnitude numbers. Throws (changing nothing) if there's no rate for the new base.
    func changeBaseCurrency(to newBase: String) throws {
        guard let settings = (try? context.fetch(FetchDescriptor<AppSettings>()))?.first else {
            throw EngineError.invalid("No settings found.")
        }
        let oldBase = settings.baseCurrency
        guard newBase != oldBase else { return }
        var rateRows = (try? context.fetch(FetchDescriptor<ExchangeRate>())) ?? []
        let oldRates = Rates(base: oldBase, rates: rateRows)
        guard oldRates.hasRate(for: newBase) else {
            throw EngineError.invalid("No exchange rate for \(newBase) yet. Refresh rates first, then switch.")
        }
        let f = oldRates.rate(for: newBase)        // old-base units per 1 new-base unit
        guard f > 0 else { throw EngineError.invalid("Invalid exchange rate for \(newBase).") }
        func s(_ v: Double) -> Double { round2(v / f) }   // old-base amount → new-base amount

        // Keep the OLD base as a real rate (1/f) in the new system — it was implicitly 1 and may
        // have had no persisted row, which would make conversions of old-base amounts fall to 1:1.
        if !rateRows.contains(where: { $0.code == oldBase }) {
            let row = ExchangeRate(code: oldBase, rateToBase: 1)
            context.insert(row); rateRows.append(row)
        }
        // Re-base every FX rate (NO rounding — rates need full precision).
        for r in rateRows { r.rateToBase = r.rateToBase / f; r.dirty = true }

        // Rescale every stored base-denominated figure across all money entities.
        for x in (try? context.fetch(FetchDescriptor<Spend>())) ?? [] { x.amountBase = s(x.amountBase); x.dirty = true }
        for x in (try? context.fetch(FetchDescriptor<Recurring>())) ?? [] { x.amountBase = s(x.amountBase); x.dirty = true }
        for x in (try? context.fetch(FetchDescriptor<LedgerEntry>())) ?? [] { x.amountBase = s(x.amountBase); x.dirty = true }
        for x in (try? context.fetch(FetchDescriptor<PaymentAllocation>())) ?? [] { x.allocationBase = s(x.allocationBase); x.dirty = true }
        for x in (try? context.fetch(FetchDescriptor<Withdrawal>())) ?? [] {
            x.grossBase = s(x.grossBase); x.netBase = s(x.netBase); x.feeBase = s(x.feeBase); x.dirty = true
        }
        for x in (try? context.fetch(FetchDescriptor<Payment>())) ?? [] {
            if let v = x.netAmountBase { x.netAmountBase = s(v) }
            if let v = x.grossAtMarketBase { x.grossAtMarketBase = s(v) }
            if let v = x.impliedFeeBase { x.impliedFeeBase = s(v) }
            x.dirty = true
        }
        for x in (try? context.fetch(FetchDescriptor<Wallet>())) ?? [] {
            x.monthlyFeeBase = s(x.monthlyFeeBase)
            if let v = x.openingBalanceBase { x.openingBalanceBase = s(v) }
            x.overdraftToleranceBase = s(x.overdraftToleranceBase)
            x.dirty = true
        }
        for x in (try? context.fetch(FetchDescriptor<Client>())) ?? [] { x.retainerBase = s(x.retainerBase); x.dirty = true }
        for x in (try? context.fetch(FetchDescriptor<Loan>())) ?? [] {
            x.principalBase = s(x.principalBase); x.outstandingBase = s(x.outstandingBase)
            if let v = x.forgivenBase { x.forgivenBase = s(v) }
            x.dirty = true
        }
        for x in (try? context.fetch(FetchDescriptor<SpendItem>())) ?? [] { x.lineTotalBase = s(x.lineTotalBase); x.dirty = true }
        // Project stores only a native amount (its base is derived live), so nothing to rescale.

        settings.baseCurrency = newBase
        settings.dirty = true
        try context.save()
    }
}

import Foundation
import SwiftData

/// Live exchange rates from frankfurter.app (free, ECB-sourced).
///
/// Principle (per the user): a fresh rate only affects **upcoming** conversions. Already-
/// recorded payments/spends/withdrawals store their value in the base currency at the
/// moment they were logged (`fxLocked`), so they NEVER re-convert — changing a rate can't
/// retroactively move money that's already in your books.
///
/// It keeps a rate for every currency the forms offer, so picking one never books 1:1. It never
/// invents a placeholder rate (that produced the bogus "AED = 1.0"), and never blows away an
/// existing rate when the feeds don't return one. ECB rates come first; codes the ECB doesn't
/// publish (MAD, AED) come from a second, keyless feed — MAD sat at April's 5.7 for six months.
@MainActor
enum FXService {
    static func refreshIfStale(_ context: ModelContext) async {
        let last = UserDefaults.standard.double(forKey: "fx.refreshedAt")
        if Date.now.timeIntervalSince1970 - last < 12 * 3600 { return }
        await refresh(context)
    }

    /// The currencies you actually use — quoted, paid, or spent in. Plus base.
    private static func usedCurrencies(_ context: ModelContext) -> Set<String> {
        var used = Set<String>()
        for p in (try? context.fetch(FetchDescriptor<Project>())) ?? [] { used.insert(p.currency) }
        for p in (try? context.fetch(FetchDescriptor<Payment>())) ?? [] { used.insert(p.currency) }
        for s in (try? context.fetch(FetchDescriptor<Spend>())) ?? [] { used.insert(s.currency) }
        // Allocations carry their own currency (recomputeProjectStatus converts with it) — pruning
        // it would make old allocations silently convert 1:1.
        for a in (try? context.fetch(FetchDescriptor<PaymentAllocation>())) ?? [] { used.insert(a.allocationCurrency) }
        return used
    }

    static func refresh(_ context: ModelContext) async {
        guard let settings = try? context.fetch(FetchDescriptor<AppSettings>()).first else { return }
        let base = settings.baseCurrency
        let rows = (try? context.fetch(FetchDescriptor<ExchangeRate>())) ?? []
        let needed = usedCurrencies(context).union(CurrencyFormat.supported).subtracting([base])
        guard !needed.isEmpty else { return }

        // Stablecoins aren't on the fiat feed — peg them to USD (so fetch USD too).
        let pegged = needed.intersection(CurrencyFormat.usdPegged)
        var fiat = needed.subtracting(CurrencyFormat.usdPegged)
        if !pegged.isEmpty, base != "USD" { fiat.insert("USD") }
        fiat.remove(base)

        var fx: [String: Double] = [:]
        if !fiat.isEmpty,
           let url = URL(string: "https://api.frankfurter.dev/v1/latest?base=\(base)&symbols=\(Array(fiat).joined(separator: ","))"),
           let (data, _) = try? await URLSession.shared.data(from: url),
           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let r = json["rates"] as? [String: Double] {
            fx = r
        }
        let usdRate: Double = base == "USD" ? 1.0 : (fx["USD"] ?? 0)
        if usdRate > 0 { for code in pegged { fx[code] = usdRate } }

        // Whatever the ECB feed didn't carry, from a keyless daily feed that has every code.
        let missing = needed.filter { (fx[$0] ?? 0) <= 0 }
        if !missing.isEmpty,
           let url = URL(string: "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/\(base.lowercased()).json"),
           let (data, _) = try? await URLSession.shared.data(from: url),
           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let r = json[base.lowercased()] as? [String: Double] {
            for code in missing { if let v = r[code.lowercased()], v > 0 { fx[code] = v } }
        }

        // Update ONLY when we got a valid fresh rate. A currency the feed didn't return
        // keeps the rate it already had — never overwritten with a placeholder.
        var rowsByCode = Dictionary(rows.map { ($0.code, $0) }, uniquingKeysWith: { a, _ in a })
        var updatedAny = false
        for code in needed {
            guard let r = fx[code], r > 0 else { continue }
            let newRate = 1 / r
            if let row = rowsByCode[code] {
                row.rateToBase = newRate; row.updatedAt = .now; row.dirty = true
            } else {
                let row = ExchangeRate(code: code, rateToBase: newRate); row.dirty = true
                context.insert(row); rowsByCode[code] = row
            }
            UserDefaults.standard.set(newRate, forKey: "fx.prev.\(code)")
            updatedAny = true
        }
        try? context.save()
        // Invariant: only a refresh that actually landed rates counts as fresh — a failed
        // fetch must not suppress retries for 12h and leave stale rates looking current.
        if updatedAny {
            UserDefaults.standard.set(Date.now.timeIntervalSince1970, forKey: "fx.refreshedAt")
        }
    }
}

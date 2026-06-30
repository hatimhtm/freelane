import Foundation
import SwiftData

/// Live exchange rates from frankfurter.app (free, ECB-sourced).
///
/// Principle (per the user): a fresh rate only affects **upcoming** conversions. Already-
/// recorded payments/spends/withdrawals store their value in the base currency at the
/// moment they were logged (`fxLocked`), so they NEVER re-convert — changing a rate can't
/// retroactively move money that's already in your books.
///
/// This service is deliberately conservative: it only touches currencies you actually use,
/// it never invents a placeholder rate (that produced the bogus "AED = 1.0"), and it never
/// blows away an existing rate when the feed doesn't return one.
@MainActor
enum FXService {
    static func refreshIfStale(_ context: ModelContext) async {
        // Cleanup runs every launch (local, cheap) so junk rows can't linger.
        pruneUnusedRates(context)
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

    /// Delete rate rows for currencies you don't use (removes junk like the AED=1.0
    /// placeholder and unused stablecoin rows). Base + anything in use is kept.
    static func pruneUnusedRates(_ context: ModelContext) {
        guard let base = (try? context.fetch(FetchDescriptor<AppSettings>()).first)?.baseCurrency else { return }
        let used = usedCurrencies(context)
        let rows = (try? context.fetch(FetchDescriptor<ExchangeRate>())) ?? []
        var changed = false
        for row in rows where row.code != base && !used.contains(row.code) {
            context.delete(row); changed = true
        }
        if changed { try? context.save() }
    }

    static func refresh(_ context: ModelContext) async {
        guard let settings = try? context.fetch(FetchDescriptor<AppSettings>()).first else { return }
        let base = settings.baseCurrency
        let rows = (try? context.fetch(FetchDescriptor<ExchangeRate>())) ?? []
        let needed = usedCurrencies(context).subtracting([base])
        guard !needed.isEmpty else { return }

        // Stablecoins aren't on the fiat feed — peg them to USD (so fetch USD too).
        let pegged = needed.intersection(CurrencyFormat.usdPegged)
        var fiat = needed.subtracting(CurrencyFormat.usdPegged)
        if !pegged.isEmpty, base != "USD" { fiat.insert("USD") }
        fiat.remove(base)

        var fx: [String: Double] = [:]
        if !fiat.isEmpty,
           let url = URL(string: "https://api.frankfurter.app/latest?base=\(base)&symbols=\(Array(fiat).joined(separator: ","))"),
           let (data, _) = try? await URLSession.shared.data(from: url),
           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let r = json["rates"] as? [String: Double] {
            fx = r
        }
        let usdRate: Double = base == "USD" ? 1.0 : (fx["USD"] ?? 0)
        if usdRate > 0 { for code in pegged { fx[code] = usdRate } }

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

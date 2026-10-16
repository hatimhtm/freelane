import Foundation
import SwiftData

/// An amount in its own currency, as typed.
struct NativeAmount: Equatable {
    let amount: Double
    let currency: String
}

/// What a move (or a client's payment) comes to. Balances run on `grossBase` (what left, in pesos) and `netBase`
/// (what arrived); `lostBase` is what it cost in all, the provider's fee and the exchange rate's cut together.
/// `sent` and `arrived` are the amounts in their own currencies, typed or worked out; `fee` is the fee as typed.
struct MoveFigures {
    let grossBase: Double
    let netBase: Double
    let sent: NativeAmount
    let arrived: NativeAmount
    let fee: NativeAmount?
    var lostBase: Double { max(0, grossBase - netBase) }
}

enum MoveOutcome {
    case ok(MoveFigures)
    case problem(String)
    var figures: MoveFigures? { if case .ok(let f) = self { return f }; return nil }
}

/// A move's three amounts (what left, the fee, what arrived), each in any currency: any two settle the third.
/// What left and what arrived decide the balances when both are given; a typed fee is then kept as the provider's
/// fee, and whatever else was lost is the exchange rate's. The phone does the same (MoveMath.kt).
enum MoveMath {
    static func resolve(left: NativeAmount?, fee: NativeAmount?, arrived: NativeAmount?, leftCurrency: String, arrivedCurrency: String,
                        rates: Rates) -> MoveOutcome {
        for n in [left, fee, arrived].compactMap({ $0 }) {
            if !rates.hasRate(for: n.currency) { return .problem("Freelane has no rate for \(n.currency) yet.") }
            if n.amount < 0 { return .problem("Amounts can't be negative.") }
        }
        for c in [leftCurrency, arrivedCurrency] where !rates.hasRate(for: c) { return .problem("Freelane has no rate for \(c) yet.") }
        func base(_ n: NativeAmount) -> Double { rates.toBase(n.amount, n.currency) }
        func native(_ b: Double, _ c: String) -> NativeAmount { NativeAmount(amount: r2(b / max(rates.toBase(1, c), 0.000001)), currency: c) }
        let l = left.flatMap { $0.amount > 0 ? $0 : nil }
        let a = arrived.flatMap { $0.amount > 0 ? $0 : nil }
        let f = fee.flatMap { $0.amount > 0 ? $0 : nil }
        if let l, let a {
            if l.currency == a.currency && a.amount > l.amount + 0.004 { return .problem("What arrived can't be more than what left.") }
            let net = r2(base(a))
            // A better rate than Freelane's can bring in more than what left was worth here; the first wallet then
            // gave up what arrived, and nothing was lost.
            return .ok(MoveFigures(grossBase: max(r2(base(l)), net), netBase: net, sent: l, arrived: a, fee: f))
        }
        if let l, let f {
            if l.currency == f.currency && f.amount > l.amount + 0.004 { return .problem("The fee can't be more than what left.") }
            let gross = r2(base(l))
            let net = r2(gross - base(f))
            if net < 0 { return .problem("The fee can't be more than what left.") }
            return .ok(MoveFigures(grossBase: gross, netBase: net, sent: l, arrived: native(net, arrivedCurrency), fee: f))
        }
        if let a, let f {
            let net = r2(base(a))
            let gross = r2(net + base(f))
            return .ok(MoveFigures(grossBase: gross, netBase: net, sent: native(gross, leftCurrency), arrived: a, fee: f))
        }
        if let l {
            let gross = r2(base(l))
            return .ok(MoveFigures(grossBase: gross, netBase: gross, sent: l, arrived: native(gross, arrivedCurrency), fee: nil))
        }
        if let a {
            let net = r2(base(a))
            return .ok(MoveFigures(grossBase: net, netBase: net, sent: native(net, leftCurrency), arrived: a, fee: nil))
        }
        return .problem("Type what left the wallet.")
    }

    private static func r2(_ v: Double) -> Double { (v * 100).rounded() / 100 }

    /// The currency money last left a wallet in (a move out of it), else what the wallet holds, else pesos.
    static func leavesIn(_ walletId: UUID?, withdrawals: [Withdrawal], wallets: [Wallet]) -> String {
        guard let walletId else { return "PHP" }
        if let c = withdrawals.filter({ $0.deletedAt == nil && $0.fromMethodId == walletId && $0.grossCurrency != nil })
            .max(by: { $0.withdrawnAt < $1.withdrawnAt })?.grossCurrency { return c }
        let w = wallets.first { $0.id == walletId }
        return [w?.currencyOut, w?.currencyIn].compactMap { $0 }.first { !$0.isEmpty } ?? "PHP"
    }

    /// The currency money last arrived in at a wallet (a move or a client's payment), else what it holds, else pesos.
    static func arrivesIn(_ walletId: UUID?, withdrawals: [Withdrawal], payments: [Payment], steps: [PaymentStep], wallets: [Wallet]) -> String {
        guard let walletId else { return "PHP" }
        let move = withdrawals.filter { $0.deletedAt == nil && $0.toMethodId == walletId && $0.netCurrency != nil }.max { $0.withdrawnAt < $1.withdrawnAt }
        var paid: (Date, String)? = nil
        for p in payments.filter({ $0.deletedAt == nil }).sorted(by: { $0.paidAt > $1.paidAt }) {
            guard let last = steps.filter({ $0.paymentId == p.id }).max(by: { $0.stepOrder < $1.stepOrder }) else { continue }
            if last.methodId == walletId { paid = (p.paidAt, last.currencyOut); break }
        }
        if let move, let c = move.netCurrency, paid == nil || move.withdrawnAt >= paid!.0 { return c }
        if let paid { return paid.1 }
        let w = wallets.first { $0.id == walletId }
        return [w?.currencyIn, w?.currencyOut].compactMap { $0 }.first { !$0.isEmpty } ?? "PHP"
    }

    /// "Fee €0.85 · ₱58.10 · 1.6%", worked out from what left and what arrived when the fee wasn't typed (in the
    /// fee's currency); as typed otherwise, with what the exchange rate took on top of it.
    static func feeLine(_ m: MoveFigures, feeCurrency: String, rates: Rates) -> String? {
        if m.fee == nil && m.lostBase <= 0.004 { return nil }
        let pct = String(format: "%.1f", m.lostBase / max(m.grossBase, 0.000001) * 100)
        if let typed = m.fee {
            let typedBase = rates.toBase(typed.amount, typed.currency)
            var s = "Fee \(LedgerText.nativeExact(typed.amount, typed.currency))"
            if typed.currency != "PHP" { s += " · \(MoneyFormat.string(typedBase))" }
            if m.lostBase - typedBase > 0.5 { s += " · \(MoneyFormat.string(m.lostBase)) lost in all with the exchange rate" }
            return s
        }
        if feeCurrency == "PHP" || !rates.hasRate(for: feeCurrency) { return "Fee \(MoneyFormat.string(m.lostBase)) · \(pct)%" }
        let inCurrency = m.lostBase / max(rates.toBase(1, feeCurrency), 0.000001)
        return "Fee \(LedgerText.nativeExact(inCurrency, feeCurrency)) · \(MoneyFormat.string(m.lostBase)) · \(pct)%"
    }
}

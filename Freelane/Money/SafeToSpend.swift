import Foundation

/// Faithful (slightly simplified) port of safe-to-spend.ts.
/// Always returns a number; cold-start is tagged `rough`, never blank.
struct SafeBreakdown {
    var safeTodayBase: Double      // the day's baseline
    var initialForToday: Double    // PHT-day snapshot (stable across the day)
    var liveRemaining: Double      // initial − today's spend (decrements through the day)
    var spentToday: Double
    var walletTotal: Double
    var confidence: String         // "rough" | "calibrating" | "steady"
    var isLearning: Bool
    var note: String = ""          // human "why this number" line (not a cold number)
}

enum SafeToSpend {
    static let horizon = 30.0

    /// Cost-of-living daily anchor for the user's city (AI-refined into UserDefaults,
    /// sensible default for a Philippine city). Used as the band + cold-start anchor.
    static var colDailyBase: Double {
        let v = UserDefaults.standard.double(forKey: "col.dailyBase")
        return v > 0 ? v : 600
    }

    static let essentialTags: Set<String> = ["food", "groceries", "grocery", "bills", "bill", "transport",
        "transpo", "fare", "health", "medicine", "rent", "utilities", "water", "electric", "internet", "load"]

    /// A spend that shouldn't shape the everyday allowance: a plan purchase, an
    /// explicit one-off, or a single buy far above the daily pace (a couch).
    static func isOneOff(_ s: Spend, rawDaily: Double) -> Bool {
        if s.isInvestment { return true }      // business/home investments aren't everyday spending
        let tags = (s.tags + [s.category].compactMap { $0 }).map { $0.lowercased() }
        if tags.contains("plan") || tags.contains("one-off") || tags.contains("oneoff") { return true }
        if rawDaily > 0, s.amountBase > rawDaily * 5 { return true }
        if rawDaily == 0, s.amountBase > 3000 { return true }
        return false
    }
    static func isEssential(_ s: Spend) -> Bool {
        (s.tags + [s.category].compactMap { $0 }).map { $0.lowercased() }.contains { essentialTags.contains($0) }
    }

    /// Everyday spending pace — what you actually live on, with one-offs removed so
    /// a couch doesn't inflate it. 0 when no history.
    static func typicalDailySpend(_ spends: [Spend]) -> Double {
        let start = PHT.daysAgo(30)
        // Invariant: trashed (soft-deleted) spends never shape the pace — some callers pass raw fetches.
        let recent = spends.filter { $0.deletedAt == nil && $0.spentAt >= start && $0.amountBase > 0 }
        guard !recent.isEmpty else { return 0 }
        let rawDaily = recent.reduce(0) { $0 + $1.amountBase } / horizon
        let everyday = recent.filter { !isOneOff($0, rawDaily: rawDaily) }
        return everyday.reduce(0) { $0 + $1.amountBase } / horizon
    }
    /// Daily essential-spend pace (food/transport/bills…) — always reserved.
    static func essentialDailySpend(_ spends: [Spend]) -> Double {
        let start = PHT.daysAgo(30)
        // Invariant: trashed (soft-deleted) spends never shape the pace — some callers pass raw fetches.
        let recent = spends.filter { $0.deletedAt == nil && $0.spentAt >= start && $0.amountBase > 0 }
        guard !recent.isEmpty else { return 0 }
        let rawDaily = recent.reduce(0) { $0 + $1.amountBase } / horizon
        let ess = recent.filter { !isOneOff($0, rawDaily: rawDaily) && isEssential($0) }
        return ess.reduce(0) { $0 + $1.amountBase } / horizon
    }

    static func compute(payments: [Payment], spends: [Spend], wallets: [Wallet],
                        ledger: [LedgerEntry], recurrings: [Recurring] = []) -> SafeBreakdown {
        let now = Date.now
        let d30 = PHT.daysAgo(30), d90 = PHT.daysAgo(90)

        let income30 = payments.filter { $0.deletedAt == nil && $0.paidAt >= d30 }.reduce(0) { $0 + ($1.netAmountBase ?? 0) }
        let income90 = payments.filter { $0.deletedAt == nil && $0.paidAt >= d90 }.reduce(0) { $0 + ($1.netAmountBase ?? 0) }
        let recentDaily = income30 / 30
        let longRunDaily = income90 / 90
        let isLearning = longRunDaily <= 0
        let stabilityScore = isLearning ? 1.0 : min(1.5, max(0, recentDaily / longRunDaily))
        let stabilityMult = min(1.2, max(0.7, stabilityScore))

        let spend30 = spends.filter { $0.deletedAt == nil && $0.spentAt >= d30 }.reduce(0) { $0 + $1.amountBase }
        let overspend = max(0, spend30 - income30)
        let recoveryTax = overspend / (horizon * 2)

        // --- The honest anchor: how much you ACTUALLY spend, against your city's
        //     cost of living. NOT wallet ÷ days. More parked money can't inflate it. ---
        let colBase = colDailyBase
        let colLow = max(150, colBase * 0.45)
        let colHigh = colBase * 2.5
        let typical = typicalDailySpend(spends)
        var base = min(max(typical > 0 ? typical : colBase, colLow), colHigh)

        // Gentle context: a little room when earning well and under your pace; pull
        // down while recovering from an overspend.
        if overspend > 0 {
            base = max(colLow, base - recoveryTax)
        } else if !isLearning, recentDaily > longRunDaily, stabilityMult >= 1.0 {
            base = min(base * 1.15, colHigh)
        }

        // Wallets are a CEILING only: low runway pulls the number DOWN, extra money
        // never pushes it up.
        let walletTotal = wallets.filter { $0.isHolding && !$0.archived && !$0.excludedFromTotals }
            .reduce(0.0) { $0 + WalletMath.balance(of: $1, ledger: ledger) }
        let walletBalances = max(0, walletTotal)
        let recurringForward = RecurringMath.expectedBase(recurrings, kind: .expense, days: Int(horizon))
        let fees30 = payments.filter { $0.deletedAt == nil && !$0.feeUnknown && $0.paidAt >= d30 }.reduce(0) { $0 + ($1.impliedFeeBase ?? 0) }
        let committed = recurringForward + fees30 * horizon / 30
        let sustainablePerDay = (walletBalances - committed) / horizon
        let ceiling = max(colLow, sustainablePerDay)
        base = min(base, ceiling)

        // Essentials (food/transport/bills) are always reserved, up to what's affordable.
        let essDaily = essentialDailySpend(spends)
        if essDaily > 0 { base = max(base, min(essDaily, ceiling)) }

        // Hard cash ceiling: the day's safe-spend can never exceed the money you
        // actually hold. The COL floor (colLow) and everyday-pace anchor can sit
        // above a near-empty wallet — but you can't safely spend cash you don't
        // have, so clamp the headline to real wallet balance. (Fixes "shows 202
        // while wallets hold 100".)
        let safeTodayBase = round2(min(max(colLow, base), walletBalances))

        let oldest = (payments.map(\.paidAt) + spends.map(\.spentAt)).min() ?? now
        let observationDays = PHT.calendar.dateComponents([.day], from: oldest, to: now).day ?? 0
        let confidence = observationDays < 14 ? "rough" : (observationDays < 21 ? "calibrating" : "steady")

        // A human "why this number" line — not a cold figure.
        var note: String
        if isLearning && typical <= 0 {
            note = "Starting from your city's typical cost of living until I learn your habits."
        } else {
            note = "≈ your everyday pace"
            if essDaily > 0 { note += " · ~\(CurrencyFormat.string(essDaily, "PHP", compact: true)) is essentials" }
            note += ". One-off buys (a couch, a big bill) are kept out of it."
            if overspend > 0 { note += " Trimmed a little while you recover from a heavier stretch." }
        }

        // Only freeze the day's number once REAL data is loaded — otherwise a cold-launch
        // compute (before @Query wallets/payments arrive) could lock in a wrong, low value
        // for the whole day. Until then, show the live value without persisting.
        let dataReady = !wallets.isEmpty || !payments.isEmpty || !spends.isEmpty
        let initial = snapshot(safeTodayBase, persist: dataReady)
        let spentToday = spends.filter { $0.deletedAt == nil && $0.spentAt >= PHT.startOfDay() }.reduce(0) { $0 + $1.amountBase }
        // Cap the live number at CURRENT wallet cash too — so even a stale-high frozen
        // daily value (e.g. one persisted by an older build before the clamp existed) can
        // never display more than you actually hold right now.
        let live = max(0, round2(min(initial - spentToday, walletBalances)))

        return SafeBreakdown(safeTodayBase: safeTodayBase, initialForToday: initial, liveRemaining: live,
                             spentToday: spentToday, walletTotal: walletTotal, confidence: confidence,
                             isLearning: isLearning, note: note)
    }

    /// PHT-day snapshot: write the day's initial safe ONCE (only when data is ready), then
    /// reuse it all day so the number is stable and only moves as you actually spend.
    private static func snapshot(_ todayBase: Double, persist: Bool) -> Double {
        let key = "safe.initial.v3." + dayKey()    // v3 = clamped to wallet cash (older v2 freezes ignored)
        let d = UserDefaults.standard
        if d.object(forKey: key) != nil { return d.double(forKey: key) }
        if persist { d.set(todayBase, forKey: key) }
        return todayBase
    }

    private static func dayKey() -> String {
        // Invariant: the day key is locale-independent (fixed Latin digits) so the snapshot survives locale changes.
        let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX")
        f.calendar = PHT.calendar; f.timeZone = PHT.zone; f.dateFormat = "yyyy-MM-dd"
        return f.string(from: .now)
    }
}

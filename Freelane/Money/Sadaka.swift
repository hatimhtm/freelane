import Foundation

/// Sadaka, redesigned for one person on one Mac (no pool, no decay, no double-counting).
/// It's a *living suggestion* + an honest tally of what was actually given. The
/// suggested amount is never a static percentage — it moves with income landed,
/// what you've already given this month, your spending pace, wallet headroom, and
/// how long it's been since your last gift. Voluntary only; never forced.
@MainActor
enum Sadaka {

    // MARK: - Auto-detection (the four kinds the user opted into)

    static let petKeywords = ["cat", "kitten", "kitty", "pet", "vet", "litter", "whiskas", "fancy feast",
                              "cat food", "pet food", "treats", "kibble", "deworm", "aspin", "puspin", "dog"]
    static let charityKeywords = ["sadaka", "sadaqah", "charity", "donation", "donate", "donated", "mosque",
                                  "masjid", "alms", "orphan", "relief", "ngo", "fundraiser", "abuloy"]
    static let givingKeywords = ["padala", "regalo", "gift", "ayuda", "tulong", "blessing", "pamasko",
                                 "allowance", "gave ", "give ", "sent to", "for mama", "for nanay", "for lola"]

    enum AutoReason: String { case pet = "Pet care", charity = "Charity", giving = "Given to someone", manual = "Marked sadaka", none = "" }

    static func autoReason(_ s: Spend) -> AutoReason {
        let hay = ([s.category, s.vendorName, s.spendDescription, s.notes].compactMap { $0 } + s.tags)
            .joined(separator: " ").lowercased()
        if charityKeywords.contains(where: hay.contains) { return .charity }
        if petKeywords.contains(where: hay.contains) { return .pet }
        if givingKeywords.contains(where: hay.contains) { return .giving }
        return .none
    }

    /// A spend counts toward sadaka if you marked it, or it matches an auto-rule.
    static func reason(_ s: Spend) -> AutoReason {
        if s.isSadaka { return .manual }
        return autoReason(s)
    }
    static func counts(_ s: Spend) -> Bool { reason(s) != .none }

    // MARK: - Tally (what was actually given)

    /// Effective given since a date: counted spends + loans forgiven in the window.
    static func given(spends: [Spend], loans: [Loan], since: Date?) -> Double {
        let lo = since ?? .distantPast
        let fromSpends = spends.filter { counts($0) && $0.spentAt >= lo }.reduce(0) { $0 + $1.amountBase }
        let fromForgiven = loans.filter { $0.status == .forgiven && ($0.forgivenAt ?? .distantPast) >= lo }
            .reduce(0) { $0 + ($1.forgivenBase ?? 0) }
        return round2(fromSpends + fromForgiven)
    }

    static func lastGiftDate(spends: [Spend], loans: [Loan]) -> Date? {
        let s = spends.filter { counts($0) }.map(\.spentAt).max()
        let l = loans.filter { $0.status == .forgiven }.compactMap(\.forgivenAt).max()
        return [s, l].compactMap { $0 }.max()
    }

    // MARK: - The living suggestion

    struct Suggestion {
        var amount: Double          // suggested to give now (rounded, comfortable)
        var target: Double          // this month's gentle target from income
        var givenMTD: Double
        var reasoning: String
        var surface: Bool           // whether to show it at all (quiet when tight)
    }

    /// Dynamic, multi-factor. Inputs that move the number:
    /// income landed ↑ → target ↑ · already-given ↑ → ask ↓ · spending pace high
    /// or wallets tight → comfort ↓ (stays quiet) · long since last gift → gentle lift.
    static func suggest(safe: SafeBreakdown, landedMTD: Double, spentMTD: Double,
                        givenMTD: Double, daysSinceLastGift: Int?, anchorPct: Double = 2.5) -> Suggestion {
        let target = max(0, landedMTD) * (anchorPct / 100)
        let remaining = max(0, target - givenMTD)

        // comfortFactor ∈ ~[0, 1.25] — the "alive" part.
        var comfort = 1.0
        if safe.isLearning { comfort *= 0.6 }                       // little data → gentle
        if safe.walletTotal <= 0 { comfort = 0 }                    // no money → silent

        // Daily headroom: how much of today's safe budget is still free.
        let headroom = safe.initialForToday > 0 ? safe.liveRemaining / safe.initialForToday : 0
        if headroom < 0.25 { comfort *= 0.35 }                      // nearly spent today → quiet
        else if headroom > 0.75 { comfort *= 1.15 }                 // lots of room → lift

        // Monthly burn vs income — overspending this month pulls the ask down.
        if landedMTD > 0 {
            let burnRatio = spentMTD / landedMTD
            if burnRatio > 1.0 { comfort *= 0.4 }                   // spending more than earning
            else if burnRatio < 0.5 { comfort *= 1.1 }              // comfortably under
        }

        // Time since last gift — a gentle (capped) lift, never guilt.
        if let d = daysSinceLastGift, d > 14 { comfort *= 1.1 }

        comfort = min(1.25, max(0, comfort))
        var amount = remaining * comfort

        // Never suggest more than today's headroom can comfortably absorb.
        amount = min(amount, max(0, safe.liveRemaining * 0.5))
        amount = (amount / 50).rounded() * 50                        // round to ₱50

        let surface = amount >= 50 && safe.walletTotal > amount
        let reasoning: String
        if !surface {
            reasoning = givenMTD >= target && target > 0
                ? "You've already given generously this month."
                : "Quiet for now — give when it feels easy."
        } else if givenMTD > 0 {
            reasoning = "A little more, on top of what you've already given."
        } else {
            reasoning = "From this month's income, whenever you feel moved."
        }

        return Suggestion(amount: amount, target: round2(target), givenMTD: round2(givenMTD),
                          reasoning: reasoning, surface: surface)
    }
}

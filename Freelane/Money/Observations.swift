import Foundation
import SwiftData

// MARK: - What the app noticed
//
// Every observation in Freelane is COMPUTED, not written. No language model is involved in deciding
// what is true about this person's money or life — it only ever sees the result.
//
// That is a deliberate reversal, and the reason is on the record. The previous build asked a model
// to "find genuine insights" in the data, with increasingly firm instructions not to speculate. It
// produced, on real data:
//
//     "Your gifting pattern is a measurable expenditure designed to preemptively manage
//      relationship friction, not genuine generosity."
//     "Low energy correlates with high food spending, suggesting calories are currently your
//      primary mood regulator."
//     "Camel buys surge during work delays, draining funds meant for a new phone."
//
// None of that is in the data. It is a model doing what generative models do — completing a
// plausible story — and no amount of prompt tightening removes the capability. Two rounds of
// blocklists caught some phrasings and missed the next ones, which is the tell that the approach
// is wrong rather than under-tuned.
//
// So the model lost the job. An observation is now a fact plus arithmetic: a comparison the user
// could verify by looking at their own rows, phrased by a `String` interpolation that cannot
// invent a cause. The engine is also strictly better in three practical ways — it is instant, it
// works with no AI available at all, and it is identical every time it runs.
//
// The rule for adding one: if you cannot compute it from rows and state it without the words
// "because", "suggests" or "reveals", it does not belong here.

/// Named `Finding` rather than `Observation` on purpose: `Observation` is the standard library
/// module that `@Model` and `@Observable` expand against, and a type with that name at file scope
/// shadows it and breaks every SwiftData model in the target.
struct Finding: Identifiable {
    var id: String { dedupKey }
    var text: String
    var area: String        // money | spending | life | pattern
    var weight: Double      // how much it deserves the user's attention
    var dedupKey: String
}

@MainActor
enum ObservationEngine {

    /// Everything worth saying right now, most significant first.
    static func compute(_ context: ModelContext) -> [Finding] {
        let base = ((try? context.fetch(FetchDescriptor<AppSettings>())) ?? []).first?.baseCurrency ?? "PHP"
        let cal = PHT.calendar
        let now = Date()

        let spends = ((try? context.fetch(FetchDescriptor<Spend>())) ?? []).filter { $0.deletedAt == nil }
        let payments = ((try? context.fetch(FetchDescriptor<Payment>())) ?? []).filter { $0.deletedAt == nil }
        let bodyLogs = ((try? context.fetch(FetchDescriptor<BodyLog>())) ?? []).filter { $0.deletedAt == nil }
        let letters = ((try? context.fetch(FetchDescriptor<Letter>())) ?? []).filter { $0.deletedAt == nil }

        func money(_ v: Double) -> String { CurrencyFormat.string(v, base, compact: true) }

        // The two windows every comparison uses: this calendar month so far, and the whole of the
        // previous one. Comparing a partial month against a full one would overstate every drop,
        // so anything month-on-month is also scaled by how far through the month we are.
        guard let thisMonthStart = cal.date(from: cal.dateComponents([.year, .month], from: now)),
              let lastMonthStart = cal.date(byAdding: .month, value: -1, to: thisMonthStart) else { return [] }
        let daysIntoMonth = max(1, cal.dateComponents([.day], from: thisMonthStart, to: now).day ?? 1)
        let daysInLastMonth = cal.range(of: .day, in: .month, for: lastMonthStart)?.count ?? 30
        let monthProgress = min(1.0, Double(daysIntoMonth) / Double(daysInLastMonth))

        let thisMonth = spends.filter { $0.spentAt >= thisMonthStart }
        let lastMonth = spends.filter { $0.spentAt >= lastMonthStart && $0.spentAt < thisMonthStart }

        var out: [Finding] = []

        // 1 — Categories that moved. The comparison is like-for-like: last month's total is scaled
        //     to the same fraction of a month we're currently standing in.
        var byCategoryNow: [String: Double] = [:]
        var byCategoryThen: [String: Double] = [:]
        for s in thisMonth { byCategoryNow[s.category ?? s.tags.first ?? "Other", default: 0] += s.amountBase }
        for s in lastMonth { byCategoryThen[s.category ?? s.tags.first ?? "Other", default: 0] += s.amountBase }

        for (cat, nowTotal) in byCategoryNow {
            let thenFull = byCategoryThen[cat] ?? 0
            let thenScaled = thenFull * monthProgress
            guard thenFull > 0, nowTotal >= 300 || thenScaled >= 300 else { continue }
            let delta = nowTotal - thenScaled
            guard abs(delta) >= 300, thenScaled > 0 else { continue }
            let pct = Int(((nowTotal - thenScaled) / thenScaled * 100).rounded())
            guard abs(pct) >= 30 else { continue }
            let dir = pct > 0 ? "up" : "down"
            out.append(Finding(
                text: "Spending tagged “\(cat)” is \(dir) \(abs(pct))% this month — \(money(nowTotal)) so far, against \(money(thenScaled)) by this point in \(lastMonthStart.formatted(.dateTime.month(.wide))).",
                area: "spending",
                weight: abs(delta),
                dedupKey: "cat:\(cat):\(monthKey(thisMonthStart))"))
        }

        // 2 — Vendors that moved, same method. Named separately from categories because a single
        //     shop moving is a different kind of fact from a whole category moving.
        var byVendorNow: [String: Double] = [:]
        var byVendorThen: [String: Double] = [:]
        for s in thisMonth { if let v = s.vendorName, !v.isEmpty { byVendorNow[v, default: 0] += s.amountBase } }
        for s in lastMonth { if let v = s.vendorName, !v.isEmpty { byVendorThen[v, default: 0] += s.amountBase } }
        for (vendor, nowTotal) in byVendorNow {
            let thenScaled = (byVendorThen[vendor] ?? 0) * monthProgress
            guard thenScaled >= 200, nowTotal >= 200 else { continue }
            let delta = nowTotal - thenScaled
            let pct = Int(((nowTotal - thenScaled) / thenScaled * 100).rounded())
            guard abs(pct) >= 40, abs(delta) >= 400 else { continue }
            out.append(Finding(
                text: "\(vendor): \(money(nowTotal)) this month, against \(money(thenScaled)) by the same point last month.",
                area: "spending",
                weight: abs(delta) * 0.9,
                dedupKey: "vendor:\(vendor.lowercased()):\(monthKey(thisMonthStart))"))
        }

        // 3 — Overall daily pace.
        let paceNow = thisMonth.reduce(0.0) { $0 + $1.amountBase } / Double(daysIntoMonth)
        let paceThen = lastMonth.reduce(0.0) { $0 + $1.amountBase } / Double(daysInLastMonth)
        if paceThen > 50, paceNow > 0 {
            let pct = Int(((paceNow - paceThen) / paceThen * 100).rounded())
            if abs(pct) >= 25 {
                out.append(Finding(
                    text: "You're spending \(money(paceNow)) a day this month, against \(money(paceThen)) a day last month.",
                    area: "spending",
                    weight: abs(paceNow - paceThen) * 12,
                    dedupKey: "pace:\(monthKey(thisMonthStart))"))
            }
        }

        // 4 — Income landed, month on month.
        let inNow = payments.filter { $0.paidAt >= thisMonthStart }
            .reduce(0.0) { $0 + ($1.grossAtMarketBase ?? $1.netAmountBase ?? 0) }
        let inThen = payments.filter { $0.paidAt >= lastMonthStart && $0.paidAt < thisMonthStart }
            .reduce(0.0) { $0 + ($1.grossAtMarketBase ?? $1.netAmountBase ?? 0) }
        if inThen > 0 || inNow > 0 {
            let scaled = inThen * monthProgress
            if abs(inNow - scaled) >= 2_000 {
                out.append(Finding(
                    text: "Income this month: \(money(inNow)) so far, against \(money(scaled)) by this point in \(lastMonthStart.formatted(.dateTime.month(.wide))).",
                    area: "money",
                    weight: abs(inNow - scaled) * 0.8,
                    dedupKey: "income:\(monthKey(thisMonthStart))"))
            }
        }

        // 5 — The single biggest spend of the month, when it genuinely stands out from the rest.
        if let biggest = thisMonth.max(by: { $0.amountBase < $1.amountBase }), thisMonth.count >= 5 {
            let others = thisMonth.filter { $0.id != biggest.id }
            let avgOther = others.reduce(0.0) { $0 + $1.amountBase } / Double(max(1, others.count))
            if avgOther > 0, biggest.amountBase >= avgOther * 4, biggest.amountBase >= 500 {
                let what = biggest.vendorName ?? biggest.spendDescription ?? "one purchase"
                out.append(Finding(
                    text: "Your largest spend this month was \(money(biggest.amountBase)) at \(what) — about \(Int((biggest.amountBase / avgOther).rounded()))× your typical one.",
                    area: "spending",
                    weight: biggest.amountBase * 0.6,
                    dedupKey: "biggest:\(monthKey(thisMonthStart))"))
            }
        }

        // 6 — Which weekday actually costs the most. Needs a full quarter so it isn't noise.
        let quarter = spends.filter { $0.spentAt >= (cal.date(byAdding: .day, value: -90, to: now) ?? now) }
        if quarter.count >= 40 {
            // Per-day totals grouped by weekday, compared on the MEDIAN rather than the mean.
            // A single large payment landing on one Wednesday otherwise defines every Wednesday —
            // the first run of this engine reported "Wednesdays cost you the most, ₱26,870 on
            // average" off the back of two outliers. The median describes the typical day, which
            // is what the sentence claims to describe.
            var dayTotals: [Date: Double] = [:]
            for s in quarter { dayTotals[cal.startOfDay(for: s.spentAt), default: 0] += s.amountBase }
            var byWeekday: [Int: [Double]] = [:]
            for (day, total) in dayTotals { byWeekday[cal.component(.weekday, from: day), default: []].append(total) }

            let medians = byWeekday.compactMapValues { values -> Double? in
                guard values.count >= 4 else { return nil }   // too few days to characterise
                let sorted = values.sorted()
                let mid = sorted.count / 2
                return sorted.count % 2 == 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
            }
            if let top = medians.max(by: { $0.value < $1.value }),
               let bottom = medians.min(by: { $0.value < $1.value }),
               top.key != bottom.key, top.value >= bottom.value * 1.8, top.value >= 200 {
                out.append(Finding(
                    text: "\(weekdayName(top.key))s are your priciest day — typically \(money(top.value)), against \(money(bottom.value)) on a \(weekdayName(bottom.key)).",
                    area: "pattern",
                    weight: (top.value - bottom.value) * 3,
                    dedupKey: "weekday:\(top.key):\(quarterKey(now))"))
            }
        }

        // 7 — Energy against spending. Reported as two averages side by side and nothing more:
        //     which way the arrow of causation points, if it points at all, is not knowable here.
        let energyRated = bodyLogs.filter { $0.energy != nil }
        if energyRated.count >= 8 {
            let spendByDay = Dictionary(grouping: spends) { cal.startOfDay(for: $0.spentAt) }
                .mapValues { $0.reduce(0.0) { $0 + $1.amountBase } }
            let low = energyRated.filter { ($0.energy ?? 3) <= 2 }.map { spendByDay[cal.startOfDay(for: $0.day)] ?? 0 }
            let high = energyRated.filter { ($0.energy ?? 3) >= 4 }.map { spendByDay[cal.startOfDay(for: $0.day)] ?? 0 }
            if low.count >= 4, high.count >= 4 {
                let lowAvg = low.reduce(0, +) / Double(low.count)
                let highAvg = high.reduce(0, +) / Double(high.count)
                let bigger = max(lowAvg, highAvg), smaller = min(lowAvg, highAvg)
                if smaller > 0, bigger >= smaller * 1.5, bigger >= 200 {
                    out.append(Finding(
                        text: "On low-energy days you spend \(money(lowAvg)); on high-energy days, \(money(highAvg)). Across \(low.count) and \(high.count) days.",
                        area: "life",
                        weight: abs(lowAvg - highAvg) * 4,
                        dedupKey: "energy:\(monthKey(thisMonthStart))"))
                }
            }
        }

        // 8 — Sleep against spending, same treatment.
        let slept = bodyLogs.filter { $0.sleepHours != nil }
        if slept.count >= 10 {
            let spendByDay = Dictionary(grouping: spends) { cal.startOfDay(for: $0.spentAt) }
                .mapValues { $0.reduce(0.0) { $0 + $1.amountBase } }
            let short = slept.filter { ($0.sleepHours ?? 8) < 6 }.map { spendByDay[cal.startOfDay(for: $0.day)] ?? 0 }
            let full = slept.filter { ($0.sleepHours ?? 8) >= 7 }.map { spendByDay[cal.startOfDay(for: $0.day)] ?? 0 }
            if short.count >= 4, full.count >= 4 {
                let shortAvg = short.reduce(0, +) / Double(short.count)
                let fullAvg = full.reduce(0, +) / Double(full.count)
                if min(shortAvg, fullAvg) > 0, max(shortAvg, fullAvg) >= min(shortAvg, fullAvg) * 1.5 {
                    out.append(Finding(
                        text: "After nights under 6 hours you spend \(money(shortAvg)); after 7 or more, \(money(fullAvg)).",
                        area: "life",
                        weight: abs(shortAvg - fullAvg) * 3,
                        dedupKey: "sleep:\(monthKey(thisMonthStart))"))
                }
            }
        }

        // 9 — Writing rhythm. A count of what happened, with no opinion about whether it's enough.
        let last30 = letters.filter { $0.createdAt >= (cal.date(byAdding: .day, value: -30, to: now) ?? now) }
        let prev30 = letters.filter {
            $0.createdAt >= (cal.date(byAdding: .day, value: -60, to: now) ?? now) &&
            $0.createdAt < (cal.date(byAdding: .day, value: -30, to: now) ?? now)
        }
        if last30.count + prev30.count >= 6, abs(last30.count - prev30.count) >= 3 {
            out.append(Finding(
                text: "You wrote \(last30.count) entries in the last 30 days, against \(prev30.count) in the 30 before.",
                area: "life",
                weight: Double(abs(last30.count - prev30.count)) * 150,
                dedupKey: "writing:\(monthKey(thisMonthStart))"))
        }

        // 10 — The mood words that keep coming back.
        let sentiments = letters
            .filter { $0.createdAt >= (cal.date(byAdding: .day, value: -60, to: now) ?? now) }
            .compactMap { $0.sentiment?.lowercased() }
        if sentiments.count >= 8 {
            let counts = Dictionary(sentiments.map { ($0, 1) }, uniquingKeysWith: +)
            if let top = counts.max(by: { $0.value < $1.value }), top.value >= 3,
               Double(top.value) / Double(sentiments.count) >= 0.3 {
                out.append(Finding(
                    text: "“\(top.key.capitalized)” is the mood you've tagged most in the last two months — \(top.value) of \(sentiments.count) entries.",
                    area: "life",
                    weight: Double(top.value) * 120,
                    dedupKey: "mood:\(top.key):\(monthKey(thisMonthStart))"))
            }
        }

        return out.sorted { $0.weight > $1.weight }
    }

    /// Reconcile the stored observations against what the numbers say NOW: update, insert, retire.
    /// Returns how many rows changed. No AI, no network.
    ///
    /// This used to only ever insert. An observation whose `dedupKey` already existed was skipped
    /// entirely — and since these findings are arithmetic over the user's own rows, the key is
    /// stable for a whole month while the sentence attached to it changes every single day. So the
    /// Dashboard sat on "Spending tagged 'Wife' is down 96% — ₱853.15 so far" and "You're spending
    /// ₱517.68 a day this month" for two days after those figures stopped being true, and pressing
    /// Refresh recomputed the identical findings, matched the identical keys, added nothing, and
    /// changed nothing on screen. The card looked frozen because it was.
    ///
    /// Three outcomes now, which is what "refresh" has to mean for computed content:
    ///  · the finding still holds and its numbers moved → the row's text is rewritten in place,
    ///    keeping `createdAt` so the card doesn't reshuffle under you;
    ///  · the finding is new → inserted, up to `limit` per pass;
    ///  · the engine no longer produces it at all (the month rolled over, the gap closed) → retired,
    ///    unless you pinned it, because a pin means you want to keep looking at it.
    @discardableResult
    static func refresh(_ context: ModelContext, limit: Int = 4) -> Int {
        // THE STORED SET *IS* THE TOP FINDINGS. Not "the top findings, plus everything that was
        // ever a top finding".
        //
        // `compute` returns most-significant-first, and the Dashboard sorts what it shows by
        // recency — so an insert-only refresh quietly inverted the ranking. Each pass added the
        // next four findings down the list, they were the newest rows, and the card showed them.
        // After two launches the front page led with "Snacks is down 69%" while "you are spending
        // ₱543 a day against ₱5,667 last month" had been pushed off the bottom.
        let top = Array(compute(context).prefix(limit))
        let wanted = Set(top.map(\.dedupKey))
        let all = ((try? context.fetch(FetchDescriptor<InsightLog>())) ?? [])
        var live: [String: InsightLog] = [:]
        var dismissedKeys = Set<String>()
        for row in all {
            guard let k = row.key else { continue }
            if row.dismissedAt == nil { live[k] = row } else { dismissedKeys.insert(k) }
        }

        var changed = 0
        for o in top {
            if let row = live[o.dedupKey] {
                // Same finding, new numbers. Rewritten in place, keeping `createdAt` so the card
                // doesn't reshuffle under someone who is reading it.
                guard row.text != o.text else { continue }
                row.text = o.text; row.category = o.area; row.dirty = true
                changed += 1
            } else if !dismissedKeys.contains(o.dedupKey) {
                // Not re-added if you dismissed it. Dismissal now means something for the life of
                // the key (a month, a quarter), because the engine no longer needs `dismissedAt`
                // as its own bookkeeping — see below.
                let row = InsightLog(text: o.text, category: o.area, key: o.dedupKey)
                row.dirty = true
                context.insert(row)
                changed += 1
            }
        }

        // Anything that is no longer a top finding is DELETED, not dismissed. These rows are
        // derived data — recomputable from the ledger in microseconds — so there is nothing to
        // preserve, and using `dismissedAt` for engine bookkeeping is what made a user's dismissal
        // indistinguishable from the engine's own housekeeping. Pins survive: a pin is a request.
        var removed = 0
        for row in all where row.dismissedAt == nil && !row.pinned {
            guard let k = row.key, !wanted.contains(k) else { continue }
            context.delete(row)
            removed += 1
        }

        if changed + removed > 0 { try? context.save() }
        UserDefaults.standard.set(Date.now.timeIntervalSince1970, forKey: "insights.lastAt")
        return changed + removed
    }

    // MARK: Helpers

    private static func monthKey(_ d: Date) -> String {
        let f = DateFormatter(); f.calendar = PHT.calendar; f.timeZone = PHT.zone; f.dateFormat = "yyyy-MM"
        return f.string(from: d)
    }
    private static func quarterKey(_ d: Date) -> String {
        let m = PHT.calendar.component(.month, from: d)
        let y = PHT.calendar.component(.year, from: d)
        return "\(y)-Q\((m - 1) / 3 + 1)"
    }
    private static func weekdayName(_ weekday: Int) -> String {
        let f = DateFormatter(); f.calendar = PHT.calendar; f.locale = Locale(identifier: "en_US")
        let symbols = f.weekdaySymbols ?? ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
        let idx = max(0, min(symbols.count - 1, weekday - 1))
        return symbols[idx]
    }
}

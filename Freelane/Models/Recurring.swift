import Foundation
import SwiftData

enum RecurringKind: String, Codable, CaseIterable, Sendable { case expense, income
    var label: String { self == .expense ? "Bill" : "Income" }
}
enum RecurringCadence: String, Codable, CaseIterable, Sendable { case weekly, monthly, yearly
    var label: String { rawValue.capitalized }
}

/// A repeating bill or income. Feeds safe-to-spend's committed pool so the daily
/// allowance already reserves what's coming.
@Model
final class Recurring {
    @Attribute(.unique) var id: UUID
    var deletedAt: Date? = nil   // soft-delete tombstone — nil = live; set = in Trash (P1 restore/undo)
    var label: String
    var kindRaw: String
    var cadenceRaw: String
    var amount: Double
    var currency: String
    var amountBase: Double
    var dayOfMonth: Int?
    var walletId: UUID?
    var paidThroughDate: Date? = nil    // settled up to here (incl. prepaid periods)
    var isVariableAmount: Bool = false  // electricity/water — amount unknown until paid
    var active: Bool
    var notes: String?
    var createdAt: Date
    var updatedAt: Date
    var dirty: Bool

    var kind: RecurringKind { get { RecurringKind(rawValue: kindRaw) ?? .expense } set { kindRaw = newValue.rawValue } }
    var cadence: RecurringCadence { get { RecurringCadence(rawValue: cadenceRaw) ?? .monthly } set { cadenceRaw = newValue.rawValue } }

    init(id: UUID = UUID(), label: String, kind: RecurringKind = .expense,
         cadence: RecurringCadence = .monthly, amount: Double, currency: String, amountBase: Double) {
        self.id = id; self.label = label; self.kindRaw = kind.rawValue; self.cadenceRaw = cadence.rawValue
        self.amount = amount; self.currency = currency; self.amountBase = amountBase
        self.active = true; self.createdAt = .now; self.updatedAt = .now; self.dirty = false
    }
}

enum RecurringMath {

    // MARK: - Schedule anchors (the single source of truth for "when is a period due")
    //
    // Every occurrence is anchored to the RULE, never to "today" or to when you paid:
    //   · monthly  → `dayOfMonth` (e.g. always the 13th).
    //   · weekly   → the weekday the rule was created on (set up on a Friday → Fridays).
    //   · yearly   → the `createdAt` month+day (the anniversary).
    // All the period helpers below are built on `anchored(in:)`, so paying a bill late or
    // early can never shift the schedule — it just settles the period it belongs to.

    static func step(_ r: Recurring) -> Calendar.Component {
        switch r.cadence { case .weekly: return .weekOfYear; case .yearly: return .year; case .monthly: return .month }
    }

    /// The rule's scheduled occurrence within the SAME container (month / week / year) that
    /// `date` falls in. Day-aligned; may be before or after `date`.
    static func anchored(_ r: Recurring, in date: Date) -> Date {
        let cal = PHT.calendar
        switch r.cadence {
        case .monthly:
            let dom = min(max(r.dayOfMonth ?? 1, 1), 28)   // 28 cap → always a real day
            var comps = cal.dateComponents([.year, .month], from: date); comps.day = dom
            return cal.startOfDay(for: cal.date(from: comps) ?? date)
        case .weekly:
            let anchorWeekday = cal.component(.weekday, from: r.createdAt)
            var d = cal.startOfDay(for: date), n = 0
            while cal.component(.weekday, from: d) != anchorWeekday, n < 7 {   // step back to the anchor weekday
                d = cal.date(byAdding: .day, value: -1, to: d) ?? d; n += 1
            }
            return d
        case .yearly:
            let md = cal.dateComponents([.month, .day], from: r.createdAt)
            let wantMonth = md.month ?? 1, wantDay = md.day ?? 1
            let year = cal.component(.year, from: date)
            var c = DateComponents(); c.year = year; c.month = wantMonth; c.day = wantDay
            if let exact = cal.date(from: c),
               cal.component(.month, from: exact) == wantMonth,
               cal.component(.day, from: exact) == wantDay { return cal.startOfDay(for: exact) }
            // Clamp an invalid day (Feb 29 in a non-leap year) down to the month's last real day.
            var first = DateComponents(); first.year = year; first.month = wantMonth; first.day = 1
            if let fd = cal.date(from: first), let range = cal.range(of: .day, in: .month, for: fd) {
                c.day = min(wantDay, range.count)
            }
            return cal.startOfDay(for: cal.date(from: c) ?? date)
        }
    }

    /// First scheduled occurrence on or after `date`.
    static func firstOccurrence(_ r: Recurring, onOrAfter date: Date) -> Date {
        let cal = PHT.calendar, day = cal.startOfDay(for: date)
        var o = anchored(r, in: day), n = 0
        while o < day, n < 60 { o = anchored(r, in: cal.date(byAdding: step(r), value: 1, to: o) ?? o); n += 1 }
        return o
    }
    /// First scheduled occurrence strictly after `date`.
    static func occurrence(_ r: Recurring, after date: Date) -> Date {
        let cal = PHT.calendar
        return firstOccurrence(r, onOrAfter: cal.date(byAdding: .day, value: 1, to: cal.startOfDay(for: date)) ?? date)
    }
    /// Latest scheduled occurrence on or before `date`.
    static func occurrence(_ r: Recurring, onOrBefore date: Date) -> Date {
        let cal = PHT.calendar, day = cal.startOfDay(for: date)
        var o = anchored(r, in: day), n = 0
        while o > day, n < 60 { o = anchored(r, in: cal.date(byAdding: step(r), value: -1, to: o) ?? o); n += 1 }
        return o
    }

    /// The next UNPAID occurrence — the heart of "is this due?". Anchored purely to the
    /// schedule + what's been paid, never to today, so it's honest about overdue bills:
    ///   · paid through P  → the first scheduled occurrence after P.
    ///   · never paid      → the first scheduled occurrence on/after the rule's createdAt
    ///                       (which may already be in the past = overdue, and should show so).
    static func nextDue(_ r: Recurring, now: Date = .now) -> Date? {
        if let pt = r.paidThroughDate { return occurrence(r, after: pt) }
        return firstOccurrence(r, onOrAfter: r.createdAt)
    }

    /// DERIVE `paidThroughDate` from the live spends linked to this rule — the single source of
    /// truth. The model is deliberately DATE-INDEPENDENT: N periods of payment settle the first
    /// N consecutive scheduled occurrences starting at the rule's first occurrence. WHEN you pay
    /// (early, on time, or weeks late) never changes which period a payment covers — that was the
    /// root of the "paid late → skipped a month" bug. Deleting/restoring a spend changes the
    /// count and re-derives automatically. Returns nil when nothing live is linked.
    static func recomputePaidThrough(_ r: Recurring, spends: [Spend]) -> Date? {
        let live = spends.filter { $0.recurringId == r.id && $0.deletedAt == nil }
        guard !live.isEmpty else { return nil }
        let total = live.reduce(0) { $0 + max(1, $1.coversPeriods) }
        var occ = firstOccurrence(r, onOrAfter: r.createdAt)
        var i = 1
        while i < total { occ = occurrence(r, after: occ); i += 1 }
        return PHT.calendar.startOfDay(for: occ)
    }

    /// Expected total (base) of a kind over the next `days`.
    ///
    /// Counts the occurrences that are actually still **owed** in the window, starting from
    /// `nextDue` — so a bill settled months in advance contributes nothing until its cover runs out.
    ///
    /// The previous version pro-rated the rule's amount across the window regardless of what had
    /// been paid. Prepay a year of wifi and it still reserved a month of wifi money every month for
    /// the next twelve, in safe-to-spend, in the 30-day bills tile, and in the assistant's figures.
    /// Anything that asks "what is still coming" now gets an answer that knows what you already
    /// paid. Arrears are deliberately excluded: an overdue bill is money owed *now*, surfaced on
    /// the Agenda, not part of a forward forecast.
    static func expectedBase(_ recs: [Recurring], kind: RecurringKind, days: Int) -> Double {
        let cal = PHT.calendar
        let from = PHT.startOfDay()
        guard let to = cal.date(byAdding: .day, value: days, to: from) else { return 0 }
        return recs.filter { $0.active && $0.kind == kind && $0.deletedAt == nil }.reduce(0) { acc, r in
            var occ = nextDue(r) ?? firstOccurrence(r, onOrAfter: from)
            if occ < from { occ = firstOccurrence(r, onOrAfter: from) }
            var total = 0.0, n = 0
            while occ < to, n < 400 {
                total += r.amountBase
                occ = occurrence(r, after: occ)
                n += 1
            }
            return acc + total
        }
    }

    /// Bills already settled beyond `days` — what you have bought yourself out of, and until when.
    /// Reported rather than silently dropped, so money that vanishes from the commitment figure
    /// always has a visible reason.
    static func prepaidBeyond(_ recs: [Recurring], kind: RecurringKind, days: Int)
        -> [(rule: Recurring, coveredTo: Date)] {
        let cal = PHT.calendar
        let from = PHT.startOfDay()
        guard let to = cal.date(byAdding: .day, value: days, to: from) else { return [] }
        return recs.filter { $0.active && $0.kind == kind && $0.deletedAt == nil }
            .compactMap { r in
                guard let next = nextDue(r), next >= to else { return nil }
                return (r, next)
            }
            .sorted { $0.coveredTo > $1.coveredTo }
    }
}

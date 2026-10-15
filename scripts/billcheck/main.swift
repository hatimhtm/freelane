import Foundation
import SwiftData

// Regression check for RecurringMath.recomputePaidThrough — real payment histories that once broke it.
// Run with scripts/check-bills.sh.
func pht(_ s: String) -> Date {
    let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX")
    f.timeZone = PHT.zone; f.dateFormat = "yyyy-MM-dd HH:mm"; return f.date(from: s)!
}
func day(_ d: Date?) -> String {
    guard let d else { return "nil" }
    let f = DateFormatter(); f.timeZone = PHT.zone; f.dateFormat = "yyyy-MM-dd"; return f.string(from: d)
}

@main struct Check {
    static func main() throws {
        let container = try ModelContainer(for: Recurring.self, Spend.self,
                                           configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        let ctx = ModelContext(container)
        var failures = 0
        func rule(_ label: String, dom: Int, created: String) -> Recurring {
            let r = Recurring(label: label, amount: 1, currency: "PHP", amountBase: 1)
            r.dayOfMonth = dom; r.createdAt = pht(created); ctx.insert(r); return r
        }
        func pay(_ r: Recurring, _ at: String, periods: Int = 1, deleted: Bool = false) {
            let s = Spend(walletId: nil, spentAt: pht(at), amount: 1, currency: "PHP", amountBase: 1)
            s.recurringId = r.id; s.coversPeriods = periods; if deleted { s.deletedAt = .now }; ctx.insert(s)
        }
        func expect(_ r: Recurring, paidThrough: String, nextDue: String) {
            RecurringMath.resyncAll(ctx)
            let pt = day(r.paidThroughDate), nd = day(RecurringMath.nextDue(r))
            let ok = pt == paidThrough && nd == nextDue
            if !ok { failures += 1 }
            print(ok ? "ok  " : "FAIL", r.label, "paid through", pt, "(want \(paidThrough)) next due", nd, "(want \(nextDue))")
        }

        // Live rules as of 2026-10-15, with every linked payment.
        let rent = rule("Rent", dom: 15, created: "2026-06-06 00:00")
        for d in ["2026-06-14 12:00", "2026-07-15 12:00", "2026-08-15 22:07", "2026-09-01 21:46", "2026-10-10 22:43"] { pay(rent, d) }
        expect(rent, paidThrough: "2026-10-15", nextDue: "2026-11-15")

        let wifi = rule("Wifi", dom: 9, created: "2026-06-06 00:02")
        pay(wifi, "2026-06-07 12:00"); pay(wifi, "2026-06-21 12:00"); pay(wifi, "2026-07-28 11:43", periods: 12)
        expect(wifi, paidThrough: "2027-07-09", nextDue: "2027-08-09")

        let water = rule("Water", dom: 1, created: "2026-06-06 03:51")
        for d in ["2026-07-09 12:00", "2026-08-02 09:03", "2026-09-01 21:46", "2026-10-10 22:42"] { pay(water, d) }
        expect(water, paidThrough: "2026-10-01", nextDue: "2026-11-01")

        // Tonight: Electricity re-created at 22:37 and paid at once.
        let elec = rule("Electricity", dom: 15, created: "2026-10-15 22:37")
        pay(elec, "2026-10-15 22:37")
        expect(elec, paidThrough: "2026-10-15", nextDue: "2026-11-15")

        // The original Electricity rule, after its day moved 13 → 15: Jun–Sep paid, October due.
        let old = rule("Electricity (old)", dom: 15, created: "2026-06-06 03:51")
        for d in ["2026-06-14 12:00", "2026-07-18 12:00", "2026-08-20 22:07", "2026-09-23 21:54"] { pay(old, d) }
        expect(old, paidThrough: "2026-09-15", nextDue: "2026-10-15")

        // Tracked mid-stream: set up in June, first payment logged in August. June and July were
        // never recorded here, so they must not show as owed.
        let mid = rule("Mid-stream", dom: 15, created: "2026-06-06 00:00")
        pay(mid, "2026-08-20 12:00")
        expect(mid, paidThrough: "2026-08-15", nextDue: "2026-09-15")

        // Set up the day AFTER its due day, then paid: must cover the 15th just gone, not skip November.
        let late = rule("Set up late", dom: 15, created: "2026-10-16 09:00")
        pay(late, "2026-10-16 09:05")
        expect(late, paidThrough: "2026-10-15", nextDue: "2026-11-15")

        // A deleted payment no longer counts.
        let del = rule("Deleted pay", dom: 1, created: "2026-08-01 00:00")
        pay(del, "2026-08-01 10:00"); pay(del, "2026-09-01 10:00", deleted: true)
        expect(del, paidThrough: "2026-08-01", nextDue: "2026-09-01")

        // Never paid: due from the first occurrence after creation.
        let never = rule("Never paid", dom: 20, created: "2026-10-01 00:00")
        expect(never, paidThrough: "nil", nextDue: "2026-10-20")

        print(failures == 0 ? "\nALL PASS" : "\n\(failures) FAILED")
        exit(failures == 0 ? 0 : 1)
    }
}

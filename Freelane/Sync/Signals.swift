import Foundation
import SwiftData

/// Turns money state into notifications — the native equivalent of the web app's
/// notification dispatcher + sweeps. Safe to run on every app focus and after relevant
/// mutations: every signal it posts is deduped by `Notify.postUnique`, so re-scanning
/// can only surface genuinely new conditions, never spam.
@MainActor
enum Signals {

    static let agingDays = 21

    static func sweep(_ context: ModelContext) {
        // No day-gate: a stale once-per-day gate meant new overdrafts / due bills wouldn't
        // surface until the next calendar day. Dedup lives in `Notify.postUnique` instead.
        let d = StateSnapshot.load(context)
        func money(_ v: Double) -> String { CurrencyFormat.string(v, d.baseCurrency, compact: true) }

        // 1) Aging open projects (outstanding + open ≥ agingDays).
        for p in d.projects where p.status == .unpaid || p.status == .partiallyPaid {
            let out = ProjectMath.outstandingNative(project: p, allocations: d.allocations, rates: d.rates)
            guard out > 0 else { continue }
            let age = PHT.calendar.dateComponents([.day], from: p.agingAnchor, to: .now).day ?? 0
            guard age >= agingDays else { continue }
            let client = d.clients.first { $0.id == p.clientId }?.name ?? "this client"
            Notify.postUnique(context, dedupKey: "project_aging:\(p.id.uuidString)",
                              kind: "project_aging", subject: "\(p.title) has been open \(age) days",
                              body: "\(CurrencyFormat.string(out, p.currency, compact: true)) still outstanding from \(client).",
                              priority: 1, feature: .projects)
        }

        // 2) Wallet below its overdraft tolerance — skip wallets you've marked "ignore"
        //    (e.g. a managed-negative bank account you don't use).
        for w in d.wallets where w.isHolding && !w.archived && !w.excludedFromTotals {
            let bal = WalletMath.balance(of: w, ledger: d.ledger)
            if bal < -w.overdraftToleranceBase {
                Notify.postUnique(context, dedupKey: "wallet_neg:\(w.id.uuidString)",
                                  kind: "wallet_low", subject: "\(w.name) is overdrawn",
                                  body: "Balance \(money(bal)). Log a payment or move money in.",
                                  priority: 2, feature: .wallets)
            }
        }

        // 2b) Bills due soon OR overdue, and not yet paid this period — with the exact date.
        for r in d.recurrings where r.active && r.kind == .expense {
            guard let due = RecurringMath.nextDue(r) else { continue }
            let dueDay = PHT.startOfDay(due)
            let days = PHT.calendar.dateComponents([.day], from: PHT.startOfDay(), to: dueDay).day ?? 99
            if days <= 3 {   // includes overdue (negative) so a missed bill surfaces instead of hiding
                let est = r.amountBase > 0 ? " (~\(money(r.amountBase)))" : ""
                let overdue = days < 0
                // The due-date is part of the dedup key ON PURPOSE: each occurrence of a
                // recurring bill is a distinct reminder, so next month's due re-notifies — and
                // (with Notify's once-per-occurrence guard) a single bill never nags repeatedly.
                Notify.postUnique(context, dedupKey: "bill_due:\(r.id.uuidString):\(Int(dueDay.timeIntervalSince1970))",
                                  kind: "bill_due",
                                  subject: "\(r.label) \(overdue ? "is overdue" : (days == 0 ? "due today" : "due in \(days) day\(days == 1 ? "" : "s")"))",
                                  body: "\(overdue ? "Was due" : "Around") \(due.formatted(.dateTime.month().day()))\(est). Pay it in Spending → Recurring.",
                                  priority: overdue ? 2 : 1, feature: .spending)
            }
        }

        // 2c) Loans overdue or due soon — money owed back to you (or that you owe).
        for l in d.loans where (l.statusRaw == "open" || l.statusRaw == "partially_returned") && l.outstandingBase > 0 {
            guard let due = l.dueDate else { continue }
            let days = PHT.calendar.dateComponents([.day], from: PHT.startOfDay(), to: PHT.startOfDay(due)).day ?? 99
            guard days <= 3 else { continue }   // due within 3 days or overdue
            let mine = l.direction == .given
            let overdue = days < 0
            Notify.postUnique(context, dedupKey: "loan_due:\(l.id.uuidString):\(PHT.dayKey(due))",
                              kind: "loan_due",
                              subject: mine ? "\(l.counterparty) owes you \(overdue ? "(overdue)" : "soon")"
                                             : "You owe \(l.counterparty) \(overdue ? "(overdue)" : "soon")",
                              body: "\(money(l.outstandingBase)) \(overdue ? "was due \(-days)d ago" : (days == 0 ? "due today" : "due in \(days)d")).",
                              priority: overdue ? 2 : 1, feature: .loans)
        }

        // 3) Living sadaka suggestion — only when it's genuinely affordable and
        //    nothing's been given yet this month. The amount is computed dynamically.
        let monthStart = PHT.startOfMonth()
        let safe = SafeToSpend.compute(payments: d.payments, spends: d.spends, wallets: d.wallets, ledger: d.ledger, recurrings: d.recurrings, plans: d.plans)
        let givenMTD = Sadaka.given(spends: d.spends, loans: d.loans, since: monthStart)
        let spentMTD = d.spends.filter { $0.spentAt >= monthStart }.reduce(0) { $0 + $1.amountBase }
        let sug = Sadaka.suggest(safe: safe, landedMTD: d.metrics.landedMTD, spentMTD: spentMTD,
                                 givenMTD: givenMTD, daysSinceLastGift: nil)
        if sug.surface, sug.amount >= 100, givenMTD <= 0 {
            let phtMonth = String(Brain.phtDay().prefix(7))
            Notify.postUnique(context, dedupKey: "sadaka_nudge:\(phtMonth)",
                              kind: "sadaka_nudge", subject: "A small sadaka, if it feels easy",
                              body: "Around \(money(sug.amount)) would sit comfortably right now — whenever you feel moved, never required.",
                              priority: 0, feature: .sadaka)
        }
    }
}

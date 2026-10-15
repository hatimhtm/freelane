import Foundation
import SwiftData

/// One-time data repairs approved on 16 Oct 2026. Each runs once (flagged), after a backup, and
/// leaves every wallet balance exactly where the counts put it: it only changes what the money is
/// recorded as.
enum Repairs {
    /// Payments that landed in no wallet, the corrections that stood in for them, and loans that were
    /// really spending.
    @MainActor static func runIfNeeded(_ context: ModelContext) {
        // The marker lives beside the store, so a test copy can never mark the real data as repaired.
        let marker = AppPaths.root.appendingPathComponent("repairs-v2.done")
        guard !FileManager.default.fileExists(atPath: marker.path) else { return }
        if !DevMode.isSandboxed {
            let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd-HHmmss"
            guard DataBackup.backupNow(stamp: "before-v2-repair-" + f.string(from: .now)) != nil else { return }
        }
        attachPaymentsToWise(context)
        convertLoansToSpending(context)
        RecurringMath.resyncAll(context)
        try? context.save()
        FileManager.default.createFile(atPath: marker.path, contents: Data(Date.now.description.utf8))
    }

    private static func uuid(_ hex: String) -> UUID? {
        let h = Array(hex)
        guard h.count == 32 else { return nil }
        let s = String(h[0..<8]) + "-" + String(h[8..<12]) + "-" + String(h[12..<16]) + "-" + String(h[16..<20]) + "-" + String(h[20..<32])
        return UUID(uuidString: s)
    }

    /// Three payments were saved with no landing wallet; they landed in Wise. Two were balanced by hand
    /// with count corrections, which retire here; the third ended up inside a later Wise correction,
    /// which shrinks by its amount.
    @MainActor private static func attachPaymentsToWise(_ context: ModelContext) {
        let wallets = (try? context.fetch(FetchDescriptor<Wallet>())) ?? []
        guard let wise = wallets.first(where: { $0.id == uuid("5F6EE56331624C85AD4214DB2E64793D") }) else { return }
        let payments = (try? context.fetch(FetchDescriptor<Payment>())) ?? []
        let ledger = (try? context.fetch(FetchDescriptor<LedgerEntry>())) ?? []
        let steps = (try? context.fetch(FetchDescriptor<PaymentStep>())) ?? []
        let ids = ["FB2EBA77CD1C4ED19BC39A1331E20DDB", "6F07A0FEF87A4937A9039CF1CC9C3ECA", "78BF8F9EC8C74050AAA5F5242F9409E2"].compactMap(uuid)
        var attached = 0
        for pid in ids {
            guard let p = payments.first(where: { $0.id == pid && $0.deletedAt == nil }), let net = p.netAmountBase, net > 0 else { continue }
            // Already has a live income leg? Then it isn't missing anything.
            guard !ledger.contains(where: { $0.relatedId == pid && $0.kind == .income && $0.archivedAt == nil }) else { continue }
            let leg = LedgerEntry(kind: .income, amountBase: round2(net), walletId: wise.id, relatedKind: .payment, relatedId: pid,
                                  eventAt: p.paidAt, note: "landed in Wise (repaired)")
            leg.dirty = true
            context.insert(leg)
            if let last = steps.filter({ $0.paymentId == pid }).max(by: { $0.stepOrder < $1.stepOrder }), last.methodId == nil {
                last.methodId = wise.id; last.dirty = true
            }
            p.dirty = true; p.updatedAt = .now
            attached += 1
        }
        guard attached == ids.count else { return }   // only retire the stand-ins when every payment now has its leg
        for hex in ["FE1FD0E54593486A881EBA969944CBA6", "9BB6CADDD7FC43C590101920F1AF13C5"] {
            if let id = uuid(hex), let e = ledger.first(where: { $0.id == id && $0.archivedAt == nil }) { e.archivedAt = .now; e.dirty = true }
        }
        if let id = uuid("D3FBA93A8BB84BB8B5E80D1E93E426C7"), let e = ledger.first(where: { $0.id == id && $0.archivedAt == nil }),
           let july = payments.first(where: { $0.id == ids[0] })?.netAmountBase, e.amountBase > july {
            e.amountBase = round2(e.amountBase - july); e.dirty = true
        }
    }

    /// Seven loans to one person were really spending on them. The unreturned part of each becomes a
    /// spend on the same wallet and day, filed under that person's name; the loan keeps only what was
    /// paid back.
    @MainActor private static func convertLoansToSpending(_ context: ModelContext) {
        let ids = Set(["2AE5F70D196348CFA658928A884D5F99", "5C2994570CAC4BB099C6D0B73AE2A44B", "D5FC2FB7E7054239A9F49319E5B6671C",
                       "E8C5D7A424454A74B9E708CDE9175DDC", "A85775D1B9A348F0A9D04545942618D3", "E169E2DC487C4CC3A28A2F00817C9FFF",
                       "21D5B6AECB674DF18B4B0576A9D56FAD"].compactMap(uuid))
        let loans = ((try? context.fetch(FetchDescriptor<Loan>())) ?? [])
            .filter { ids.contains($0.id) && $0.deletedAt == nil && $0.direction == .given && $0.outstandingBase > 0.005 }
        let ledger = (try? context.fetch(FetchDescriptor<LedgerEntry>())) ?? []
        for loan in loans {
            guard let walletId = loan.originWalletId else { continue }
            let unreturned = round2(loan.outstandingBase)
            let returned = round2(loan.principalBase - unreturned)
            guard let lent = ledger.first(where: { $0.relatedId == loan.id && $0.kind == .outflow && $0.archivedAt == nil && $0.walletId == walletId }) else { continue }
            let s = Spend(walletId: walletId, spentAt: loan.startedAt, amount: unreturned, currency: "PHP", amountBase: unreturned)
            let who = loan.counterparty.trimmingCharacters(in: .whitespaces)
            s.category = who.prefix(1).uppercased() + who.dropFirst()
            s.tags = [s.category!]
            s.spendDescription = (loan.notes?.isEmpty == false) ? loan.notes : "For my \(who.lowercased())"
            s.dirty = true
            context.insert(s)
            let leg = LedgerEntry(kind: .outflow, amountBase: -unreturned, walletId: walletId, relatedKind: .spend, relatedId: s.id,
                                  eventAt: loan.startedAt, note: "createSpend")
            leg.dirty = true
            context.insert(leg)
            if returned > 0.005 {
                lent.amountBase = -returned; lent.dirty = true
                loan.principalBase = returned; loan.outstandingBase = 0; loan.status = .returned
            } else {
                lent.archivedAt = .now; lent.dirty = true
                loan.outstandingBase = 0; loan.deletedAt = .now
            }
            loan.dirty = true; loan.updatedAt = .now
        }
    }
}

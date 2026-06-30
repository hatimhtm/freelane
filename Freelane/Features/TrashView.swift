import SwiftUI
import SwiftData

/// Recently-deleted bin. Everything soft-deleted lands here, stays restorable for 30 days,
/// then auto-purges. Money entities restore through their engines so balances + project
/// status recompute; permanent delete also clears their archived ledger rows.
struct TrashView: View {
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @Query private var settings: [AppSettings]

    @Query(filter: #Predicate<Spend>      { $0.deletedAt != nil }, sort: \Spend.deletedAt,      order: .reverse) private var spends: [Spend]
    @Query(filter: #Predicate<Payment>    { $0.deletedAt != nil }, sort: \Payment.deletedAt,    order: .reverse) private var payments: [Payment]
    @Query(filter: #Predicate<Withdrawal> { $0.deletedAt != nil }, sort: \Withdrawal.deletedAt, order: .reverse) private var withdrawals: [Withdrawal]
    @Query(filter: #Predicate<Project>    { $0.deletedAt != nil }, sort: \Project.deletedAt,    order: .reverse) private var projects: [Project]
    @Query(filter: #Predicate<Recurring>  { $0.deletedAt != nil }, sort: \Recurring.deletedAt,  order: .reverse) private var recurrings: [Recurring]
    @Query(filter: #Predicate<Loan>       { $0.deletedAt != nil }, sort: \Loan.deletedAt,       order: .reverse) private var loans: [Loan]
    @Query(filter: #Predicate<Client>     { $0.deletedAt != nil }, sort: \Client.deletedAt,     order: .reverse) private var clients: [Client]
    @Query(filter: #Predicate<Vendor>     { $0.deletedAt != nil }, sort: \Vendor.deletedAt,     order: .reverse) private var vendors: [Vendor]
    @Query(filter: #Predicate<Entity>     { $0.deletedAt != nil }, sort: \Entity.deletedAt,     order: .reverse) private var entities: [Entity]
    @Query(filter: #Predicate<Letter>     { $0.deletedAt != nil }, sort: \Letter.deletedAt,     order: .reverse) private var letters: [Letter]
    @Query(filter: #Predicate<BodyLog>    { $0.deletedAt != nil }, sort: \BodyLog.deletedAt,    order: .reverse) private var bodyLogs: [BodyLog]
    @Query(filter: #Predicate<Wallet>     { $0.deletedAt != nil }, sort: \Wallet.deletedAt,     order: .reverse) private var wallets: [Wallet]

    private var base: String { settings.first?.baseCurrency ?? "PHP" }

    struct Row: Identifiable {
        let id: UUID
        let icon: String
        let tint: Color
        let title: String
        let sub: String
        let when: Date
        let restore: () -> Void
        let purge: () -> Void
    }

    private var rows: [Row] {
        var out: [Row] = []
        let engine = { MoneyEngine(context: context) }

        for s in spends {
            out.append(Row(id: s.id, icon: "creditcard", tint: Palette.warning,
                           title: s.vendorName ?? s.spendDescription ?? "Spend",
                           sub: CurrencyFormat.string(s.amountBase, base, compact: true), when: s.deletedAt ?? .now,
                           restore: { try? engine().restoreSpend(s.id) },
                           purge: { SoftDelete.auditPurge(context, type: "Spend", id: s.id, withLedger: true); SoftDelete.purgeChildren(type: "Spend", id: s.id, context: context); SoftDelete.purgeLedger(relatedId: s.id, context: context); context.delete(s); try? context.save() }))
        }
        for p in payments {
            out.append(Row(id: p.id, icon: "arrow.down.left.circle", tint: Palette.positive,
                           title: "Payment", sub: CurrencyFormat.string(p.netAmountBase ?? 0, base, compact: true), when: p.deletedAt ?? .now,
                           restore: { try? engine().restorePayment(p.id) },
                           purge: { purgePayment(p) }))
        }
        for w in withdrawals {
            out.append(Row(id: w.id, icon: "arrow.up.right.circle", tint: Palette.teal,
                           title: w.toMethodId == nil ? "Withdrawal" : "Transfer",
                           sub: CurrencyFormat.string(w.grossBase, base, compact: true), when: w.deletedAt ?? .now,
                           restore: { try? engine().restoreWithdrawal(w.id) },
                           purge: { SoftDelete.auditPurge(context, type: "Withdrawal", id: w.id, withLedger: true); SoftDelete.purgeLedger(relatedId: w.id, context: context); context.delete(w); try? context.save() }))
        }
        for l in loans {
            out.append(Row(id: l.id, icon: "arrow.left.arrow.right", tint: Palette.teal,
                           title: l.counterparty, sub: CurrencyFormat.string(l.outstandingBase, base, compact: true), when: l.deletedAt ?? .now,
                           restore: { LoanEngine.onRestore(context, loan: l) },
                           purge: { SoftDelete.auditPurge(context, type: "Loan", id: l.id, withLedger: true); SoftDelete.purgeLedger(relatedId: l.id, context: context); context.delete(l); try? context.save() }))
        }
        out += simple(projects,   icon: "folder",            tint: Palette.teal,    title: { $0.title })
        out += simple(recurrings, icon: "calendar.badge.clock", tint: Palette.warning, title: { $0.label })
        out += simple(clients,    icon: "person.crop.square", tint: Palette.teal,    title: { $0.name })
        out += simple(vendors,    icon: "bag",                tint: Palette.warning, title: { $0.name })
        out += simple(entities,   icon: "person.2",           tint: Palette.teal,    title: { $0.name })
        out += simple(letters,    icon: "envelope",           tint: Palette.teal,    title: { $0.title.isEmpty ? "Letter" : $0.title })
        out += simple(bodyLogs,   icon: "heart",              tint: Palette.negative, title: { "Body log · \($0.day.formatted(.dateTime.month().day()))" })
        out += simple(wallets,    icon: "wallet.bifold",      tint: Palette.teal,    title: { $0.name })

        return out.sorted { $0.when > $1.when }
    }

    /// Build rows for simple (no-ledger) soft-deletables.
    private func simple<T: SoftDeletable & PersistentModel>(_ items: [T], icon: String, tint: Color, title: @escaping (T) -> String) -> [Row] {
        items.map { item in
            Row(id: item.id, icon: icon, tint: tint, title: title(item), sub: relative(item.deletedAt), when: item.deletedAt ?? .now,
                restore: { SoftDelete.restore(item, ownsLedger: false, context: context); try? context.save() },
                purge: { SoftDelete.auditPurge(context, type: String(describing: T.self), id: item.id); SoftDelete.purgeChildren(type: String(describing: T.self), id: item.id, context: context); context.delete(item); try? context.save() })
        }
    }

    private func purgePayment(_ p: Payment) {
        let pid = p.id
        SoftDelete.auditPurge(context, type: "Payment", id: pid, withLedger: true)
        for s in (try? context.fetch(FetchDescriptor<PaymentStep>(predicate: #Predicate { $0.paymentId == pid }))) ?? [] { context.delete(s) }
        for a in (try? context.fetch(FetchDescriptor<PaymentAllocation>(predicate: #Predicate { $0.paymentId == pid }))) ?? [] { context.delete(a) }
        SoftDelete.purgeLedger(relatedId: pid, context: context)
        context.delete(p)
        try? context.save()
    }

    private func relative(_ d: Date?) -> String {
        guard let d else { return "" }
        return d.formatted(.relative(presentation: .named))
    }

    var body: some View {
        let items = rows
        return ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text("Recently deleted")
                    .font(Typo.title(26)).foregroundStyle(Palette.textPrimary)
                Text("Items stay here for 30 days, then delete permanently. Restore brings them — and their effect on your balances — back exactly.")
                    .font(.system(size: 12.5)).foregroundStyle(Palette.textTertiary)

                if items.isEmpty {
                    EmptyStateCard(icon: "trash", title: "Trash is empty",
                                   message: "Anything you delete lands here first, fully restorable for 30 days.")
                        .padding(.top, 40)
                } else {
                    if items.count > 1 {
                        Button(role: .destructive) { for r in items { r.purge() } } label: {
                            Label("Empty Trash (\(items.count))", systemImage: "trash")
                        }
                        .buttonStyle(.glass).tint(Palette.negative).controlSize(.small)
                    }
                    LazyVStack(spacing: 8) {
                        ForEach(items) { r in TrashRow(row: r) }
                    }
                }

                let history = Audit.recent(context, limit: 30)
                if !history.isEmpty {
                    Text("Recent activity")
                        .font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.textPrimary)
                        .padding(.top, 8)
                    VStack(alignment: .leading, spacing: 5) {
                        ForEach(history) { h in
                            HStack(spacing: 8) {
                                Image(systemName: icon(for: h.action)).font(.system(size: 10))
                                    .foregroundStyle(Palette.textTertiary).frame(width: 14)
                                Text(h.summary).font(.system(size: 11.5)).foregroundStyle(Palette.textSecondary)
                                Spacer()
                                Text(h.at.formatted(.relative(presentation: .named)))
                                    .font(.system(size: 10.5)).foregroundStyle(Palette.textTertiary)
                            }
                        }
                    }
                }
            }
            .padding(24)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(width: 620, height: 640)
        .flagshipSheet()
        .sheetCloseChrome(dismiss)
    }

    private func icon(for action: String) -> String {
        switch action {
        case "restored": return "arrow.uturn.backward"
        case "purged": return "trash.slash"
        case "edited": return "pencil"
        default: return "trash"
        }
    }
}

private struct TrashRow: View {
    let row: TrashView.Row
    @State private var confirmPurge = false

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: row.icon).font(.system(size: 14, weight: .semibold))
                .foregroundStyle(row.tint).frame(width: 30, height: 30)
                .background(row.tint.opacity(0.14), in: RoundedRectangle(cornerRadius: Radii.row, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text(row.title).font(.system(size: 13.5, weight: .medium)).foregroundStyle(Palette.textPrimary).lineLimit(1)
                Text(row.sub).font(.system(size: 11.5)).foregroundStyle(Palette.textTertiary).lineLimit(1)
            }
            Spacer()
            Text(row.when.formatted(.relative(presentation: .named)))
                .font(.system(size: 11)).foregroundStyle(Palette.textTertiary)
            Button("Restore") { row.restore() }.buttonStyle(.glass).controlSize(.small).tint(Palette.teal)
            Button { confirmPurge = true } label: { Image(systemName: "trash") }
                .buttonStyle(.glass).controlSize(.small).tint(Palette.negative)
                .confirmationDialog("Delete permanently? This can't be undone.", isPresented: $confirmPurge) {
                    Button("Delete forever", role: .destructive) { row.purge() }
                    Button("Cancel", role: .cancel) {}
                }
        }
        .padding(.horizontal, 12).padding(.vertical, 9)
        .insetRow(cornerRadius: Radii.field, hoverable: false)
    }
}

/// Hard-purges anything sitting in Trash longer than 30 days. Run at launch.
enum TrashSweep {
    static let retentionDays = 30

    @MainActor
    static func run(_ context: ModelContext) {
        guard let cutoff = PHT.calendar.date(byAdding: .day, value: -retentionDays, to: .now) else { return }

        // Money entities: clear their archived ledger (+ payment children) before hard-delete.
        for s in fetch(Spend.self, context, cutoff) { SoftDelete.auditPurge(context, type: "Spend", id: s.id, withLedger: true); SoftDelete.purgeChildren(type: "Spend", id: s.id, context: context); SoftDelete.purgeLedger(relatedId: s.id, context: context); context.delete(s) }
        for w in fetch(Withdrawal.self, context, cutoff) { SoftDelete.auditPurge(context, type: "Withdrawal", id: w.id, withLedger: true); SoftDelete.purgeLedger(relatedId: w.id, context: context); context.delete(w) }
        for l in fetch(Loan.self, context, cutoff) { SoftDelete.auditPurge(context, type: "Loan", id: l.id, withLedger: true); SoftDelete.purgeLedger(relatedId: l.id, context: context); context.delete(l) }
        for p in fetch(Payment.self, context, cutoff) {
            let pid = p.id
            SoftDelete.auditPurge(context, type: "Payment", id: pid, withLedger: true)
            for st in (try? context.fetch(FetchDescriptor<PaymentStep>(predicate: #Predicate { $0.paymentId == pid }))) ?? [] { context.delete(st) }
            for a in (try? context.fetch(FetchDescriptor<PaymentAllocation>(predicate: #Predicate { $0.paymentId == pid }))) ?? [] { context.delete(a) }
            SoftDelete.purgeLedger(relatedId: pid, context: context); context.delete(p)
        }
        try? context.save()   // commit money purges (+ their audits) before moving on
        // Simple entities — each type commits its own purges+audits, so a later failure can't
        // discard ones already recorded.
        purgeSimple(Project.self, context, cutoff);   purgeSimple(Recurring.self, context, cutoff)
        purgeSimple(Client.self, context, cutoff);    purgeSimple(Vendor.self, context, cutoff)
        purgeSimple(Entity.self, context, cutoff);    purgeSimple(Letter.self, context, cutoff)
        purgeSimple(BodyLog.self, context, cutoff);   purgeSimple(Wallet.self, context, cutoff)
    }

    private static func purgeSimple<T: PersistentModel & SoftDeletable>(_ type: T.Type, _ context: ModelContext, _ cutoff: Date) {
        let items = fetch(type, context, cutoff)
        guard !items.isEmpty else { return }
        for x in items {
            SoftDelete.auditPurge(context, type: String(describing: T.self), id: x.id)
            SoftDelete.purgeChildren(type: String(describing: T.self), id: x.id, context: context)
            context.delete(x)
        }
        try? context.save()   // audit + delete commit together (atomic) per type
    }

    /// Only items WITH a tombstone older than the cutoff — live rows (deletedAt == nil) are
    /// explicitly never matched.
    private static func fetch<T: PersistentModel & SoftDeletable>(_ type: T.Type, _ context: ModelContext, _ cutoff: Date) -> [T] {
        ((try? context.fetch(FetchDescriptor<T>())) ?? []).filter { if let d = $0.deletedAt { return d < cutoff } else { return false } }
    }
}

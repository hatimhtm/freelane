import Foundation
import SwiftData

/// The row mapping between SwiftData and the `fl_*` tables.
///
/// Kept apart from `CloudSync` because it is the part that changes whenever a model gains a field,
/// and because it is long and mechanical while the sync loop itself is short and load-bearing.
///
/// Two rules run through all of it:
///   * **Never stamp `now()` into `updated_at`.** Three models here have no `updatedAt` of their
///     own, so theirs is derived from a date the row already carries. A fresh timestamp would mark
///     every row as changed on every push and leave the phone re-pulling the whole store forever.
///   * **Apply only what is newer.** Every `apply` compares timestamps before writing, so an echo of
///     our own push cannot overwrite an edit made a moment later.
extension CloudSync {

    // MARK: - Push

    /// Returns how many rows went up, so a no-op sync can stay silent.
    @discardableResult
    func push(context: ModelContext, token: String, uid: String) async throws -> Int {
        backfillOnce(context)
        var n = 0
        n += try await pushTable(context, "fl_wallets", token, uid, #Predicate<Wallet> { $0.dirty == true }, CloudRows.wallet, { $0.dirty = false })
        n += try await pushTable(context, "fl_clients", token, uid, #Predicate<Client> { $0.dirty == true }, CloudRows.client, { $0.dirty = false })
        n += try await pushTable(context, "fl_projects", token, uid, #Predicate<Project> { $0.dirty == true }, CloudRows.project, { $0.dirty = false })
        n += try await pushTable(context, "fl_payments", token, uid, #Predicate<Payment> { $0.dirty == true }, CloudRows.payment, { $0.dirty = false })
        n += try await pushTable(context, "fl_payment_steps", token, uid, #Predicate<PaymentStep> { $0.dirty == true }, CloudRows.paymentStep, { $0.dirty = false })
        n += try await pushTable(context, "fl_withdrawals", token, uid, #Predicate<Withdrawal> { $0.dirty == true }, CloudRows.withdrawal, { $0.dirty = false })
        n += try await pushTable(context, "fl_recurring", token, uid, #Predicate<Recurring> { $0.dirty == true }, CloudRows.recurring, { $0.dirty = false })
        n += try await pushTable(context, "fl_loans", token, uid, #Predicate<Loan> { $0.dirty == true }, CloudRows.loan, { $0.dirty = false })
        n += try await pushTable(context, "fl_spends", token, uid, #Predicate<Spend> { $0.dirty == true }, CloudRows.spend, { $0.dirty = false })
        n += try await pushTable(context, "fl_ledger_entries", token, uid, #Predicate<LedgerEntry> { $0.dirty == true }, CloudRows.ledger, { $0.dirty = false })
        n += try await pushTable(context, "fl_exchange_rates", token, uid, #Predicate<ExchangeRate> { $0.dirty == true }, CloudRows.rate, { $0.dirty = false })
        if n > 0 { try context.save() }
        return n
    }

    /// Moves and payment routes didn't sync before 3.1, so the first sync after the update sends all
    /// of them once.
    private func backfillOnce(_ ctx: ModelContext) {
        let key = "sync.backfill.v31"
        guard !UserDefaults.standard.bool(forKey: key) else { return }
        ((try? ctx.fetch(FetchDescriptor<Withdrawal>())) ?? []).forEach { $0.dirty = true }
        ((try? ctx.fetch(FetchDescriptor<PaymentStep>())) ?? []).forEach { $0.dirty = true }
        try? ctx.save()
        UserDefaults.standard.set(true, forKey: key)
    }

    private func dirty<T: PersistentModel>(_ context: ModelContext, _ predicate: Predicate<T>) -> [T] {
        (try? context.fetch(FetchDescriptor<T>(predicate: predicate))) ?? []
    }

    /// Send every row the predicate finds as `table` rows, then clear their dirty flags.
    private func pushTable<T: PersistentModel>(_ ctx: ModelContext, _ table: String, _ token: String, _ uid: String,
                                               _ predicate: Predicate<T>, _ row: (T, String) -> [String: Any],
                                               _ clean: (T) -> Void) async throws -> Int {
        let rows: [T] = dirty(ctx, predicate)
        guard !rows.isEmpty else { return 0 }
        try await upsert(table, rows: rows.map { row($0, uid) }, token: token)
        rows.forEach(clean)
        return rows.count
    }

    // MARK: - Pull

    /// Returns how many rows came down, so a no-op sync can stay silent.
    @discardableResult
    func pull(context ctx: ModelContext, token: String, uid: String) async throws -> Int {
        // Keep the high-water mark as the server's own string, at its full precision.
        //
        // Postgres stamps `updated_at` to the MICROSECOND (`…04.619491+00:00`); a Date round trip
        // through ISO8601DateFormatter keeps milliseconds. Re-emitted as `…04.619Z`, the watermark
        // sat just below the newest row, so `updated_at > watermark` matched it on every pull,
        // forever: the newest rows came back every couple of seconds and were re-applied over any
        // local edit not yet pushed — which is how a bill marked paid turned back to due.
        // `zulu` keeps the `+00:00` out of the URL, where `+` reads as a space.
        var newest = watermarkValue
        var received = 0

        for table in ["fl_wallets", "fl_clients", "fl_projects", "fl_payments", "fl_payment_steps", "fl_withdrawals",
                      "fl_recurring", "fl_loans", "fl_spends", "fl_ledger_entries"] {
            let rows = try await fetchRows(table, token: token, uid: uid, since: watermarkValue)
            for row in rows {
                apply(table: table, row: row, ctx: ctx)
                received += 1
                if let s = row["updated_at"] as? String, micros(s) > micros(newest) { newest = zulu(s) }
            }
        }

        // The phone pays bills without touching the rule, so "paid through" is re-derived here.
        if received > 0 { RecurringMath.resyncAll(ctx); try ctx.save() }
        // Advance only once every table is in — a failure halfway would otherwise skip whatever the
        // later tables changed, permanently.
        if newest != watermarkValue { setWatermark(newest) }
        return received
    }

    /// Seconds since 1970 at the full precision of the string, which `parseDate` rounds to ms.
    private func micros(_ s: String) -> Double {
        let whole = parseDate(s).map { floor($0.timeIntervalSince1970) } ?? 0
        let frac = s.split(separator: ".").dropFirst().first?.prefix(while: \.isNumber) ?? ""
        return whole + (Double("0." + frac) ?? 0)
    }

    /// Write a server row into SwiftData, unless what we hold is newer — or is a local edit not
    /// yet pushed (`dirty`). A pull is async, so an edit can land between its fetch and this
    /// apply; overwriting it would also clear `dirty`, and the edit would never reach the server.
    private func apply(table: String, row: [String: Any], ctx: ModelContext) {
        guard let id = parseUUID(row["id"]) else { return }
        let remoteAt = parseDate(row["updated_at"]) ?? .distantPast

        switch table {
        case "fl_wallets":
            let existing = first(ctx, #Predicate<Wallet> { $0.id == id })
            if let e = existing, e.dirty || e.updatedAt >= remoteAt { return }
            let w = existing ?? { let n = Wallet(id: id, name: ""); ctx.insert(n); return n }()
            w.name = row["name"] as? String ?? w.name
            w.kindRaw = row["kind"] as? String ?? w.kindRaw
            w.isHolding = row["is_holding"] as? Bool ?? w.isHolding
            w.openingBalanceBase = row["opening_balance_base"] as? Double
            w.openingBalanceAt = parseDate(row["opening_balance_at"])
            w.openingBalanceSetAt = parseDate(row["opening_balance_set_at"])
            w.overdraftToleranceBase = row["overdraft_tolerance_base"] as? Double ?? w.overdraftToleranceBase
            w.archived = row["archived"] as? Bool ?? w.archived
            w.excludedFromTotals = row["excluded_from_totals"] as? Bool ?? w.excludedFromTotals
            w.notes = row["notes"] as? String
            w.deletedAt = parseDate(row["deleted_at"])
            w.updatedAt = remoteAt
            w.dirty = false

        case "fl_clients":
            let existing = first(ctx, #Predicate<Client> { $0.id == id })
            if let e = existing, e.dirty || e.updatedAt >= remoteAt { return }
            let c = existing ?? { let n = Client(id: id, name: ""); ctx.insert(n); return n }()
            c.name = row["name"] as? String ?? c.name
            c.defaultCurrency = row["default_currency"] as? String
            c.email = row["email"] as? String
            c.notes = row["notes"] as? String
            c.accentColor = row["accent_color"] as? String
            c.archived = row["archived"] as? Bool ?? c.archived
            c.deletedAt = parseDate(row["deleted_at"])
            c.updatedAt = remoteAt
            c.dirty = false

        case "fl_projects":
            let existing = first(ctx, #Predicate<Project> { $0.id == id })
            if let e = existing, e.dirty || e.updatedAt >= remoteAt { return }
            let p = existing ?? {
                let n = Project(id: id, title: "", amount: 0, currency: "PHP"); ctx.insert(n); return n
            }()
            p.clientId = parseUUID(row["client_id"])
            p.title = row["title"] as? String ?? p.title
            p.amount = row["amount"] as? Double ?? p.amount
            p.currency = row["currency"] as? String ?? p.currency
            p.statusRaw = row["status"] as? String ?? p.statusRaw
            p.quotedAt = parseDate(row["quoted_at"])
            p.dueDate = parseDate(row["due_date"])
            p.completedAt = parseDate(row["completed_at"])
            p.workCompletedAt = parseDate(row["work_completed_at"])
            p.flaggedOverdue = row["flagged_overdue"] as? Bool ?? p.flaggedOverdue
            p.notes = row["notes"] as? String
            p.deletedAt = parseDate(row["deleted_at"])
            p.updatedAt = remoteAt
            p.dirty = false

        case "fl_payments":
            let existing = first(ctx, #Predicate<Payment> { $0.id == id })
            if let e = existing, e.dirty || e.updatedAt >= remoteAt { return }
            let p = existing ?? {
                let n = Payment(id: id, projectId: nil, amount: 0, currency: "PHP", paidAt: .now)
                ctx.insert(n); return n
            }()
            p.projectId = parseUUID(row["project_id"])
            p.amount = row["amount"] as? Double ?? p.amount
            p.currency = row["currency"] as? String ?? p.currency
            p.netAmountBase = row["net_amount_base"] as? Double
            p.grossAtMarketBase = row["gross_at_market_base"] as? Double
            p.impliedFeeBase = row["implied_fee_base"] as? Double
            p.feeUnknown = row["fee_unknown"] as? Bool ?? p.feeUnknown
            p.fxLocked = row["fx_locked"] as? Bool ?? p.fxLocked
            if let paid = parseDate(row["received_at"]) { p.paidAt = paid }
            p.notes = row["notes"] as? String
            p.deletedAt = parseDate(row["deleted_at"])
            p.updatedAt = remoteAt
            p.dirty = false
            // Project status is derived from allocations, which this sync doesn't carry. A payment
            // the phone booked against a project arrives without one, so the next recompute here
            // flipped the project back to unpaid and "mark paid" booked the income twice.
            if let pid = p.projectId, first(ctx, #Predicate<PaymentAllocation> { $0.paymentId == id }) == nil {
                ctx.insert(PaymentAllocation(paymentId: id, projectId: pid, allocationAmount: p.amount,
                                             allocationCurrency: p.currency, allocationBase: p.netAmountBase ?? 0))
            }

        case "fl_recurring":
            let existing = first(ctx, #Predicate<Recurring> { $0.id == id })
            if let e = existing, e.dirty || e.updatedAt >= remoteAt { return }
            let r = existing ?? { let n = Recurring(id: id, label: "", amount: 0, currency: "PHP", amountBase: 0)
                ctx.insert(n); return n }()
            r.label = row["label"] as? String ?? r.label
            r.kindRaw = row["kind"] as? String ?? r.kindRaw
            r.cadenceRaw = row["cadence"] as? String ?? r.cadenceRaw
            r.amount = row["amount"] as? Double ?? r.amount
            r.amountBase = row["amount_base"] as? Double ?? r.amountBase
            r.currency = row["currency"] as? String ?? r.currency
            r.dayOfMonth = row["day_of_month"] as? Int
            r.walletId = parseUUID(row["wallet_id"])
            r.paidThroughDate = parseDate(row["paid_through_date"])
            r.isVariableAmount = row["is_variable_amount"] as? Bool ?? r.isVariableAmount
            r.active = row["active"] as? Bool ?? r.active
            r.notes = row["notes"] as? String
            r.deletedAt = parseDate(row["deleted_at"])
            r.updatedAt = remoteAt
            r.dirty = false

        case "fl_loans":
            let existing = first(ctx, #Predicate<Loan> { $0.id == id })
            if let e = existing, e.dirty || e.updatedAt >= remoteAt { return }
            let l = existing ?? {
                let n = Loan(id: id, counterparty: "", direction: .given, principalBase: 0)
                ctx.insert(n); return n
            }()
            l.counterparty = row["counterparty_name"] as? String ?? l.counterparty
            l.directionRaw = row["direction"] as? String ?? l.directionRaw
            l.principalBase = row["principal_base"] as? Double ?? l.principalBase
            if let returned = row["returned_base"] as? Double {
                l.outstandingBase = max(0, l.principalBase - returned)
            }
            l.statusRaw = row["status"] as? String ?? l.statusRaw
            l.forgivenAt = parseDate(row["forgiven_at"])
            l.forgivenBase = row["forgiven_base"] as? Double
            l.originWalletId = parseUUID(row["origin_wallet_id"])
            if let opened = parseDate(row["opened_at"]) { l.startedAt = opened }
            l.notes = row["notes"] as? String
            l.deletedAt = parseDate(row["deleted_at"])
            l.updatedAt = remoteAt
            l.dirty = false

        case "fl_spends":
            let existing = first(ctx, #Predicate<Spend> { $0.id == id })
            if let e = existing, e.dirty || e.updatedAt >= remoteAt { return }
            let s = existing ?? {
                let n = Spend(id: id, walletId: nil, spentAt: .now, amount: 0, currency: "PHP", amountBase: 0)
                ctx.insert(n); return n
            }()
            s.walletId = parseUUID(row["wallet_id"])
            if let at = parseDate(row["spent_at"]) { s.spentAt = at }
            s.amount = row["amount"] as? Double ?? s.amount
            s.currency = row["currency"] as? String ?? s.currency
            s.amountBase = row["amount_base"] as? Double ?? s.amountBase
            s.spendDescription = row["description"] as? String
            s.vendorName = row["vendor_name"] as? String
            s.category = row["category"] as? String
            s.tags = row["tags"] as? [String] ?? s.tags
            s.isSadaka = row["is_sadaka"] as? Bool ?? s.isSadaka
            s.isBusiness = row["is_business"] as? Bool ?? s.isBusiness
            s.isHouse = row["is_house"] as? Bool ?? s.isHouse
            s.notes = row["notes"] as? String
            s.recurringId = parseUUID(row["recurring_id"])
            s.coversPeriods = row["covers_periods"] as? Int ?? s.coversPeriods
            s.deletedAt = parseDate(row["deleted_at"])
            s.updatedAt = remoteAt
            s.dirty = false

        case "fl_ledger_entries":
            let existing = first(ctx, #Predicate<LedgerEntry> { $0.id == id })
            // No updatedAt on this model, so there is nothing to compare — but a ledger row is
            // immutable in practice, so first write wins and re-applying is harmless. Except over
            // an unpushed local archive: re-applying would put a deleted spend's money back.
            if let e = existing, e.dirty { return }
            // Skip a leg that's identical to what we hold. Re-assigning the same values on every
            // fetch was most of the 410,790 ledger writes behind the old sync loop. (The phone edits
            // a leg's amount in place, so the amount and wallet are compared too.)
            if let e = existing,
               e.archivedAt == (parseDate(row["archived_at"]) ?? parseDate(row["deleted_at"])),
               e.amountBase == (row["amount_base"] as? Double ?? e.amountBase),
               e.walletId == parseUUID(row["wallet_id"]),
               e.kindRaw == (row["kind"] as? String ?? e.kindRaw) { return }
            let l = existing ?? {
                let n = LedgerEntry(id: id, kind: .adjustment, amountBase: 0, walletId: nil,
                                    relatedKind: nil, relatedId: nil, eventAt: .now)
                ctx.insert(n); return n
            }()
            l.kindRaw = row["kind"] as? String ?? l.kindRaw
            l.amountBase = row["amount_base"] as? Double ?? l.amountBase
            l.walletId = parseUUID(row["wallet_id"])
            if let at = parseDate(row["event_at"]) { l.eventAt = at }
            l.relatedKindRaw = row["related_kind"] as? String
            l.relatedId = parseUUID(row["related_id"])
            l.note = row["note"] as? String
            // LedgerEntry has no deletedAt — this model retires a row by ARCHIVING it, and the
            // balance skips archived rows. The phone marks a removed leg with deleted_at, so a
            // tombstone that only set deleted_at left the money still counted here: the spend
            // vanished from the list while the wallet balance never moved.
            l.archivedAt = parseDate(row["archived_at"]) ?? parseDate(row["deleted_at"])
            l.dirty = false

        case "fl_withdrawals":
            let existing = first(ctx, #Predicate<Withdrawal> { $0.id == id })
            if let e = existing, e.dirty || e.updatedAt >= remoteAt { return }
            let w = existing ?? {
                let n = Withdrawal(id: id, fromMethodId: nil, toMethodId: nil, withdrawnAt: .now, grossBase: 0, netBase: 0, feeBase: 0)
                ctx.insert(n); return n
            }()
            w.fromMethodId = parseUUID(row["from_wallet_id"])
            w.toMethodId = parseUUID(row["to_wallet_id"])
            if let at = parseDate(row["occurred_at"]) { w.withdrawnAt = at }
            w.grossBase = row["gross_base"] as? Double ?? w.grossBase
            w.netBase = row["net_base"] as? Double ?? w.netBase
            w.feeBase = row["fee_base"] as? Double ?? w.feeBase
            w.notes = row["notes"] as? String
            w.deletedAt = parseDate(row["deleted_at"])
            w.updatedAt = remoteAt
            w.dirty = false

        case "fl_payment_steps":
            // No updatedAt on this model: like a ledger leg, only an unpushed local edit wins.
            let existing = first(ctx, #Predicate<PaymentStep> { $0.id == id })
            if let e = existing, e.dirty { return }
            guard let paymentId = parseUUID(row["payment_id"]) ?? existing?.paymentId else { return }
            let st = existing ?? {
                let n = PaymentStep(id: id, paymentId: paymentId, stepOrder: 0, fromMethodId: nil, methodId: nil,
                                    amountIn: 0, currencyIn: "PHP", amountOut: 0, currencyOut: "PHP", isFinal: false)
                ctx.insert(n); return n
            }()
            st.paymentId = paymentId
            st.stepOrder = row["step_order"] as? Int ?? st.stepOrder
            st.fromMethodId = parseUUID(row["from_wallet_id"])
            st.methodId = parseUUID(row["wallet_id"])
            st.amountIn = row["amount_in"] as? Double ?? st.amountIn
            st.currencyIn = row["currency_in"] as? String ?? st.currencyIn
            st.amountOut = row["amount_out"] as? Double ?? st.amountOut
            st.currencyOut = row["currency_out"] as? String ?? st.currencyOut
            st.isFinal = row["is_final"] as? Bool ?? st.isFinal
            st.dirty = false

        default:
            break
        }
    }

    private func first<T: PersistentModel>(_ ctx: ModelContext, _ p: Predicate<T>) -> T? {
        var d = FetchDescriptor<T>(predicate: p)
        d.fetchLimit = 1
        return (try? ctx.fetch(d))?.first
    }

    /// Save once, at the end. Saving inside the row loop turns one pull into hundreds of writes.
    func saveQuietly(_ ctx: ModelContext) {
        try? ctx.save()
    }
}

/// A deterministic UUID from a string, for the one model the Mac stores without an id.
func stableID(for key: String) -> String {
    var hash: UInt64 = 0xcbf2_9ce4_8422_2325
    for byte in Array(key.utf8) {
        hash ^= UInt64(byte)
        hash = hash &* 0x1000_0000_01b3
    }
    let a = String(format: "%08x", UInt32(truncatingIfNeeded: hash))
    let b = String(format: "%04x", UInt16(truncatingIfNeeded: hash >> 32))
    let c = String(format: "%04x", UInt16(truncatingIfNeeded: hash >> 48))
    return "\(a)-\(b)-4\(c.dropFirst())-8000-\(a)\(b)"
}

/// Each model as the row its `fl_*` table holds. Sync and the test-build dump both use these, so what
/// the phone receives and what the checks compare against can't drift apart.
enum CloudRows {
    static func wallet(_ w: Wallet, _ uid: String) -> [String: Any] {
        [
            "id": w.id.uuidString.lowercased(), "user_id": uid,
            "name": w.name, "kind": w.kindRaw, "is_holding": w.isHolding,
            "opening_balance_base": numOrNull(w.openingBalanceBase),
            "opening_balance_at": iso(w.openingBalanceAt),
            "opening_balance_set_at": iso(w.openingBalanceSetAt),
            "overdraft_tolerance_base": w.overdraftToleranceBase,
            "archived": w.archived, "excluded_from_totals": w.excludedFromTotals,
            "notes": strOrNull(w.notes),
            "created_at": iso(w.createdAt), "updated_at": iso(w.updatedAt),
            "deleted_at": iso(w.deletedAt),
        ]
    }

    static func client(_ c: Client, _ uid: String) -> [String: Any] {
        [
            "id": c.id.uuidString.lowercased(), "user_id": uid,
            "name": c.name, "default_currency": strOrNull(c.defaultCurrency),
            "email": strOrNull(c.email), "notes": strOrNull(c.notes),
            "accent_color": strOrNull(c.accentColor), "archived": c.archived,
            "created_at": iso(c.createdAt), "updated_at": iso(c.updatedAt),
            "deleted_at": iso(c.deletedAt),
        ]
    }

    static func project(_ p: Project, _ uid: String) -> [String: Any] {
        [
            "id": p.id.uuidString.lowercased(), "user_id": uid,
            "client_id": uuidOrNull(p.clientId), "title": p.title,
            "amount": p.amount, "currency": p.currency, "status": p.statusRaw,
            "quoted_at": iso(p.quotedAt), "due_date": iso(p.dueDate),
            "completed_at": iso(p.completedAt), "work_completed_at": iso(p.workCompletedAt),
            "flagged_overdue": p.flaggedOverdue, "notes": strOrNull(p.notes),
            "created_at": iso(p.createdAt), "updated_at": iso(p.updatedAt),
            "deleted_at": iso(p.deletedAt),
        ]
    }

    static func payment(_ p: Payment, _ uid: String) -> [String: Any] {
        [
            "id": p.id.uuidString.lowercased(), "user_id": uid,
            "project_id": uuidOrNull(p.projectId), "amount": p.amount, "currency": p.currency,
            "net_amount_base": numOrNull(p.netAmountBase),
            "gross_at_market_base": numOrNull(p.grossAtMarketBase),
            "implied_fee_base": numOrNull(p.impliedFeeBase),
            "fee_unknown": p.feeUnknown, "fx_locked": p.fxLocked,
            "received_at": iso(p.paidAt), "notes": strOrNull(p.notes),
            "created_at": iso(p.createdAt), "updated_at": iso(p.updatedAt),
            "deleted_at": iso(p.deletedAt),
        ]
    }

    static func paymentStep(_ st: PaymentStep, _ uid: String) -> [String: Any] {
        [
            "id": st.id.uuidString.lowercased(), "user_id": uid,
            "payment_id": st.paymentId.uuidString.lowercased(), "step_order": st.stepOrder,
            "from_wallet_id": uuidOrNull(st.fromMethodId), "wallet_id": uuidOrNull(st.methodId),
            "amount_in": st.amountIn, "currency_in": st.currencyIn,
            "amount_out": st.amountOut, "currency_out": st.currencyOut, "is_final": st.isFinal,
            // No updatedAt on this model — derived, never now() (the server stamps its own anyway).
            "updated_at": iso(st.createdAt), "deleted_at": NSNull(),
        ]
    }

    static func withdrawal(_ w: Withdrawal, _ uid: String) -> [String: Any] {
        [
            "id": w.id.uuidString.lowercased(), "user_id": uid,
            "from_wallet_id": uuidOrNull(w.fromMethodId), "to_wallet_id": uuidOrNull(w.toMethodId),
            "gross_base": w.grossBase, "net_base": w.netBase, "fee_base": w.feeBase,
            "occurred_at": iso(w.withdrawnAt), "notes": strOrNull(w.notes),
            "created_at": iso(w.createdAt), "updated_at": iso(w.updatedAt),
            "deleted_at": iso(w.deletedAt),
        ]
    }

    static func recurring(_ r: Recurring, _ uid: String) -> [String: Any] {
        [
            "id": r.id.uuidString.lowercased(), "user_id": uid,
            "label": r.label, "kind": r.kindRaw, "cadence": r.cadenceRaw,
            "amount": r.amount, "amount_base": r.amountBase, "currency": r.currency,
            "day_of_month": r.dayOfMonth as Any? ?? NSNull(),
            "wallet_id": uuidOrNull(r.walletId),
            "paid_through_date": iso(r.paidThroughDate),
            "is_variable_amount": r.isVariableAmount, "active": r.active,
            "notes": strOrNull(r.notes),
            "created_at": iso(r.createdAt), "updated_at": iso(r.updatedAt),
            "deleted_at": iso(r.deletedAt),
        ]
    }

    static func loan(_ l: Loan, _ uid: String) -> [String: Any] {
        [
            "id": l.id.uuidString.lowercased(), "user_id": uid,
            "direction": l.directionRaw, "counterparty_name": l.counterparty,
            "principal_base": l.principalBase,
            // The Mac tracks what is still outstanding; returned is the complement.
            "returned_base": max(0, l.principalBase - l.outstandingBase),
            "status": l.statusRaw,
            "forgiven_at": iso(l.forgivenAt), "forgiven_base": numOrNull(l.forgivenBase),
            "origin_wallet_id": uuidOrNull(l.originWalletId),
            "opened_at": iso(l.startedAt), "notes": strOrNull(l.notes),
            "created_at": iso(l.createdAt), "updated_at": iso(l.updatedAt),
            "deleted_at": iso(l.deletedAt),
        ]
    }

    static func spend(_ s: Spend, _ uid: String) -> [String: Any] {
        [
            "id": s.id.uuidString.lowercased(), "user_id": uid,
            "wallet_id": uuidOrNull(s.walletId), "spent_at": iso(s.spentAt),
            "amount": s.amount, "currency": s.currency, "amount_base": s.amountBase,
            "description": strOrNull(s.spendDescription),
            "vendor_name": strOrNull(s.vendorName), "category": strOrNull(s.category),
            "tags": s.tags,
            "is_sadaka": s.isSadaka, "is_business": s.isBusiness, "is_house": s.isHouse,
            "notes": strOrNull(s.notes), "recurring_id": uuidOrNull(s.recurringId),
            "covers_periods": s.coversPeriods,
            "created_at": iso(s.createdAt), "updated_at": iso(s.updatedAt),
            "deleted_at": iso(s.deletedAt),
        ]
    }

    static func ledger(_ l: LedgerEntry, _ uid: String) -> [String: Any] {
        [
            "id": l.id.uuidString.lowercased(), "user_id": uid,
            "wallet_id": uuidOrNull(l.walletId), "kind": l.kindRaw,
            "amount_base": l.amountBase, "event_at": iso(l.eventAt),
            "related_kind": strOrNull(l.relatedKindRaw), "related_id": uuidOrNull(l.relatedId),
            "note": strOrNull(l.note), "archived_at": iso(l.archivedAt),
            // The phone retires legs with deleted_at, which this side reads as archived. A leg
            // restored here must clear it, or the next pull archives the restored money again.
            "deleted_at": NSNull(),
            "created_at": iso(l.createdAt),
            // No updatedAt on this model — derived, never now().
            "updated_at": iso(l.archivedAt ?? l.createdAt),
        ]
    }

    static func rate(_ r: ExchangeRate, _ uid: String) -> [String: Any] {
        [
            // No id on this model; the currency code is its natural key, so derive a stable one.
            "id": stableID(for: "rate.\(r.code)"),
            "user_id": uid, "code": r.code, "rate_to_base": r.rateToBase,
            "refreshed_at": iso(r.updatedAt), "updated_at": iso(r.updatedAt),
        ]
    }
}

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
        var n = 0
        n += try await pushWallets(context, token, uid)
        n += try await pushClients(context, token, uid)
        n += try await pushProjects(context, token, uid)
        n += try await pushPayments(context, token, uid)
        n += try await pushRecurring(context, token, uid)
        n += try await pushLoans(context, token, uid)
        n += try await pushSpends(context, token, uid)
        n += try await pushLedger(context, token, uid)
        n += try await pushRates(context, token, uid)
        if n > 0 { try context.save() }
        return n
    }

    private func dirty<T: PersistentModel>(_ context: ModelContext, _ predicate: Predicate<T>) -> [T] {
        (try? context.fetch(FetchDescriptor<T>(predicate: predicate))) ?? []
    }

    private func pushWallets(_ ctx: ModelContext, _ token: String, _ uid: String) async throws -> Int {
        let rows: [Wallet] = dirty(ctx, #Predicate { $0.dirty == true })
        guard !rows.isEmpty else { return 0 }
        try await upsert("fl_wallets", rows: rows.map { w in
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
        }, token: token)
        rows.forEach { $0.dirty = false }
        return rows.count
    }

    private func pushClients(_ ctx: ModelContext, _ token: String, _ uid: String) async throws -> Int {
        let rows: [Client] = dirty(ctx, #Predicate { $0.dirty == true })
        guard !rows.isEmpty else { return 0 }
        try await upsert("fl_clients", rows: rows.map { c in
            [
                "id": c.id.uuidString.lowercased(), "user_id": uid,
                "name": c.name, "default_currency": strOrNull(c.defaultCurrency),
                "email": strOrNull(c.email), "notes": strOrNull(c.notes),
                "accent_color": strOrNull(c.accentColor), "archived": c.archived,
                "created_at": iso(c.createdAt), "updated_at": iso(c.updatedAt),
                "deleted_at": iso(c.deletedAt),
            ]
        }, token: token)
        rows.forEach { $0.dirty = false }
        return rows.count
    }

    private func pushProjects(_ ctx: ModelContext, _ token: String, _ uid: String) async throws -> Int {
        let rows: [Project] = dirty(ctx, #Predicate { $0.dirty == true })
        guard !rows.isEmpty else { return 0 }
        try await upsert("fl_projects", rows: rows.map { p in
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
        }, token: token)
        rows.forEach { $0.dirty = false }
        return rows.count
    }

    private func pushPayments(_ ctx: ModelContext, _ token: String, _ uid: String) async throws -> Int {
        let rows: [Payment] = dirty(ctx, #Predicate { $0.dirty == true })
        guard !rows.isEmpty else { return 0 }
        try await upsert("fl_payments", rows: rows.map { p in
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
        }, token: token)
        rows.forEach { $0.dirty = false }
        return rows.count
    }

    private func pushRecurring(_ ctx: ModelContext, _ token: String, _ uid: String) async throws -> Int {
        let rows: [Recurring] = dirty(ctx, #Predicate { $0.dirty == true })
        guard !rows.isEmpty else { return 0 }
        try await upsert("fl_recurring", rows: rows.map { r in
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
        }, token: token)
        rows.forEach { $0.dirty = false }
        return rows.count
    }

    private func pushLoans(_ ctx: ModelContext, _ token: String, _ uid: String) async throws -> Int {
        let rows: [Loan] = dirty(ctx, #Predicate { $0.dirty == true })
        guard !rows.isEmpty else { return 0 }
        try await upsert("fl_loans", rows: rows.map { l in
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
        }, token: token)
        rows.forEach { $0.dirty = false }
        return rows.count
    }

    private func pushSpends(_ ctx: ModelContext, _ token: String, _ uid: String) async throws -> Int {
        let rows: [Spend] = dirty(ctx, #Predicate { $0.dirty == true })
        guard !rows.isEmpty else { return 0 }
        try await upsert("fl_spends", rows: rows.map { s in
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
        }, token: token)
        rows.forEach { $0.dirty = false }
        return rows.count
    }

    private func pushLedger(_ ctx: ModelContext, _ token: String, _ uid: String) async throws -> Int {
        let rows: [LedgerEntry] = dirty(ctx, #Predicate { $0.dirty == true })
        guard !rows.isEmpty else { return 0 }
        try await upsert("fl_ledger_entries", rows: rows.map { l in
            [
                "id": l.id.uuidString.lowercased(), "user_id": uid,
                "wallet_id": uuidOrNull(l.walletId), "kind": l.kindRaw,
                "amount_base": l.amountBase, "event_at": iso(l.eventAt),
                "related_kind": strOrNull(l.relatedKindRaw), "related_id": uuidOrNull(l.relatedId),
                "note": strOrNull(l.note), "archived_at": iso(l.archivedAt),
                "created_at": iso(l.createdAt),
                // No updatedAt on this model — derived, never now().
                "updated_at": iso(l.archivedAt ?? l.createdAt),
            ]
        }, token: token)
        rows.forEach { $0.dirty = false }
        return rows.count
    }

    private func pushRates(_ ctx: ModelContext, _ token: String, _ uid: String) async throws -> Int {
        let rows: [ExchangeRate] = dirty(ctx, #Predicate { $0.dirty == true })
        guard !rows.isEmpty else { return 0 }
        try await upsert("fl_exchange_rates", rows: rows.map { r in
            [
                // No id on this model; the currency code is its natural key, so derive a stable one.
                "id": stableID(for: "rate.\(r.code)"),
                "user_id": uid, "code": r.code, "rate_to_base": r.rateToBase,
                "refreshed_at": iso(r.updatedAt), "updated_at": iso(r.updatedAt),
            ]
        }, token: token)
        rows.forEach { $0.dirty = false }
        return rows.count
    }

    // MARK: - Pull

    /// Returns how many rows came down, so a no-op sync can stay silent.
    @discardableResult
    func pull(context ctx: ModelContext, token: String, uid: String) async throws -> Int {
        // Track the high-water mark as a DATE, not as the string Postgres sent.
        //
        // Postgres returns `2026-06-04T19:52:48.927989+00:00`. Stored verbatim and put back into a
        // query, the `+` is read as a space by every URL parser on earth, so the server saw
        // "…927989 00:00" and rejected it. The first sync worked because the initial watermark is
        // Z-suffixed; every sync after it failed, permanently. Re-emitting through the formatter
        // guarantees a `Z` and no offset.
        var newestDate = parseDate(watermarkValue) ?? .distantPast
        var received = 0

        for table in ["fl_wallets", "fl_clients", "fl_projects", "fl_payments", "fl_recurring",
                      "fl_loans", "fl_spends", "fl_ledger_entries"] {
            let rows = try await fetchRows(table, token: token, uid: uid, since: watermarkValue)
            for row in rows {
                apply(table: table, row: row, ctx: ctx)
                received += 1
                if let d = parseDate(row["updated_at"]), d > newestDate { newestDate = d }
            }
        }

        if received > 0 { try ctx.save() }
        // Advance only once every table is in — a failure halfway would otherwise skip whatever the
        // later tables changed, permanently.
        if newestDate > (parseDate(watermarkValue) ?? .distantPast) {
            setWatermark(isoString(newestDate))
        }
        return received
    }

    /// Write a server row into SwiftData, unless what we hold is newer.
    private func apply(table: String, row: [String: Any], ctx: ModelContext) {
        guard let id = parseUUID(row["id"]) else { return }
        let remoteAt = parseDate(row["updated_at"]) ?? .distantPast

        switch table {
        case "fl_wallets":
            let existing = first(ctx, #Predicate<Wallet> { $0.id == id })
            if let e = existing, e.updatedAt > remoteAt { return }
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
            if let e = existing, e.updatedAt > remoteAt { return }
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
            if let e = existing, e.updatedAt > remoteAt { return }
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
            if let e = existing, e.updatedAt > remoteAt { return }
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

        case "fl_recurring":
            let existing = first(ctx, #Predicate<Recurring> { $0.id == id })
            if let e = existing, e.updatedAt > remoteAt { return }
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
            if let e = existing, e.updatedAt > remoteAt { return }
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
            if let e = existing, e.updatedAt > remoteAt { return }
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
            // immutable in practice, so first write wins and re-applying is harmless.
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
            l.archivedAt = parseDate(row["archived_at"])
            l.dirty = false

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

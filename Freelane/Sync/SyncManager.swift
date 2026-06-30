import Foundation
import SwiftData
import Observation

@MainActor
@Observable
final class SyncManager {
    var connected = false
    var busy = false
    var statusLine = "Local only"
    var lastError: String?
    var lastSync: Date? {
        didSet {
            if let d = lastSync { UserDefaults.standard.set(d.timeIntervalSinceReferenceDate, forKey: "lastSync") }
        }
    }

    // Config (persisted; secrets in Keychain)
    var urlString: String { didSet { UserDefaults.standard.set(urlString, forKey: "supabaseURL") } }
    var anonKey: String { didSet { UserDefaults.standard.set(anonKey, forKey: "supabaseAnonKey") } }
    var email: String { didSet { UserDefaults.standard.set(email, forKey: "supabaseEmail") } }

    private var accessToken: String?
    private var context: ModelContext?

    init() {
        urlString = UserDefaults.standard.string(forKey: "supabaseURL") ?? ""
        anonKey = UserDefaults.standard.string(forKey: "supabaseAnonKey") ?? ""
        email = UserDefaults.standard.string(forKey: "supabaseEmail") ?? "owner@freelane.local"
        let ts = UserDefaults.standard.double(forKey: "lastSync")
        if ts > 0 { lastSync = Date(timeIntervalSinceReferenceDate: ts) }
    }

    /// Silently restore a previous session from the Keychain refresh token so the
    /// app comes back "Cloud synced" across launches.
    func restoreSession() async {
        guard isConfigured, accessToken == nil, let rt = Keychain.get("refreshToken") else { return }
        do {
            var api = try makeAPI()
            let auth = try await api.refreshSession(refreshToken: rt)
            accessToken = auth.access_token
            api.accessToken = auth.access_token
            Keychain.set(auth.refresh_token, for: "refreshToken")
            connected = true
            statusLine = "Synced"
        } catch {
            // Stay local; the data is still here. User can reconnect manually.
        }
    }

    func attach(context: ModelContext) { self.context = context }

    private func logImportSummary(_ context: ModelContext) {
        func n<T: PersistentModel>(_ t: T.Type) -> Int { ((try? context.fetch(FetchDescriptor<T>())) ?? []).count }
        let wallets = (try? context.fetch(FetchDescriptor<Wallet>())) ?? []
        let ledger = (try? context.fetch(FetchDescriptor<LedgerEntry>())) ?? []
        let total = wallets.filter { $0.isHolding && !$0.archived }
            .reduce(0.0) { $0 + WalletMath.balance(of: $1, ledger: ledger) }
        print("[freelane-import] wallets=\(n(Wallet.self)) projects=\(n(Project.self)) clients=\(n(Client.self)) payments=\(n(Payment.self)) spends=\(n(Spend.self)) vendors=\(n(Vendor.self)) withdrawals=\(n(Withdrawal.self)) ledger=\(ledger.count) rates=\(n(ExchangeRate.self))")
        print("[freelane-import] wallet total (available) = \(total)")
    }

    var isConfigured: Bool {
        !urlString.isEmpty && !anonKey.isEmpty && URL(string: urlString) != nil
    }

    private func makeAPI() throws -> SupabaseAPI {
        guard let url = URL(string: urlString), !anonKey.isEmpty else { throw SupabaseError.notConfigured }
        var api = SupabaseAPI(config: SupabaseConfig(url: url, anonKey: anonKey))
        api.accessToken = accessToken
        return api
    }

    // MARK: Connect + first import

    func connectAndImport(password: String) async {
        guard let context else { return }
        busy = true; lastError = nil; statusLine = "Connecting…"
        defer { busy = false }
        do {
            var api = try makeAPI()
            let auth = try await api.signIn(email: email, password: password)
            accessToken = auth.access_token
            api.accessToken = auth.access_token
            Keychain.set(auth.refresh_token, for: "refreshToken")

            statusLine = "Importing your data…"
            try await importAll(api: api, into: context)
            connected = true
            lastSync = .now
            statusLine = "Synced"
            UserDefaults.standard.set(true, forKey: SampleData.marker)
            logImportSummary(context)
        } catch {
            lastError = error.localizedDescription
            statusLine = "Connection failed"
            connected = false
        }
    }

    func syncNow() async {
        guard let context, accessToken != nil else { return }
        busy = true; lastError = nil; statusLine = "Syncing…"
        defer { busy = false }
        do {
            let api = try makeAPI()
            try await pushDirty(api: api, from: context)
            try await importAll(api: api, into: context)
            lastSync = .now
            statusLine = "Synced"
        } catch {
            lastError = error.localizedDescription
            statusLine = "Sync failed"
        }
    }

    func disconnect() {
        accessToken = nil
        Keychain.set(nil, for: "refreshToken")
        connected = false
        statusLine = "Local only"
    }

    // MARK: Import (PostgREST → SwiftData)

    private func importAll(api: SupabaseAPI, into context: ModelContext) async throws {
        // Pull everything first (network), then mutate the store.
        async let settingsRows = api.fetchAll("settings")
        async let rateRows = api.fetchAll("exchange_rates")
        async let clientRows = api.fetchAll("clients")
        async let projectRows = api.fetchAll("projects")
        async let walletRows = api.fetchAll("payment_methods")
        async let paymentRows = api.fetchAll("payments")
        async let stepRows = api.fetchAll("payment_steps")
        async let allocRows = api.fetchAll("payment_project_allocations")
        async let withdrawalRows = api.fetchAll("withdrawals")
        // money_ledger is not granted to the authenticated role (the web app writes
        // it server-side via the service role), so we rebuild it locally from the
        // source tables instead — payments, withdrawals, and spends.
        async let spendRows = api.fetchAll("spends")
        // Tags live in join tables on the web (spend_category_links → spend_categories),
        // not a column on spends — fetch them so categorizations aren't lost on import.
        async let categoryRows = api.fetchAll("spend_categories")
        async let categoryLinkRows = api.fetchAll("spend_category_links")

        let settings = try await settingsRows
        let rates = try await rateRows
        let clients = try await clientRows
        let projects = try await projectRows
        let wallets = try await walletRows
        let payments = try await paymentRows
        let steps = try await stepRows
        let allocs = try await allocRows
        let withdrawals = try await withdrawalRows
        let spends = try await spendRows
        let categories = (try? await categoryRows) ?? []
        let categoryLinks = (try? await categoryLinkRows) ?? []
        // Map spend id → [category names].
        var categoryName: [String: String] = [:]
        for c in categories { if let id = c.str("id"), let name = c.str("name") { categoryName[id] = name } }
        var spendTags: [String: [String]] = [:]
        for l in categoryLinks {
            guard let sid = l.str("spend_id"), let cid = l.str("category_id"), let name = categoryName[cid] else { continue }
            spendTags[sid, default: []].append(name)
        }

        // SAFETY: snapshot first so it's always recoverable from Settings → Storage → Backups.
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd-HHmm"
        DataBackup.backupNow(stamp: "preimport-" + f.string(from: .now))

        // MERGE, never wipe. Server rows UPDATE the matching local row (by id); local-only
        // rows you created here (e.g. spends never pushed) are PRESERVED. This is what makes
        // a cloud restore additive instead of destructive.
        func index<T: PersistentModel>(_ type: T.Type, _ key: (T) -> String) -> [String: T] {
            Dictionary(((try? context.fetch(FetchDescriptor<T>())) ?? []).map { (key($0), $0) }, uniquingKeysWith: { a, _ in a })
        }
        let exClients = index(Client.self) { $0.id.uuidString }
        let exProjects = index(Project.self) { $0.id.uuidString }
        let exWallets = index(Wallet.self) { $0.id.uuidString }
        let exPayments = index(Payment.self) { $0.id.uuidString }
        let exSteps = index(PaymentStep.self) { $0.id.uuidString }
        let exWithdrawals = index(Withdrawal.self) { $0.id.uuidString }
        let exRates = index(ExchangeRate.self) { $0.code }
        let exAllocs = index(PaymentAllocation.self) { "\($0.paymentId.uuidString)|\($0.projectId.uuidString)" }
        let localSpends = (try? context.fetch(FetchDescriptor<Spend>())) ?? []
        let exSpends = Dictionary(localSpends.map { ($0.id.uuidString, $0) }, uniquingKeysWith: { a, _ in a })

        // Ledger is a derived cache. Drop ONLY prior import-derived rows (keep UI/loan
        // entries), then skip re-creating an import entry when an active one already exists.
        for e in (try? context.fetch(FetchDescriptor<LedgerEntry>())) ?? [] where e.note == "import" { context.delete(e) }
        let activeRelatedIds: Set<String> = Set(((try? context.fetch(FetchDescriptor<LedgerEntry>())) ?? [])
            .filter { $0.archivedAt == nil }.compactMap { $0.relatedId?.uuidString })
        func ledgerExists(_ id: UUID) -> Bool { activeRelatedIds.contains(id.uuidString) }

        if let s = settings.first {
            let local = MoneyEngine.settings(in: context)
            local.baseCurrency = s.str("base_currency") ?? local.baseCurrency
            local.issuerName = s.str("issuer_name")
            local.lastSeenVersion = s.str("last_seen_version")
            local.dirty = false
        }

        for r in rates {
            guard let code = r.str("code"), let rate = r.dbl("rate_to_base") else { continue }
            let e = exRates[code] ?? { let n = ExchangeRate(code: code, rateToBase: rate, updatedAt: .now); context.insert(n); return n }()
            e.rateToBase = rate; e.updatedAt = r.date("updated_at") ?? .now
        }

        for r in clients {
            guard let id = r.uuid("id"), let name = r.str("name") else { continue }
            let c = exClients[id.uuidString] ?? { let n = Client(id: id, name: name); context.insert(n); return n }()
            c.name = name; c.company = r.str("company")
            c.defaultCurrency = r.str("default_currency")
            c.accentColor = r.str("accent_color")
            c.notes = r.str("notes")
            c.shortDescription = r.str("short_description")
            c.email = r.str("email"); c.phone = r.str("phone")
            c.address = r.str("address"); c.city = r.str("city"); c.country = r.str("country")
            c.taxId = r.str("tax_id"); c.ice = r.str("ice"); c.rc = r.str("rc")
            c.bankName = r.str("bank_name"); c.bankAccount = r.str("bank_account")
            c.iban = r.str("iban"); c.swift = r.str("swift")
            c.archived = r.bool("archived") ?? false
            c.createdAt = r.date("created_at") ?? .now
            c.updatedAt = r.date("updated_at") ?? .now
        }

        for r in projects {
            guard let id = r.uuid("id"), let title = r.str("title") else { continue }
            let p = exProjects[id.uuidString] ?? { let n = Project(id: id, title: title, amount: 0, currency: "PHP"); context.insert(n); return n }()
            p.clientId = r.uuid("client_id"); p.title = title
            p.amount = r.dbl("amount") ?? 0; p.currency = r.str("currency") ?? "PHP"
            p.status = ProjectStatus(rawValue: r.str("status") ?? "unpaid") ?? .unpaid
            p.quotedAt = r.date("quoted_at")
            p.dueDate = r.date("due_date")
            p.completedAt = r.date("completed_at")
            p.flaggedOverdue = r.bool("flagged_overdue") ?? false
            p.notes = r.str("notes")
            p.createdAt = r.date("created_at") ?? .now
            p.updatedAt = r.date("updated_at") ?? .now
        }

        for r in wallets {
            guard let id = r.uuid("id"), let name = r.str("name") else { continue }
            let w = exWallets[id.uuidString] ?? { let n = Wallet(id: id, name: name, kind: .other, isHolding: true); context.insert(n); return n }()
            w.name = name
            w.kind = WalletKind(rawValue: r.str("kind") ?? "other") ?? .other
            w.isHolding = r.bool("is_holding") ?? true
            w.currencyIn = r.str("currency_in")
            w.currencyOut = r.str("currency_out")
            w.monthlyFeeBase = r.dbl("monthly_fee_php") ?? 0
            w.openingBalanceBase = r.dbl("opening_balance_base")
            w.openingBalanceAt = r.date("opening_balance_at")
            w.openingBalanceSetAt = r.date("opening_balance_set_at")
            w.openingBalanceAmount = r.dbl("opening_balance_amount")
            w.openingBalanceCurrency = r.str("opening_balance_currency")
            w.overdraftToleranceBase = r.dbl("overdraft_tolerance_base") ?? 0
            w.brandKey = r.str("brand_key")
            w.customBrandGlyph = r.str("custom_brand_glyph")
            w.customBrandColor = r.str("custom_brand_color")
            w.notes = r.str("notes")
            w.archived = r.bool("archived") ?? false
            w.createdAt = r.date("created_at") ?? .now
            w.updatedAt = r.date("updated_at") ?? .now
        }

        for r in payments {
            guard let id = r.uuid("id") else { continue }
            let p = exPayments[id.uuidString] ?? { let n = Payment(id: id, projectId: r.uuid("project_id"), amount: 0, currency: "PHP", paidAt: .now); context.insert(n); return n }()
            p.projectId = r.uuid("project_id")
            p.amount = r.dbl("amount") ?? 0; p.currency = r.str("currency") ?? "PHP"
            p.paidAt = r.date("paid_at") ?? .now
            p.netAmountBase = r.dbl("net_amount_base")
            p.grossAtMarketBase = r.dbl("gross_at_market_base")
            p.impliedFeeBase = r.dbl("implied_fee_base")
            p.fxLocked = r.bool("fx_locked") ?? true
            p.feeUnknown = r.bool("fee_unknown") ?? false
            p.reference = r.str("reference")
            p.notes = r.str("notes")
            p.createdAt = r.date("created_at") ?? .now
            p.updatedAt = p.createdAt
        }

        for r in steps {
            guard let id = r.uuid("id"), let paymentId = r.uuid("payment_id") else { continue }
            let s = exSteps[id.uuidString] ?? { let n = PaymentStep(id: id, paymentId: paymentId, stepOrder: 1, fromMethodId: nil, methodId: nil, amountIn: 0, currencyIn: "PHP", amountOut: 0, currencyOut: "PHP", isFinal: true); context.insert(n); return n }()
            s.stepOrder = Int(r.dbl("step_order") ?? 1)
            s.fromMethodId = r.uuid("from_method_id"); s.methodId = r.uuid("method_id")
            s.amountIn = r.dbl("amount_in") ?? 0; s.currencyIn = r.str("currency_in") ?? "PHP"
            s.amountOut = r.dbl("amount_out") ?? 0; s.currencyOut = r.str("currency_out") ?? "PHP"
            s.isFinal = r.bool("is_final") ?? true
            s.notes = r.str("notes")
            s.createdAt = r.date("created_at") ?? .now
        }

        for r in allocs {
            guard let paymentId = r.uuid("payment_id"), let projectId = r.uuid("project_id") else { continue }
            let a = exAllocs["\(paymentId.uuidString)|\(projectId.uuidString)"]
                ?? { let n = PaymentAllocation(paymentId: paymentId, projectId: projectId, allocationAmount: 0, allocationCurrency: "PHP", allocationBase: 0); context.insert(n); return n }()
            a.allocationAmount = r.dbl("allocation_amount") ?? 0
            a.allocationCurrency = r.str("allocation_currency") ?? "PHP"
            a.allocationBase = r.dbl("allocation_base") ?? 0
            a.notes = r.str("notes")
            a.createdAt = r.date("created_at") ?? .now
        }

        for r in withdrawals {
            guard let id = r.uuid("id") else { continue }
            let w = exWithdrawals[id.uuidString] ?? { let n = Withdrawal(id: id, fromMethodId: r.uuid("from_method_id"), toMethodId: r.uuid("to_method_id"), withdrawnAt: .now, grossBase: 0, netBase: 0, feeBase: 0); context.insert(n); return n }()
            w.fromMethodId = r.uuid("from_method_id"); w.toMethodId = r.uuid("to_method_id")
            w.withdrawnAt = r.date("withdrawn_at") ?? .now
            w.grossBase = r.dbl("gross_base") ?? 0; w.netBase = r.dbl("net_base") ?? 0; w.feeBase = r.dbl("fee_base") ?? 0
            w.notes = r.str("notes")
            w.createdAt = r.date("created_at") ?? .now
        }

        // Ledger income: each payment's net lands in its final step's wallet (skip if an
        // active ledger entry already exists — e.g. a payment you logged natively).
        for p in payments {
            guard let id = p.uuid("id"), let net = p.dbl("net_amount_base"), net > 0, !ledgerExists(id) else { continue }
            let final = steps.filter { $0.uuid("payment_id") == id }
                .max(by: { ($0.dbl("step_order") ?? 0) < ($1.dbl("step_order") ?? 0) })
            guard let wallet = final?.uuid("method_id") else { continue }
            context.insert(LedgerEntry(kind: .income, amountBase: round2(net), walletId: wallet,
                                       relatedKind: .payment, relatedId: id,
                                       eventAt: p.date("paid_at") ?? .now, note: "import"))
        }
        for w in withdrawals {
            guard let id = w.uuid("id"), let from = w.uuid("from_method_id"), !ledgerExists(id) else { continue }
            context.insert(LedgerEntry(kind: .outflow, amountBase: -round2(w.dbl("gross_base") ?? 0),
                                       walletId: from, relatedKind: .withdrawal, relatedId: id,
                                       eventAt: w.date("withdrawn_at") ?? .now, note: "import"))
        }

        // Spends: upsert by id; else merge a likely local duplicate (same PHT day + amount
        // + similar description) so the same purchase isn't doubled.
        func descClose(_ a: String?, _ b: String?) -> Bool {
            let x = (a ?? "").lowercased().trimmingCharacters(in: .whitespaces)
            let y = (b ?? "").lowercased().trimmingCharacters(in: .whitespaces)
            if x.isEmpty || y.isEmpty { return x == y }
            return x == y || x.contains(y) || y.contains(x)
        }
        for s in spends {
            guard let id = s.uuid("id") else { continue }
            let amt = round2(s.dbl("amount_base") ?? 0)
            let when = s.date("spent_at") ?? .now
            let sp: Spend
            if let m = exSpends[id.uuidString] { sp = m }
            else if let dup = localSpends.first(where: { PHT.calendar.isDate($0.spentAt, inSameDayAs: when)
                && abs($0.amountBase - amt) < 0.5 && descClose($0.spendDescription, s.str("description")) }) {
                sp = dup
            } else {
                let n = Spend(id: id, walletId: s.uuid("wallet_id"), spentAt: when,
                              amount: s.dbl("amount") ?? amt, currency: s.str("currency") ?? "PHP",
                              amountBase: amt, spendDescription: s.str("description"))
                context.insert(n); sp = n
            }
            sp.walletId = s.uuid("wallet_id"); sp.spentAt = when
            sp.amount = s.dbl("amount") ?? amt; sp.currency = s.str("currency") ?? "PHP"; sp.amountBase = amt
            sp.spendDescription = s.str("description"); sp.isSadaka = s.bool("is_sadaka") ?? false
            sp.notes = s.str("notes"); sp.createdAt = s.date("created_at") ?? .now
            if let tags = spendTags[id.uuidString.lowercased()] ?? spendTags[id.uuidString], !tags.isEmpty {
                sp.tags = tags; sp.category = tags.first
            }
            if let wallet = sp.walletId, amt != 0, !ledgerExists(sp.id) {
                context.insert(LedgerEntry(kind: sp.isSadaka ? .sadakaPayment : .outflow, amountBase: -amt,
                                           walletId: wallet, relatedKind: .spend, relatedId: sp.id,
                                           eventAt: sp.spentAt, note: "import"))
            }
        }

        try context.save()
    }

    // MARK: Push (dirty local rows → PostgREST upsert)

    private func iso(_ d: Date?) -> Any { d.map { DateParse.string($0) } ?? NSNull() }

    private func pushDirty(api: SupabaseAPI, from context: ModelContext) async throws {
        // Payments
        let payments = ((try? context.fetch(FetchDescriptor<Payment>())) ?? []).filter { $0.dirty }
        try await api.upsert("payments", rows: payments.map { p in
            [
                "id": p.id.uuidString.lowercased(),
                "project_id": p.projectId?.uuidString.lowercased() ?? NSNull(),
                "amount": p.amount, "currency": p.currency,
                "paid_at": DateParse.string(p.paidAt),
                "net_amount_base": p.netAmountBase ?? NSNull(),
                "gross_at_market_base": p.grossAtMarketBase ?? NSNull(),
                "implied_fee_base": p.impliedFeeBase ?? NSNull(),
                "fx_locked": p.fxLocked, "fee_unknown": p.feeUnknown,
                "reference": p.reference ?? NSNull(), "notes": p.notes ?? NSNull(),
            ]
        })
        payments.forEach { $0.dirty = false }

        // Steps
        let steps = ((try? context.fetch(FetchDescriptor<PaymentStep>())) ?? []).filter { $0.dirty }
        try await api.upsert("payment_steps", rows: steps.map { s in
            [
                "id": s.id.uuidString.lowercased(),
                "payment_id": s.paymentId.uuidString.lowercased(),
                "step_order": s.stepOrder,
                "from_method_id": s.fromMethodId?.uuidString.lowercased() ?? NSNull(),
                "method_id": s.methodId?.uuidString.lowercased() ?? NSNull(),
                "amount_in": s.amountIn, "currency_in": s.currencyIn,
                "amount_out": s.amountOut, "currency_out": s.currencyOut,
                "is_final": s.isFinal, "notes": s.notes ?? NSNull(),
            ]
        })
        steps.forEach { $0.dirty = false }

        // Allocations
        let allocs = ((try? context.fetch(FetchDescriptor<PaymentAllocation>())) ?? []).filter { $0.dirty }
        try await api.upsert("payment_project_allocations", rows: allocs.map { a in
            [
                "payment_id": a.paymentId.uuidString.lowercased(),
                "project_id": a.projectId.uuidString.lowercased(),
                "allocation_amount": a.allocationAmount, "allocation_currency": a.allocationCurrency,
                "allocation_base": a.allocationBase, "notes": a.notes ?? NSNull(),
            ]
        })
        allocs.forEach { $0.dirty = false }

        // Withdrawals
        let withdrawals = ((try? context.fetch(FetchDescriptor<Withdrawal>())) ?? []).filter { $0.dirty }
        try await api.upsert("withdrawals", rows: withdrawals.map { w in
            [
                "id": w.id.uuidString.lowercased(),
                "from_method_id": w.fromMethodId?.uuidString.lowercased() ?? NSNull(),
                "to_method_id": w.toMethodId?.uuidString.lowercased() ?? NSNull(),
                "withdrawn_at": DateParse.string(w.withdrawnAt),
                "gross_base": w.grossBase, "net_base": w.netBase, "fee_base": w.feeBase,
                "notes": w.notes ?? NSNull(),
            ]
        })
        withdrawals.forEach { $0.dirty = false }

        // NOTE: money_ledger is intentionally NOT pushed — the `authenticated` role
        // has no grant on it; the local ledger is a derived cache rebuilt on import.

        // Projects & clients & wallets (safe-field upserts)
        let projects = ((try? context.fetch(FetchDescriptor<Project>())) ?? []).filter { $0.dirty }
        try await api.upsert("projects", rows: projects.map { p in
            [
                "id": p.id.uuidString.lowercased(),
                "client_id": p.clientId?.uuidString.lowercased() ?? NSNull(),
                "title": p.title, "amount": p.amount, "currency": p.currency,
                "status": p.statusRaw, "notes": p.notes ?? NSNull(),
            ]
        })
        projects.forEach { $0.dirty = false }

        try context.save()
    }
}

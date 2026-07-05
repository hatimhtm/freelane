import AppIntents
import SwiftData
import Foundation

/// "Log a spend" from Siri / Shortcuts / Spotlight.
struct LogSpendIntent: AppIntent {
    static var title: LocalizedStringResource = "Log a spend"
    static var description = IntentDescription("Record a spend in Freelane.")

    @Parameter(title: "Amount") var amount: Double
    @Parameter(title: "Vendor") var vendor: String?

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let ctx = AppContainer.shared.mainContext
        let base = (try? ctx.fetch(FetchDescriptor<AppSettings>()).first)?.baseCurrency ?? "PHP"
        // Default to the wallet you last logged a spend into (a real smart default), else the
        // first live holding wallet — excluding trashed.
        let liveSpends = ((try? ctx.fetch(FetchDescriptor<Spend>())) ?? []).filter { $0.deletedAt == nil }.sorted { $0.spentAt > $1.spentAt }
        let liveWallets = ((try? ctx.fetch(FetchDescriptor<Wallet>())) ?? []).filter { $0.deletedAt == nil && $0.isHolding && !$0.archived }
        // Last-used wallet ONLY if it's still a valid holding wallet (it may have been archived
        // or trashed); else the first holding wallet. Never fall through to nil — a nil wallet
        // would record a spend that moves no money (no ledger entry).
        let lastUsed = liveSpends.first?.walletId.flatMap { id in liveWallets.first { $0.id == id }?.id }
        guard let wallet = lastUsed ?? liveWallets.first?.id else {
            return .result(dialog: "Add a wallet in Freelane first, then I can log spends from here.")
        }
        let id = try MoneyEngine(context: ctx).createSpend(
            walletId: wallet, amount: amount, currency: base, description: vendor,
            vendorName: vendor, category: nil, isSadaka: false, spentAt: .now)
        // Same intelligence + widget refresh as the in-app path.
        await Brain.onSpendLogged(ctx, ai: AIManager(), spendId: id)
        WidgetBridge.update(ctx)
        let v = vendor.map { " at \($0)" } ?? ""
        return .result(dialog: "Logged \(CurrencyFormat.symbol(base))\(Int(amount))\(v).")
    }
}

/// "What's my safe to spend" — read-only.
struct SafeToSpendIntent: AppIntent {
    static var title: LocalizedStringResource = "Safe to spend today"
    static var description = IntentDescription("Ask Freelane how much you can spend today.")

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let ctx = AppContainer.shared.mainContext
        func all<T: PersistentModel>(_ t: T.Type) -> [T] {
            let rows = (try? ctx.fetch(FetchDescriptor<T>())) ?? []
            if T.self is any SoftDeletable.Type { return rows.filter { ($0 as? any SoftDeletable)?.deletedAt == nil } }
            return rows
        }
        let base = all(AppSettings.self).first?.baseCurrency ?? "PHP"
        let safe = SafeToSpend.compute(payments: all(Payment.self), spends: all(Spend.self),
                                       wallets: all(Wallet.self), ledger: all(LedgerEntry.self),
                                       recurrings: all(Recurring.self), plans: all(Plan.self))
        return .result(dialog: "You can spend about \(CurrencyFormat.string(safe.liveRemaining, base, compact: true)) today.")
    }
}

/// "Give sadaka" from Siri / Shortcuts.
struct GiveSadakaIntent: AppIntent {
    static var title: LocalizedStringResource = "Give sadaka"
    static var description = IntentDescription("Record a sadaka (charity) gift in Freelane.")

    @Parameter(title: "Amount") var amount: Double

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let ctx = AppContainer.shared.mainContext
        let base = (try? ctx.fetch(FetchDescriptor<AppSettings>()).first)?.baseCurrency ?? "PHP"
        guard let wallet = ((try? ctx.fetch(FetchDescriptor<Wallet>())) ?? []).first(where: { $0.deletedAt == nil && $0.isHolding && !$0.archived }) else {
            return .result(dialog: "Add a wallet in Freelane first, then I can log sadaka from here.")
        }
        let id = try MoneyEngine(context: ctx).createSpend(
            walletId: wallet.id, amount: amount, currency: base, description: "Sadaka",
            vendorName: nil, category: "Sadaka", isSadaka: true, spentAt: .now)
        await Brain.onSpendLogged(ctx, ai: AIManager(), spendId: id)   // same learning as the in-app path
        WidgetBridge.update(ctx)
        return .result(dialog: "Logged \(CurrencyFormat.symbol(base))\(Int(amount)) of sadaka. May it be accepted.")
    }
}

/// "Mark a prayer" from Siri / Shortcuts.
struct MarkPrayerIntent: AppIntent {
    static var title: LocalizedStringResource = "Mark a prayer"
    static var description = IntentDescription("Log one of the five daily prayers as prayed.")

    @Parameter(title: "Prayer") var prayer: String

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let ctx = AppContainer.shared.mainContext
        let names = ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"]
        let name = names.first { $0.lowercased() == prayer.lowercased() } ?? prayer.capitalized
        let key = PHT.dayKey()
        let logs = (try? ctx.fetch(FetchDescriptor<PrayerLog>())) ?? []
        if !logs.contains(where: { $0.prayer == name && $0.id.hasSuffix("|\(key)") }) {
            ctx.insert(PrayerLog(prayer: name, day: .now)); try? ctx.save()
        }
        return .result(dialog: "Marked \(name) as prayed.")
    }
}

/// "What's my outstanding" — read-only.
struct QueryOutstandingIntent: AppIntent {
    static var title: LocalizedStringResource = "Outstanding income"
    static var description = IntentDescription("Ask Freelane how much clients still owe you.")

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let ctx = AppContainer.shared.mainContext
        let settings = (try? ctx.fetch(FetchDescriptor<AppSettings>()).first)
        let base = settings?.baseCurrency ?? "PHP"
        let rateRows = (try? ctx.fetch(FetchDescriptor<ExchangeRate>())) ?? []
        let rates = Rates(base: base, rates: rateRows)
        let projects = ((try? ctx.fetch(FetchDescriptor<Project>())) ?? []).filter { $0.deletedAt == nil }
        let allocations = (try? ctx.fetch(FetchDescriptor<PaymentAllocation>())) ?? []
        let out = projects.filter { $0.status == .unpaid || $0.status == .partiallyPaid }
            .reduce(0.0) { $0 + rates.toBase(ProjectMath.outstandingNative(project: $1, allocations: allocations, rates: rates), $1.currency) }
        return .result(dialog: out > 0 ? "Clients still owe you about \(CurrencyFormat.string(out, base, compact: true)) across open projects." : "You're all paid up — nothing outstanding.")
    }
}

/// "Log a payment" from Siri / Shortcuts — matches the project by name.
struct LogPaymentIntent: AppIntent {
    static var title: LocalizedStringResource = "Log a payment"
    static var description = IntentDescription("Record a client payment against a project in Freelane.")

    @Parameter(title: "Amount") var amount: Double
    @Parameter(title: "Project") var project: String

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let ctx = AppContainer.shared.mainContext
        let projects = ((try? ctx.fetch(FetchDescriptor<Project>())) ?? []).filter { $0.deletedAt == nil }
        let q = project.lowercased()
        guard let match = projects.first(where: { $0.title.lowercased() == q })
                ?? projects.first(where: { $0.title.lowercased().contains(q) }) else {
            return .result(dialog: "I couldn't find a project called “\(project)”. Open Freelane to log it there.")
        }
        let row = BulkRow(projectId: match.id, paidAt: .now, grossAmount: amount, grossCurrency: match.currency,
                          feeBase: nil, landingMethodId: nil, fromMethodId: nil, reference: nil, notes: "via Shortcuts")
        let result = MoneyEngine(context: ctx).addPaymentsBulk([row])
        WidgetBridge.update(ctx)
        if result.created == 1 {
            return .result(dialog: "Logged \(CurrencyFormat.string(amount, match.currency, compact: true)) against “\(match.title)”.")
        }
        return .result(dialog: "Couldn't log that payment: \(result.errors.first?.1 ?? "unknown error").")
    }
}

/// "Mark work finished" — start a project's payment clock from now (the work-delivered feature).
struct MarkWorkFinishedIntent: AppIntent {
    static var title: LocalizedStringResource = "Mark work finished"
    static var description = IntentDescription("Mark a project's work as delivered — starts the “waiting to be paid” clock.")

    @Parameter(title: "Project") var project: String

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let ctx = AppContainer.shared.mainContext
        let projects = ((try? ctx.fetch(FetchDescriptor<Project>())) ?? []).filter { $0.deletedAt == nil }
        let q = project.lowercased()
        guard let match = projects.first(where: { $0.title.lowercased() == q })
                ?? projects.first(where: { $0.title.lowercased().contains(q) }) else {
            return .result(dialog: "I couldn't find a project called “\(project)”.")
        }
        match.workCompletedAt = .now; match.updatedAt = .now; match.dirty = true
        try? ctx.save()
        return .result(dialog: "Marked “\(match.title)” as delivered — the payment clock starts now.")
    }
}

/// "Add a journal entry" — dictate a thought from anywhere; it lands in the journal and the
/// brain synthesizes it like any in-app entry (mood/themes/memory, maybe a follow-up question).
struct AddJournalEntryIntent: AppIntent {
    static var title: LocalizedStringResource = "Add a journal entry"
    static var description = IntentDescription("Write or dictate a journal entry into Freelane.")

    @Parameter(title: "Entry") var text: String

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let ctx = AppContainer.shared.mainContext
        let l = Letter(title: Date.now.formatted(.dateTime.weekday(.wide).month().day()), body: text, kind: "journal")
        l.dirty = true
        ctx.insert(l); try? ctx.save()
        let all = ((try? ctx.fetch(FetchDescriptor<Letter>())) ?? []).filter { $0.deletedAt == nil }
        JournalGame.reconcileCoins(entries: all.map { ($0.id, $0.createdAt) })
        // Await the analysis (mood/themes/memory + maybe a follow-up). A detached Task would be
        // killed when this Shortcuts/Siri process tears down right after the result, so the
        // enrichment would silently never run.
        let mgr = AIManager()
        if mgr.isReady { await Brain.analyzeJournal(ctx, ai: mgr, letter: l, followUp: true) }
        return .result(dialog: "Saved to your journal.")
    }
}

/// "Ask Freelane" — a free-form grounded question (the same brain as the in-app assistant),
/// so Shortcuts and automations can query anything: balances, projects, spending, patterns.
struct AskFreelaneIntent: AppIntent {
    static var title: LocalizedStringResource = "Ask Freelane"
    static var description = IntentDescription("Ask anything about your money or life data; answers use your real numbers.")

    @Parameter(title: "Question") var question: String

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog & ReturnsValue<String> {
        let ctx = AppContainer.shared.mainContext
        let answer = await Brain.answer(ctx, ai: AIManager(), page: "Shortcuts", question: question)
        return .result(value: answer, dialog: "\(answer)")
    }
}

/// "Open a page" — jump straight to any page of the app.
struct OpenFeatureIntent: AppIntent {
    static var title: LocalizedStringResource = "Open a page"
    static var description = IntentDescription("Open Freelane on a specific page.")
    static var openAppWhenRun = true

    @Parameter(title: "Page") var page: FeaturePage

    @MainActor
    func perform() async throws -> some IntentResult {
        NotificationCenter.default.post(name: .flOpenFeature, object: nil, userInfo: ["feature": page.rawValue])
        return .result()
    }
}

enum FeaturePage: String, AppEnum {
    case dashboard, today, agenda, payments, projects, spending, clients, people, vendors, sadaka, faith, body, letters, stats, activity, settings
    static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Page")
    static var caseDisplayRepresentations: [FeaturePage: DisplayRepresentation] = [
        .dashboard: "Dashboard", .today: "Today", .agenda: "Agenda", .payments: "Payments",
        .projects: "Projects", .spending: "Spending", .clients: "Clients", .people: "People",
        .vendors: "Vendors", .sadaka: "Sadaka", .faith: "Faith", .body: "Body",
        .letters: "Journal", .stats: "Stats", .activity: "Activity", .settings: "Settings",
    ]
}

struct FreelaneShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: LogSpendIntent(),
                    phrases: ["Log a spend in \(.applicationName)", "Add a spend to \(.applicationName)"],
                    shortTitle: "Log spend", systemImageName: "cart.badge.plus")
        AppShortcut(intent: SafeToSpendIntent(),
                    phrases: ["What's my safe to spend in \(.applicationName)", "How much can I spend in \(.applicationName)"],
                    shortTitle: "Safe to spend", systemImageName: "shield.lefthalf.filled")
        AppShortcut(intent: GiveSadakaIntent(),
                    phrases: ["Give sadaka in \(.applicationName)", "Log sadaka in \(.applicationName)"],
                    shortTitle: "Give sadaka", systemImageName: "heart.fill")
        AppShortcut(intent: MarkPrayerIntent(),
                    phrases: ["Mark a prayer in \(.applicationName)", "Log a prayer in \(.applicationName)"],
                    shortTitle: "Mark prayer", systemImageName: "moon.stars.fill")
        AppShortcut(intent: QueryOutstandingIntent(),
                    phrases: ["What's outstanding in \(.applicationName)", "How much am I owed in \(.applicationName)"],
                    shortTitle: "Outstanding", systemImageName: "hourglass")
        AppShortcut(intent: LogPaymentIntent(),
                    phrases: ["Log a payment in \(.applicationName)", "I got paid in \(.applicationName)"],
                    shortTitle: "Log payment", systemImageName: "arrow.down.left.circle.fill")
        AppShortcut(intent: MarkWorkFinishedIntent(),
                    phrases: ["Mark work finished in \(.applicationName)", "I delivered a project in \(.applicationName)"],
                    shortTitle: "Work finished", systemImageName: "checkmark.seal.fill")
        AppShortcut(intent: AddJournalEntryIntent(),
                    phrases: ["Add a journal entry in \(.applicationName)", "Journal in \(.applicationName)"],
                    shortTitle: "Journal", systemImageName: "book.closed.fill")
        AppShortcut(intent: AskFreelaneIntent(),
                    phrases: ["Ask \(.applicationName)"],
                    shortTitle: "Ask", systemImageName: "sparkles")
        AppShortcut(intent: OpenFeatureIntent(),
                    phrases: ["Open a page in \(.applicationName)"],
                    shortTitle: "Open page", systemImageName: "rectangle.3.group")
    }
}

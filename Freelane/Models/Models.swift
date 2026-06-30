import Foundation
import SwiftData

// MARK: - Enums

enum ProjectStatus: String, Codable, CaseIterable, Sendable {
    case unpaid
    case partiallyPaid = "partially_paid"
    case paid
    case archived

    var label: String {
        switch self {
        case .unpaid: return "Unpaid"
        case .partiallyPaid: return "Partial"
        case .paid: return "Paid"
        case .archived: return "Archived"
        }
    }
}

enum WalletKind: String, Codable, CaseIterable, Sendable {
    case bank, wallet, exchange, crypto, cash, other

    var label: String { rawValue.capitalized }
    var symbolName: String {
        switch self {
        case .bank: return "building.columns"
        case .wallet: return "wallet.bifold"
        case .exchange: return "arrow.left.arrow.right.circle"
        case .crypto: return "bitcoinsign.circle"
        case .cash: return "banknote"
        case .other: return "creditcard"
        }
    }
}

enum LedgerKind: String, Codable, Sendable {
    case income
    case outflow
    case transfer
    case fee
    case sadakaPayment = "sadaka_payment"
    case projectReceipt = "project_receipt"
    case unaccountedOutflow = "unaccounted_outflow"
    case adjustment
}

enum LedgerRelatedKind: String, Codable, Sendable {
    case payment, spend, withdrawal, sadaka, project, fee, reconciliation
}

// MARK: - Settings

@Model
final class AppSettings {
    @Attribute(.unique) var id: String          // "singleton"
    var baseCurrency: String
    var issuerName: String?
    var theme: String
    var lastSeenVersion: String?
    var sadakaAnchorPct: Double = 2.5   // your giving anchor (% of income), tunable

    var updatedAt: Date
    var dirty: Bool

    init(id: String = "singleton", baseCurrency: String = "PHP") {
        self.id = id
        self.baseCurrency = baseCurrency
        self.theme = "liquid"
        self.updatedAt = .now
        self.dirty = false
    }
}

// MARK: - Exchange rates

@Model
final class ExchangeRate {
    @Attribute(.unique) var code: String         // currency code is the natural key (per-user)
    var rateToBase: Double                        // amountNative * rateToBase = amountBase
    var updatedAt: Date
    var dirty: Bool

    init(code: String, rateToBase: Double, updatedAt: Date = .now) {
        self.code = code
        self.rateToBase = rateToBase
        self.updatedAt = updatedAt
        self.dirty = false
    }
}

// MARK: - Client

@Model
final class Client {
    @Attribute(.unique) var id: UUID
    var deletedAt: Date? = nil   // soft-delete tombstone — nil = live; set = in Trash (P1 restore/undo)
    var name: String
    var company: String?
    var defaultCurrency: String?
    var accentColor: String?
    var notes: String?
    var shortDescription: String?
    // Internal client data (your full records).
    var email: String?
    var phone: String?
    var address: String?
    var city: String?
    var country: String?
    var taxId: String?
    var ice: String?
    var rc: String?
    var bankName: String?
    var bankAccount: String?
    var iban: String?
    var swift: String?
    /// Relationship working details.
    var timeZoneId: String? = nil        // IANA id, e.g. "America/New_York" — drives "it's 12:47am there"
    var nudgeTone: String? = nil         // warm | firm | formal — steers AI nudge drafting
    var isRetainer: Bool = false         // ongoing retainer client vs one-off project work
    var retainerBase: Double = 0         // monthly retainer in base currency
    /// AI-managed living memory, stored as JSON text (consolidated facts/watch/prefs).
    var memoryJSON: String?
    var archived: Bool
    var createdAt: Date

    var updatedAt: Date
    var dirty: Bool

    init(id: UUID = UUID(), name: String, company: String? = nil) {
        self.id = id
        self.name = name
        self.company = company
        self.archived = false
        self.createdAt = .now
        self.updatedAt = .now
        self.dirty = false
    }
}

// MARK: - Project

@Model
final class Project {
    @Attribute(.unique) var id: UUID
    var deletedAt: Date? = nil   // soft-delete tombstone — nil = live; set = in Trash (P1 restore/undo)
    var clientId: UUID?
    var title: String
    var amount: Double
    var currency: String
    var statusRaw: String
    var quotedAt: Date?
    var dueDate: Date?
    var completedAt: Date?
    var workCompletedAt: Date? = nil   // when YOU finished the work → the payment clock starts here. nil = not delivered yet, falls back to quote/created date. Distinct from completedAt (= fully paid, machine-managed).
    var flaggedOverdue: Bool
    var notes: String?
    var createdAt: Date

    var updatedAt: Date
    var dirty: Bool

    var status: ProjectStatus {
        get { ProjectStatus(rawValue: statusRaw) ?? .unpaid }
        set { statusRaw = newValue.rawValue }
    }

    /// When the "days waiting to be paid" clock starts. Once you mark the work
    /// delivered it counts from then; otherwise it falls back to the quote/created
    /// date — so aging stops punishing the time you spent doing the work.
    var agingAnchor: Date { workCompletedAt ?? quotedAt ?? createdAt }

    init(id: UUID = UUID(), clientId: UUID? = nil, title: String, amount: Double,
         currency: String, status: ProjectStatus = .unpaid) {
        self.id = id
        self.clientId = clientId
        self.title = title
        self.amount = amount
        self.currency = currency
        self.statusRaw = status.rawValue
        self.flaggedOverdue = false
        self.createdAt = .now
        self.quotedAt = .now
        self.updatedAt = .now
        self.dirty = false
    }
}

// MARK: - Wallet (payment_method)

@Model
final class Wallet {
    @Attribute(.unique) var id: UUID
    var deletedAt: Date? = nil   // soft-delete tombstone — nil = live; set = in Trash (P1 restore/undo)
    var name: String
    var kindRaw: String
    var isHolding: Bool
    var currencyIn: String?
    var currencyOut: String?
    var monthlyFeeBase: Double
    var openingBalanceBase: Double?
    var openingBalanceAt: Date?
    var openingBalanceSetAt: Date?
    var openingBalanceAmount: Double?
    var openingBalanceCurrency: String?
    var overdraftToleranceBase: Double
    var brandKey: String?
    var customBrandGlyph: String?
    var customBrandColor: String?
    var notes: String?
    var archived: Bool
    var excludedFromTotals: Bool = false   // ignore in "available" totals + overdrawn alerts (balance still shown)
    var createdAt: Date

    var updatedAt: Date
    var dirty: Bool

    var kind: WalletKind {
        get { WalletKind(rawValue: kindRaw) ?? .other }
        set { kindRaw = newValue.rawValue }
    }

    init(id: UUID = UUID(), name: String, kind: WalletKind = .wallet, isHolding: Bool = true) {
        self.id = id
        self.name = name
        self.kindRaw = kind.rawValue
        self.isHolding = isHolding
        self.monthlyFeeBase = 0
        self.overdraftToleranceBase = 0
        self.archived = false
        self.createdAt = .now
        self.updatedAt = .now
        self.dirty = false
    }
}

// MARK: - Payment

@Model
final class Payment {
    @Attribute(.unique) var id: UUID
    var deletedAt: Date? = nil   // soft-delete tombstone — nil = live; set = in Trash (P1 restore/undo)
    var projectId: UUID?
    var amount: Double                  // what was owed, in `currency`
    var currency: String
    var paidAt: Date
    var netAmountBase: Double?
    var grossAtMarketBase: Double?
    var impliedFeeBase: Double?
    var fxLocked: Bool
    var feeUnknown: Bool
    var reference: String?
    var notes: String?
    var createdAt: Date

    var updatedAt: Date
    var dirty: Bool

    init(id: UUID = UUID(), projectId: UUID?, amount: Double, currency: String, paidAt: Date) {
        self.id = id
        self.projectId = projectId
        self.amount = amount
        self.currency = currency
        self.paidAt = paidAt
        self.fxLocked = true
        self.feeUnknown = false
        self.createdAt = .now
        self.updatedAt = .now
        self.dirty = false
    }
}

// MARK: - Payment step (one hop in a chain)

@Model
final class PaymentStep {
    @Attribute(.unique) var id: UUID
    var paymentId: UUID
    var stepOrder: Int
    var fromMethodId: UUID?
    var methodId: UUID?
    var amountIn: Double
    var currencyIn: String
    var amountOut: Double
    var currencyOut: String
    var isFinal: Bool
    var notes: String?
    var createdAt: Date

    var dirty: Bool

    init(id: UUID = UUID(), paymentId: UUID, stepOrder: Int, fromMethodId: UUID?, methodId: UUID?,
         amountIn: Double, currencyIn: String, amountOut: Double, currencyOut: String, isFinal: Bool) {
        self.id = id
        self.paymentId = paymentId
        self.stepOrder = stepOrder
        self.fromMethodId = fromMethodId
        self.methodId = methodId
        self.amountIn = amountIn
        self.currencyIn = currencyIn
        self.amountOut = amountOut
        self.currencyOut = currencyOut
        self.isFinal = isFinal
        self.createdAt = .now
        self.dirty = false
    }
}

// MARK: - Payment → project allocation (multi-project split)

@Model
final class PaymentAllocation {
    @Attribute(.unique) var id: String      // "\(paymentId)|\(projectId)"
    var paymentId: UUID
    var projectId: UUID
    var allocationAmount: Double
    var allocationCurrency: String
    var allocationBase: Double
    var notes: String?
    var createdAt: Date

    var dirty: Bool

    init(paymentId: UUID, projectId: UUID, allocationAmount: Double,
         allocationCurrency: String, allocationBase: Double) {
        self.id = "\(paymentId.uuidString)|\(projectId.uuidString)"
        self.paymentId = paymentId
        self.projectId = projectId
        self.allocationAmount = allocationAmount
        self.allocationCurrency = allocationCurrency
        self.allocationBase = allocationBase
        self.createdAt = .now
        self.dirty = false
    }
}

// MARK: - Withdrawal

@Model
final class Withdrawal {
    @Attribute(.unique) var id: UUID
    var deletedAt: Date? = nil   // soft-delete tombstone — nil = live; set = in Trash (P1 restore/undo)
    var fromMethodId: UUID?
    var toMethodId: UUID?
    var withdrawnAt: Date
    var grossBase: Double
    var netBase: Double
    var feeBase: Double
    var notes: String?
    var createdAt: Date

    var updatedAt: Date
    var dirty: Bool

    init(id: UUID = UUID(), fromMethodId: UUID?, toMethodId: UUID?, withdrawnAt: Date,
         grossBase: Double, netBase: Double, feeBase: Double) {
        self.id = id
        self.fromMethodId = fromMethodId
        self.toMethodId = toMethodId
        self.withdrawnAt = withdrawnAt
        self.grossBase = grossBase
        self.netBase = netBase
        self.feeBase = feeBase
        self.createdAt = .now
        self.updatedAt = .now
        self.dirty = false
    }
}

// MARK: - Money ledger (append-only, signed)

@Model
final class LedgerEntry {
    @Attribute(.unique) var id: UUID
    var kindRaw: String
    var amountBase: Double               // pre-signed: + in, - out
    var walletId: UUID?
    var relatedKindRaw: String?
    var relatedId: UUID?
    var eventAt: Date
    var note: String?
    var archivedAt: Date?
    var createdAt: Date

    var dirty: Bool

    var kind: LedgerKind {
        get { LedgerKind(rawValue: kindRaw) ?? .adjustment }
        set { kindRaw = newValue.rawValue }
    }

    init(id: UUID = UUID(), kind: LedgerKind, amountBase: Double, walletId: UUID?,
         relatedKind: LedgerRelatedKind?, relatedId: UUID?, eventAt: Date, note: String? = nil) {
        self.id = id
        self.kindRaw = kind.rawValue
        self.amountBase = amountBase
        self.walletId = walletId
        self.relatedKindRaw = relatedKind?.rawValue
        self.relatedId = relatedId
        self.eventAt = eventAt
        self.note = note
        self.createdAt = .now
        self.dirty = false
    }
}

// MARK: - Project milestone (a phase of a project, optionally worth a portion of its value)

@Model
final class ProjectMilestone {
    @Attribute(.unique) var id: UUID
    var deletedAt: Date? = nil
    var projectId: UUID
    var title: String
    var amount: Double          // portion of the project's value (in the project's currency); 0 = untracked
    var dueDate: Date?
    var done: Bool
    var doneAt: Date?
    var order: Int
    var createdAt: Date
    var dirty: Bool

    init(id: UUID = UUID(), projectId: UUID, title: String, amount: Double = 0, dueDate: Date? = nil, order: Int = 0) {
        self.id = id; self.projectId = projectId; self.title = title; self.amount = amount
        self.dueDate = dueDate; self.done = false; self.order = order; self.createdAt = .now; self.dirty = false
    }
}

// MARK: - Spend line item (one row of a receipt: an item, its quantity, and what it cost)

@Model
final class SpendItem {
    @Attribute(.unique) var id: UUID
    var deletedAt: Date? = nil
    var spendId: UUID
    var name: String
    var nameKey: String         // normalized for price-memory matching (lowercased, brand+item)
    var quantity: Double        // e.g. 10 (packs), 4 (kg)
    var unit: String?           // "pack", "kg", "pc"… optional
    var lineTotal: Double       // total for this line, in the spend's currency
    var lineTotalBase: Double   // same, converted to base
    var currency: String
    var createdAt: Date
    var dirty: Bool

    /// Per-unit price in base — the number price-memory and good-deal checks compare on.
    var unitPriceBase: Double { quantity > 0 ? lineTotalBase / quantity : lineTotalBase }

    init(id: UUID = UUID(), spendId: UUID, name: String, quantity: Double = 1, unit: String? = nil,
         lineTotal: Double, lineTotalBase: Double, currency: String) {
        self.id = id; self.spendId = spendId; self.name = name
        self.nameKey = SpendItem.normalize(name)
        self.quantity = max(quantity, 1); self.unit = unit
        self.lineTotal = lineTotal; self.lineTotalBase = lineTotalBase; self.currency = currency
        self.createdAt = .now; self.dirty = false
    }

    /// Normalize an item name for matching ("Lucky Me Mommy Chicken" ≈ "lucky me mommy chicken").
    static func normalize(_ s: String) -> String {
        s.lowercased().trimmingCharacters(in: .whitespaces)
            .replacingOccurrences(of: "  ", with: " ")
    }
}

// MARK: - Insight log (accumulating AI observations — the "accountant memory")

@Model
final class InsightLog {
    @Attribute(.unique) var id: UUID
    var text: String
    var category: String        // money | spending | life | pattern
    var createdAt: Date
    var pinned: Bool
    var dismissedAt: Date?
    var dirty: Bool

    init(id: UUID = UUID(), text: String, category: String = "pattern") {
        self.id = id; self.text = text; self.category = category
        self.createdAt = .now; self.pinned = false; self.dirty = false
    }
}

// MARK: - Schema registry

enum FreelaneSchema {
    static let models: [any PersistentModel.Type] = [
        AppSettings.self,
        ExchangeRate.self,
        Client.self,
        Project.self,
        ProjectMilestone.self,
        Wallet.self,
        Payment.self,
        PaymentStep.self,
        PaymentAllocation.self,
        Withdrawal.self,
        LedgerEntry.self,
        Spend.self,
        Vendor.self,
        SpendItem.self,
        // Plan/Habit/HabitEntry: feature retired (2026-06-08). Kept in the schema only so the
        // existing local store opens without a destructive migration. No UI references them.
        Plan.self,
        Loan.self,
        Habit.self,
        HabitEntry.self,
        BodyLog.self,
        PrayerLog.self,
        FastLog.self,
        Letter.self,
        JournalPrompt.self,
        AppNotification.self,
        AIFact.self,
        BrainCache.self,
        Entity.self,
        Recurring.self,
        ChangeRecord.self,
        InsightLog.self,
    ]
}

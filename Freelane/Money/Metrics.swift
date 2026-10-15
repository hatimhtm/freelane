import Foundation

// MARK: - Wallet balance (wallet-balance.ts)

enum WalletMath {
    static func anchor(_ w: Wallet) -> Date? { w.openingBalanceSetAt ?? w.openingBalanceAt }

    /// balance = opening_balance_base + Σ(ledger.amount_base) for live rows since the anchor.
    static func balance(of w: Wallet, ledger: [LedgerEntry]) -> Double {
        let a = anchor(w)
        let sum = ledger
            .filter { $0.walletId == w.id && $0.archivedAt == nil && (a == nil || $0.eventAt >= a!) }
            .reduce(0) { $0 + $1.amountBase }
        return (w.openingBalanceBase ?? 0) + sum
    }
}

// MARK: - Project outstanding

enum ProjectMath {
    /// Paid in the project's own currency, on a GROSS basis — the project is settled when the
    /// client has paid the full quote, regardless of any transfer fee the user absorbed. Both
    /// same- and cross-currency slices use `allocationAmount` (the gross the client paid),
    /// converting the cross slice through base. This MATCHES recomputeProjectStatus exactly, so
    /// a project can't read ".paid" while still showing money outstanding (the old code summed
    /// net-of-fee `allocationBase` for the cross slice, leaving a phantom fee-sized remainder).
    /// Without a usable rate for the project currency the cross slice is ignored, not guessed.
    static func paidNative(project: Project, allocations: [PaymentAllocation], rates: Rates) -> Double {
        let mine = allocations.filter { $0.projectId == project.id }
        let own = mine.filter { $0.allocationCurrency == project.currency }.reduce(0) { $0 + $1.allocationAmount }
        let crossGrossBase = mine.filter { $0.allocationCurrency != project.currency }
            .reduce(0) { $0 + rates.toBase($1.allocationAmount, $1.allocationCurrency) }
        guard crossGrossBase > 0, rates.hasRate(for: project.currency), rates.rate(for: project.currency) > 0 else { return own }
        return own + crossGrossBase / rates.rate(for: project.currency)
    }

    static func paidBase(project: Project, allocations: [PaymentAllocation]) -> Double {
        allocations.filter { $0.projectId == project.id }.reduce(0) { $0 + $1.allocationBase }
    }

    static func outstandingNative(project: Project, allocations: [PaymentAllocation], rates: Rates) -> Double {
        max(0, project.amount - paidNative(project: project, allocations: allocations, rates: rates))
    }

    static func progress(project: Project, allocations: [PaymentAllocation], rates: Rates) -> Double {
        guard project.amount > 0 else { return 0 }
        return min(1, paidNative(project: project, allocations: allocations, rates: rates) / project.amount)
    }

    /// Drop allocations whose parent payment is trashed (they're kept only so restore is exact).
    /// Every paid/outstanding display should pass allocations through this with LIVE payments.
    static func liveAllocations(_ allocations: [PaymentAllocation], payments: [Payment]) -> [PaymentAllocation] {
        let live = Set(payments.map(\.id))
        return allocations.filter { live.contains($0.paymentId) }
    }
}

// MARK: - Dashboard metrics

struct DashboardMetrics {
    var available: Double          // Σ holding wallet balances (clamped ≥ 0 for headline)
    var availableRaw: Double       // unclamped (can show overdraft)
    var landedMTD: Double
    var landedYTD: Double
    var landedLifetime: Double
    var feesMTD: Double
    var outstandingBase: Double
    var activeProjects: Int
    var holdingWalletCount: Int

    struct DayPoint: Identifiable { let id = UUID(); let date: Date; let cumulative: Double }
    var cashFlow: [DayPoint]       // cumulative ledger over the window
}

enum MetricsCompute {
    static func dashboard(payments: [Payment], withdrawals: [Withdrawal], projects: [Project],
                          wallets: [Wallet], ledger: [LedgerEntry], allocations: [PaymentAllocation],
                          rates: Rates, windowDays: Int = 90) -> DashboardMetrics {
        let monthStart = PHT.startOfMonth()
        let yearStart = PHT.startOfYear()

        let holding = wallets.filter { $0.isHolding && !$0.archived && !$0.excludedFromTotals }
        let availableRaw = holding.reduce(0) { $0 + WalletMath.balance(of: $1, ledger: ledger) }

        func landed(since: Date) -> Double {
            payments.filter { $0.paidAt >= since }.reduce(0) { $0 + ($1.netAmountBase ?? 0) }
        }
        let landedMTD = landed(since: monthStart)
        let landedYTD = landed(since: yearStart)
        let landedLifetime = payments.reduce(0) { $0 + ($1.netAmountBase ?? 0) }

        let paymentFeesMTD = payments
            .filter { !$0.feeUnknown && $0.paidAt >= monthStart }
            .reduce(0) { $0 + ($1.impliedFeeBase ?? 0) }
        let withdrawalFeesMTD = withdrawals
            .filter { $0.withdrawnAt >= monthStart }
            .reduce(0) { $0 + $1.feeBase }
        let feesMTD = paymentFeesMTD + withdrawalFeesMTD

        let openProjects = projects.filter { $0.status == .unpaid || $0.status == .partiallyPaid }
        // Invariant: allocations of trashed payments (kept only for restore) never count as paid.
        let livePaymentIds = Set(payments.map(\.id))
        let liveAllocations = allocations.filter { livePaymentIds.contains($0.paymentId) }
        let outstandingBase = openProjects.reduce(0.0) { acc, p in
            acc + rates.toBase(ProjectMath.outstandingNative(project: p, allocations: liveAllocations, rates: rates), p.currency)
        }

        // Cash flow: what the holding wallets held at the end of each day, counted exactly like
        // `availableRaw` (same wallets, anchors and openings) so the line ends on that figure. It
        // used to sum every ledger row of every wallet and ended ₱16.8k away from "Available".
        let holdingIds = Set(holding.map(\.id))
        let anchors = Dictionary(uniqueKeysWithValues: holding.map { ($0.id, WalletMath.anchor($0)) })
        let counted = ledger.filter { e in
            guard e.archivedAt == nil, let w = e.walletId, holdingIds.contains(w) else { return false }
            guard let a = anchors[w] ?? nil else { return true }
            return e.eventAt >= a
        }
        let windowStart = PHT.daysAgo(windowDays)
        let priorBalance = holding.reduce(0) { $0 + ($1.openingBalanceBase ?? 0) }
            + counted.filter { $0.eventAt < windowStart }.reduce(0) { $0 + $1.amountBase }
        let cal = PHT.calendar
        var byDay: [Date: Double] = [:]
        for e in counted where e.eventAt >= windowStart {
            let day = cal.startOfDay(for: e.eventAt)
            byDay[day, default: 0] += e.amountBase
        }
        var points: [DashboardMetrics.DayPoint] = []
        var running = priorBalance
        var day = cal.startOfDay(for: windowStart)
        let today = cal.startOfDay(for: .now)
        while day <= today {
            running += byDay[day] ?? 0
            points.append(.init(date: day, cumulative: running))
            day = cal.date(byAdding: .day, value: 1, to: day) ?? today.addingTimeInterval(86_400)
        }

        return DashboardMetrics(
            available: max(0, availableRaw),
            availableRaw: availableRaw,
            landedMTD: landedMTD,
            landedYTD: landedYTD,
            landedLifetime: landedLifetime,
            feesMTD: feesMTD,
            outstandingBase: outstandingBase,
            activeProjects: openProjects.count,
            holdingWalletCount: holding.count,
            cashFlow: points
        )
    }
}

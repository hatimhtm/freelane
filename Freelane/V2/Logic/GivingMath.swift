import Foundation

// Giving: the spends he marked as sadaka, kept as gifts. Read straight from the store; recipients are
// never guessed from the free-text descriptions, which are shown exactly as he wrote them.

struct GivingGift: Identifiable, Equatable {
    let id: UUID
    let date: Date
    /// His description, or "Gift" when he didn't write one.
    let title: String
    let hasDescription: Bool
    let amount: Double                 // pesos
    let native: (amount: Double, currency: String)?   // the original, when it wasn't pesos
    let walletName: String?

    static func == (a: GivingGift, b: GivingGift) -> Bool { a.id == b.id && a.amount == b.amount && a.title == b.title && a.date == b.date }
}

struct GivingMonth: Identifiable, Equatable {
    let start: Date
    let isCurrent: Bool
    var total = 0.0
    var count = 0
    var id: Date { start }
}

struct GivingPicture {
    /// Every gift, newest first.
    var gifts: [GivingGift] = []
    /// This year, from the month of the first gift this year (nil when nothing was given this year).
    var start: Date? = nil
    var months: [GivingMonth] = []
    var inPeriod: [GivingGift] = []
    var total: Double { inPeriod.reduce(0) { $0 + $1.amount } }
    var largest: GivingGift? { inPeriod.max { $0.amount != $1.amount ? $0.amount < $1.amount : $0.date > $1.date } }
    var mostGiven: GivingMonth? { months.filter { $0.count > 0 }.max { $0.total < $1.total } }
    /// The wallet most gifts came from this year, with how many.
    var usualWallet: (name: String, count: Int)? = nil
    /// The largest gifts this year, largest first.
    var top: [GivingGift] { Array(inPeriod.sorted { $0.amount != $1.amount ? $0.amount > $1.amount : $0.date > $1.date }.prefix(4)) }
}

enum GivingMath {
    static func build(spends: [Spend], wallets: [Wallet], now: Date = .now) -> GivingPicture {
        var p = GivingPicture()
        let name = Dictionary(wallets.map { ($0.id, $0.name) }, uniquingKeysWith: { a, _ in a })
        p.gifts = spends.filter { $0.isSadaka && $0.deletedAt == nil && $0.spentAt <= now }
            .sorted { $0.spentAt > $1.spentAt }
            .map { s in
                let text = s.spendDescription?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                return GivingGift(id: s.id, date: s.spentAt, title: text.isEmpty ? "Gift" : text, hasDescription: !text.isEmpty,
                                  amount: s.amountBase, native: s.currency == "PHP" ? nil : (s.amount, s.currency),
                                  walletName: s.walletId.flatMap { name[$0] })
            }

        let yearStart = PHT.startOfYear(now)
        p.inPeriod = p.gifts.filter { $0.date >= yearStart }
        guard let first = p.inPeriod.map(\.date).min() else { return p }
        let start = PHT.startOfMonth(first)
        p.start = start

        let cal = PHT.calendar, thisMonth = PHT.startOfMonth(now)
        var index: [Date: Int] = [:]
        var m = start
        while m <= thisMonth {
            index[m] = p.months.count
            p.months.append(GivingMonth(start: m, isCurrent: m == thisMonth))
            guard let next = cal.date(byAdding: .month, value: 1, to: m) else { break }
            m = next
        }
        for g in p.inPeriod {
            guard let i = index[PHT.startOfMonth(g.date)] else { continue }
            p.months[i].total += g.amount
            p.months[i].count += 1
        }

        // Ties go to the wallet that gave more.
        var byWallet: [String: (count: Int, total: Double)] = [:]
        for g in p.inPeriod { if let w = g.walletName { byWallet[w, default: (0, 0)].count += 1; byWallet[w, default: (0, 0)].total += g.amount } }
        if let top = byWallet.max(by: { $0.value.count != $1.value.count ? $0.value.count < $1.value.count : $0.value.total < $1.value.total }) {
            p.usualWallet = (top.key, top.value.count)
        }
        return p
    }
}

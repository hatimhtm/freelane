import Foundation

// Giving: the spends he marked as sadaka, kept as gifts. Read straight from the store; descriptions are
// shown exactly as he wrote them. "Who you gave to" groups gifts only by people he named in those words
// (a brother, a spouse, a pet's name); a gift that names no one stays under Others.

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
    /// This year's gifts by who he said they were for, largest first, Others last.
    var recipients: [GivingRecipient] = []
}

struct GivingRecipient: Identifiable, Equatable {
    let name: String
    var total = 0.0
    var count = 0
    var isOthers: Bool { name == GivingMath.others }
    var id: String { name }
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

        var groups: [String: GivingRecipient] = [:]
        var family = false
        let named = pets(in: p.inPeriod.filter(\.hasDescription).map(\.title))
        for g in p.inPeriod {
            let who = g.hasDescription ? recipient(g.title, pets: named) : nil
            if who == "Your wife", g.title.lowercased().contains("family") { family = true }
            let key = who ?? others
            groups[key, default: GivingRecipient(name: key)].total += g.amount
            groups[key, default: GivingRecipient(name: key)].count += 1
        }
        if family, let w = groups.removeValue(forKey: "Your wife") {
            groups["Your wife and her family"] = GivingRecipient(name: "Your wife and her family", total: w.total, count: w.count)
        }
        p.recipients = groups.values.sorted { a, b in
            if a.isOthers != b.isOthers { return b.isOthers }
            return a.total > b.total
        }
        return p
    }

    static let others = "Others"

    private static let petWords = ["kitten", "cat", "puppy", "dog"]

    /// Pets he named, with how he spelled them most often: "my kitten Luna", "Kitten food for Lnua"
    /// → ["Luna": "kitten"]. Close misspellings fold into the commonest spelling.
    static func pets(in texts: [String]) -> [String: String] {
        var found: [(name: String, pet: String)] = []
        for t in texts {
            for pet in petWords {
                for pattern in ["(?i:\\b\(pet))\\s+([A-Z][a-z]{2,})", "(?i:\\b\(pet))\\b.*?\\bfor\\s+([A-Z][a-z]{2,})"] {
                    if let re = try? Regex(pattern), let m = t.firstMatch(of: re), let name = m.output[1].substring {
                        found.append((String(name), pet))
                    }
                }
            }
        }
        var out: [String: String] = [:]
        let uses = { (name: String) in texts.filter { $0.contains(name) }.count }
        for f in found {
            if let existing = out.keys.first(where: { close($0, f.name) }) {
                if uses(f.name) > uses(existing) { out[f.name] = out.removeValue(forKey: existing) }
            } else {
                out[f.name] = f.pet
            }
        }
        return out
    }

    /// Two spellings of one name: at most two letters apart.
    private static func close(_ a: String, _ b: String) -> Bool {
        guard a != b else { return true }
        guard min(a.count, b.count) >= 5, abs(a.count - b.count) <= 2 else { return false }
        let x = Array(a.lowercased()), y = Array(b.lowercased())
        var row = Array(0...y.count)
        for i in 1...x.count {
            var prev = row[0]; row[0] = i
            for j in 1...y.count {
                let cur = row[j]
                row[j] = x[i - 1] == y[j - 1] ? prev : 1 + min(prev, row[j], row[j - 1])
                prev = cur
            }
        }
        return row[y.count] <= 2
    }

    /// Who a gift was for, read only from the people (and pets) his words name. Nil when they name no one.
    static func recipient(_ text: String, pets: [String: String] = [:]) -> String? {
        let words = text.split { !$0.isLetter }.map(String.init)
        for (name, pet) in pets where words.contains(where: { close($0, name) }) { return "\(name), your \(pet)" }
        let t = " " + text.lowercased().replacingOccurrences(of: "[^a-z ]", with: " ", options: .regularExpression) + " "
        let relations: [([String], String)] = [
            ([" brother "], "Your brother"), ([" sister "], "Your sister"),
            ([" mother ", " mom ", " mum ", " mama ", " mommy "], "Your mother"), ([" father ", " dad ", " papa ", " daddy "], "Your father"),
            ([" wife ", " wifey "], "Your wife"), ([" son ", " daughter ", " kids ", " children "], "Your children"),
            ([" friend ", " friends "], "Friends"),
        ]
        for (words, label) in relations where words.contains(where: t.contains) { return label }
        // A pet he didn't name: the one pet of that kind he did name, else just the kind.
        for pet in petWords where t.contains(" \(pet) ") {
            let same = pets.filter { $0.value == pet }
            if same.count == 1, let name = same.first?.key { return "\(name), your \(pet)" }
            return "Your \(pet)"
        }
        return nil
    }
}

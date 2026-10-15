import SwiftUI

// The identity table, enforced in one place: wallets keep their own shape and colour, every bill is a
// cookie-9 in the bill's colour, people are neutral circles. A row's badge always depicts the row's title.

extension IdentityKey {
    var shape: ExpressiveShape {
        switch self {
        case .maya: return .cookie12
        case .cash: return .clover
        case .wise: return .flower
        case .coin: return .cookie6
        case .gcash: return .squircle
        case .rent, .elec, .water, .wifi: return .cookie9
        }
    }
    var billGlyph: String {
        switch self {
        case .rent: return Sym.cottage
        case .elec: return Sym.bolt
        case .water: return Sym.waterDrop
        case .wifi: return Sym.wifi
        default: return Sym.receipt
        }
    }

    /// Which identity a wallet wears. Unknown wallets fall back to a neutral circle.
    static func wallet(_ w: Wallet) -> IdentityKey? {
        let key = (w.brandKey ?? "").lowercased(), name = w.name.lowercased()
        if key == "maya" || name.contains("maya") { return .maya }
        if key == "cash" || w.kind == .cash { return .cash }
        if key == "wise" || name.contains("wise") { return .wise }
        if key == "coin_ph" || name.contains("coin") { return .coin }
        if key == "gcash" || name.contains("gcash") { return .gcash }
        return nil
    }

    /// Which identity a bill wears, from its label.
    static func bill(_ label: String) -> IdentityKey? {
        let l = label.lowercased()
        if l.contains("rent") || l.contains("upa") { return .rent }
        if l.contains("electric") || l.contains("meralco") || l.contains("power") { return .elec }
        if l.contains("water") { return .water }
        if l.contains("wifi") || l.contains("wi-fi") || l.contains("internet") || l.contains("pldt") || l.contains("converge") || l.contains("globe") { return .wifi }
        return nil
    }

    /// The mark inside a wallet badge: its initial, or the banknote glyph for cash.
    var walletMark: BadgeContent {
        switch self {
        case .maya: return .letter("M")
        case .cash: return .glyph(Sym.payments)
        case .wise: return .letter("W")
        case .coin: return .letter("C")
        case .gcash: return .letter("G")
        default: return .glyph(billGlyph)
        }
    }
}

enum BadgeContent { case letter(String), glyph(String) }

enum BadgeSubject {
    case wallet(Wallet)
    case walletKey(IdentityKey)
    case bill(String)          // the bill's label
    case billKey(IdentityKey)
    case person(String)        // a name; shows its initial
    case neutral(String)       // a glyph on a neutral circle
}

/// A 48 / 40 / 28 point identity badge.
struct Badge: View {
    let subject: BadgeSubject
    var size: CGFloat = 40
    /// Replaces the badge's own mark, e.g. a swap glyph on the destination wallet of a move.
    var glyph: String? = nil

    var body: some View {
        let r = resolve()
        ZStack {
            r.shape.shape.fill(r.fill)
            content(glyph.map { .glyph($0) } ?? r.content, ink: r.ink)
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }

    private var glyphSize: CGFloat { size >= 48 ? 24 : size >= 40 ? 20 : 16 }

    @ViewBuilder private func content(_ c: BadgeContent, ink: Color) -> some View {
        switch c {
        case .letter(let s):
            Text(s).font(FS.font(size * 0.42, 700, rond: 100)).foregroundStyle(ink)
        case .glyph(let g):
            Icon(g, size: glyphSize, filled: true, weight: 500).foregroundStyle(ink)
        }
    }

    private func resolve() -> (shape: ExpressiveShape, fill: Color, ink: Color, content: BadgeContent) {
        switch subject {
        case .wallet(let w):
            if let k = IdentityKey.wallet(w) { return (k.shape, k.colors.container, k.colors.onContainer, k.walletMark) }
            return (.circle, Surface.person, MD.onSurfaceVariant, .letter(String(w.name.prefix(1)).uppercased()))
        case .walletKey(let k):
            return (k.shape, k.colors.container, k.colors.onContainer, k.walletMark)
        case .bill(let label):
            if let k = IdentityKey.bill(label) { return (.cookie9, k.colors.container, k.colors.onContainer, .glyph(k.billGlyph)) }
            return (.cookie9, Surface.well2, MD.onSurfaceVariant, .glyph(Sym.receipt))
        case .billKey(let k):
            return (.cookie9, k.colors.container, k.colors.onContainer, .glyph(k.billGlyph))
        case .person(let name):
            return (.circle, Surface.person, MD.onSurfaceVariant, .letter(String(name.trimmingCharacters(in: .whitespaces).prefix(1)).uppercased()))
        case .neutral(let g):
            return (.circle, Surface.well2, MD.onSurfaceVariant, .glyph(g))
        }
    }
}

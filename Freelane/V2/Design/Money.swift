import SwiftUI

/// The six money roles. Every amount on screen is one of these, so figures never drift in size,
/// spacing or rounding between pages.
enum MoneyRole {
    case hero      // 72, Now only. Raised ₱, soft cents.
    case summary   // 48, summary bands.
    case detail    // 36, detail panes.
    case card      // 28, wallet and bill cards.
    case row       // 15, every list. Tabular digits so columns line up.
    case inline(CGFloat) // inside a sentence, at the sentence's size.

    var size: CGFloat {
        switch self {
        case .hero: return 72; case .summary: return 48; case .detail: return 36; case .card: return 28; case .row: return 15
        case .inline(let s): return s
        }
    }
    var weight: CGFloat {
        switch self { case .hero: return 560; case .summary: return 580; default: return 600 }
    }
    var tracking: CGFloat {
        switch self {
        case .hero: return -0.035 * 72; case .summary: return -0.03 * 48; case .detail: return -0.02 * 36; case .card: return -0.015 * 28
        default: return 0
        }
    }
    var tabular: Bool { if case .row = self { return true }; return false }
    var raisedCurrency: Bool { switch self { case .hero, .summary: return true; default: return false } }
    /// Cents shrink only at 28pt and above; below that they're full size and full colour.
    var centsScale: CGFloat? {
        switch self { case .hero, .summary, .detail: return 0.55; case .card: return 0.6; default: return nil }
    }
}

enum MoneySign { case none, plus, minus, auto }

enum MoneyFormat {
    private static let grouped: NumberFormatter = {
        let f = NumberFormatter()
        f.locale = Locale(identifier: "en_US_POSIX"); f.numberStyle = .decimal
        f.usesGroupingSeparator = true; f.groupingSeparator = ","; f.groupingSize = 3
        f.minimumFractionDigits = 0; f.maximumFractionDigits = 0
        return f
    }()
    /// Splits a magnitude into "16,288" and "63".
    static func parts(_ value: Double, wholeOnly: Bool = false) -> (whole: String, cents: String) {
        if wholeOnly { let r = abs(value).rounded(); return (grouped.string(from: NSNumber(value: r)) ?? "\(Int(r))", "00") }
        let v = (abs(value) * 100).rounded() / 100
        let whole = floor(v)
        let cents = Int(((v - whole) * 100).rounded())
        return (grouped.string(from: NSNumber(value: whole)) ?? "\(Int(whole))", String(format: "%02d", min(cents, 99)))
    }
    /// Plain string, for accessibility and sentences: "−₱2,086.07".
    static func string(_ value: Double, decimals: Bool = true, sign: MoneySign = .auto, symbol: String = "₱") -> String {
        let p = parts(value, wholeOnly: !decimals)
        let s: String
        switch sign {
        case .none: s = ""
        case .plus: s = "+"
        case .minus: s = "−"
        case .auto: s = value < -0.004 ? "−" : ""
        }
        return s + symbol + p.whole + (decimals ? "." + p.cents : "")
    }
}

/// An amount set in one of the money roles.
struct Money: View {
    let value: Double
    var role: MoneyRole = .row
    var sign: MoneySign = .auto
    var decimals = true
    var estimate = false
    var color: Color = MD.onSurface
    var symbol = "₱"

    var body: some View {
        text.accessibilityLabel((estimate ? "about " : "") + MoneyFormat.string(value, decimals: decimals, sign: sign, symbol: symbol))
    }

    var text: Text {
        let size = role.size
        let main = FS.font(size, role.weight, rond: 100, tabular: role.tabular)
        let p = MoneyFormat.parts(value, wholeOnly: !decimals)
        var out = Text(verbatim: "")
        let signText: String
        switch sign {
        case .none: signText = ""
        case .plus: signText = "+"
        case .minus: signText = "−"
        case .auto: signText = value < -0.004 ? "−" : ""
        }
        if !signText.isEmpty { out = out + Text(verbatim: signText).font(main).foregroundStyle(color).tracking(role.tracking) }
        if estimate { out = out + Text(verbatim: "~").font(main).foregroundStyle(color.opacity(0.6)) }
        if role.raisedCurrency {
            let small = FS.font(size * 0.5, 500, rond: 100)
            out = out + Text(verbatim: symbol).font(small).baselineOffset(size * 0.355).foregroundStyle(color.opacity(0.8)).tracking(size * 0.04)
        } else {
            out = out + Text(verbatim: symbol).font(main).foregroundStyle(color).tracking(role.tracking)
        }
        out = out + Text(verbatim: p.whole).font(main).foregroundStyle(color).tracking(role.tracking)
        if decimals {
            if let scale = role.centsScale {
                let cf = FS.font(size * scale, role.weight, rond: 100)
                out = out + Text(verbatim: "." + p.cents).font(cf).foregroundStyle(color.opacity(0.6)).tracking(-0.01 * size * scale)
            } else {
                out = out + Text(verbatim: "." + p.cents).font(main).foregroundStyle(color).tracking(role.tracking)
            }
        }
        return out
    }
}

extension Money {
    /// Money coming in: "+" in the primary colour.
    static func incoming(_ v: Double, _ role: MoneyRole = .row, decimals: Bool = true) -> Money {
        Money(value: abs(v), role: role, sign: .plus, decimals: decimals, color: MD.primary)
    }
    /// Money going out: a true minus, in the normal ink.
    static func outgoing(_ v: Double, _ role: MoneyRole = .row, decimals: Bool = true) -> Money {
        Money(value: abs(v), role: role, sign: .minus, decimals: decimals)
    }
    /// A move between his own wallets: no sign, quieter ink.
    static func moved(_ v: Double, _ role: MoneyRole = .row) -> Money {
        Money(value: abs(v), role: role, sign: .none, color: MD.onSurfaceVariant)
    }
}

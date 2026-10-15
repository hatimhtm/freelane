import SwiftUI
import AppKit

// Generated from the v2 design tokens (material-color-utilities, muted sage scheme, hue 165 / chroma 24,
// plus one tonal palette per wallet and bill). Regenerate rather than hand-edit.

/// A colour that follows the window's appearance (white by default, graphite in dark mode).
func dynHex(_ light: String, _ dark: String) -> Color {
    Color(nsColor: NSColor(name: nil) { appearance in
        let isDark = appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
        return NSColor(hex: isDark ? dark : light)
    })
}

extension NSColor {
    convenience init(hex: String) {
        let v = UInt32(hex, radix: 16) ?? 0
        self.init(srgbRed: CGFloat((v >> 16) & 0xff) / 255, green: CGFloat((v >> 8) & 0xff) / 255,
                  blue: CGFloat(v & 0xff) / 255, alpha: 1)
    }
}

/// Material 3 colour roles.
enum MD {
    static let surfaceDim = dynHex("d9dad7", "111412")
    static let surface = dynHex("f9faf6", "111412")
    static let surfaceBright = dynHex("f9faf6", "373a37")
    static let surfaceContainerLowest = dynHex("ffffff", "0c0f0d")
    static let surfaceContainerLow = dynHex("f3f4f0", "191c1a")
    static let surfaceContainer = dynHex("edeeeb", "1d201e")
    static let surfaceContainerHigh = dynHex("e7e9e5", "282b28")
    static let surfaceContainerHighest = dynHex("e2e3df", "333533")
    static let onSurface = dynHex("191c1a", "e2e3df")
    static let onSurfaceVariant = dynHex("414844", "c1c8c2")
    static let outline = dynHex("717973", "8b938d")
    static let outlineVariant = dynHex("c1c8c2", "414844")
    static let inverseSurface = dynHex("2e312f", "e2e3df")
    static let inverseOnSurface = dynHex("f0f1ed", "2e312f")
    static let primary = dynHex("406653", "a6d0b8")
    static let onPrimary = dynHex("ffffff", "103726")
    static let primaryContainer = dynHex("c2ecd3", "284e3c")
    static let onPrimaryContainer = dynHex("284e3c", "c2ecd3")
    static let secondary = dynHex("556159", "bdcac0")
    static let onSecondary = dynHex("ffffff", "28332c")
    static let secondaryContainer = dynHex("d9e6dc", "3e4942")
    static let onSecondaryContainer = dynHex("3e4942", "d9e6dc")
    static let tertiary = dynHex("4e6071", "b5c9dc")
    static let onTertiary = dynHex("ffffff", "203242")
    static let tertiaryContainer = dynHex("d1e5f9", "364959")
    static let onTertiaryContainer = dynHex("364959", "d1e5f9")
    static let error = dynHex("ba1a1a", "ffb4ab")
    static let errorContainer = dynHex("ffdad6", "93000a")
    static let onErrorContainer = dynHex("93000a", "ffdad6")
}

/// App surfaces built on the roles: white panes on a soft neutral window.
enum Surface {
    static let window = dynHex("edeeeb", "0c0f0d")
    static let pane = dynHex("ffffff", "1d201e")
    static let well = dynHex("f3f4f0", "282b28")
    static let well2 = dynHex("edeeeb", "333533")
    static let person = dynHex("e2e3df", "333533")
    static let sticker = dynHex("d1e5f9", "b5c9dc")
    static let onSticker = dynHex("364959", "203242")
    static let hairline = dynHex("c1c8c2", "414844").opacity(0.7)
    static let dialog = dynHex("ffffff", "282b28")
}

/// Identity colours for wallets and bills: a mark (charts, accents), a container (badge fill), the ink on it,
/// and two chart tones (current, past).
struct IdentityColors { let mark, container, onContainer, chart, chartPast: Color }

enum IdentityKey: String, CaseIterable {
    case cash, coin, elec, gcash, maya, rent, water, wifi, wise
    var colors: IdentityColors {
        switch self {
        case .cash: return IdentityColors(mark: dynHex("8f6125", "e7ae6a"), container: dynHex("ffddb8", "754800"), onContainer: dynHex("382000", "ffddb8"), chart: dynHex("ba8747", "c99452"), chartPast: dynHex("f6bc76", "815519"))
        case .coin: return IdentityColors(mark: dynHex("955964", "eda6b1"), container: dynHex("ffd9de", "843b4a"), onContainer: dynHex("431621", "ffd9de"), chart: dynHex("c07f8a", "cf8b96"), chartPast: dynHex("fcb3be", "874e58"))
        case .elec: return IdentityColors(mark: dynHex("866600", "deb348"), container: dynHex("ffd87f", "684f00"), onContainer: dynHex("3f2e00", "ffdf98"), chart: dynHex("b28b23", "c09830"), chartPast: dynHex("edc155", "775a00"))
        case .gcash: return IdentityColors(mark: dynHex("476e8f", "95bde1"), container: dynHex("cce5ff", "254f6e"), onContainer: dynHex("002840", "cce5ff"), chart: dynHex("6e95b7", "7ba2c5"), chartPast: dynHex("a3cbef", "3a6282"))
        case .maya: return IdentityColors(mark: dynHex("40755b", "8dc5a7"), container: dynHex("b6efd0", "1f553d"), onContainer: dynHex("002c1c", "b6efd0"), chart: dynHex("669c80", "73a98d"), chartPast: dynHex("9bd3b4", "336850"))
        case .rent: return IdentityColors(mark: dynHex("995b42", "f3a789"), container: dynHex("ffdbce", "853e1f"), onContainer: dynHex("441805", "ffdbce"), chart: dynHex("c58064", "d48c70"), chartPast: dynHex("ffb599", "8a4f37"))
        case .water: return IdentityColors(mark: dynHex("357380", "86c2d1"), container: dynHex("b0ecfc", "095360"), onContainer: dynHex("002a32", "b0ecfc"), chart: dynHex("5e99a8", "6ba7b5"), chartPast: dynHex("94d0df", "276674"))
        case .wifi: return IdentityColors(mark: dynHex("666a78", "b5b8c8"), container: dynHex("dfe2f2", "474b58"), onContainer: dynHex("212532", "dfe2f2"), chart: dynHex("8d909f", "9a9dad"), chartPast: dynHex("c3c6d6", "5a5e6c"))
        case .wise: return IdentityColors(mark: dynHex("6d6493", "bdb2e6"), container: dynHex("e6deff", "4e4572"), onContainer: dynHex("271f49", "e6deff"), chart: dynHex("948abb", "a197c9"), chartPast: dynHex("cbc0f4", "615886"))
        }
    }
}

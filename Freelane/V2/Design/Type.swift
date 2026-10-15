import SwiftUI
import CoreText

// Type for v2: Freelane Sans (Google Sans Flex + a matching ₱, OFL) with its axes set explicitly,
// so the Mac renders exactly what the mockups showed. Material Symbols Rounded for icons.

enum FontFiles {
    /// Registers the bundled fonts for this process. Safe to call more than once.
    static let register: Void = {
        for name in ["FreelaneSans", "MaterialSymbolsRounded-Freelane"] {
            let url = Bundle.main.url(forResource: name, withExtension: "ttf")
                ?? Bundle.main.url(forResource: name, withExtension: "ttf", subdirectory: "Fonts")
            guard let url else { continue }
            CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
        }
    }()
}

private func tag(_ s: String) -> Int { s.unicodeScalars.reduce(0) { ($0 << 8) | Int($1.value) } }

/// Builds and caches variable-axis fonts. Every role in the app goes through here.
enum FS {
    private static var cache: [String: Font] = [:]
    private static let lock = NSLock()

    /// Freelane Sans at a size, weight (1–1000) and roundness (0–100). Digits are proportional unless
    /// `tabular` (right-aligned columns only); lining figures always.
    static func font(_ size: CGFloat, _ weight: CGFloat, rond: CGFloat = 40, tabular: Bool = false) -> Font {
        let key = "fs|\(size)|\(weight)|\(rond)|\(tabular)"
        lock.lock(); defer { lock.unlock() }
        if let f = cache[key] { return f }
        _ = FontFiles.register
        let features: [[CFString: Any]] = [
            [kCTFontOpenTypeFeatureTag: (tabular ? "tnum" : "pnum") as CFString, kCTFontOpenTypeFeatureValue: 1],
            [kCTFontOpenTypeFeatureTag: "lnum" as CFString, kCTFontOpenTypeFeatureValue: 1],
        ]
        let attrs: [CFString: Any] = [
            kCTFontNameAttribute: "FreelaneSans-Regular" as CFString,
            kCTFontSizeAttribute: size,
            kCTFontVariationAttribute: [tag("wght"): weight, tag("ROND"): rond, tag("wdth"): 100, tag("opsz"): min(max(size, 6), 144)] as CFDictionary,
            kCTFontFeatureSettingsAttribute: features,
        ]
        let ct = CTFontCreateWithFontDescriptor(CTFontDescriptorCreateWithAttributes(attrs as CFDictionary), size, nil)
        let f = Font(ct)
        cache[key] = f
        return f
    }

    /// Material Symbols Rounded. Optical size follows the drawn size (20 or 24 in practice).
    static func icon(_ size: CGFloat, filled: Bool = false, weight: CGFloat = 400) -> Font {
        let key = "ms|\(size)|\(filled)|\(weight)"
        lock.lock(); defer { lock.unlock() }
        if let f = cache[key] { return f }
        _ = FontFiles.register
        let attrs: [CFString: Any] = [
            kCTFontNameAttribute: "MaterialSymbolsRounded-Regular" as CFString,
            kCTFontSizeAttribute: size,
            kCTFontVariationAttribute: [tag("FILL"): filled ? 1 : 0, tag("wght"): weight, tag("GRAD"): 0, tag("opsz"): min(max(size, 20), 48)] as CFDictionary,
        ]
        let ct = CTFontCreateWithFontDescriptor(CTFontDescriptorCreateWithAttributes(attrs as CFDictionary), size, nil)
        let f = Font(ct)
        cache[key] = f
        return f
    }
}

/// The text roles. One table, used everywhere (sizes in points; line heights via `lineSpacing`).
enum TextRole {
    case page, dialog, pane, heroLabel, summaryLabel, section, sub, rowLarge, row, body, supporting, label, small

    var font: Font {
        switch self {
        case .page:         return FS.font(28, 600, rond: 100)
        case .dialog:       return FS.font(24, 600, rond: 100)
        case .pane:         return FS.font(22, 600, rond: 100)
        case .heroLabel:    return FS.font(22, 600, rond: 60)
        case .summaryLabel: return FS.font(18, 600, rond: 60)
        case .section:      return FS.font(16, 600, rond: 60)
        case .sub:          return FS.font(14, 600, rond: 40)
        case .rowLarge:     return FS.font(16, 600, rond: 40)
        case .row:          return FS.font(15, 600, rond: 40)
        case .body:         return FS.font(14, 400, rond: 40)
        case .supporting:   return FS.font(13, 400, rond: 40)
        case .label:        return FS.font(14, 600, rond: 60)
        case .small:        return FS.font(12, 600, rond: 60)
        }
    }
    var tracking: CGFloat { self == .page ? -0.28 : 0 }
    var lineSpacing: CGFloat {
        switch self {
        case .body, .supporting: return 4
        case .rowLarge: return 4
        default: return 2
        }
    }
}

extension View {
    func role(_ r: TextRole, _ color: Color = MD.onSurface) -> some View {
        font(r.font).tracking(r.tracking).lineSpacing(r.lineSpacing).foregroundStyle(color)
    }
}

/// An icon from the bundled Material Symbols subset.
struct Icon: View {
    let glyph: String
    var size: CGFloat = 24
    var filled = false
    var weight: CGFloat = 400
    init(_ glyph: String, size: CGFloat = 24, filled: Bool = false, weight: CGFloat = 400) {
        self.glyph = glyph; self.size = size; self.filled = filled; self.weight = weight
    }
    var body: some View {
        Text(glyph).font(FS.icon(size, filled: filled, weight: weight))
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}

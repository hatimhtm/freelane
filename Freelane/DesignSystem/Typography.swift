import SwiftUI

/// App type system. Uses Apple's built-in faces — no bundling:
/// `.serif` resolves to **New York** (editorial titles), `.rounded` to SF Pro
/// Rounded (figures), `.default` to SF Pro Text (UI). Distinct, premium, native.
enum Typo {
    // Editorial titles (New York serif)
    static func display(_ size: CGFloat = 32) -> Font { .system(size: size, weight: .bold, design: .serif) }
    static func title(_ size: CGFloat = 22) -> Font { .system(size: size, weight: .semibold, design: .serif) }

    // Figures (SF Pro Rounded, monospaced digits applied at call site)
    static func figure(_ size: CGFloat = 30) -> Font { .system(size: size, weight: .semibold, design: .rounded) }

    // UI text (SF Pro)
    static func body(_ size: CGFloat = 13, _ weight: Font.Weight = .regular) -> Font { .system(size: size, weight: weight) }
    static func label(_ size: CGFloat = 11) -> Font { .system(size: size, weight: .semibold) }
}

extension Text {
    /// Editorial page/hero title. Large sizes get tight optical tracking (Fraunces-like).
    func displayStyle(_ size: CGFloat = 30) -> some View {
        self.font(Typo.display(size))
            .foregroundStyle(Palette.textPrimary)
            .tracking(size >= 26 ? -0.5 : 0.1)
    }
    /// Card / section serif title.
    func titleStyle(_ size: CGFloat = 18) -> some View {
        self.font(Typo.title(size)).foregroundStyle(Palette.textPrimary)
    }
    /// Uppercase tracked metric label.
    func labelStyle() -> some View {
        self.font(Typo.label(11)).textCase(.uppercase).kerning(0.8)
            .foregroundStyle(Palette.textSecondary)
    }
}

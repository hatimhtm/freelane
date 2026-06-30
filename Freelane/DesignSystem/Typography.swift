import SwiftUI

/// App type system. Uses Apple's built-in faces — no bundling:
/// `.default` resolves to **SF Pro** (crisp titles + UI), `.rounded` to SF Pro
/// Rounded (figures). Sharp, modern, native — the Nordic / pro-tool identity
/// (Linear / Things / Arc lean on clean sans, not serif).
enum Typo {
    // Titles (SF Pro Display — clean sans, tightened with negative tracking at the call site)
    static func display(_ size: CGFloat = 32) -> Font { .system(size: size, weight: .bold, design: .default) }
    static func title(_ size: CGFloat = 22) -> Font { .system(size: size, weight: .semibold, design: .default) }

    // Figures (SF Pro Rounded, monospaced digits applied at call site)
    static func figure(_ size: CGFloat = 30) -> Font { .system(size: size, weight: .semibold, design: .rounded) }

    // UI text (SF Pro)
    static func body(_ size: CGFloat = 13, _ weight: Font.Weight = .regular) -> Font { .system(size: size, weight: weight) }
    static func label(_ size: CGFloat = 11) -> Font { .system(size: size, weight: .semibold) }
}

extension Text {
    /// Page/hero title. Large sizes get tight optical tracking for a sharp, condensed feel.
    func displayStyle(_ size: CGFloat = 30) -> some View {
        self.font(Typo.display(size))
            .foregroundStyle(Palette.textPrimary)
            .tracking(size >= 26 ? -0.6 : -0.2)
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

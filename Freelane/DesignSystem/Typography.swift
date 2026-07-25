import SwiftUI

/// App type system — an editorial pairing, using Apple's own faces so nothing is bundled:
/// `.serif` resolves to **New York** (Apple's text serif) and `.default` to **SF Pro**.
///
/// The rule, and it's the whole identity: **serif speaks, sans labels.** Page titles, section
/// headings and hero figures are set in New York — that's what makes the app read like a printed
/// page instead of a dashboard. Everything functional (rows, fields, chips, buttons, captions)
/// stays SF, because that's what macOS controls are drawn in and mixing them there looks amateur.
///
/// (This replaced an all-sans "pro tool" system inherited from the Nordic palette. The app is a
/// journal that happens to do money, not a terminal.)
enum Typo {
    // MARK: Editorial — New York

    /// Page / hero titles. Tighten tracking at the call site via `displayStyle`.
    static func display(_ size: CGFloat = 32) -> Font { .system(size: size, weight: .bold, design: .serif) }
    /// Card + section headings.
    static func title(_ size: CGFloat = 22) -> Font { .system(size: size, weight: .semibold, design: .serif) }
    /// Hero money figures — serif with monospaced digits applied at the call site, so columns of
    /// numbers still align while keeping the editorial voice.
    static func figure(_ size: CGFloat = 30) -> Font { .system(size: size, weight: .semibold, design: .serif) }

    // MARK: Functional — SF Pro

    /// Body + row text.
    static func body(_ size: CGFloat = 13, _ weight: Font.Weight = .regular) -> Font { .system(size: size, weight: weight) }
    /// Small caps-y labels (pair with `.labelStyle()` for the tracking).
    static func label(_ size: CGFloat = 11) -> Font { .system(size: size, weight: .semibold) }
    /// Figures inside dense rows and chips, where a serif would be noise. Tabular by default.
    static func rowFigure(_ size: CGFloat = 13, _ weight: Font.Weight = .semibold) -> Font {
        .system(size: size, weight: weight, design: .rounded)
    }
}

extension Text {
    /// Page/hero title. Large sizes get tight optical tracking — New York opens up as it scales,
    /// so it needs pulling back in to hold together as a masthead.
    func displayStyle(_ size: CGFloat = 30) -> some View {
        self.font(Typo.display(size))
            .foregroundStyle(Palette.textPrimary)
            .tracking(size >= 26 ? -0.4 : -0.15)
    }
    /// Card / section serif title.
    func titleStyle(_ size: CGFloat = 18) -> some View {
        self.font(Typo.title(size)).foregroundStyle(Palette.textPrimary)
    }
    /// Uppercase tracked metric label — the small-caps rule above a figure.
    func labelStyle() -> some View {
        self.font(Typo.label(11)).textCase(.uppercase).kerning(0.8)
            .foregroundStyle(Palette.textSecondary)
    }
}

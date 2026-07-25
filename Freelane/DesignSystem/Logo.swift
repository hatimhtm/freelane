import SwiftUI

/// The Freelane mark: a dark graphite tile with three ascending bars, the tallest in the brand ink.
///
/// The tile colour is FIXED, not palette-driven. It used to resolve from `Palette.ink`, which meant
/// the mark inverted with the theme and turned into a pale, washed-out square in light mode. Real
/// marks don't invert — a logo is a constant, and this one is always dark. Only the accent bar
/// tracks the brand.
struct LogoMark: View {
    var size: CGFloat = 32

    /// Fixed graphite tile — deliberately independent of `Palette`.
    private static let tileTop = Color(.sRGB, red: 0.161, green: 0.169, blue: 0.157, opacity: 1)
    private static let tileBottom = Color(.sRGB, red: 0.075, green: 0.082, blue: 0.075, opacity: 1)
    /// Brand forest, held constant for the same reason.
    private static let markAccent = Color(.sRGB, red: 0.286, green: 0.643, blue: 0.443, opacity: 1)

    var body: some View {
        let tile = RoundedRectangle(cornerRadius: size * 0.28, style: .continuous)
        let region = size * 0.52          // the area the bars occupy, centered in the tile
        let barW = size * 0.155
        let gap = size * 0.095
        return ZStack {
            tile.fill(
                LinearGradient(colors: [Self.tileTop, Self.tileBottom],
                               startPoint: .topLeading, endPoint: .bottomTrailing))
            tile.strokeBorder(Self.markAccent.opacity(0.28), lineWidth: max(0.6, size * 0.02))

            HStack(alignment: .bottom, spacing: gap) {
                bar(w: barW, h: region * 0.46, color: .white.opacity(0.38))
                bar(w: barW, h: region * 0.72, color: .white.opacity(0.72))
                bar(w: barW, h: region * 1.00, color: Self.markAccent, glow: true)
            }
            .frame(width: region, height: region, alignment: .bottom)
        }
        .frame(width: size, height: size)
        .shadow(color: .black.opacity(0.28), radius: size * 0.10, y: size * 0.04)
    }

    private func bar(w: CGFloat, h: CGFloat, color: Color, glow: Bool = false) -> some View {
        RoundedRectangle(cornerRadius: w * 0.42, style: .continuous)
            .fill(color)
            .frame(width: w, height: h)
            .shadow(color: glow ? Self.markAccent.opacity(0.5) : .clear, radius: glow ? size * 0.06 : 0)
    }
}

/// A brief launch moment — the mark settles in over the glass backdrop, then fades.
struct LaunchSplash: View {
    @State private var appear = false
    var body: some View {
        ZStack {
            AppBackground()
            VStack(spacing: 18) {
                LogoMark(size: 104)
                    .scaleEffect(appear ? 1 : 0.86)
                    .opacity(appear ? 1 : 0)
                    .offset(y: appear ? 0 : 8)
                Text("Freelane")
                    .font(Typo.display(36)).foregroundStyle(Palette.textPrimary).tracking(-0.5)
                    .opacity(appear ? 1 : 0)
            }
        }
        .ignoresSafeArea()
        .onAppear { withAnimation(.spring(response: 0.65, dampingFraction: 0.72)) { appear = true } }
    }
}

/// Mark + "Freelane" wordmark in the editorial serif.
struct Wordmark: View {
    var subtitle: String? = "on this Mac"

    var body: some View {
        HStack(spacing: 11) {
            LogoMark(size: 34)
            VStack(alignment: .leading, spacing: 0) {
                Text("Freelane").font(Typo.title(18)).foregroundStyle(Palette.textPrimary)
                if let subtitle {
                    Text(subtitle).font(.system(size: 10)).foregroundStyle(Palette.textTertiary)
                }
            }
        }
    }
}

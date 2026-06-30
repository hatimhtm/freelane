import SwiftUI

/// The Freelane mark: a tile with three ascending bars, the tallest in the signature accent.
/// Tile + bars are driven by the palette so the mark always matches the app's identity (it used
/// to hardcode an espresso-brown tile, which clashed once the palette changed).
struct LogoMark: View {
    var size: CGFloat = 32

    var body: some View {
        let tile = RoundedRectangle(cornerRadius: size * 0.28, style: .continuous)
        let region = size * 0.52          // the area the bars occupy, centered in the tile
        let barW = size * 0.155
        let gap = size * 0.095
        return ZStack {
            tile.fill(
                LinearGradient(colors: [Palette.ink3, Palette.ink],
                               startPoint: .topLeading, endPoint: .bottomTrailing))
            tile.strokeBorder(Palette.acidLime.opacity(0.22), lineWidth: max(0.6, size * 0.02))

            HStack(alignment: .bottom, spacing: gap) {
                bar(w: barW, h: region * 0.46, color: Palette.textSecondary.opacity(0.65))
                bar(w: barW, h: region * 0.72, color: Palette.textPrimary.opacity(0.85))
                bar(w: barW, h: region * 1.00, color: Palette.acidLime, glow: true)
            }
            .frame(width: region, height: region, alignment: .bottom)
        }
        .frame(width: size, height: size)
        .shadow(color: .black.opacity(0.35), radius: size * 0.12, y: size * 0.05)
    }

    private func bar(w: CGFloat, h: CGFloat, color: Color, glow: Bool = false) -> some View {
        RoundedRectangle(cornerRadius: w * 0.42, style: .continuous)
            .fill(color)
            .frame(width: w, height: h)
            .shadow(color: glow ? Palette.acidLime.opacity(0.55) : .clear, radius: glow ? size * 0.06 : 0)
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

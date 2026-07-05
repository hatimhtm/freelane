import SwiftUI
import AppKit

// MARK: - Palette v5 — "Warm Dark + Warm Light" (adaptive)
// One warm identity in two moods. Every color resolves to a LIGHT or DARK variant based on the
// current appearance (see `dyn`), so the WHOLE app flips between cozy warm-charcoal and warm paper
// with zero call-site changes — driven by Settings → Appearance (System / Light / Dark).
// Names are historical labels (`acidLime`, `azure`, `cyan`); the VALUES are the identity.

/// A color that resolves to `light` in a light appearance and `dark` in a dark one. Tuples are
/// sRGB (r, g, b, a). This one function is how the whole app themes both modes from a single block.
private func dyn(_ light: (Double, Double, Double, Double), _ dark: (Double, Double, Double, Double)) -> Color {
    Color(nsColor: NSColor(name: nil) { ap in
        let isDark = ap.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
        let c = isDark ? dark : light
        return NSColor(srgbRed: c.0, green: c.1, blue: c.2, alpha: c.3)
    })
}

enum Palette {
    /// Signature amber — the one warm accent (deepened in light mode for contrast on paper).
    static let acidLime = dyn((0.761, 0.459, 0.122, 1), (0.910, 0.569, 0.235, 1))
    static let azure    = acidLime

    // Feature accents — jewel tones, deepened for light mode so they read on paper.
    static let cyan   = dyn((0.180, 0.533, 0.600, 1), (0.373, 0.718, 0.769, 1))   // teal
    static let indigo = dyn((0.345, 0.322, 0.753, 1), (0.557, 0.545, 0.878, 1))   // periwinkle
    static let violet = dyn((0.588, 0.278, 0.761, 1), (0.773, 0.549, 0.878, 1))   // orchid

    // Money-semantic (mint / coral / amber-yellow)
    static let teal     = dyn((0.180, 0.620, 0.388, 1), (0.373, 0.788, 0.541, 1))
    static let positive = teal
    static let negative = dyn((0.824, 0.255, 0.184, 1), (0.941, 0.408, 0.361, 1))
    static let warning  = dyn((0.761, 0.525, 0.106, 1), (0.949, 0.722, 0.290, 1))

    // Text — deep warm ink on paper / warm cream on charcoal.
    static let textPrimary   = dyn((0.141, 0.114, 0.078, 1), (0.949, 0.925, 0.890, 1))
    static let textSecondary = dyn((0.431, 0.384, 0.322, 1), (0.659, 0.620, 0.565, 1))
    static let textTertiary  = dyn((0.612, 0.561, 0.482, 1), (0.478, 0.439, 0.392, 1))

    // Backdrop glow pools (what the glass lenses against).
    static let coolGlow = dyn((0.910, 0.635, 0.298, 1), (0.910, 0.635, 0.298, 1))   // warm amber glow
    static let warmGlow = dyn((0.804, 0.549, 0.443, 1), (0.690, 0.349, 0.243, 1))   // terracotta

    // Mesh wallpaper stops — warm paper pools in light, warm-charcoal pools in dark.
    static let meshGraphite = dyn((0.953, 0.929, 0.878, 1), (0.102, 0.086, 0.078, 1))
    static let meshCool     = dyn((0.929, 0.890, 0.839, 1), (0.165, 0.102, 0.110, 1))
    static let meshWarm     = dyn((0.965, 0.914, 0.824, 1), (0.180, 0.118, 0.063, 1))
    static let meshLime     = dyn((0.941, 0.918, 0.839, 1), (0.149, 0.118, 0.055, 1))

    // Neutrals — warm paper in light, warm charcoal in dark.
    static let ink   = dyn((0.965, 0.945, 0.906, 1), (0.102, 0.086, 0.078, 1))   // background
    static let ink2  = dyn((0.937, 0.910, 0.855, 1), (0.133, 0.110, 0.094, 1))
    static let ink3  = dyn((0.898, 0.863, 0.800, 1), (0.173, 0.141, 0.118, 1))
    // Content card surface — near-white on paper, raised charcoal in dark (lifts off the bg).
    static let card  = dyn((0.992, 0.984, 0.965, 1), (0.149, 0.125, 0.106, 1))

    // Adaptive surface tones — the replacement for hardcoded `.white.opacity(...)` that assumed a
    // dark background (dark ink on paper, white on charcoal), so hairlines/wells work in both modes.
    static let hairline      = dyn((0.10, 0.09, 0.07, 0.10), (1, 1, 1, 0.08))
    static let wellFill      = dyn((0.10, 0.09, 0.07, 0.04), (1, 1, 1, 0.05))
    static let wellFillHover = dyn((0.10, 0.09, 0.07, 0.07), (1, 1, 1, 0.08))
    static let wellStroke    = dyn((0.10, 0.09, 0.07, 0.12), (1, 1, 1, 0.10))
    static let cardEdge      = dyn((0.16, 0.13, 0.09, 0.13), (1, 1, 1, 0.12))
    // Input fields sit a step above wells so "type here" reads at a glance in both modes.
    static let fieldFill     = dyn((0.10, 0.09, 0.07, 0.06), (1, 1, 1, 0.11))
    static let fieldStroke   = dyn((0.10, 0.09, 0.07, 0.16), (1, 1, 1, 0.16))

    static func accent(for index: Int) -> Color {
        [acidLime, teal, violet, cyan, indigo][index % 5]
    }

    /// Per-section identity accent. Each sidebar area owns a color so Money / People / Life /
    /// Insights are distinguishable at a glance (Phase 1 wires this into the shell + screens).
    enum Section { case overview, money, people, life, insights, settings }
    static func section(_ s: Section) -> Color {
        switch s {
        case .overview:  return azure     // amber — the home temperature
        case .money:     return positive  // mint — it's money
        case .people:    return indigo    // periwinkle
        case .life:      return violet    // orchid
        case .insights:  return cyan      // teal
        case .settings:  return textSecondary
        }
    }
}

// MARK: - Animated backdrop (the "wallpaper" Liquid Glass refracts against)

/// Liquid Glass only looks like glass when there's something luminous and varied
/// behind it. This is our wallpaper: a deep graphite base with slow-drifting light
/// pools (neutral + a couple of jewel tints + one acid-lime signature) so the glass
/// tiles lens and shift like the macOS Tahoe Control Center.
struct AppBackground: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.controlActiveState) private var activeState
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        // 20fps is indistinguishable for drift this slow, and the animation PAUSES whenever
        // this window isn't the active one — so background windows, hidden sheets, and an
        // unfocused app cost ~zero CPU/battery on a MacBook.
        let dark = scheme == .dark
        return TimelineView(.animation(minimumInterval: 1.0 / 20.0, paused: reduceMotion || activeState == .inactive)) { timeline in
            let t = reduceMotion ? 0 : timeline.date.timeIntervalSinceReferenceDate
            ZStack {
                MeshGradient(width: 3, height: 3, points: points(t), colors: meshColors)
                    .ignoresSafeArea()
                // A slow candle-glow pool that drifts across the room — the warmth the glass bends.
                RadialGradient(colors: [Palette.coolGlow.opacity(dark ? 0.05 : 0.08), .clear],
                               center: UnitPoint(x: 0.5 + 0.18 * sin(t * 0.11), y: 0.32 + 0.10 * cos(t * 0.09)),
                               startRadius: 60, endRadius: 560)
                    .ignoresSafeArea()
                // Depth vignette — darkens edges in dark mode; a whisper on paper so it stays bright.
                RadialGradient(colors: [.clear, .black.opacity(dark ? 0.40 : 0.05)],
                               center: .center, startRadius: 340, endRadius: 1100)
                    .ignoresSafeArea()
            }
        }
    }

    // The center stop uses the (adaptive) graphite so the paper mesh never goes black in light mode.
    private var meshColors: [Color] {
        [Palette.meshGraphite, Palette.meshCool,     Palette.meshGraphite,
         Palette.meshWarm,     Palette.meshGraphite, Palette.meshCool,
         Palette.meshGraphite, Palette.meshLime,     Palette.meshGraphite]
    }

    /// 3×3 control grid; corners pinned, interior points drift slowly so the color
    /// field breathes and the glass above it lenses differently as it moves.
    private func points(_ t: Double) -> [SIMD2<Float>] {
        func s(_ p: Double) -> Float { Float(0.10 * sin(t * 0.26 + p)) }
        func c(_ p: Double) -> Float { Float(0.10 * cos(t * 0.22 + p)) }
        return [
            SIMD2(0, 0),            SIMD2(0.5 + s(0), 0),            SIMD2(1, 0),
            SIMD2(0, 0.5 + c(1)),   SIMD2(0.5 + s(2), 0.5 + c(2)),   SIMD2(1, 0.5 + s(3)),
            SIMD2(0, 1),            SIMD2(0.5 + c(4), 1),            SIMD2(1, 1),
        ]
    }
}

// MARK: - Glass surfaces

/// Shared namespace so sibling glass tiles inside a `GlassGroup` can morph/merge.
private struct GlassNamespaceKey: EnvironmentKey { static let defaultValue: Namespace.ID? = nil }
extension EnvironmentValues {
    var glassNamespace: Namespace.ID? {
        get { self[GlassNamespaceKey.self] }
        set { self[GlassNamespaceKey.self] = newValue }
    }
}

/// A plain layout wrapper. It used to wrap cards in `GlassEffectContainer`, but that
/// container FUSES nearby glass tiles (the Tahoe "liquid" merge) — when one tile
/// scaled/hovered, the glass flowed between tiles ("one becomes huge, one shrinks").
/// Now it just renders its content, so every `glassCard` is an independent tile.
struct GlassGroup<Content: View>: View {
    var spacing: CGFloat = 16
    @ViewBuilder var content: () -> Content
    var body: some View { content() }
}

/// The universal surface modifier: real Liquid Glass with `.interactive()` press
/// response, a pointer-tracking specular sheen, a top-edge highlight and depth
/// shadow. Reduce Transparency falls back to a solid fill (system-handled).
struct GlassCardModifier: ViewModifier {
    var cornerRadius: CGFloat
    var tint: Color?
    var elevated: Bool
    var interactive: Bool = false   // accepted for call-site compatibility; no longer used
    var morphID: String? = nil      // (morphing removed — it caused the two-tile flow)

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        // GROUNDED panel — not glass. A solid matte surface (near-white on paper, raised charcoal in
        // dark), a hairline edge, and one soft shadow. Real Liquid Glass is reserved for the floating
        // nav layer (`navGlass`), the way Apple uses it — content cards stay calm and solid.
        return content
            .background {
                ZStack {
                    shape.fill(Palette.card)
                    if let tint { shape.fill(tint.opacity(0.10)) }
                }
            }
            .overlay(shape.strokeBorder(Palette.cardEdge, lineWidth: 0.8))
            .clipShape(shape)
            .shadow(color: .black.opacity(elevated ? 0.18 : 0.10),
                    radius: elevated ? 16 : 8, x: 0, y: elevated ? 6 : 3)
            .contentShape(shape)
    }
}

/// The standard nested row INSIDE a glass pane (list rows, prompt rows, field wells):
/// a quiet inner well with a hairline edge and a hover brighten. One look, everywhere —
/// replaces every hand-rolled `.white.opacity(0.04)` rounded rect.
struct InsetRowModifier: ViewModifier {
    var cornerRadius: CGFloat
    var hoverable: Bool
    @State private var hover = false

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        content
            .background(shape.fill(hoverable && hover ? Palette.wellFillHover : Palette.wellFill))
            .overlay(shape.strokeBorder(Palette.wellStroke, lineWidth: 0.8))
            .contentShape(shape)
            .onHover { hover = $0 }
            .animation(.easeOut(duration: 0.14), value: hover)
    }
}

extension View {
    /// The inner-well row look used inside cards and sheets. `hoverable: false` for static wells.
    func insetRow(cornerRadius: CGFloat = Radii.field, hoverable: Bool = true) -> some View {
        modifier(InsetRowModifier(cornerRadius: cornerRadius, hoverable: hoverable))
    }
    /// Hover feedback for rows in a divider list (transaction lists): a quiet highlight pill that
    /// bleeds a little wider than the content without shifting the list's alignment. Pair with an
    /// `onTapGesture` so the whole row is an affordance, not just the hidden ⋯ menu.
    func hoverRow() -> some View { modifier(HoverRowModifier()) }
}

struct HoverRowModifier: ViewModifier {
    @State private var hover = false
    func body(content: Content) -> some View {
        content
            .padding(.horizontal, 10)
            .background(RoundedRectangle(cornerRadius: Radii.row, style: .continuous)
                .fill(hover ? Palette.wellFillHover : Color.clear))
            .padding(.horizontal, -10)
            .contentShape(Rectangle())
            .onHover { hover = $0 }
            .animation(.easeOut(duration: 0.14), value: hover)
    }
}

extension View {
    /// Every card uses this — the whole app reads as Liquid Glass over the backdrop.
    func glassCard(cornerRadius: CGFloat = Radii.card, tint: Color? = nil, elevated: Bool = false,
                   interactive: Bool = false, morphID: String? = nil) -> some View {
        modifier(GlassCardModifier(cornerRadius: cornerRadius, tint: tint, elevated: elevated,
                                   interactive: interactive, morphID: morphID))
    }

    /// Liquid Glass for the floating navigation/control layer (bell, subtab bar, AI pill).
    func navGlass(cornerRadius: CGFloat = 24, tint: Color? = nil, interactive: Bool = false) -> some View {
        var glass = Glass.regular
        if let tint { glass = glass.tint(tint.opacity(0.22)) }
        // `.interactive()` intentionally NOT applied — it renders a second pointer-tracking
        // glass layer (the "two glass pieces" doubling).
        return self.glassEffect(glass, in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
    }

    /// Subtle 3D specular tilt that tracks the pointer — for hero glass tiles.
    func parallaxTilt(_ amount: Double = 5) -> some View { modifier(ParallaxTilt(amount: amount)) }

    /// Content springs up + fades in when it appears (optionally staggered by `index`).
    /// The app-wide "fluid" entrance; respects Reduce Motion.
    func fluidAppear(_ index: Int = 0) -> some View { modifier(FluidAppear(index: index)) }
}

struct FluidAppear: ViewModifier {
    let index: Int
    @State private var shown = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    func body(content: Content) -> some View {
        content
            .opacity(shown || reduceMotion ? 1 : 0)
            .scaleEffect(shown || reduceMotion ? 1 : 0.975, anchor: .top)
            .offset(y: shown || reduceMotion ? 0 : 12)
            .onAppear {
                guard !shown else { return }
                withAnimation(Motion.appear.delay(Double(index) * 0.045)) { shown = true }
            }
    }
}

/// Concentric radius scale (nested shapes share a center → machined Apple feel).
enum Radii {
    static let row: CGFloat = 10
    static let field: CGFloat = 12
    static let tile: CGFloat = 16
    static let card: CGFloat = 20
    static let sheet: CGFloat = 26
    static let pill: CGFloat = 99
    /// A child inset by `pad` keeps the same visual center as its parent.
    static func inner(_ parent: CGFloat, pad: CGFloat) -> CGFloat { max(4, parent - pad) }
}

/// The spacing scale — one source for gaps and padding so screens stop hand-tuning magic
/// numbers (the v1 audit found 8/12/14/18/20pt scattered everywhere). 4pt rhythm.
enum Spacing {
    static let xxs: CGFloat = 2
    static let xs: CGFloat = 4
    static let s: CGFloat = 8
    static let m: CGFloat = 12
    static let l: CGFloat = 16
    static let xl: CGFloat = 20
    static let xxl: CGFloat = 28
    static let xxxl: CGFloat = 40
}

/// The app's motion vocabulary — a few distinct spring curves instead of one. Heroes are bouncier,
/// lists snappier, modals pop. (Was a single .spring(0.5, 0.82) everywhere.)
enum Motion {
    static let hero  = Animation.spring(response: 0.55, dampingFraction: 0.72)
    static let card  = Animation.spring(response: 0.42, dampingFraction: 0.82)
    static let list  = Animation.spring(response: 0.30, dampingFraction: 0.90)
    static let modal = Animation.spring(response: 0.48, dampingFraction: 0.78)
    static let snappy = Animation.snappy(duration: 0.22)
    /// Content entrance (FluidAppear) — calm rise, no overshoot.
    static let appear = Animation.spring(response: 0.5, dampingFraction: 0.82)
    /// Press feedback on buttons/cards — quick with a little bounce, like a physical key.
    static let press = Animation.spring(response: 0.3, dampingFraction: 0.62)
    /// The single curve for switching pages — used by every nav callsite (sidebar, ⌘K, ⌘F,
    /// deep links, the bell) so navigation feels like one consistent motion, not three.
    static let page  = Animation.spring(response: 0.34, dampingFraction: 0.90)
}

/// Shimmering skeleton placeholder for content that's loading.
struct Shimmer: ViewModifier {
    @State private var x: CGFloat = -1
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    func body(content: Content) -> some View {
        content
            .overlay(
                GeometryReader { geo in
                    LinearGradient(colors: [.clear, Palette.textPrimary.opacity(0.14), .clear], startPoint: .leading, endPoint: .trailing)
                        .frame(width: geo.size.width)
                        .offset(x: x * geo.size.width * 1.5)
                }
                .mask(content)
            )
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.linear(duration: 1.3).repeatForever(autoreverses: false)) { x = 1 }
            }
    }
}
extension View {
    func shimmering() -> some View { modifier(Shimmer()) }
}

struct ParallaxTilt: ViewModifier {
    var amount: Double
    @State private var size: CGSize = .zero
    @State private var rx = 0.0
    @State private var ry = 0.0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            .background(GeometryReader { g in
                Color.clear.onAppear { size = g.size }.onChange(of: g.size) { _, n in size = n }
            })
            .rotation3DEffect(.degrees(rx), axis: (x: 1, y: 0, z: 0), perspective: 0.4)
            .rotation3DEffect(.degrees(ry), axis: (x: 0, y: 1, z: 0), perspective: 0.4)
            .onContinuousHover { phase in
                guard !reduceMotion else { return }
                if case .active(let p) = phase, size.width > 0 {
                    withAnimation(.easeOut(duration: 0.12)) {
                        ry = (Double(p.x / size.width) - 0.5) * amount * 2
                        rx = -(Double(p.y / size.height) - 0.5) * amount * 2
                    }
                } else {
                    withAnimation(.easeOut(duration: 0.3)) { rx = 0; ry = 0 }
                }
            }
    }
}

// MARK: - Typography

extension Text {
    func tileLabel() -> some View {
        self.font(.system(size: 11, weight: .semibold))
            .textCase(.uppercase)
            .kerning(0.7)
            .foregroundStyle(Palette.textSecondary)
    }
    func sectionTitle() -> some View {
        self.font(Typo.title(17)).foregroundStyle(Palette.textPrimary)
    }
}

/// A currency value rendered with a dimmer, smaller symbol and a bold figure.
struct MoneyText: View {
    var amount: Double
    var code: String
    var size: CGFloat = 34
    var color: Color = Palette.textPrimary
    var compact: Bool = true

    var body: some View {
        let sym = CurrencyFormat.symbol(code)
        let num = CurrencyFormat.string(amount, code, compact: compact).replacingOccurrences(of: sym, with: "")
        return HStack(alignment: .firstTextBaseline, spacing: 1) {
            Text(sym).font(.system(size: size * 0.6, weight: .semibold, design: .rounded))
                .foregroundStyle(color.opacity(0.55))
            Text(num).font(.system(size: size, weight: .semibold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(color)
                .contentTransition(.numericText(value: amount))   // digits roll on change
        }
        .lineLimit(1).minimumScaleFactor(0.5)
        .animation(.snappy(duration: 0.45), value: amount)
    }
}

// MARK: - Reusable components

/// A small inline chip: icon + text in an accent pill.
struct MetricChip: View {
    var text: String
    var systemImage: String? = nil
    var color: Color

    var body: some View {
        HStack(spacing: 4) {
            if let systemImage { Image(systemName: systemImage).font(.system(size: 9, weight: .bold)) }
            Text(text).font(.system(size: 11, weight: .semibold))
        }
        .foregroundStyle(color)
        .padding(.horizontal, 8).padding(.vertical, 4)
        .background(color.opacity(0.16), in: Capsule())
        .overlay(Capsule().strokeBorder(color.opacity(0.28), lineWidth: 0.7))
    }
}

/// Gradient-filled icon chip.
struct GlyphChip: View {
    var systemImage: String
    var color: Color
    var size: CGFloat = 34

    var body: some View {
        Image(systemName: systemImage)
            .font(.system(size: size * 0.42, weight: .bold))
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(
                LinearGradient(colors: [color, color.opacity(0.55)],
                               startPoint: .topLeading, endPoint: .bottomTrailing),
                in: RoundedRectangle(cornerRadius: size * 0.32, style: .continuous))
            .shadow(color: color.opacity(0.30), radius: 5, y: 2)
    }
}

/// A compact metric tile.
struct StatTile: View {
    var label: String
    var value: Double
    var code: String
    var systemImage: String
    var accent: Color
    var chip: (text: String, icon: String?)? = nil
    var chipColor: Color = Palette.textTertiary

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                GlyphChip(systemImage: systemImage, color: accent, size: 28)
                Spacer()
                if let chip { MetricChip(text: chip.text, systemImage: chip.icon, color: chipColor) }
            }
            Spacer(minLength: 2)
            Text(label).tileLabel()
            MoneyText(amount: value, code: code, size: 23)
        }
        .padding(14)
        .frame(maxWidth: .infinity, minHeight: 104, alignment: .leading)
        .glassCard(cornerRadius: Radii.tile)
    }
}

/// Big hero metric with a sparkline.
struct HeroTile: View {
    var label: String
    var value: Double
    var code: String
    var accent: Color
    var spark: [Double]
    var chips: [(text: String, icon: String?, color: Color)]

    var body: some View {
        HStack(alignment: .center, spacing: 20) {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 8) {
                    GlyphChip(systemImage: "sparkles", color: accent, size: 30)
                    Text(label).tileLabel()
                }
                MoneyText(amount: value, code: code, size: 42)
                HStack(spacing: 8) {
                    ForEach(Array(chips.enumerated()), id: \.offset) { _, c in
                        MetricChip(text: c.text, systemImage: c.icon, color: c.color)
                    }
                }
            }
            Spacer(minLength: 12)
            Sparkline(values: spark, color: accent)
                .frame(width: 200, height: 66)
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassCard(cornerRadius: Radii.card, tint: accent, elevated: true)
        .parallaxTilt(4)
    }
}

/// Minimal area sparkline.
struct Sparkline: View {
    var values: [Double]
    var color: Color

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width, h = geo.size.height
            let pts = points(in: CGSize(width: w, height: h))
            if pts.count > 1 {
                ZStack {
                    Path { p in
                        p.move(to: CGPoint(x: pts[0].x, y: h))
                        pts.forEach { p.addLine(to: $0) }
                        p.addLine(to: CGPoint(x: pts.last!.x, y: h)); p.closeSubpath()
                    }
                    .fill(LinearGradient(colors: [color.opacity(0.35), .clear], startPoint: .top, endPoint: .bottom))
                    Path { p in p.move(to: pts[0]); pts.dropFirst().forEach { p.addLine(to: $0) } }
                        .stroke(LinearGradient(colors: [color.opacity(0.7), color], startPoint: .leading, endPoint: .trailing),
                                style: StrokeStyle(lineWidth: 2.5, lineCap: .round, lineJoin: .round))
                        .shadow(color: color.opacity(0.6), radius: 6, y: 2)
                    if let last = pts.last {
                        Circle().fill(color).frame(width: 7, height: 7)
                            .shadow(color: color, radius: 5).position(last)
                    }
                }
            }
        }
    }

    private func points(in size: CGSize) -> [CGPoint] {
        guard values.count > 1 else { return [] }
        let lo = values.min() ?? 0, hi = values.max() ?? 1
        let span = max(hi - lo, 1)
        let stepX = size.width / CGFloat(values.count - 1)
        return values.enumerated().map { i, v in
            CGPoint(x: CGFloat(i) * stepX,
                    y: size.height - CGFloat((v - lo) / span) * (size.height - 8) - 4)
        }
    }
}

/// A titled content card.
struct SectionCard<Content: View>: View {
    var title: String
    var subtitle: String? = nil
    var accent: Color = Palette.azure
    var trailing: AnyView? = nil
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                // No per-card colored dot: content cards stay calm and neutral (section identity
                // lives in the sidebar). `accent` is kept for call-site compat + trailing tints.
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).sectionTitle()
                    if let subtitle {
                        Text(subtitle).font(.system(size: 12)).foregroundStyle(Palette.textTertiary)
                    }
                }
                Spacer()
                if let trailing { trailing }
            }
            content()
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassCard(cornerRadius: Radii.card)
    }
}

struct StatusBadge: View {
    var text: String
    var color: Color

    var body: some View {
        Text(text)
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(color)
            .padding(.horizontal, 9).padding(.vertical, 4)
            .background(color.opacity(0.16), in: Capsule())
            .overlay(Capsule().strokeBorder(color.opacity(0.3), lineWidth: 0.7))
    }
}

extension ProjectStatus {
    var color: Color {
        switch self {
        case .paid: return Palette.positive
        case .partiallyPaid: return Palette.warning
        case .unpaid: return Palette.cyan
        case .archived: return Palette.textTertiary
        }
    }
}

// MARK: - Cross-page navigation hook

/// Lets any view jump the sidebar to another feature (tappable widgets, "see all",
/// notification deep-links). Injected once at the root.
private struct NavigateKey: EnvironmentKey {
    static let defaultValue: (Feature) -> Void = { _ in }
}
extension EnvironmentValues {
    var navigate: (Feature) -> Void {
        get { self[NavigateKey.self] }
        set { self[NavigateKey.self] = newValue }
    }
}

/// A dense, glanceable widget tile (Watch-face density). One icon, one label, one
/// value, an optional sub-line — tappable to deep-link. The building block of the
/// LifeOS dashboard grid.
struct MiniWidget: View {
    var label: String
    var value: String
    var systemImage: String
    var accent: Color
    var sub: String? = nil
    var tone: Color? = nil
    var destination: Feature? = nil
    var morphID: String? = nil
    @Environment(\.navigate) private var navigate
    @State private var hover = false

    var body: some View {
        Button { if let d = destination { navigate(d) } } label: {
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Image(systemName: systemImage).font(.system(size: 12, weight: .bold))
                        .foregroundStyle(accent).frame(width: 26, height: 26)
                        .background(accent.opacity(0.16), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    Spacer()
                    if destination != nil {
                        Image(systemName: "chevron.right").font(.system(size: 9, weight: .bold))
                            .foregroundStyle(Palette.textTertiary).opacity(hover ? 1 : 0)
                    }
                }
                Spacer(minLength: 2)
                Text(label).font(.system(size: 10.5, weight: .medium)).foregroundStyle(Palette.textTertiary).lineLimit(1)
                Text(value).font(.system(size: 19, weight: .semibold, design: .rounded))
                    .foregroundStyle(tone ?? Palette.textPrimary).lineLimit(1).minimumScaleFactor(0.55)
                    .contentTransition(.numericText()).animation(.snappy(duration: 0.4), value: value)
                if let sub { Text(sub).font(.system(size: 9.5)).foregroundStyle(Palette.textTertiary).lineLimit(1) }
            }
            .padding(13)
            .frame(maxWidth: .infinity, minHeight: 98, alignment: .leading)
            .glassCard(cornerRadius: Radii.tile, tint: hover && destination != nil ? accent : nil,
                       interactive: destination != nil, morphID: morphID)
        }
        .buttonStyle(.plain)
        .scaleEffect(hover && destination != nil ? 1.012 : 1)   // whole tile lifts as ONE piece
        .animation(.easeOut(duration: 0.16), value: hover)
        .onHover { hover = $0 }
        .disabled(destination == nil)
    }
}

/// Brand identity for wallets/payment methods — accurate brand color + the brand's
/// DOMAIN (so we can load the REAL logo) + a fallback SF Symbol. Matched by brand
/// key first, then fuzzy name. Extend the table to add more brands.
enum Brand {
    struct Info { let color: Color; let symbol: String?; let domain: String? }
    // (needles, brand hex, fallback SF Symbol, domain for the real logo). First match
    // wins — order matters (gcash before cash, coinmama before coin).
    private static let table: [(needles: [String], hex: String, symbol: String?, domain: String?)] = [
        (["wise", "transferwise"],          "#00B9FF", nil, "wise.com"),
        (["gcash"],                          "#0073E6", nil, "gcash.com"),
        (["coinmama"],                       "#FFC42F", nil, "coinmama.com"),
        (["coin_ph", "coins.ph", "coinsph", "coin.ph", "coinph", "coins"], "#FF6B00", nil, "coins.ph"),
        (["paymaya", "maya"],                "#4A2FBD", nil, "maya.ph"),
        (["paypal"],                         "#003087", "p.circle.fill", "paypal.com"),
        (["payoneer"],                       "#FF4800", nil, "payoneer.com"),
        (["revolut"],                        "#0666EB", nil, "revolut.com"),
        (["wells fargo", "wellsfargo"],      "#D71E28", nil, "wellsfargo.com"),
        (["bpi"],                            "#AE1C27", nil, "bpi.com.ph"),
        (["bdo"],                            "#00205B", nil, "bdo.com.ph"),
        (["metrobank", "metro bank"],        "#003DA5", nil, "metrobank.com.ph"),
        (["unionbank", "union bank"],        "#FF6E1B", nil, "unionbankph.com"),
        (["security bank", "securitybank"],  "#00529B", nil, "securitybank.com"),
        (["landbank", "land bank"],          "#006A4D", nil, "landbank.com"),
        (["chinabank", "china bank"],        "#E2231A", nil, "chinabank.ph"),
        (["pnb"],                            "#005BAC", nil, "pnb.com.ph"),
        (["rcbc"],                           "#0C3C7C", nil, "rcbc.com"),
        (["eastwest", "east west"],          "#00558C", nil, "eastwestbanker.com"),
        (["grab"],                           "#00B14F", nil, "grab.com"),
        (["shopee"],                         "#EE4D2D", "bag.fill", "shopee.ph"),
        (["lazada"],                         "#0F146D", "bag.fill", "lazada.com.ph"),
        (["binance"],                        "#F0B90B", "bitcoinsign.circle.fill", "binance.com"),
        (["western union", "westernunion"],  "#FFDD00", nil, "westernunion.com"),
        (["remitly"],                        "#23B16D", nil, "remitly.com"),
        (["skrill"],                         "#862165", nil, "skrill.com"),
        (["usdt", "tether"],                 "#26A17B", "bitcoinsign.circle.fill", "tether.to"),
        (["usdc"],                           "#2775CA", "bitcoinsign.circle.fill", "circle.com"),
        (["btc", "bitcoin"],                 "#F7931A", "bitcoinsign.circle.fill", nil),
        (["eth", "ethereum"],                "#627EEA", "bitcoinsign.circle.fill", nil),
        (["crypto"],                         "#F0B90B", "bitcoinsign.circle.fill", nil),
        (["cfg"],                            "#1B4D2E", "building.columns.fill", nil),
        (["western"],                        "#FFDD00", nil, "westernunion.com"),
        (["cash"],                           "#34B27B", "banknote.fill", nil),
        (["bank", "wire", "savings"],        "#7C8AA5", "building.columns.fill", nil),
    ]
    static func match(_ name: String?) -> Info? {
        guard let n = name?.lowercased(), !n.isEmpty else { return nil }
        for e in table where e.needles.contains(where: { n.contains($0) }) {
            return Info(color: Color(hex: e.hex) ?? Palette.cyan, symbol: e.symbol, domain: e.domain)
        }
        return nil
    }
}

/// Wallet/payment-method icon. Loads the REAL brand logo (from the brand's domain,
/// cached) and falls back to a brand-colored chip when offline / unknown / custom.
struct WalletGlyph: View {
    var wallet: Wallet
    var size: CGFloat = 38

    private var info: Brand.Info? { Brand.match(wallet.brandKey) ?? Brand.match(wallet.name) }
    private var color: Color {
        if let hex = wallet.customBrandColor, let c = Color(hex: hex) { return c }
        return info?.color ?? Palette.accent(for: abs(wallet.name.hashValue))
    }
    private var logoDomain: String? {
        if let g = wallet.customBrandGlyph, !g.isEmpty { return nil }   // user picked a custom glyph
        return info?.domain
    }
    private var glyph: String {
        if let g = wallet.customBrandGlyph, !g.isEmpty { return String(g.prefix(1)) }
        return String(wallet.name.prefix(1)).uppercased()
    }

    var body: some View {
        Group {
            if let d = logoDomain {
                BrandLogoImage(domain: d, size: size) { chip }
            } else { chip }
        }
        .shadow(color: color.opacity(0.45), radius: 7, y: 3)
    }

    private var chip: some View {
        Group {
            if wallet.customBrandGlyph?.isEmpty != false, let sym = info?.symbol {
                Image(systemName: sym).font(.system(size: size * 0.46, weight: .bold))
            } else {
                Text(glyph).font(.system(size: size * 0.42, weight: .bold, design: .rounded))
            }
        }
        .foregroundStyle(.white)
        .frame(width: size, height: size)
        .background(LinearGradient(colors: [color, color.opacity(0.65)],
                                   startPoint: .topLeading, endPoint: .bottomTrailing),
                    in: RoundedRectangle(cornerRadius: size * 0.3, style: .continuous))
    }
}

/// Real brand logos by domain. Two sources: Clearbit returns the brand's ACTUAL high-res
/// artwork (sharp at any tile size); Google's favicon service is the fallback for domains
/// Clearbit doesn't have. Both cached by URLSession's shared cache.
enum BrandLogo {
    /// The brand's likely GLOBAL domain — many favicon services have a bigger logo for
    /// `jollibee.com` than the local `jollibee.com.ph`.
    static func canonical(_ d: String) -> String {
        if d.hasSuffix(".com.ph") { return String(d.dropLast(3)) }          // jollibee.com.ph → jollibee.com
        if d.hasSuffix(".ph") { return String(d.dropLast(3)) + ".com" }     // dito.ph         → dito.com
        return d
    }
    /// Candidate logo URLs across BOTH domain variants and TWO services. The loader fetches
    /// all of them and keeps the highest-resolution one — favicon quality is wildly uneven, so
    /// "first that loads" isn't good enough; we measure and pick the sharpest.
    static func candidates(_ domain: String) -> [URL] {
        let canon = canonical(domain)
        var domains = [canon]; if domain != canon { domains.append(domain) }
        var out: [URL] = []
        for d in domains {
            // Percent-encode the (possibly AI-inferred) domain so odd input can't produce a
            // malformed URL or smuggle extra path/query segments into the request.
            let enc = d.addingPercentEncoding(withAllowedCharacters: .urlHostAllowed) ?? d
            if let u = URL(string: "https://www.google.com/s2/favicons?sz=256&domain=\(enc)") { out.append(u) }
            if let u = URL(string: "https://favicone.com/\(enc)?s=256") { out.append(u) }
        }
        return out
    }
}

/// Back-compat: a single best-guess URL (canonical Google favicon at 256). Real rendering goes
/// through `BrandLogoImage`, which measure-and-picks across sources.
enum WalletLogo {
    static func url(for domain: String, px: Int = 256) -> URL? {
        URL(string: "https://www.google.com/s2/favicons?sz=256&domain=\(BrandLogo.canonical(domain))")
    }
}

/// Fetches all candidate logos for a domain, decodes each, and keeps the one with the largest
/// pixel dimensions — so vendor tiles get the crispest favicon available, not just the first.
/// Cached in memory per domain; resolves instantly on cell reuse.
@MainActor
final class BrandLogoStore {
    static let shared = BrandLogoStore()
    private var cache: [String: NSImage] = [:]
    private var inflight: [String: Task<NSImage?, Never>] = [:]

    func cached(_ domain: String) -> NSImage? { cache[domain] }

    func best(for domain: String) async -> NSImage? {
        if let c = cache[domain] { return c }
        if let t = inflight[domain] { return await t.value }
        let task = Task<NSImage?, Never> { [domain] in
            let urls = BrandLogo.candidates(domain)
            // Fetch concurrently; each task returns (imageData, pixelWidth) — both Sendable.
            let results: [(Data, Int)] = await withTaskGroup(of: (Data, Int)?.self) { group in
                for url in urls {
                    group.addTask {
                        guard let (data, resp) = try? await URLSession.shared.data(from: url),
                              (resp as? HTTPURLResponse)?.statusCode == 200,
                              let rep = NSBitmapImageRep(data: data) else { return nil }
                        return (data, rep.pixelsWide)
                    }
                }
                var acc: [(Data, Int)] = []
                for await r in group { if let r { acc.append(r) } }
                return acc
            }
            // Keep the sharpest that clears a minimum bar; else the biggest available.
            guard let winner = results.max(by: { $0.1 < $1.1 }), let img = NSImage(data: winner.0) else { return nil }
            return img
        }
        inflight[domain] = task
        let img = await task.value
        inflight[domain] = nil
        if let img { cache[domain] = img }
        return img
    }
}

/// A crisp brand-logo tile backed by `BrandLogoStore` (measure-and-pick). Shows the caller's
/// chip until the best logo resolves, then crossfades it in.
struct BrandLogoImage<Fallback: View>: View {
    let domain: String
    let size: CGFloat
    @ViewBuilder var fallback: () -> Fallback
    @State private var img: NSImage?

    var body: some View {
        let r = RoundedRectangle(cornerRadius: size * 0.30, style: .continuous)
        Group {
            if let img {
                Image(nsImage: img).resizable().interpolation(.high).scaledToFit()
                    .padding(size * 0.16).frame(width: size, height: size)
                    .background(.white, in: r)
                    .transition(.opacity)
            } else {
                fallback()
            }
        }
        .task(id: domain) {
            if let c = BrandLogoStore.shared.cached(domain) { img = c; return }
            let best = await BrandLogoStore.shared.best(for: domain)
            withAnimation(.easeOut(duration: 0.2)) { img = best }
        }
    }
}

// MARK: - Color hex helper

extension Color {
    init?(hex: String) {
        var s = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.hasPrefix("#") { s.removeFirst() }
        guard let v = UInt64(s, radix: 16) else { return nil }
        let r, g, b: Double
        switch s.count {
        case 6:
            r = Double((v >> 16) & 0xFF) / 255; g = Double((v >> 8) & 0xFF) / 255; b = Double(v & 0xFF) / 255
        case 3:
            r = Double((v >> 8) & 0xF) / 15; g = Double((v >> 4) & 0xF) / 15; b = Double(v & 0xF) / 15
        default: return nil
        }
        self.init(red: r, green: g, blue: b)
    }
}

// MARK: - Number formatting helper used by displayNumber callers

extension Text {
    func displayNumber() -> some View {
        self.font(.system(size: 32, weight: .semibold, design: .rounded)).monospacedDigit()
            .foregroundStyle(Palette.textPrimary)
    }
}

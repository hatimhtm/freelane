import SwiftUI
import AppKit

// MARK: - Palette v6 — "Editorial: paper & ink" (adaptive, light-first)
// The identity is a well-printed page: warm off-white paper, near-black ink, generous white space,
// and a small set of MUTED inks instead of bright jewel tones. Nothing glows, nothing is muddy.
// Light is the app's default face; dark is a true warm-neutral ink-black (never brown).
//
// Every color resolves to a LIGHT or DARK variant from the current appearance (see `dyn`), so the
// WHOLE app re-skins from this one block — driven by Settings → Appearance (System / Light / Dark).
// Names are historical labels (`acidLime`, `azure`, `cyan`); the VALUES carry the identity.

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
    /// The signature ink — deep forest. The one brand accent: primary buttons, the home section,
    /// selected states. Lifted to a readable sage in dark mode.
    static let acidLime = dyn((0.122, 0.361, 0.239, 1), (0.435, 0.702, 0.545, 1))   // #1F5C3D / #6FB38B
    static let azure    = acidLime

    // Section inks — muted, printerly, clearly distinct from each other without shouting.
    static let cyan   = dyn((0.114, 0.369, 0.388, 1), (0.408, 0.678, 0.698, 1))   // #1D5E63 deep teal
    static let indigo = dyn((0.141, 0.282, 0.431, 1), (0.478, 0.616, 0.804, 1))   // #24486E ink blue
    static let violet = dyn((0.416, 0.227, 0.388, 1), (0.741, 0.541, 0.706, 1))   // #6A3A63 plum

    // Money-semantic — green in, oxblood out, ochre for attention.
    static let teal     = dyn((0.173, 0.431, 0.286, 1), (0.451, 0.729, 0.561, 1))   // #2C6E49
    static let positive = teal
    static let negative = dyn((0.639, 0.227, 0.133, 1), (0.878, 0.443, 0.353, 1))   // #A33A22 oxblood
    static let warning  = dyn((0.690, 0.490, 0.141, 1), (0.859, 0.663, 0.310, 1))   // #B07D24 ochre

    // Text — near-black ink on paper / warm bone on ink-black.
    static let textPrimary   = dyn((0.086, 0.082, 0.059, 1), (0.949, 0.941, 0.914, 1))
    static let textSecondary = dyn((0.420, 0.400, 0.349, 1), (0.659, 0.635, 0.588, 1))
    static let textTertiary  = dyn((0.604, 0.580, 0.525, 1), (0.447, 0.427, 0.384, 1))

    // Backdrop wash pools — a whisper of tone in the paper, never a glow.
    static let coolGlow = dyn((0.122, 0.361, 0.239, 1), (0.435, 0.702, 0.545, 1))
    static let warmGlow = dyn((0.690, 0.490, 0.141, 1), (0.396, 0.302, 0.161, 1))

    // Page wash stops — the faint unevenness of real stock (light) / ink depth (dark).
    static let meshGraphite = dyn((0.929, 0.918, 0.898, 1), (0.071, 0.071, 0.059, 1))
    static let meshCool     = dyn((0.910, 0.910, 0.898, 1), (0.075, 0.086, 0.078, 1))
    static let meshWarm     = dyn((0.925, 0.914, 0.890, 1), (0.090, 0.086, 0.071, 1))
    static let meshLime     = dyn((0.914, 0.922, 0.906, 1), (0.071, 0.082, 0.075, 1))

    // Neutrals — warm GREY in light, warm-neutral ink-black in dark.
    //
    // The light theme was originally paper white (#FBFAF7 ground, pure white cards). On a bright
    // display that is genuinely painful — the verdict was "it almost blinded me" — so the whole
    // light ramp is pulled down about 6%: a warm grey ground with off-white cards, which keeps the
    // editorial feel and the contrast ratios while dropping the glare. Dark is the default face.
    static let ink   = dyn((0.929, 0.918, 0.898, 1), (0.071, 0.071, 0.059, 1))   // #EDEAE5 / #12120F
    static let ink2  = dyn((0.898, 0.886, 0.863, 1), (0.098, 0.094, 0.082, 1))
    static let ink3  = dyn((0.855, 0.843, 0.816, 1), (0.129, 0.122, 0.102, 1))
    // Content card surface — off-white stock lifted just off the grey ground, a raised ink plate in dark.
    static let card  = dyn((0.965, 0.957, 0.941, 1), (0.106, 0.102, 0.086, 1))

    // Adaptive surface tones — the replacement for hardcoded `.white.opacity(...)` that assumed a
    // dark background (dark ink on paper, bone on ink-black), so hairlines/wells work in both modes.
    static let hairline      = dyn((0.09, 0.08, 0.06, 0.11), (1, 1, 0.98, 0.09))
    static let wellFill      = dyn((0.09, 0.08, 0.06, 0.035), (1, 1, 0.98, 0.045))
    static let wellFillHover = dyn((0.09, 0.08, 0.06, 0.065), (1, 1, 0.98, 0.075))
    static let wellStroke    = dyn((0.09, 0.08, 0.06, 0.10), (1, 1, 0.98, 0.09))
    static let cardEdge      = dyn((0.09, 0.08, 0.06, 0.12), (1, 1, 0.98, 0.10))
    // Input fields sit a step above wells so "type here" reads at a glance in both modes.
    static let fieldFill     = dyn((0.09, 0.08, 0.06, 0.05), (1, 1, 0.98, 0.09))
    static let fieldStroke   = dyn((0.09, 0.08, 0.06, 0.15), (1, 1, 0.98, 0.15))

    static func accent(for index: Int) -> Color {
        [acidLime, teal, violet, cyan, indigo][index % 5]
    }

    /// Per-section identity ink. Each sidebar area owns a color so Money / People / Life /
    /// Insights read distinct at a glance without turning the page into a highlighter set.
    enum Section { case overview, money, people, life, insights, settings }
    static func section(_ s: Section) -> Color {
        // Each section needs to be told apart at a glance in the sidebar. Overview and Money both
        // reading green failed that — the brand forest and the money green are neighbours.
        switch s {
        case .overview:  return azure     // forest — the brand, and home
        case .money:     return indigo    // ink blue
        case .people:    return cyan      // deep teal
        case .life:      return violet    // plum
        case .insights:  return warning   // ochre
        case .settings:  return textSecondary
        }
    }
}

// MARK: - The page ground

/// The paper the app is printed on. Deliberately STILL: an editorial page doesn't shimmer.
///
/// This replaced a 3×3 `MeshGradient` that re-rendered at 20fps for the app's entire lifetime to
/// make Liquid Glass lens against something. Content cards are matte panels now, not glass, so the
/// drift bought nothing but heat — and a moving ground is exactly what made the old look feel
/// restless. What's left is what good paper actually has: a barely-there tonal wash, one whisper of
/// the brand ink in the top corner, and a soft edge falloff. No timers, no animation, no redraws.
struct AppBackground: View {
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let dark = scheme == .dark
        ZStack {
            Palette.ink.ignoresSafeArea()
            // Paper stock is never perfectly flat — a faint diagonal wash gives the page a grain
            // of depth without reading as a "gradient background".
            LinearGradient(colors: [Palette.meshWarm.opacity(dark ? 0.9 : 0.7),
                                    Palette.meshGraphite.opacity(0),
                                    Palette.meshCool.opacity(dark ? 0.8 : 0.6)],
                           startPoint: .topLeading, endPoint: .bottomTrailing)
                .ignoresSafeArea()
            // One quiet pool of the brand ink where the eye lands first (top-left, under the title).
            RadialGradient(colors: [Palette.coolGlow.opacity(dark ? 0.05 : 0.035), .clear],
                           center: UnitPoint(x: 0.18, y: 0.04), startRadius: 0, endRadius: 620)
                .ignoresSafeArea()
            // Edge falloff — keeps the eye on the column of content. A whisper on paper.
            RadialGradient(colors: [.clear, .black.opacity(dark ? 0.28 : 0.035)],
                           center: .center, startRadius: 380, endRadius: 1150)
                .ignoresSafeArea()
        }
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
    @Environment(\.colorScheme) private var scheme

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        let dark = scheme == .dark
        // A PRINTED CARD, not glass: white stock on warm paper (a raised ink plate in dark), one
        // hairline rule, and a shadow you can barely name. Real Liquid Glass is reserved for the
        // floating nav layer (`navGlass`), the way Apple uses it.
        //
        // Shadow weight is mode-specific on purpose: the old single value (18%/10% black) was tuned
        // for a dark room and smeared grey halos across the light theme, which is most of what made
        // paper look dirty. On white, depth comes from the rule; in the dark, from the shadow.
        return content
            .background {
                ZStack {
                    shape.fill(Palette.card)
                    if let tint { shape.fill(tint.opacity(dark ? 0.10 : 0.055)) }
                }
            }
            .overlay(shape.strokeBorder(Palette.cardEdge, lineWidth: 0.8))
            .clipShape(shape)
            .shadow(color: .black.opacity(dark ? (elevated ? 0.34 : 0.20) : (elevated ? 0.07 : 0.035)),
                    radius: elevated ? 18 : 9, x: 0, y: elevated ? 7 : 3)
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
            .pointerStyle(hoverable ? .link : .default)
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
            .pointerStyle(.link)
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
        // Hero figures are set in the editorial serif (New York) with monospaced digits, so they
        // read as the headline of the page and still align in columns. Small figures inside dense
        // rows keep SF Rounded — see `Typo.rowFigure` — because serif at 12pt is just noise.
        let serif = size >= 20
        return HStack(alignment: .firstTextBaseline, spacing: serif ? 2 : 1) {
            Text(sym)
                .font(serif ? Typo.figure(size * 0.58) : Typo.rowFigure(size * 0.6))
                .foregroundStyle(color.opacity(0.5))
            Text(num)
                .font(serif ? Typo.figure(size) : Typo.rowFigure(size))
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
                        .shadow(color: color.opacity(0.35), radius: 5, y: 2)
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

/// A titled content card — the app's main structural unit.
///
/// The header is separated from its content by a hairline rule rather than by spacing alone. That
/// single line is most of what distinguishes a considered layout from a stack of boxes: it gives
/// the card an internal structure, so the eye reads *heading, then content* instead of one
/// undifferentiated block of text at four similar sizes.
struct SectionCard<Content: View>: View {
    var title: String
    var subtitle: String? = nil
    var accent: Color = Palette.azure
    var trailing: AnyView? = nil
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                // No per-card coloured dot: content cards stay calm and neutral (section identity
                // lives in the sidebar). `accent` is kept for call-site compat + trailing tints.
                VStack(alignment: .leading, spacing: 3) {
                    Text(title).font(Typo.title(19)).foregroundStyle(Palette.textPrimary)
                    if let subtitle {
                        Text(subtitle).font(.system(size: 11.5))
                            .foregroundStyle(Palette.textTertiary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer(minLength: 0)
                if let trailing { trailing }
            }
            .padding(.horizontal, Spacing.xl)
            .padding(.top, Spacing.l + 2)
            .padding(.bottom, Spacing.m)

            Rectangle().fill(Palette.hairline).frame(height: 1)

            content()
                .padding(.horizontal, Spacing.xl)
                .padding(.top, Spacing.l)
                .padding(.bottom, Spacing.l + 2)
        }
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
            VStack(alignment: .leading, spacing: 0) {
                // Label line. The icon sits INLINE at text size, not inside a tinted rounded
                // square — that motif, repeated across a grid of a dozen tiles, is the single
                // biggest reason a layout like this reads as a template rather than a product.
                HStack(spacing: 5) {
                    Image(systemName: systemImage)
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(accent)
                    Text(label)
                        .font(.system(size: 9.5, weight: .semibold))
                        .textCase(.uppercase).kerning(0.6)
                        .foregroundStyle(Palette.textTertiary)
                        .lineLimit(1)
                    Spacer(minLength: 4)
                    if destination != nil {
                        Image(systemName: "arrow.up.right")
                            .font(.system(size: 8, weight: .bold))
                            .foregroundStyle(Palette.textTertiary)
                            .opacity(hover ? 1 : 0)
                    }
                }

                Spacer(minLength: 8)

                // The value IS the tile. Figures get the editorial serif at a size that dominates
                // everything around it; WORDS don't — a vendor name set in 27pt New York reads as
                // a headline the tile never meant to make ("Lazada" was arriving that way). So a
                // value with no digits in it drops to sans at a size that fits a name.
                let isFigure = value.contains(where: \.isNumber)
                Text(value)
                    .font(isFigure ? Typo.figure(27) : .system(size: 17, weight: .semibold))
                    .monospacedDigit()
                    .foregroundStyle(tone ?? Palette.textPrimary)
                    .lineLimit(1).minimumScaleFactor(0.7)
                    .contentTransition(.numericText())
                    .animation(.snappy(duration: 0.4), value: value)

                if let sub {
                    Text(sub).font(.system(size: 10)).foregroundStyle(Palette.textTertiary)
                        .lineLimit(1).padding(.top, 2)
                }
            }
            .padding(.horizontal, 15).padding(.vertical, 14)
            .frame(maxWidth: .infinity, minHeight: 104, alignment: .leading)
            .glassCard(cornerRadius: Radii.tile, tint: hover && destination != nil ? accent : nil,
                       interactive: destination != nil, morphID: morphID)
        }
        .buttonStyle(.plain)
        .scaleEffect(hover && destination != nil ? 1.012 : 1)   // whole tile lifts as ONE piece
        .animation(.easeOut(duration: 0.16), value: hover)
        .pointerStyle(destination != nil ? .link : .default)
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
        .shadow(color: color.opacity(0.28), radius: 5, y: 2)
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

import SwiftUI

// MARK: - The things that make an interface feel alive
//
// Up to now this app has had layout and typography but no *behaviour*. Every screen arrived fully
// formed, numbers appeared instantly, and nothing responded to the pointer. That reads as a report,
// not a product — the feedback was that it looks like someone cramming as much data onto a page as
// possible, and a large part of that impression is the absence of motion.
//
// These are deliberately restrained: money apps that bounce and sparkle feel untrustworthy. The
// rule is that motion must carry meaning — a figure counts because it's being tallied, a line draws
// because it's being traced, a surface lights because your pointer is over it. Nothing here moves
// for decoration, and everything respects Reduce Motion.

// MARK: Counting figures

/// A number that tallies up to its value the first time it appears, and rolls when it changes.
///
/// The count is eased, not linear — it moves quickly and settles, the way a mechanical counter
/// does. Large values count faster so a six-figure number doesn't take longer than a two-figure one.
struct CountUpMoney: View {
    var amount: Double
    var code: String
    var size: CGFloat
    var color: Color = Palette.textPrimary
    var compact: Bool = true

    @State private var shown: Double = 0
    @State private var hasAppeared = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        MoneyText(amount: shown, code: code, size: size, color: color, compact: compact)
            .onAppear {
                guard !hasAppeared else { return }
                hasAppeared = true
                guard !reduceMotion else { shown = amount; return }
                // A touch under a second: long enough to read as motion, short enough that the
                // number is legible before you've finished looking at it.
                withAnimation(.timingCurve(0.16, 1, 0.3, 1, duration: 0.85)) { shown = amount }
            }
            .onChange(of: amount) { _, new in
                withAnimation(reduceMotion ? nil : .timingCurve(0.16, 1, 0.3, 1, duration: 0.5)) {
                    shown = new
                }
            }
    }
}

// MARK: A line that draws itself

/// The sparkline, but it traces from left to right on appear and carries a soft glow under the
/// stroke. The fill fades in behind it once the line has most of the way across.
struct DrawingSparkline: View {
    var values: [Double]
    var color: Color
    var lineWidth: CGFloat = 2

    @State private var progress: CGFloat = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        GeometryReader { geo in
            let pts = points(in: geo.size)
            if pts.count > 1 {
                ZStack {
                    // Area under the curve — arrives after the line is underway.
                    areaPath(pts, height: geo.size.height)
                        .fill(LinearGradient(colors: [color.opacity(0.22), color.opacity(0.01)],
                                             startPoint: .top, endPoint: .bottom))
                        .opacity(Double(max(0, progress - 0.25)) / 0.75)

                    // The glow sits under the stroke so the line reads as lit rather than outlined.
                    linePath(pts)
                        .trim(from: 0, to: progress)
                        .stroke(color.opacity(0.5), style: StrokeStyle(lineWidth: lineWidth * 3, lineCap: .round, lineJoin: .round))
                        .blur(radius: 7)

                    linePath(pts)
                        .trim(from: 0, to: progress)
                        .stroke(color, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round, lineJoin: .round))

                    // The head of the line, once it's arrived.
                    if let last = pts.last, progress > 0.99 {
                        Circle()
                            .fill(color)
                            .frame(width: lineWidth * 2.6, height: lineWidth * 2.6)
                            .position(last)
                            .shadow(color: color.opacity(0.8), radius: 5)
                            .transition(.scale.combined(with: .opacity))
                    }
                }
            }
        }
        .onAppear {
            guard !reduceMotion else { progress = 1; return }
            withAnimation(.easeOut(duration: 1.1)) { progress = 1 }
        }
    }

    private func points(in size: CGSize) -> [CGPoint] {
        guard values.count > 1 else { return [] }
        let lo = values.min() ?? 0, hi = values.max() ?? 1
        let span = (hi - lo) == 0 ? 1 : (hi - lo)
        let step = size.width / CGFloat(values.count - 1)
        return values.enumerated().map { i, v in
            CGPoint(x: CGFloat(i) * step,
                    y: size.height - CGFloat((v - lo) / span) * size.height)
        }
    }

    /// A smoothed path — straight segments between daily points look like a seismograph.
    private func linePath(_ pts: [CGPoint]) -> Path {
        Path { p in
            p.move(to: pts[0])
            for i in 1..<pts.count {
                let prev = pts[i - 1], cur = pts[i]
                let mid = CGPoint(x: (prev.x + cur.x) / 2, y: (prev.y + cur.y) / 2)
                p.addQuadCurve(to: mid, control: prev)
            }
            p.addLine(to: pts[pts.count - 1])
        }
    }

    private func areaPath(_ pts: [CGPoint], height: CGFloat) -> Path {
        var p = linePath(pts)
        p.addLine(to: CGPoint(x: pts[pts.count - 1].x, y: height))
        p.addLine(to: CGPoint(x: pts[0].x, y: height))
        p.closeSubpath()
        return p
    }
}

// MARK: Surfaces that respond

/// A soft light that follows the pointer across a surface, plus a slight lift.
///
/// This is the one piece of pure atmosphere in the app, and it's here because a large dark panel
/// with nothing happening on it is what makes a screen feel inert. The light is weak (6%) — you
/// notice it as responsiveness rather than as an effect.
struct PointerLight: ViewModifier {
    var tint: Color
    var radius: CGFloat = 320
    var lift: Bool = true

    @State private var location: CGPoint? = nil
    @State private var hovering = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            .overlay {
                GeometryReader { geo in
                    if let loc = location, hovering, !reduceMotion {
                        RadialGradient(colors: [tint.opacity(0.10), .clear],
                                       center: UnitPoint(x: loc.x / max(1, geo.size.width),
                                                         y: loc.y / max(1, geo.size.height)),
                                       startRadius: 0, endRadius: radius)
                            .allowsHitTesting(false)
                            .transition(.opacity)
                    }
                }
            }
            .onContinuousHover { phase in
                switch phase {
                case .active(let p):
                    location = p
                    if !hovering { withAnimation(.easeOut(duration: 0.25)) { hovering = true } }
                case .ended:
                    withAnimation(.easeOut(duration: 0.35)) { hovering = false }
                }
            }
            .scaleEffect(hovering && lift && !reduceMotion ? 1.004 : 1)
            .animation(.easeOut(duration: 0.25), value: hovering)
    }
}

extension View {
    /// Pointer-following light for large surfaces (heroes, feature panels).
    func pointerLight(_ tint: Color = Palette.azure, radius: CGFloat = 320, lift: Bool = true) -> some View {
        modifier(PointerLight(tint: tint, radius: radius, lift: lift))
    }
}

// MARK: Entrances

/// Content that rises and settles as it arrives, staggered by position in a list.
///
/// The existing `fluidAppear` does something similar; this one is tuned for larger blocks — it
/// moves further, takes slightly longer, and doesn't scale, because scaling big type looks cheap.
struct RiseIn: ViewModifier {
    var delay: Double
    @State private var shown = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            .opacity(shown || reduceMotion ? 1 : 0)
            .offset(y: shown || reduceMotion ? 0 : 18)
            .blur(radius: shown || reduceMotion ? 0 : 3)
            .onAppear {
                guard !shown else { return }
                withAnimation(.timingCurve(0.2, 0.9, 0.2, 1, duration: 0.6).delay(delay)) { shown = true }
            }
    }
}

extension View {
    func riseIn(_ index: Int = 0) -> some View { modifier(RiseIn(delay: Double(min(index, 6)) * 0.06)) }
}

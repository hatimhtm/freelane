import SwiftUI

// Arrival motion. Every page builds itself in a quick cascade when you land on it: blocks rise a few
// points and fade in, one after another, bars grow from their baseline, stickers spring in. All of it
// finishes in about a quarter of a second and none of it blocks input. Reduce Motion turns it into
// a plain fade.

private struct AppearModifier: ViewModifier {
    let order: Int
    let dy: CGFloat
    @State private var shown = false
    @Environment(\.accessibilityReduceMotion) private var reduce
    func body(content: Content) -> some View {
        content
            .opacity(shown ? 1 : 0)
            .offset(y: shown || reduce ? 0 : dy)
            .onAppear {
                withAnimation(reduce ? .easeOut(duration: 0.15) : Flow.spatial.delay(Double(min(order, 8)) * 0.04)) { shown = true }
            }
    }
}

private struct GrowModifier: ViewModifier {
    let order: Int
    let axis: Axis
    @State private var grown = false
    @Environment(\.accessibilityReduceMotion) private var reduce
    func body(content: Content) -> some View {
        content
            .scaleEffect(x: axis == .horizontal && !grown && !reduce ? 0.02 : 1,
                         y: axis == .vertical && !grown && !reduce ? 0.02 : 1,
                         anchor: axis == .vertical ? .bottom : .leading)
            .onAppear {
                withAnimation(reduce ? .easeOut(duration: 0.15) : Flow.slow.delay(0.08 + Double(min(order, 14)) * 0.03)) { grown = true }
            }
    }
}

private struct PopModifier: ViewModifier {
    let delay: Double
    @State private var shown = false
    @Environment(\.accessibilityReduceMotion) private var reduce
    func body(content: Content) -> some View {
        content
            .scaleEffect(shown || reduce ? 1 : 0.4)
            .rotationEffect(.degrees(shown || reduce ? 0 : -24))
            .opacity(shown ? 1 : 0)
            .onAppear {
                withAnimation(reduce ? .easeOut(duration: 0.15) : .spring(response: 0.42, dampingFraction: 0.58).delay(delay)) { shown = true }
            }
    }
}

extension View {
    /// Rise and fade in as part of the page's arrival cascade.
    func appear(_ order: Int, dy: CGFloat = 10) -> some View { modifier(AppearModifier(order: order, dy: dy)) }
    /// Grow from the baseline (bars) or the leading edge (horizontal bars).
    func grow(_ order: Int = 0, axis: Axis = .vertical) -> some View { modifier(GrowModifier(order: order, axis: axis)) }
    /// Spring in with a little turn (stickers, celebrations).
    func pop(delay: Double = 0.18) -> some View { modifier(PopModifier(delay: delay)) }
}

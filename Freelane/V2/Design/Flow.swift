import SwiftUI

/// Material 3 Expressive motion, as SwiftUI springs. Spatial springs carry a little bounce for things
/// that move; effect springs never bounce (colour, opacity). All interruptible: a new target re-aims
/// the spring from where the element is, so nothing ever has to finish before you can act again.
enum Flow {
    /// Small components: chips, buttons, badges, the FAB. (M3E fast spatial: stiffness ≈ 800, damping 0.6.)
    static let fast = Animation.spring(response: 0.22, dampingFraction: 0.66)
    /// Panels, cards, list changes. (M3E default spatial: stiffness ≈ 380, damping 0.8.)
    static let spatial = Animation.spring(response: 0.32, dampingFraction: 0.82)
    /// Full-pane and page transitions. (M3E slow spatial: stiffness ≈ 200, damping 0.85.)
    static let slow = Animation.spring(response: 0.42, dampingFraction: 0.86)
    /// Colour and opacity: quick, never bounces.
    static let effects = Animation.spring(response: 0.18, dampingFraction: 1)

    static func pick(_ a: Animation, reduce: Bool) -> Animation { reduce ? .easeOut(duration: 0.12) : a }
}

/// Material state layer: a translucent wash of the content colour on hover (8%) and press (12%),
/// plus a subtle press scale. Responds on press-down, not release.
struct StateLayer: ViewModifier {
    var color: Color = MD.onSurface
    var shape: AnyShape = AnyShape(Capsule())
    var pressed: Bool
    var scales = true
    @State private var hovering = false
    @Environment(\.accessibilityReduceMotion) private var reduce

    func body(content: Content) -> some View {
        content
            .overlay(shape.fill(color.opacity(pressed ? 0.12 : hovering ? 0.08 : 0)).allowsHitTesting(false))
            .scaleEffect(scales && pressed && !reduce ? 0.97 : 1)
            .animation(Flow.effects, value: hovering)
            .animation(Flow.fast, value: pressed)
            .onHover { hovering = $0 }
    }
}

/// Hover/press feedback for any tappable surface (rows, cards) that isn't a Button.
struct PressableRow: ViewModifier {
    var shape: AnyShape
    var action: () -> Void
    @State private var hovering = false
    @State private var pressed = false
    func body(content: Content) -> some View {
        content
            .contentShape(shape)
            .overlay(shape.fill(MD.onSurface.opacity(pressed ? 0.10 : hovering ? 0.05 : 0)).allowsHitTesting(false))
            .animation(Flow.effects, value: hovering)
            .animation(Flow.effects, value: pressed)
            .onHover { hovering = $0 }
            .simultaneousGesture(DragGesture(minimumDistance: 0)
                .onChanged { _ in if !pressed { pressed = true } }
                .onEnded { _ in pressed = false })
            .onTapGesture(perform: action)
    }
}

extension View {
    func pressable(_ shape: some Shape = RoundedRectangle(cornerRadius: 6), action: @escaping () -> Void) -> some View {
        modifier(PressableRow(shape: AnyShape(shape), action: action))
    }
}

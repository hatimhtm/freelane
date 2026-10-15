import SwiftUI

/// Material 3 Expressive shapes as polar curves: round lobes with soft valleys.
/// r(θ) = 1 − a·|sin(nθ/2)|^k, so `n` lobes, `a` valley depth, `k` how round each lobe stays.
struct PolarShape: Shape {
    var lobes: Double, depth: Double, roundness: Double
    func path(in rect: CGRect) -> Path {
        let c = CGPoint(x: rect.midX, y: rect.midY), R = min(rect.width, rect.height) / 2 * 0.98
        var p = Path()
        let steps = 240
        for i in 0...steps {
            let t = Double(i) / Double(steps) * 2 * .pi
            let r = R * (1 - depth * pow(abs(sin(lobes * t / 2)), roundness))
            let pt = CGPoint(x: c.x + r * cos(t - .pi / 2), y: c.y + r * sin(t - .pi / 2))
            i == 0 ? p.move(to: pt) : p.addLine(to: pt)
        }
        p.closeSubpath()
        return p
    }
}

/// A superellipse squircle (GCash's shape).
struct Squircle: Shape {
    var exponent: Double = 4.2
    func path(in rect: CGRect) -> Path {
        let c = CGPoint(x: rect.midX, y: rect.midY), a = min(rect.width, rect.height) / 2 * 0.94
        var p = Path()
        for i in 0...240 {
            let t = Double(i) / 240 * 2 * .pi
            let x = c.x + a * copysign(pow(abs(cos(t)), 2 / exponent), cos(t))
            let y = c.y + a * copysign(pow(abs(sin(t)), 2 / exponent), sin(t))
            i == 0 ? p.move(to: CGPoint(x: x, y: y)) : p.addLine(to: CGPoint(x: x, y: y))
        }
        p.closeSubpath()
        return p
    }
}

enum ExpressiveShape {
    case cookie12, cookie9, cookie6, clover, flower, burst, squircle, circle

    var shape: AnyShape {
        switch self {
        case .cookie12: return AnyShape(PolarShape(lobes: 12, depth: 0.07, roundness: 1.6))
        case .cookie9:  return AnyShape(PolarShape(lobes: 9, depth: 0.085, roundness: 1.6))
        case .cookie6:  return AnyShape(PolarShape(lobes: 6, depth: 0.1, roundness: 1.6))
        case .clover:   return AnyShape(PolarShape(lobes: 4, depth: 0.34, roundness: 3))
        case .flower:   return AnyShape(PolarShape(lobes: 8, depth: 0.16, roundness: 2.4))
        case .burst:    return AnyShape(PolarShape(lobes: 10, depth: 0.12, roundness: 0.9))
        case .squircle: return AnyShape(Squircle())
        case .circle:   return AnyShape(Circle())
        }
    }
}

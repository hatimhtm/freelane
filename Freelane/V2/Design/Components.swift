import SwiftUI

// Core v2 components. Sizes, radii and colours come from the locked design (mockups v3); every page
// composes these instead of styling its own.

// MARK: - Buttons

enum ButtonKind { case filled, tonal, text, plain, danger }

struct M3ButtonStyle: ButtonStyle {
    var kind: ButtonKind = .tonal
    var small = false
    func makeBody(configuration: Configuration) -> some View {
        let (bg, fg): (Color, Color) = {
            switch kind {
            case .filled: return (MD.primary, MD.onPrimary)
            case .tonal: return (MD.secondaryContainer, MD.onSecondaryContainer)
            case .text: return (.clear, MD.primary)
            case .plain: return (.clear, MD.onSurfaceVariant)
            case .danger: return (.clear, MD.error)
            }
        }()
        return configuration.label
            .font(TextRole.label.font)
            .foregroundStyle(fg)
            .padding(.horizontal, kind == .text || kind == .plain || kind == .danger ? 12 : (small ? 16 : 20))
            .frame(height: small ? 36 : 40)
            .background(Capsule().fill(bg))
            .modifier(StateLayer(color: fg, pressed: configuration.isPressed))
            .contentShape(Capsule())
    }
}

/// A labelled button with an optional leading icon.
struct M3Button: View {
    let title: String
    var icon: String? = nil
    var kind: ButtonKind = .tonal
    var small = false
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if let icon { Icon(icon, size: 20) }
                Text(title).lineLimit(1)
            }
        }
        .buttonStyle(M3ButtonStyle(kind: kind, small: small))
        .fixedSize()   // a button's label never wraps
    }
}

/// A 40pt round icon button.
struct IconButton: View {
    let glyph: String
    var help: String = ""
    let action: () -> Void
    var body: some View {
        Button(action: action) { Icon(glyph, size: 24).foregroundStyle(MD.onSurfaceVariant).frame(width: 40, height: 40) }
            .buttonStyle(PlainButtonStyle2())
            .help(help)
    }
}

struct PlainButtonStyle2: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.contentShape(Circle()).modifier(StateLayer(shape: AnyShape(Circle()), pressed: configuration.isPressed))
    }
}

// MARK: - Chips, status labels, count badges

/// Interactive filter chip: 32pt, radius 8.
struct FilterChip: View {
    let title: String
    var selected = false
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if selected { Icon(Sym.check, size: 18).transition(.scale.combined(with: .opacity)) }
                Text(title)
            }
            .font(TextRole.label.font)
            .foregroundStyle(selected ? MD.onSecondaryContainer : MD.onSurfaceVariant)
            .padding(.horizontal, 12).frame(height: 32)
            .background(RoundedRectangle(cornerRadius: 8).fill(selected ? MD.secondaryContainer : .clear))
            .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(selected ? .clear : MD.outlineVariant, lineWidth: 1))
            .modifier(StateLayer(shape: AnyShape(RoundedRectangle(cornerRadius: 8)), pressed: false, scales: false))
            .contentShape(RoundedRectangle(cornerRadius: 8))
        }
        .buttonStyle(.plain)
        .animation(Flow.fast, value: selected)
    }
}

enum StatusTone { case ok, note, quiet }

/// Non-interactive status label: 24pt, radius 8, 12/600.
struct StatusLabel: View {
    let title: String
    var glyph: String? = nil
    var tone: StatusTone = .ok
    var body: some View {
        let (bg, fg): (Color, Color) = {
            switch tone {
            case .ok: return (MD.primaryContainer, MD.onPrimaryContainer)
            case .note: return (MD.tertiaryContainer, MD.onTertiaryContainer)
            case .quiet: return (Surface.well2, MD.onSurfaceVariant)
            }
        }()
        HStack(spacing: 4) {
            if let glyph { Icon(glyph, size: 16, weight: 500) }
            Text(title).font(TextRole.small.font)
        }
        .foregroundStyle(fg)
        .padding(.horizontal, 8).frame(height: 24)
        .background(RoundedRectangle(cornerRadius: 8).fill(bg))
        .fixedSize()
    }
}

/// A small count pill, e.g. next to "Needs you".
struct CountPill: View {
    let count: Int
    var body: some View {
        Text("\(count)").font(TextRole.small.font).monospacedDigit()
            .foregroundStyle(MD.onTertiaryContainer)
            .padding(.horizontal, 7).frame(minWidth: 20, minHeight: 20)
            .background(Capsule().fill(MD.tertiaryContainer))
            .contentTransition(.numericText())
    }
}

// MARK: - Panes and sections

/// A white rounded pane with the standard header row.
struct Pane<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 0) { content }
            .padding(.horizontal, 24).padding(.bottom, 24)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(RoundedRectangle(cornerRadius: 28, style: .continuous).fill(Surface.pane))
            .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
    }
}

/// A pane's scrolling body. It runs into the pane's 24pt foot, and rows fade out there instead of being cut.
struct PaneScroll<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View {
        ScrollView(.vertical, showsIndicators: false) { content }
            .contentMargins(.bottom, 24, for: .scrollContent)
            .mask {
                VStack(spacing: 0) {
                    Color.black
                    LinearGradient(colors: [.black, .black.opacity(0)], startPoint: .top, endPoint: .bottom).frame(height: 24)
                }
            }
            .padding(.bottom, -24)
    }
}

/// The 48pt header row that starts 20pt from the top of every pane.
struct PaneHeader<Trailing: View>: View {
    let title: String
    var subtitle: String? = nil
    var big = true
    @ViewBuilder var trailing: Trailing
    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            Text(title).role(big ? .page : .pane)
            if let subtitle { Text(subtitle).role(.body, MD.onSurfaceVariant).padding(.top, 6) }
            Spacer(minLength: 12)
            trailing
        }
        .frame(height: 48)
        .padding(.top, 20)
    }
}

extension PaneHeader where Trailing == EmptyView {
    init(title: String, subtitle: String? = nil, big: Bool = true) {
        self.init(title: title, subtitle: subtitle, big: big) { EmptyView() }
    }
}

/// Section header: 24 above, 8 below.
struct SectionHeader<Trailing: View>: View {
    let title: String
    var count: Int? = nil
    var small = false
    @ViewBuilder var trailing: Trailing
    var body: some View {
        HStack(spacing: 8) {
            Text(title).role(small ? .sub : .section, small ? MD.onSurface : MD.onSurface)
            if let count, count > 0 { CountPill(count: count) }
            Spacer(minLength: 8)
            trailing
        }
        .padding(.horizontal, 4)
        .padding(.top, 24).padding(.bottom, 8)
    }
}

extension SectionHeader where Trailing == EmptyView {
    init(title: String, count: Int? = nil, small: Bool = false) {
        self.init(title: title, count: count, small: small) { EmptyView() }
    }
}

/// Segmented list: items 3pt apart, outer corners 20, inner corners 6.
struct Segmented<Data: RandomAccessCollection, Row: View>: View where Data.Element: Identifiable {
    let items: Data
    var selected: Data.Element.ID? = nil
    @ViewBuilder var row: (Data.Element) -> Row
    var body: some View {
        VStack(spacing: 3) {
            ForEach(Array(items.enumerated()), id: \.element.id) { i, item in
                let first = i == 0, last = i == items.count - 1
                row(item)
                    .background(UnevenRoundedRectangle(topLeadingRadius: first ? 20 : 6, bottomLeadingRadius: last ? 20 : 6,
                                                       bottomTrailingRadius: last ? 20 : 6, topTrailingRadius: first ? 20 : 6, style: .continuous)
                        .fill(item.id == selected ? MD.secondaryContainer : Surface.well))
                    .clipShape(UnevenRoundedRectangle(topLeadingRadius: first ? 20 : 6, bottomLeadingRadius: last ? 20 : 6,
                                                      bottomTrailingRadius: last ? 20 : 6, topTrailingRadius: first ? 20 : 6, style: .continuous))
            }
        }
        .animation(Flow.spatial, value: items.count)
    }
}

// MARK: - Rows

/// A transaction or summary row: badge, title + supporting line, trailing value.
struct ListRow<Trailing: View>: View {
    let badge: Badge?
    let title: String
    var subtitle: String? = nil
    var height: CGFloat = 60
    var large = false
    @ViewBuilder var trailing: Trailing
    var body: some View {
        HStack(spacing: 14) {
            if let badge { badge }
            VStack(alignment: .leading, spacing: 1) {
                Text(title).role(large ? .rowLarge : .row).lineLimit(1)
                if let subtitle { Text(subtitle).role(.supporting, MD.onSurfaceVariant).lineLimit(large ? 2 : 1) }
            }
            Spacer(minLength: 8)
            trailing
        }
        .padding(.leading, 12).padding(.trailing, 16)
        .frame(minHeight: height)
        .padding(.vertical, large ? 12 : 0)
    }
}

/// A key–value fact row with a hairline divider (44pt).
struct FactRow: View {
    let label: String
    let value: String
    var body: some View {
        HStack {
            Text(label).role(.supporting, MD.onSurfaceVariant)
            Spacer(minLength: 16)
            Text(value).role(.body).multilineTextAlignment(.trailing)
        }
        .padding(.horizontal, 4)
        .frame(height: 44)
        .overlay(alignment: .bottom) { Rectangle().fill(Surface.hairline).frame(height: 1) }
    }
}

// MARK: - Hero, bands, sticker

/// The tinted band at the top of a tab (and the larger hero on Now).
struct Band<Content: View>: View {
    var hero = false
    @ViewBuilder var content: Content
    var body: some View {
        content
            .padding(.horizontal, hero ? 28 : 24).padding(.top, hero ? 24 : 20).padding(.bottom, 20)
            .frame(maxWidth: .infinity, alignment: .leading)
            .foregroundStyle(MD.onPrimaryContainer)
            .background(RoundedRectangle(cornerRadius: hero ? 28 : 24, style: .continuous).fill(MD.primaryContainer))
    }
}

/// A burst sticker, shown only when there's something to celebrate.
struct Sticker: View {
    let glyph: String
    let text: String
    var size: CGFloat = 132
    var body: some View {
        ZStack {
            ExpressiveShape.burst.shape.fill(Surface.sticker)
            // The words stay inside the burst's inner circle, clear of its rounded points.
            VStack(spacing: 2) {
                Icon(glyph, size: 24, filled: true, weight: 500)
                Text(text).font(FS.font(15, 600, rond: 100)).multilineTextAlignment(.center)
                    .lineLimit(2).minimumScaleFactor(0.7)
            }
            .foregroundStyle(Surface.onSticker)
            .padding(.horizontal, size * 0.17).padding(.vertical, size * 0.12)
        }
        .frame(width: size, height: size)
        .accessibilityElement(children: .combine)
    }
}

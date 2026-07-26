import SwiftUI

// MARK: - The ledger vocabulary
//
// Every list of money in this app — payments, withdrawals, spends, loans, sadaka, bills — is a
// ledger, and a ledger has one job: let you run your eye down a column of figures. These are the
// shared pieces that make that possible, so the screens stop each inventing their own row.
//
// Two things were wrong everywhere, and they're worth naming because they're the difference
// between "app" and "template":
//
//  1. **A filled colour circle in front of every row.** 34pt, 18%-opacity fill, bold glyph inside,
//     repeated down the whole page. It draws the eye to the least informative thing in the row and
//     turns a ledger into a list of badges. Direction is already carried by the sign and the colour
//     of the amount — the circle was saying it a third time, loudest.
//
//  2. **The amount set at 13pt, the same size as the label.** In a ledger the figure is the
//     content; everything else is annotation. It now leads, in tabular figures so the column
//     actually aligns.

/// The directional mark at the head of a ledger row: a hairline rule in the semantic colour.
///
/// Deliberately not an icon. At a glance you read the colour and position, not a glyph — and a
/// column of thin marks is quiet in a way a column of filled circles can never be.
struct LedgerMark: View {
    var tone: Color
    var body: some View {
        RoundedRectangle(cornerRadius: 1.5, style: .continuous)
            .fill(tone)
            .frame(width: 3, height: 26)
            .opacity(0.85)
    }
}

/// The figure at the end of a ledger row, with an optional annotation beneath it (a fee, a balance,
/// a conversion). Tabular so columns line up down the page.
struct LedgerAmount: View {
    var amount: String
    var tone: Color = Palette.textPrimary
    var note: String? = nil
    var noteTone: Color = Palette.textTertiary

    var body: some View {
        VStack(alignment: .trailing, spacing: 1) {
            Text(amount)
                .font(Typo.rowFigure(15))
                .monospacedDigit()
                .foregroundStyle(tone)
                .lineLimit(1).minimumScaleFactor(0.75)
            if let note {
                Text(note)
                    .font(.system(size: 10))
                    .monospacedDigit()
                    .foregroundStyle(noteTone)
                    .lineLimit(1)
            }
        }
    }
}

/// Title + one line of context. The pairing used on the left of every ledger row.
struct LedgerLabel: View {
    var title: String
    var meta: String?
    var titleTone: Color = Palette.textPrimary

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.system(size: 13.5, weight: .medium))
                .foregroundStyle(titleTone)
                .lineLimit(1).truncationMode(.tail)
            if let meta, !meta.isEmpty {
                Text(meta)
                    .font(.system(size: 11))
                    .foregroundStyle(Palette.textTertiary)
                    .lineLimit(1).truncationMode(.tail)
            }
        }
    }
}

/// The ⋯ menu that ends an editable row. Hidden until the row is hovered, because a column of
/// permanent ellipses is visual noise on a page whose job is to show numbers.
struct RowMenu<Content: View>: View {
    var hovering: Bool
    var help: String
    @ViewBuilder var content: () -> Content

    var body: some View {
        Menu { content() } label: {
            Image(systemName: "ellipsis")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Palette.textTertiary)
                .frame(width: 24, height: 24)
                .contentShape(Rectangle())
        }
        .menuStyle(.borderlessButton)
        .menuIndicator(.hidden)
        .frame(width: 24)
        .opacity(hovering ? 1 : 0)
        .help(help)
    }
}

/// A complete ledger row: mark, label, figure, and a hover-revealed menu.
///
/// Screens that need something unusual can still assemble the pieces themselves; this is the
/// default so that the common case is identical everywhere without being copy-pasted.
struct LedgerRow<Menu: View>: View {
    var tone: Color
    var title: String
    var meta: String?
    var amount: String
    var amountTone: Color?
    var note: String? = nil
    var noteTone: Color = Palette.textTertiary
    var onTap: () -> Void
    @ViewBuilder var menu: () -> Menu

    @State private var hovering = false

    var body: some View {
        HStack(spacing: 12) {
            LedgerMark(tone: tone)
            LedgerLabel(title: title, meta: meta)
            Spacer(minLength: 10)
            LedgerAmount(amount: amount, tone: amountTone ?? Palette.textPrimary,
                         note: note, noteTone: noteTone)
            RowMenu(hovering: hovering, help: "Edit or delete", content: menu)
        }
        .padding(.vertical, 10)
        .hoverRow()
        .onHover { hovering = $0 }
        .animation(.easeOut(duration: 0.12), value: hovering)
        .contentShape(Rectangle())
        .onTapGesture(perform: onTap)
    }
}

// MARK: - The figure rail

/// A column of numbers, set as a table rather than as tiles.
///
/// This replaced a grid of ten equal-weight tiles on the Dashboard. Ten boxes of the same size and
/// colour is not a summary — nothing leads, so the eye has to read all ten to find the one it
/// wanted, and on a wide window they sprawl across the page. A rail is how a financial page has
/// always solved this: labels left, figures right, hairlines between, scanned top to bottom in one
/// movement. It also costs a third of the width, which is what makes room for a real lead column
/// beside it.
struct FigureRail: View {
    struct Item: Identifiable {
        let id: String
        var label: String
        var value: String
        var sub: String? = nil
        var tone: Color? = nil
        var destination: Feature? = nil
    }

    var title: String
    var items: [Item]
    @Environment(\.navigate) private var navigate

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(title)
                .font(.system(size: 9.5, weight: .semibold))
                .textCase(.uppercase).kerning(1.0)
                .foregroundStyle(Palette.textTertiary)
                .padding(.horizontal, 16).padding(.top, 15).padding(.bottom, 11)

            ForEach(Array(items.enumerated()), id: \.element.id) { i, item in
                if i > 0 { Rectangle().fill(Palette.hairline).frame(height: 1).padding(.horizontal, 16) }
                RailRow(item: item, onTap: { if let d = item.destination { navigate(d) } })
                    .riseIn(i)
            }
        }
        .padding(.bottom, 6)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassCard(cornerRadius: Radii.card)
    }
}

private struct RailRow: View {
    let item: FigureRail.Item
    let onTap: () -> Void
    @State private var hovering = false

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            VStack(alignment: .leading, spacing: 1) {
                Text(item.label)
                    .font(.system(size: 12))
                    .foregroundStyle(Palette.textSecondary)
                    .lineLimit(1)
                if let sub = item.sub {
                    Text(sub).font(.system(size: 10)).foregroundStyle(Palette.textTertiary).lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            HStack(spacing: 6) {
                Text(item.value)
                    .font(Typo.figure(17))
                    .monospacedDigit()
                    .foregroundStyle(item.tone ?? Palette.textPrimary)
                    .lineLimit(1).minimumScaleFactor(0.7)
                    .contentTransition(.numericText())
                if item.destination != nil {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(Palette.textTertiary)
                        .opacity(hovering ? 1 : 0)
                        .offset(x: hovering ? 0 : -4)
                }
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 9)
        .background(hovering && item.destination != nil ? Palette.wellFill : .clear)
        .contentShape(Rectangle())
        .onHover { hovering = $0 }
        .pointerStyle(item.destination != nil ? .link : .default)
        .onTapGesture { onTap() }
        .animation(.easeOut(duration: 0.12), value: hovering)
    }
}

// MARK: - The lead figure

/// The number a page is about, given the room to actually land.
///
/// This is the app's one moment of theatre and it's deliberate. The previous version put the
/// balance in a 52pt figure inside a flat panel with a static line under it, which is a report
/// header. Now: the figure counts up as it arrives, the line traces itself left to right and keeps
/// a soft glow, the panel carries a gradient that suggests light falling across it, and a pointer
/// light follows your cursor. None of it is decoration — it's the difference between a page that
/// has loaded and a page that is *yours*.
struct LeadFigure: View {
    var label: String
    var amount: Double
    var code: String
    var context: [String]
    var spark: [Double]
    var accent: Color = Palette.azure

    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let dark = scheme == .dark
        ZStack(alignment: .topLeading) {
            // The line lives BEHIND the figure and bleeds to the panel's edges, so the number sits
            // in the data rather than on top of a chart in a box.
            if spark.count > 1 {
                DrawingSparkline(values: spark, color: accent, lineWidth: 2.2)
                    .frame(height: 118)
                    .opacity(dark ? 0.55 : 0.40)
                    .padding(.bottom, 18)          // never let the trace touch the panel edge
                    .frame(maxHeight: .infinity, alignment: .bottom)
                    .allowsHitTesting(false)
            }

            VStack(alignment: .leading, spacing: 0) {
                Text(label)
                    .font(.system(size: 9.5, weight: .semibold))
                    .textCase(.uppercase).kerning(1.2)
                    .foregroundStyle(Palette.textTertiary)

                CountUpMoney(amount: amount, code: code, size: 60, color: Palette.textPrimary)
                    .padding(.top, 8)

                if !context.isEmpty {
                    HStack(spacing: 0) {
                        ForEach(Array(context.enumerated()), id: \.offset) { i, bit in
                            if i > 0 {
                                Circle().fill(Palette.textTertiary.opacity(0.5))
                                    .frame(width: 2.5, height: 2.5)
                                    .padding(.horizontal, 9)
                            }
                            Text(bit)
                                .font(.system(size: 12))
                                .foregroundStyle(Palette.textSecondary)
                        }
                    }
                    .padding(.top, 10)
                }
            }
            .padding(.horizontal, 24).padding(.top, 22).padding(.bottom, 26)
        }
        // Only reserve chart height when there IS a chart — Loans and Wallets pass no series, and
        // the panel was holding 208pt open for a line that never arrives.
        .frame(maxWidth: .infinity, minHeight: spark.count > 1 ? 208 : 132, alignment: .topLeading)
        .background {
            let shape = RoundedRectangle(cornerRadius: Radii.card, style: .continuous)
            ZStack {
                shape.fill(Palette.card)
                // Light falling from the top-left corner — what stops a large dark panel from
                // reading as a flat rectangle.
                shape.fill(
                    LinearGradient(
                        colors: dark
                            ? [accent.opacity(0.13), .clear, .black.opacity(0.16)]
                            : [accent.opacity(0.07), .clear, .black.opacity(0.02)],
                        startPoint: .topLeading, endPoint: .bottomTrailing))
            }
        }
        .overlay(
            RoundedRectangle(cornerRadius: Radii.card, style: .continuous)
                .strokeBorder(
                    LinearGradient(colors: [Palette.cardEdge, accent.opacity(dark ? 0.22 : 0.14)],
                                   startPoint: .topLeading, endPoint: .bottomTrailing),
                    lineWidth: 0.9))
        .clipShape(RoundedRectangle(cornerRadius: Radii.card, style: .continuous))
        .shadow(color: .black.opacity(dark ? 0.36 : 0.07), radius: 22, y: 9)
        .pointerLight(accent, radius: 380)
    }
}

// MARK: - Signal cards

/// A figure card whose BACKGROUND carries the verdict.
///
/// The rail this sits beside is better for dense comparison — labels aligned, figures in one
/// column — but it makes every number look equally fine, because a tinted row would be noise at
/// that density. A card can afford a tinted ground, and that ground does the work: green means
/// this is healthy, red means it needs you, neutral means it's just a fact. You skim the colours
/// and only read the ones that aren't grey.
struct SignalCard: View {
    enum Mood { case good, bad, neutral }

    var label: String
    var value: String
    var sub: String?
    var mood: Mood
    var icon: String
    var destination: Feature?

    @Environment(\.navigate) private var navigate
    @Environment(\.colorScheme) private var scheme
    @State private var hovering = false

    private var tone: Color {
        switch mood {
        case .good:    return Palette.positive
        case .bad:     return Palette.negative
        case .neutral: return Palette.textSecondary
        }
    }

    /// Deliberately weak — 9% in dark, 12% on the light ground. Strong enough to sort at a glance,
    /// far short of the saturated blocks that make a money app feel like a game.
    private var fill: Color {
        let dark = scheme == .dark
        switch mood {
        case .neutral: return Palette.card
        default:       return tone.opacity(dark ? 0.09 : 0.12)
        }
    }

    var body: some View {
        Button { if let d = destination { navigate(d) } } label: {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 5) {
                    Image(systemName: icon)
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(mood == .neutral ? Palette.textTertiary : tone)
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
                            .opacity(hovering ? 1 : 0)
                    }
                }

                Spacer(minLength: 8)

                let isFigure = value.contains(where: \.isNumber)
                Text(value)
                    .font(isFigure ? Typo.figure(26) : .system(size: 16, weight: .semibold))
                    .monospacedDigit()
                    .foregroundStyle(mood == .neutral ? Palette.textPrimary : tone)
                    .lineLimit(1).minimumScaleFactor(0.65)
                    .contentTransition(.numericText())

                if let sub {
                    Text(sub).font(.system(size: 10)).foregroundStyle(Palette.textTertiary)
                        .lineLimit(1).padding(.top, 2)
                }
            }
            .padding(.horizontal, 15).padding(.vertical, 14)
            .frame(maxWidth: .infinity, minHeight: 108, alignment: .leading)
            .background {
                let shape = RoundedRectangle(cornerRadius: Radii.tile, style: .continuous)
                ZStack {
                    shape.fill(Palette.card)
                    shape.fill(fill)
                }
            }
            .overlay(
                RoundedRectangle(cornerRadius: Radii.tile, style: .continuous)
                    .strokeBorder(mood == .neutral ? Palette.cardEdge : tone.opacity(0.28), lineWidth: 0.9))
            .shadow(color: .black.opacity(scheme == .dark ? 0.22 : 0.05),
                    radius: hovering ? 12 : 8, y: hovering ? 4 : 3)
        }
        .buttonStyle(.plain)
        .scaleEffect(hovering && destination != nil ? 1.012 : 1)
        .pointerStyle(destination != nil ? .link : .default)
        .onHover { hovering = $0 }
        .animation(.easeOut(duration: 0.16), value: hovering)
        .disabled(destination == nil)
    }
}

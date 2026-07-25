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

import SwiftUI

// The v2 dialog and its fields: a white card over a light scrim, outlined fields with floating labels,
// chips for choices. Every form (spending, money in, moves, bills, wallets, counting) is built from these.

struct M3Dialog<Content: View, Actions: View>: View {
    let title: String
    var subtitle: String? = nil
    var width: CGFloat = 560
    let onClose: () -> Void
    @ViewBuilder var content: Content
    @ViewBuilder var actions: Actions

    var body: some View {
        ZStack {
            Color.black.opacity(0.20).ignoresSafeArea().onTapGesture(perform: onClose)
            VStack(alignment: .leading, spacing: 0) {
                Text(title).role(.dialog)
                if let subtitle { Text(subtitle).role(.body, MD.onSurfaceVariant).padding(.top, 6).fixedSize(horizontal: false, vertical: true) }
                VStack(alignment: .leading, spacing: 18) { content }.padding(.top, 20)
                HStack(spacing: 8) { Spacer(); actions }.padding(.top, 24)
            }
            .padding(24)
            .frame(width: width)
            .background(RoundedRectangle(cornerRadius: 28, style: .continuous).fill(Surface.dialog))
            .shadow(color: .black.opacity(0.14), radius: 12, y: 8)
            .shadow(color: .black.opacity(0.16), radius: 30, y: 24)
            .onExitCommand(perform: onClose)
        }
    }
}

/// An outlined text field with a floating label.
struct OutlinedField: View {
    let label: String
    @Binding var text: String
    var prompt = ""
    var numeric = false
    var focused: FocusState<String?>.Binding
    let id: String
    var leading: AnyView? = nil

    var body: some View {
        let on = focused.wrappedValue == id
        HStack(spacing: 0) {
            if let leading { leading }
            TextField(prompt, text: $text)
                .textFieldStyle(.plain)
                .multilineTextAlignment(numeric ? .trailing : .leading)
                .font(numeric ? FS.font(18, 500, rond: 100, tabular: true) : FS.font(15, 400))
                .foregroundStyle(MD.onSurface)
                .focused(focused, equals: id)
                .padding(.leading, leading == nil ? 0 : 10)
        }
        .padding(.leading, leading == nil ? 14 : 7).padding(.trailing, 14)
        .frame(height: 52)
        .background(RoundedRectangle(cornerRadius: 12).fill(Surface.dialog))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(on ? MD.primary : MD.outline, lineWidth: on ? 2 : 1))
        .overlay(alignment: .topLeading) {
            Text(label).font(FS.font(12, 600, rond: 60)).foregroundStyle(on ? MD.primary : MD.onSurfaceVariant)
                .padding(.horizontal, 4).background(Surface.dialog).offset(x: 10, y: -8)
        }
        .animation(Flow.effects, value: on)
        .contentShape(Rectangle())
        .onTapGesture { focused.wrappedValue = id }
    }
}

/// A currency menu chip for money fields.
struct CurrencyChip: View {
    @Binding var currency: String
    var body: some View {
        Menu {
            ForEach(CurrencyFormat.supported, id: \.self) { c in Button(c) { currency = c } }
        } label: {
            HStack(spacing: 1) {
                Text(currency).font(FS.font(12, 600, rond: 60)).tracking(0.3)
                Icon(Sym.expandMore, size: 18)
            }
            .foregroundStyle(MD.onSecondaryContainer)
            .padding(.leading, 10).padding(.trailing, 4).frame(height: 32)
            .background(RoundedRectangle(cornerRadius: 8).fill(MD.secondaryContainer))
        }
        .menuStyle(.button).buttonStyle(.plain).menuIndicator(.hidden).fixedSize()
    }
}

/// A single-choice row of chips. Each chip can carry a badge.
struct ChoiceChips<Item: Hashable>: View {
    let items: [Item]
    @Binding var selection: Item?
    let title: (Item) -> String
    var badge: ((Item) -> BadgeSubject?)? = nil

    var body: some View {
        ChipFlow(spacing: 8) {
            ForEach(items, id: \.self) { item in
                let on = selection == item
                Button { withAnimation(Flow.fast) { selection = item } } label: {
                    HStack(spacing: 8) {
                        if let b = badge?(item) { Badge(subject: b, size: 24) }
                        else if on { Icon(Sym.check, size: 18) }
                        Text(title(item)).font(FS.font(14, 600, rond: 60))
                    }
                    .foregroundStyle(on ? MD.onSecondaryContainer : MD.onSurface)
                    .padding(.leading, badge == nil ? 12 : 6).padding(.trailing, 12).frame(height: 36)
                    .background(RoundedRectangle(cornerRadius: 10).fill(on ? MD.secondaryContainer : Surface.dialog))
                    .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(on ? .clear : MD.outlineVariant, lineWidth: 1))
                    .contentShape(RoundedRectangle(cornerRadius: 10))
                }
                .buttonStyle(.plain)
            }
        }
    }
}

/// Today / Yesterday / a picked day.
struct DayChoice: View {
    @Binding var date: Date
    var body: some View {
        let cal = PHT.calendar
        let today = cal.startOfDay(for: .now), yesterday = cal.date(byAdding: .day, value: -1, to: today)!
        let isToday = cal.isDate(date, inSameDayAs: today), isYesterday = cal.isDate(date, inSameDayAs: yesterday)
        HStack(spacing: 8) {
            chip("Today", on: isToday) { date = .now }
            chip("Yesterday", on: isYesterday) { date = cal.date(byAdding: .hour, value: 12, to: yesterday)! }
            DatePicker("", selection: $date, in: ...Date.now, displayedComponents: .date)
                .labelsHidden().datePickerStyle(.field).font(FS.font(14, 500))
                .environment(\.locale, Locale(identifier: "en_GB"))
                .opacity(isToday || isYesterday ? 0.6 : 1)
        }
    }
    private func chip(_ t: String, on: Bool, _ a: @escaping () -> Void) -> some View {
        Button { withAnimation(Flow.fast) { a() } } label: {
            Text(t).font(FS.font(14, 600, rond: 60))
                .foregroundStyle(on ? MD.onSecondaryContainer : MD.onSurface)
                .padding(.horizontal, 12).frame(height: 36)
                .background(RoundedRectangle(cornerRadius: 10).fill(on ? MD.secondaryContainer : Surface.dialog))
                .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(on ? .clear : MD.outlineVariant, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}

/// A small caption above a group of controls.
struct FieldLabel: View {
    let text: String
    var body: some View { Text(text).role(.sub, MD.onSurfaceVariant) }
}

/// Wraps children onto new lines (chips).
struct ChipFlow: Layout {
    var spacing: CGFloat = 8
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, rowH: CGFloat = 0, maxX: CGFloat = 0
        for s in subviews {
            let sz = s.sizeThatFits(.unspecified)
            if x > 0 && x + sz.width > width { x = 0; y += rowH + spacing; rowH = 0 }
            x += sz.width + spacing; rowH = max(rowH, sz.height); maxX = max(maxX, x - spacing)
        }
        return CGSize(width: min(maxX, width), height: y + rowH)
    }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, rowH: CGFloat = 0
        for s in subviews {
            let sz = s.sizeThatFits(.unspecified)
            if x > bounds.minX && x + sz.width > bounds.maxX { x = bounds.minX; y += rowH + spacing; rowH = 0 }
            s.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(sz))
            x += sz.width + spacing; rowH = max(rowH, sz.height)
        }
    }
}

enum Parse {
    /// "1,234.50" → 1234.5; empty → nil.
    static func amount(_ s: String) -> Double? {
        let t = s.replacingOccurrences(of: ",", with: "").replacingOccurrences(of: " ", with: "").replacingOccurrences(of: "₱", with: "")
        guard !t.isEmpty, let v = Double(t) else { return nil }
        return v
    }
}

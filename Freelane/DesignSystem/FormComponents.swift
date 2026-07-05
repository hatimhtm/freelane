import SwiftUI
import AppKit

/// macOS sheets don't close when you click outside them — but everyone tries anyway. This
/// watches for clicks landing on the sheet's PARENT window while the sheet is up and dismisses,
/// so every panel behaves like a popover. Clicks inside the sheet, its menus, pickers, or
/// popovers are untouched (those land in other windows than the parent).
struct ClickOutsideToClose: ViewModifier {
    @Environment(\.dismiss) private var dismiss
    @State private var monitor: Any? = nil
    @State private var hostWindow: NSWindow? = nil

    func body(content: Content) -> some View {
        content
            .background(WindowReader { hostWindow = $0 })
            .onAppear {
                guard monitor == nil else { return }
                monitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { event in
                    if let host = hostWindow, let parent = host.sheetParent, event.window === parent {
                        DispatchQueue.main.async { dismiss() }
                        return nil   // swallow the click — no system "bonk", no accidental action behind
                    }
                    return event
                }
            }
            .onDisappear {
                if let m = monitor { NSEvent.removeMonitor(m); monitor = nil }
            }
    }
}

/// Hands the hosting NSWindow to SwiftUI content (zero-size, invisible).
private struct WindowReader: NSViewRepresentable {
    var onWindow: (NSWindow?) -> Void
    func makeNSView(context: Context) -> NSView {
        let v = NSView()
        DispatchQueue.main.async { [weak v] in onWindow(v?.window) }
        return v
    }
    func updateNSView(_ nsView: NSView, context: Context) {
        DispatchQueue.main.async { [weak nsView] in onWindow(nsView?.window) }
    }
}

extension View {
    /// Click anywhere outside this sheet to close it (Esc still works too).
    func clickOutsideCloses() -> some View { modifier(ClickOutsideToClose()) }
}

/// A flagship entrance for sheets — a quick spring scale + fade so every menu
/// appears with life instead of a hard cut.
struct SheetEntrance: ViewModifier {
    @State private var shown = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    func body(content: Content) -> some View {
        content
            .scaleEffect(shown || reduceMotion ? 1 : 0.965)
            .opacity(shown || reduceMotion ? 1 : 0)
            .onAppear { withAnimation(.spring(response: 0.42, dampingFraction: 0.84)) { shown = true } }
    }
}

/// A floating close ✕ (top-right) + Esc-to-dismiss for any custom sheet that doesn't use
/// SheetScaffold — so no presented sheet can ever trap you (macOS sheets don't close on
/// click-outside, so a visible close + Esc is the reliable escape).
struct SheetCloseChrome: ViewModifier {
    let dismiss: DismissAction
    func body(content: Content) -> some View {
        content
            .overlay(alignment: .topTrailing) {
                Button { dismiss() } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 22)).foregroundStyle(Palette.textTertiary)
                        .background(Circle().fill(Palette.ink.opacity(0.55)))
                }
                .buttonStyle(.iconPress).padding(12).help("Close (Esc)")
            }
            .background { Button("") { dismiss() }.keyboardShortcut(.cancelAction).opacity(0) }
    }
}

extension View {
    func sheetEntrance() -> some View { modifier(SheetEntrance()) }
    /// Add a visible ✕ + Esc-to-close to a custom sheet. Pass the sheet's `@Environment(\.dismiss)`.
    func sheetCloseChrome(_ dismiss: DismissAction) -> some View { modifier(SheetCloseChrome(dismiss: dismiss)) }
    /// Wrap a bespoke sheet's content so it matches the app: mesh backdrop, dark, the flagship
    /// entrance, and click-outside-to-close. (SheetScaffold applies this itself.)
    func flagshipSheet() -> some View {
        self.background(AppBackground()).appAppearance().sheetEntrance().clickOutsideCloses()
    }
}

struct SheetScaffold<Content: View>: View {
    var title: String
    var accent: Color
    var icon: String? = nil
    var canSave: Bool
    var saveLabel: String = "Save"
    var onSave: () -> Void
    /// Optional destructive action (e.g. "Delete project") — renders bottom-left in the footer so
    /// every edit sheet gets a VISIBLE delete, not just a hidden right-click.
    var deleteLabel: String? = nil
    var onDelete: (() -> Void)? = nil
    @ViewBuilder var content: () -> Content

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Glass header
            HStack(spacing: 11) {
                if let icon { GlyphChip(systemImage: icon, color: accent, size: 30) }
                Text(title).font(Typo.title(18)).foregroundStyle(Palette.textPrimary)
                Spacer()
                Button { dismiss() } label: {
                    Image(systemName: "xmark.circle.fill").font(.system(size: 20)).foregroundStyle(Palette.textTertiary)
                }.buttonStyle(.iconPress).keyboardShortcut(.cancelAction).help("Close (Esc)")
            }
            .padding(.horizontal, 18).padding(.vertical, 14)
            .background(Palette.wellFill)
            .overlay(alignment: .bottom) { Rectangle().fill(Palette.hairline).frame(height: 0.7) }

            ScrollView {
                VStack(alignment: .leading, spacing: 18, content: content).padding(24)
            }
            .mask(
                VStack(spacing: 0) {
                    LinearGradient(colors: [.clear, .black], startPoint: .top, endPoint: .bottom).frame(height: 12)
                    Color.black
                    LinearGradient(colors: [.black, .clear], startPoint: .top, endPoint: .bottom).frame(height: 12)
                }
            )

            // Glass footer
            HStack(spacing: 10) {
                if let onDelete, let deleteLabel {
                    Button { onDelete() } label: { Label(deleteLabel, systemImage: "trash") }
                        .buttonStyle(.destructive)
                }
                Spacer()
                Button("Cancel") { dismiss() }.buttonStyle(.glass)
                Button(saveLabel) { onSave() }
                    .buttonStyle(.glassProminent).tint(accent).disabled(!canSave)
                    .keyboardShortcut(.defaultAction)   // ⏎ saves from anywhere in the sheet
            }
            .padding(14)
            .background(Palette.wellFill)
            .overlay(alignment: .top) { Rectangle().fill(Palette.hairline).frame(height: 0.7) }
        }
        .frame(width: 540, height: 600)
        .background(AppBackground())
        .appAppearance()
        .sheetEntrance()
        .clickOutsideCloses()
    }
}

/// The app's single input look — a roomy glass field. Replaces `.roundedBorder`
/// everywhere so no form reads like an HTML page.
struct GlassFieldStyle: TextFieldStyle {
    func _body(configuration: TextField<Self._Label>) -> some View {
        configuration
            .textFieldStyle(.plain)
            .font(.system(size: 15))
            .foregroundStyle(Palette.textPrimary)
            .padding(.horizontal, 13).padding(.vertical, 11)
            .background(Palette.fieldFill, in: RoundedRectangle(cornerRadius: Radii.field, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Radii.field, style: .continuous).strokeBorder(Palette.fieldStroke, lineWidth: 1))
    }
}

/// Destructive (delete/remove) action button — red-tinted, distinct from the OS-26 .glass styles.
struct DestructiveButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(Palette.negative)
            .padding(.horizontal, 14).padding(.vertical, 8)
            .background(Palette.negative.opacity(configuration.isPressed ? 0.24 : 0.14), in: Capsule())
            .overlay(Capsule().strokeBorder(Palette.negative.opacity(0.36), lineWidth: 1))
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(Motion.snappy, value: configuration.isPressed)
    }
}
extension ButtonStyle where Self == DestructiveButtonStyle {
    static var destructive: DestructiveButtonStyle { DestructiveButtonStyle() }
}

/// The user's chosen appearance. Defaults to dark; full light theming arrives in the polish phase,
/// so this just unlocks the previously-hardcoded `.appAppearance()` from a single place.
enum Appearance {
    static var scheme: ColorScheme? {
        switch UserDefaults.standard.string(forKey: "appearance") {
        case "light":  return .light
        case "system": return nil
        default:       return .dark
        }
    }
}
extension View {
    func appAppearance() -> some View { preferredColorScheme(Appearance.scheme) }
}

/// Date field — a glass well that opens OUR calendar. (The native compact picker's white
/// popover calendar never matched the room; this one is espresso glass with a gold selection.)
struct GlassDateField: View {
    @Binding var date: Date
    /// Compact shows "Jun 13" for dense rows; full shows the whole weekday date.
    var compact = false
    @State private var open = false

    var body: some View {
        Button { open.toggle() } label: {
            HStack(spacing: 8) {
                Image(systemName: "calendar").font(.system(size: 12, weight: .semibold)).foregroundStyle(Palette.textTertiary)
                Text(compact ? date.formatted(.dateTime.month(.abbreviated).day())
                             : date.formatted(.dateTime.weekday(.abbreviated).month().day().year()))
                    .font(.system(size: 13, weight: .medium)).foregroundStyle(Palette.textPrimary).lineLimit(1)
                Spacer(minLength: 0)
                Image(systemName: "chevron.down").font(.system(size: 9, weight: .bold)).foregroundStyle(Palette.textTertiary)
                    .rotationEffect(.degrees(open ? 180 : 0))
            }
            .padding(.horizontal, 11).padding(.vertical, 9)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .insetRow(cornerRadius: Radii.field)
        .animation(.snappy(duration: 0.18), value: open)
        .popover(isPresented: $open, arrowEdge: .bottom) {
            GlassCalendar(date: $date) { open = false }
                .padding(14).frame(width: 264)
                .appAppearance()
        }
    }
}

/// The app's month calendar — espresso surface, gold selected day, outlined today.
/// Used by GlassDateField and anywhere a date grid is needed.
struct GlassCalendar: View {
    @Binding var date: Date
    var onPick: () -> Void = {}
    @State private var month: Date

    init(date: Binding<Date>, onPick: @escaping () -> Void = {}) {
        _date = date
        self.onPick = onPick
        _month = State(initialValue: date.wrappedValue)
    }

    private var cal: Calendar { PHT.calendar }

    private var monthDays: [Date?] {
        guard let interval = cal.dateInterval(of: .month, for: month) else { return [] }
        let first = interval.start
        let count = cal.range(of: .day, in: .month, for: month)?.count ?? 30
        let lead = (cal.component(.weekday, from: first) - cal.firstWeekday + 7) % 7
        return Array(repeating: nil, count: lead)
            + (0..<count).map { cal.date(byAdding: .day, value: $0, to: first) }
    }
    private var weekdaySymbols: [String] {
        let s = cal.veryShortWeekdaySymbols
        return Array(s[(cal.firstWeekday - 1)...] + s[..<(cal.firstWeekday - 1)])
    }

    var body: some View {
        VStack(spacing: 10) {
            HStack {
                monthNav("chevron.left", -1)
                Spacer()
                Text(month.formatted(.dateTime.month(.wide).year()))
                    .font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.textPrimary)
                    .contentTransition(.numericText())
                Spacer()
                monthNav("chevron.right", 1)
            }
            HStack(spacing: 0) {
                ForEach(weekdaySymbols, id: \.self) { d in
                    Text(d).font(.system(size: 9.5, weight: .semibold)).foregroundStyle(Palette.textTertiary)
                        .frame(maxWidth: .infinity)
                }
            }
            let cols = Array(repeating: GridItem(.flexible(), spacing: 2), count: 7)
            LazyVGrid(columns: cols, spacing: 3) {
                ForEach(Array(monthDays.enumerated()), id: \.offset) { _, d in
                    if let d {
                        dayCell(d)
                    } else {
                        Color.clear.frame(height: 26)
                    }
                }
            }
        }
        .animation(.snappy(duration: 0.2), value: month)
    }

    private func monthNav(_ icon: String, _ delta: Int) -> some View {
        Button { month = cal.date(byAdding: .month, value: delta, to: month) ?? month } label: {
            Image(systemName: icon).font(.system(size: 10, weight: .bold)).foregroundStyle(Palette.textSecondary)
                .frame(width: 26, height: 24)
        }
        .buttonStyle(.plain)
        .insetRow(cornerRadius: Radii.row)
    }

    private func dayCell(_ d: Date) -> some View {
        let selected = cal.isDate(d, inSameDayAs: date)
        let today = cal.isDateInToday(d)
        return Button {
            // Keep the existing time-of-day; change only the calendar day.
            let time = cal.dateComponents([.hour, .minute, .second], from: date)
            date = cal.date(bySettingHour: time.hour ?? 0, minute: time.minute ?? 0, second: time.second ?? 0, of: d) ?? d
            onPick()
        } label: {
            Text("\(cal.component(.day, from: d))")
                .font(.system(size: 11.5, weight: selected ? .bold : .medium, design: .rounded))
                .foregroundStyle(selected ? Palette.ink : (today ? Palette.acidLime : Palette.textSecondary))
                .frame(maxWidth: .infinity).frame(height: 26)
                .background {
                    if selected { RoundedRectangle(cornerRadius: 7, style: .continuous).fill(Palette.acidLime) }
                    else if today { RoundedRectangle(cornerRadius: 7, style: .continuous).strokeBorder(Palette.acidLime.opacity(0.5), lineWidth: 1) }
                }
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// Themed dropdown for ANY single-choice picker (clients, wallets, kinds, sort orders…).
/// v2: the POPUP itself is ours — an espresso-glass popover with hovering rows and a gold
/// check — not the white system NSMenu that made every dropdown look like 2003. Long lists
/// scroll; the current choice is pre-highlighted.
struct GlassMenuPicker<T: Hashable>: View {
    @Binding var selection: T
    var options: [T]
    var label: (T) -> String
    @State private var open = false

    var body: some View {
        Button { open.toggle() } label: {
            HStack(spacing: 6) {
                Text(label(selection)).font(.system(size: 13, weight: .medium)).foregroundStyle(Palette.textPrimary).lineLimit(1)
                Spacer(minLength: 0)
                Image(systemName: "chevron.down").font(.system(size: 9, weight: .bold)).foregroundStyle(Palette.textTertiary)
                    .rotationEffect(.degrees(open ? 180 : 0))
            }
            .padding(.horizontal, 11).padding(.vertical, 9)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .insetRow(cornerRadius: Radii.field)
        .animation(.snappy(duration: 0.18), value: open)
        .popover(isPresented: $open, arrowEdge: .bottom) {
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(spacing: 2) {
                        ForEach(options, id: \.self) { o in
                            optionRow(o)
                        }
                    }
                    .padding(8)
                }
                .onAppear { proxy.scrollTo(selection, anchor: .center) }
            }
            .frame(width: 240)
            .frame(maxHeight: min(CGFloat(options.count) * 32 + 18, 320))
            .appAppearance()
        }
    }

    private func optionRow(_ o: T) -> some View {
        Button { selection = o; open = false } label: {
            HStack(spacing: 8) {
                Text(label(o))
                    .font(.system(size: 12.5, weight: o == selection ? .semibold : .medium))
                    .foregroundStyle(Palette.textPrimary).lineLimit(1)
                Spacer(minLength: 0)
                if o == selection {
                    Image(systemName: "checkmark").font(.system(size: 10, weight: .bold)).foregroundStyle(Palette.acidLime)
                }
            }
            .padding(.horizontal, 10).padding(.vertical, 7)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .insetRow(cornerRadius: Radii.row)
        .id(o)
    }
}

/// Press + hover feel for icon-only buttons — a quick spring shrink on press and a gentle
/// grow on hover, so no control in the app feels dead.
struct IconPress: ButtonStyle {
    @State private var hover = false
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.86 : (hover ? 1.08 : 1))
            .opacity(configuration.isPressed ? 0.7 : 1)
            .animation(.spring(response: 0.28, dampingFraction: 0.6), value: configuration.isPressed)
            .animation(.easeOut(duration: 0.12), value: hover)
            .onHover { hover = $0 }
    }
}
extension ButtonStyle where Self == IconPress {
    static var iconPress: IconPress { IconPress() }
}

/// A compact currency dropdown — same themed popover as GlassMenuPicker (no system menu).
struct CurrencyMenu: View {
    @Binding var selection: String
    var options = CurrencyFormat.supported
    var body: some View {
        GlassMenuPicker(selection: $selection, options: options) { "\($0)  \(CurrencyFormat.symbol($0))" }
            .frame(width: 92)
    }
}

/// A glass segmented selector (2–3 modes) with a sliding lime pill.
struct GlassSegment<T: Hashable>: View {
    var options: [T]
    @Binding var selection: T
    var label: (T) -> String
    @Namespace private var ns
    var body: some View {
        HStack(spacing: 4) {
            ForEach(options, id: \.self) { opt in
                let sel = opt == selection
                Text(label(opt))
                    .font(.system(size: 12.5, weight: .semibold))
                    .foregroundStyle(sel ? Palette.ink : Palette.textSecondary)
                    .padding(.horizontal, 12).padding(.vertical, 7)
                    .background {
                        if sel { Capsule().fill(Palette.acidLime).matchedGeometryEffect(id: "seg", in: ns) }
                    }
                    .contentShape(Capsule())
                    .onTapGesture { withAnimation(.snappy(duration: 0.22)) { selection = opt } }
            }
        }
        .padding(4)
        .background(Palette.hairline, in: Capsule())
        .overlay(Capsule().strokeBorder(Palette.wellStroke, lineWidth: 0.8))
    }
}

/// A compact in-list search field (glass, with a leading magnifier + clear button).
/// Used to give every long list real find/filter instead of silent truncation.
struct SearchField: View {
    @Binding var text: String
    var placeholder: String = "Search"
    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").font(.system(size: 12, weight: .semibold)).foregroundStyle(Palette.textTertiary)
            TextField(placeholder, text: $text).textFieldStyle(.plain).font(.system(size: 13)).foregroundStyle(Palette.textPrimary)
            if !text.isEmpty {
                Button { text = "" } label: { Image(systemName: "xmark.circle.fill").font(.system(size: 12)).foregroundStyle(Palette.textTertiary) }
                    .buttonStyle(.iconPress).help("Clear search")
            }
        }
        .padding(.horizontal, 11).padding(.vertical, 8)
        .background(Palette.hairline, in: Capsule())
        .overlay(Capsule().strokeBorder(Palette.wellStroke, lineWidth: 0.8))
    }
}

/// A tactile button style for whole-card buttons: a subtle spring scale on press (like a
/// physical key), no default chrome. Replaces `.buttonStyle(.plain)` on tappable cards.
struct PressableCard: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.972 : 1)
            .animation(.spring(response: 0.3, dampingFraction: 0.62), value: configuration.isPressed)
    }
}
extension ButtonStyle where Self == PressableCard {
    static var cardPress: PressableCard { PressableCard() }
}

struct LabeledField<Content: View>: View {
    var label: String
    @ViewBuilder var content: () -> Content

    init(_ label: String, @ViewBuilder content: @escaping () -> Content) {
        self.label = label
        self.content = content
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.system(size: 11, weight: .semibold))
                .textCase(.uppercase).kerning(0.5)
                .foregroundStyle(Palette.textSecondary)
            content()
        }
    }
}

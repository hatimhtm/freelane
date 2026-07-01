import SwiftUI

/// ⌘K spotlight — jump to any page or quick action. The native echo of the web
/// app's command palette: many options, type to filter, Enter for the top hit.
struct CommandPalette: View {
    var onSelect: (Feature) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var selected = 0
    @FocusState private var focused: Bool

    private struct Row: Identifiable {
        let id = UUID()
        let title: String
        let subtitle: String
        let icon: String
        let accent: Color
        let feature: Feature
    }

    private var quickActions: [Row] {
        [
            Row(title: "Log a spend", subtitle: "Quick action", icon: "cart.badge.plus", accent: Palette.warning, feature: .spending),
            Row(title: "Log a payment", subtitle: "Quick action", icon: "plus.circle", accent: Palette.positive, feature: .payments),
            Row(title: "Give sadaka", subtitle: "Quick action", icon: "heart.fill", accent: Palette.negative, feature: .sadaka),
            Row(title: "New project", subtitle: "Quick action", icon: "folder.badge.plus", accent: Palette.violet, feature: .projects),
            Row(title: "New loan", subtitle: "Quick action", icon: "arrow.left.arrow.right", accent: Palette.teal, feature: .loans),
        ]
    }
    private var allRows: [Row] {
        Feature.allCases.filter { !$0.isRetired }.map { Row(title: $0.title, subtitle: $0.group.rawValue, icon: $0.icon, accent: $0.accent, feature: $0) }
            + quickActions
    }
    private var rows: [Row] {
        guard !query.trimmingCharacters(in: .whitespaces).isEmpty else { return allRows }
        let q = query.lowercased()
        return allRows.filter { $0.title.lowercased().contains(q) || $0.subtitle.lowercased().contains(q) }
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass").font(.system(size: 14, weight: .semibold)).foregroundStyle(Palette.textTertiary)
                TextField("Jump to a page or action…", text: $query)
                    .textFieldStyle(.plain).font(.system(size: 16))
                    .focused($focused)
                    .onSubmit { act() }
                    .onChange(of: query) { _, _ in selected = 0 }
                    .onKeyPress(.downArrow) { if !rows.isEmpty { selected = min(selected + 1, rows.count - 1) }; return .handled }
                    .onKeyPress(.upArrow) { if !rows.isEmpty { selected = max(selected - 1, 0) }; return .handled }
                if !query.isEmpty {
                    Button { query = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(Palette.textTertiary) }.buttonStyle(.iconPress)
                }
                Text("⌘K").font(.system(size: 11, weight: .semibold, design: .rounded)).foregroundStyle(Palette.textTertiary)
                    .padding(.horizontal, 6).padding(.vertical, 3).background(Palette.hairline, in: RoundedRectangle(cornerRadius: 6))
            }
            .padding(16)
            Divider().overlay(Palette.hairline)
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 2) {
                        if rows.isEmpty {
                            Text("No matches").font(.system(size: 13)).foregroundStyle(Palette.textTertiary)
                                .frame(maxWidth: .infinity, minHeight: 80)
                        }
                        ForEach(Array(rows.enumerated()), id: \.element.id) { idx, r in
                            PaletteRow(row: r, isTop: idx == selected) { onSelect(r.feature) }
                                .id(idx)
                        }
                    }
                    .padding(8)
                }
                .frame(maxHeight: 400)
                .onChange(of: selected) { _, s in withAnimation(.easeOut(duration: 0.12)) { proxy.scrollTo(s, anchor: .center) } }
            }
        }
        .frame(width: 540)
        .flagshipSheet()
        .onAppear { focused = true }
        .background {
            Button("") { dismiss() }.keyboardShortcut(.cancelAction).opacity(0)
        }
    }

    /// Act on the highlighted row (↑↓ moves the highlight; ⏎ fires this).
    private func act() {
        guard !rows.isEmpty else { return }
        onSelect(rows[min(selected, rows.count - 1)].feature)
    }

    private struct PaletteRow: View {
        let row: Row
        let isTop: Bool
        let action: () -> Void
        @State private var hover = false

        var body: some View {
            Button(action: action) {
                HStack(spacing: 12) {
                    Image(systemName: row.icon).font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(row.accent).frame(width: 30, height: 30)
                        .background(row.accent.opacity(0.16), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                    VStack(alignment: .leading, spacing: 1) {
                        Text(row.title).font(.system(size: 13.5, weight: .medium)).foregroundStyle(Palette.textPrimary)
                        Text(row.subtitle).font(.system(size: 11)).foregroundStyle(Palette.textTertiary)
                    }
                    Spacer()
                    if isTop { Text("return").font(.system(size: 10, weight: .semibold)).foregroundStyle(Palette.textTertiary) }
                    else { Image(systemName: "arrow.right").font(.system(size: 10)).foregroundStyle(Palette.textTertiary).opacity(hover ? 1 : 0) }
                }
                .padding(.horizontal, 10).padding(.vertical, 8)
                .background(RoundedRectangle(cornerRadius: Radii.row, style: .continuous)
                    .fill(hover || isTop ? Palette.hairline : .clear))
            }
            .buttonStyle(.plain)
            .onHover { hover = $0 }
        }
    }
}

/// ⌘? — a quick keyboard-shortcut cheat sheet. Calm reference card, dismiss with Esc.
struct ShortcutsHUD: View {
    @Environment(\.dismiss) private var dismiss
    private let shortcuts: [(String, String)] = [
        ("⌘K", "Command palette — jump anywhere"),
        ("⌘F", "Search across everything"),
        ("⌘?", "This shortcut sheet"),
        ("⌃⌥Space", "Quick-capture a spend (global)"),
        ("↑ ↓", "Move selection in the palette"),
        ("⏎", "Run the highlighted action"),
        ("Esc", "Close any sheet or popover"),
    ]
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 10) {
                Image(systemName: "command").font(.system(size: 15, weight: .semibold)).foregroundStyle(Palette.cyan)
                Text("Keyboard shortcuts").font(Typo.title(16)).foregroundStyle(Palette.textPrimary)
                Spacer()
                Button { dismiss() } label: { Image(systemName: "xmark.circle.fill").font(.system(size: 18)).foregroundStyle(Palette.textTertiary) }
                    .buttonStyle(.iconPress).keyboardShortcut(.cancelAction)
            }.padding(16)
            Divider().overlay(Palette.hairline)
            VStack(spacing: 2) {
                ForEach(shortcuts, id: \.0) { s in
                    HStack(spacing: 14) {
                        Text(s.0).font(.system(size: 12, weight: .semibold, design: .rounded)).foregroundStyle(Palette.textPrimary)
                            .frame(width: 92, alignment: .leading)
                            .padding(.horizontal, 8).padding(.vertical, 5)
                            .background(Palette.hairline, in: RoundedRectangle(cornerRadius: 7))
                        Text(s.1).font(.system(size: 13)).foregroundStyle(Palette.textSecondary)
                        Spacer()
                    }.padding(.horizontal, 16).padding(.vertical, 3)
                }
            }.padding(.vertical, 10)
        }
        .frame(width: 420)
        .flagshipSheet()
    }
}

import SwiftUI
import SwiftData

/// ⌘F — search across everything: clients, people, vendors, projects, spends.
/// Picking a result jumps to that section.
struct SearchPalette: View {
    var onNavigate: (Feature) -> Void
    @Environment(\.dismiss) private var dismiss
    @Query(filter: #Predicate<Client> { $0.deletedAt == nil }) private var clients: [Client]
    @Query(filter: #Predicate<Entity> { $0.deletedAt == nil }) private var entities: [Entity]
    @Query(filter: #Predicate<Project> { $0.deletedAt == nil }) private var projects: [Project]
    @Query(filter: #Predicate<Spend> { $0.deletedAt == nil }, sort: \Spend.spentAt, order: .reverse) private var spends: [Spend]
    @State private var query = ""
    @FocusState private var focused: Bool

    private struct Hit: Identifiable { let id = UUID(); let title: String; let sub: String; let icon: String; let color: Color; let feature: Feature }

    private var hits: [Hit] {
        let q = query.lowercased().trimmingCharacters(in: .whitespaces)
        guard q.count >= 1 else { return [] }
        var out: [Hit] = []
        for c in clients where !c.archived && (c.name.lowercased().contains(q) || (c.company?.lowercased().contains(q) ?? false)) {
            out.append(Hit(title: c.name, sub: c.company ?? "Client", icon: "briefcase", color: Palette.cyan, feature: .clients))
        }
        for e in entities where !e.archived && (e.name.lowercased().contains(q) || (e.relationship?.lowercased().contains(q) ?? false)) {
            out.append(Hit(title: e.name, sub: e.relationship ?? e.kind.label, icon: e.kind.icon, color: Palette.violet, feature: .people))
        }
        for p in projects where p.title.lowercased().contains(q) {
            out.append(Hit(title: p.title, sub: "Project · \(p.status.label)", icon: "folder", color: Palette.cyan, feature: .projects))
        }
        var vendorsSeen = Set<String>()
        for s in spends {
            if let v = s.vendorName, !v.isEmpty, v.lowercased().contains(q), !vendorsSeen.contains(v.lowercased()) {
                vendorsSeen.insert(v.lowercased())
                out.append(Hit(title: v, sub: "Vendor", icon: "storefront", color: Palette.warning, feature: .vendors))
            }
        }
        for s in spends.prefix(400) where (s.spendDescription?.lowercased().contains(q) ?? false) {
            out.append(Hit(title: s.spendDescription ?? "Spend", sub: "Spend · \(CurrencyFormat.string(s.amountBase, "PHP", compact: true))", icon: "cart", color: Palette.warning, feature: .spending))
        }
        return Array(out.prefix(40))
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass").foregroundStyle(Palette.textTertiary)
                TextField("Search clients, people, vendors, projects, spends…", text: $query)
                    .textFieldStyle(.plain).font(.system(size: 16)).focused($focused)
                    .onSubmit { if let f = hits.first { onNavigate(f.feature); dismiss() } }
                Text("⌘F").font(.system(size: 11, weight: .semibold, design: .rounded)).foregroundStyle(Palette.textTertiary)
                    .padding(.horizontal, 6).padding(.vertical, 3).background(Palette.hairline, in: RoundedRectangle(cornerRadius: 6))
            }.padding(16)
            Divider().overlay(Palette.hairline)
            ScrollView {
                LazyVStack(spacing: 2) {
                    if query.isEmpty {
                        Text("Type to search across everything.").font(.system(size: 13)).foregroundStyle(Palette.textTertiary).frame(maxWidth: .infinity, minHeight: 80)
                    } else if hits.isEmpty {
                        Text("No matches.").font(.system(size: 13)).foregroundStyle(Palette.textTertiary).frame(maxWidth: .infinity, minHeight: 80)
                    }
                    ForEach(hits) { h in
                        Button { onNavigate(h.feature); dismiss() } label: {
                            HStack(spacing: 12) {
                                Image(systemName: h.icon).font(.system(size: 13, weight: .semibold)).foregroundStyle(h.color)
                                    .frame(width: 30, height: 30).background(h.color.opacity(0.16), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(h.title).font(.system(size: 13.5, weight: .medium)).foregroundStyle(Palette.textPrimary).lineLimit(1)
                                    Text(h.sub).font(.system(size: 11)).foregroundStyle(Palette.textTertiary).lineLimit(1)
                                }
                                Spacer()
                            }
                            .padding(.horizontal, 10).padding(.vertical, 8)
                            .contentShape(Rectangle())
                        }.buttonStyle(.plain)
                        .insetRow(cornerRadius: Radii.row)
                    }
                }.padding(8)
            }.frame(maxHeight: 420)
        }
        .frame(width: 560).flagshipSheet()
        .onAppear { focused = true }
        .background { Button("") { dismiss() }.keyboardShortcut(.cancelAction).opacity(0) }
    }
}

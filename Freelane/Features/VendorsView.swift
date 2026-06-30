import SwiftUI
import SwiftData

struct VendorsView: View {
    @Environment(\.modelContext) private var context
    @Query private var settings: [AppSettings]
    @Query(filter: #Predicate<Spend> { $0.deletedAt == nil }, sort: \Spend.spentAt, order: .reverse) private var spends: [Spend]
    @Query(filter: #Predicate<Vendor> { $0.deletedAt == nil }, sort: \Vendor.name) private var vendors: [Vendor]
    @State private var query = ""
    @State private var renaming: String?            // vendor name being renamed/merged
    @State private var renameTo = ""
    @FocusState private var renameFocused: Bool
    @AppStorage("vendors.stopped") private var stoppedRaw = ""   // newline-joined names you've quit

    private var base: String { settings.first?.baseCurrency ?? "PHP" }

    private var stopped: Set<String> { Set(stoppedRaw.split(separator: "\n").map(String.init)) }
    private func setStopped(_ s: Set<String>) { stoppedRaw = s.sorted().joined(separator: "\n") }
    private func toggleStopped(_ name: String) {
        var s = stopped; if s.contains(name) { s.remove(name) } else { s.insert(name) }; setStopped(s)
    }
    /// Merge one vendor into another by rewriting every spend's vendorName (Jollibee/JolliBee → one).
    private func merge(from old: String, to new: String) {
        let target = new.trimmingCharacters(in: .whitespaces)
        guard !target.isEmpty, target != old else { return }
        for s in spends where s.vendorName == old { s.vendorName = target; s.dirty = true }
        if stopped.contains(old) { var st = stopped; st.remove(old); st.insert(target); setStopped(st) }
        try? context.save()
    }

    /// Vendors derived from spends (by name) + any explicit Vendor records — a
    /// pragmatic native rollup so the screen is useful without link tables.
    private struct Roll: Identifiable { let id = UUID(); let name: String; let total: Double; let count: Int; let last: Date? }

    // Only EXPLICIT vendor names are vendors. Raw descriptions are NOT vendors —
    // they're spends waiting for AI to identify the place (handled when AI is wired).
    private var rolls: [Roll] {
        var map: [String: (Double, Int, Date?)] = [:]
        for s in spends {
            guard let name = s.vendorName, !name.isEmpty else { continue }
            var e = map[name] ?? (0, 0, nil)
            e.0 += s.amountBase; e.1 += 1
            if e.2 == nil || s.spentAt > e.2! { e.2 = s.spentAt }
            map[name] = e
        }
        return map.map { Roll(name: $0.key, total: $0.value.0, count: $0.value.1, last: $0.value.2) }
            .sorted { $0.total > $1.total }
    }
    /// Active vendors filtered by name (stopped ones move to "Things I've quit"). Empty query = all.
    private var filteredRolls: [Roll] {
        let active = rolls.filter { !stopped.contains($0.name) }
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return active }
        return active.filter { $0.name.lowercased().contains(q) }
    }
    private var quitRolls: [Roll] { rolls.filter { stopped.contains($0.name) } }
    private var needsIdentifying: Int { spends.filter { ($0.vendorName ?? "").isEmpty }.count }

    var body: some View {
        Page("Vendors", subtitle: "Identified places you spend at.") {
            if needsIdentifying > 0 {
                SectionCard(title: "Needs identifying", subtitle: "The assistant asks about these in the bell", accent: Palette.azure) {
                    HStack {
                        Image(systemName: "sparkles").foregroundStyle(Palette.azure)
                        Text("\(needsIdentifying) spends have no vendor yet — log one with a vendor name, and the AI will keep asking what the place is so it can tag and brand it.")
                            .font(.system(size: 12)).foregroundStyle(Palette.textSecondary)
                        Spacer()
                    }
                }
            }
            if rolls.isEmpty {
                EmptyStateCard(icon: "bag", title: "No vendors yet",
                               message: "Vendors appear here as you log spending — the AI names and recognizes them automatically.")
            }
            let list = filteredRolls
            SectionCard(title: "By spend",
                        subtitle: query.isEmpty ? "\(rolls.count) vendors" : "\(list.count) of \(rolls.count)",
                        accent: Palette.warning) {
                SearchField(text: $query, placeholder: "Search vendor").padding(.bottom, 10)
                if list.isEmpty {
                    Text("No matches for “\(query)”.").font(.system(size: 13)).foregroundStyle(Palette.textTertiary)
                        .frame(maxWidth: .infinity, minHeight: 60)
                } else {
                    LazyVStack(spacing: 0) {
                        ForEach(list) { r in
                            HStack(spacing: 12) {
                                VendorMark(name: r.name, size: 34)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(r.name).font(.system(size: 13, weight: .medium)).foregroundStyle(Palette.textPrimary).lineLimit(1)
                                    Text("\(r.count) spends").font(.system(size: 11)).foregroundStyle(Palette.textTertiary)
                                }
                                Spacer()
                                Text(CurrencyFormat.string(r.total, base, compact: true))
                                    .font(.system(size: 13.5, weight: .semibold, design: .rounded)).monospacedDigit().foregroundStyle(Palette.textPrimary)
                            }
                            .padding(.vertical, 9)
                            .contextMenu {
                                Button("Rename / merge…", systemImage: "arrow.triangle.merge") { renameTo = r.name; renaming = r.name }
                                Button("Stop using", systemImage: "hand.raised") { toggleStopped(r.name) }
                            }
                            if r.id != list.last?.id { Divider().overlay(.white.opacity(0.06)) }
                        }
                    }
                }
            }
            if !quitRolls.isEmpty {
                SectionCard(title: "Things I've quit", subtitle: "Places you decided to stop spending at", accent: Palette.teal) {
                    LazyVStack(spacing: 0) {
                        ForEach(quitRolls) { r in
                            HStack(spacing: 12) {
                                VendorMark(name: r.name, size: 30).grayscale(0.7).opacity(0.7)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(r.name).font(.system(size: 13, weight: .medium)).foregroundStyle(Palette.textSecondary).strikethrough(color: Palette.textTertiary).lineLimit(1)
                                    Text(daysClean(r.last)).font(.system(size: 11)).foregroundStyle(Palette.teal)
                                }
                                Spacer()
                                Button("Resume") { toggleStopped(r.name) }.buttonStyle(.glass).controlSize(.small)
                                    .help("Move \(r.name) back to active vendors")
                            }
                            .padding(.vertical, 9)
                            if r.id != quitRolls.last?.id { Divider().overlay(.white.opacity(0.06)) }
                        }
                    }
                }
            }
        }
        .sheet(item: Binding(get: { renaming.map { RenameTarget(name: $0) } }, set: { renaming = $0?.name })) { t in
            renameSheet(t.name)
        }
    }

    private struct RenameTarget: Identifiable { let name: String; var id: String { name } }

    private func daysClean(_ last: Date?) -> String {
        guard let last else { return "stopped" }
        let d = PHT.calendar.dateComponents([.day], from: last, to: Date()).day ?? 0
        return d <= 0 ? "stopped today" : "\(d) day\(d == 1 ? "" : "s") since last spend"
    }

    private func renameSheet(_ old: String) -> some View {
        SheetScaffold(title: "Rename / merge", accent: Palette.warning,
                      canSave: !renameTo.trimmingCharacters(in: .whitespaces).isEmpty,
                      onSave: { merge(from: old, to: renameTo); renaming = nil }) {
            Text("Rewrites every spend tagged “\(old)”. Type an existing vendor's exact name to merge them (e.g. JolliBee → Jollibee).")
                .font(.system(size: 12)).foregroundStyle(Palette.textSecondary)
            LabeledField("New name") { TextField("Vendor name", text: $renameTo).textFieldStyle(GlassFieldStyle()).focused($renameFocused) }
        }
        .onAppear { DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { renameFocused = true } }
    }
}

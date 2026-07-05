import SwiftUI
import SwiftData

struct PeopleView: View {
    @Environment(\.modelContext) private var context
    @Environment(UndoCenter.self) private var undo
    @Environment(AIManager.self) private var ai
    @Query(filter: #Predicate<Entity> { $0.deletedAt == nil }, sort: \Entity.createdAt, order: .reverse) private var entities: [Entity]
    @State private var showAdd = false
    @State private var selected: Entity?
    @State private var query = ""
    @State private var dupes: [Brain.DupeGroup] = []
    @State private var checkingDupes = false

    private var active: [Entity] { entities.filter { !$0.archived } }
    private var learning: [Entity] { active.filter { ($0.relationship ?? "").isEmpty } }
    /// Filter entities by name / relationship. Empty query = all.
    private func match(_ items: [Entity]) -> [Entity] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return items }
        return items.filter {
            $0.name.lowercased().contains(q) || ($0.relationship ?? "").lowercased().contains(q)
        }
    }

    var body: some View {
        Page("People", subtitle: "Everyone and everything the app keeps track of for you.",
             toolbar: AnyView(addButton)) {
            if active.isEmpty {
                emptyState
            } else {
                if !dupes.isEmpty { dupeCard }
                SearchField(text: $query, placeholder: "Search name or connection")
                let learn = match(learning)
                let all = match(active)
                if !learn.isEmpty {
                    sectionHeader("Still getting to know", "The AI will keep asking about these")
                    grid(learn)
                }
                sectionHeader("Tracked", query.isEmpty ? "\(active.count) total" : "\(all.count) of \(active.count)")
                if all.isEmpty {
                    Text("No matches for “\(query)”.").font(.system(size: 13)).foregroundStyle(Palette.textTertiary)
                        .frame(maxWidth: .infinity, minHeight: 60)
                } else {
                    grid(all)
                }
            }
        }
        .sheet(isPresented: $showAdd) { AddEntitySheet() }
        .sheet(item: $selected) { EntityDetailSheet(entity: $0) }
        .task {
            guard active.count > 1, !checkingDupes else { return }
            checkingDupes = true
            dupes = await Brain.findDuplicatePeople(context, ai: ai)
            checkingDupes = false
        }
    }

    // MARK: Same person? (AI duplicate detection + one-click merge)

    private func entity(_ id: String) -> Entity? {
        UUID(uuidString: id).flatMap { uid in active.first { $0.id == uid } }
    }

    private var dupeCard: some View {
        SectionCard(title: "Same person?",
                    subtitle: "These entries look like duplicates — merging keeps every fact and note",
                    accent: Palette.warning) {
            VStack(spacing: 8) {
                ForEach(dupes) { g in dupeRow(g) }
            }
            .animation(Motion.snappy, value: dupes.map(\.id))
        }
    }

    private func dupeRow(_ g: Brain.DupeGroup) -> some View {
        let keep = entity(g.keep)
        let members = g.merge.compactMap(entity)
        return HStack(spacing: 10) {
            Image(systemName: "person.2.badge.gearshape").font(.system(size: 13)).foregroundStyle(Palette.warning)
            VStack(alignment: .leading, spacing: 2) {
                Text("\(members.map { "“\($0.name)”" }.joined(separator: ", ")) → “\(keep?.name ?? "?")”")
                    .font(.system(size: 12, weight: .medium)).foregroundStyle(Palette.textPrimary)
                Text(g.why).font(.system(size: 10)).foregroundStyle(Palette.textTertiary)
            }
            Spacer()
            Button("Not the same") { rejectDupe(g) }
                .buttonStyle(.plain).font(.system(size: 11, weight: .medium)).foregroundStyle(Palette.textTertiary)
                .help("Never suggest this pair again")
            Button("Merge") { applyDupe(g) }
                .buttonStyle(.glassProminent).tint(Palette.warning).controlSize(.small)
                .disabled(keep == nil || members.isEmpty)
        }
        .padding(.vertical, 7).padding(.horizontal, 10)
        .insetRow(cornerRadius: Radii.field, hoverable: false)
    }

    private func applyDupe(_ g: Brain.DupeGroup) {
        guard let keep = entity(g.keep) else { dupes.removeAll { $0.id == g.id }; return }
        let members = g.merge.compactMap(entity)
        for m in members { EntityMerge.merge(m, into: keep, context: context) }
        undo.offer("merge of \(members.count) \(members.count == 1 ? "entry" : "entries")") {
            for m in members { SoftDelete.restore(m, ownsLedger: false, context: context) }
            try? context.save()
        }
        dupes.removeAll { $0.id == g.id }
    }

    private func rejectDupe(_ g: Brain.DupeGroup) {
        if let keepId = UUID(uuidString: g.keep) {
            EntityMerge.markNotSame(keep: keepId, members: g.merge.compactMap(UUID.init(uuidString:)))
        }
        dupes.removeAll { $0.id == g.id }
    }

    private var addButton: some View {
        Button { showAdd = true } label: { Label("Add", systemImage: "plus") }
            .buttonStyle(.glassProminent).tint(Palette.violet)
    }

    private func sectionHeader(_ t: String, _ s: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(t).sectionTitle(); Spacer()
            Text(s).font(.system(size: 11)).foregroundStyle(Palette.textTertiary)
        }.padding(.top, 4)
    }

    private func grid(_ items: [Entity]) -> some View {
        let cols = [GridItem(.adaptive(minimum: 200), spacing: 14)]
        return GlassGroup(spacing: 14) {
            LazyVGrid(columns: cols, spacing: 14) {
                ForEach(items) { e in
                    Button { selected = e } label: { card(e) }.buttonStyle(.cardPress)
                        .contextMenu {
                            Menu("Merge into…") {
                                ForEach(active.filter { $0.id != e.id }) { other in
                                    Button(other.name) { EntityMerge.merge(e, into: other, context: context) }
                                }
                            }
                            Button("Remove", systemImage: "trash", role: .destructive) {
                                e.deletedAt = .now; e.dirty = true; try? context.save()
                            }
                        }
                }
            }
        }
    }

    private func card(_ e: Entity) -> some View {
        let hits = EntityMoney.matchCount(for: e, in: allSpends)
        let flow = hits >= 2 ? EntityMoney.total(for: e, in: allSpends) : 0
        return VStack(alignment: .leading, spacing: 10) {
            HStack {
                Image(systemName: e.kind.icon).font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Palette.violet).frame(width: 30, height: 30)
                    .background(Palette.violet.opacity(0.16), in: RoundedRectangle(cornerRadius: Radii.row, style: .continuous))
                Spacer()
                Text(e.kind.label).font(.system(size: 9, weight: .semibold)).foregroundStyle(Palette.textTertiary)
                    .padding(.horizontal, 7).padding(.vertical, 3).background(Palette.hairline, in: Capsule())
            }
            Text(e.name).font(.system(size: 15, weight: .semibold)).foregroundStyle(Palette.textPrimary).lineLimit(1)
            Text((e.relationship?.isEmpty == false ? e.relationship! : "Tap to tell me more"))
                .font(.system(size: 11)).foregroundStyle(Palette.textSecondary).lineLimit(1)
            Spacer(minLength: 6)
            // Always present (placeholder when no money) so every card is the SAME height
            // and nothing clips.
            Text(flow > 0 ? CurrencyFormat.string(flow, "PHP", compact: true) + " flowed" : " ")
                .font(.system(size: 10)).monospacedDigit().foregroundStyle(Palette.textTertiary).lineLimit(1)
        }
        .padding(14).frame(maxWidth: .infinity, minHeight: 128, alignment: .topLeading)   // equal, no clip
        .glassCard(cornerRadius: Radii.tile, interactive: true, morphID: "ent.\(e.id)")
    }

    @Query(filter: #Predicate<Spend> { $0.deletedAt == nil }) private var allSpends: [Spend]

    private var emptyState: some View {
        EmptyStateCard(icon: "person.2", title: "No one yet",
                       message: "Add someone, or just keep logging spends — the AI will notice the names and ask who they are.")
    }
}

/// Money that flowed to/around an entity — derived by matching its name in spend text.
enum EntityMoney {
    static func matches(_ e: Entity, _ s: Spend) -> Bool {
        let name = e.name.lowercased().trimmingCharacters(in: .whitespaces)
        guard name.count >= 2 else { return false }
        let hay = [s.vendorName, s.spendDescription, s.notes].compactMap { $0 }.joined(separator: " ").lowercased()
        // Word-boundary match so "Ana" doesn't match "banana" and "Sam" doesn't match "same".
        if name.contains(" ") {
            let pattern = "\\b" + NSRegularExpression.escapedPattern(for: name) + "\\b"
            return hay.range(of: pattern, options: .regularExpression) != nil
        }
        let tokens = hay.split { !$0.isLetter && !$0.isNumber }.map(String.init)
        return tokens.contains(name)
    }
    static func total(for e: Entity, in spends: [Spend]) -> Double {
        spends.filter { matches(e, $0) }.reduce(0) { $0 + $1.amountBase }
    }
    /// How many spends mention this entity — require ≥2 before claiming a "money flow" (one stray
    /// name match is a false positive, not a pattern).
    static func matchCount(for e: Entity, in spends: [Spend]) -> Int {
        spends.filter { matches(e, $0) }.count
    }
}

struct AddEntitySheet: View {
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var kind: EntityKind = .person
    @State private var relationship = ""
    @State private var notes = ""
    @FocusState private var nameFocused: Bool

    var body: some View {
        SheetScaffold(title: "Add to People", accent: Palette.violet, canSave: !name.isEmpty, onSave: {
            let e = Entity(name: name, kind: kind, confidence: 1.0, introduced: true)
            e.relationship = relationship.isEmpty ? nil : relationship
            e.notes = notes.isEmpty ? nil : notes
            e.dirty = true
            context.insert(e); try? context.save(); dismiss()
        }) {
            LabeledField("Name") { TextField("Who or what", text: $name).textFieldStyle(GlassFieldStyle()).focused($nameFocused) }
            LabeledField("Kind") {
                GlassSegment(options: Array(EntityKind.allCases), selection: $kind, label: { $0.label })
            }
            LabeledField("Connection (optional)") { TextField("e.g. my lola, the vet, our car", text: $relationship).textFieldStyle(GlassFieldStyle()) }
            LabeledField("Notes (optional)") { TextField("Anything worth remembering", text: $notes, axis: .vertical).lineLimit(2...4).textFieldStyle(GlassFieldStyle()) }
        }
        .onAppear { DispatchQueue.main.async { nameFocused = true } }
    }
}

struct EditEntitySheet: View {
    let entity: Entity
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @State private var loaded = false
    @State private var name = ""; @State private var relationship = ""; @State private var kind: EntityKind = .person
    @FocusState private var nameFocused: Bool
    var body: some View {
        SheetScaffold(title: "Edit", accent: Palette.violet, canSave: !name.isEmpty, onSave: {
            entity.name = name; entity.relationship = relationship.isEmpty ? nil : relationship
            entity.kind = kind; entity.dirty = true; try? context.save(); dismiss()
        }) {
            LabeledField("Name") { TextField("Who or what", text: $name).textFieldStyle(GlassFieldStyle()).focused($nameFocused) }
            LabeledField("Connection") { TextField("e.g. my lola, the vet, our car", text: $relationship).textFieldStyle(GlassFieldStyle()) }
            LabeledField("Type") {
                GlassMenuPicker(selection: $kind, options: Array(EntityKind.allCases), label: { $0.label })
            }
        }
        .onAppear {
            guard !loaded else { return }; loaded = true
            name = entity.name; relationship = entity.relationship ?? ""; kind = entity.kind
            DispatchQueue.main.async { nameFocused = true }
        }
    }
}

struct EntityDetailSheet: View {
    let entity: Entity
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @Environment(UndoCenter.self) private var undo
    @Query private var facts: [AIFact]
    @Query(filter: #Predicate<Spend> { $0.deletedAt == nil }) private var spends: [Spend]
    @State private var notes = ""
    @State private var showEdit = false
    @State private var saveTask: Task<Void, Never>?
    @State private var importantDate = Date.now
    @State private var hasImportantDate = false
    @State private var importantLabel = "Birthday"

    private var myFacts: [AIFact] {
        let eid = entity.id.uuidString
        return facts.filter { $0.subjectKind == "entity" && $0.subjectId == eid && $0.archivedAt == nil }
    }
    private var flowSpends: [Spend] { spends.filter { EntityMoney.matches(entity, $0) }.sorted { $0.spentAt > $1.spentAt } }
    private var flowTotal: Double { flowSpends.reduce(0) { $0 + $1.amountBase } }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 12) {
                Image(systemName: entity.kind.icon).font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(Palette.violet).frame(width: 44, height: 44)
                    .background(Palette.violet.opacity(0.16), in: RoundedRectangle(cornerRadius: Radii.field, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text(entity.name).font(Typo.title(18)).foregroundStyle(Palette.textPrimary)
                    Text(entity.relationship?.isEmpty == false ? entity.relationship! : entity.kind.label)
                        .font(.system(size: 12)).foregroundStyle(Palette.textSecondary)
                }
                Spacer()
                Button { showEdit = true } label: { Image(systemName: "pencil").font(.system(size: 14)) }.buttonStyle(.glass)
                    .help("Edit")
                    .accessibilityLabel("Edit \(entity.name)")
                Button { dismiss() } label: { Image(systemName: "xmark.circle.fill").font(.system(size: 20)).foregroundStyle(Palette.textTertiary) }
                    .buttonStyle(.iconPress).keyboardShortcut(.cancelAction)
                    .help("Close (Esc)")
                    .accessibilityLabel("Close")
            }.padding(18)
            .sheet(isPresented: $showEdit) { EditEntitySheet(entity: entity) }

            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if flowTotal > 0 {
                        SectionCard(title: "Money flow", subtitle: "\(flowSpends.count) spends mention \(entity.name)", accent: Palette.violet) {
                            Text(CurrencyFormat.string(flowTotal, "PHP")).font(.system(size: 24, weight: .semibold, design: .rounded)).monospacedDigit().foregroundStyle(Palette.textPrimary)
                            VStack(spacing: 0) {
                                ForEach(Array(flowSpends.prefix(8))) { s in
                                    HStack {
                                        Text(s.spendDescription ?? s.vendorName ?? "Spend").font(.system(size: 12)).foregroundStyle(Palette.textSecondary).lineLimit(1)
                                        Spacer()
                                        Text(CurrencyFormat.string(s.amountBase, "PHP", compact: true)).font(.system(size: 12, weight: .medium, design: .rounded)).monospacedDigit().foregroundStyle(Palette.textPrimary)
                                    }.padding(.vertical, 5)
                                }
                            }
                        }
                    }
                    SectionCard(title: "What the AI has learned", subtitle: myFacts.isEmpty ? "Nothing yet — it'll keep asking" : "\(myFacts.count) facts", accent: Palette.cyan) {
                        if myFacts.isEmpty {
                            Text("Answer its questions in the bell and they'll show up here.").font(.system(size: 12)).foregroundStyle(Palette.textTertiary)
                        } else {
                            VStack(spacing: 0) {
                                ForEach(myFacts) { f in
                                    HStack(alignment: .top) {
                                        Text(f.prettyKey).font(.system(size: 12, weight: .medium)).foregroundStyle(Palette.textSecondary).frame(width: 110, alignment: .leading)
                                        Text(f.value).font(.system(size: 12)).foregroundStyle(Palette.textPrimary)
                                        Spacer()
                                    }.padding(.vertical, 6)
                                }
                            }
                        }
                    }
                    SectionCard(title: "Important date", accent: Palette.cyan) {
                        Toggle(isOn: $hasImportantDate) {
                            Text("Track a birthday / anniversary").font(.system(size: 13)).foregroundStyle(Palette.textPrimary)
                        }.toggleStyle(.switch).tint(Palette.cyan)
                            .onChange(of: hasImportantDate) { _, on in
                                entity.importantDate = on ? importantDate : nil
                                if on { entity.importantDateLabel = importantLabel }
                                entity.dirty = true; try? context.save()
                            }
                        if hasImportantDate {
                            HStack(spacing: 10) {
                                GlassMenuPicker(selection: $importantLabel, options: ["Birthday", "Anniversary", "Other"], label: { $0 })
                                    .frame(width: 130)
                                    .onChange(of: importantLabel) { _, v in entity.importantDateLabel = v; entity.dirty = true; try? context.save() }
                                GlassDateField(date: $importantDate)
                                    .frame(width: 195)
                                    .onChange(of: importantDate) { _, v in entity.importantDate = v; entity.dirty = true; try? context.save() }
                                Spacer()
                            }
                            Text("Shows on your Agenda and the AI can remind you.").font(.system(size: 10)).foregroundStyle(Palette.textTertiary)
                        }
                    }
                    SectionCard(title: "Notes", accent: Palette.violet) {
                        TextField("Anything worth remembering…", text: $notes, axis: .vertical)
                            .lineLimit(3...8).textFieldStyle(.plain).font(.system(size: 13)).foregroundStyle(Palette.textPrimary)
                            .onChange(of: notes) { _, v in
                                entity.notes = v; entity.dirty = true
                                saveTask?.cancel()   // debounce: don't hit disk on every keystroke
                                saveTask = Task { try? await Task.sleep(for: .seconds(0.6)); if !Task.isCancelled { try? context.save() } }
                            }
                    }
                    Button(role: .destructive) {
                        undo.trashSimple(entity, label: "person", context: context); dismiss()
                    } label: { Label("Remove from People", systemImage: "trash") }
                        .buttonStyle(.destructive)
                }
                .padding(18)
            }
        }
        .frame(width: 480, height: 620).flagshipSheet()
        .onAppear {
            notes = entity.notes ?? ""
            if let d = entity.importantDate { importantDate = d; hasImportantDate = true }
            importantLabel = entity.importantDateLabel ?? "Birthday"
        }
    }
}

import SwiftUI
import SwiftData

/// Journal: question-led. A few fresh questions to answer; free writing when you'd rather.
/// Questions come from the existing well (JournalWell + Brain); answering retires a question for good.
struct JournalPage: View {
    @Environment(\.modelContext) private var context
    @Environment(AIManager.self) private var ai
    @Query(filter: #Predicate<JournalPrompt> { $0.status == "open" }, sort: \JournalPrompt.createdAt) private var open: [JournalPrompt]
    @Query(sort: \Letter.createdAt, order: .reverse) private var letters: [Letter]
    @State private var skipped: Set<UUID> = []
    @State private var drafts: [UUID: String] = [:]
    @State private var active: UUID?
    @State private var freeWriting = false
    @State private var freeText = ""
    @State private var expanded: UUID?
    @FocusState private var focus: UUID?
    private let freeId = UUID()

    private var questions: [JournalPrompt] {
        let fresh = open.filter { !skipped.contains($0.id) }
        return Array((fresh.isEmpty ? open : fresh).prefix(3))
    }
    private var entries: [Letter] { letters.filter { $0.deletedAt == nil && $0.kind == "journal" } }

    var body: some View {
        HStack(spacing: 12) {
            Pane {
                PaneHeader(title: "Journal", subtitle: Day.long(.now)) {
                    M3Button(title: JournalWell.shared.filling ? "Thinking…" : "Other questions", icon: Sym.sync, kind: .plain) {
                        withAnimation(Flow.spatial) { skipped.formUnion(questions.map(\.id)) }
                        if !DevMode.isSandboxed { JournalWell.shared.topUp(context, ai: ai, force: true) }
                    }
                    .disabled(JournalWell.shared.filling)
                }
                ScrollView(.vertical, showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 12) {
                        Text(intro).role(.body, MD.onSurfaceVariant).padding(.horizontal, 4).padding(.top, 4)
                        ForEach(Array(questions.enumerated()), id: \.element.id) { i, q in card(q).appear(i + 1) }
                        if freeWriting { freeCard.transition(.opacity.combined(with: .move(edge: .top))) }
                        HStack(spacing: 10) {
                            if !freeWriting {
                                M3Button(title: "Write freely instead", icon: Sym.edit, kind: .tonal, small: true) {
                                    withAnimation(Flow.spatial) { freeWriting = true }; focus = freeId
                                }
                            }
                            Text("A question you’ve answered is never asked again. ⋯ lets you retire one.").role(.supporting, MD.onSurfaceVariant)
                        }
                        .padding(.top, 4)
                    }
                    .padding(.top, 12)
                    .animation(Flow.spatial, value: questions.map(\.id))
                }
            }
            .frame(minWidth: 560)
            Pane { answered }.frame(width: 384)
        }
        .onAppear { if !DevMode.isSandboxed { JournalWell.shared.topUp(context, ai: ai) } }
    }

    private var intro: String {
        if questions.isEmpty {
            if JournalWell.shared.filling { return "Thinking of questions for you…" }
            if !ai.isReady { return "No questions waiting. They’re written by Gemini; add a key in Settings → More settings to get them." }
            return JournalWell.shared.lastStatus ?? "No questions waiting right now. Write freely, or ask for other questions."
        }
        let n = questions.count
        return n == 1 ? "One question for today." : "\(n == 2 ? "Two" : "Three") questions for today. Answer one, all, or none."
    }

    // MARK: Question cards

    private func card(_ q: JournalPrompt) -> some View {
        let on = active == q.id || focus == q.id
        let text = Binding(get: { drafts[q.id] ?? "" }, set: { drafts[q.id] = $0 })
        return VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 12) {
                Text(q.text).font(FS.font(17, 600, rond: 40)).foregroundStyle(MD.onSurface).lineSpacing(4)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Menu {
                    Button("Good question") { q.feedback = q.feedback == "up" ? nil : "up"; q.dirty = true; try? context.save() }
                    Button("Not for me") { retire(q) }
                } label: { Icon(Sym.moreHoriz, size: 20).foregroundStyle(MD.onSurfaceVariant).frame(width: 32, height: 32) }
                    .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
            }
            if let src = source(q) { Text(src).role(.supporting, MD.onSurfaceVariant).padding(.top, 4) }
            TextEditor(text: text)
                .font(FS.font(15, 400)).foregroundStyle(MD.onSurface)
                .scrollContentBackground(.hidden)
                .focused($focus, equals: q.id)
                .frame(minHeight: on ? 96 : 26, maxHeight: on ? 220 : 26)
                .overlay(alignment: .topLeading) {
                    if (drafts[q.id] ?? "").isEmpty {
                        Text("Write a line or two…").font(FS.font(15, 400)).foregroundStyle(MD.onSurfaceVariant.opacity(0.6))
                            .padding(.leading, 5).allowsHitTesting(false)
                    }
                }
                .padding(.top, 10)
            if on {
                HStack(spacing: 8) {
                    M3Button(title: "Save answer", kind: .filled, small: true) { answer(q) }
                        .disabled((drafts[q.id] ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        .keyboardShortcut(.return, modifiers: .command)
                    M3Button(title: "Skip", kind: .plain) { withAnimation(Flow.spatial) { skipped.insert(q.id); active = nil } }
                }
                .padding(.top, 12)
                .transition(.opacity)
            }
        }
        .padding(.horizontal, 20).padding(.vertical, 18)
        .background(RoundedRectangle(cornerRadius: 24, style: .continuous).fill(on ? Surface.pane : Surface.well))
        .overlay(RoundedRectangle(cornerRadius: 24, style: .continuous).strokeBorder(on ? MD.primary : .clear, lineWidth: 2))
        .contentShape(RoundedRectangle(cornerRadius: 24))
        .onTapGesture { withAnimation(Flow.spatial) { active = q.id }; focus = q.id }
        .animation(Flow.spatial, value: on)
    }

    private func source(_ q: JournalPrompt) -> String? {
        if q.source == "followup", let ex = q.sourceExcerpt, !ex.isEmpty { return "Following up on “\(ex)”" }
        if q.source == "project" { return "From your work" }
        return nil
    }

    private var freeCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Whatever’s on your mind").font(FS.font(17, 600)).foregroundStyle(MD.onSurface)
            TextEditor(text: $freeText).font(FS.font(15, 400)).scrollContentBackground(.hidden).focused($focus, equals: freeId)
                .frame(minHeight: 140)
            HStack(spacing: 8) {
                M3Button(title: "Save", kind: .filled, small: true) { saveFree() }
                    .disabled(freeText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                M3Button(title: "Discard", kind: .plain) { withAnimation(Flow.spatial) { freeWriting = false; freeText = "" } }
            }
        }
        .padding(20)
        .background(RoundedRectangle(cornerRadius: 24, style: .continuous).fill(Surface.pane))
        .overlay(RoundedRectangle(cornerRadius: 24, style: .continuous).strokeBorder(MD.primary, lineWidth: 2))
    }

    // MARK: Actions

    private func answer(_ q: JournalPrompt) {
        let body = (drafts[q.id] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty else { return }
        let l = Letter(title: q.text, body: body, kind: "journal"); l.dirty = true
        context.insert(l)
        q.status = "answered"; q.answeredLetterId = l.id; q.resolvedAt = .now; q.dirty = true
        try? context.save()
        drafts[q.id] = nil; active = nil
        if ai.isReady && !DevMode.isSandboxed { let ctx = context, mgr = ai; Task { await Brain.analyzeJournal(ctx, ai: mgr, letter: l, followUp: true) } }
        if !DevMode.isSandboxed { JournalWell.shared.slotOpened(context, ai: ai) }
    }

    private func retire(_ q: JournalPrompt) {
        withAnimation(Flow.spatial) {
            q.status = "dismissed"; q.resolvedAt = .now; q.feedback = "down"; q.dirty = true
            try? context.save()
        }
        if !DevMode.isSandboxed { JournalWell.shared.slotOpened(context, ai: ai) }
    }

    private func saveFree() {
        let body = freeText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty else { return }
        let l = Letter(title: Day.long(.now), body: body, kind: "journal"); l.dirty = true
        context.insert(l); try? context.save()
        if ai.isReady && !DevMode.isSandboxed { let ctx = context, mgr = ai; Task { await Brain.analyzeJournal(ctx, ai: mgr, letter: l, followUp: true) } }
        withAnimation(Flow.spatial) { freeWriting = false; freeText = "" }
    }

    // MARK: Answered

    private var answered: some View {
        let byMonth = Dictionary(grouping: entries) { PHT.startOfMonth($0.createdAt) }
        let months = byMonth.keys.sorted(by: >)
        return VStack(alignment: .leading, spacing: 0) {
            PaneHeader(title: "Answered", big: false) { Text("\(entries.count)").role(.supporting, MD.onSurfaceVariant) }
            ScrollView(.vertical, showsIndicators: false) {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(months, id: \.self) { m in
                        HStack {
                            Text(Day.month(m)).role(.sub, MD.onSurface)
                            Spacer()
                            Text("\(byMonth[m]!.count)").role(.supporting, MD.onSurfaceVariant)
                        }
                        .padding(.horizontal, 4).padding(.top, 20).padding(.bottom, 6)
                        ForEach(byMonth[m]!.prefix(m == months.first ? 8 : 4)) { e in entryRow(e) }
                    }
                }
            }
        }
    }

    private func entryRow(_ e: Letter) -> some View {
        let open = expanded == e.id
        let words = e.body.split { $0 == " " || $0 == "\n" }.count
        return VStack(alignment: .leading, spacing: 4) {
            Text(e.title).role(.row).font(FS.font(14, 600)).lineLimit(open ? nil : 2)
            Text("\(Day.dayMonth(e.createdAt)) · \(words < 12 ? "a few words" : words < 60 ? "a few lines" : "\(words) words")").role(.supporting, MD.onSurfaceVariant)
            if open { Text(e.body).role(.body).padding(.top, 4).textSelection(.enabled).transition(.opacity) }
        }
        .padding(.horizontal, 4).padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .bottom) { Rectangle().fill(Surface.hairline).frame(height: 1) }
        .contentShape(Rectangle())
        .onTapGesture { withAnimation(Flow.spatial) { expanded = open ? nil : e.id } }
    }
}

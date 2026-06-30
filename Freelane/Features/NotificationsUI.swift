import SwiftUI
import SwiftData
import AppKit

enum Notify {
    /// A reminder fires ONCE per occurrence, then stays quiet — even if the user dismisses
    /// it and even after retention purges the record. Without this, every app-focus sweep
    /// re-posted (and re-bannered) the same "payment due" the moment it was dismissed.
    private static let refireDays: Double = 14
    private static let firedStoreKey = "notif.firedKeys"

    private static func recentlyFired(_ key: String) -> Bool {
        let store = UserDefaults.standard.dictionary(forKey: firedStoreKey) as? [String: Double] ?? [:]
        guard let t = store[key] else { return false }
        return Date.now.timeIntervalSince1970 - t < refireDays * 86_400
    }
    private static func markFired(_ key: String) {
        var store = UserDefaults.standard.dictionary(forKey: firedStoreKey) as? [String: Double] ?? [:]
        let cutoff = Date.now.timeIntervalSince1970 - refireDays * 86_400
        store = store.filter { $0.value >= cutoff }   // self-pruning, can't grow unbounded
        store[key] = Date.now.timeIntervalSince1970
        UserDefaults.standard.set(store, forKey: firedStoreKey)
    }

    /// Post an in-app notification, deduped by subject+kind on the same day ("info" is
    /// exempt so the Settings test button always works).
    @MainActor
    static func post(_ context: ModelContext, kind: String, subject: String, body: String? = nil,
                     priority: Int = 0, feature: Feature? = nil) {
        if kind != "info" {
            let today = PHT.startOfDay()
            let dup = FetchDescriptor<AppNotification>(predicate: #Predicate {
                $0.kind == kind && $0.subject == subject && $0.createdAt >= today
            })
            if let existing = try? context.fetch(dup), !existing.isEmpty { return }
        }
        let n = AppNotification(kind: kind, subject: subject, body: body, priority: priority)
        n.linkFeature = feature?.rawValue
        context.insert(n)
        try? context.save()
        if priority >= 1 { NotificationManager.fireBanner(title: subject, body: body) }   // also a real Mac banner
    }

    @MainActor
    static func ask(_ context: ModelContext, subject: String, body: String? = nil,
                    choices: [String], freeText: Bool = true, factKey: String? = nil) {
        let n = AppNotification(kind: "ai_clarifying_question", subject: subject, body: body, priority: 1)
        n.isQuestion = true; n.choices = choices; n.freeText = freeText; n.factKey = factKey
        n.questionKind = "fact"; n.factSubjectKind = "user"
        context.insert(n)
        try? context.save()
        NotificationManager.fireBanner(title: subject, body: body)
    }

    /// A fully-routed curiosity question (entity discovery/clarify/fact).
    @MainActor
    static func askQuestion(_ context: ModelContext, subject: String, body: String? = nil,
                            choices: [String], freeText: Bool = true, questionKind: String,
                            factKey: String? = nil, factSubjectKind: String = "user",
                            candidateName: String? = nil, entityId: String? = nil) {
        let n = AppNotification(kind: "ai_clarifying_question", subject: subject, body: body, priority: 1)
        n.isQuestion = true; n.choices = choices; n.freeText = freeText
        n.questionKind = questionKind; n.factKey = factKey; n.factSubjectKind = factSubjectKind
        n.candidateName = candidateName; n.entityId = entityId
        context.insert(n)
        try? context.save()
        NotificationManager.fireBanner(title: subject, body: body)
    }

    /// Post only if this `dedupKey` hasn't fired recently. Dismissing the notification does
    /// NOT re-arm it — a reminder is a reminder, not an annoyer. Date-scoped keys (bill_due
    /// includes the due timestamp) make the NEXT occurrence a fresh key, so next month's
    /// bill still notifies; ongoing conditions (overdrawn wallet) re-fire after `refireDays`
    /// if still true.
    @MainActor
    static func postUnique(_ context: ModelContext, dedupKey: String, kind: String, subject: String,
                           body: String? = nil, priority: Int = 0, feature: Feature? = nil) {
        // The fired-keys timer is the SOLE gate. We deliberately do NOT also suppress on "an
        // unread row with this key still exists" — that bug meant an ongoing condition (e.g. an
        // overdrawn wallet) left unread would never re-nudge, because the stale unread row
        // blocked it forever. Date-scoped keys (bill_due per occurrence) fire once; ongoing
        // keys re-fire after refireDays.
        if recentlyFired(dedupKey) { return }
        let n = AppNotification(kind: kind, subject: subject, body: body, priority: priority)
        n.linkFeature = feature?.rawValue
        n.dedupKey = dedupKey
        context.insert(n)
        // Stamp "fired" only after a CONFIRMED save — otherwise a failed save would silently
        // suppress this alert for the whole refire window.
        do { try context.save() } catch { context.delete(n); return }
        markFired(dedupKey)
        if priority >= 1 { NotificationManager.fireBanner(title: subject, body: body) }
    }

    /// Notification retention (default 3 days, set in Settings → `notif.retentionDays`).
    /// Deletes notifications that have been read or dismissed and are older than the
    /// window. Unread items and unanswered questions are kept regardless of age, so the
    /// inbox can't grow without bound but nothing actionable is lost.
    @MainActor
    static func purgeOld(_ context: ModelContext) {
        let days = max(1, UserDefaults.standard.object(forKey: "notif.retentionDays") as? Int ?? 3)
        let cutoff = Date.now.addingTimeInterval(-Double(days) * 86_400)
        let all = (try? context.fetch(FetchDescriptor<AppNotification>())) ?? []
        var changed = false
        for n in all {
            // A QUESTION is only "settled" once it has an ANSWER — an unanswered question is kept
            // regardless of age (even if dismissed), honoring "nothing actionable is lost". Other
            // notifications settle once read or dismissed.
            let settled = n.isQuestion ? (n.answer != nil) : (n.dismissedAt != nil || n.readAt != nil)
            let stamp = n.dismissedAt ?? n.readAt ?? n.createdAt
            if settled, stamp < cutoff { context.delete(n); changed = true }
        }
        if changed { try? context.save() }
    }
}

struct BellButton: View {
    var onOpenFeature: (Feature) -> Void
    @Environment(\.modelContext) private var context
    @Query private var all: [AppNotification]
    @State private var open = false
    @State private var answering: AppNotification?
    @AppStorage("notif.muted") private var mutedRaw = ""   // newline-joined notification kinds to suppress

    private var muted: Set<String> { Set(mutedRaw.split(separator: "\n").map(String.init)) }
    private func toggleMute(_ kind: String) {
        var m = muted; if m.contains(kind) { m.remove(kind) } else { m.insert(kind) }
        mutedRaw = m.sorted().joined(separator: "\n")
    }
    /// Live = not dismissed, not muted-by-kind, and not snoozed into the future.
    private var live: [AppNotification] {
        let now = Date()
        return all.filter { $0.dismissedAt == nil && !muted.contains($0.kind) && ($0.snoozedUntil.map { $0 <= now } ?? true) }
            .sorted { $0.createdAt > $1.createdAt }
    }
    private var unread: [AppNotification] { live.filter { $0.readAt == nil } }
    private var read: [AppNotification] { live.filter { $0.readAt != nil } }
    @State private var tab = 0

    var body: some View {
        Button { open.toggle() } label: {
            ZStack(alignment: .topTrailing) {
                Image(systemName: "bell.fill").font(.system(size: 16, weight: .semibold)).foregroundStyle(.white)
                    .frame(width: 44, height: 44)
                if !unread.isEmpty {
                    Text(unread.count > 9 ? "9+" : "\(unread.count)").font(.system(size: 9, weight: .bold)).foregroundStyle(.white)
                        .padding(.horizontal, 5).padding(.vertical, 2).background(Palette.negative, in: Capsule()).offset(x: -2, y: 4)
                }
            }
            .contentShape(Circle())     // the whole circle is clickable, not just the glyph
        }
        .buttonStyle(.plain)
        .glassEffect(Glass.regular, in: .circle)
        .shadow(color: .black.opacity(0.35), radius: 10, y: 4)
        .popover(isPresented: $open, arrowEdge: .top) { popover }
        .sheet(item: $answering) { AnswerSheet(note: $0) }
        .onChange(of: unread.count) { _, n in NSApplication.shared.dockTile.badgeLabel = n > 0 ? "\(n)" : nil }
        .onAppear { NSApplication.shared.dockTile.badgeLabel = unread.isEmpty ? nil : "\(unread.count)" }
    }

    private var popover: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Notifications").font(Typo.title(15)).foregroundStyle(Palette.textPrimary)
                Spacer()
                if !unread.isEmpty { Button("Mark all read") { unread.forEach { $0.readAt = .now }; try? context.save() }.font(.system(size: 11)).buttonStyle(.plain).foregroundStyle(Palette.azure) }
            }.padding(.horizontal, 14).padding(.top, 12).padding(.bottom, 8)

            GlassSegment(options: [0, 1], selection: $tab,
                         label: { $0 == 0 ? "Inbox (\(unread.count))" : "Read" })
                .padding(.horizontal, 12)

            ScrollView {
                let rows = tab == 0 ? unread : read
                if rows.isEmpty {
                    Text(tab == 0 ? "You're all caught up." : "Nothing read yet.")
                        .font(.system(size: 12)).foregroundStyle(Palette.textTertiary).frame(maxWidth: .infinity, minHeight: 80)
                } else {
                    VStack(spacing: 8) { ForEach(rows) { row($0) } }.padding(12)
                }
            }
            if tab == 1 && !read.isEmpty {
                Divider().overlay(.white.opacity(0.08))
                Button("Clear read") { read.forEach { $0.dismissedAt = .now }; try? context.save() }
                    .font(.system(size: 11)).buttonStyle(.plain).foregroundStyle(Palette.textTertiary).padding(10)
            }
        }
        .frame(width: 340, height: 420)
        .flagshipSheet()
    }

    private func row(_ n: AppNotification) -> some View {
        Button { tapped(n) } label: {
            HStack(alignment: .top, spacing: 10) {
                Circle().fill(n.priority >= 1 ? Palette.warning : Palette.azure).frame(width: 7, height: 7).padding(.top, 5)
                VStack(alignment: .leading, spacing: 3) {
                    Text(n.subject).font(.system(size: 12.5, weight: .semibold)).foregroundStyle(Palette.textPrimary).multilineTextAlignment(.leading)
                    if let b = n.body { Text(b).font(.system(size: 11)).foregroundStyle(Palette.textSecondary).lineLimit(3).multilineTextAlignment(.leading) }
                    if let a = n.answer, !a.isEmpty {
                        Label("You answered: \(a)", systemImage: "checkmark.circle.fill")
                            .font(.system(size: 10, weight: .medium)).foregroundStyle(Palette.positive)
                    } else if n.isQuestion {
                        Text("Tap to answer").font(.system(size: 10, weight: .semibold)).foregroundStyle(Palette.azure)
                    }
                    Text(n.createdAt, format: .relative(presentation: .named)).font(.system(size: 9.5)).foregroundStyle(Palette.textTertiary)
                }
                Spacer()
                VStack(spacing: 8) {
                    Button {
                        if n.isQuestion { Curiosity.dismissQuestion(context, note: n) }   // records "don't re-ask" so it can't loop back
                        else { n.dismissedAt = .now; n.readAt = n.readAt ?? .now; try? context.save() }
                    } label: { Image(systemName: "xmark").font(.system(size: 9)).foregroundStyle(Palette.textTertiary) }.buttonStyle(.iconPress)
                    Menu {
                        Button("Snooze to tomorrow", systemImage: "clock") { snooze(n, days: 1) }
                        Button("Snooze a week", systemImage: "clock") { snooze(n, days: 7) }
                        Divider()
                        Button("Mute “\(n.kind)” alerts", systemImage: "bell.slash") { toggleMute(n.kind); try? context.save() }
                    } label: { Image(systemName: "ellipsis").font(.system(size: 10)).foregroundStyle(Palette.textTertiary) }
                        .menuStyle(.borderlessButton).frame(width: 16)
                }
            }
            .padding(11).frame(maxWidth: .infinity, alignment: .leading).glassCard(cornerRadius: Radii.field, interactive: true)
        }.buttonStyle(.cardPress)
    }

    private func snooze(_ n: AppNotification, days: Int) {
        n.snoozedUntil = PHT.calendar.date(byAdding: .day, value: days, to: PHT.startOfDay())
        n.readAt = n.readAt ?? .now    // clear the unread badge while snoozed
        try? context.save()
    }

    private func tapped(_ n: AppNotification) {
        if n.isQuestion, n.answer == nil { answering = n; return }   // already-answered → just a record
        n.readAt = .now; try? context.save()
        if let raw = n.linkFeature, let f = Feature(rawValue: raw) { open = false; onOpenFeature(f) }
    }
}

struct AnswerSheet: View {
    let note: AppNotification
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 10) {
                Image(systemName: "sparkles").foregroundStyle(Palette.azure)
                Text("A quick question").font(Typo.title(16)).foregroundStyle(Palette.textPrimary)
                Spacer()
                Button { dismiss() } label: { Image(systemName: "xmark.circle.fill").font(.system(size: 20)).foregroundStyle(Palette.textTertiary) }
                    .buttonStyle(.iconPress).keyboardShortcut(.cancelAction).help("Close without answering")
            }.padding(18)
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text(note.subject).font(.system(size: 15, weight: .medium)).foregroundStyle(Palette.textPrimary)
                    if let b = note.body { Text(b).font(.system(size: 12)).foregroundStyle(Palette.textSecondary) }
                    ForEach(note.choices, id: \.self) { c in
                        Button { submit(c) } label: {
                            HStack { Text(c).font(.system(size: 13, weight: .medium)).foregroundStyle(Palette.textPrimary); Spacer(); Image(systemName: "chevron.right").font(.system(size: 10)).foregroundStyle(Palette.textTertiary) }
                                .padding(12).frame(maxWidth: .infinity, alignment: .leading).glassCard(cornerRadius: Radii.field, interactive: true)
                        }.buttonStyle(.cardPress)
                    }
                    if note.freeText {
                        LabeledField("Or type your own") {
                            HStack { TextField("Answer…", text: $text).textFieldStyle(GlassFieldStyle()); Button("Send") { submit(text) }.buttonStyle(.glass).disabled(text.isEmpty) }
                        }
                    }
                }.padding(18)
            }
            Divider().overlay(.white.opacity(0.08))
            HStack { Spacer(); Button("Ignore") { Curiosity.dismissQuestion(context, note: note); dismiss() }.buttonStyle(.glass) }.padding(14)
        }
        .frame(width: 440, height: 480).flagshipSheet()
    }

    private func submit(_ answer: String) {
        // Keep the answered question visible (in the Read tab, with the answer recorded) so
        // you can review/correct what you told the AI — retention purges it after 3 days.
        // (It used to set dismissedAt and vanish from both tabs with no trail.)
        note.answer = answer; note.readAt = .now
        try? context.save()
        // The curiosity engine records the answer, creates/enriches entities,
        // follows up if it's vague, then surfaces the next thing to learn.
        Curiosity.handleAnswer(context, note: note, answer: answer)
        dismiss()
    }
}

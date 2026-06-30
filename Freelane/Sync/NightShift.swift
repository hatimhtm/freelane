import Foundation
import SwiftData

/// Daily self-maintenance — the app gets smarter once per PHT day, on the LOCAL model.
/// PRIMARY trigger is the first app open of each day (`maybeRunOnOpen`, ANY hour): with a
/// local-only model the work has to run when you're actually in the app, not at a fixed 02:00
/// the Mac/model may not be up for. The classic overnight path (`maybeRun`, ≥02:00) remains as a
/// fallback for an app left running across the night. A single once-per-day gate
/// (`nightshift.lastDay`) means it runs exactly once however it's triggered. Always off the UI.
enum NightShift {
    private static let lastKey = "nightshift.lastDay"

    static var enabled: Bool {
        get { UserDefaults.standard.object(forKey: "nightshift.on") as? Bool ?? true }
        set { UserDefaults.standard.set(newValue, forKey: "nightshift.on") }
    }

    /// Call from app activation / launch. Cheap no-op unless the nightly run is due.
    @MainActor
    static func maybeRun(_ context: ModelContext, ai: AIManager) {
        Task(priority: .background) { await runIfDue(context, ai: ai, anyHour: false) }
    }

    /// Call on app open / foreground. Runs the daily refresh on the FIRST open of each PHT day at
    /// ANY hour — this is the path the user actually triggers, since the local model isn't running
    /// overnight. Shares the once-per-day gate with `maybeRun`, so the two can never double-run.
    @MainActor
    static func maybeRunOnOpen(_ context: ModelContext, ai: AIManager) {
        Task(priority: .background) { await runIfDue(context, ai: ai, anyHour: true) }
    }

    /// Single owner of the once-per-day gate. `anyHour: true` is the idle-window path
    /// (the Mac is unattended on AC, so "overnight" can happen at 2pm) — used by LocalLLM's
    /// governor; the classic path still waits for 02:00.
    @MainActor
    static func runIfDue(_ context: ModelContext, ai: AIManager, anyHour: Bool) async {
        guard enabled, ai.isReady else { return }
        let today = PHT.dayKey()
        guard UserDefaults.standard.string(forKey: lastKey) != today else { return }
        if !anyHour {
            guard PHT.calendar.component(.hour, from: .now) >= 2 else { return }
        }
        UserDefaults.standard.set(today, forKey: lastKey)
        await run(context, ai: ai)
    }

    static func run(_ context: ModelContext, ai: AIManager) async {
        // 1) Catch up the journal brain: tag entries that never got a sentiment/themes pass
        //    (e.g. written via Shortcuts or while AI was off). Bounded per night.
        let untagged = await MainActor.run {
            (((try? context.fetch(FetchDescriptor<Letter>())) ?? [])
                .filter { $0.deletedAt == nil && $0.sentiment == nil && $0.body.count >= 20 }
                .sorted { $0.createdAt > $1.createdAt }.prefix(8)).map { $0 }
        }
        for l in untagged { _ = await Brain.analyzeJournal(context, ai: ai, letter: l) }

        // 2) Memory hygiene: archive exact-duplicate facts (same subject + same value),
        //    keeping the freshest copy. Pure code — no AI needed.
        await MainActor.run {
            let facts = ((try? context.fetch(FetchDescriptor<AIFact>())) ?? []).filter { $0.archivedAt == nil }
            var seen = Set<String>()
            for f in facts.sorted(by: { $0.updatedAt > $1.updatedAt }) {
                let k = "\(f.subjectKind)|\(f.subjectId ?? "")|\(f.value.lowercased().trimmingCharacters(in: .whitespaces))"
                if seen.contains(k) { f.archivedAt = .now } else { seen.insert(k) }
            }
            try? context.save()
        }

        // 2.5) Refresh duplicate-people detection so the People page greets the morning with it.
        _ = await Brain.findDuplicatePeople(context, ai: ai, force: true)

        // 2.6) Hermes-style memory curation: consolidate the fact store and re-distill the
        //      core digest that every prompt carries (its own ~3-day staleness guard).
        await MemoryCompactor.runIfDue(context, ai: ai)

        // 3) Refresh the slow per-page reads so EVERY page opens fresh — forced once daily on the
        //    local model: mind×money patterns (journal/dashboard) and the accountant insights
        //    (dashboard). generateInsights builds on and de-dupes against prior ones, so a daily
        //    run only ever adds genuinely new insight (or nothing) — it never piles up noise.
        _ = await Brain.mindMoney(context, ai: ai, force: true)
        _ = await Brain.generateInsights(context, ai: ai)

        // 4) Desktop widget wakes up with today's numbers.
        await MainActor.run { WidgetBridge.update(context) }
    }
}

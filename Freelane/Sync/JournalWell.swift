import Foundation
import Observation
import SwiftData

/// Keeps a well of ready-to-answer journal questions, filled in the background.
///
/// It used to be filled by the Journal screen itself: a `.onChange` on the open-question count,
/// which meant nothing was ever generated unless you were *looking at the journal*, and the top-up
/// began at the moment you answered — so the wait for the next question happened while you were
/// sitting there wanting to write the next one. With a target of five, a local 8B model that takes
/// real seconds per question, and a second pass whenever the first breaks a rule, the well was
/// usually near-empty exactly when it mattered. The live store had two questions in it.
///
/// Nothing here is a repair: the model is not failing (12 successes to 2 failures on this store).
/// It is simply slow, and slow work belongs where nobody is waiting on it.
///
/// So the screen no longer generates anything — it reads. This fills the well from the moments
/// that cost nothing: app launch, a question being used up, and the nightly pass. It fills in
/// small batches saved as they land, so questions appear one at a time rather than ten at once
/// after a long silence.
@MainActor
@Observable
final class JournalWell {
    static let shared = JournalWell()
    private init() {}

    /// How many open questions to keep ahead. Ten is roughly a fortnight of journalling for
    /// someone who writes most days, which is the point: you should never see the bottom.
    static let target = 10
    /// Generated per round. Small on purpose — each round is saved before the next begins, so the
    /// first questions are usable long before the last one is written.
    private static let batch = 3

    /// True while a fill is in flight, so the screen can say "Thinking…" honestly instead of
    /// guessing from its own local flag.
    private(set) var filling = false
    /// Set when a top-up ends without producing anything, so the UI can say why rather than
    /// showing a short list with no explanation.
    private(set) var lastStatus: String?

    /// When a round produced nothing new, wait before trying again rather than spinning the GPU
    /// against a model that has run out of things to ask.
    private var exhaustedUntil: Date?

    static func openCount(_ context: ModelContext) -> Int {
        let d = FetchDescriptor<JournalPrompt>(predicate: #Predicate { $0.status == "open" })
        return (try? context.fetchCount(d)) ?? 0
    }

    /// Fill the well. Safe to call from anywhere, as often as you like — it returns immediately if
    /// a fill is already in flight, if the well is full, or if the last attempt came up dry.
    ///
    /// `force` is the "New questions" button: it ignores the backoff and always asks for a round,
    /// because a person pressing a button deserves an attempt even if the model was quiet before.
    func topUp(_ context: ModelContext, ai: AIManager, force: Bool = false) {
        guard ai.isReady, !filling else { return }
        if !force, let until = exhaustedUntil, until > .now { return }

        let open = Self.openCount(context)
        let need = force ? max(Self.batch, Self.target - open) : Self.target - open
        guard need > 0 else { return }

        filling = true
        lastStatus = nil
        // .utility so a long local generation never competes with typing or scrolling.
        Task(priority: .utility) { [weak self] in
            defer { self?.filling = false }
            var remaining = need
            var producedAnything = false

            while remaining > 0 {
                let want = min(Self.batch, remaining)
                // Over-ask: the dedup and the human-question gate reject a good fraction, and a
                // round that asks for exactly what it needs reliably lands short.
                let texts = await Brain.journalPrompts(context, ai: ai, count: want + 1)
                let added = Brain.storeJournalPrompts(context, texts: texts, source: "ai")
                if added == 0 {
                    // Dry round. Back off — but only report it when the whole top-up produced
                    // nothing, because a partial fill is a success from where the user is sitting.
                    self?.exhaustedUntil = Date.now.addingTimeInterval(15 * 60)
                    if !producedAnything {
                        let brain = ai.smartLead?.shortLabel ?? "no brain"
                        self?.lastStatus = texts.isEmpty
                            ? "The \(brain) couldn't write anything usable just now. It'll try again shortly — or just write."
                            : "Everything it came up with was too close to something you've already been asked."
                    }
                    return
                }
                producedAnything = true
                remaining -= added
                self?.exhaustedUntil = nil
                // Yield between rounds so saved questions render before the next round starts.
                await Task.yield()
            }
        }
    }

    /// A question was answered or dismissed — a slot opened, so the model probably has room to be
    /// useful again even if the last round was dry.
    func slotOpened(_ context: ModelContext, ai: AIManager) {
        exhaustedUntil = nil
        topUp(context, ai: ai)
    }
}

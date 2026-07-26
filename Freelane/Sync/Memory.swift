import Foundation
import SwiftData

// MARK: - What the app is allowed to believe about its user
//
// This layer exists because the old one produced a store like this, verbatim, on real data:
//
//     journal_1784966887   "Sold the motorbike in May"           (inferred)
//     corrected_1784966887 "Actually I never did this, I never sold a motorbike"
//     journal_1784135989   "I never spoke those words to anyone"
//     corrected_1784055901 "Actually I never paid Max anything — he pays me as my boss"
//
// Three separate faults, all of which are fixed here rather than prompted around:
//
//  1. KEYS LEAKED INTO PROMPTS. Facts were rendered as "key: value", and the keys were raw
//     timestamps, so the model read `journal_1784966887` as if it were a thing in the user's life
//     and wrote it into questions: "…like the 1000 euro contract from journal_1784966887??".
//     Fix: nothing outside this file ever sees a key. `brief()` renders VALUES only.
//
//  2. CORRECTIONS PILED UP INSTEAD OF CORRECTING. When the user said "I never sold a motorbike",
//     that sentence was saved as one more belief alongside the claim it was refuting — so the store
//     held both, and the wrong one usually won because it was written first.
//     Fix: a correction is its own kind of row, and writing one ARCHIVES what it contradicts,
//     including any earlier correction on the same subject. Newest wins, always.
//     What a correction is NOT is a negation: it is stored and shown exactly as the user wrote it,
//     because "I never sold a motorbike" is itself a true statement about them.
//
//  3. NOTHING EVER AGED. An "inferred" guess from a single sentence carried the same weight a year
//     later as a fact the user typed themselves.
//     Fix: confidence decays with age for inferred rows; the user's own words never decay.

@MainActor
enum Memory {

    /// Where a belief came from. Ordering matters: the user's own words always win.
    enum Source: String {
        case userAnswered = "user_answered"   // they typed it or tapped it
        case inferred                          // the model read it out of something they wrote
        case seeded                            // shipped default

        var trust: Double {
            switch self {
            case .userAnswered: return 1.0
            case .inferred:     return 0.6
            case .seeded:       return 0.4
            }
        }
    }

    // MARK: Writing

    /// Record something the user has asserted is TRUE about them.
    ///
    /// `topic` is a short human phrase ("motorbike", "work schedule") used only to group and
    /// de-duplicate. It is never shown to a model — it exists so a later statement about the same
    /// subject can supersede this one instead of piling up beside it.
    static func remember(_ context: ModelContext, topic: String, fact: String,
                         confidence: Double = 0.8, source: Source = .inferred,
                         subjectKind: String = "user", subjectId: String? = nil) {
        let value = fact.trimmingCharacters(in: .whitespacesAndNewlines)
        // WHAT COUNTS AS A REAL ANSWER DEPENDS ON WHO SAID IT.
        //
        // `isRealText` is a filter for model output: it rejects echoed schema placeholders and
        // demands ten characters and eight letters, because a one-word "insight" from a language
        // model is almost always junk. Applying it to a HUMAN's answer was catastrophic and
        // completely silent — "Groceries" is nine characters, so tapping the app's own first
        // choice chip stored nothing at all and the question came straight back. So did
        // "Transport", "Bills", "Cat", "Dog", "Family", "Friend", "Work", "Home", "Person",
        // "Pet", "Place" and the "skipped" marker a dismissal writes. Almost every button this
        // app offers was under the limit, so almost no chip answer had ever been recorded.
        //
        // A person typing an answer has already decided it's worth saying. Take it as given.
        let plausible = source == .userAnswered
            ? !value.isEmpty
            : AIJSON.isRealText(value)
        guard plausible, value.count <= 240 else { return }
        // A sentence that NEGATES is not a fact, whatever the model labelled it. This is the guard
        // that would have caught "I never spoke those words to anyone" being stored as a belief.
        guard !readsAsDenial(value) else { deny(context, statement: value); return }

        let key = slug(topic.isEmpty ? String(value.prefix(40)) : topic)
        let id = factID(subjectKind, subjectId, key)
        let existing = fetch(context, id: id)

        // Don't let a low-confidence guess overwrite something the user stated themselves.
        if let existing, existing.source == Source.userAnswered.rawValue,
           source != .userAnswered, existing.archivedAt == nil { return }

        if let row = existing {
            row.value = value
            row.confidence = confidence
            row.source = source.rawValue
            row.polarity = "affirm"
            row.updatedAt = .now
            row.archivedAt = nil
        } else {
            let f = AIFact(subjectKind: subjectKind, subjectId: subjectId, key: key,
                           value: value, confidence: confidence, source: source.rawValue)
            f.polarity = "affirm"
            context.insert(f)
        }
        try? context.save()
    }

    /// Record a CORRECTION — the user putting the app right — and retire whatever it contradicts.
    ///
    /// The statement is stored as written, because it is true: "I never sold a motorbike" and "I
    /// don't feel good with food anymore" are both facts. What makes this different from
    /// `remember` is the second half — it goes looking for what the app previously believed on
    /// this subject and archives it, so the store can never hold a claim and its retraction at once.
    static func deny(_ context: ModelContext, statement: String) {
        let text = statement.trimmingCharacters(in: .whitespacesAndNewlines)
        guard AIJSON.isRealText(text) else { return }
        let clean = String(stripDenialPreamble(text).prefix(200))
        let tokens = contentTokens(clean)
        guard !tokens.isEmpty else { return }

        // Retire every belief this contradicts. Inferred beliefs go at a low bar (they were
        // guesses); the user's own earlier words need a strong overlap to be overturned, because
        // two of their own statements are more likely to be about different things.
        //
        // Earlier CORRECTIONS are superseded too, on a containment test rather than a similarity
        // one. This user's store held both "I never sold a motorbike" and "I sold the motorbike in
        // May" — two corrections written weeks apart, sharing only two words, so no similarity
        // threshold would ever have caught the pair. What identifies them is that the shorter one's
        // subject sits entirely inside the longer one. Newest wins.
        var retired = 0
        for f in live(context) {
            let other = contentTokens(f.value)
            let overlap = jaccard(other, tokens)
            let shared = other.intersection(tokens).count
            let containment = other.isEmpty ? 0 : Double(shared) / Double(max(1, min(other.count, tokens.count)))

            let supersedes: Bool
            if f.polarity == "deny" {
                supersedes = shared >= 2 && (containment >= 0.6 || overlap >= 0.4)
            } else {
                supersedes = overlap >= (f.source == Source.userAnswered.rawValue ? 0.55 : 0.30)
            }
            if supersedes { f.archivedAt = .now; f.updatedAt = .now; retired += 1 }
        }

        let key = "not_" + slug(String(clean.prefix(48)))
        let id = factID("user", nil, key)
        if let row = fetch(context, id: id) {
            row.value = clean; row.updatedAt = .now; row.archivedAt = nil
        } else {
            let f = AIFact(subjectKind: "user", subjectId: nil, key: key, value: clean,
                           confidence: 1.0, source: Source.userAnswered.rawValue)
            f.polarity = "deny"
            context.insert(f)
        }
        try? context.save()
        moneyLog.notice("Memory: denial recorded, retired \(retired, privacy: .public) contradicted belief(s).")
    }

    /// Forget a belief outright (the user deleting it in Settings).
    static func forget(_ context: ModelContext, _ fact: AIFact) {
        fact.archivedAt = .now; fact.updatedAt = .now
        try? context.save()
    }

    // MARK: Reading

    /// What the model is told about the user — **values only, never keys**, most trusted first,
    /// hard-capped so it can never blow a context window.
    ///
    /// Every line here is a TRUE statement in the user's own frame. That sounds obvious and is the
    /// subtlest thing in this file: a retraction like *"I never sold a motorbike"* is itself a true
    /// statement, and the first version of this method listed retractions under a heading reading
    /// "NOT true about them" — which inverts them. On this user's real data that heading would have
    /// asserted that he DOES feel good about food and DID sell a motorbike, from the very sentences
    /// he wrote to correct exactly those mistakes. Retractions are grouped, never negated.
    static func brief(_ context: ModelContext, maxChars: Int = 700) -> String {
        let rows = live(context).filter { $0.subjectKind == "user" }
        let stated = rows.filter { $0.polarity != "deny" }.sorted { weight($0) > weight($1) }
        let corrections = rows.filter { $0.polarity == "deny" }.sorted { $0.updatedAt > $1.updatedAt }

        var out = ""
        var used = 0
        for f in stated {
            let line = "- \(f.value)\n"
            if used + line.count > maxChars { break }
            out += line; used += line.count
        }
        if !corrections.isEmpty {
            // Framed as what it is: things they had to put the app right about. A model reading
            // this treats them as settled and — the whole point — stops raising the topic.
            var block = "\nThings they have corrected the app on. Each line is TRUE, and the topic is closed:\n"
            for f in corrections.prefix(10) {
                let line = "- \(f.value)\n"
                if used + block.count + line.count > maxChars + 320 { break }
                block += line
            }
            out += block
        }
        return out.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Just the corrections — for prompts that need the guardrail but not the biography.
    static func corrections(_ context: ModelContext, limit: Int = 12) -> [String] {
        live(context).filter { $0.polarity == "deny" }
            .sorted { $0.updatedAt > $1.updatedAt }
            .prefix(limit).map(\.value)
    }

    static func live(_ context: ModelContext) -> [AIFact] {
        ((try? context.fetch(FetchDescriptor<AIFact>())) ?? []).filter { $0.archivedAt == nil }
    }

    /// Age-adjusted trust. A guess from four months ago is not worth what it was on the day.
    /// The user's own words are exempt — those don't rot.
    static func weight(_ f: AIFact) -> Double {
        guard f.source != Source.userAnswered.rawValue else { return 1.0 + f.confidence }
        let days = max(0, Date.now.timeIntervalSince(f.updatedAt) / 86_400)
        let decay = pow(0.5, days / 120.0)     // half-life: four months
        return f.confidence * decay
    }

    // MARK: One-time repair of the pre-v1 store

    /// The old store is not salvageable by reasoning over it — it contains a belief and its
    /// negation side by side, keyed by timestamps. So: retire everything the model inferred, keep
    /// what the user actually confirmed, and convert the "Actually I never…" corrections into real
    /// denials so their signal survives the reset.
    ///
    /// Runs once, guarded by a defaults flag.
    @discardableResult
    static func repairLegacyStoreIfNeeded(_ context: ModelContext) -> Int {
        let flag = "memory.repaired.v4"
        guard !UserDefaults.standard.bool(forKey: flag) else { return 0 }

        let all = (try? context.fetch(FetchDescriptor<AIFact>())) ?? []
        var corrections: [(at: Date, text: String)] = []
        var retired = 0

        for f in all where f.archivedAt == nil {
            let isTimestampKeyed = f.key.hasPrefix("journal_") || f.key.hasPrefix("corrected_")
                || f.key.hasPrefix("curiosity_")
            // Corrections carry real signal — harvest them before retiring the row. This also
            // re-collects rows written by an earlier run of this repair (`not_…`), so the pass is
            // safe to re-run and the de-duplication below gets to see everything at once.
            //
            // Only these two key prefixes, never "any row that happens to read like a denial".
            // The looser test dragged in model meta-commentary ("Writer doesn't identify a durable
            // fact") and fragments of generated letters, and stored them as things the user said.
            if f.key.hasPrefix("corrected_") || f.key.hasPrefix("not_"), isUsableCorrection(f.value) {
                corrections.append((f.createdAt, f.value))
            }

            if isTimestampKeyed || f.key.hasPrefix("not_") || f.source == Source.inferred.rawValue {
                f.archivedAt = .now; f.updatedAt = .now
                retired += 1
            }
        }
        // Vendor identifications and answered questions are real knowledge — left alone.
        try? context.save()

        // Replayed OLDEST FIRST, so `deny` can do its job: each correction supersedes the earlier
        // ones it contradicts, and the most recent thing the user said is what survives. Replaying
        // in any other order would leave the stale half of a contradiction as the winner.
        var count = 0
        for c in corrections.sorted(by: { $0.at < $1.at }) {
            deny(context, statement: c.text)
            count += 1
        }

        // The distilled digest was built FROM the polluted store, so it is polluted too.
        UserDefaults.standard.removeObject(forKey: "memory.coreDigest")
        UserDefaults.standard.set(true, forKey: flag)
        moneyLog.notice("Memory: repair retired \(retired, privacy: .public) beliefs, kept \(count, privacy: .public) corrections.")
        return retired
    }

    /// Is this old row actually something the USER said about themselves?
    ///
    /// The legacy store mixed three things under one roof: the user's corrections, the model's
    /// commentary about its own output, and chunks of generated prose. Only the first is worth
    /// carrying forward, and it is recognisable — a first-person statement, not a question, not
    /// written *about* the user in the third person.
    private static func isUsableCorrection(_ s: String) -> Bool {
        let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        guard t.count >= 12, t.count <= 180 else { return false }
        guard !t.hasSuffix("?") else { return false }                       // a question, not a fact
        let lower = t.lowercased()
        // Written about them rather than by them — model output that leaked into the store.
        let thirdPerson = ["writer", "the user", "they write", "you write", "this entry", "the entry"]
        guard !thirdPerson.contains(where: { lower.contains($0) }) else { return false }
        // Must actually be first person.
        let firstPerson = ["i ", "i'", "i’", "my ", "me ", "we ", "never ", "it's ", "it’s "]
        guard firstPerson.contains(where: { lower.hasPrefix($0) }) || lower.contains(" i ") else { return false }
        // Truncated mid-sentence by an old prefix cap — better dropped than half-remembered.
        guard t.last.map({ ".!\"”'’".contains($0) || $0.isLetter == false || t.count < 160 }) ?? false else { return false }
        return true
    }

    /// Re-run the repair from scratch (Settings → "Reset what Freelane knows"). Everything the
    /// model ever inferred goes; what the user typed or tapped stays.
    static func resetInferredBeliefs(_ context: ModelContext) {
        for f in live(context) where f.source == Source.inferred.rawValue {
            f.archivedAt = .now; f.updatedAt = .now
        }
        try? context.save()
    }

    // MARK: Helpers

    /// Does this sentence assert that something is NOT the case? Matched in code, never left to
    /// model judgement — a user writing "I never had loans" is a command, not a nuance.
    static func readsAsDenial(_ s: String) -> Bool {
        let t = " " + s.lowercased() + " "
        let markers = [" never ", " didn't ", " did not ", " don't ", " do not ", " doesn't ",
                       " isn't ", " is not ", " wasn't ", " was not ", " no longer ", " not true",
                       " that's wrong", " thats wrong", " i don't have", " i dont have"]
        return markers.contains { t.contains($0) }
    }

    /// Strip the conversational lead-in so the stored denial reads as a statement.
    private static func stripDenialPreamble(_ s: String) -> String {
        var t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        for p in ["actually, ", "actually ", "no, ", "no — ", "well, "] {
            if t.lowercased().hasPrefix(p) { t = String(t.dropFirst(p.count)); break }
        }
        return t.prefix(1).uppercased() + t.dropFirst()
    }

    /// Meaningful words, for deciding whether two statements are about the same thing.
    static func contentTokens(_ s: String) -> Set<String> {
        let stop: Set<String> = ["the","a","an","and","or","but","to","of","in","on","for","is","are",
            "was","were","do","does","did","you","your","i","me","my","that","this","it","with","what",
            "how","when","why","who","been","have","has","had","about","they","their","them","one",
            "more","most","some","any","get","got","like","just","never","not","dont","didnt","actually",
            "really","very","much","from","would","could","should","can","will","its"]
        let cleaned = s.lowercased().map { $0.isLetter || $0.isNumber ? $0 : " " }
        return Set(String(cleaned).split(separator: " ").map(String.init)
            .filter { $0.count > 2 && !stop.contains($0) })
    }

    static func jaccard(_ a: Set<String>, _ b: Set<String>) -> Double {
        guard !a.isEmpty, !b.isEmpty else { return 0 }
        let union = a.union(b).count
        return union == 0 ? 0 : Double(a.intersection(b).count) / Double(union)
    }

    /// The canonical key form. Internal rather than private because callers that build a fact ID
    /// by hand MUST use the same one — `remember` slugs whatever topic it's given, so a caller
    /// slugging with a different rule (dashes, say) writes a row it can never find again.
    nonisolated static func slug(_ s: String) -> String {
        let mapped = s.lowercased().map { $0.isLetter || $0.isNumber ? $0 : "_" }
        return String(mapped).split(separator: "_").joined(separator: "_")
    }

    /// The address of a fact. Internal, and the ONLY way anyone should compute one.
    ///
    /// It was private, so every reader built its own string instead — and `remember` slugs the key
    /// on the way in while the hand-built readers didn't, so any key containing a space or a dash
    /// was written to one address and looked up at another. That is how a vendor could be answered
    /// twenty times and never once count as identified.
    nonisolated static func factID(_ kind: String, _ id: String?, _ key: String) -> String {
        func esc(_ s: String) -> String { s.replacingOccurrences(of: ":", with: "_") }
        return "\(esc(kind)):\(esc(id ?? "_")):\(esc(slug(key)))"
    }

    private static func fetch(_ context: ModelContext, id: String) -> AIFact? {
        var d = FetchDescriptor<AIFact>(predicate: #Predicate { $0.id == id })
        d.fetchLimit = 1
        return (try? context.fetch(d))?.first
    }
}

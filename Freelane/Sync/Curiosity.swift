import Foundation
import SwiftData

/// The curiosity engine: it keeps asking about everything it doesn't fully
/// understand — new names in your spends, who people are, what they like, prices,
/// foundational habits — and the moment an answer is vague it follows up to nail it.
/// One question is shown at a time, but answering instantly surfaces the next, so it
/// feels relentless without flooding the inbox.
@MainActor
enum Curiosity {

    // MARK: Vague-answer detection

    static let vaguePhrases: Set<String> = [
        "idk", "i dont know", "i don't know", "dunno", "not sure", "maybe", "sometimes",
        "a friend", "friend", "someone", "a person", "a place", "a thing", "stuff", "things",
        "kinda", "sort of", "kind of", "whatever", "no idea", "?", "na", "n/a",
        // Filipino
        "hindi ko alam", "di ko alam", "ewan", "ewan ko", "siguro", "baka", "minsan",
        "kaibigan", "isang kaibigan", "tao", "isang tao", "kung ano", "basta",
        // Spanish
        "no sé", "no se", "no lo sé", "tal vez", "quizás", "quizas", "a veces",
        "alguien", "un amigo", "una amiga", "una cosa", "algo", "ni idea"
    ]
    static func isVague(_ s: String) -> Bool {
        let t = s.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
        if t.count < 2 { return true }
        if vaguePhrases.contains(t) { return true }
        // NOTE: short single words like "Mom", "Rex", "May" are valid answers — don't flag
        // them vague (that used to re-pester the user on perfectly good replies).
        return false
    }
    private static func isFollowUp(_ note: AppNotification) -> Bool {
        note.subject.hasPrefix("Just to be clear")
    }

    /// The user is telling us this isn't a real person/pet/place/thing — stop tracking it.
    static func isNonEntity(_ a: String) -> Bool {
        let t = a.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
        let signals = ["not a person", "not a pet", "not a place", "not a thing", "not important",
                       "nothing", "ignore", "delete", "remove it", "a verb", "it's a verb", "its a verb",
                       "an expression", "expression", "a saying", "not real", "not an entity",
                       "doesn't matter", "doesnt matter", "skip it"]
        return signals.contains { t.contains($0) }
    }

    // MARK: Denylist (names you said don't matter)

    private static let denyKey = "entity.denylist"
    static func denylist() -> Set<String> { Set(UserDefaults.standard.stringArray(forKey: denyKey) ?? []) }
    static func deny(_ name: String) {
        var d = denylist(); d.insert(name.lowercased()); UserDefaults.standard.set(Array(d), forKey: denyKey)
    }

    /// The user dismissed/ignored a clarifying question WITHOUT answering it. Dismissing used
    /// to record nothing, so the very next sweep regenerated the identical question — that's why
    /// "what kind of place is <store>?" and "is <X> a person?" felt stuck on infinite repeat.
    /// Treat a dismissal as a soft "don't ask me this again" by writing the same suppression
    /// memory an answer would have, keyed by the question's kind.
    @MainActor
    static func dismissQuestion(_ context: ModelContext, note: AppNotification) {
        switch note.questionKind {
        case "entity_discovery":
            if let c = note.candidateName { deny(c) }   // never ask "who/what is X?" again
        case "entity_clarify":
            if let eid = note.entityId, let key = note.factKey {
                Brain.upsertFact(context, subjectKind: "entity", subjectId: eid, key: key, value: "skipped")
            }
        default:   // "fact" — includes the vendor_<slug> "what kind of place" question
            if let key = note.factKey { Brain.upsertFact(context, key: key, value: "skipped") }
        }
        note.dismissedAt = .now
        note.readAt = note.readAt ?? .now
        try? context.save()
    }

    // MARK: Candidate discovery from spends

    static let stopwords: Set<String> = [
        "food", "lunch", "dinner", "breakfast", "snack", "coffee", "load", "bills", "bill",
        "rent", "groceries", "grocery", "transport", "grab", "fare", "gas", "water", "electric",
        "internet", "phone", "sadaka", "gift", "payment", "salary", "cash", "the", "and", "for",
        "with", "from", "this", "that", "today", "yesterday", "month", "week", "monday", "tuesday",
        "wednesday", "thursday", "friday", "saturday", "sunday", "january", "february", "march",
        "april", "may", "june", "july", "august", "september", "october", "november", "december"
    ]

    private static func capitalizedTokens(_ text: String) -> [String] {
        text.split { !$0.isLetter }.map(String.init).filter { w in
            guard w.count >= 3, let f = w.first, f.isUppercase else { return false }
            if w == w.uppercased() { return false }          // skip ALL-CAPS acronyms
            return true
        }
    }

    /// Top unknown names appearing in recent spends (not already an entity, vendor brand, or denied).
    static func candidateEntities(_ context: ModelContext) -> [(name: String, count: Int)] {
        // Bound the scan to the 250 most-recent spends (was an unsorted fetch-all + arbitrary
        // .prefix(250), so the "recent" set was actually whatever order the store returned).
        var sd = FetchDescriptor<Spend>(sortBy: [SortDescriptor(\.spentAt, order: .reverse),
                                                 SortDescriptor(\.createdAt, order: .reverse)])
        sd.fetchLimit = 250
        let spends = (try? context.fetch(sd)) ?? []
        let entities = (try? context.fetch(FetchDescriptor<Entity>())) ?? []
        let known = Set(entities.map { $0.name.lowercased() })
        let deny = denylist()
        var counts: [String: (Int, String)] = [:]
        for s in spends {
            let text = [s.vendorName, s.spendDescription, s.notes].compactMap { $0 }.joined(separator: " ")
            for tok in capitalizedTokens(text) {
                let key = tok.lowercased()
                if known.contains(key) || deny.contains(key) || stopwords.contains(key) { continue }
                if Brand.match(tok) != nil { continue }            // a known money rail/brand
                if VendorBrand.match(tok) != nil { continue }      // a known everyday vendor (Greenwich, Jollibee…)
                let prev = counts[key]?.0 ?? 0
                counts[key] = (prev + 1, tok)
            }
        }
        return counts.values.map { ($0.1, $0.0) }.sorted { $0.1 > $1.1 }
    }

    // MARK: The sweep — pick the next thing to ask, if nothing's open

    static func sweep(_ context: ModelContext) {
        let openQ = FetchDescriptor<AppNotification>(predicate: #Predicate {
            $0.isQuestion && $0.dismissedAt == nil && $0.answer == nil
        })
        if let open = try? context.fetch(openQ), !open.isEmpty { return }

        // 1) Enrich an entity we already know but don't fully understand.
        if let (entity, key, prompt, choices) = nextEntityGap(context) {
            Notify.askQuestion(context, subject: prompt,
                               body: "Helps me keep track of \(entity.name).",
                               choices: choices, freeText: true, questionKind: "entity_clarify",
                               factKey: key, factSubjectKind: "entity", entityId: entity.id.uuidString)
            return
        }

        // 3) Discover a new name we keep seeing — ONLY as a fallback when AI is off. With a
        //    key, real people are extracted by Brain.understandSpend (it knows a verb like
        //    "Got" isn't a name and a store like "Greenwich" isn't a person), so this naive
        //    capitalized-word guess never fires and can't ask "who is Got?".
        if KeyStore.get() == nil,
           let cand = candidateEntities(context).first(where: { $0.count >= 2 })?.name {
            Notify.askQuestion(context, subject: "Who or what is “\(cand)”?",
                               body: "It keeps showing up in your spending — tell me so I can track it.",
                               choices: ["Person", "Pet", "Place", "A thing", "Not important"],
                               freeText: true, questionKind: "entity_discovery", candidateName: cand)
            return
        }

        // 4) Identify a vendor we don't recognize.
        if let vendor = Brain.topUnidentifiedVendor(context) {
            Notify.askQuestion(context, subject: "What kind of place is \(vendor)?",
                               body: "You've spent here a few times — tell me so I can group and recognize it.",
                               choices: ["Groceries", "Eating out", "Transport", "Bills"], freeText: true,
                               questionKind: "fact", factKey: "vendor_" + Brain.slug(vendor))
            return
        }

        // 5) AI-led curiosity (replaced the canned "ladder"): ONE question born from this
        //    user's actual state — or silence, when nothing is genuinely worth asking.
        Task { @MainActor in
            let ai = AIManager()
            guard ai.isReady else { return }
            if let q = await Brain.curiosityQuestion(context, ai: ai) {
                // Re-check AFTER the await: two sweeps fired close together (focus + answer)
                // can both pass the top guard while this Task is still generating, then each
                // post a question. Bail if one landed in the meantime — one open question at a time.
                let openNow = FetchDescriptor<AppNotification>(predicate: #Predicate {
                    $0.isQuestion && $0.dismissedAt == nil && $0.answer == nil
                })
                if let open = try? context.fetch(openNow), !open.isEmpty { return }
                Notify.ask(context, subject: q.subject, body: q.body.isEmpty ? nil : q.body,
                           choices: q.choices, freeText: true, factKey: q.factKey)
            }
        }
    }

    /// The next missing fact for an entity — questions are tailored to its KIND, so a
    /// pet never gets asked "what's your connection?" and a thing never gets a birthday.
    private static func nextEntityGap(_ context: ModelContext) -> (Entity, String, String, [String])? {
        let entities = (try? context.fetch(FetchDescriptor<Entity>()))?
            .filter { $0.introduced && !$0.archived }.sorted { $0.createdAt > $1.createdAt } ?? []
        for e in entities {
            let eid = e.id.uuidString
            func missing(_ k: String) -> Bool { !Brain.hasFact(context, subjectKind: "entity", subjectId: eid, key: k) }
            switch e.kind {
            case .person:
                if (e.relationship ?? "").isEmpty, missing("relationship") {
                    return (e, "relationship", "What's your connection to \(e.name)?", ["Family", "Friend", "Partner", "Work", "Neighbor"])
                }
                if missing("likes") { return (e, "likes", "What does \(e.name) love or always want?", ["Food", "A gadget", "Not sure"]) }
                if missing("birthday") { return (e, "birthday", "When's \(e.name)'s birthday (a month is fine)?", ["Skip"]) }
            case .pet:
                if missing("pet_type") { return (e, "pet_type", "What kind of animal is \(e.name)?", ["Cat", "Dog", "Bird", "Other"]) }
                if missing("birthday") { return (e, "birthday", "When did you get \(e.name) (or their birthday)?", ["Skip"]) }
            case .place:
                if missing("place_type") { return (e, "place_type", "What kind of place is \(e.name)?", ["Home", "Work", "A shop", "A city", "Other"]) }
            case .thing, .concept, .unknown:
                // Don't pester non-people. Ask once what it is, then leave it alone.
                if (e.relationship ?? "").isEmpty, missing("what_is") {
                    return (e, "what_is", "In a few words, what is \(e.name)?", ["Skip"])
                }
            }
        }
        return nil
    }

    // MARK: Handle an answer (and immediately follow up if it's vague)

    static func handleAnswer(_ context: ModelContext, note: AppNotification, answer raw: String) {
        let answer = raw.trimmingCharacters(in: .whitespacesAndNewlines)

        switch note.questionKind {
        case "entity_discovery":
            let low = answer.lowercased()
            if low == "not important" || low == "skip" || isNonEntity(answer) {
                if let c = note.candidateName { deny(c) }    // never ask about it again
            } else if let name = note.candidateName {
                let kind = mapKind(answer)
                let e = Entity(name: name, kind: kind, confidence: 1.0, introduced: true, discoveredFrom: "spend")
                if kind == .unknown, !chipMatches(answer) { e.relationship = answer }   // free-text description
                e.dirty = true
                context.insert(e)
                try? context.save()
                // The next, KIND-APPROPRIATE question is chosen by sweep() below — no
                // hardcoded "what's your connection?" for pets/things.
            }

        case "entity_clarify":
            // The user correcting us ("it's not a person / a verb / ignore") removes it.
            if isNonEntity(answer), let eid = note.entityId, let e = entity(context, eid) {
                e.archived = true; e.dirty = true; deny(e.name); try? context.save(); return
            }
            if let eid = note.entityId, let key = note.factKey {
                Brain.upsertFact(context, subjectKind: "entity", subjectId: eid, key: key, value: answer)
                if key == "relationship", let e = entity(context, eid) { e.relationship = answer; e.dirty = true; try? context.save() }
                if isVague(answer), !isFollowUp(note), answer.lowercased() != "skip" {
                    Notify.askQuestion(context, subject: "Just to be clear — \(sharper(key, note))",
                                       body: nil, choices: [], freeText: true, questionKind: "entity_clarify",
                                       factKey: key, factSubjectKind: "entity", entityId: eid)
                    try? context.save(); return
                }
            }

        case "tag_spend":
            if let sid = note.entityId, let uid = UUID(uuidString: sid), let s = Brain.fetchSpend(context, uid) {
                s.tags = [answer]; s.category = answer; s.dirty = true; try? context.save()
            }

        case "anomaly_spend":
            if answer.lowercased().contains("one-off") || answer.lowercased().contains("don't count"),
               let sid = note.entityId, let uid = UUID(uuidString: sid), let s = Brain.fetchSpend(context, uid) {
                if !s.tags.contains("one-off") { s.tags.append("one-off") }   // excluded from everyday pace
                s.dirty = true; try? context.save()
            }

        default: // "fact" / legacy user fact
            if let key = note.factKey {
                Brain.upsertFact(context, key: key, value: answer)
                if isVague(answer), !isFollowUp(note) {
                    Notify.ask(context, subject: "Just to be clear — could you say a bit more?",
                               body: note.subject, choices: [], freeText: true, factKey: key)
                    try? context.save(); return
                }
            }
        }

        try? context.save()
        sweep(context)
    }

    private static func mapKind(_ a: String) -> EntityKind {
        switch a.lowercased() {
        case "person": return .person
        case "pet": return .pet
        case "place": return .place
        case "a thing", "thing": return .thing
        case "concept", "something else": return .concept
        default: return .unknown
        }
    }
    private static func chipMatches(_ a: String) -> Bool {
        ["person", "pet", "place", "a thing", "thing"].contains(a.lowercased())
    }
    private static func sharper(_ key: String, _ note: AppNotification) -> String {
        switch key {
        case "relationship": return "how exactly do you know them?"
        case "likes": return "what's one specific thing they'd love?"
        case "birthday": return "roughly when — a month is fine?"
        case "pet_type": return "is it a cat, dog, or something else?"
        case "place_type": return "what sort of place — home, a shop, a city?"
        case "what_is": return "just a couple of words is fine."
        default: return "could you say a bit more?"
        }
    }
    private static func entity(_ context: ModelContext, _ id: String) -> Entity? {
        guard let uid = UUID(uuidString: id) else { return nil }
        let d = FetchDescriptor<Entity>(predicate: #Predicate { $0.id == uid })
        return (try? context.fetch(d))?.first
    }
}

import Foundation
#if canImport(FoundationModels)
import FoundationModels
#endif

// MARK: - The shapes the AI is allowed to return
//
// Every structured AI call in the app answers with one of these types. On Apple's brains they are
// `@Generable`, which means the schema is enforced *during decoding* — the model is not asked
// nicely for JSON, it is physically unable to emit anything else. Wrong category? Impossible: the
// field is `.anyOf` a fixed list. Six questions when we asked for three? Impossible: `.count`.
//
// That replaces the old approach — freeform "Reply with ONLY a JSON object…" prompts parsed by
// brace-matching — which is where most of the app's AI breakage came from. When a small model
// returned a stray fence, a truncated object, or an echoed placeholder, the parse failed, the
// `try?` swallowed it, and the feature silently rendered nothing. Hence "it doesn't load".
//
// The `jsonShape` on each type is the fallback contract for the local MLX brain, which has no
// guided decoding — there the shape is described in words and the reply is parsed and validated.
// Rule that keeps the two paths honest: **describe the shape, never show example values.** This
// model family will copy a literal `"…"` out of a prompt and return it as content.

#if canImport(FoundationModels)

/// Shared vocabularies — declared once so the prompt, the guided schema, and the validation code
/// can never drift apart. (They used to be three separate hardcoded lists.)
enum AIVocab {
    static let spendCategories = ["Food", "Eating out", "Groceries", "Transport", "Bills",
                                  "Health", "Cigarettes", "Pet", "Gifts", "Tech", "Sadaka", "Other"]
    static let merchantKinds = ["store", "restaurant", "online", "service", "transport",
                                "utility", "grocery", "person", "unknown"]
    static let observationAreas = ["money", "spending", "life", "pattern"]
}

// MARK: Journal

/// ONE journaling question. Generated per-territory rather than as a batch: a batch prompt has to
/// carry every territory's context at once, which is what blew the on-device context window and
/// made "New questions" fail most of the time. One tight prompt per question also means a failure
/// costs one question instead of the whole batch.
@Generable
struct AIJournalQuestion: Sendable {
    @Guide(description: "The question itself. Under 15 words, plain spoken words like a close friend texting, exactly one idea, ends with a single question mark. No metaphors, no therapy-speak, no em-dashes.")
    var question: String

    static let jsonShape = #"{"question": a single question string}"#
}

/// What a finished journal entry tells us. `durableFact`, `correction` and `followUp` are empty
/// strings when they don't apply — an empty string is unambiguous where a missing key was not.
@Generable
struct AIJournalReading: Sendable {
    @Guide(description: "One lowercase word for the mood of the entry.")
    var sentiment: String

    @Guide(description: "Up to three short themes, one or two words each.", .maximumCount(3))
    var themes: [String]

    @Guide(description: "One durable fact about the writer worth remembering long-term — a lasting preference, situation, relationship or goal they STATED AS TRUE. Empty string if the entry only contains passing moods, or if the writer was denying or correcting something.")
    var durableFact: String

    @Guide(description: "True only when the writer pushes back on the QUESTION itself: asks to stop being asked, says they aren't interested in the topic, or says the question's premise is false. Venting about hard life stuff is NOT pushback.")
    var pushback: Bool

    @Guide(description: "When the writer corrects something the app believed about them, state the CORRECTED truth plainly in one sentence. Empty string when nothing was corrected.")
    var correction: String

    @Guide(description: "One follow-up question, only if the entry clearly leaves a thread worth pulling another day. Same style rules as any question: under 15 words, plain, one question mark. Empty string if nothing earns one — most entries don't.")
    var followUp: String

    static let jsonShape = #"{"sentiment": one lowercase word, "themes": array of at most 3 short strings, "durableFact": string or empty, "pushback": boolean, "correction": string or empty, "followUp": string or empty}"#
}

// MARK: Spending

/// One logged spend, understood: what it was, who sold it, and whether a real person was named.
@Generable
struct AISpendReading: Sendable {
    @Guide(description: "The single best category for this spend.", .anyOf(AIVocab.spendCategories))
    var category: String

    @Guide(description: "The store, business or brand name if there is one, corrected for typos. Empty string if the spend names no business.")
    var merchant: String

    @Guide(description: "What kind of thing the merchant is. A verb like got/bought/paid/sent is never a merchant. Filipino ride types (tricycle, trike, jeepney, habal-habal, pedicab, taxi, angkas) are transport.", .anyOf(AIVocab.merchantKinds))
    var merchantKind: String

    @Guide(description: "The merchant's official website domain, inferred even if the name was misspelled. Empty string if this is not a known business.")
    var domain: String

    @Guide(description: "A real given NAME of a person mentioned. Never a relationship word (wife, mom, friend), never a store, never a vehicle type. Empty string if no actual person is named.")
    var personName: String

    @Guide(description: "How confident this reading is.", .range(0...1))
    var confidence: Double

    static let jsonShape = #"{"category": one of the listed labels, "merchant": string or empty, "merchantKind": one of the listed kinds, "domain": string or empty, "personName": string or empty, "confidence": number between 0 and 1}"#
}

/// Category labels for a spend the reader couldn't place — the cheap second pass.
@Generable
struct AISpendTags: Sendable {
    @Guide(description: "One or two category labels for this spend.", .count(1...2), .element(.anyOf(AIVocab.spendCategories)))
    var tags: [String]

    static let jsonShape = #"{"tags": array of 1 or 2 labels from the list}"#
}

// MARK: Observations (what replaced "insights")

/// A single observation. `evidence` is the load-bearing field: the model must name the actual rows
/// the claim rests on, and code checks that the evidence contains real figures or names before the
/// observation is allowed to be stored. That check is what stops "guilt-driven gifting" — a claim
/// about motive has no rows to cite, so it cannot produce evidence and it gets dropped.
@Generable
struct AIObservation: Sendable {
    @Guide(description: "The observation itself: one plain sentence, at most 18 words, stating only what the data shows. Never a motive, a diagnosis, a judgement, or a claim about how they feel. Lead with the finding.")
    var text: String

    @Guide(description: "Which area this belongs to.", .anyOf(AIVocab.observationAreas))
    var area: String

    @Guide(description: "The specific figures, dates, vendors or entry dates this observation is computed from, copied from the data given. If you cannot cite specific data for it, it is not an observation — leave this empty and do not include it.")
    var evidence: String
}

@Generable
struct AIObservationBatch: Sendable {
    @Guide(description: "Only observations that are genuinely supported by the data. Returning none is correct and expected when nothing stands out.", .maximumCount(4))
    var observations: [AIObservation]

    static let jsonShape = #"{"observations": array of at most 4 objects, each with "text", "area" (one of the listed areas) and "evidence"}"#
}

// MARK: Curiosity

/// The bell's one clarifying question. `shouldAsk` false means silence — which is the right
/// answer most of the time, and the schema makes that a first-class outcome rather than a
/// malformed reply that code has to interpret.
@Generable
struct AICuriosityAsk: Sendable {
    @Guide(description: "False unless there is genuinely something worth asking that is not already known and has not been asked before. Silence is better than a repeat.")
    var shouldAsk: Bool

    @Guide(description: "The question: one short interrogative sentence ending in a question mark.")
    var question: String

    @Guide(description: "One short statement — not a question — saying why this is being asked.")
    var why: String

    @Guide(description: "Two to four short ANSWERS the user can tap. Statements only, never questions, at most five words each.", .count(2...4))
    var choices: [String]

    @Guide(description: "A snake_case label for what the answer records, e.g. primary_vehicle.")
    var factKey: String

    static let jsonShape = #"{"shouldAsk": boolean, "question": string, "why": string, "choices": array of 2 to 4 short answer strings, "factKey": snake_case string}"#
}

// MARK: People

@Generable
struct AIDupeGroup: Sendable {
    @Guide(description: "The id of the entry to KEEP — a real name beats a relationship word; the most complete record wins ties.")
    var keep: String
    @Guide(description: "The ids of entries that are the same real person and should fold into the kept one.", .minimumCount(1))
    var merge: [String]
    @Guide(description: "Short reason these are the same person.")
    var why: String
}

@Generable
struct AIDupeGroups: Sendable {
    @Guide(description: "Only groups that clearly refer to one real person. Two different real names are never the same person. Empty when nothing is a duplicate.", .maximumCount(8))
    var groups: [AIDupeGroup]

    static let jsonShape = #"{"groups": array of objects, each with "keep" (id string), "merge" (array of id strings) and "why"}"#
}

// MARK: Misc structured returns

/// The daily one-line read and other single-sentence returns. Having a type (rather than raw text)
/// means the length rule is enforced by the schema instead of hoped for in prose.
@Generable
struct AISentence: Sendable {
    @Guide(description: "One plain sentence. No preamble, no advice, no moralising.")
    var sentence: String

    static let jsonShape = #"{"sentence": a single sentence string}"#
}

// MARK: Personal context

/// The daily digest built from local signals (Messages / Calendar / Reminders / Safari).
/// `doing` and `reading` are separate fields for one reason: v1 merged them and the model asserted
/// a news article the user had merely READ as something they were DOING — it told this user he was
/// preparing for a singing competition in Manila that never existed. Reading is not doing, and the
/// schema now makes that distinction structural rather than a line in a prompt.
@Generable
struct AILifeDigest: Sendable {
    @Guide(description: "Things they are actually doing, taken ONLY from their own messages, calendar and reminders. Each one needs at least two supporting signals. Never put anything they merely browsed here.", .maximumCount(5))
    var doing: [String]

    @Guide(description: "Topics they have been looking into, from browsing. Reading about a thing is not doing it. Skip one-off visits, news of the day and entertainment headlines.", .maximumCount(5))
    var reading: [String]

    @Guide(description: "Real person NAMES they exchange messages with. Never a service, app or company name, never an abbreviation or a fragment of one.", .maximumCount(5))
    var people: [String]

    @Guide(description: "One-sentence reminders a thoughtful friend would keep — an event they are attending per their calendar, a decision they are weighing in their own words.", .maximumCount(3))
    var notes: [String]

    static let jsonShape = #"{"doing": array of short strings, "reading": array of short strings, "people": array of names, "notes": array of short strings}"#
}

// MARK: Clients

@Generable
struct AIClientFact: Sendable {
    @Guide(description: "A short snake_case label for what this fact is about, e.g. pays_late or prefers_email.")
    var key: String
    @Guide(description: "The fact itself, in a few words.")
    var value: String
}

@Generable
struct AIClientFacts: Sendable {
    @Guide(description: "Durable facts worth remembering about this client. Only things actually stated in the notes.", .maximumCount(10))
    var facts: [AIClientFact]

    static let jsonShape = #"{"facts": array of objects, each with "key" (snake_case) and "value"}"#
}

// MARK: Receipts

@Generable
struct AIPriceVerdict: Sendable {
    @Guide(description: "The item's name, copied exactly as it was given.")
    var item: String
    @Guide(description: "A short verdict on the price paid versus the typical Philippine retail price — a handful of words, including the typical price when known.")
    var verdict: String
}

@Generable
struct AIPriceVerdicts: Sendable {
    @Guide(description: "One verdict per item given.", .maximumCount(24))
    var verdicts: [AIPriceVerdict]

    static let jsonShape = #"{"verdicts": array of objects, each with "item" and "verdict"}"#
}

/// A typical daily cost-of-living figure, in whole pesos.
@Generable
struct AIDailyCost: Sendable {
    @Guide(description: "A realistic typical daily personal discretionary spend in Philippine pesos — food, transport, small everyday needs, not rent or big monthly bills.", .range(100...5000))
    var pesosPerDay: Int

    static let jsonShape = #"{"pesosPerDay": whole number between 100 and 5000}"#
}

#endif

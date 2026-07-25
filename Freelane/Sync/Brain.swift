import Foundation
import SwiftData
#if canImport(FoundationModels)
import FoundationModels
#endif

/// The app's intelligence layer: cache-first, structured, and grounded.
///
/// Everything here follows four rules learned the hard way from the previous version, whose output
/// the user summarised as "it looks bad, and it breaks":
///
///  1. **Structure is enforced, not requested.** Every call that needs a shape asks for a
///     `@Generable` type. There is no "Reply with ONLY a JSON object" prompt left in this file,
///     because that phrasing is what produced silently-empty features when a small model added a
///     code fence or truncated an object.
///  2. **Never show the model an example value.** This model family copies literal placeholders
///     out of a prompt and returns them as content — that's where a Journal full of "…" came from.
///     Shapes are described in words; the schema does the rest.
///  3. **Prompts are budgeted.** Every block that grows without bound — ask history, beliefs,
///     entries — is capped in characters. Shipping the full history once made generation *throw*,
///     which `try?` turned into "New questions does nothing".
///  4. **Claims must be sourced.** Anything asserted about the user's life traces to a row they
///     wrote or a figure the app computed. No motives, no diagnoses, no narration of feelings.
@MainActor
enum Brain {

    // MARK: - PHT day

    static func phtDay(_ date: Date = .now) -> String {
        let f = DateFormatter()
        f.calendar = PHT.calendar; f.timeZone = PHT.zone; f.dateFormat = "yyyy-MM-dd"
        return f.string(from: date)
    }

    // MARK: - Brain cache

    /// Returns a cached payload only when it's still fresh: same PHT day, not past `staleAt`, and
    /// the input fingerprint still matches. Otherwise nil → regenerate.
    static func cached(_ context: ModelContext, key: String, fingerprint: String?) -> String? {
        guard let row = fetchCache(context, key: key) else { return nil }
        if phtDay(row.generatedAt) != phtDay() { return nil }
        if let s = row.staleAt, Date.now >= s { return nil }
        if let fp = fingerprint, let stored = row.fingerprint, stored != fp { return nil }
        return row.payload
    }

    /// A persistent cache read that IGNORES the per-day gate — for content keyed by a stable hash
    /// (e.g. understandSpend by text+amount), which stays valid across days until its TTL.
    static func cachedStable(_ context: ModelContext, key: String) -> String? {
        guard let row = fetchCache(context, key: key) else { return nil }
        if let s = row.staleAt, Date.now >= s { return nil }
        return row.payload
    }

    static func store(_ context: ModelContext, key: String, payload: String,
                      ttl: TimeInterval? = nil, fingerprint: String? = nil) {
        let staleAt = ttl.map { Date.now.addingTimeInterval($0) }
        if let row = fetchCache(context, key: key) {
            row.payload = payload; row.generatedAt = .now; row.staleAt = staleAt; row.fingerprint = fingerprint
        } else {
            context.insert(BrainCache(key: key, payload: payload, staleAt: staleAt, fingerprint: fingerprint))
        }
        try? context.save()
    }

    private static func fetchCache(_ context: ModelContext, key: String) -> BrainCache? {
        var d = FetchDescriptor<BrainCache>(predicate: #Predicate { $0.key == key })
        d.fetchLimit = 1
        return (try? context.fetch(d))?.first
    }

    // MARK: - The standing voice
    //
    // One role, shared by every prose call, so the app sounds like one thing. The prohibitions are
    // specific on purpose: each line corresponds to something the previous version actually said
    // to this user and got wrong.
    static let voice = """
    You are the assistant inside Freelane, a private life and money app used by exactly one person: \
    a freelancer living in the Philippines. Base currency PHP, timezone PHT.

    How you speak: plain, warm, direct. Short sentences. The register of a close friend who is good \
    with numbers — not a coach, not a therapist, not a brand.

    What you must never do:
    · Never invent a figure, a date, a name, or an event. If it is not in what you were given, it \
      did not happen.
    · Never explain WHY they did something. You cannot see motives. "Guilt-driven", "emotional \
      void", "a ritual to restore balance" — this kind of sentence is forbidden even when it \
      sounds insightful.
    · Never diagnose, moralise, or tell them what they should do.
    · Never use therapy language, metaphors, em-dashes, or rhetorical questions.
    · Never assert something listed as NOT true about them.
    """

    // MARK: - Grounded chat

    /// A grounded answer. `history` is a short ring buffer of prior turns (newest last) so the
    /// assistant remembers the thread within a session.
    ///
    /// The model can CALL TOOLS for exact figures instead of trusting a pre-built summary — and
    /// unlike the previous version, that now works on every brain including offline, because tool
    /// calling is native to the on-device model rather than a cloud-only feature.
    static func answer(_ context: ModelContext, ai: AIManager, page: String, question: String,
                       history: [(mine: Bool, text: String)] = []) async -> String {
        guard ai.isReady else { return ai.unavailableReason }

        let beliefs = Memory.brief(context, maxChars: 500)
        let instructions = """
        \(voice)

        You are on the \(page) page. Answer in one to four short sentences using their real numbers. \
        Prefer calling a tool to look something up over estimating from the summary below. If you \
        cannot answer, say so plainly.

        What you know about them:
        \(beliefs.isEmpty ? "Not much yet." : beliefs)
        """

        let convo = history.suffix(5).map { ($0.mine ? "Them: " : "You: ") + $0.text }.joined(separator: "\n")
        let threaded = convo.isEmpty ? question : "Conversation so far:\n\(convo)\n\nTheir question: \(question)"
        let snapshot = String(StateSnapshot.text(context, includePersonal: true).prefix(3_000))
        let prompt = "Current state:\n\(snapshot)\n\n\(threaded)"

        let toolData = AIToolData.load(context)
        do {
            if #available(macOS 26.0, *) {
                return try await ai.smart.text(AIRequest(prompt, instructions: instructions),
                                               tools: AIToolbox.tools(toolData))
            }
        } catch {
            moneyLog.error("Brain.answer failed: \(error.localizedDescription, privacy: .public)")
        }
        return "I couldn't reach a model just now. Try again in a moment."
    }

    // MARK: - Daily calm read (cache-first; posts at most once per PHT day)

    /// One factual line about where money stands today, dropped in the inbox once per PHT day and
    /// only when the state actually changed. Falls back to a computed sentence with no AI at all.
    static func dailyCalmRead(_ context: ModelContext, ai: AIManager) async {
        let fp = StateSnapshot.fingerprint(context)
        if cached(context, key: "daily_calm", fingerprint: fp) != nil { return }   // already done today

        let d = StateSnapshot.load(context)
        let safe = SafeToSpend.compute(payments: d.payments, spends: d.spends, wallets: d.wallets,
                                       ledger: d.ledger, recurrings: d.recurrings, plans: d.plans)
        func money(_ v: Double) -> String { CurrencyFormat.string(v, d.baseCurrency, compact: true) }

        // The deterministic version is genuinely good, so it's the default rather than a sad
        // fallback — the model only gets to replace it if it produces something valid.
        var body = "Safe to spend \(money(safe.liveRemaining)) today · \(money(d.metrics.landedMTD)) landed this month · \(money(d.metrics.outstandingBase)) owed to you."
        if ai.isReady {
            let prompt = """
            Summarise this person's money today in ONE sentence of at most 22 words. Use their real \
            numbers. State the position; give no advice.

            \(String(StateSnapshot.text(context, includePersonal: false).prefix(2_000)))
            """
            if let r = try? await ai.fast.object(AISentence.self, AIRequest(prompt, instructions: voice),
                                                 jsonShape: AISentence.jsonShape),
               AIJSON.isRealText(r.sentence) {
                body = r.sentence.trimmingCharacters(in: .whitespacesAndNewlines)
            }
        }

        store(context, key: "daily_calm", payload: body, fingerprint: fp)
        Notify.post(context, kind: "daily_read", subject: "Today's read", body: body, priority: 0, feature: .dashboard)
    }

    /// A deeper read of the money "weather", shown when the calm banner is tapped. Cached per
    /// state fingerprint so repeat taps are free.
    static func weatherDetail(_ context: ModelContext, ai: AIManager) async -> String {
        let fp = StateSnapshot.fingerprint(context)
        if let c = cached(context, key: "weather_detail", fingerprint: fp) { return c }
        guard ai.isReady else { return "" }
        let prompt = """
        Here is their money state right now:
        \(String(StateSnapshot.text(context, includePersonal: false).prefix(2_500)))

        In two to four short sentences, say plainly what is going on with their money today, using \
        their real numbers. If things are fine, say so clearly and stop. Note that wallets marked \
        ignored and one-off purchases are already excluded from the everyday picture.
        """
        let r = (try? await ai.smart.text(AIRequest(prompt, instructions: voice))) ?? ""
        if !r.isEmpty { store(context, key: "weather_detail", payload: r, fingerprint: fp) }
        return r
    }

    // MARK: - Spending intelligence

    static let spendCategories = AIVocab.spendCategories

    static func fetchSpend(_ context: ModelContext, _ id: UUID) -> Spend? {
        let d = FetchDescriptor<Spend>(predicate: #Predicate { $0.id == id })
        return (try? context.fetch(d))?.first
    }

    /// After a spend is logged: understand it and whisper if it's unusual. Never blocks.
    static func onSpendLogged(_ context: ModelContext, ai: AIManager, spendId: UUID) async {
        guard let s = fetchSpend(context, spendId) else { return }
        await understandSpend(context, ai: ai, spend: s)
        anomalyWhisper(context, spend: s)
        receiptWhisper(context, spend: s)
    }

    /// ONE structured pass that actually understands a spend: category, what KIND of place the
    /// merchant is (so a store is never mistaken for a person), and whether a real person was
    /// named. The category and merchant kind are constrained by the schema, so an out-of-vocabulary
    /// answer — which used to fall through to a pointless "what was this for?" question — cannot
    /// happen any more.
    static func understandSpend(_ context: ModelContext, ai: AIManager, spend: Spend) async {
        let text = [spend.vendorName, spend.spendDescription, spend.notes].compactMap { $0 }
            .joined(separator: " ").trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { return }
        guard ai.isReady else {
            if spend.tags.isEmpty { await autoCategorize(context, ai: ai, spend: spend) }
            return
        }

        // Cache by a STABLE key (text + amount): re-logging the same thing skips the model.
        let cacheKey = "understand:" + slug(text) + ":" + String(Int(spend.amountBase.rounded()))
        var reading: AISpendReading?

        if let raw = cachedStable(context, key: cacheKey),
           let data = raw.data(using: .utf8),
           let cachedContent = try? GeneratedContent(json: String(data: data, encoding: .utf8) ?? ""),
           let value = try? AISpendReading(cachedContent) {
            reading = value
        } else {
            let prompt = """
            Read this single personal expense from the Philippines.
            Spend: "\(text)" for \(CurrencyFormat.string(spend.amountBase, "PHP", compact: true)).
            \(Corrections.fewShot())
            """
            reading = try? await ai.fast.object(AISpendReading.self,
                                                AIRequest(prompt, instructions: voice, temperature: 0.2),
                                                jsonShape: AISpendReading.jsonShape)
            if let reading, let json = try? GeneratedContent(reading).jsonString {
                store(context, key: cacheKey, payload: json, ttl: 90 * 86400)
            }
        }

        guard let u = reading else {
            if spend.tags.isEmpty { await autoCategorize(context, ai: ai, spend: spend) }
            return
        }

        // Category — the schema guarantees it's in vocabulary, so only confidence is in question.
        if spend.tags.isEmpty {
            if u.confidence >= 0.45 {
                spend.tags = [u.category]; spend.category = u.category; spend.dirty = true
            } else {
                await autoCategorize(context, ai: ai, spend: spend)
            }
        }

        // Merchant — record what KIND of place it is, so the curiosity engine never asks "is
        // <store> a person" and the vendor-identify question skips it for good.
        if u.merchantKind != "person", u.merchantKind != "unknown" {
            if let vn = spend.vendorName?.trimmingCharacters(in: .whitespaces), !vn.isEmpty {
                setVendorKind(context, name: vn, kind: u.merchantKind, confidence: u.confidence)
                if !u.domain.isEmpty { VendorLogo.remember(name: vn, domain: u.domain) }
            }
            if !u.merchant.isEmpty {
                setVendorKind(context, name: u.merchant, kind: u.merchantKind, confidence: u.confidence)
                if !u.domain.isEmpty { VendorLogo.remember(name: u.merchant, domain: u.domain) }
            }
        }

        // A named person → ASK before tracking them. Never auto-create an entity the user then has
        // to go and delete.
        if !u.personName.isEmpty, u.personName.lowercased() != u.merchant.lowercased() {
            considerPerson(context, name: ContactsBridge.resolveFullName(u.personName) ?? u.personName)
        }
        try? context.save()
    }

    /// Vendor identifications are app knowledge, not beliefs about the user — they live under
    /// their own subject so they never appear in the "what I know about them" brief.
    static func setVendorKind(_ context: ModelContext, name: String, kind: String, confidence: Double) {
        Memory.remember(context, topic: slug(name), fact: kind, confidence: confidence,
                        source: .inferred, subjectKind: "vendor", subjectId: slug(name))
    }

    static func vendorIsIdentified(_ context: ModelContext, name: String) -> Bool {
        let id = "vendor:\(slug(name)):\(slug(name))"
        var d = FetchDescriptor<AIFact>(predicate: #Predicate { $0.id == id && $0.archivedAt == nil })
        d.fetchLimit = 1
        return ((try? context.fetch(d))?.isEmpty == false)
    }

    /// Known person → link. Unknown → post ONE clarifying question so the user decides whether to
    /// track them; "Not important" denylists it forever.
    static func considerPerson(_ context: ModelContext, name: String) {
        let clean = name.trimmingCharacters(in: .whitespaces)
        guard clean.count >= 2 else { return }
        // Backstop: a ride is not a person, and neither is a relationship word. The schema tells
        // the model this, but a literal rule must never depend on model compliance.
        let notPeople: Set<String> = ["tricycle", "trike", "tricy", "jeepney", "jeep", "habal",
                                      "habal-habal", "pedicab", "kuliglig", "taxi", "angkas", "bus",
                                      "wife", "husband", "mom", "mother", "dad", "father", "brother",
                                      "sister", "son", "daughter", "friend", "family", "kids", "baby",
                                      "girlfriend", "boyfriend", "partner", "cousin", "uncle", "aunt",
                                      "grandma", "grandpa", "lola", "lolo", "nanay", "tatay", "kuya", "ate"]
        if notPeople.contains(clean.lowercased()) { Curiosity.deny(clean); return }
        let entities = (try? context.fetch(FetchDescriptor<Entity>())) ?? []
        if entities.contains(where: { $0.name.lowercased() == clean.lowercased() }) {
            ensurePerson(context, name: clean, relationship: nil)
            return
        }
        if Curiosity.denylist().contains(clean.lowercased()) { return }
        let open = (try? context.fetch(FetchDescriptor<AppNotification>()))?.contains {
            $0.isQuestion && $0.answer == nil && ($0.candidateName?.lowercased() == clean.lowercased())
        } ?? false
        if open { return }
        Notify.askQuestion(context, subject: "You spent on “\(clean)” — who or what is that?",
                           body: "Tell me so I can track them, or skip if it doesn't matter.",
                           choices: ["Person", "Pet", "Place", "A thing", "Not important"],
                           freeText: true, questionKind: "entity_discovery", candidateName: clean)
    }

    /// Link an existing person (or create one when the user confirms via a question).
    static func ensurePerson(_ context: ModelContext, name: String, relationship: String?) {
        let clean = name.trimmingCharacters(in: .whitespaces)
        guard clean.count >= 2 else { return }
        let rel = relationship?.replacingOccurrences(of: "my ", with: "").trimmingCharacters(in: .whitespaces)
        let entities = (try? context.fetch(FetchDescriptor<Entity>())) ?? []
        // Match by NAME only — matching by relationship would merge two different "friend"s.
        if let existing = entities.first(where: { $0.name.lowercased() == clean.lowercased() }) {
            existing.lastEventAt = .now
            if (existing.relationship ?? "").isEmpty, let rel, !rel.isEmpty { existing.relationship = rel }
            existing.dirty = true
            return
        }
        let e = Entity(name: clean, kind: .person, confidence: 0.85, introduced: true, discoveredFrom: "spend")
        if let rel, !rel.isEmpty { e.relationship = rel }
        e.lastEventAt = .now; e.dirty = true
        context.insert(e)
    }

    /// A quiet one-line "receipt" only when meaningful (a repeat vendor this week).
    static func receiptWhisper(_ context: ModelContext, spend: Spend) {
        guard let v = spend.vendorName, !v.isEmpty else { return }
        let all = (try? context.fetch(FetchDescriptor<Spend>())) ?? []
        let weekStart = PHT.startOfWeek()
        let count = all.filter { ($0.vendorName?.lowercased() == v.lowercased()) && $0.spentAt >= weekStart }.count
        guard count >= 3 else { return }
        let week = String(Brain.phtDay(weekStart).prefix(10))
        Notify.postUnique(context, dedupKey: "receipt:\(v.lowercased()):\(week):\(count)",
                          kind: "receipt", subject: "\(count)× \(v) this week",
                          body: "Just noticing — no judgment.", priority: 0, feature: .spending)
    }

    /// Recognize what a spend is and tag it; if it can't, ask.
    static func autoCategorize(_ context: ModelContext, ai: AIManager, spend: Spend) async {
        let text = [spend.vendorName, spend.spendDescription, spend.notes].compactMap { $0 }
            .joined(separator: " ").trimmingCharacters(in: .whitespaces)
        if ai.isReady, !text.isEmpty {
            let prompt = """
            Tag this spend from the Philippines.
            Spend: "\(text)" for \(CurrencyFormat.string(spend.amountBase, "PHP", compact: true)).
            """
            if let r = try? await ai.fast.object(AISpendTags.self,
                                                 AIRequest(prompt, instructions: voice, temperature: 0.2),
                                                 jsonShape: AISpendTags.jsonShape),
               !r.tags.isEmpty {
                spend.tags = r.tags; spend.category = r.tags.first; spend.dirty = true
                try? context.save(); return
            }
        }
        let label = text.isEmpty ? CurrencyFormat.string(spend.amountBase, "PHP", compact: true) + " spend" : text
        Notify.askQuestion(context, subject: "What was “\(label)” for?",
                           body: "Tag it so I can track and budget it right.",
                           choices: ["Food", "Eating out", "Groceries", "Transport", "Bills", "Other"],
                           freeText: true, questionKind: "tag_spend", entityId: spend.id.uuidString)
    }

    /// Whisper when a spend is notably bigger than the everyday pace (correctable).
    static func anomalyWhisper(_ context: ModelContext, spend: Spend) {
        let all = (try? context.fetch(FetchDescriptor<Spend>())) ?? []
        let typical = SafeToSpend.typicalDailySpend(all)
        guard typical > 0, spend.amountBase > typical * 3, spend.amountBase <= typical * 5 else { return }
        let mult = Int((spend.amountBase / typical).rounded())
        let what = spend.vendorName ?? spend.spendDescription ?? "that"
        Notify.askQuestion(context,
                           subject: "A bigger one: \(CurrencyFormat.string(spend.amountBase, "PHP", compact: true)) at \(what)",
                           body: "About \(mult)× your usual day. All good, or should I keep it out of your everyday pace?",
                           choices: ["That's normal", "One-off — don't count it"], freeText: false,
                           questionKind: "anomaly_spend", entityId: spend.id.uuidString)
    }

    /// When a variable bill rises notably, post a heads-up.
    static func flagBillIncrease(_ context: ModelContext, ai: AIManager, label: String,
                                 prior: Double, now: Double, currency: String) async {
        guard prior > 0, now > prior * 1.2 else { return }
        let pct = Int(((now - prior) / prior) * 100)
        var body = "Up ~\(pct)% — \(CurrencyFormat.string(prior, currency, compact: true)) → \(CurrencyFormat.string(now, currency, compact: true))."
        if ai.isReady {
            let p = """
            A recurring bill called "\(label)" went from \(Int(prior)) to \(Int(now)) \(currency). \
            In ONE short sentence, name the most likely everyday reasons — more usage, a new \
            appliance, seasonal rates. No lists, no advice.
            """
            if let r = try? await ai.fast.object(AISentence.self, AIRequest(p, instructions: voice),
                                                 jsonShape: AISentence.jsonShape),
               AIJSON.isRealText(r.sentence) {
                body += " " + r.sentence.trimmingCharacters(in: .whitespacesAndNewlines)
            }
        }
        Notify.post(context, kind: "bill_up", subject: "\(label) went up", body: body, priority: 1, feature: .spending)
    }

    // MARK: - Cost of living (makes safe-to-spend location-aware)

    /// Asks what a realistic typical DAILY discretionary spend is in the user's city, so
    /// safe-to-spend anchors to real local cost of living. Refreshes ~every 2 weeks.
    static func refreshCostOfLiving(_ context: ModelContext, ai: AIManager) async {
        guard ai.isReady else { return }
        let last = UserDefaults.standard.double(forKey: "col.refreshedAt")
        if Date.now.timeIntervalSince1970 - last < 14 * 86400 { return }
        let city = UserDefaults.standard.string(forKey: "user.city") ?? "San Pablo, Laguna, Philippines"
        let prompt = "For someone living in \(city) in 2026, what is a realistic typical daily personal discretionary spend?"
        guard let r = try? await ai.fast.object(AIDailyCost.self, AIRequest(prompt, instructions: voice, temperature: 0.2),
                                                jsonShape: AIDailyCost.jsonShape) else { return }
        let n = Double(r.pesosPerDay)
        // Self-tuning: blend the model's city estimate with the OBSERVED everyday pace, so the
        // anchor becomes theirs over time rather than a generic city average.
        let observed = SafeToSpend.typicalDailySpend((try? context.fetch(FetchDescriptor<Spend>())) ?? [])
        let blended = observed > 100 ? (0.6 * n + 0.4 * observed).rounded() : n
        UserDefaults.standard.set(blended, forKey: "col.dailyBase")
        UserDefaults.standard.set(Date.now.timeIntervalSince1970, forKey: "col.refreshedAt")
    }

    // MARK: - Letters (editorial reflections from real activity)

    @discardableResult
    static func generateLetter(_ context: ModelContext, ai: AIManager, kind: String) async -> Bool {
        guard ai.isReady else { return false }
        let snapshot = String(StateSnapshot.text(context, includePersonal: true).prefix(3_000))
        let beliefs = Memory.brief(context, maxChars: 400)
        let prompt = """
        Write a short reflection on their \(kind) — money and life together — using the real numbers \
        and names below. Two short paragraphs. Notice what is true and say it back to them; draw no \
        conclusions about why.

        Format exactly: a short evocative headline on the first line, then a blank line, then the body.

        What you know about them:
        \(beliefs.isEmpty ? "Not much yet." : beliefs)

        \(snapshot)
        """
        guard let r = try? await ai.smart.text(AIRequest(prompt, instructions: voice, temperature: 0.8)),
              !r.isEmpty else { return false }
        let parts = r.trimmingCharacters(in: .whitespacesAndNewlines).components(separatedBy: "\n")
        let headline = parts.first?.trimmingCharacters(in: .whitespaces) ?? "A letter"
        let body = parts.dropFirst().joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
        let letter = Letter(title: headline.isEmpty ? "A letter" : headline,
                            body: body.isEmpty ? r : body, kind: kind)
        letter.dirty = true
        context.insert(letter); try? context.save()
        return true
    }

    // MARK: - Structured knowledge (entities, vendors, answered questions)
    //
    // These are keyed, app-owned records — "this entity's birthday", "this vendor is a grocery" —
    // not free-text beliefs about the user, so they keep a real key/value shape. They are stored
    // under their own subject and never appear in `Memory.brief`, which is what feeds prompts.

    static func upsertFact(_ context: ModelContext, subjectKind: String = "user", subjectId: String? = nil,
                           key: String, value: String, confidence: Double = 1.0, source: String = "user_answered") {
        Memory.remember(context, topic: key, fact: value, confidence: confidence,
                        source: Memory.Source(rawValue: source) ?? .userAnswered,
                        subjectKind: subjectKind, subjectId: subjectId)
    }

    static func hasFact(_ context: ModelContext, subjectKind: String = "user", subjectId: String? = nil, key: String) -> Bool {
        let id = "\(subjectKind):\(subjectId ?? "_"):\(key)"
        var d = FetchDescriptor<AIFact>(predicate: #Predicate { $0.id == id && $0.archivedAt == nil })
        d.fetchLimit = 1
        return ((try? context.fetch(d))?.isEmpty == false)
    }

    // MARK: - Clients

    /// Distill durable facts from a client's notes into the knowledge store (subject = client).
    static func extractClientFacts(_ context: ModelContext, ai: AIManager, clientId: String, name: String, notes: String) async {
        guard ai.isReady, notes.trimmingCharacters(in: .whitespaces).count >= 8 else { return }
        let prompt = """
        From these notes about a freelance client named "\(name)", pull out the durable facts worth \
        remembering — how they pay, how they communicate, what they care about. Only things the \
        notes actually say.

        \(String(notes.prefix(2_500)))
        """
        guard let r = try? await ai.fast.object(AIClientFacts.self,
                                                AIRequest(prompt, instructions: voice, temperature: 0.3),
                                                jsonShape: AIClientFacts.jsonShape) else { return }
        for f in r.facts.prefix(10) {
            let key = f.key.lowercased().replacingOccurrences(of: " ", with: "_")
                .filter { $0.isLetter || $0.isNumber || $0 == "_" }
            guard !key.isEmpty, !f.value.trimmingCharacters(in: .whitespaces).isEmpty else { continue }
            Memory.remember(context, topic: key, fact: f.value, confidence: 0.8, source: .inferred,
                            subjectKind: "client", subjectId: clientId)
        }
    }

    // MARK: - Receipts

    /// Given items bought and what was paid per unit, judge each against typical Philippine retail.
    /// Knowledge-based estimate — approximate, but it never breaks the way live scraping would.
    static func receiptDealCheck(_ ai: AIManager, items: [(name: String, unitPrice: Double)], base: String) async -> [String: String] {
        guard ai.isReady, !items.isEmpty else { return [:] }
        let list = items.prefix(24)
            .map { "- \($0.name): paid \(String(format: "%.0f", $0.unitPrice)) \(base)/unit" }
            .joined(separator: "\n")
        let prompt = """
        These are retail items bought in the Philippines and what was paid per unit. For each one, \
        recognise the brand if you can, compare against the typical Philippine retail price, and give \
        a short verdict — a good deal, a fair price, or over the odds. Copy each item name exactly.

        \(list)
        """
        guard let r = try? await ai.smart.object(AIPriceVerdicts.self,
                                                 AIRequest(prompt, instructions: voice, temperature: 0.4),
                                                 jsonShape: AIPriceVerdicts.jsonShape) else { return [:] }
        var out: [String: String] = [:]
        for v in r.verdicts where AIJSON.isRealText(v.verdict, minLetters: 4) {
            out[v.item.trimmingCharacters(in: .whitespaces)] = v.verdict.trimmingCharacters(in: .whitespaces)
        }
        return out
    }

    /// A short, tone-matched follow-up message for an outstanding balance.
    static func draftNudge(_ ai: AIManager, name: String, outstanding: String, facts: [String], tone: String = "warm") async -> String {
        let fallback = "Hi \(name), just following up on the outstanding balance of \(outstanding) when you get a chance — thanks!"
        guard ai.isReady else { return fallback }
        let context = facts.isEmpty ? "" : "\nWhat I know about them: " + facts.prefix(6).joined(separator: "; ")
        let toneLine: String
        switch tone {
        case "firm":   toneLine = "Direct and firm but still polite — this balance is overdue and they want it settled."
        case "formal": toneLine = "Formal and professional, business-letter register."
        default:       toneLine = "Warm and friendly, like a freelancer who values the relationship."
        }
        let prompt = """
        Draft a short follow-up message to their client \(name) about an outstanding balance of \(outstanding).
        Under four sentences. No placeholders, no bracketed names — ready to send.
        Tone: \(toneLine)\(context)
        """
        let r = (try? await ai.smart.text(AIRequest(prompt, instructions: voice))) ?? ""
        return r.isEmpty ? fallback : r.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Read a client's notes + project history for friction signals.
    static func rateSignals(_ ai: AIManager, name: String, material: String) async -> [String] {
        guard ai.isReady, material.trimmingCharacters(in: .whitespaces).count >= 12 else { return [] }
        let prompt = """
        Read these notes and project history about their freelance client "\(name)". Name up to three \
        SHORT friction signals you can actually see in the material — scope creep, revision burden, \
        rate lag, slow to pay. One terse sentence each. If nothing stands out, say "Nothing stands out."
        Observations only, no advice.

        \(String(material.prefix(2_000)))
        """
        guard let r = try? await ai.smart.text(AIRequest(prompt, instructions: voice)) else { return [] }
        return r.split(separator: "\n")
            .map { $0.trimmingCharacters(in: CharacterSet(charactersIn: "-•· ").union(.whitespaces)) }
            .filter { AIJSON.isRealText($0) && !$0.lowercased().hasPrefix("nothing stands out") }
            .prefix(3).map { $0 }
    }

    // MARK: - Observations (what "insights" became)

    /// Observations are COMPUTED, not generated — see `ObservationEngine`.
    ///
    /// This used to be a prompt asking a model to "find genuine insights", hardened over two rounds
    /// with an evidence field and a blocklist of speculative phrasings. Both rounds shipped, and
    /// both were defeated by the next batch: the blocklist caught "driven by" and missed "designed
    /// to", caught "suggests" and missed "suggesting". That is the signature of a wrong approach
    /// rather than an under-tuned one, so the model was taken off factual claims entirely.
    ///
    /// Kept as a function because callers (NightShift, the Dashboard refresh button) don't need to
    /// care that there is no longer any AI behind it — and it now works with no brain available.
    @discardableResult
    static func generateObservations(_ context: ModelContext, ai: AIManager) async -> Int {
        ObservationEngine.refresh(context)
    }

    /// Catches the sentence shapes that assert a CAUSE, a MOTIVE or an INNER STATE, as a backstop
    /// to the evidence gate. Every phrase in this list was produced by the previous version on this
    /// user's real data — including the ones that read as sober financial analysis:
    ///
    ///   "Camel buys surge during work delays, DRAINING funds MEANT FOR a new phone"
    ///   "Weekly Grab food spends rise when your energy dips, LINKING mood to micro-purchases"
    ///
    /// Both look like observations. Neither is: "meant for" invents an intention, "draining" and
    /// "linking" assert a mechanism the rows cannot show. Correlation may be reported — "X rose in
    /// the same week Y fell" — but the moment a sentence explains, it is speculation.
    static func readsAsSpeculation(_ text: String) -> Bool {
        let t = text.lowercased()
        let tells = [
            // explicit causation
            "because", "causes", "caused", "leads to", "drives", "driven", "triggers", "fuels",
            "linking", "links ", "tied to", "results in", "due to", "so that",
            // implied mechanism / intent
            "draining", "drains", "bleeding", "bleeds", "meant for", "instead of", "in order to",
            "acts as", "ritual", "coping", "avoidance", "compensat", "substitut",
            "fills", "filling", "replaces", "replacing", "mirrors", "mirroring",
            // interpretation of the person
            "reveal", "shows that", "showing that", "suggests", "signals that", "really about",
            "root problem", "deep down", "subconscious", "guilt", "emotional", "loneliness",
            "self-", "your need", "you tend to", "you struggle",
        ]
        return tells.contains { t.contains($0) }
    }

    // MARK: - Mind × money

    /// The freshest stored mind×money observations — display-only read, never hits a model.
    static func mindMoneyLines(_ context: ModelContext) -> [String] {
        guard let raw = cachedStable(context, key: "mind_money"),
              let data = raw.data(using: .utf8),
              let arr = (try? JSONSerialization.jsonObject(with: data)) as? [String] else { return [] }
        return arr
    }

    /// How mood and body line up against money — computed, like every other observation.
    ///
    /// The old version handed eight weeks of mood-and-money rows to a model and asked it to "find
    /// real patterns connecting mind and money". That framing is an invitation to write psychology,
    /// and it accepted: *"calories are currently your primary mood regulator"*. The engine now
    /// reports the two averages side by side and stops, which is the entire honest content of the
    /// comparison.
    static func mindMoney(_ context: ModelContext, ai: AIManager, force: Bool = false) async -> [String] {
        let lines = ObservationEngine.compute(context)
            .filter { $0.area == "life" || $0.area == "pattern" }
            .prefix(3).map(\.text)
        if let d = try? JSONSerialization.data(withJSONObject: Array(lines)),
           let s = String(data: d, encoding: .utf8) {
            store(context, key: "mind_money", payload: s, ttl: 3 * 24 * 3600)
        }
        return Array(lines)
    }

    /// One compact line per day (last 56) that had mood or money. `enough` requires ≥4 mood-tagged
    /// days — below that any "pattern" would be noise.
    private static func mindMoneyDataset(_ context: ModelContext) -> (String, String, Bool) {
        let cal = PHT.calendar
        let cutoff = cal.date(byAdding: .day, value: -56, to: Date()) ?? Date()
        let base = ((try? context.fetch(FetchDescriptor<AppSettings>())) ?? []).first?.baseCurrency ?? "PHP"
        let letters = ((try? context.fetch(FetchDescriptor<Letter>())) ?? [])
            .filter { $0.deletedAt == nil && $0.createdAt >= cutoff }
        let spends = ((try? context.fetch(FetchDescriptor<Spend>())) ?? [])
            .filter { $0.deletedAt == nil && $0.spentAt >= cutoff }
        let pays = ((try? context.fetch(FetchDescriptor<Payment>())) ?? [])
            .filter { $0.deletedAt == nil && $0.paidAt >= cutoff }
        let bodyLogs = ((try? context.fetch(FetchDescriptor<BodyLog>())) ?? [])
            .filter { $0.deletedAt == nil && $0.day >= cutoff }
        var days: [Date: (moods: [String], out: Double, inn: Double, body: [String])] = [:]
        func key(_ d: Date) -> Date { cal.startOfDay(for: d) }
        for l in letters {
            var r = days[key(l.createdAt)] ?? ([], 0, 0, [])
            if let s = l.sentiment, !s.isEmpty { r.moods.append(s) }
            days[key(l.createdAt)] = r
        }
        for s in spends {
            var r = days[key(s.spentAt)] ?? ([], 0, 0, []); r.out += s.amountBase; days[key(s.spentAt)] = r
        }
        for p in pays {
            var r = days[key(p.paidAt)] ?? ([], 0, 0, [])
            r.inn += (p.grossAtMarketBase ?? p.netAmountBase ?? 0); days[key(p.paidAt)] = r
        }
        for b in bodyLogs {
            var r = days[key(b.day)] ?? ([], 0, 0, [])
            var bits: [String] = []
            if let m = b.mood { bits.append("mood \(m)/5") }
            if let e = b.energy { bits.append("energy \(e)/5") }
            if let s = b.sleepHours { bits.append(String(format: "slept %.1fh", s)) }
            if let w = b.workoutMinutes, w > 0 { bits.append("workout \(w)m") }
            if !bits.isEmpty { r.body.append(bits.joined(separator: ", ")) }
            days[key(b.day)] = r
        }
        let moodDays = days.values.filter { !$0.moods.isEmpty || !$0.body.isEmpty }.count
        let rows = days.keys.sorted(by: >).map { d -> String in
            let r = days[d]!
            var bits: [String] = []
            if !r.moods.isEmpty { bits.append("mood: \(r.moods.joined(separator: "/"))") }
            if !r.body.isEmpty { bits.append("body: \(r.body.joined(separator: " · "))") }
            if r.out > 0 { bits.append("spent \(Int(r.out)) \(base)") }
            if r.inn > 0 { bits.append("received \(Int(r.inn)) \(base)") }
            return "\(d.formatted(.dateTime.month(.twoDigits).day(.twoDigits))): \(bits.joined(separator: "; "))"
        }
        return (rows.joined(separator: "\n"), base, moodDays >= 4)
    }

    // MARK: - Duplicate people

    struct DupeGroup: Codable, Identifiable {
        var keep: String
        var merge: [String]
        var why: String
        var id: String { keep + "|" + merge.sorted().joined(separator: ",") }
    }

    /// Duplicate detection for People — "Celine", "wife" and "my wife" are one person. Conservative
    /// by instruction and by schema; pairs the user marked "not the same" are never suggested again.
    static func findDuplicatePeople(_ context: ModelContext, ai: AIManager, force: Bool = false) async -> [DupeGroup] {
        guard ai.isReady else { return [] }
        let entities = ((try? context.fetch(FetchDescriptor<Entity>())) ?? [])
            .filter { $0.deletedAt == nil && !$0.archived }
        let lines = entities.map { e in
            "id: \(e.id.uuidString) | name: \"\(e.name)\" | kind: \(e.kind.label)"
            + ((e.relationship?.isEmpty == false) ? " | relationship: \(e.relationship!)" : "")
            + ((e.notes?.isEmpty == false) ? " | notes: \(String(e.notes!.prefix(80)))" : "")
        }
        // STABLE hash — String.hashValue is randomised per launch, which would miss the cache
        // every launch and re-run this prompt for nothing.
        let fingerprint = StableHash.of(lines.sorted().joined())
        let listing = lines.joined(separator: "\n")

        func filtered(_ groups: [DupeGroup]) -> [DupeGroup] {
            let banned = EntityMerge.notSamePairs
            return groups.compactMap { g in
                guard let keepId = UUID(uuidString: g.keep) else { return nil }
                let members = g.merge.compactMap(UUID.init(uuidString:))
                    .filter { !banned.contains(EntityMerge.pairKey(keepId, $0)) }
                guard !members.isEmpty else { return nil }
                return DupeGroup(keep: g.keep, merge: members.map(\.uuidString), why: g.why)
            }
        }
        if !force,
           let raw = cached(context, key: "dupe_people", fingerprint: fingerprint),
           let data = raw.data(using: .utf8),
           let groups = try? JSONDecoder().decode([DupeGroup].self, from: data) {
            return filtered(groups)
        }
        guard lines.count > 1 else { return [] }

        let prompt = """
        These are people tracked in a private life app. Some entries are DUPLICATES — the same real \
        person entered more than one way, for example a first name, a relationship word, and "my " \
        plus that word.

        Group entries that clearly refer to one real person. For each group pick the entry to KEEP: \
        a real name beats a relationship word, and the most complete record wins ties.

        Be conservative. Two different real names are never the same person. If nothing is clearly a \
        duplicate, return no groups.

        \(String(listing.prefix(3_000)))
        """
        guard let result = try? await ai.fast.object(AIDupeGroups.self,
                                                     AIRequest(prompt, instructions: voice, temperature: 0.2),
                                                     jsonShape: AIDupeGroups.jsonShape) else { return [] }
        let valid = result.groups
            .map { DupeGroup(keep: $0.keep, merge: $0.merge, why: $0.why) }
            .filter { UUID(uuidString: $0.keep) != nil && !$0.merge.isEmpty }
        if let d = try? JSONEncoder().encode(valid), let s = String(data: d, encoding: .utf8) {
            store(context, key: "dupe_people", payload: s, ttl: 7 * 24 * 3600, fingerprint: fingerprint)
        }
        return filtered(valid)
    }

    // MARK: - Journal questions

    /// The eight territories a question can come from. A batch draws DIFFERENT ones than the last
    /// batch — rotation is enforced in code, not requested in the prompt, because a small model
    /// asked to "vary the topic" will still orbit whatever the recent entries were about.
    private static let journalTerritories = [
        "how they're feeling", "their work", "their money", "someone in their life",
        "their faith", "the near future", "their body and energy", "something small they enjoyed",
    ]

    private static func rotateTerritories(_ count: Int) -> [String] {
        let lastRaw = UserDefaults.standard.string(forKey: "journal.lastTerritories") ?? ""
        let last = Set(lastRaw.split(separator: "|").map(String.init))
        var pool = journalTerritories.filter { !last.contains($0) }
        if pool.count < count { pool = journalTerritories }
        let chosen = Array(pool.shuffled().prefix(count))
        UserDefaults.standard.set(chosen.joined(separator: "|"), forKey: "journal.lastTerritories")
        return chosen
    }

    /// The gate a question must pass to be shown to a human.
    ///
    /// The `??` in "…from journal_1784966887??" got through because the old lenient fallback path
    /// skipped the single-question-mark check entirely. There is one gate now, and everything
    /// passes through it — there is no lenient tier to leak through.
    static func isHumanQuestion(_ s: String) -> Bool {
        let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        guard AIJSON.isRealText(t), t.hasSuffix("?"), t.count <= 110 else { return false }
        guard t.filter({ $0 == "?" }).count == 1 else { return false }           // one ask, and no "??"
        guard !t.contains("—"), !t.contains(";"), !t.contains("_") else { return false }  // poetry, or a leaked key
        guard t.split(separator: ",").count <= 2 else { return false }           // no clause trains
        // A question naming an internal identifier is a leak, not a question.
        guard !t.contains(where: { $0.isNumber }) || !looksLikeIdentifier(t) else { return false }
        return true
    }

    /// Catches internal ids that escaped into text — long digit runs are never something a person
    /// wrote about their own life.
    private static func looksLikeIdentifier(_ s: String) -> Bool {
        var run = 0
        for ch in s {
            if ch.isNumber { run += 1; if run >= 5 { return true } } else { run = 0 }
        }
        return false
    }

    /// What the question writer is allowed to know. Every block is character-capped: shipping the
    /// full ask history (110 questions, 19k characters) is what made generation throw on real data.
    struct JournalContext {
        var asked: [String] = []
        var liked: [String] = []
        var refused: [String] = []
        var mood = ""
        var beliefs = ""
        var recent = ""
    }

    static func journalContext(_ context: ModelContext) -> JournalContext {
        var m = JournalContext()
        let askedRows = ((try? context.fetch(FetchDescriptor<JournalPrompt>())) ?? [])
            .sorted { $0.createdAt > $1.createdAt }
        // Recent asks only. Repetition against the DEEP archive is caught mechanically in
        // `storeJournalPrompts`, which the model can't be relied on to do anyway.
        let refused = askedRows.filter { $0.status == "dismissed" || $0.feedback == "down" }.prefix(10)
        let rest = askedRows.filter { !($0.status == "dismissed" || $0.feedback == "down") }.prefix(20)
        m.asked = (Array(refused) + Array(rest)).map(\.text)
        m.liked = askedRows.filter { $0.feedback == "up" }.prefix(6).map(\.text)
        m.refused = refused.map(\.text)

        let letters = ((try? context.fetch(FetchDescriptor<Letter>())) ?? [])
            .filter { $0.deletedAt == nil }.sorted { $0.createdAt > $1.createdAt }
        m.mood = letters.prefix(6).compactMap { l in
            l.sentiment.map { "\(l.createdAt.formatted(.dateTime.month().day())): \($0)" }
        }.joined(separator: ", ")
        m.beliefs = Memory.brief(context, maxChars: 600)
        m.recent = letters.prefix(3).map { l in
            "[\(l.createdAt.formatted(.dateTime.month().day()))] asked: \(l.title)\n  they wrote: \(String(l.body.prefix(240)))"
        }.joined(separator: "\n")
        return m
    }

    /// Personalised journaling questions — ONE per territory, generated concurrently.
    ///
    /// The previous version asked for the whole batch in a single prompt carrying every
    /// territory's context at once. That prompt grew with the user's history until it exceeded the
    /// context window, threw, and returned nothing — the "New questions fails 90% of the time"
    /// bug. Per-territory generation keeps each prompt small and makes a failure cost one question
    /// instead of the batch.
    static func journalPrompts(_ context: ModelContext, ai: AIManager, count: Int = 3) async -> [String] {
        guard ai.isReady else { return [] }
        let ctx = journalContext(context)
        let territories = rotateTerritories(count)

        let instructions = """
        \(voice)

        You write ONE journalling question for this person.

        Hard rules, all of them:
        · Under 15 words. One idea. Exactly one question mark.
        · Plain spoken words, the way a close friend texts. No metaphors, no therapy-speak, no \
          em-dashes, no "what does that say about".
        · Open-ended, but light — something they would want to answer, not homework.
        · You may name a real, specific thing from their own entries when it fits. Their own words \
          outrank everything else you were told.
        · Never assert that something happened unless they wrote it themselves.
        · If their mood reads heavy, keep it gentle.
        """

        // Fire all territories at once. A slow brain costs one round trip, not N.
        let results = await withTaskGroup(of: String?.self) { group in
            for territory in territories {
                group.addTask { @MainActor in
                    await oneQuestion(ai: ai, territory: territory, ctx: ctx, instructions: instructions)
                }
            }
            var out: [String] = []
            for await r in group { if let r { out.append(r) } }
            return out
        }
        return results
    }

    /// One question for one territory, with a single retry that tightens the ask.
    private static func oneQuestion(ai: AIManager, territory: String,
                                    ctx: JournalContext, instructions: String) async -> String? {
        let avoid = ctx.asked.prefix(16).map { "- \($0)" }.joined(separator: "\n")
        let liked = ctx.liked.isEmpty ? "" : "\nQuestions they liked — write in this spirit:\n" + ctx.liked.map { "- \($0)" }.joined(separator: "\n")
        let refused = ctx.refused.isEmpty ? "" : "\nQuestions they refused — avoid this tone and topic:\n" + ctx.refused.prefix(6).map { "- \($0)" }.joined(separator: "\n")

        let prompt = """
        Write one question about: \(territory).

        Their recent mood: \(ctx.mood.isEmpty ? "unknown" : ctx.mood)

        What you know about them:
        \(ctx.beliefs.isEmpty ? "Not much yet." : ctx.beliefs)

        Their most recent entries:
        \(ctx.recent.isEmpty ? "(nothing yet)" : String(ctx.recent.prefix(900)))

        Already asked — never repeat or reword these:
        \(avoid.isEmpty ? "(none yet)" : avoid)\(liked)\(refused)
        """

        for pass in 0..<2 {
            let req = AIRequest(pass == 0 ? prompt : prompt + "\n\nYour last attempt broke the rules. Keep it under 15 words, one question mark, plain words.",
                                instructions: instructions, temperature: pass == 0 ? 0.9 : 0.5)
            guard let r = try? await ai.smart.object(AIJournalQuestion.self, req,
                                                     jsonShape: AIJournalQuestion.jsonShape) else { continue }
            let q = r.question.trimmingCharacters(in: .whitespacesAndNewlines)
            if isHumanQuestion(q) { return q }
        }
        return nil
    }

    // MARK: - Project lifecycle → journal bridge

    /// When a deal closes or falls through, drop ONE gentle question about it into the journal.
    static func enqueueProjectPostMortem(_ context: ModelContext, projectTitle: String, clientName: String?, outcome: String) {
        let title = projectTitle.trimmingCharacters(in: .whitespaces)
        guard !title.isEmpty else { return }
        let who = clientName.map { " for \($0)" } ?? ""
        let text: String
        switch outcome {
        case "paid":
            text = "“\(title)”\(who) just wrapped and got paid — how did it feel?"
        default:
            text = "“\(title)”\(who) didn't work out — what happened?"
        }
        storeJournalPrompts(context, texts: [text], source: "project")
    }

    // MARK: - Storing questions

    /// Loose topical fingerprint of a question, for catching a REPHRASED duplicate.
    private static func promptTokens(_ s: String) -> Set<String> { Memory.contentTokens(s) }
    private static func jaccard(_ a: Set<String>, _ b: Set<String>) -> Double { Memory.jaccard(a, b) }

    /// Self-heal at launch: delete stored questions (and dismiss observations) that are echoed
    /// placeholders or contain a leaked internal identifier.
    @discardableResult
    static func purgePlaceholderJunk(_ context: ModelContext) -> Int {
        var removed = 0
        for p in ((try? context.fetch(FetchDescriptor<JournalPrompt>())) ?? [])
        where p.status == "open" && !isHumanQuestion(p.text) {
            context.delete(p); removed += 1
        }

        // ONE-TIME: every observation in the store predates the computed engine, which means every
        // one of them was written by a model asked to interpret. Rather than try to sort the sound
        // ones from "guilt-driven gifting" with another blocklist — the approach that already
        // failed twice — the whole set is retired and rebuilt from arithmetic. Nothing of value is
        // lost: the real findings recompute in milliseconds.
        let purgeFlag = "insights.modelEraPurged.v1"
        if !UserDefaults.standard.bool(forKey: purgeFlag) {
            UserDefaults.standard.set(true, forKey: purgeFlag)
            for i in ((try? context.fetch(FetchDescriptor<InsightLog>())) ?? []) where i.dismissedAt == nil {
                i.dismissedAt = .now; i.dirty = true; removed += 1
            }
            // The cached AI narratives are the same problem wearing a different hat. `mind_money`
            // in particular had a three-day TTL, so without this it would keep serving lines like
            // "the mood went heavy right before the largest spend" — a sequence claim dressed as a
            // fact — for days after the engine that replaced it shipped.
            let staleKeys = ["mind_money", "weather_detail", "daily_calm"]
            for row in ((try? context.fetch(FetchDescriptor<BrainCache>())) ?? [])
            where staleKeys.contains(row.key) {
                context.delete(row); removed += 1
            }
        }

        // Observations written before the computed engine carry no `key`, so a re-worded version
        // of the same finding could sit beside the original ("Wife is down 96%…" above "Spending
        // tagged 'Wife' is down 96%…"). Retire the keyless ones once; the engine recomputes them
        // with a key in milliseconds.
        let keyedFlag = "insights.keylessPurged.v1"
        if !UserDefaults.standard.bool(forKey: keyedFlag) {
            UserDefaults.standard.set(true, forKey: keyedFlag)
            for i in ((try? context.fetch(FetchDescriptor<InsightLog>())) ?? [])
            where i.dismissedAt == nil && (i.key ?? "").isEmpty {
                i.dismissedAt = .now; i.dirty = true; removed += 1
            }
        }

        // Ongoing guard, in case anything speculative ever reaches this table again.
        for i in ((try? context.fetch(FetchDescriptor<InsightLog>())) ?? [])
        where i.dismissedAt == nil && (!AIJSON.isRealText(i.text, minLetters: 10) || readsAsSpeculation(i.text)) {
            i.dismissedAt = .now; i.dirty = true; removed += 1
        }
        if removed > 0 {
            try? context.save()
            moneyLog.notice("Brain: purged \(removed, privacy: .public) unusable questions/observations.")
        }
        return removed
    }

    /// Persist freshly generated questions as OPEN — deduped against every question ever stored,
    /// exactly and semantically, so an answered or dismissed one can never sneak back.
    @discardableResult
    static func storeJournalPrompts(_ context: ModelContext, texts: [String], source: String = "ai",
                                    sourceLetterId: UUID? = nil, sourceExcerpt: String? = nil) -> Int {
        let all = ((try? context.fetch(FetchDescriptor<JournalPrompt>())) ?? [])
        let existing = Set(all.map { $0.text.lowercased().trimmingCharacters(in: .whitespaces) })
        var seenTokens = all.sorted { $0.createdAt > $1.createdAt }.prefix(150).map { promptTokens($0.text) }
        var added = 0
        for t in texts {
            let key = t.lowercased().trimmingCharacters(in: .whitespaces)
            // Chokepoint: nothing that fails the human gate is ever stored, whichever path made it.
            guard isHumanQuestion(t), !existing.contains(key) else { continue }
            let toks = promptTokens(t)
            if seenTokens.contains(where: { jaccard($0, toks) >= 0.6 }) { continue }
            let p = JournalPrompt(text: t, source: source); p.dirty = true
            p.sourceLetterId = sourceLetterId
            p.sourceExcerpt = sourceExcerpt
            context.insert(p); added += 1
            seenTokens.append(toks)
        }
        if added > 0 { try? context.save() }
        return added
    }

    // MARK: - Reading a finished entry

    /// Tag a finished entry, fold anything durable into memory, honour a correction, and — when
    /// asked — propose at most one follow-up.
    ///
    /// The correction path is the important one. On this user's real data the previous version
    /// stored *"Sold the motorbike in May"* as a belief, was told *"Actually I never did this"*,
    /// and stored THAT as another belief — so it held both at once and kept asking about the
    /// motorbike. A correction now DELETES what it contradicts instead of accumulating beside it.
    @discardableResult
    static func analyzeJournal(_ context: ModelContext, ai: AIManager, letter: Letter, followUp: Bool = false) async -> Bool {
        let text = letter.body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard text.count >= 20, ai.isReady else { return false }

        let ctx = followUp ? journalContext(context) : JournalContext()
        let followUpBlock = followUp ? """

        You may also propose ONE follow-up question, but only if this entry clearly leaves a thread \
        worth pulling another day. Anchor it in something concrete they wrote HERE. Same style rules: \
        under 15 words, plain, one question mark. Match their mood: \(ctx.mood.isEmpty ? "unknown" : ctx.mood).
        Never repeat any of these:
        \(ctx.asked.prefix(12).map { "- \($0)" }.joined(separator: "\n"))
        Most entries earn no follow-up. Returning an empty string is the normal answer.
        """ : "\n\nDo not propose a follow-up question — return an empty string for it."

        let prompt = """
        Read this private journal entry. It was written in answer to the question: “\(letter.title)”

        A "durable fact" is something lasting they stated as TRUE about themselves. If they are \
        denying something, correcting something, or venting, there is no durable fact — leave it empty \
        and use the correction field instead.\(followUpBlock)

        Entry:
        \(String(text.prefix(3_000)))
        """

        // Reading is a fast-tier extraction; only follow-up writing needs the smart brain.
        let router = followUp ? ai.smart : ai.fast
        guard let r = try? await router.object(AIJournalReading.self,
                                               AIRequest(prompt, instructions: voice, temperature: 0.3),
                                               jsonShape: AIJournalReading.jsonShape) else { return false }

        let sentiment = r.sentiment.trimmingCharacters(in: .whitespaces)
        if !sentiment.isEmpty, sentiment.count <= 24 { letter.sentiment = sentiment.lowercased() }
        let themes = r.themes.map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        if !themes.isEmpty { letter.themesRaw = themes.prefix(3).joined(separator: ", ") }
        letter.dirty = true

        // A correction outranks everything — it retires the beliefs it contradicts.
        let correction = r.correction.trimmingCharacters(in: .whitespaces)
        if AIJSON.isRealText(correction) {
            if Memory.readsAsDenial(correction) {
                Memory.deny(context, statement: correction)
            } else {
                Memory.remember(context, topic: String(correction.prefix(40)), fact: correction,
                                confidence: 0.95, source: .userAnswered)
            }
        }

        // A durable fact is only stored when the entry wasn't a correction — otherwise the model
        // reliably "remembers" the thing being denied.
        let fact = r.durableFact.trimmingCharacters(in: .whitespaces)
        if AIJSON.isRealText(fact), !AIJSON.isRealText(correction), !Memory.readsAsDenial(text) {
            Memory.remember(context, topic: String(fact.prefix(40)), fact: fact,
                            confidence: 0.6, source: .inferred)
        }

        // "Don't ask about this again" — matched IN CODE, because a literal instruction from the
        // user must never depend on a model's judgement. The model's flag covers softer pushback.
        let lowered = text.lowercased()
        let explicit = ["don't ask", "dont ask", "do not ask", "stop asking", "never ask",
                        "not interested in this", "why do you keep asking"].contains { lowered.contains($0) }
        if explicit || r.pushback {
            let prompts = (try? context.fetch(FetchDescriptor<JournalPrompt>())) ?? []
            if let p = prompts.first(where: { $0.answeredLetterId == letter.id }) {
                p.feedback = "down"; p.dirty = true
            }
        }

        if followUp {
            let f = r.followUp.trimmingCharacters(in: .whitespacesAndNewlines)
            if isHumanQuestion(f) {
                let excerpt = text.count > 150 ? String(text.prefix(150)) + "…" : text
                storeJournalPrompts(context, texts: [f], source: "followup",
                                    sourceLetterId: letter.id, sourceExcerpt: excerpt)
            }
        }
        try? context.save()
        return true
    }

    // MARK: - Curiosity (the bell's one clarifying question)

    /// ONE question born from this user's actual state. Repetition is blocked in CODE — small
    /// models are weak at honouring "don't repeat" — and silence is always preferred to a repeat.
    static func curiosityQuestion(_ context: ModelContext, ai: AIManager) async -> (subject: String, body: String, choices: [String], factKey: String)? {
        guard ai.isReady else { return nil }

        let snapshot = String(StateSnapshot.text(context, includePersonal: false).prefix(2_000))
        let beliefs = Memory.brief(context, maxChars: 600)
        let rows = ((try? context.fetch(FetchDescriptor<AppNotification>())) ?? [])
            .filter { $0.isQuestion }.sorted { $0.createdAt > $1.createdAt }
        let askedBlock = rows.prefix(30).map { "- \($0.subject)" }.joined(separator: "\n")
        let askedTokens = rows.prefix(50).map { Memory.contentTokens($0.subject) }
        let askedKeys = Set(rows.compactMap { $0.factKey?.lowercased() }.filter { !$0.isEmpty })

        let instructions = """
        \(voice)

        You decide whether there is ONE question worth asking right now — something that would make \
        the app genuinely smarter about their life or money.

        Answering "no, don't ask" is the right call most of the time and costs nothing. A repeated \
        question is the worst possible outcome.

        Never ask about anything already known, already asked, or listed as not true about them. If \
        the only questions you can think of touch those, say don't ask.

        The question is one short sentence ending in a question mark. The choices are ANSWERS they \
        tap — short statements, never questions.
        """

        var extra = ""
        for attempt in 0..<2 {
            let prompt = """
            What you already know about them:
            \(beliefs.isEmpty ? "Very little." : beliefs)

            Already asked — these topics are burned:
            \(askedBlock.isEmpty ? "(none yet)" : askedBlock)

            Their current state:
            \(snapshot)\(extra)
            """
            guard let r = try? await ai.smart.object(AICuriosityAsk.self,
                                                     AIRequest(prompt, instructions: instructions, temperature: 0.7),
                                                     jsonShape: AICuriosityAsk.jsonShape) else { continue }
            guard r.shouldAsk else { return nil }

            let subject = r.question.trimmingCharacters(in: .whitespaces)
            guard subject.count >= 8, subject.count <= 140, subject.hasSuffix("?"),
                  subject.filter({ $0 == "?" }).count == 1 else { return nil }

            let key = r.factKey.trimmingCharacters(in: .whitespaces).lowercased()
            let tokens = Memory.contentTokens(subject)
            let knownKeys = Set(Memory.live(context).map { $0.key.lowercased() })

            // CODE-SIDE REPEAT BLOCK — the part that actually works.
            let keyRepeat = !key.isEmpty && (askedKeys.contains(key) || knownKeys.contains(key))
            let wordRepeat = askedTokens.contains { tooSimilar(tokens, $0) }
            if keyRepeat || wordRepeat {
                if attempt == 0 {
                    extra = "\n\nYour previous attempt \"\(subject)\" repeated something already covered. Pick a completely different area of their life, or say don't ask."
                    continue
                }
                return nil
            }

            let choices = r.choices.map { $0.trimmingCharacters(in: .whitespaces) }
                .filter { !$0.isEmpty && !$0.contains("?") && $0.count <= 48 }
            guard choices.count >= 2 else { return nil }
            let why = r.why.trimmingCharacters(in: .whitespaces)
            return (subject, why, Array(choices.prefix(4)),
                    key.isEmpty ? "curiosity_\(Int(Date.now.timeIntervalSince1970))" : key)
        }
        return nil
    }

    /// Two questions are "the same topic" if they share most of their meaningful words, or one's
    /// words are essentially a subset of the other's (a narrowed rephrase).
    private static func tooSimilar(_ a: Set<String>, _ b: Set<String>) -> Bool {
        guard !a.isEmpty, !b.isEmpty else { return false }
        let inter = a.intersection(b).count
        let j = Double(inter) / Double(a.union(b).count)
        let subset = Double(inter) / Double(min(a.count, b.count))
        return j >= 0.5 || subset >= 0.7
    }

    // MARK: - Vendors

    /// The most-visited vendor name from spends that has no brand match and no identification yet.
    static func topUnidentifiedVendor(_ context: ModelContext) -> String? {
        var sd = FetchDescriptor<Spend>(sortBy: [SortDescriptor(\.spentAt, order: .reverse),
                                                 SortDescriptor(\.createdAt, order: .reverse)])
        sd.fetchLimit = 2000
        let spends = (try? context.fetch(sd)) ?? []
        var counts: [String: Int] = [:]
        for s in spends {
            guard let raw = s.vendorName?.trimmingCharacters(in: .whitespaces), !raw.isEmpty else { continue }
            if Brand.match(raw) != nil { continue }
            if VendorBrand.match(raw) != nil { continue }
            if vendorIsIdentified(context, name: raw) { continue }
            counts[raw, default: 0] += 1
        }
        return counts.filter { $0.value >= 2 }.max { $0.value < $1.value }?.key
    }

    static func slug(_ s: String) -> String {
        let lowered = s.lowercased()
        let mapped = lowered.map { $0.isLetter || $0.isNumber ? $0 : "-" }
        return String(mapped).split(separator: "-").joined(separator: "-")
    }
}

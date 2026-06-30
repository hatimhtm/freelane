import Foundation
import SwiftData

/// The native "brain" layer: cache-first AI, grounded chat, a daily read, and a
/// clarifying-question loop that folds answers into the fact store. Faithful in
/// spirit to the web app's `lib/ai/*` — best-effort, never blocks paint, never
/// runs on every load.
@MainActor
enum Brain {

    // MARK: - PHT day

    static func phtDay(_ date: Date = .now) -> String {
        let f = DateFormatter()
        f.calendar = PHT.calendar; f.timeZone = PHT.zone; f.dateFormat = "yyyy-MM-dd"
        return f.string(from: date)
    }

    // MARK: - Brain cache

    /// Returns a cached payload only when it's still fresh: same PHT day, not past
    /// `staleAt`, and the input fingerprint still matches. Otherwise nil → regenerate.
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

    // MARK: - Grounded chat

    /// A grounded answer. `history` is a short ring buffer of prior turns (newest last) so the
    /// assistant remembers the thread within a session. With a Gemini key it can CALL TOOLS
    /// (search spends, wallet balances, projections) for exact figures instead of relying only on
    /// the pre-built snapshot; without a key it falls back to the on-device model + snapshot.
    static func answer(_ context: ModelContext, ai: AIManager, page: String, question: String,
                       history: [(mine: Bool, text: String)] = []) async -> String {
        guard ai.isReady else { return "Add a local model or a Gemini API key in Settings → AI to enable answers." }

        var persona = "You are the assistant inside Freelane, a private single-user money + life app for one freelancer in the Philippines (base currency PHP, timezone PHT). You are on the \(page) page. Answer in 1–4 short sentences, concretely, using REAL numbers. Never invent figures. Don't coach or moralize — mirror what's true. If you can't answer, say so plainly."
        // Core memory rides along (Hermes-style): the chat knows the user from turn one
        // without re-fetching facts — and it's ~100 words, not a fact dump.
        let core = MemoryCompactor.digest
        if !core.isEmpty { persona += "\nWhat you already know about them: \(core)" }
        let convo = history.suffix(5).map { ($0.mine ? "User: " : "You: ") + $0.text }.joined(separator: "\n")
        let threaded = convo.isEmpty ? question : "Conversation so far:\n\(convo)\n\nUser question: \(question)"

        // Gemini's tool-calling path (retrieval over recall) is used ONLY when the user has
        // opted into cloud (`cloudReachable`). With cloud off, even chat stays fully on the
        // local / on-device brains — no Gemini anywhere — using the snapshot-grounded fallback.
        if ai.cloudReachable {
            if let toolReply = await ToolRunner.answer(threaded, system: persona, context: context, apiKey: ai.apiKey),
               !toolReply.isEmpty {
                AIUsage.record(source: "cloud", promptChars: persona.count + threaded.count, responseChars: toolReply.count)
                return toolReply.trimmingCharacters(in: .whitespacesAndNewlines)
            }
        }
        // Fallback: snapshot-grounded single prompt (local / on-device, or cloud if enabled).
        let snapshot = StateSnapshot.text(context)
        let prompt = "\(persona)\n\n=== CURRENT STATE ===\n\(snapshot)\n=== END STATE ===\n\n\(threaded)"
        let reply = (try? await ai.provider.generate(prompt: prompt)) ?? ""
        return reply.isEmpty ? "Sorry, I couldn't reach the model." : reply.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    // MARK: - Daily calm read (cache-first; posts at most once per PHT day)

    /// Generates a one-line read of where the money stands today and drops it in
    /// the inbox — but only once per PHT day, and only when the state actually
    /// changed (fingerprint). Cheap deterministic fallback when AI is off.
    static func dailyCalmRead(_ context: ModelContext, ai: AIManager) async {
        let fp = StateSnapshot.fingerprint(context)
        if cached(context, key: "daily_calm", fingerprint: fp) != nil { return }   // already done today

        let d = StateSnapshot.load(context)
        let safe = SafeToSpend.compute(payments: d.payments, spends: d.spends, wallets: d.wallets,
                                       ledger: d.ledger, recurrings: d.recurrings)
        func money(_ v: Double) -> String { CurrencyFormat.string(v, d.baseCurrency, compact: true) }

        var body = "Safe to spend \(money(safe.liveRemaining)) today · \(money(d.metrics.landedMTD)) landed this month · \(money(d.metrics.outstandingBase)) owed to you."
        if ai.isReady {
            let prompt = """
            Write ONE calm, factual sentence (max 22 words) summarizing this person's money today. Use real numbers, no advice, no "you should". Plain and warm.

            \(StateSnapshot.text(context))
            """
            if let r = try? await ai.provider.generate(prompt: prompt), !r.isEmpty {
                body = r.trimmingCharacters(in: .whitespacesAndNewlines)
            }
        }

        // Cache first so we never double-post, then post.
        store(context, key: "daily_calm", payload: body, fingerprint: fp)
        Notify.post(context, kind: "daily_read", subject: "Today's read", body: body, priority: 0, feature: .dashboard)
    }

    /// A deeper, AI-generated read of the current money "weather" — shown when the user
    /// taps the calm-weather banner. Cached per state fingerprint so repeat taps are free.
    static func weatherDetail(_ context: ModelContext, ai: AIManager) async -> String {
        let fp = StateSnapshot.fingerprint(context)
        if let c = cached(context, key: "weather_detail", fingerprint: fp) { return c }
        guard ai.isReady else { return "" }
        let prompt = """
        Here is the person's money state right now:
        \(StateSnapshot.text(context))

        In 2–4 short sentences, explain plainly what's going on with their money today and what — if anything — they should do about it. Use their real numbers. Warm and direct, no preaching, no "you should". If things are fine, say so clearly. Note: wallets marked ignored and one-off/investment purchases are already excluded from the everyday picture.
        """
        let r = ((try? await ai.heavy.generate(prompt: prompt)) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if !r.isEmpty { store(context, key: "weather_detail", payload: r, fingerprint: fp) }
        return r
    }

    // MARK: - Spending intelligence (auto-categorize + anomaly whisper)

    static let spendCategories = ["Food", "Eating out", "Groceries", "Transport", "Bills",
                                  "Health", "Cigarettes", "Pet", "Gifts", "Tech", "Sadaka", "Other"]

    static func fetchSpend(_ context: ModelContext, _ id: UUID) -> Spend? {
        let d = FetchDescriptor<Spend>(predicate: #Predicate { $0.id == id })
        return (try? context.fetch(d))?.first
    }

    /// After a spend is logged: understand it (category + who/what it involved) and
    /// whisper if it's unusual. Best-effort, never blocks.
    static func onSpendLogged(_ context: ModelContext, ai: AIManager, spendId: UUID) async {
        guard let s = fetchSpend(context, spendId) else { return }
        await understandSpend(context, ai: ai, spend: s)
        anomalyWhisper(context, spend: s)
        receiptWhisper(context, spend: s)
    }

    /// ONE structured pass that actually understands a spend, so the app stops asking
    /// dumb questions: it categorizes, classifies the MERCHANT (a store is never mistaken
    /// for a person), and separates a real PERSON name from a beneficiary relationship or
    /// a verb. "Greenwich" → restaurant (never "is this a family member?"); "Got pizza for
    /// my wife" → beneficiary=wife, no "who is Got". Falls back to the simple ask with no key.
    static func understandSpend(_ context: ModelContext, ai: AIManager, spend: Spend) async {
        let text = [spend.vendorName, spend.spendDescription, spend.notes].compactMap { $0 }
            .joined(separator: " ").trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { return }
        guard ai.isReady else {   // on-device OR a Gemini key
            if spend.tags.isEmpty { await autoCategorize(context, ai: ai, spend: spend) }
            return
        }

        // Cache by a STABLE key (text + amount): re-logging the same thing skips the AI call.
        let cacheKey = "understand:" + slug(text) + ":" + String(Int(spend.amountBase.rounded()))
        let onDevice = !ai.cloudReachable   // scrub only if this could actually reach Gemini
        var raw = cachedStable(context, key: cacheKey)
        if raw == nil {
            let safeText = Redactor.forCloud(text, onDevice: onDevice)   // never send health terms to the cloud
            let prompt = """
            Parse this single personal expense (Philippines). Spend: "\(safeText)" for \(CurrencyFormat.string(spend.amountBase, "PHP", compact: true)).
            Return ONLY compact JSON, no prose:
            {"category":"<one label from: \(spendCategories.joined(separator: ", "))>",
             "merchant":"<the store/business/brand name if any, corrected for typos, else empty>",
             "merchant_type":"store|restaurant|online|service|transport|utility|grocery|person|unknown",
             "domain":"<the merchant's official website domain, e.g. jollibee.com.ph — infer it even if the name was misspelled; empty if not a known business>",
             "person_name":"<a real PROPER NAME of a person mentioned (e.g. Ahmed), else empty>",
             "confidence":<0..1>}
            Rules: A merchant is a place/business (Greenwich, Jollibee, Grab). A verb like got/bought/paid/sent is NEVER a name. "person_name" is only an actual given name, not a relationship word and not a store. Filipino ride types (tricycle, trike, jeepney, jeep, habal-habal, pedicab, kuliglig, taxi, angkas) are "transport" — NEVER a person and never person_name. If unsure, use "unknown"/empty and a low confidence.\(Corrections.fewShot())
            """
            raw = try? await ai.provider.generate(prompt: prompt)
            if let raw, AIJSON.firstObject(in: raw) != nil {
                store(context, key: cacheKey, payload: raw, ttl: 90 * 86400)   // cache valid JSON ~90 days
            }
        }
        guard let raw, let u = AIJSON.decode(UnderstoodSpend.self, from: raw) else {
            if spend.tags.isEmpty { await autoCategorize(context, ai: ai, spend: spend) }
            return
        }
        let category = u.safeCategory
        let merchant = u.safeMerchant
        let merchantType = u.safeMerchantType
        let domain = u.safeDomain
        let personName = u.safePerson
        let confidence = u.safeConfidence

        // Category — only trust a confident, in-vocabulary label; else ask once.
        if spend.tags.isEmpty {
            if spendCategories.contains(category), confidence >= 0.45 {
                spend.tags = [category]; spend.category = category; spend.dirty = true
            } else {
                await autoCategorize(context, ai: ai, spend: spend)
            }
        }

        // Merchant — record what KIND of place it is, so the curiosity engine never asks
        // "is <store> a person" and the vendor-identify question skips it for good. Key it
        // off the spend's own vendorName when present (that's what topUnidentifiedVendor
        // looks up), and also under the detected merchant name.
        if merchantType != "person", merchantType != "unknown" {
            if let vn = spend.vendorName?.trimmingCharacters(in: .whitespaces), !vn.isEmpty {
                upsertFact(context, key: "vendor_" + slug(vn), value: merchantType, confidence: confidence, source: "inferred")
                // Real logo: remember the AI-assigned domain for THIS spelling, so the
                // vendor's actual logo shows even if the user typed the name oddly.
                if !domain.isEmpty { VendorLogo.remember(name: vn, domain: domain) }
            }
            if !merchant.isEmpty {
                upsertFact(context, key: "vendor_" + slug(merchant), value: merchantType, confidence: confidence, source: "inferred")
                if !domain.isEmpty { VendorLogo.remember(name: merchant, domain: domain) }
            }
        }

        // A named person in the spend → ASK before tracking them (don't silently create
        // entities the user then has to go delete). If they're already known, just link.
        if !personName.isEmpty, personName.lowercased() != merchant.lowercased() {
            // If Contacts is connected, ask about the full name ("Ahmed" → "Ahmed Rahmani").
            considerPerson(context, name: ContactsBridge.resolveFullName(personName) ?? personName)
        }
        try? context.save()
    }

    /// Known person → link (bump lastEventAt). Unknown → post ONE clarifying question so
    /// the user decides whether to track them; "Not important" denylists it forever. Never
    /// auto-creates an entity (the user disliked having to delete auto-added people).
    static func considerPerson(_ context: ModelContext, name: String) {
        let clean = name.trimmingCharacters(in: .whitespaces)
        guard clean.count >= 2 else { return }
        // Defensive backstop: a ride is not a person. Even if the cloud LLM mislabels a
        // Filipino transport mode as a person_name, never pester "who is tricycle?".
        let notPeople: Set<String> = ["tricycle", "trike", "tricy", "jeepney", "jeep", "habal",
                                      "habal-habal", "pedicab", "kuliglig", "taxi", "angkas", "bus"]
        if notPeople.contains(clean.lowercased()) { Curiosity.deny(clean); return }
        let entities = (try? context.fetch(FetchDescriptor<Entity>())) ?? []
        if entities.contains(where: { $0.name.lowercased() == clean.lowercased() }) {
            ensurePerson(context, name: clean, relationship: nil)   // known → just link
            return
        }
        if Curiosity.denylist().contains(clean.lowercased()) { return }
        // Don't re-ask while a question about this name is still open.
        let open = (try? context.fetch(FetchDescriptor<AppNotification>()))?.contains {
            $0.isQuestion && $0.answer == nil && ($0.candidateName?.lowercased() == clean.lowercased())
        } ?? false
        if open { return }
        Notify.askQuestion(context, subject: "You spent on “\(clean)” — who or what is that?",
                           body: "Tell me so I can track them, or skip if it doesn't matter.",
                           choices: ["Person", "Pet", "Place", "A thing", "Not important"],
                           freeText: true, questionKind: "entity_discovery", candidateName: clean)
    }

    /// Link an existing person (or create one when the user confirms via a question). Bumps
    /// lastEventAt so "money flow" attributes to them.
    static func ensurePerson(_ context: ModelContext, name: String, relationship: String?) {
        let clean = name.trimmingCharacters(in: .whitespaces)
        guard clean.count >= 2 else { return }
        let rel = relationship?.replacingOccurrences(of: "my ", with: "").trimmingCharacters(in: .whitespaces)
        let entities = (try? context.fetch(FetchDescriptor<Entity>())) ?? []
        // Match by NAME only. (Matching by relationship would merge two different "friend"s
        // into one person.) Relationship-only beneficiaries are named by the relationship
        // word, so they still dedupe correctly by name on the next occurrence.
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
    /// Inbox-only (priority 0, no banner) and dismissible.
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

    /// Recognize what a spend is from its text and tag it; if it can't, ask.
    static func autoCategorize(_ context: ModelContext, ai: AIManager, spend: Spend) async {
        let text = [spend.vendorName, spend.spendDescription, spend.notes].compactMap { $0 }
            .joined(separator: " ").trimmingCharacters(in: .whitespaces)
        if ai.isReady, !text.isEmpty {
            let prompt = """
            Tag this spend with 1–2 labels strictly from this list: \(spendCategories.joined(separator: ", ")).
            Spend: "\(text)" for \(CurrencyFormat.string(spend.amountBase, "PHP", compact: true)).
            Reply ONLY a JSON array of the chosen labels, e.g. ["Groceries"].
            """
            if let r = try? await ai.provider.generate(prompt: prompt) {
                let tags = parseStringArray(r).filter { spendCategories.contains($0) }
                if !tags.isEmpty { spend.tags = tags; spend.category = tags.first; spend.dirty = true; try? context.save(); return }
            }
        }
        // Couldn't recognize it → ask (one open question at a time is enforced by the queue).
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
        // (≥5× is treated as a one-off and excluded; 3–5× is the "bigger one" zone.)
        let mult = Int((spend.amountBase / typical).rounded())
        let what = spend.vendorName ?? spend.spendDescription ?? "that"
        Notify.askQuestion(context,
                           subject: "A bigger one: \(CurrencyFormat.string(spend.amountBase, "PHP", compact: true)) at \(what)",
                           body: "About \(mult)× your usual day. All good, or should I keep it out of your everyday pace?",
                           choices: ["That's normal", "One-off — don't count it"], freeText: false,
                           questionKind: "anomaly_spend", entityId: spend.id.uuidString)
    }

    /// When a variable bill rises notably, post a heads-up — with an AI guess at why.
    static func flagBillIncrease(_ context: ModelContext, ai: AIManager, label: String,
                                 prior: Double, now: Double, currency: String) async {
        guard prior > 0, now > prior * 1.2 else { return }
        let pct = Int(((now - prior) / prior) * 100)
        var body = "Up ~\(pct)% — \(CurrencyFormat.string(prior, currency, compact: true)) → \(CurrencyFormat.string(now, currency, compact: true))."
        if ai.isReady {
            let p = "A recurring bill called \"\(label)\" went from \(Int(prior)) to \(Int(now)) \(currency). In ONE short, warm sentence, suggest the most likely everyday reasons (more usage, a new appliance, seasonal rates). No preaching, no lists."
            if let r = try? await ai.fast.generate(prompt: p) {
                let t = r.trimmingCharacters(in: .whitespacesAndNewlines)
                if !t.isEmpty { body += " " + t }
            }
        }
        Notify.post(context, kind: "bill_up", subject: "\(label) went up", body: body, priority: 1, feature: .spending)
    }

    // MARK: - Cost of living (makes safe-to-spend location-aware)

    /// Asks the model what a realistic typical DAILY discretionary spend is in the
    /// user's city, and stores it so safe-to-spend anchors to real local cost of
    /// living (not wallet ÷ days). Refreshes ~every 2 weeks.
    static func refreshCostOfLiving(_ context: ModelContext, ai: AIManager) async {
        guard ai.isReady else { return }
        let last = UserDefaults.standard.double(forKey: "col.refreshedAt")
        if Date.now.timeIntervalSince1970 - last < 14 * 86400 { return }
        let city = UserDefaults.standard.string(forKey: "user.city") ?? "San Pablo, Laguna, Philippines"
        let prompt = """
        For someone living in \(city), what is a realistic TYPICAL daily personal discretionary spend
        — food, transport, small everyday needs, NOT rent or big monthly bills — in Philippine pesos in 2026?
        Reply with ONLY a single number (pesos per day), no words.
        """
        guard let r = try? await ai.provider.generate(prompt: prompt),
              let n = firstNumber(r.replacingOccurrences(of: ",", with: "")), n > 100, n < 5000 else { return }
        // Self-tuning: blend the AI's city estimate with YOUR observed everyday pace,
        // so over time the anchor becomes truly yours.
        let observed = SafeToSpend.typicalDailySpend((try? context.fetch(FetchDescriptor<Spend>())) ?? [])
        let blended = observed > 100 ? (0.6 * n + 0.4 * observed).rounded() : n
        UserDefaults.standard.set(blended, forKey: "col.dailyBase")
        UserDefaults.standard.set(Date.now.timeIntervalSince1970, forKey: "col.refreshedAt")
    }

    private static func firstNumber(_ s: String) -> Double? {
        var num = ""; var seen = false
        for ch in s { if ch.isNumber || ch == "." { num.append(ch); seen = true } else if seen { break } }
        return Double(num)
    }

    // Tiny JSON helpers for loosely-formatted model output.
    private static func jsonNumber(_ s: String, _ key: String) -> Double? {
        guard let r = s.range(of: "\"\(key)\"") else { return nil }
        let tail = s[r.upperBound...]
        var num = ""; var seenDigit = false
        for ch in tail {
            if ch.isNumber || ch == "." { num.append(ch); seenDigit = true }
            else if ch == "-" && num.isEmpty { num.append(ch) }
            else if seenDigit { break }
        }
        return Double(num)
    }
    private static func jsonString(_ s: String, _ key: String) -> String? {
        guard let r = s.range(of: "\"\(key)\"") else { return nil }
        let tail = s[r.upperBound...]
        guard let open = tail.range(of: "\"")?.upperBound else { return nil }
        let rest = tail[open...]
        guard let close = rest.range(of: "\"")?.lowerBound else { return nil }
        return String(rest[..<close])
    }
    private static func scrub(_ s: String) -> String { s.replacingOccurrences(of: "you should ", with: "", options: .caseInsensitive) }

    // MARK: - Letters (AI editorial reflections from your real activity)

    @discardableResult
    static func generateLetter(_ context: ModelContext, ai: AIManager, kind: String) async -> Bool {
        guard ai.isReady else { return false }
        let snapshot = StateSnapshot.text(context)
        let prompt = """
        Write me a short, warm editorial "letter" reflecting on my \(kind) — money and life together.
        Use REAL numbers and names from the state below; be specific and human, not generic. Two short
        paragraphs. No advice, no "you should", no moralizing — just notice what's true and mirror it back.
        Format EXACTLY: first line is a short evocative headline, then a blank line, then the body.

        \(snapshot)
        """
        guard let r = try? await ai.heavy.generate(prompt: prompt), !r.isEmpty else { return false }
        let parts = r.trimmingCharacters(in: .whitespacesAndNewlines).components(separatedBy: "\n")
        let headline = parts.first?.trimmingCharacters(in: .whitespaces) ?? "A letter"
        let body = parts.dropFirst().joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
        let letter = Letter(title: headline.isEmpty ? "A letter" : headline,
                            body: body.isEmpty ? r : body, kind: kind)
        letter.dirty = true
        context.insert(letter); try? context.save()
        return true
    }

    // MARK: - Clients (notes → living memory, tone-matched nudge)

    /// Distill durable facts from a client's notes into the fact store (subject = client).
    static func extractClientFacts(_ context: ModelContext, ai: AIManager, clientId: String, name: String, notes: String) async {
        guard ai.isReady, notes.trimmingCharacters(in: .whitespaces).count >= 8 else { return }
        let prompt = """
        From these notes about a freelance client named "\(name)", extract durable facts worth remembering.
        Reply with ONLY a JSON array of objects, no prose: [{"key":"snake_case_key","value":"short value"}]
        Keep keys short (pays_late, prefers_email, budget_tier…). Max 10. Notes:
        \(notes)
        """
        guard let r = try? await ai.provider.generate(prompt: prompt) else { return }
        for f in parseFactArray(r).prefix(10) {
            upsertFact(context, subjectKind: "client", subjectId: clientId, key: f.key, value: f.value,
                       confidence: 0.8, source: "inferred")
        }
    }

    /// A short, tone-matched follow-up message for an outstanding balance.
    /// The accountant brain: read EVERYTHING (money, spending with your own words, journals, body,
    /// what it already knows) and produce genuine insights you couldn't get by comparing two numbers.
    /// Builds on prior insights (so it accumulates), stores new ones in InsightLog. Returns # added.
    @discardableResult
    static func generateInsights(_ context: ModelContext, ai: AIManager) async -> Int {
        guard ai.isReady else { return 0 }
        let onDevice = !ai.cloudReachable   // scrub only if this could actually reach Gemini
        let money = StateSnapshot.text(context)
        let letters = ((try? context.fetch(FetchDescriptor<Letter>())) ?? [])
            .filter { $0.deletedAt == nil }.sorted { $0.createdAt > $1.createdAt }.prefix(8)
        let journal = letters.map { "[\($0.createdAt.formatted(.dateTime.month().day()))] \($0.body.prefix(400))" }.joined(separator: "\n")
        let prior = ((try? context.fetch(FetchDescriptor<InsightLog>())) ?? [])
            .filter { $0.dismissedAt == nil }.sorted { $0.createdAt > $1.createdAt }.prefix(15).map { $0.text }
        let safeJournal = Redactor.forCloud(journal, onDevice: onDevice)
        let prompt = """
        You are my sharp, caring financial + life analyst — an accountant who also knows me as a person.
        Below is my REAL money data (with my own words on spends) and my recent journal entries. Give me
        2-4 GENUINE insights I could NOT get by comparing two numbers myself: patterns over time, cause-and-
        effect between my life and my money, blind spots, things worth my attention. Specific and grounded
        in the data — never generic advice. BUILD ON (never repeat) what you've already observed. If there's
        nothing genuinely new worth saying, return fewer (even zero).
        CRITICAL: each insight is ONE punchy sentence, 18 words MAX — the kind I'll actually read. No preamble,
        no "you might want to", no hedging, no explaining the obvious. Lead with the finding. Cut every word
        that isn't load-bearing.
        Reply with ONLY a JSON object: {"insights":[{"text":"…","category":"money|spending|life|pattern"}]}.

        === MONEY, SPENDING & BODY ===
        \(money)
        === RECENT JOURNAL ===
        \(safeJournal.isEmpty ? "none yet" : safeJournal)
        === WHAT YOU'VE ALREADY TOLD ME (don't repeat these) ===
        \(prior.isEmpty ? "nothing yet" : "- " + prior.joined(separator: "\n- "))
        """
        guard let raw = try? await ai.heavy.generate(prompt: prompt),
              let jsonStr = AIJSON.firstObject(in: raw),
              let data = jsonStr.data(using: .utf8),
              let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let arr = obj["insights"] as? [[String: Any]] else { return 0 }
        var added = 0
        let existing = prior.map { $0.lowercased() }
        await MainActor.run {
            for o in arr {
                guard let text = (o["text"] as? String)?.trimmingCharacters(in: .whitespaces), text.count >= 12 else { continue }
                // Backstop on brevity: if the model ignores the 18-word cap and rambles, drop it.
                if text.split(whereSeparator: { $0 == " " || $0 == "\n" }).count > 30 { continue }
                // Skip near-duplicates of what we already said.
                if existing.contains(where: { $0.contains(text.prefix(24).lowercased()) }) { continue }
                let cat = (o["category"] as? String) ?? "pattern"
                let i = InsightLog(text: text, category: cat); i.dirty = true
                context.insert(i); added += 1
            }
            UserDefaults.standard.set(Date.now.timeIntervalSince1970, forKey: "insights.lastAt")
            try? context.save()
        }
        return added
    }

    /// Everything the journal AI should remember before opening its mouth: every question it has
    /// EVER asked (open, answered, dismissed) + taste signals + mood trail + recent themes +
    /// durable user facts + fresh entry excerpts. This is what stops it asking about the same
    /// phone three days in a row — and teaches it which questions land.
    struct JournalMemory {
        var asked: [String] = []      // full ask-history (burned topics)
        var liked: [String] = []      // marked "good question"
        var noped: [String] = []      // marked "not for me" or dismissed
        var moodTrail = ""            // recent sentiments, newest first
        var themes = ""
        var facts = ""
        var recent = ""               // last few entries, excerpted
    }

    @MainActor
    static func journalMemory(_ context: ModelContext) -> JournalMemory {
        var m = JournalMemory()
        let askedRows = ((try? context.fetch(FetchDescriptor<JournalPrompt>())) ?? [])
            .sorted { $0.createdAt > $1.createdAt }
        // Always keep explicit "skip / not for me" signals (never silently age them out);
        // cap only the softer history at the most-recent 80. The old flat 60-row window
        // let old topics fall off and get re-asked — this stops that.
        let hardNo = askedRows.filter { $0.status == "dismissed" || $0.feedback == "down" }
        let softer = askedRows.filter { !($0.status == "dismissed" || $0.feedback == "down") }.prefix(80)
        m.asked = (hardNo + Array(softer)).map { "- \($0.text)\($0.status == "dismissed" ? " (they chose to skip this — drop the topic)" : "")" }
        m.liked = askedRows.filter { $0.feedback == "up" }.prefix(10).map(\.text)
        m.noped = askedRows.filter { $0.feedback == "down" }.prefix(12).map(\.text)
        let letters = ((try? context.fetch(FetchDescriptor<Letter>())) ?? [])
            .filter { $0.deletedAt == nil }.sorted { $0.createdAt > $1.createdAt }
        m.moodTrail = letters.prefix(8).compactMap { l in
            l.sentiment.map { "\(l.createdAt.formatted(.dateTime.month().day())): \($0)" }
        }.joined(separator: ", ")
        m.themes = Array(Set(letters.prefix(10).flatMap { $0.themes })).prefix(8).joined(separator: ", ")
        // Multi-resolution memory (Hermes-style): the compact core digest carries the durable
        // knowledge; only a handful of FRESH facts ride along raw. Cheaper per call than the
        // old 14-fact dump, and the digest is curated so nothing important is missing.
        let freshFacts = ((try? context.fetch(FetchDescriptor<AIFact>())) ?? [])
            .filter { $0.subjectKind == "user" && $0.archivedAt == nil }
            .sorted { $0.updatedAt > $1.updatedAt }.prefix(6)
            .map { "\($0.key): \($0.value)" }.joined(separator: "; ")
        let digest = MemoryCompactor.digest
        m.facts = digest.isEmpty
            ? ((try? context.fetch(FetchDescriptor<AIFact>())) ?? [])
                .filter { $0.subjectKind == "user" && $0.archivedAt == nil }
                .sorted { $0.updatedAt > $1.updatedAt }.prefix(14)
                .map { "\($0.key): \($0.value)" }.joined(separator: "; ")
            : digest + (freshFacts.isEmpty ? "" : "\nFreshest facts: \(freshFacts)")
        m.recent = letters.prefix(3).map { l in
            "[\(l.createdAt.formatted(.dateTime.month().day()))] Q: \(l.title) — they wrote: \(String(l.body.prefix(280)))"
        }.joined(separator: "\n")
        return m
    }

    /// Personalized open-ended journaling prompts. The model sees the FULL ask-history so it never
    /// repeats or rephrases a question it already asked. Returns up to `count` new prompts.
    static func journalPrompts(_ context: ModelContext, ai: AIManager, count: Int = 3) async -> [String] {
        guard ai.isReady else { return [] }
        let mem = await journalMemory(context)
        let prompt = """
        You are the journaling companion inside a private life-OS. Generate \(count) SHORT, open-ended
        journaling questions personalized to this person — each inviting a long, honest paragraph
        (never yes/no, never prying or clinical). Warm, specific, grounded in what they've actually
        written. Vary the territory: feelings, work, money, people, faith, the future.

        HARD RULES:
        - NEVER repeat, rephrase, or circle back to ANY question in the ask-history below. If a topic
          was already asked about (even once), it is BURNED unless their recent writing reopened it.
        - Don't ask things their entries already answered. Build on what they said instead.
        - No generic filler ("how was your day"). Every question should feel like it could only be
          asked of THIS person.
        - MATCH THEIR MOOD: read the mood trail below. If they've been heavy, drained, or anxious,
          ask gentler, restorative questions — nothing that demands ambition. If they've been bright,
          it's safe to be forward-looking and bold.

        Reply with ONLY a JSON object: {"prompts":["…","…","…"]}.

        Ask-history (burned topics):
        \(mem.asked.isEmpty ? "(none yet)" : mem.asked.joined(separator: "\n"))
        Questions they marked as GOOD — write more in this spirit:
        \(mem.liked.isEmpty ? "(no signal yet)" : mem.liked.map { "- \($0)" }.joined(separator: "\n"))
        Questions they marked NOT FOR ME — learn what to avoid (tone, topic, framing):
        \(mem.noped.isEmpty ? "(no signal yet)" : mem.noped.map { "- \($0)" }.joined(separator: "\n"))
        Their recent mood trail (newest first): \(mem.moodTrail.isEmpty ? "unknown" : mem.moodTrail)
        Recent themes they've written about: \(mem.themes.isEmpty ? "none yet" : mem.themes)
        What I know about them: \(mem.facts.isEmpty ? "not much yet" : mem.facts)
        Their most recent entries:
        \(mem.recent.isEmpty ? "(nothing yet)" : mem.recent)
        """
        guard let raw = try? await ai.heavy.generate(prompt: prompt),
              let jsonStr = AIJSON.firstObject(in: raw),
              let data = jsonStr.data(using: .utf8),
              let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let arr = obj["prompts"] as? [Any] else { return [] }
        return arr.compactMap { ($0 as? String)?.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }.prefix(count).map { $0 }
    }

    // MARK: - Mind × money

    /// The freshest stored mind×money insights (may be empty) — display-only read, never hits AI.
    @MainActor
    static func mindMoneyLines(_ context: ModelContext) -> [String] {
        guard let raw = cachedStable(context, key: "mind_money"),
              let data = raw.data(using: .utf8),
              let arr = (try? JSONSerialization.jsonObject(with: data)) as? [String] else { return [] }
        return arr
    }

    /// Cross-domain synthesis nobody else has: how their mood (journal sentiment) tracks against
    /// their money (spends out, income in) over the last 8 weeks. Grounded in real days and real
    /// amounts — instructed to find NOTHING rather than invent. Cached 3 days.
    static func mindMoney(_ context: ModelContext, ai: AIManager, force: Bool = false) async -> [String] {
        guard ai.isReady else { return await mindMoneyLines(context) }
        if !force {
            let cached = await mindMoneyLines(context)
            if !cached.isEmpty { return cached }
        }
        let (dataset, base, enough) = await MainActor.run { mindMoneyDataset(context) }
        guard enough else { return [] }
        let prompt = """
        You see a freelancer's private mood trail (one-word sentiments from journal entries) alongside
        their daily money flows (spend out, income in), base currency \(base).
        Find up to 3 REAL patterns connecting mind and money — correlations, lead/lag effects (e.g.
        "the heavy entries cluster in the week before income lands"), spending spikes around certain
        moods, or a notable honest absence of connection.
        Each insight: ONE sentence, concrete, citing actual days/amounts from the data below. Warm,
        plain words — no therapy-speak, no percentages pulled from thin air.
        If the data is too thin for a real pattern, return fewer insights — or none. NEVER invent.
        Reply with ONLY a JSON object: {"insights":["…","…"]}
        Data (newest first, one line per day that had mood or money):
        \(dataset)
        """
        guard let raw = try? await ai.heavy.generate(prompt: prompt),
              let jsonStr = AIJSON.firstObject(in: raw),
              let data = jsonStr.data(using: .utf8),
              let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let arr = obj["insights"] as? [Any] else { return await mindMoneyLines(context) }
        let lines = arr.compactMap { ($0 as? String)?.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }.prefix(3).map { $0 }
        await MainActor.run {
            if let d = try? JSONSerialization.data(withJSONObject: Array(lines)), let s = String(data: d, encoding: .utf8) {
                store(context, key: "mind_money", payload: s, ttl: 3 * 24 * 3600)
            }
        }
        return Array(lines)
    }

    /// One compact line per day (last 56) that had mood or money. `enough` requires ≥4 mood-tagged
    /// days — below that any "pattern" would be noise.
    @MainActor
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
        var days: [Date: (moods: [String], out: Double, inn: Double)] = [:]
        func key(_ d: Date) -> Date { cal.startOfDay(for: d) }
        for l in letters {
            var r = days[key(l.createdAt)] ?? ([], 0, 0)
            if let s = l.sentiment, !s.isEmpty { r.moods.append(s) }
            days[key(l.createdAt)] = r
        }
        for s in spends {
            var r = days[key(s.spentAt)] ?? ([], 0, 0); r.out += s.amountBase; days[key(s.spentAt)] = r
        }
        for p in pays {
            var r = days[key(p.paidAt)] ?? ([], 0, 0)
            r.inn += (p.grossAtMarketBase ?? p.netAmountBase ?? 0); days[key(p.paidAt)] = r
        }
        let moodDays = days.values.filter { !$0.moods.isEmpty }.count
        let rows = days.keys.sorted(by: >).map { d -> String in
            let r = days[d]!
            var bits: [String] = []
            if !r.moods.isEmpty { bits.append("mood: \(r.moods.joined(separator: "/"))") }
            if r.out > 0 { bits.append("spent \(Int(r.out)) \(base)") }
            if r.inn > 0 { bits.append("received \(Int(r.inn)) \(base)") }
            return "\(d.formatted(.dateTime.month(.twoDigits).day(.twoDigits))): \(bits.joined(separator: "; "))"
        }
        return (rows.joined(separator: "\n"), base, moodDays >= 4)
    }

    // MARK: - Duplicate people

    struct DupeGroup: Codable, Identifiable {
        var keep: String          // entity id to keep
        var merge: [String]       // entity ids to fold into it
        var why: String
        var id: String { keep + "|" + merge.sorted().joined(separator: ",") }
    }

    /// AI-grade duplicate detection for People. The old heuristic only caught "my wife" vs a
    /// relationship field; the model also knows "Celine", "wife" and "my wife" are one person.
    /// Conservative by instruction, cached per entity-list fingerprint, and pairs the user
    /// marked "not the same" are never suggested again.
    static func findDuplicatePeople(_ context: ModelContext, ai: AIManager, force: Bool = false) async -> [DupeGroup] {
        guard ai.isReady else { return [] }
        let (listing, fingerprint) = await MainActor.run { () -> (String, String) in
            let entities = ((try? context.fetch(FetchDescriptor<Entity>())) ?? [])
                .filter { $0.deletedAt == nil && !$0.archived }
            let lines = entities.map { e in
                "id: \(e.id.uuidString) | name: \"\(e.name)\" | kind: \(e.kind.label)"
                + ((e.relationship?.isEmpty == false) ? " | relationship: \(e.relationship!)" : "")
                + ((e.notes?.isEmpty == false) ? " | notes: \(String(e.notes!.prefix(80)))" : "")
            }
            // STABLE hash — String.hashValue is randomized per launch, so it would make the
            // cache miss every launch and re-run this heavy prompt (token waste). FNV is stable.
            return (lines.joined(separator: "\n"), StableHash.of(lines.sorted().joined()))
        }
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
           let raw = await MainActor.run(body: { cached(context, key: "dupe_people", fingerprint: fingerprint) }),
           let data = raw.data(using: .utf8),
           let groups = try? JSONDecoder().decode([DupeGroup].self, from: data) {
            return filtered(groups)
        }
        guard listing.split(separator: "\n").count > 1 else { return [] }
        let prompt = """
        These are people/entities tracked in a private life app. Some entries are DUPLICATES —
        the same real person entered different ways (e.g. "Celine", "wife", and "my wife" can all
        be the user's wife). Group entries that clearly refer to the same real person or thing.
        For each group pick the entry to KEEP: a real name beats a relationship word ("Celine"
        beats "wife"); the most complete record wins ties.
        BE CONSERVATIVE: relationship words matching a relationship field, one name contained in
        another, or obvious nickname/full-name pairs. Two DIFFERENT real names are never the same
        person. No group → empty list.
        Reply with ONLY a JSON object: {"groups":[{"keep":"<id>","merge":["<id>"],"why":"<short reason>"}]}
        Entities:
        \(listing)
        """
        // fast tier: short structured matching — runs on-device when available (free, private).
        guard let raw = try? await ai.fast.generate(prompt: prompt),
              let jsonStr = AIJSON.firstObject(in: raw),
              let data = jsonStr.data(using: .utf8),
              let obj = try? JSONDecoder().decode([String: [DupeGroup]].self, from: data),
              let groups = obj["groups"] else { return [] }
        let valid = groups.filter { UUID(uuidString: $0.keep) != nil && !$0.merge.isEmpty }
        await MainActor.run {
            if let d = try? JSONEncoder().encode(valid), let s = String(data: d, encoding: .utf8) {
                store(context, key: "dupe_people", payload: s, ttl: 7 * 24 * 3600, fingerprint: fingerprint)
            }
        }
        return filtered(valid)
    }

    /// Project lifecycle → journal bridge. When a deal closes (fully paid) or falls through
    /// (deleted before being paid), drop ONE gentle question about it into the journal. Deduped
    /// by text, so a project can only ever ask once.
    @MainActor
    static func enqueueProjectPostMortem(_ context: ModelContext, projectTitle: String, clientName: String?, outcome: String) {
        let title = projectTitle.trimmingCharacters(in: .whitespaces)
        guard !title.isEmpty else { return }
        let who = clientName.map { " for \($0)" } ?? ""
        let text: String
        switch outcome {
        case "paid":
            text = "“\(title)”\(who) just wrapped, fully paid — how did this one feel, start to finish? Anything you'd price, scope, or do differently next time?"
        default:
            text = "“\(title)”\(who) didn't work out in the end — what happened, and how are you sitting with it?"
        }
        storeJournalPrompts(context, texts: [text], source: "project")
    }

    /// Persist freshly generated prompts as OPEN questions — deduped (case-insensitive) against every
    /// prompt ever stored, so an answered or dismissed question can never sneak back in. Returns how
    /// many were actually added.
    /// Loose topical fingerprint of a question — lowercase content words, stop-words dropped —
    /// used to catch a REPHRASED duplicate that the exact-string check would miss.
    private static func promptTokens(_ s: String) -> Set<String> {
        let stop: Set<String> = ["the","a","an","and","or","but","to","of","in","on","for","is","are","was","were","do","does","you","your","yours","that","this","it","with","what","how","when","why","who","been","have","has","had","feel","feeling","about","they","their","them","one","more","most","some","any","get","got","like","just"]
        return Set(s.lowercased()
            .components(separatedBy: CharacterSet.alphanumerics.inverted)
            .filter { $0.count > 2 && !stop.contains($0) })
    }
    private static func jaccard(_ a: Set<String>, _ b: Set<String>) -> Double {
        guard !a.isEmpty, !b.isEmpty else { return 0 }
        let inter = a.intersection(b).count
        let uni = a.union(b).count
        return uni == 0 ? 0 : Double(inter) / Double(uni)
    }

    @MainActor @discardableResult
    static func storeJournalPrompts(_ context: ModelContext, texts: [String], source: String = "ai",
                                    sourceLetterId: UUID? = nil, sourceExcerpt: String? = nil) -> Int {
        let all = ((try? context.fetch(FetchDescriptor<JournalPrompt>())) ?? [])
        let existing = Set(all.map { $0.text.lowercased().trimmingCharacters(in: .whitespaces) })
        // Semantic dedup: reject a candidate that's a reworded twin of any recent question
        // (the #1 cause of "it keeps asking the same thing"). Token-overlap — no embedding infra needed.
        var seenTokens = all.sorted { $0.createdAt > $1.createdAt }.prefix(150).map { promptTokens($0.text) }
        var added = 0
        for t in texts {
            let key = t.lowercased().trimmingCharacters(in: .whitespaces)
            guard !key.isEmpty, !existing.contains(key) else { continue }
            let toks = promptTokens(t)
            if seenTokens.contains(where: { jaccard($0, toks) >= 0.6 }) { continue }
            let p = JournalPrompt(text: t, source: source); p.dirty = true
            p.sourceLetterId = sourceLetterId
            p.sourceExcerpt = sourceExcerpt
            context.insert(p); added += 1
            seenTokens.append(toks)   // also dedup within this same batch
        }
        if added > 0 { try? context.save() }
        return added
    }

    /// Brand/price intelligence: given items you bought (name + price-per-unit in base), ask the AI
    /// for the typical Philippine retail price and whether you got a good deal. Knowledge-based
    /// estimate (no fragile live scraping) — approximate but never breaks. Returns name → verdict.
    static func receiptDealCheck(_ ai: AIManager, items: [(name: String, unitPrice: Double)], base: String) async -> [String: String] {
        guard ai.isReady, !items.isEmpty else { return [:] }
        let list = items.map { "- \($0.name): paid \(String(format: "%.0f", $0.unitPrice)) \(base)/unit" }.joined(separator: "\n")
        let prompt = """
        These are grocery/retail items I bought in the Philippines and what I paid per unit. For EACH item,
        recognize the brand if you can, estimate the typical Philippine retail price per unit, and judge whether
        I got a good deal, a fair price, or overpaid. Keep each verdict to one short phrase like
        "good deal — usually ~₱48" or "a bit high — typically ₱30".
        Reply with ONLY a JSON object mapping each item's EXACT name to its short verdict.
        \(list)
        """
        guard let raw = try? await ai.heavy.generate(prompt: prompt),
              let jsonStr = AIJSON.firstObject(in: raw),
              let data = jsonStr.data(using: .utf8),
              let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return [:] }
        return obj.compactMapValues { $0 as? String }
    }

    /// Read a finished journal entry: tag a one-word sentiment + up to 3 themes, fold any durable
    /// fact into the AI memory, and — when `followUp` is on — let it propose AT MOST one follow-up
    /// question, which is stored as an open prompt for another day. All on-device-first.
    @discardableResult
    static func analyzeJournal(_ context: ModelContext, ai: AIManager, letter: Letter, followUp: Bool = false) async -> Bool {
        let text = letter.body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard text.count >= 20 else { return false }
        let safe = Redactor.forCloud(text, onDevice: !ai.cloudReachable)
        let mem = followUp ? await journalMemory(context) : JournalMemory()
        let followUpKey = followUp ? ",\"followup\":\"<one question or empty string>\"" : ""
        let followUpRules = followUp ? """

        Follow-up rules: propose ONE follow-up question ONLY if the entry clearly leaves a thread worth
        pulling on another day — something they're sitting with, deciding, or feeling their way through.
        Anchor it in something CONCRETE they wrote in THIS entry (a phrase, a decision, a person, a feeling)
        so it's unmistakably about what they just said — never a generic prompt.
        Match its emotional weight to their recent mood trail (\(mem.moodTrail.isEmpty ? "unknown" : mem.moodTrail)):
        gentler when they're heavy, bolder when they're bright.
        It must NOT repeat or rephrase anything in this ask-history:
        \(mem.asked.isEmpty ? "(none)" : mem.asked.joined(separator: "\n"))
        If nothing earns a follow-up (most entries don't), return an empty string for it. Never force it.
        """ : ""
        let prompt = """
        Read this private journal entry (written in answer to: “\(letter.title)”). Reply with ONLY a JSON object:
        {"sentiment":"<one lowercase word for the mood>","themes":["<theme>","<theme>","<theme>"],"memory":"<one durable fact about the writer worth remembering, or empty string>"\(followUpKey)}
        Up to 3 short themes (1-2 words each). The "memory" is optional — only a lasting preference/goal/situation, not a passing mood. No commentary.\(followUpRules)
        Entry: \(safe)
        """
        // Plain tagging (no follow-up) is a fast-tier extract — on-device when available, so the
        // most frequent AI call in the app costs zero tokens. Follow-up generation needs the
        // ask-history reasoning → heavy.
        let provider = followUp ? ai.heavy : ai.fast
        guard let raw = try? await provider.generate(prompt: prompt),
              let jsonStr = AIJSON.firstObject(in: raw),
              let data = jsonStr.data(using: .utf8),
              let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return false }
        let sentiment = (obj["sentiment"] as? String)?.trimmingCharacters(in: .whitespaces)
        let themes = (obj["themes"] as? [Any])?.compactMap { ($0 as? String)?.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        await MainActor.run {
            if let s = sentiment, !s.isEmpty { letter.sentiment = s }
            if let t = themes, !t.isEmpty { letter.themesRaw = t.prefix(3).joined(separator: ", ") }
            letter.dirty = true
            if let mem = (obj["memory"] as? String)?.trimmingCharacters(in: .whitespaces), mem.count >= 8 {
                let key = "journal_\(Int(letter.createdAt.timeIntervalSince1970))"
                upsertFact(context, key: key, value: mem, confidence: 0.6, source: "inferred")
            }
            if followUp, let f = (obj["followup"] as? String)?.trimmingCharacters(in: .whitespaces), f.count >= 12 {
                // Carry the answer this follow-up grew out of, so it's never shown context-free.
                let excerpt = text.count > 150 ? String(text.prefix(150)) + "…" : text
                storeJournalPrompts(context, texts: [f], source: "followup",
                                    sourceLetterId: letter.id, sourceExcerpt: excerpt)
            }
            try? context.save()
        }
        return true
    }

    static func draftNudge(_ ai: AIManager, name: String, outstanding: String, facts: [String], tone: String = "warm") async -> String {
        guard ai.isReady else {
            return "Hi \(name), just following up on the outstanding balance of \(outstanding) when you get a chance — thanks!"
        }
        let context = facts.isEmpty ? "" : "\nWhat I know about them: " + facts.joined(separator: "; ")
        let toneLine: String
        switch tone {
        case "firm": toneLine = "Tone: direct and firm but still polite — this balance is overdue and you want it settled."
        case "formal": toneLine = "Tone: formal and professional, business-letter register."
        default: toneLine = "Tone: warm and friendly, like a freelancer who values the relationship."
        }
        let prompt = """
        Draft a short follow-up message to my client \(name) about an outstanding balance of \(outstanding).
        Under 4 sentences. No placeholders, no "[name]", ready to send. \(toneLine)\(context)
        """
        let r = (try? await ai.heavy.generate(prompt: prompt)) ?? ""
        return r.isEmpty ? "Hi \(name), following up on the \(outstanding) outstanding — thanks!" : r.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Read a client's notes + project history for friction signals (scope creep,
    /// revision burden, rate lag, underpriced…). Returns up to 3 short observations.
    static func rateSignals(_ ai: AIManager, name: String, material: String) async -> [String] {
        guard ai.isReady, material.trimmingCharacters(in: .whitespaces).count >= 12 else { return [] }
        let prompt = """
        Read these notes and project history about my freelance client "\(name)". List up to 3 SHORT
        friction signals you notice (scope creep, revision burden, rate lag, underpriced, slow to pay…),
        each one terse sentence. If nothing stands out, return an empty array. No advice, just observations.
        Reply with ONLY a JSON array of strings. Material:
        \(material)
        """
        guard let r = try? await ai.provider.generate(prompt: prompt) else { return [] }
        return parseStringArray(r).prefix(3).map { $0 }
    }

    private static func parseStringArray(_ s: String) -> [String] {
        guard let lo = s.firstIndex(of: "["), let hi = s.lastIndex(of: "]") else { return [] }
        guard let data = String(s[lo...hi]).data(using: .utf8),
              let arr = try? JSONSerialization.jsonObject(with: data) as? [String] else { return [] }
        return arr.filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
    }

    private static func parseFactArray(_ s: String) -> [(key: String, value: String)] {
        guard let lo = s.firstIndex(of: "["), let hi = s.lastIndex(of: "]") else { return [] }
        let sub = String(s[lo...hi])
        guard let data = sub.data(using: .utf8),
              let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return [] }
        return arr.compactMap { o in
            guard let k = o["key"] as? String else { return nil }
            let v: String
            if let s = o["value"] as? String { v = s }
            else if let n = o["value"] as? NSNumber { v = "\(n)" }
            else { return nil }
            let key = k.lowercased().replacingOccurrences(of: " ", with: "_").filter { $0.isLetter || $0.isNumber || $0 == "_" }
            return key.isEmpty || v.isEmpty ? nil : (key, v)
        }
    }

    // MARK: - Fact store

    static func upsertFact(_ context: ModelContext, subjectKind: String = "user", subjectId: String? = nil,
                           key: String, value: String, confidence: Double = 1.0, source: String = "user_answered") {
        let id = "\(subjectKind):\(subjectId ?? "_"):\(key)"
        let d = FetchDescriptor<AIFact>(predicate: #Predicate { $0.id == id })
        if let row = (try? context.fetch(d))?.first {
            row.value = value; row.confidence = confidence; row.source = source
            row.updatedAt = .now; row.archivedAt = nil
        } else {
            context.insert(AIFact(subjectKind: subjectKind, subjectId: subjectId, key: key,
                                  value: value, confidence: confidence, source: source))
        }
        try? context.save()
    }

    static func hasFact(_ context: ModelContext, subjectKind: String = "user", subjectId: String? = nil, key: String) -> Bool {
        let id = "\(subjectKind):\(subjectId ?? "_"):\(key)"
        let d = FetchDescriptor<AIFact>(predicate: #Predicate { $0.id == id && $0.archivedAt == nil })
        return ((try? context.fetch(d))?.isEmpty == false)
    }

    // MARK: - Clarifying questions (ask more while it has little data)

    // (The hardcoded "foundational ladder" of canned questions was removed 2026-06-13 —
    //  every clarifying question is now AI-generated from the user's actual state.)

    /// ONE AI-generated clarifying question for the bell — born from THIS user's actual money
    /// state, known facts, and the FULL ask-history. Local models (Gemma / Apple) are weak at
    /// honoring "don't repeat", so repetition is blocked in CODE, not just asked for: a candidate
    /// is rejected if its fact_key was already asked or is already known, or if its wording is
    /// too similar to any past question. Up to 2 attempts, then silence (better than a repeat).
    static func curiosityQuestion(_ context: ModelContext, ai: AIManager) async -> (subject: String, body: String, choices: [String], factKey: String)? {
        guard ai.isReady else { return nil }
        let ctx = await MainActor.run { () -> (snapshot: String, facts: String, askedBlock: String,
                                               askedTokens: [Set<String>], askedKeys: Set<String>, knownKeys: Set<String>) in
            let snap = StateSnapshot.text(context)
            // Digest-led context (Hermes-style): curated core memory + a few fresh raw facts.
            let liveFacts = ((try? context.fetch(FetchDescriptor<AIFact>())) ?? []).filter { $0.archivedAt == nil }
            let fresh = liveFacts.sorted { $0.updatedAt > $1.updatedAt }
                .prefix(MemoryCompactor.digest.isEmpty ? 30 : 12)
                .map { "\($0.key): \($0.value)" }.joined(separator: "; ")
            let digest = MemoryCompactor.digest
            let facts = digest.isEmpty ? fresh : digest + "\nFreshest facts: \(fresh)"
            let knownKeys = Set(liveFacts.map { $0.key.lowercased() })
            let rows = ((try? context.fetch(FetchDescriptor<AppNotification>())) ?? [])
                .filter { $0.isQuestion }.sorted { $0.createdAt > $1.createdAt }
            let askedBlock = rows.prefix(40)
                .map { "- \($0.subject)\($0.dismissedAt != nil && $0.answer == nil ? " (they skipped this — drop the topic)" : "")" }
                .joined(separator: "\n")
            let askedTokens = rows.prefix(60).map { topicTokens($0.subject) }
            let askedKeys = Set(rows.compactMap { $0.factKey?.lowercased() }.filter { !$0.isEmpty })
            return (snap, facts, askedBlock, askedTokens, askedKeys, knownKeys)
        }

        func basePrompt(_ extra: String) -> String {
            """
            You are the curiosity of a private life-OS for a solo freelancer. Decide whether there is ONE
            question worth asking them right now — something that would make the system genuinely smarter
            about THEIR life or money, grounded in the state below.

            ABSOLUTE RULE — NO REPEATS: Do NOT ask about any topic already in the ask-history or already in
            "what I already know", not even reworded, narrowed, or from a different angle. If the only
            questions you can think of touch those topics, answer {"ask":false}. A repeat is the worst
            possible output — silence is always better. Pick a topic from a DIFFERENT area of their life
            (money, work, people, faith, health, home, the future) than anything recently asked.\(extra)

            Reply with ONLY a JSON object:
            {"ask":true|false,"subject":"<the question>","body":"<one line on why you're asking>","choices":["<2-4 tap answers>"],"fact_key":"<snake_case key for the answer>"}
            STRICT FORMAT — these roles must never swap:
            · "subject" IS the question: one short interrogative sentence, ending in "?".
            · "choices" are ANSWERS the user taps — short phrases (max ~5 words), statements only,
              NEVER questions. Example: subject "Is the Honda your only vehicle?" →
              choices ["Yes, just the Honda", "No, there's another", "I don't drive"].
            · "body" is one short statement (not a question) explaining why you're asking.
            · "fact_key" is a snake_case label for WHAT the answer records (e.g. "primary_vehicle").

            Ask-history — these topics are BURNED, never ask them again:
            \(ctx.askedBlock.isEmpty ? "(none yet)" : ctx.askedBlock)
            What I already know (never ask about these):
            \(ctx.facts.isEmpty ? "very little" : ctx.facts)
            Current state:
            \(ctx.snapshot)
            """
        }

        // Up to 2 tries: if the model returns a repeat, tell it exactly what to avoid and retry once.
        var extra = ""
        for attempt in 0..<2 {
            guard let raw = try? await ai.heavy.generate(prompt: basePrompt(extra)),
                  let jsonStr = AIJSON.firstObject(in: raw),
                  let data = jsonStr.data(using: .utf8),
                  let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { continue }
            guard (obj["ask"] as? Bool) == true,
                  let subject = (obj["subject"] as? String)?.trimmingCharacters(in: .whitespaces),
                  subject.count >= 8, subject.count <= 140, subject.hasSuffix("?") else { return nil }   // ask:false or malformed → silence
            let key = (obj["fact_key"] as? String)?.trimmingCharacters(in: .whitespaces).lowercased() ?? ""
            let tokens = topicTokens(subject)

            // CODE-SIDE REPEAT BLOCK — the heart of the fix.
            let keyRepeat = !key.isEmpty && (ctx.askedKeys.contains(key) || ctx.knownKeys.contains(key))
            let wordRepeat = ctx.askedTokens.contains { tooSimilar(tokens, $0) }
            if keyRepeat || wordRepeat {
                if attempt == 0 { extra = "\n\nYour previous attempt \"\(subject)\" was a REPEAT and was rejected. Choose a completely different topic this time, or answer {\"ask\":false}." ; continue }
                return nil   // still repeating after a nudge → stay silent
            }

            let body = (obj["body"] as? String)?.trimmingCharacters(in: .whitespaces) ?? ""
            let rawChoices = ((obj["choices"] as? [Any])?.compactMap { $0 as? String } ?? [])
                .map { $0.trimmingCharacters(in: .whitespaces) }
                .filter { !$0.isEmpty && !$0.contains("?") && $0.count <= 48 }
            let choices = rawChoices.count >= 2 ? Array(rawChoices.prefix(4)) : []
            return (subject, body, choices, key.isEmpty ? "curiosity_\(Int(Date.now.timeIntervalSince1970))" : key)
        }
        return nil
    }

    /// Meaningful words of a question, lowercased with punctuation and filler/question words
    /// stripped — the basis for detecting reworded repeats.
    private static func topicTokens(_ s: String) -> Set<String> {
        let stop: Set<String> = ["a","an","the","is","are","do","does","did","you","your","yours","what","whats",
            "how","when","where","who","which","why","of","to","in","on","for","and","or","any","have","has",
            "got","there","this","that","with","still","right","now","it","its","me","my","i","am","be","been",
            "would","could","should","can","want","like","just","about","more","one","ever","most","also"]
        let cleaned = s.lowercased().map { $0.isLetter || $0.isNumber || $0 == " " ? $0 : " " }
        return Set(String(cleaned).split(separator: " ").map(String.init).filter { $0.count > 2 && !stop.contains($0) })
    }

    /// Two questions are "the same topic" if they share most of their meaningful words, or one's
    /// words are essentially a subset of the other's (a narrowed rephrase).
    private static func tooSimilar(_ a: Set<String>, _ b: Set<String>) -> Bool {
        guard !a.isEmpty, !b.isEmpty else { return false }
        let inter = a.intersection(b).count
        let jaccard = Double(inter) / Double(a.union(b).count)
        let subset = Double(inter) / Double(min(a.count, b.count))   // most of the smaller one is contained
        return jaccard >= 0.5 || subset >= 0.7
    }

    /// The most-visited vendor name from spends that has no brand match and no
    /// fact yet. Returns nil when everything's identified.
    static func topUnidentifiedVendor(_ context: ModelContext) -> String? {
        var sd = FetchDescriptor<Spend>(sortBy: [SortDescriptor(\.spentAt, order: .reverse),
                                                 SortDescriptor(\.createdAt, order: .reverse)])
        sd.fetchLimit = 2000   // bound the scan; recency-first (createdAt breaks timestamp ties)
        let spends = (try? context.fetch(sd)) ?? []
        var counts: [String: Int] = [:]
        for s in spends {
            guard let raw = s.vendorName?.trimmingCharacters(in: .whitespaces), !raw.isEmpty else { continue }
            if Brand.match(raw) != nil { continue }                     // a known money rail/brand
            if VendorBrand.match(raw) != nil { continue }               // a known everyday vendor (Jollibee, Mercury…)
            if hasFact(context, key: "vendor_" + slug(raw)) { continue } // already identified by the AI/user
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

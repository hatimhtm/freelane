import SwiftUI
import SwiftData

struct SadakaView: View {
    @Environment(\.modelContext) private var context
    @Query private var settings: [AppSettings]
    @Query(filter: #Predicate<Payment> { $0.deletedAt == nil }, sort: \Payment.paidAt, order: .reverse) private var payments: [Payment]
    @Query(filter: #Predicate<Spend> { $0.deletedAt == nil }, sort: \Spend.spentAt, order: .reverse) private var spends: [Spend]
    @Query(filter: #Predicate<Wallet> { $0.deletedAt == nil }) private var wallets: [Wallet]
    @Query private var ledger: [LedgerEntry]
    @Query(filter: #Predicate<Loan> { $0.deletedAt == nil }) private var loans: [Loan]
    @Query(filter: #Predicate<Recurring> { $0.deletedAt == nil }) private var recurrings: [Recurring]
    @Query private var plans: [Plan]

    @State private var giveOpen = false
    @AppStorage("zakat.gold") private var zakatGold = 0.0      // value of gold/silver/investments
    @AppStorage("zakat.debts") private var zakatDebts = 0.0    // immediate debts you owe
    @AppStorage("zakat.nisab") private var zakatNisab = 0.0    // nisab threshold (value of 595g silver)

    private var base: String { settings.first?.baseCurrency ?? "PHP" }
    private var anchorPct: Double { settings.first?.sadakaAnchorPct ?? 2.5 }

    private var safe: SafeBreakdown {
        SafeToSpend.compute(payments: payments, spends: spends, wallets: wallets, ledger: ledger, recurrings: recurrings, plans: plans)
    }
    private var landedMTD: Double { payments.filter { $0.paidAt >= PHT.startOfMonth() }.reduce(0) { $0 + ($1.netAmountBase ?? 0) } }
    private var spentMTD: Double { spends.filter { $0.spentAt >= PHT.startOfMonth() }.reduce(0) { $0 + $1.amountBase } }
    private var givenMonth: Double { Sadaka.given(spends: spends, loans: loans, since: PHT.startOfMonth()) }
    private var givenYear: Double { Sadaka.given(spends: spends, loans: loans, since: PHT.startOfYear()) }
    private var givenLife: Double { Sadaka.given(spends: spends, loans: loans, since: nil) }
    private var daysSinceLast: Int? {
        Sadaka.lastGiftDate(spends: spends, loans: loans).map { PHT.calendar.dateComponents([.day], from: $0, to: .now).day ?? 0 }
    }
    private var suggestion: Sadaka.Suggestion {
        Sadaka.suggest(safe: safe, landedMTD: landedMTD, spentMTD: spentMTD, givenMTD: givenMonth,
                       daysSinceLastGift: daysSinceLast, anchorPct: anchorPct)
    }

    var body: some View {
        Page("Sadaka", subtitle: "What you give, kept quietly. Never a target.") {
            suggestionHero
            tiles
            anchorCard
            zakatCard
            recentCard
        }
        .sheet(isPresented: $giveOpen) { GiveSadakaSheet(suggested: 0) }
    }

    // MARK: Zakat calculator

    /// Cash held = holding wallet total; receivables = loans you gave that are still out.
    private var zakatCash: Double { wallets.filter { $0.isHolding && !$0.archived }.reduce(0.0) { $0 + WalletMath.balance(of: $1, ledger: ledger) } }
    private var zakatReceivables: Double { loans.filter { $0.direction == .given && $0.outstandingBase > 0 }.reduce(0.0) { $0 + $1.outstandingBase } }
    private var zakatNet: Double { max(0, zakatCash + zakatGold + zakatReceivables - zakatDebts) }
    private var zakatDue: Double { (zakatNisab > 0 && zakatNet >= zakatNisab) ? zakatNet * 0.025 : 0 }

    private var zakatCard: some View {
        SectionCard(title: "Zakat", subtitle: "2.5% on wealth held a full lunar year, above nisab", accent: Palette.teal) {
            VStack(alignment: .leading, spacing: 10) {
                zakatRow("Cash across wallets", zakatCash, auto: true)
                zakatRow("Receivables (loans out)", zakatReceivables, auto: true)
                zakatField("Gold / silver / investments", $zakatGold)
                zakatField("Debts you owe (deduct)", $zakatDebts)
                zakatField("Nisab threshold (value of 595g silver)", $zakatNisab)
                Divider().overlay(Palette.hairline)
                HStack {
                    VStack(alignment: .leading, spacing: 1) {
                        Text("Zakatable wealth").font(.system(size: 11, weight: .semibold)).foregroundStyle(Palette.textTertiary)
                        Text(CurrencyFormat.string(zakatNet, base)).font(Typo.rowFigure(15)).monospacedDigit().foregroundStyle(Palette.textPrimary)
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 1) {
                        Text(zakatNisab > 0 && zakatNet >= zakatNisab ? "ZAKAT DUE (2.5%)" : (zakatNisab > 0 ? "BELOW NISAB — none due" : "SET NISAB ABOVE")).font(.system(size: 10, weight: .semibold)).foregroundStyle(Palette.textTertiary)
                        Text(CurrencyFormat.string(zakatDue, base)).font(Typo.rowFigure(22, .bold)).monospacedDigit().foregroundStyle(zakatDue > 0 ? Palette.teal : Palette.textTertiary)
                    }
                }
                if zakatDue > 0 {
                    Button { giveOpen = true } label: { Label("Give zakat now", systemImage: "heart.fill").frame(maxWidth: .infinity) }
                        .buttonStyle(.glassProminent).tint(Palette.azure)
                }
            }
        }
    }
    private func zakatRow(_ label: String, _ value: Double, auto: Bool) -> some View {
        HStack {
            Text(label).font(.system(size: 12)).foregroundStyle(Palette.textSecondary)
            if auto { Text("auto").font(.system(size: 9, weight: .semibold)).foregroundStyle(Palette.teal).padding(.horizontal, 5).padding(.vertical, 1).background(Palette.teal.opacity(0.16), in: Capsule()) }
            Spacer()
            Text(CurrencyFormat.string(value, base, compact: true)).font(Typo.rowFigure(12, .medium)).monospacedDigit().foregroundStyle(Palette.textPrimary)
        }
    }
    private func zakatField(_ label: String, _ value: Binding<Double>) -> some View {
        HStack {
            Text(label).font(.system(size: 12)).foregroundStyle(Palette.textSecondary)
            Spacer()
            TextField("0", value: value, format: .number).fieldWell().frame(width: 120).multilineTextAlignment(.trailing)
        }
    }

    // MARK: Suggestion hero

    /// What you've given this month — and a way to give. No suggested figure.
    ///
    /// This used to compute an amount and put it on screen as "give this". A number you didn't
    /// choose, arriving unprompted on a page about charity, is pressure dressed as help — and the
    /// one thing this page says at the top is "never required". The suggestion contradicted its own
    /// premise, so it's gone. What's left is the fact (what you've given) and the door (give).
    private var suggestionHero: some View {
        VStack(spacing: 0) {
            Text("Given this month")
                .font(.system(size: 9.5, weight: .semibold))
                .textCase(.uppercase).kerning(1.4)
                .foregroundStyle(Palette.textTertiary)

            CountUpMoney(amount: givenMonth, code: base, size: 52,
                         color: givenMonth > 0 ? Palette.violet : Palette.textSecondary)
                .padding(.top, 14)

            if let last = daysSinceLast {
                Text(last == 0 ? "You gave today." : "Last time was \(last) \(last == 1 ? "day" : "days") ago.")
                    .font(.system(size: 12.5)).foregroundStyle(Palette.textSecondary)
                    .padding(.top, 10)
            }

            Button { giveOpen = true } label: { Label("Give", systemImage: "heart.fill") }
                .buttonStyle(.glassProminent).tint(Palette.violet)
                .padding(.top, 22)
        }
        .padding(.horizontal, 24).padding(.top, 44).padding(.bottom, 46)
        .frame(maxWidth: .infinity)
        .background {
            RadialGradient(colors: [Palette.violet.opacity(0.10), .clear],
                           center: .center, startRadius: 0, endRadius: 300)
        }
    }

    private var tiles: some View {
        HStack(spacing: 0) {
            givenStat("This month", givenMonth, tone: Palette.violet)
            Rectangle().fill(Palette.hairline).frame(width: 1, height: 34)
            givenStat("This year", givenYear, tone: Palette.textPrimary)
            Rectangle().fill(Palette.hairline).frame(width: 1, height: 34)
            givenStat("All-time", givenLife, tone: Palette.textPrimary)
        }
        .padding(.vertical, 18)
        .frame(maxWidth: .infinity)
        .glassCard(cornerRadius: Radii.card)
    }

    private func givenStat(_ label: String, _ value: Double, tone: Color) -> some View {
        VStack(spacing: 5) {
            Text(label)
                .font(.system(size: 9, weight: .semibold)).textCase(.uppercase).kerning(0.9)
                .foregroundStyle(Palette.textTertiary)
            Text(CurrencyFormat.string(value, base, compact: true))
                .font(Typo.figure(20)).monospacedDigit().foregroundStyle(tone)
                .lineLimit(1).minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity)
    }

    private var anchorCard: some View {
        SectionCard(title: "Your anchor", subtitle: "Roughly how much of income to lean toward giving", accent: Palette.negative) {
            HStack(spacing: 14) {
                Text(String(format: "%.1f%%", anchorPct)).font(Typo.rowFigure(22)).monospacedDigit().foregroundStyle(Palette.textPrimary)
                Stepper("", value: Binding(
                    get: { anchorPct },
                    set: { v in
                        let s = settings.first ?? AppSettings()
                        if settings.isEmpty { context.insert(s) }
                        s.sadakaAnchorPct = max(0, min(20, v)); s.dirty = true; try? context.save()
                    }
                ), in: 0...20, step: 0.5).labelsHidden()
                Text("Used only to work out zakat below — nothing on this page nudges you.")
                    .font(.system(size: 11)).foregroundStyle(Palette.textTertiary)
                Spacer()
            }
        }
    }

    // MARK: Recent

    private enum Item: Identifiable {
        case spend(Spend), forgiven(Loan)
        var id: String { switch self { case .spend(let s): return "s\(s.id)"; case .forgiven(let l): return "l\(l.id)" } }
        var date: Date { switch self { case .spend(let s): return s.spentAt; case .forgiven(let l): return l.forgivenAt ?? l.updatedAt } }
    }

    private var recentItems: [Item] {
        let s = spends.filter { Sadaka.counts($0) }.map(Item.spend)
        let f = loans.filter { $0.status == .forgiven }.map(Item.forgiven)
        return (s + f).sorted { $0.date > $1.date }
    }

    private var recentCard: some View {
        SectionCard(title: "Recent giving", subtitle: "Counted automatically + what you marked", accent: Palette.negative) {
            if recentItems.isEmpty {
                EmptyStateCard(icon: "heart", title: "No giving yet",
                               message: "Pet care, charity, gifts to people, and loans you forgive all count here automatically.")
            } else {
                LazyVStack(spacing: 0) {
                    ForEach(Array(recentItems.prefix(40))) { item in
                        row(item)
                        if item.id != recentItems.prefix(40).last?.id { Divider().overlay(Palette.hairline) }
                    }
                }
            }
        }
    }

    @ViewBuilder private func row(_ item: Item) -> some View {
        switch item {
        case .spend(let s):
            let reason = Sadaka.reason(s)
            line(title: s.spendDescription ?? s.vendorName ?? "Sadaka", date: s.spentAt,
                 amount: s.amountBase, badge: reason.rawValue,
                 badgeColor: reason == .manual ? Palette.negative : Palette.teal)
        case .forgiven(let l):
            line(title: "Forgave \(l.counterparty)'s loan", date: l.forgivenAt ?? l.updatedAt,
                 amount: l.forgivenBase ?? 0, badge: "Forgiven loan", badgeColor: Palette.violet)
        }
    }

    private func line(title: String, date: Date, amount: Double, badge: String, badgeColor: Color) -> some View {
        HStack(spacing: 12) {
            LedgerMark(tone: badgeColor)
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.system(size: 13.5, weight: .medium)).foregroundStyle(Palette.textPrimary).lineLimit(1)
                HStack(spacing: 6) {
                    StatusBadge(text: badge, color: badgeColor)
                    Text(date, format: .dateTime.month().day().year())
                        .font(.system(size: 11)).foregroundStyle(Palette.textTertiary)
                }
            }
            Spacer(minLength: 10)
            LedgerAmount(amount: CurrencyFormat.string(amount, base), tone: Palette.violet)
        }
        .padding(.vertical, 10)
        .hoverRow()
    }

}

struct GiveSadakaSheet: View {
    var suggested: Double
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @Query(filter: #Predicate<Wallet> { $0.deletedAt == nil }) private var wallets: [Wallet]
    @Query private var settings: [AppSettings]
    @State private var walletId: UUID?
    @State private var amount = ""
    @State private var why = ""
    @State private var recipientName = ""
    @State private var recipientType = "General"
    @State private var anonymous = true
    @State private var error: String?
    @FocusState private var amountFocused: Bool

    private let recipients = ["General", "Mosque", "Person in need", "Family", "Orphans", "Student", "Medical", "Disaster relief"]
    private var base: String { settings.first?.baseCurrency ?? "PHP" }

    var body: some View {
        SheetScaffold(title: "Give sadaka", accent: Palette.negative,
                      canSave: walletId != nil && (parseAmount(amount) ?? 0) > 0,
                      hint: walletId == nil ? "Pick which wallet it came from" : "Enter an amount above 0",
                      onSave: save) {
            LabeledField("From wallet") {
                GlassMenuPicker(selection: $walletId,
                                options: [UUID?.none] + wallets.filter { $0.isHolding && !$0.archived }.map { UUID?.some($0.id) },
                                label: { id in id.flatMap { i in wallets.first(where: { $0.id == i })?.name } ?? "Select…" })
            }
            LabeledField("Amount (\(base))") { TextField("0", text: $amount).textFieldStyle(GlassFieldStyle()).focused($amountFocused) }
            LabeledField("Recipient") {
                GlassMenuPicker(selection: $recipientType, options: recipients, label: { $0 })
            }
            Toggle(isOn: $anonymous) { Text("Keep the recipient anonymous").font(.system(size: 13)).foregroundStyle(Palette.textPrimary) }
                .toggleStyle(.switch).tint(Palette.negative)
            if !anonymous {
                LabeledField("Who (optional)") { TextField("name", text: $recipientName).fieldWell() }
            }
            LabeledField("Why I gave (optional)") { TextField("a quiet intention, only you see this…", text: $why, axis: .vertical).lineLimit(2...4).fieldWell() }
            Text("This logs a real outflow from the wallet and counts toward your giving.")
                .font(.system(size: 11)).foregroundStyle(Palette.textTertiary)
            if let error { Text(error).font(.caption).foregroundStyle(Palette.negative) }
        }
        .onAppear {
            walletId = wallets.first { $0.isHolding && !$0.archived }?.id
            if suggested > 0 { amount = String(format: "%.0f", suggested) }
            DispatchQueue.main.async { amountFocused = true }
        }
    }

    private func save() {
        // Description carries the reflection (why) + recipient type; vendorName is the named recipient (or nil if anonymous).
        let desc = why.trimmingCharacters(in: .whitespaces).isEmpty
            ? "Sadaka · \(recipientType)" : "Sadaka · \(recipientType) — \(why.trimmingCharacters(in: .whitespaces))"
        let who = anonymous ? nil : (recipientName.trimmingCharacters(in: .whitespaces).isEmpty ? nil : recipientName.trimmingCharacters(in: .whitespaces))
        do {
            _ = try MoneyEngine(context: context).createSpend(
                walletId: walletId, amount: parseAmount(amount) ?? 0, currency: base,
                description: desc, vendorName: who, category: "Sadaka",
                isSadaka: true, spentAt: .now)
            dismiss()
        } catch { self.error = error.localizedDescription }
    }
}

/// Forgiving money parse — accepts "1,500", "1 500", " 1500 " the way a human types them.
fileprivate func parseAmount(_ s: String) -> Double? {
    Double(s.replacingOccurrences(of: ",", with: "").replacingOccurrences(of: " ", with: ""))
}

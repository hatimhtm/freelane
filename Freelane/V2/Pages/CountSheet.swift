import SwiftUI
import SwiftData

/// Count your wallets: type what each really holds, in its own currency. Everything is counted in pesos;
/// a difference becomes one labelled spending line, or is left as unlogged (a balancing adjustment).
struct CountSheet: View {
    @Environment(AppState.self) private var app
    @Environment(\.modelContext) private var context
    let state: MoneyState
    @Query private var rateRows: [ExchangeRate]
    @Query private var settings: [AppSettings]
    @Query(sort: \Spend.spentAt, order: .reverse) private var spends: [Spend]

    private struct Line: Identifiable, Equatable { let id = UUID(); var currency: String; var text: String }
    private enum Label: Equatable { case category(String), unlogged }

    @State private var lines: [UUID: [Line]] = [:]
    @State private var labels: [UUID: Label] = [:]
    @State private var error: String?
    @FocusState private var focus: UUID?

    private var base: String { settings.first?.baseCurrency ?? "PHP" }
    private var rates: Rates { Rates(base: base, rates: rateRows) }
    private var wallets: [WalletLine] { state.wallets.filter(\.inTotals) + state.wallets.filter { !$0.inTotals } }

    var body: some View {
        ZStack {
            Color.black.opacity(0.20).ignoresSafeArea()
                .onTapGesture { close() }
            VStack(alignment: .leading, spacing: 0) {
                Text("Count your wallets").role(.dialog)
                Text("Type what each one really holds, in its own currency. Everything is counted in pesos, and any difference becomes one line you can label or leave as unlogged.")
                    .role(.body, MD.onSurfaceVariant).padding(.top, 6).fixedSize(horizontal: false, vertical: true)
                ViewThatFits(in: .vertical) {
                    rows
                    ScrollView(.vertical, showsIndicators: false) { rows }.frame(maxHeight: 560)
                }
                if let error { Text(error).role(.supporting, MD.error).padding(.top, 8) }
                HStack(spacing: 8) {
                    Spacer()
                    M3Button(title: "Cancel", kind: .plain) { close() }
                    M3Button(title: "Save counts", kind: .filled) { save() }
                        .keyboardShortcut(.return, modifiers: [])
                }
                .padding(.top, 22)
            }
            .padding(24)
            .frame(width: 620)
            .background(RoundedRectangle(cornerRadius: 28, style: .continuous).fill(Surface.dialog))
            .shadow(color: .black.opacity(0.14), radius: 12, y: 8)
            .shadow(color: .black.opacity(0.16), radius: 30, y: 24)
        }
        .onAppear(perform: prefill)
    }

    // MARK: Rows

    private var rows: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(wallets) { w in walletRow(w) }
        }
        .padding(.vertical, 2)
    }

    @ViewBuilder private func walletRow(_ w: WalletLine) -> some View {
        let gap = counted(w) - w.balance
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array((lines[w.id] ?? []).enumerated()), id: \.element.id) { i, line in
                HStack(spacing: 14) {
                    if i == 0 {
                        Badge(subject: .wallet(w.wallet))
                        VStack(alignment: .leading, spacing: 1) {
                            Text(w.name).role(.row)
                            Text("Freelane has \(MoneyFormat.string(w.balance)) · \(w.lastCounted.map { "counted \(Day.ago($0))" } ?? "never counted")\(w.inTotals ? "" : " · not in your totals")")
                                .role(.supporting, MD.onSurfaceVariant).lineLimit(1)
                        }
                    } else {
                        Spacer().frame(width: 40)
                        Text("and in \(line.currency)").role(.supporting, MD.onSurfaceVariant)
                    }
                    Spacer(minLength: 8)
                    field(w, index: i, line: line)
                }
                .padding(.top, i == 0 ? 14 : 8)
            }
            HStack(spacing: 8) {
                if needsConversionNote(w) {
                    Icon(Sym.currencyExchange, size: 20).foregroundStyle(MD.onSurfaceVariant)
                    Text(conversionNote(w)).role(.supporting, MD.onSurfaceVariant)
                }
                Spacer()
                if (lines[w.id]?.count ?? 0) < 3 {
                    Button { addLine(w) } label: {
                        HStack(spacing: 4) { Icon(Sym.add, size: 18); Text("Another currency") }
                            .font(FS.font(13, 600, rond: 60)).foregroundStyle(MD.primary)
                    }
                    .buttonStyle(.plain)
                    .opacity(focus.map { f in lines[w.id]?.contains { $0.id == f } ?? false } ?? false ? 1 : 0.0001)
                }
            }
            .padding(.leading, 54).padding(.top, 4)
            .frame(height: needsConversionNote(w) || focusIn(w) ? 24 : 4)
            if abs(gap) >= 1 { gapCard(w, gap: gap).transition(.opacity.combined(with: .move(edge: .top))) }
        }
        .animation(Flow.spatial, value: abs(gap) >= 1)
    }

    private func field(_ w: WalletLine, index: Int, line: Line) -> some View {
        let focused = focus == line.id
        return HStack(spacing: 0) {
            Menu {
                ForEach(CurrencyFormat.supported, id: \.self) { c in
                    Button(c) { setCurrency(w, index: index, to: c) }
                }
            } label: {
                HStack(spacing: 1) {
                    Text(line.currency).font(FS.font(12, 600, rond: 60)).tracking(0.3)
                    Icon(Sym.expandMore, size: 18)
                }
                .foregroundStyle(MD.onSecondaryContainer)
                .padding(.leading, 10).padding(.trailing, 4).frame(height: 32)
                .background(RoundedRectangle(cornerRadius: 8).fill(MD.secondaryContainer))
            }
            .menuStyle(.button).buttonStyle(.plain).menuIndicator(.hidden).fixedSize()
            TextField("0.00", text: binding(w, index: index))
                .textFieldStyle(.plain)
                .multilineTextAlignment(.trailing)
                .font(FS.font(16, 500, rond: 100, tabular: true))
                .foregroundStyle(MD.onSurface)
                .focused($focus, equals: line.id)
                .padding(.leading, 10)
        }
        .padding(.leading, 7).padding(.trailing, 14)
        .frame(width: 220, height: 48)
        .background(RoundedRectangle(cornerRadius: 12).fill(Surface.dialog))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(focused ? MD.primary : MD.outline, lineWidth: focused ? 2 : 1))
        .overlay(alignment: .topLeading) {
            if focused && index == 0 {
                Text(w.wallet.kind == .cash ? "In hand" : "In the \(w.name) app")
                    .font(FS.font(12, 600, rond: 60)).foregroundStyle(MD.primary)
                    .padding(.horizontal, 4).background(Surface.dialog).offset(x: 10, y: -8)
                    .transition(.opacity)
            }
        }
        .animation(Flow.effects, value: focused)
    }

    private func gapCard(_ w: WalletLine, gap: Double) -> some View {
        let less = gap < 0
        let chosen = labels[w.id]
        return VStack(alignment: .leading, spacing: 10) {
            (Text(verbatim: MoneyFormat.string(abs(gap)) + (less ? " less" : " more")).font(FS.font(14, 600))
                + Text(less ? " than Freelane had. What was it?" : " than Freelane had. It’s kept as money found."))
                .role(.body, MD.onTertiaryContainer)
            if less {
                GapChips(items: categories.map { Label.category($0) } + [.unlogged], selected: chosen ?? .unlogged,
                          title: { if case .category(let c) = $0 { return c }; return "Leave as unlogged" }) { labels[w.id] = $0 }
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(MD.tertiaryContainer))
        .padding(.leading, 54).padding(.top, 10)
    }

    // MARK: State

    private var categories: [String] {
        let billWords = ["rent", "electric", "water", "wifi", "internet"]
        var count: [String: Int] = [:]
        for s in spends.prefix(300) where s.deletedAt == nil && s.recurringId == nil {
            guard let c = s.category, !c.isEmpty, !billWords.contains(where: { c.lowercased().contains($0) }), c.lowercased() != "one-off" else { continue }
            count[c, default: 0] += 1
        }
        return count.sorted { $0.value > $1.value }.prefix(4).map(\.key)
    }

    private func countCurrency(_ w: WalletLine) -> String {
        UserDefaults.standard.string(forKey: "count.currency.\(w.id)") ?? w.wallet.openingBalanceCurrency ?? w.wallet.currencyIn ?? w.wallet.currencyOut ?? base
    }

    private func prefill() {
        guard lines.isEmpty else { return }
        for w in wallets {
            let c = countCurrency(w)
            lines[w.id] = [Line(currency: c, text: format(w.balance / max(rates.rate(for: c), 0.000001)))]
        }
        focus = lines[wallets.first?.id ?? UUID()]?.first?.id
    }

    private func format(_ v: Double) -> String {
        let p = MoneyFormat.parts(v)
        return (v < 0 ? "-" : "") + p.whole + "." + p.cents
    }

    private func value(_ text: String) -> Double? {
        let t = text.replacingOccurrences(of: ",", with: "").replacingOccurrences(of: " ", with: "")
        return t.isEmpty ? 0 : Double(t)
    }

    private func counted(_ w: WalletLine) -> Double {
        (lines[w.id] ?? []).reduce(0) { $0 + rates.toBase(value($1.text) ?? 0, $1.currency) }
    }

    private func binding(_ w: WalletLine, index: Int) -> Binding<String> {
        Binding(get: { lines[w.id]?[safe: index]?.text ?? "" },
                set: { new in if lines[w.id]?.indices.contains(index) == true { lines[w.id]![index].text = new } })
    }

    private func setCurrency(_ w: WalletLine, index: Int, to c: String) {
        guard lines[w.id]?.indices.contains(index) == true else { return }
        let old = lines[w.id]![index]
        let asBase = rates.toBase(value(old.text) ?? 0, old.currency)
        lines[w.id]![index] = Line(currency: c, text: format(asBase / max(rates.rate(for: c), 0.000001)))
        if index == 0 { UserDefaults.standard.set(c, forKey: "count.currency.\(w.id)") }
    }

    private func addLine(_ w: WalletLine) {
        let used = Set((lines[w.id] ?? []).map(\.currency))
        let next = ["EUR", "USD", "PHP", "CNY", "MAD"].first { !used.contains($0) } ?? "USD"
        let l = Line(currency: next, text: "")
        withAnimation(Flow.spatial) { lines[w.id, default: []].append(l) }
        focus = l.id
    }

    private func focusIn(_ w: WalletLine) -> Bool { focus.map { f in lines[w.id]?.contains { $0.id == f } ?? false } ?? false }
    private func needsConversionNote(_ w: WalletLine) -> Bool { (lines[w.id] ?? []).contains { $0.currency != base } }
    private func conversionNote(_ w: WalletLine) -> String {
        let foreign = (lines[w.id] ?? []).map(\.currency).filter { $0 != base }
        guard let c = foreign.first else { return "" }
        return "Counted as pesos at \(MoneyFormat.string(rates.rate(for: c))) to the \(currencyWord(c))"
    }
    private func currencyWord(_ c: String) -> String {
        ["EUR": "euro", "USD": "dollar", "CNY": "yuan", "MAD": "dirham", "GBP": "pound", "JPY": "yen", "AED": "dirham", "SGD": "dollar", "AUD": "dollar"][c] ?? c
    }

    // MARK: Save

    private func save() {
        for w in wallets { for l in lines[w.id] ?? [] where value(l.text) == nil { error = "“\(l.text)” for \(w.name) isn’t a number."; return } }
        let engine = MoneyEngine(context: context)
        for w in wallets {
            let actual = counted(w)
            let gap = actual - w.balance
            if gap <= -1, case .category(let cat) = labels[w.id] ?? .unlogged {
                _ = try? engine.createSpend(walletId: w.id, amount: (-gap * 100).rounded() / 100, currency: base, description: "Found by counting",
                                            vendorName: nil, category: cat, isSadaka: false, spentAt: .now)
            } else if abs(gap) >= 0.01 {
                engine.reconcileWallet(w.id, actualBase: actual)
            }
            // Record that it was counted, even when nothing changed.
            engine.insertLedger(kind: .adjustment, amountBase: 0, walletId: w.id, relatedKind: nil, relatedId: nil, eventAt: .now, note: "count")
        }
        try? context.save()
        close()
    }

    private func close() { withAnimation(Flow.spatial) { app.counting = false } }
}

/// Wrapping choice chips for the gap labels.
private struct GapChips<Item: Equatable>: View {
    let items: [Item]
    let selected: Item
    let title: (Item) -> String
    let pick: (Item) -> Void
    var body: some View {
        HStack(spacing: 6) {
            ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                let on = item == selected
                Button { withAnimation(Flow.fast) { pick(item) } } label: {
                    Text(title(item)).font(FS.font(13, 600, rond: 60))
                        .foregroundStyle(on ? MD.onTertiary : MD.onSurface)
                        .padding(.horizontal, 12).frame(height: 32)
                        .background(RoundedRectangle(cornerRadius: 8).fill(on ? MD.tertiary : Surface.dialog))
                        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(on ? .clear : MD.outlineVariant, lineWidth: 1))
                }
                .buttonStyle(.plain)
            }
        }
    }
}

extension Array {
    subscript(safe i: Int) -> Element? { indices.contains(i) ? self[i] : nil }
}

import SwiftUI
import SwiftData

// The New menu's forms. Each one is the shortest honest path: the amount first, sensible defaults,
// Return saves, Escape closes. They call the same engine the rest of the app uses.

/// Which form is open, with an optional prefill.
enum FormKind: Identifiable, Equatable {
    case spending, gift, moneyIn(projectId: UUID?), move, payBill(billId: UUID?), addWallet
    var id: String {
        switch self {
        case .spending: return "spending"; case .gift: return "gift"; case .moneyIn: return "moneyIn"; case .move: return "move"
        case .payBill: return "payBill"; case .addWallet: return "addWallet"
        }
    }
}

struct FormHost: View {
    let kind: FormKind
    let state: MoneyState
    let close: () -> Void
    var body: some View {
        switch kind {
        case .spending: SpendingForm(state: state, close: close)
        case .gift: SpendingForm(state: state, close: close, startAsGift: true)
        case .moneyIn(let p): MoneyInForm(state: state, projectId: p, close: close)
        case .move: MoveForm(state: state, close: close)
        case .payBill(let b): PayBillForm(state: state, billId: b, close: close)
        case .addWallet: AddWalletForm(close: close)
        }
    }
}

// MARK: - Spending

private struct SpendingForm: View {
    @Environment(\.modelContext) private var context
    let state: MoneyState
    let close: () -> Void
    var startAsGift = false
    @Query(sort: \Spend.spentAt, order: .reverse) private var spends: [Spend]
    @State private var amount = ""
    @State private var currency = "PHP"
    @State private var what = ""
    @State private var category: String?
    @State private var wallet: UUID?
    @State private var date = Date.now
    @State private var gift = false
    @State private var error: String?
    @FocusState private var focus: String?

    private var categories: [String] {
        var count: [String: Int] = [:]
        for s in spends.prefix(400) where s.deletedAt == nil && s.recurringId == nil {
            if let c = s.category, !c.isEmpty { count[c, default: 0] += 1 }
        }
        return count.sorted { $0.value > $1.value }.prefix(8).map(\.key)
    }

    var body: some View {
        M3Dialog(title: startAsGift ? "A gift" : "Spending", subtitle: startAsGift ? "Sadaka, or anything you gave. It counts as spending and shows on Giving." : nil, onClose: close) {
            OutlinedField(label: "Amount", text: $amount, prompt: "0.00", numeric: true, focused: $focus, id: "amount",
                          leading: AnyView(CurrencyChip(currency: $currency)))
            OutlinedField(label: "What was it?", text: $what, prompt: "Groceries, Grab, a gift…", focused: $focus, id: "what")
            VStack(alignment: .leading, spacing: 8) {
                FieldLabel(text: "Category")
                ChoiceChips(items: categories, selection: $category, title: { $0 })
            }
            VStack(alignment: .leading, spacing: 8) {
                FieldLabel(text: "Paid from")
                ChoiceChips(items: state.wallets.filter(\.inTotals).map(\.id), selection: $wallet,
                            title: { id in state.wallets.first { $0.id == id }?.name ?? "" },
                            badge: { id in state.wallets.first { $0.id == id }.map { .wallet($0.wallet) } })
            }
            HStack(alignment: .center) {
                DayChoice(date: $date)
                Spacer()
                Toggle(isOn: $gift) { Text("A gift").role(.label) }.toggleStyle(.switch).controlSize(.small)
            }
            if let error { Text(error).role(.supporting, MD.error) }
        } actions: {
            M3Button(title: "Cancel", kind: .plain, action: close)
            M3Button(title: "Save", kind: .filled, action: save).keyboardShortcut(.return, modifiers: [])
        }
        .onAppear {
            focus = "amount"
            gift = startAsGift
            wallet = spends.first(where: { $0.deletedAt == nil && $0.walletId != nil })?.walletId ?? state.wallets.first?.id
        }
    }

    private func save() {
        guard let v = Parse.amount(amount), v > 0 else { error = "Type an amount."; focus = "amount"; return }
        guard let wallet else { error = "Choose the wallet it came from."; return }
        do {
            _ = try MoneyEngine(context: context).createSpend(walletId: wallet, amount: v, currency: currency,
                                                             description: what.isEmpty ? nil : what, vendorName: nil,
                                                             category: category, isSadaka: gift, spentAt: date)
            try? context.save()
            close()
        } catch { self.error = error.localizedDescription }
    }
}

// MARK: - Money in

private struct MoneyInForm: View {
    @Environment(\.modelContext) private var context
    let state: MoneyState
    let projectId: UUID?
    let close: () -> Void
    @Query private var clients: [Client]
    @Query private var projects: [Project]
    @Query private var payments: [Payment]
    @Query private var rateRows: [ExchangeRate]
    @State private var client: UUID?
    @State private var project: UUID?
    @State private var newProject = ""
    @State private var paid = ""
    @State private var currency = "EUR"
    @State private var received = ""
    @State private var receivedTouched = false
    @State private var wallet: UUID?
    @State private var date = Date.now
    @State private var error: String?
    @FocusState private var focus: String?

    private var rates: Rates { Rates(base: "PHP", rates: rateRows) }
    private var activeClients: [Client] {
        let last = Dictionary(grouping: payments.filter { $0.deletedAt == nil }) { p in projects.first { $0.id == p.projectId }?.clientId }
        return clients.filter { $0.deletedAt == nil && !$0.archived }
            .sorted { (last[$0.id]?.map(\.paidAt).max() ?? .distantPast) > (last[$1.id]?.map(\.paidAt).max() ?? .distantPast) }
    }
    private var openProjects: [Project] {
        projects.filter { $0.deletedAt == nil && $0.clientId == client && ($0.status == .unpaid || $0.status == .partiallyPaid) }
    }

    var body: some View {
        M3Dialog(title: "Money in", subtitle: "A client paid you. Say what they sent and what reached your wallet; the difference is the fee.", onClose: close) {
            VStack(alignment: .leading, spacing: 8) {
                FieldLabel(text: "From")
                ChoiceChips(items: activeClients.prefix(6).map(\.id), selection: $client,
                            title: { id in clientTitle(id) },
                            badge: { id in .person(clientTitle(id)) })
            }
            if client != nil {
                VStack(alignment: .leading, spacing: 8) {
                    FieldLabel(text: "For")
                    if !openProjects.isEmpty {
                        ChoiceChips(items: openProjects.map(\.id), selection: $project, title: { id in projects.first { $0.id == id }?.title ?? "" })
                    }
                    OutlinedField(label: openProjects.isEmpty ? "What was the work?" : "Or something new", text: $newProject, prompt: "Project name",
                                  focused: $focus, id: "project")
                }
                .transition(.opacity)
            }
            HStack(spacing: 12) {
                OutlinedField(label: "They sent", text: $paid, prompt: "0.00", numeric: true, focused: $focus, id: "paid",
                              leading: AnyView(CurrencyChip(currency: $currency)))
                OutlinedField(label: "Reached your wallet (₱)", text: $received, prompt: suggestedReceived, numeric: true, focused: $focus, id: "received")
            }
            VStack(alignment: .leading, spacing: 8) {
                FieldLabel(text: "Landed in")
                ChoiceChips(items: state.wallets.filter(\.inTotals).map(\.id), selection: $wallet,
                            title: { id in state.wallets.first { $0.id == id }?.name ?? "" },
                            badge: { id in state.wallets.first { $0.id == id }.map { .wallet($0.wallet) } })
            }
            HStack { DayChoice(date: $date); Spacer(); feeLine }
            if let error { Text(error).role(.supporting, MD.error) }
        } actions: {
            M3Button(title: "Cancel", kind: .plain, action: close)
            M3Button(title: "Save", kind: .filled, action: save).keyboardShortcut(.return, modifiers: [])
        }
        .animation(Flow.spatial, value: client)
        .onAppear(perform: prefill)
        .onChange(of: project) { _, p in if let p, let pr = projects.first(where: { $0.id == p }) { currency = pr.currency; if paid.isEmpty { paid = MoneyFormat.parts(pr.amount).whole.replacingOccurrences(of: ",", with: "") } } }
    }

    private func clientTitle(_ id: UUID) -> String {
        let c = clients.first { $0.id == id }
        return c.map(ClientName.display) ?? ""
    }

    private var suggestedReceived: String {
        guard let v = Parse.amount(paid) else { return "0.00" }
        return String(format: "%.2f", rates.toBase(v, currency))
    }

    @ViewBuilder private var feeLine: some View {
        if let p = Parse.amount(paid), let r = Parse.amount(received.isEmpty ? suggestedReceived : received) {
            let fee = rates.toBase(p, currency) - r
            if fee > 0.004 { Text("Fee about \(MoneyFormat.string(fee))").role(.supporting, MD.onSurfaceVariant) }
        }
    }

    private func prefill() {
        wallet = state.wallets.first { $0.key == .wise }?.id ?? state.wallets.first?.id
        if let projectId, let p = projects.first(where: { $0.id == projectId }) {
            client = p.clientId; project = p.id; currency = p.currency
            paid = String(format: p.amount == p.amount.rounded() ? "%.0f" : "%.2f", p.amount)
        } else if let c = activeClients.first {
            client = c.id; currency = c.defaultCurrency ?? "EUR"
        }
        focus = "paid"
    }

    private func save() {
        guard let amount = Parse.amount(paid), amount > 0 else { error = "Type what they sent."; focus = "paid"; return }
        guard let wallet else { error = "Choose the wallet it landed in."; return }
        let net = Parse.amount(received) ?? rates.toBase(amount, currency)
        var projectId = project
        if !newProject.trimmingCharacters(in: .whitespaces).isEmpty {
            let p = Project(clientId: client, title: newProject.trimmingCharacters(in: .whitespaces), amount: amount, currency: currency)
            p.workCompletedAt = date; p.dirty = true
            context.insert(p); projectId = p.id
        }
        let step = ChainStepInput(fromMethodId: nil, methodId: wallet, amountIn: amount, currencyIn: currency, amountOut: net, currencyOut: "PHP", notes: nil)
        do {
            _ = try MoneyEngine(context: context).addPayment(PaymentChainInput(projectId: projectId, projects: nil, paidAt: date, steps: [step], reference: nil, notes: nil))
            try? context.save()
            close()
        } catch { self.error = error.localizedDescription }
    }
}

// MARK: - Move money

private struct MoveForm: View {
    @Environment(\.modelContext) private var context
    let state: MoneyState
    let close: () -> Void
    @State private var from: UUID?
    @State private var to: UUID?
    @State private var sent = ""
    @State private var received = ""
    @State private var date = Date.now
    @State private var error: String?
    @FocusState private var focus: String?

    var body: some View {
        let wallets = state.wallets.filter(\.inTotals)
        M3Dialog(title: "Move money", subtitle: "Between your own wallets. What arrives can be less than what left; the difference is the fee.", onClose: close) {
            VStack(alignment: .leading, spacing: 8) {
                FieldLabel(text: "From")
                ChoiceChips(items: wallets.map(\.id), selection: $from, title: { id in wallets.first { $0.id == id }?.name ?? "" },
                            badge: { id in wallets.first { $0.id == id }.map { .wallet($0.wallet) } })
            }
            VStack(alignment: .leading, spacing: 8) {
                FieldLabel(text: "To")
                ChoiceChips(items: wallets.filter { $0.id != from }.map(\.id), selection: $to, title: { id in wallets.first { $0.id == id }?.name ?? "" },
                            badge: { id in wallets.first { $0.id == id }.map { .wallet($0.wallet) } })
            }
            HStack(spacing: 12) {
                OutlinedField(label: "Left (₱)", text: $sent, prompt: "0.00", numeric: true, focused: $focus, id: "sent")
                OutlinedField(label: "Arrived (₱)", text: $received, prompt: sent.isEmpty ? "0.00" : sent, numeric: true, focused: $focus, id: "received")
            }
            HStack {
                DayChoice(date: $date)
                Spacer()
                if let s = Parse.amount(sent), let r = Parse.amount(received), s - r > 0.004 {
                    Text("Fee \(MoneyFormat.string(s - r))").role(.supporting, MD.onSurfaceVariant)
                }
            }
            if let error { Text(error).role(.supporting, MD.error) }
        } actions: {
            M3Button(title: "Cancel", kind: .plain, action: close)
            M3Button(title: "Save", kind: .filled, action: save).keyboardShortcut(.return, modifiers: [])
        }
        .onAppear {
            from = wallets.first { $0.key == .wise }?.id ?? wallets.first?.id
            to = wallets.first { $0.key == .maya && $0.id != from }?.id
            focus = "sent"
        }
    }

    private func save() {
        guard let s = Parse.amount(sent), s > 0 else { error = "Type what left the wallet."; focus = "sent"; return }
        guard let from, let to, from != to else { error = "Choose two different wallets."; return }
        let r = Parse.amount(received) ?? s
        do {
            _ = try MoneyEngine(context: context).createWithdrawal(fromMethodId: from, toMethodId: to, withdrawnAt: date, grossBase: s, netBase: r, notes: nil)
            try? context.save()
            close()
        } catch { self.error = error.localizedDescription }
    }
}

// MARK: - Pay a bill

private struct PayBillForm: View {
    @Environment(\.modelContext) private var context
    let state: MoneyState
    let billId: UUID?
    let close: () -> Void
    @State private var bill: UUID?
    @State private var amount = ""
    @State private var wallet: UUID?
    @State private var periods = 1
    @State private var date = Date.now
    @State private var error: String?
    @FocusState private var focus: String?

    var body: some View {
        let bills = state.bills
        M3Dialog(title: "Pay a bill", onClose: close) {
            VStack(alignment: .leading, spacing: 8) {
                FieldLabel(text: "Bill")
                ChoiceChips(items: bills.map(\.id), selection: $bill, title: { id in bills.first { $0.id == id }?.label ?? "" },
                            badge: { id in bills.first { $0.id == id }.map { .bill($0.label) } })
            }
            OutlinedField(label: periods > 1 ? "Amount per month (₱)" : "Amount (₱)", text: $amount, prompt: "0.00", numeric: true, focused: $focus, id: "amount")
            VStack(alignment: .leading, spacing: 8) {
                FieldLabel(text: "Paid from")
                ChoiceChips(items: state.wallets.filter(\.inTotals).map(\.id), selection: $wallet,
                            title: { id in state.wallets.first { $0.id == id }?.name ?? "" },
                            badge: { id in state.wallets.first { $0.id == id }.map { .wallet($0.wallet) } })
            }
            HStack {
                DayChoice(date: $date)
                Spacer()
                Stepper(value: $periods, in: 1...24) {
                    Text(periods == 1 ? "1 month" : "\(periods) months").role(.label)
                }
            }
            if let error { Text(error).role(.supporting, MD.error) }
        } actions: {
            M3Button(title: "Cancel", kind: .plain, action: close)
            M3Button(title: "Mark paid", kind: .filled, action: save).keyboardShortcut(.return, modifiers: [])
        }
        .onAppear {
            bill = billId ?? state.nextBill?.id ?? bills.first?.id
            prefillAmount()
            focus = "amount"
        }
        .onChange(of: bill) { _, _ in prefillAmount() }
    }

    private func prefillAmount() {
        guard let b = state.bills.first(where: { $0.id == bill }) else { return }
        amount = String(format: "%.2f", b.lastPaid?.amount ?? b.amount)
        wallet = b.lastPaid?.walletId ?? b.bill.walletId ?? wallet ?? state.wallets.first?.id
    }

    private func save() {
        guard let b = bill else { error = "Choose a bill."; return }
        guard let v = Parse.amount(amount), v > 0 else { error = "Type the amount."; focus = "amount"; return }
        do {
            _ = try MoneyEngine(context: context).markRecurringPaid(recurringId: b, amount: v, periods: periods, walletId: wallet, on: date)
            try? context.save()
            close()
        } catch { self.error = error.localizedDescription }
    }
}

// MARK: - Add a wallet

private struct AddWalletForm: View {
    @Environment(\.modelContext) private var context
    let close: () -> Void
    @State private var name = ""
    @State private var kind: WalletKind? = .wallet
    @State private var currency = "PHP"
    @State private var balance = ""
    @State private var error: String?
    @FocusState private var focus: String?

    var body: some View {
        M3Dialog(title: "Add a wallet", onClose: close) {
            OutlinedField(label: "Name", text: $name, prompt: "ShopeePay, BPI, a savings jar…", focused: $focus, id: "name")
            VStack(alignment: .leading, spacing: 8) {
                FieldLabel(text: "Kind")
                ChoiceChips(items: [WalletKind.wallet, .cash, .bank, .exchange], selection: $kind,
                            title: { $0 == .wallet ? "E-wallet" : $0 == .cash ? "Cash" : $0 == .bank ? "Bank" : "Exchange" })
            }
            OutlinedField(label: "What’s in it now?", text: $balance, prompt: "0.00", numeric: true, focused: $focus, id: "balance",
                          leading: AnyView(CurrencyChip(currency: $currency)))
            if let error { Text(error).role(.supporting, MD.error) }
        } actions: {
            M3Button(title: "Cancel", kind: .plain, action: close)
            M3Button(title: "Add", kind: .filled, action: save).keyboardShortcut(.return, modifiers: [])
        }
        .onAppear { focus = "name" }
    }

    private func save() {
        let n = name.trimmingCharacters(in: .whitespaces)
        guard !n.isEmpty else { error = "Give it a name."; focus = "name"; return }
        let w = Wallet(name: n, kind: kind ?? .wallet, isHolding: true)
        w.currencyIn = currency; w.currencyOut = currency
        let amount = Parse.amount(balance) ?? 0
        let rates = Rates(base: "PHP", rates: (try? context.fetch(FetchDescriptor<ExchangeRate>())) ?? [])
        w.openingBalanceAmount = amount; w.openingBalanceCurrency = currency
        w.openingBalanceBase = rates.toBase(amount, currency)
        w.openingBalanceAt = .now; w.openingBalanceSetAt = .now
        w.dirty = true
        context.insert(w)
        try? context.save()
        close()
    }
}

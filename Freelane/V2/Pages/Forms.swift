import SwiftUI
import SwiftData

// The New menu's forms. Each one is the shortest honest path: the amount first, sensible defaults,
// Return saves, Escape closes. They call the same engine the rest of the app uses.

/// Which form is open, with an optional prefill or the record it edits.
enum FormKind: Identifiable, Equatable {
    case spending, gift, editSpend(UUID), moneyIn(projectId: UUID?), editPayment(UUID), move, editMove(UUID), payBill(billId: UUID?)
    case addWallet, editWallet(UUID)
    /// A project or client to add (nil) or change.
    case project(UUID?), client(UUID?)
    var id: String {
        switch self {
        case .spending: return "spending"; case .gift: return "gift"; case .editSpend(let id): return "edit-\(id)"
        case .moneyIn: return "moneyIn"; case .editPayment(let id): return "payment-\(id)"
        case .move: return "move"; case .editMove(let id): return "move-\(id)"
        case .payBill: return "payBill"; case .addWallet: return "addWallet"; case .editWallet(let id): return "wallet-\(id)"
        case .project(let id): return "project-\(id?.uuidString ?? "new")"
        case .client(let id): return "client-\(id?.uuidString ?? "new")"
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
        case .editSpend(let id): SpendingForm(state: state, close: close, editing: id)
        case .moneyIn(let p): MoneyInForm(state: state, projectId: p, close: close)
        case .editPayment(let id): MoneyInForm(state: state, projectId: nil, editing: id, close: close)
        case .move: MoveForm(state: state, close: close)
        case .editMove(let id): MoveForm(state: state, editing: id, close: close)
        case .payBill(let b): PayBillForm(state: state, billId: b, close: close)
        case .addWallet: WalletForm(editing: nil, close: close)
        case .editWallet(let id): WalletForm(editing: id, close: close)
        case .project(let id): ProjectForm(editing: id, close: close)
        case .client(let id): ClientForm(editing: id, close: close)
        }
    }
}

// MARK: - Spending

private struct SpendingForm: View {
    @Environment(\.modelContext) private var context
    @Environment(UndoCenter.self) private var undo
    let state: MoneyState
    let close: () -> Void
    var startAsGift = false
    /// Editing an existing spend instead of logging a new one.
    var editing: UUID? = nil
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

    private var existing: Spend? { editing.flatMap { id in spends.first { $0.id == id } } }
    /// A bill's payment edits like any spending, less what only spending has (a category, being a gift).
    private var bill: Bool { existing?.recurringId != nil }

    private var categories: [String] {
        var count: [String: Int] = [:]
        for s in spends.prefix(400) where s.deletedAt == nil && s.recurringId == nil {
            if let c = s.category, !c.isEmpty { count[c, default: 0] += 1 }
        }
        return count.sorted { $0.value > $1.value }.prefix(8).map(\.key)
    }

    var body: some View {
        M3Dialog(title: bill ? "Edit bill payment" : existing?.isSadaka == true ? "Edit gift" : editing != nil ? "Edit spending" : startAsGift ? "A gift" : "Spending",
                 subtitle: startAsGift ? "Sadaka, or anything you gave. It counts as spending and shows on Giving." : nil, onClose: close) {
            OutlinedField(label: "Amount", text: $amount, prompt: "0.00", numeric: true, focused: $focus, id: "amount",
                          leading: AnyView(CurrencyChip(currency: $currency)))
            OutlinedField(label: "What was it?", text: $what, prompt: "Groceries, Grab, a gift…", focused: $focus, id: "what")
            if !bill {
                VStack(alignment: .leading, spacing: 8) {
                    FieldLabel(text: "Category")
                    ChoiceChips(items: categories, selection: $category, title: { $0 })
                }
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
                if !bill { Toggle(isOn: $gift) { Text("A gift").role(.label) }.toggleStyle(.switch).controlSize(.small) }
            }
            if let error { Text(error).role(.supporting, MD.error) }
            if let s = existing {
                FormDeleteRow(title: bill ? "Delete this payment" : s.isSadaka ? "Delete this gift" : "Delete this spending") {
                    let id = s.id, ctx = context
                    let what = bill ? "bill payment" : s.isSadaka ? "gift" : "spend"
                    do {
                        try MoneyEngine(context: ctx).deleteSpend(id)
                        undo.offer(what) { try? MoneyEngine(context: ctx).restoreSpend(id) }
                        WidgetBridge.update(ctx)
                        close()
                    } catch { self.error = error.localizedDescription }
                }
            }
        } actions: {
            M3Button(title: "Cancel", kind: .plain, action: close)
            M3Button(title: "Save", kind: .filled, action: save).keyboardShortcut(.return, modifiers: [])
        }
        .onAppear {
            focus = "amount"
            gift = startAsGift
            wallet = spends.first(where: { $0.deletedAt == nil && $0.walletId != nil })?.walletId ?? state.wallets.first?.id
            if let id = editing, let s = spends.first(where: { $0.id == id }) {
                amount = String(format: s.amount == s.amount.rounded() ? "%.0f" : "%.2f", s.amount)
                currency = s.currency
                what = s.spendDescription ?? s.vendorName ?? ""
                category = s.category
                wallet = s.walletId
                date = s.spentAt
                gift = s.isSadaka
            }
        }
    }

    private func save() {
        guard let v = Parse.amount(amount), v > 0 else { error = "Type an amount."; focus = "amount"; return }
        guard let wallet else { error = "Choose the wallet it came from."; return }
        let ctx = context
        let from = state.wallets.first { $0.id == wallet }?.name ?? "your wallet"
        let shown = CurrencyFormat.string(v, currency, compact: true)
        do {
            if let id = editing, let s = spends.first(where: { $0.id == id }) {
                // Keep what the form doesn't show (vendor, tags) and remember the old values for Undo.
                let old = (s.walletId, s.amount, s.currency, s.spendDescription, s.vendorName, s.category, s.isSadaka, s.spentAt, s.tags)
                var tags = s.tags
                if let oldCat = s.category, let i = tags.firstIndex(of: oldCat) { tags.remove(at: i) }
                if let category, !tags.contains(category) { tags.insert(category, at: 0) }
                try MoneyEngine(context: ctx).updateSpend(id, walletId: wallet, amount: v, currency: currency,
                                                          description: what.isEmpty ? nil : what, vendorName: s.vendorName,
                                                          category: category, isSadaka: gift, spentAt: date, tags: tags,
                                                          isBusiness: s.isBusiness, isHouse: s.isHouse)
                try? ctx.save()
                undo.announce("Saved \(shown) from \(from)") {
                    try? MoneyEngine(context: ctx).updateSpend(id, walletId: old.0, amount: old.1, currency: old.2, description: old.3,
                                                               vendorName: old.4, category: old.5, isSadaka: old.6, spentAt: old.7, tags: old.8)
                    try? ctx.save()
                }
            } else {
                let id = try MoneyEngine(context: ctx).createSpend(walletId: wallet, amount: v, currency: currency,
                                                                  description: what.isEmpty ? nil : what, vendorName: nil,
                                                                  category: category, isSadaka: gift, spentAt: date)
                try? ctx.save()
                undo.announce((gift ? "Gave " : "Spent ") + "\(shown) from \(from)") { try? MoneyEngine(context: ctx).deleteSpend(id) }
            }
            WidgetBridge.update(ctx)
            close()
        } catch { self.error = error.localizedDescription }
    }
}

// MARK: - Money in

private struct MoneyInForm: View {
    @Environment(\.modelContext) private var context
    @Environment(UndoCenter.self) private var undo
    let state: MoneyState
    let projectId: UUID?
    /// Editing a payment instead of recording a new one.
    var editing: UUID? = nil
    let close: () -> Void
    @Query private var clients: [Client]
    @Query private var projects: [Project]
    @Query private var payments: [Payment]
    @Query private var withdrawals: [Withdrawal]
    @Query private var stepRows: [PaymentStep]
    @Query private var walletRows: [Wallet]
    @Query private var rateRows: [ExchangeRate]
    @State private var client: UUID?
    @State private var project: UUID?
    @State private var newProject = ""
    // What they sent, the fee on the way and what reached the wallet, each in its own currency: any two settle
    // the third.
    @State private var paid = ""
    @State private var currency = "EUR"
    @State private var fee = ""
    @State private var feeCur = "EUR"
    @State private var received = ""
    @State private var receivedCur = "PHP"
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
    private var existing: Payment? { editing.flatMap { id in payments.first { $0.id == id } } }
    private var openProjects: [Project] {
        let current = existing?.projectId
        return projects.filter { $0.deletedAt == nil && $0.clientId == client && ($0.status == .unpaid || $0.status == .partiallyPaid || $0.id == current) }
    }

    var body: some View {
        let figures = outcome.figures
        let lostInFee = figures.map { rates.hasRate(for: feeCur) ? $0.lostBase / max(rates.toBase(1, feeCur), 0.000001) : $0.lostBase }
        M3Dialog(title: existing != nil ? "Edit money in" : "Money in",
                 subtitle: existing != nil ? nil : "A client paid you. Type any two of what they sent, the fee and what reached your wallet, each in its own currency; Freelane works out the third.",
                 onClose: close) {
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
                OutlinedField(label: "They sent", text: $paid, prompt: paid.isEmpty ? hint(figures?.sent.amount) : "0.00", numeric: true, focused: $focus, id: "paid",
                              leading: AnyView(CurrencyChip(currency: $currency)))
                OutlinedField(label: "Fee", text: $fee, prompt: fee.isEmpty && !paid.isEmpty && !received.isEmpty ? hint(lostInFee) : "0.00", numeric: true,
                              focused: $focus, id: "fee", leading: AnyView(CurrencyChip(currency: $feeCur)))
                OutlinedField(label: "Reached your wallet", text: $received, prompt: received.isEmpty ? hint(figures?.arrived.amount) : "0.00", numeric: true,
                              focused: $focus, id: "received", leading: AnyView(CurrencyChip(currency: $receivedCur)))
            }
            VStack(alignment: .leading, spacing: 8) {
                FieldLabel(text: "Landed in")
                ChoiceChips(items: state.wallets.filter(\.inTotals).map(\.id), selection: $wallet,
                            title: { id in state.wallets.first { $0.id == id }?.name ?? "" },
                            badge: { id in state.wallets.first { $0.id == id }.map { .wallet($0.wallet) } })
            }
            if let figures, let line = MoveMath.feeLine(figures, feeCurrency: feeCur, rates: rates) {
                Text(line).role(.label, MD.onSurface).fixedSize(horizontal: false, vertical: true)
            }
            DayChoice(date: $date)
            if let error { Text(error).role(.supporting, MD.error) }
            if let p = existing {
                FormDeleteRow(title: "Delete this payment") {
                    let id = p.id, ctx = context
                    do {
                        try MoneyEngine(context: ctx).deletePayment(id)
                        try? ctx.save()
                        undo.offer("payment") { try? MoneyEngine(context: ctx).restorePayment(id); try? ctx.save() }
                        WidgetBridge.update(ctx)
                        close()
                    } catch { self.error = error.localizedDescription }
                }
            }
        } actions: {
            M3Button(title: "Cancel", kind: .plain, action: close)
            M3Button(title: "Save", kind: .filled, action: save).keyboardShortcut(.return, modifiers: [])
        }
        .animation(Flow.spatial, value: client)
        .onAppear(perform: prefill)
        .onChange(of: project) { _, p in if let p, let pr = projects.first(where: { $0.id == p }) { currency = pr.currency; if paid.isEmpty { paid = MoneyFormat.parts(pr.amount).whole.replacingOccurrences(of: ",", with: "") } } }
        .onChange(of: currency) { _, c in if fee.isEmpty { feeCur = c } }
        .onChange(of: wallet) { _, id in
            if received.isEmpty { receivedCur = MoveMath.arrivesIn(id, withdrawals: withdrawals, payments: payments, steps: stepRows, wallets: walletRows) }
        }
    }

    private func clientTitle(_ id: UUID) -> String {
        let c = clients.first { $0.id == id }
        return c.map(ClientName.display) ?? ""
    }

    private func typed(_ s: String, _ c: String) -> NativeAmount? { Parse.amount(s).map { NativeAmount(amount: $0, currency: c) } }
    private var outcome: MoveOutcome {
        MoveMath.resolve(left: typed(paid, currency), fee: typed(fee, feeCur), arrived: typed(received, receivedCur),
                         leftCurrency: currency, arrivedCurrency: receivedCur, rates: rates)
    }
    private func hint(_ v: Double?) -> String { v.map { String(format: "%.2f", $0) } ?? "0.00" }

    private func prefill() {
        wallet = state.wallets.first { $0.key == .wise }?.id ?? state.wallets.first?.id
        // Editing starts from what the payment says, landing wallet included.
        if let pay = existing {
            let pr = pay.projectId.flatMap { id in projects.first { $0.id == id } }
            client = pr?.clientId; project = pr?.id
            currency = pay.currency
            paid = String(format: pay.amount == pay.amount.rounded() ? "%.0f" : "%.2f", pay.amount)
            // What arrived as the last step kept it (in the wallet's own currency), else in pesos.
            let last = MoneyEngine(context: context).steps(paymentId: pay.id).last
            if let last, last.amountOut > 0 { received = BillsWorkAmount.edit(last.amountOut); receivedCur = last.currencyOut }
            else if let net = pay.netAmountBase { received = String(format: "%.2f", net); receivedCur = "PHP" }
            if let f = pay.feeAmount { fee = BillsWorkAmount.edit(f) }
            feeCur = pay.feeCurrency ?? pay.currency
            wallet = last?.methodId ?? wallet
            date = pay.paidAt
            focus = "paid"
            return
        }
        if let projectId, let p = projects.first(where: { $0.id == projectId }) {
            client = p.clientId; project = p.id; currency = p.currency
            paid = String(format: p.amount == p.amount.rounded() ? "%.0f" : "%.2f", p.amount)
        } else if let c = activeClients.first {
            client = c.id; currency = c.defaultCurrency ?? "EUR"
        }
        feeCur = currency
        receivedCur = MoveMath.arrivesIn(wallet, withdrawals: withdrawals, payments: payments, steps: stepRows, wallets: walletRows)
        focus = "paid"
    }

    private func save() {
        guard let wallet else { error = "Choose the wallet it landed in."; return }
        let got: MoveFigures
        switch outcome {
        case .problem(let m): error = paid.isEmpty && received.isEmpty ? "Type what they sent." : m; focus = "paid"; return
        case .ok(let f): got = f
        }
        let amount = got.sent.amount, sentIn = got.sent.currency
        let net = got.netBase
        var projectId = project
        if !newProject.trimmingCharacters(in: .whitespaces).isEmpty {
            let p = Project(clientId: client, title: newProject.trimmingCharacters(in: .whitespaces), amount: amount, currency: sentIn)
            p.workCompletedAt = date; p.dirty = true
            context.insert(p); projectId = p.id
        }
        // The pesos decide the balances; what arrived in its own currency and the typed fee are kept beside them.
        let step = ChainStepInput(fromMethodId: nil, methodId: wallet, amountIn: amount, currencyIn: sentIn, amountOut: net, currencyOut: "PHP", notes: nil)
        let ctx = context
        let into = state.wallets.first { $0.id == wallet }?.name ?? "your wallet"
        if let pay = existing {
            do {
                try MoneyEngine(context: ctx).updatePayment(pay.id, projectId: projectId, amountIn: amount, currencyIn: sentIn, netBase: net, walletId: wallet, paidAt: date)
                try MoneyEngine(context: ctx).setPaymentAmounts(pay.id, arrived: got.arrived, fee: got.fee)
                undo.notify("Saved \(MoneyFormat.string(net)) into \(into)")
                WidgetBridge.update(ctx)
                close()
            } catch { self.error = error.localizedDescription }
            return
        }
        do {
            let id = try MoneyEngine(context: ctx).addPayment(PaymentChainInput(projectId: projectId, projects: nil, paidAt: date, steps: [step], reference: nil, notes: nil))
            try MoneyEngine(context: ctx).setPaymentAmounts(id, arrived: got.arrived, fee: got.fee)
            try? ctx.save()
            undo.announce("\(MoneyFormat.string(net)) came in to \(into)") { try? MoneyEngine(context: ctx).deletePayment(id); try? ctx.save() }
            WidgetBridge.update(ctx)
            close()
        } catch { self.error = error.localizedDescription }
    }
}

// MARK: - Move money

private struct MoveForm: View {
    @Environment(\.modelContext) private var context
    @Environment(UndoCenter.self) private var undo
    let state: MoneyState
    /// Editing a move instead of recording a new one.
    var editing: UUID? = nil
    let close: () -> Void
    @Query private var withdrawals: [Withdrawal]
    @Query private var payments: [Payment]
    @Query private var steps: [PaymentStep]
    @Query private var walletRows: [Wallet]
    @Query private var rateRows: [ExchangeRate]
    @State private var from: UUID?
    @State private var to: UUID?
    // What left, the fee and what arrived, each in its own currency: any two settle the third.
    @State private var sent = ""
    @State private var sentCur = "PHP"
    @State private var fee = ""
    @State private var feeCur = "PHP"
    @State private var received = ""
    @State private var receivedCur = "PHP"
    @State private var date = Date.now
    @State private var error: String?
    @FocusState private var focus: String?

    private var rates: Rates { Rates(base: "PHP", rates: rateRows) }
    private var existing: Withdrawal? { editing.flatMap { id in withdrawals.first { $0.id == id } } }
    private func typed(_ s: String, _ c: String) -> NativeAmount? { Parse.amount(s).map { NativeAmount(amount: $0, currency: c) } }
    private var outcome: MoveOutcome {
        MoveMath.resolve(left: typed(sent, sentCur), fee: typed(fee, feeCur), arrived: typed(received, receivedCur),
                         leftCurrency: sentCur, arrivedCurrency: receivedCur, rates: rates)
    }
    private func hint(_ v: Double?) -> String { v.map { String(format: "%.2f", $0) } ?? "0.00" }

    var body: some View {
        let wallets = state.wallets.filter(\.inTotals)
        let figures = outcome.figures
        let lostInFee = figures.map { rates.hasRate(for: feeCur) ? $0.lostBase / max(rates.toBase(1, feeCur), 0.000001) : $0.lostBase }
        M3Dialog(title: existing != nil ? "Edit move" : "Move money",
                 subtitle: existing != nil ? nil : "Between your own wallets, in any currency. Type any two of what left, the fee and what arrived; Freelane works out the third.",
                 onClose: close) {
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
                OutlinedField(label: "Left", text: $sent, prompt: sent.isEmpty ? hint(figures?.sent.amount) : "0.00", numeric: true, focused: $focus, id: "sent",
                              leading: AnyView(CurrencyChip(currency: $sentCur)))
                OutlinedField(label: "Fee", text: $fee, prompt: fee.isEmpty && !sent.isEmpty && !received.isEmpty ? hint(lostInFee) : "0.00", numeric: true,
                              focused: $focus, id: "fee", leading: AnyView(CurrencyChip(currency: $feeCur)))
                OutlinedField(label: "Arrived", text: $received, prompt: received.isEmpty ? hint(figures?.arrived.amount) : "0.00", numeric: true,
                              focused: $focus, id: "received", leading: AnyView(CurrencyChip(currency: $receivedCur)))
            }
            // The fee, worked out as you type, on its own line under the amounts.
            if let figures, let line = MoveMath.feeLine(figures, feeCurrency: feeCur, rates: rates) {
                Text(line).role(.label, MD.onSurface).fixedSize(horizontal: false, vertical: true)
            }
            DayChoice(date: $date)
            if let error { Text(error).role(.supporting, MD.error) }
            if let w = existing {
                FormDeleteRow(title: "Delete this move") {
                    let id = w.id, ctx = context
                    do {
                        try MoneyEngine(context: ctx).deleteWithdrawal(id)
                        undo.offer("move") { try? MoneyEngine(context: ctx).restoreWithdrawal(id); try? ctx.save() }
                        WidgetBridge.update(ctx)
                        close()
                    } catch { self.error = error.localizedDescription }
                }
            }
        } actions: {
            M3Button(title: "Cancel", kind: .plain, action: close)
            M3Button(title: "Save", kind: .filled, action: save).keyboardShortcut(.return, modifiers: [])
        }
        .onChange(of: from) { _, id in
            // A wallet's last currency, unless an amount is already typed.
            if sent.isEmpty { sentCur = MoveMath.leavesIn(id, withdrawals: withdrawals, wallets: walletRows); if fee.isEmpty { feeCur = sentCur } }
            error = nil
        }
        .onChange(of: to) { _, id in
            if received.isEmpty { receivedCur = MoveMath.arrivesIn(id, withdrawals: withdrawals, payments: payments, steps: steps, wallets: walletRows) }
            error = nil
        }
        .onChange(of: sentCur) { _, c in if fee.isEmpty { feeCur = c } }
        .onAppear {
            if let w = existing {
                from = w.fromMethodId; to = w.toMethodId; date = w.withdrawnAt
                // A move kept before its own currencies were remembered opens in pesos.
                sent = BillsWorkAmount.edit(w.grossAmount ?? w.grossBase); sentCur = w.grossCurrency ?? "PHP"
                received = BillsWorkAmount.edit(w.netAmount ?? w.netBase); receivedCur = w.netCurrency ?? "PHP"
                if let f = w.feeAmount { fee = BillsWorkAmount.edit(f) }
                feeCur = w.feeCurrency ?? sentCur
            } else {
                from = wallets.first { $0.key == .wise }?.id ?? wallets.first?.id
                to = wallets.first { $0.key == .maya && $0.id != from }?.id
                sentCur = MoveMath.leavesIn(from, withdrawals: withdrawals, wallets: walletRows); feeCur = sentCur
                receivedCur = MoveMath.arrivesIn(to, withdrawals: withdrawals, payments: payments, steps: steps, wallets: walletRows)
            }
            focus = "sent"
        }
    }

    private func save() {
        guard let from, let to, from != to else { error = "Choose two different wallets."; return }
        let got: MoveFigures
        switch outcome {
        case .problem(let m): error = m; return
        case .ok(let f): got = f
        }
        let ctx = context
        let names = state.wallets.reduce(into: [UUID: String]()) { $0[$1.id] = $1.name }
        do {
            let engine = MoneyEngine(context: ctx)
            if let w = existing {
                try engine.updateWithdrawal(w.id, fromMethodId: from, toMethodId: to, withdrawnAt: date, grossBase: got.grossBase, netBase: got.netBase, notes: w.notes)
                try engine.setMoveAmounts(w.id, sent: got.sent, arrived: got.arrived, fee: got.fee)
                undo.notify("Saved the move from \(names[from] ?? "a wallet") to \(names[to] ?? "a wallet")")
            } else {
                let id = try engine.createWithdrawal(fromMethodId: from, toMethodId: to, withdrawnAt: date, grossBase: got.grossBase, netBase: got.netBase, notes: nil)
                try engine.setMoveAmounts(id, sent: got.sent, arrived: got.arrived, fee: got.fee)
                let shown = LedgerText.native(got.sent.amount, got.sent.currency)
                undo.announce("Moved \(shown) from \(names[from] ?? "a wallet") to \(names[to] ?? "a wallet")") {
                    try? MoneyEngine(context: ctx).deleteWithdrawal(id); try? ctx.save()
                }
            }
            WidgetBridge.update(ctx)
            close()
        } catch { self.error = error.localizedDescription }
    }
}

// MARK: - Pay a bill

private struct PayBillForm: View {
    @Environment(\.modelContext) private var context
    @Environment(UndoCenter.self) private var undo
    let state: MoneyState
    let billId: UUID?
    let close: () -> Void
    @State private var bill: UUID?
    @State private var amount = ""
    /// The suggestion is in pesos; paying in another currency is a click on the chip away.
    @State private var currency = "PHP"
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
            OutlinedField(label: periods > 1 ? "Amount per month" : "Amount", text: $amount, prompt: "0.00", numeric: true, focused: $focus, id: "amount",
                          leading: AnyView(CurrencyChip(currency: $currency)))
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
        currency = "PHP"
        wallet = b.lastPaid?.walletId ?? b.bill.walletId ?? wallet ?? state.wallets.first?.id
    }

    private func save() {
        guard let b = bill else { error = "Choose a bill."; return }
        guard let v = Parse.amount(amount), v > 0 else { error = "Type the amount."; focus = "amount"; return }
        let ctx = context
        let label = state.bills.first { $0.id == b }?.label ?? "the bill"
        do {
            let id = try MoneyEngine(context: ctx).markRecurringPaid(recurringId: b, amount: v, periods: periods, walletId: wallet, on: date, currency: currency)
            try? ctx.save()
            undo.announce("Paid \(label), \(LedgerText.native(v, currency))") { try? MoneyEngine(context: ctx).deleteSpend(id) }
            WidgetBridge.update(ctx)
            close()
        } catch { self.error = error.localizedDescription }
    }
}

// MARK: - Wallets

private struct WalletForm: View {
    @Environment(\.modelContext) private var context
    @Environment(UndoCenter.self) private var undo
    /// Editing a wallet instead of adding one.
    let editing: UUID?
    let close: () -> Void
    @Query private var wallets: [Wallet]
    @State private var name = ""
    @State private var kind: WalletKind? = .wallet
    @State private var currency = "PHP"
    @State private var balance = ""
    @State private var inTotals = true
    /// What it holds when it was opened, so saving writes the currency only when it was changed.
    @State private var held: String? = "PHP"
    @State private var holds: String? = "PHP"
    @State private var confirming = false
    @State private var error: String?
    @FocusState private var focus: String?

    private var existing: Wallet? { editing.flatMap { id in wallets.first { $0.id == id } } }
    /// The four kinds the form offers, plus whatever kind an existing wallet already has.
    private var kinds: [WalletKind] {
        let base: [WalletKind] = [.wallet, .cash, .bank, .exchange]
        if let k = existing?.kind, !base.contains(k) { return base + [k] }
        return base
    }
    private func kindTitle(_ k: WalletKind) -> String {
        switch k { case .wallet: return "E-wallet"; case .cash: return "Cash"; case .bank: return "Bank"; case .exchange: return "Exchange"; default: return k.label }
    }

    var body: some View {
        M3Dialog(title: existing != nil ? "Edit wallet" : "Add a wallet", onClose: close) {
            OutlinedField(label: "Name", text: $name, prompt: "ShopeePay, BPI, a savings jar…", focused: $focus, id: "name")
            VStack(alignment: .leading, spacing: 8) {
                FieldLabel(text: "Kind")
                ChoiceChips(items: kinds, selection: $kind, title: kindTitle)
            }
            if existing == nil {
                OutlinedField(label: "What’s in it now?", text: $balance, prompt: "0.00", numeric: true, focused: $focus, id: "balance",
                              leading: AnyView(CurrencyChip(currency: $currency)))
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    FieldLabel(text: "Holds")
                    // What its money is in: moves and counts start in it. Its balance still adds up in pesos.
                    let usual = ["PHP", "USD", "EUR", "GBP", "CNY", "MAD", "AED", "USDT"]
                    ChoiceChips(items: usual.contains(holds ?? "PHP") ? usual : usual + [holds ?? "PHP"], selection: $holds, title: { $0 })
                }
                Toggle(isOn: $inTotals) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("In your totals").role(.row)
                        Text("Off keeps it apart from what you can spend").role(.supporting, MD.onSurfaceVariant)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .toggleStyle(.switch).tint(MD.primary)
            }
            if let error { Text(error).role(.supporting, MD.error) }
            if existing != nil {
                FormDeleteRow(title: "Delete this wallet", note: "Its history stays in the ledger.") { confirming = true }
            }
        } actions: {
            M3Button(title: "Cancel", kind: .plain, action: close)
            M3Button(title: existing != nil ? "Save" : "Add", kind: .filled, action: save).keyboardShortcut(.return, modifiers: [])
        }
        .onAppear {
            if let w = existing {
                name = w.name; kind = w.kind; inTotals = !w.excludedFromTotals; currency = w.currencyIn ?? "PHP"
                // What it holds: the currency money comes into it in, else the one it pays out in.
                held = [w.currencyIn, w.currencyOut].compactMap { $0 }.first { !$0.isEmpty } ?? "PHP"
                holds = held
            }
            focus = "name"
        }
        .confirmationDialog("Delete \(existing?.name ?? "this wallet")?", isPresented: $confirming) {
            Button("Delete", role: .destructive, action: delete)
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("It leaves your totals and your lists. What happened in it stays in the ledger.")
        }
    }

    private func save() {
        let n = name.trimmingCharacters(in: .whitespaces)
        guard !n.isEmpty else { error = "Give it a name."; focus = "name"; return }
        if let w = existing {
            do {
                try MoneyEngine(context: context).updateWallet(w.id, name: n, kind: kind ?? w.kind, inTotals: inTotals, currency: holds != held ? holds : nil)
                undo.notify("Saved \(n)")
                WidgetBridge.update(context)
                close()
            } catch { self.error = error.localizedDescription }
            return
        }
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
        WidgetBridge.update(context)
        close()
    }

    private func delete() {
        guard let w = existing else { return }
        let id = w.id, name = w.name, ctx = context
        do {
            try MoneyEngine(context: ctx).deleteWallet(id)
            undo.announce("Deleted \(name)", icon: "trash") { try? MoneyEngine(context: ctx).restoreWallet(id) }
            WidgetBridge.update(ctx)
            close()
        } catch { self.error = error.localizedDescription }
    }
}

// MARK: - Projects and clients

private struct ProjectForm: View {
    @Environment(\.modelContext) private var context
    @Environment(UndoCenter.self) private var undo
    /// Editing a project instead of adding one.
    let editing: UUID?
    let close: () -> Void
    @Query private var projects: [Project]
    @Query private var clients: [Client]
    @Query private var payments: [Payment]
    @State private var title = ""
    /// The chosen client's id, or "" for no client.
    @State private var client: String? = ""
    @State private var amount = ""
    @State private var currency = "PHP"
    @State private var delivered = false
    @State private var error: String?
    @FocusState private var focus: String?

    private var existing: Project? { editing.flatMap { id in projects.first { $0.id == id } } }
    private var choices: [Client] {
        clients.filter { $0.deletedAt == nil && (!$0.archived || $0.id == existing?.clientId) }
            .sorted { ClientName.display($0).localizedCaseInsensitiveCompare(ClientName.display($1)) == .orderedAscending }
    }
    private func name(_ key: String) -> String {
        key.isEmpty ? "No client" : choices.first { $0.id.uuidString == key }.map(ClientName.display) ?? ""
    }

    var body: some View {
        M3Dialog(title: existing != nil ? "Edit project" : "New project", onClose: close) {
            OutlinedField(label: "Project", text: $title, prompt: "What you’re making", focused: $focus, id: "title")
            VStack(alignment: .leading, spacing: 8) {
                FieldLabel(text: "Client")
                ChoiceChips(items: [""] + choices.map(\.id.uuidString), selection: $client, title: name,
                            badge: { key in key.isEmpty ? nil : .person(name(key)) })
            }
            OutlinedField(label: "Agreed amount", text: $amount, prompt: "0", numeric: true, focused: $focus, id: "amount",
                          leading: AnyView(CurrencyChip(currency: $currency)))
            // Once a project is paid, when it was delivered no longer counts for anything.
            if existing?.status != .paid {
                Toggle(isOn: $delivered) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("The work is delivered").role(.row)
                        Text(existing?.workCompletedAt.map { "Delivered \(Day.dayMonthLong($0))" } ?? "The days you’ve been waiting to be paid count from today.")
                            .role(.supporting, MD.onSurfaceVariant)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .toggleStyle(.switch).tint(MD.primary)
            }
            if let error { Text(error).role(.supporting, MD.error) }
            if let p = existing {
                let count = payments.filter { $0.deletedAt == nil && $0.projectId == p.id }.count
                FormDeleteRow(title: "Delete this project", note: count == 0 ? nil : count == 1 ? "Its payment stays in your ledger." : "Its \(count) payments stay in your ledger.") {
                    let id = p.id, t = p.title, ctx = context
                    do {
                        try MoneyEngine(context: ctx).deleteProject(id)
                        undo.announce("Deleted \(t)", icon: "trash") { try? MoneyEngine(context: ctx).restoreProject(id) }
                        close()
                    } catch { self.error = error.localizedDescription }
                }
            }
        } actions: {
            M3Button(title: "Cancel", kind: .plain, action: close)
            M3Button(title: existing != nil ? "Save" : "Add project", kind: .filled, action: save).keyboardShortcut(.return, modifiers: [])
        }
        .onChange(of: client) { _, key in
            // A new project takes the client's usual currency.
            guard existing == nil, let key, let c = choices.first(where: { $0.id.uuidString == key }), let cur = c.defaultCurrency, !cur.isEmpty else { return }
            currency = cur
        }
        .onAppear {
            if let p = existing {
                title = p.title; client = p.clientId?.uuidString ?? ""; currency = p.currency
                amount = String(format: p.amount == p.amount.rounded() ? "%.0f" : "%.2f", p.amount)
                delivered = p.workCompletedAt != nil
            }
            focus = existing == nil ? "title" : nil
        }
    }

    private func save() {
        let t = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { error = "Name the project."; focus = "title"; return }
        guard let v = Parse.amount(amount), v > 0 else { error = "Type the agreed amount."; focus = "amount"; return }
        let clientId = client.flatMap { UUID(uuidString: $0) }
        let ctx = context
        if let p = existing {
            do {
                try MoneyEngine(context: ctx).updateProject(p.id, title: t, clientId: clientId, amount: v, currency: currency, delivered: delivered)
                undo.notify("Saved \(t)")
                close()
            } catch { self.error = error.localizedDescription }
            return
        }
        let p = Project(clientId: clientId, title: t, amount: v, currency: currency)
        if delivered { p.workCompletedAt = .now }
        p.dirty = true
        ctx.insert(p)
        try? ctx.save()
        let id = p.id
        undo.announce("Added \(t)") { try? MoneyEngine(context: ctx).deleteProject(id) }
        close()
    }
}

private struct ClientForm: View {
    @Environment(\.modelContext) private var context
    @Environment(UndoCenter.self) private var undo
    /// Editing a client instead of adding one.
    let editing: UUID?
    let close: () -> Void
    @Query private var clients: [Client]
    @Query private var projects: [Project]
    @State private var name = ""
    @State private var company = ""
    @State private var currency: String? = "EUR"
    @State private var error: String?
    @FocusState private var focus: String?

    private var existing: Client? { editing.flatMap { id in clients.first { $0.id == id } } }
    private var currencies: [String] {
        let usual = ["EUR", "USD", "GBP", "PHP", "AED", "SGD", "AUD"]
        if let c = currency, !usual.contains(c) { return usual + [c] }
        return usual
    }

    var body: some View {
        M3Dialog(title: existing != nil ? "Edit client" : "New client", onClose: close) {
            OutlinedField(label: "Name", text: $name, prompt: "Who pays you", focused: $focus, id: "name")
            OutlinedField(label: "Company", text: $company, prompt: "Optional", focused: $focus, id: "company")
            VStack(alignment: .leading, spacing: 8) {
                FieldLabel(text: "Usually pays in")
                ChoiceChips(items: currencies, selection: $currency, title: { $0 })
            }
            if let error { Text(error).role(.supporting, MD.error) }
            if let c = existing {
                let count = projects.filter { $0.deletedAt == nil && $0.clientId == c.id }.count
                FormDeleteRow(title: "Delete this client", note: count == 0 ? nil : count == 1 ? "Their project and its payments stay." : "Their \(count) projects and payments stay.") {
                    let id = c.id, shown = ClientName.display(c), ctx = context
                    do {
                        try MoneyEngine(context: ctx).deleteClient(id)
                        undo.announce("Deleted \(shown)", icon: "trash") { try? MoneyEngine(context: ctx).restoreClient(id) }
                        close()
                    } catch { self.error = error.localizedDescription }
                }
            }
        } actions: {
            M3Button(title: "Cancel", kind: .plain, action: close)
            M3Button(title: existing != nil ? "Save" : "Add", kind: .filled, action: save).keyboardShortcut(.return, modifiers: [])
        }
        .onAppear {
            if let c = existing { name = c.name; company = c.company ?? ""; currency = c.defaultCurrency ?? currency }
            focus = existing == nil ? "name" : nil
        }
    }

    private func save() {
        let n = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !n.isEmpty else { error = "Give the client a name."; focus = "name"; return }
        let ctx = context
        do {
            let id = try MoneyEngine(context: ctx).saveClient(existing?.id, name: n, company: company, currency: currency)
            if existing != nil { undo.notify("Saved \(n)") }
            else { undo.announce("Added \(n)") { try? MoneyEngine(context: ctx).deleteClient(id) } }
            close()
        } catch { self.error = error.localizedDescription }
    }
}

/// The quiet delete at the foot of an edit form, with what stays behind said under it.
private struct FormDeleteRow: View {
    let title: String
    var note: String? = nil
    let action: () -> Void
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            M3Button(title: title, icon: Sym.delete, kind: .danger, action: action)
            if let note { Text(note).role(.supporting, MD.onSurfaceVariant).padding(.leading, 12) }
        }
    }
}

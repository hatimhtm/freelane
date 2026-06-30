import SwiftUI
import SwiftData

/// Multi-hop payment entry: money that arrives in one wallet, then routes through others (Wise →
/// GCash → Cash), losing a fee at each hop. Records the full chain via the engine's PaymentStep
/// model and shows the cumulative effective fee, so you can see which routes actually cost you.
struct RoutedPaymentSheet: View {
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @Query(filter: #Predicate<Project> { $0.deletedAt == nil }, sort: \Project.createdAt, order: .reverse) private var projects: [Project]
    @Query(filter: #Predicate<Wallet> { $0.deletedAt == nil }, sort: \Wallet.name) private var wallets: [Wallet]
    @Query private var rateRows: [ExchangeRate]
    @Query private var settings: [AppSettings]

    struct Hop: Identifiable { let id = UUID(); var walletId: UUID?; var amount = ""; var currency = "PHP" }

    @State private var projectId: UUID?
    @State private var gross = ""
    @State private var grossCurrency = "PHP"
    @State private var hops: [Hop] = [Hop()]
    @State private var date = Date.now
    @State private var error: String?

    private var base: String { settings.first?.baseCurrency ?? "PHP" }
    private var rates: Rates { Rates(base: base, rates: rateRows) }
    private let currencies = CurrencyFormat.supported
    private var holding: [Wallet] { wallets.filter { !$0.archived } }
    private var openProjects: [Project] { projects.filter { $0.status == .unpaid || $0.status == .partiallyPaid } }

    private var grossBase: Double { rates.toBase(Double(gross) ?? 0, grossCurrency) }
    private var finalBase: Double {
        guard let last = hops.last, let a = Double(last.amount) else { return 0 }
        return rates.toBase(a, last.currency)
    }
    private var effectiveFee: Double { max(0, grossBase - finalBase) }
    private var feePct: Double { grossBase > 0 ? effectiveFee / grossBase : 0 }

    var body: some View {
        SheetScaffold(title: "Routed payment", accent: Palette.positive,
                      canSave: (Double(gross) ?? 0) > 0 && hops.allSatisfy { $0.walletId != nil && (Double($0.amount) ?? 0) > 0 },
                      onSave: save) {
            LabeledField("For project (optional)") {
                GlassMenuPicker(selection: $projectId,
                                options: [nil] + openProjects.map { Optional($0.id) },
                                label: { id in id.flatMap { i in projects.first { $0.id == i }?.title } ?? "Unassigned" })
            }
            HStack(spacing: 12) {
                LabeledField("Gross sent") { TextField("0", text: $gross).textFieldStyle(GlassFieldStyle()) }
                LabeledField("Currency") { CurrencyMenu(selection: $grossCurrency, options: currencies) }
            }
            LabeledField("Route — each hop is where it landed, and how much arrived") {
                VStack(spacing: 8) {
                    ForEach($hops) { $hop in
                        HStack(spacing: 8) {
                            Image(systemName: "arrow.turn.down.right").font(.system(size: 11)).foregroundStyle(Palette.textTertiary)
                            GlassMenuPicker(selection: $hop.walletId,
                                            options: [nil] + holding.map { Optional($0.id) },
                                            label: { id in id.flatMap { i in wallets.first { $0.id == i }?.name } ?? "Wallet…" })
                            .frame(width: 130)
                            TextField("amount", text: $hop.amount).textFieldStyle(GlassFieldStyle()).frame(width: 90)
                            CurrencyMenu(selection: $hop.currency, options: currencies)
                            if hops.count > 1 {
                                Button { hops.removeAll { $0.id == hop.id } } label: { Image(systemName: "minus.circle") }
                                    .buttonStyle(.iconPress).foregroundStyle(Palette.negative)
                            }
                        }
                    }
                    Button { hops.append(Hop(currency: hops.last?.currency ?? base)) } label: { Label("Add a hop", systemImage: "plus") }
                        .buttonStyle(.glass).controlSize(.small)
                }
            }
            if grossBase > 0, finalBase > 0 {
                HStack {
                    Text("Effective fee").font(.system(size: 12, weight: .semibold)).foregroundStyle(Palette.textSecondary)
                    Spacer()
                    Text("−\(CurrencyFormat.string(effectiveFee, base, compact: true)) · \(String(format: "%.1f%%", feePct * 100))")
                        .font(.system(size: 14, weight: .bold, design: .rounded)).foregroundStyle(feePct > 0.05 ? Palette.negative : Palette.warning)
                }
                .padding(10).insetRow(cornerRadius: Radii.field, hoverable: false)
            }
            if let error { Text(error).font(.caption).foregroundStyle(Palette.negative) }
        }
    }

    private func save() {
        error = nil
        guard let g = Double(gross), g > 0 else { error = "Enter the gross amount."; return }
        var steps: [ChainStepInput] = []
        var prevWallet: UUID? = nil
        var prevAmount = g
        var prevCurrency = grossCurrency
        for hop in hops {
            guard let w = hop.walletId, let a = Double(hop.amount), a > 0 else { error = "Each hop needs a wallet and amount."; return }
            steps.append(ChainStepInput(fromMethodId: prevWallet, methodId: w,
                                        amountIn: prevAmount, currencyIn: prevCurrency,
                                        amountOut: a, currencyOut: hop.currency, notes: nil))
            prevWallet = w; prevAmount = a; prevCurrency = hop.currency
        }
        let input = PaymentChainInput(projectId: projectId, projects: nil, paidAt: date,
                                      steps: steps, reference: nil, notes: nil)
        do { try MoneyEngine(context: context).addPayment(input); WidgetBridge.update(context); dismiss() }
        catch { self.error = error.localizedDescription }
    }
}

import Foundation

// Regression check for NaturalCapture.parse — lines that once booked the wrong sign or amount.
// Run with scripts/check-capture.sh.
@main struct Check {
    static func main() {
        let gcash = NaturalCapture.WalletRef(id: UUID(), name: "GCash")
        let wise = NaturalCapture.WalletRef(id: UUID(), name: "Wise")
        let wallets = [gcash, wise]
        var failures = 0
        func expect(_ line: String, amount: Double, payment: Bool, wallet: UUID? = nil, label: String? = nil) {
            guard let d = NaturalCapture.parse(line, wallets: wallets, currencies: ["PHP", "USD", "EUR"], base: "PHP") else {
                print("FAIL", line, "→ nil"); failures += 1; return
            }
            let got = d.isPayment ? d.description : d.vendor
            let ok = d.amount == amount && d.isPayment == payment && (wallet == nil || d.walletId == wallet)
                && (label == nil || got == label)
            if !ok { failures += 1 }
            print(ok ? "ok  " : "FAIL", "\"\(line)\" → \(d.amount) \(d.isPayment ? "income" : "spend") \(got ?? "-")")
        }
        expect("paid rent 3500 gcash", amount: 3500, payment: false, wallet: gcash.id)
        expect("prepaid load 300", amount: 300, payment: false)
        expect("unpaid invoice reminder 50", amount: 50, payment: true)   // "invoice" is a payment word
        expect("7-eleven 85", amount: 85, payment: false, label: "7-eleven")
        expect("450 jollibee", amount: 450, payment: false, label: "jollibee")
        expect("₱1,250 grab", amount: 1250, payment: false)
        expect("30000 client payment from acme USD wise", amount: 30000, payment: true, wallet: wise.id)
        expect("+500 refund", amount: 500, payment: true)
        print(failures == 0 ? "\nALL PASS" : "\n\(failures) FAILED")
        exit(failures == 0 ? 0 : 1)
    }
}

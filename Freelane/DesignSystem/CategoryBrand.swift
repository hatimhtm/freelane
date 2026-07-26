import SwiftUI

/// Identity for spending categories — a glyph and a hue, the way `VendorBrand` does it for shops.
///
/// Vendors have had real logos since 1.5. Categories — the thing you actually budget by, sort by,
/// and filter the ledger with — had a hashed colour smeared along a 4pt bar and nothing else. So
/// "Food" and "Fuel" were two grey words with two thin stripes, and finding a category meant
/// reading the whole column top to bottom every time.
///
/// A mark is worth more here than it is on a vendor row, because categories are a small closed
/// set you see every day: after a week you stop reading "Groceries" and just look for the green
/// basket. That's the difference between a list you parse and a list you scan.
///
/// Categories are free text (the user types them, or the model assigns one), so this matches on
/// substrings rather than an enum, and anything unmatched still gets a stable colour and a
/// neutral glyph — every category has a mark, always.
enum CategoryBrand {
    struct Mark {
        let symbol: String
        let color: Color
    }

    /// First match wins, so order matters: narrower needles above broader ones. ("coffee" has to
    /// beat "food"; "phone bill" has to beat "bill".)
    private static let table: [(needles: [String], symbol: String, color: Color)] = [
        (["grocer", "supermarket", "market", "palengke"],      "basket.fill",              Palette.positive),
        (["coffee", "cafe", "café"],                            "cup.and.saucer.fill",      Palette.warmGlow),
        (["restaurant", "dining", "eat", "food", "meal", "lunch", "dinner", "snack"],
                                                                "fork.knife",               Palette.warning),
        (["rent", "mortgage", "housing", "home", "house"],      "house.fill",               Palette.indigo),
        (["fuel", "gas", "petrol", "diesel"],                   "fuelpump.fill",            Palette.negative),
        (["transport", "commute", "grab", "taxi", "fare", "travel", "flight"],
                                                                "car.fill",                 Palette.cyan),
        (["electric", "power", "meralco", "utility", "utilities"],
                                                                "bolt.fill",                Palette.warmGlow),
        (["water", "tubig"],                                    "drop.fill",                Palette.cyan),
        (["internet", "wifi", "data", "phone", "mobile", "load", "telecom"],
                                                                "wifi",                     Palette.azure),
        (["subscription", "streaming", "netflix", "spotify", "software", "saas", "tool"],
                                                                "repeat",                   Palette.violet),
        (["health", "medical", "medicine", "pharmacy", "doctor", "dental", "clinic"],
                                                                "cross.case.fill",          Palette.negative),
        (["fitness", "gym", "sport"],                           "figure.run",               Palette.positive),
        (["education", "school", "tuition", "course", "book"],  "book.fill",                Palette.indigo),
        (["clothes", "clothing", "apparel", "shoes", "fashion"],"tshirt.fill",              Palette.violet),
        (["gift", "present"],                                   "gift.fill",                Palette.violet),
        (["sadaka", "charity", "zakat", "donation", "giving"],  "heart.fill",               Palette.teal),
        (["family", "kids", "child", "parent"],                 "figure.2.and.child.holdinghands", Palette.teal),
        (["pet", "dog", "cat"],                                 "pawprint.fill",            Palette.warmGlow),
        (["entertainment", "fun", "movie", "game", "hobby"],    "gamecontroller.fill",      Palette.violet),
        (["personal care", "grooming", "salon", "barber", "haircut"],
                                                                "scissors",                 Palette.cyan),
        (["insurance"],                                         "shield.lefthalf.filled",   Palette.indigo),
        (["tax", "bir", "government", "fee", "bank"],           "building.columns.fill",    Palette.textSecondary),
        (["invest", "savings", "stock", "crypto"],              "chart.line.uptrend.xyaxis", Palette.positive),
        (["repair", "maintenance", "fix", "hardware"],          "wrench.and.screwdriver.fill", Palette.warning),
        (["bill", "utilities"],                                 "doc.text.fill",            Palette.azure),
        (["other", "misc", "uncategor"],                        "square.grid.2x2.fill",     Palette.textSecondary),
    ]

    /// Hues for categories the table doesn't know. Deliberately the same family as the matched
    /// ones, so a page of mixed known/unknown categories still looks like one palette.
    private static let fallbackHues: [Color] = [
        Palette.indigo, Palette.violet, Palette.cyan, Palette.teal, Palette.warning, Palette.azure,
    ]

    static func mark(for name: String) -> Mark {
        let n = name.lowercased()
        for row in table where row.needles.contains(where: { n.contains($0) }) {
            return Mark(symbol: row.symbol, color: row.color)
        }
        // Stable across launches — `hashValue` is seeded per process and would repaint every
        // category on every start, which is the one thing a recognition aid must never do.
        let idx = Int(StableHash.of(n).prefix(6), radix: 16).map { $0 % fallbackHues.count } ?? 0
        return Mark(symbol: "tag.fill", color: fallbackHues[idx])
    }

    /// Just the hue — for bars and tints that want the identity without drawing the glyph.
    static func color(for name: String) -> Color { mark(for: name).color }
}

/// A category's mark: its glyph on a tinted ground, in the app's rounded-square shape rather
/// than a circle, so it belongs beside `VendorMark` and `GlyphChip` instead of introducing a
/// third silhouette.
///
/// The ground is the category's hue at low opacity with the glyph at full strength — not a
/// saturated filled tile. A spending list is twelve of these stacked; twelve solid colour blocks
/// would be a paint chart, and the colour would stop meaning anything by the fourth row.
struct CategoryMark: View {
    var name: String
    var size: CGFloat = 26
    /// Solid treatment for the one place a category is the subject rather than a row label.
    var filled: Bool = false

    var body: some View {
        let m = CategoryBrand.mark(for: name)
        let shape = RoundedRectangle(cornerRadius: size * 0.32, style: .continuous)
        Image(systemName: m.symbol)
            .font(.system(size: size * 0.44, weight: .semibold))
            .foregroundStyle(filled ? .white : m.color)
            .frame(width: size, height: size)
            .background {
                if filled {
                    shape.fill(LinearGradient(colors: [m.color, m.color.opacity(0.6)],
                                              startPoint: .topLeading, endPoint: .bottomTrailing))
                } else {
                    shape.fill(m.color.opacity(0.16))
                }
            }
            .overlay(shape.strokeBorder(m.color.opacity(filled ? 0 : 0.22), lineWidth: 0.8))
            .accessibilityHidden(true)      // the name is always right beside it
    }
}

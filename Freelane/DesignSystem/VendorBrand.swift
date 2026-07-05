import SwiftUI

/// Curated brand identities for ~55 common PH/global vendors → a color, a fallback SF
/// glyph, and a DOMAIN so we can load the REAL logo (Google's favicon service, same as
/// wallets). Anything not in the table can still get a real logo if the AI assigns a
/// domain for it (even from a misspelled name) — see `VendorLogo`. Final fallback is a
/// deterministic colored initial, so every vendor always has a recognizable mark.
enum VendorBrand {
    struct Mark { let color: Color; let symbol: String; let domain: String? }

    // (needles, brand hex, fallback SF Symbol, domain). First match wins — order matters.
    private static let table: [(needles: [String], hex: String, symbol: String, domain: String?)] = [
        // Food chains
        (["jollibee"], "#E51937", "fork.knife", "jollibee.com.ph"),
        (["mcdo", "mcdonald"], "#FFC72C", "fork.knife", "mcdonalds.com.ph"),
        (["kfc"], "#A6192E", "fork.knife", "kfc.com.ph"),
        (["greenwich"], "#E03A3E", "fork.knife", "greenwich.com.ph"),
        (["chowking"], "#E03A3E", "fork.knife", "chowking.com"),
        (["mang inasal", "inasal"], "#D62027", "fork.knife", "manginasal.com"),
        (["max's", "maxs restaurant"], "#C8102E", "fork.knife", "maxschicken.com"),
        (["bonchon"], "#C8102E", "fork.knife", "bonchon.com.ph"),
        (["pizza hut"], "#EE3124", "fork.knife", "pizzahut.com.ph"),
        (["shakey"], "#E4002B", "fork.knife", "shakeyspizza.ph"),
        (["yellow cab"], "#FFD400", "fork.knife", "yellowcabpizza.com"),
        (["army navy"], "#1B3A5B", "fork.knife", "armynavy.com.ph"),
        (["wendy"], "#E2203D", "fork.knife", "wendys.com.ph"),
        (["burger king"], "#D62300", "fork.knife", "burgerking.com.ph"),
        (["subway"], "#008C15", "fork.knife", "subway.com"),
        // Coffee
        (["starbucks"], "#00754A", "cup.and.saucer.fill", "starbucks.ph"),
        (["cbtl", "coffee bean"], "#3A2417", "cup.and.saucer.fill", "coffeebean.com.ph"),
        (["tim hortons"], "#C8102E", "cup.and.saucer.fill", "timhortons.ph"),
        (["dunkin"], "#FF6E1B", "cup.and.saucer.fill", "dunkindonuts.ph"),
        (["krispy"], "#006937", "cup.and.saucer.fill", "krispykreme.com.ph"),
        (["figaro"], "#5B2C16", "cup.and.saucer.fill", "figarocoffee.com"),
        // Pharmacy / health
        (["mercury drug"], "#0067B1", "cross.case.fill", "mercurydrug.com"),
        (["watsons"], "#00A9CE", "cross.case.fill", "watsons.com.ph"),
        (["southstar", "rose pharmacy", "pharmacy", "drugstore"], "#0067B1", "cross.case.fill", nil),
        // Online / marketplaces
        (["shopee"], "#EE4D2D", "bag.fill", "shopee.ph"),
        (["lazada"], "#0F146D", "bag.fill", "lazada.com.ph"),
        (["zalora"], "#1A1A1A", "bag.fill", "zalora.com.ph"),
        (["amazon"], "#FF9900", "bag.fill", "amazon.com"),
        (["temu"], "#FB7701", "bag.fill", "temu.com"),
        // Grocery / convenience
        (["7-eleven", "7 eleven", "seven eleven"], "#FF7300", "cart.fill", "7-eleven.com.ph"),
        (["ministop", "mini stop"], "#003DA5", "cart.fill", "ministop.com.ph"),
        (["alfamart"], "#ED1C24", "cart.fill", "alfamart.com.ph"),
        (["family mart", "familymart"], "#00A54F", "cart.fill", "familymart.com.ph"),
        (["puregold"], "#E4002B", "cart.fill", "puregold.com.ph"),
        (["savemore", "sm super", "sm market", "sm hyper"], "#0054A6", "cart.fill", "smmarkets.ph"),
        (["robinsons supermarket", "robinsons"], "#E2231A", "cart.fill", "robinsonssupermarket.com.ph"),
        (["landers"], "#1D3A8A", "cart.fill", "landers.ph"),
        (["s&r"], "#E4002B", "cart.fill", "snrshopping.com"),
        (["waltermart"], "#005BAA", "cart.fill", nil),
        // Department / retail
        (["sm "], "#0054A6", "bag.fill", "sm-store.com"),
        (["uniqlo"], "#FF0000", "tshirt.fill", "uniqlo.com"),
        (["ikea"], "#0058A3", "shippingbox.fill", "ikea.com"),
        (["ace hardware", "hardware"], "#E4002B", "wrench.and.screwdriver.fill", nil),
        // Transport
        (["grab"], "#00B14F", "car.fill", "grab.com"),
        (["angkas"], "#00305B", "bicycle", "angkas.com"),
        (["joyride"], "#FFC20E", "car.fill", "joyride.com.ph"),
        (["move it"], "#E4002B", "bicycle", nil),
        // Food delivery
        (["foodpanda"], "#D70F64", "takeoutbag.and.cup.and.straw.fill", "foodpanda.ph"),
        // Fuel
        (["petron"], "#ED1C24", "fuelpump.fill", "petron.com"),
        (["shell"], "#FBCE07", "fuelpump.fill", "shell.com.ph"),
        (["caltex"], "#E4002B", "fuelpump.fill", "caltex.com"),
        (["seaoil"], "#0033A0", "fuelpump.fill", "seaoil.com.ph"),
        (["phoenix", "fuel", "gas station"], "#ED1C24", "fuelpump.fill", nil),
        // Utilities
        (["meralco", "electric"], "#F58220", "bolt.fill", "meralco.com.ph"),
        (["maynilad"], "#0096D6", "drop.fill", "mayniladwater.com.ph"),
        (["manila water", "water district", "water bill"], "#0096D6", "drop.fill", nil),
        // Telecom / internet
        (["pldt"], "#C8102E", "wifi", "pldthome.com"),
        (["globe"], "#0066B3", "wifi", "globe.com.ph"),
        (["smart", "tnt", "talk n text"], "#00A94F", "wifi", "smart.com.ph"),
        (["converge"], "#F58220", "wifi", "convergeict.com"),
        (["dito"], "#0033A1", "wifi", "dito.ph"),
        (["sky cable", "sky broadband"], "#00AEEF", "wifi", nil),
        // Streaming / digital
        (["netflix"], "#E50914", "tv.fill", "netflix.com"),
        (["disney"], "#113CCF", "tv.fill", "disneyplus.com"),
        (["hbo", "max "], "#991EEB", "tv.fill", "max.com"),
        (["prime video", "amazon prime"], "#00A8E1", "tv.fill", "primevideo.com"),
        (["spotify"], "#1DB954", "music.note", "spotify.com"),
        (["youtube"], "#FF0000", "play.rectangle.fill", "youtube.com"),
        (["apple music", "icloud", "app store", "apple.com"], "#000000", "applelogo", "apple.com"),
        // Misc everyday
        (["national book", "fully booked", "bookstore"], "#D4002A", "book.fill", nil),
        (["vet", "animal clinic", "pet "], "#26A69A", "pawprint.fill", nil),
        (["carinderia", "eatery", "restaurant", "resto", "food"], "#FB8C00", "fork.knife", nil),
    ]

    static func match(_ name: String) -> Mark? {
        let n = name.lowercased()
        // Hand-curated table wins; then the large auto-generated PH catalog.
        for e in table where e.needles.contains(where: { n.contains($0) }) {
            return Mark(color: Color(hex: e.hex) ?? Palette.warmGlow, symbol: e.symbol, domain: e.domain)
        }
        for e in phCatalog where e.needles.contains(where: { n.contains($0) }) {
            return Mark(color: Color(hex: e.hex) ?? Palette.warmGlow, symbol: e.symbol, domain: e.domain)
        }
        return nil
    }
}

/// Resolves a vendor name → a logo domain, then to a real logo image URL. Sources, in
/// order: the curated `VendorBrand` table, then a per-name domain the AI assigned (even
/// for a misspelled name — `Brain.understandSpend` stores it), so over time every place
/// you spend at gets its real logo. Cached in UserDefaults so views resolve synchronously.
enum VendorLogo {
    private static let key = "vendor.domains"   // [slug: domain]

    static func slug(_ s: String) -> String {
        String(s.lowercased().map { $0.isLetter || $0.isNumber ? $0 : "-" }).trimmingCharacters(in: CharacterSet(charactersIn: "-"))
    }
    private static func map() -> [String: String] {
        (UserDefaults.standard.dictionary(forKey: key) as? [String: String]) ?? [:]
    }
    /// Persist an AI-assigned (or corrected) domain for a vendor name.
    static func remember(name: String, domain: String) {
        let d = domain.lowercased().trimmingCharacters(in: .whitespaces)
            .replacingOccurrences(of: "https://", with: "").replacingOccurrences(of: "http://", with: "")
            .replacingOccurrences(of: "www.", with: "")
        guard d.contains("."), d.count >= 4, !name.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        var m = map(); m[slug(name)] = d
        UserDefaults.standard.set(m, forKey: key)
    }
    /// The best known domain for a vendor name (curated table first, then AI-assigned).
    static func domain(for name: String) -> String? {
        if let mk = VendorBrand.match(name), let d = mk.domain { return d }
        return map()[slug(name)]
    }
    static func url(for domain: String, px: Int = 128) -> URL? { WalletLogo.url(for: domain, px: px) }
}

/// A vendor's recognizable tile — the REAL brand logo when we know its domain, else a
/// brand-colored SF glyph, else a deterministic colored initial.
struct VendorMark: View {
    var name: String
    var size: CGFloat = 32

    private var domain: String? { VendorLogo.domain(for: name) }

    var body: some View {
        let r = RoundedRectangle(cornerRadius: size * 0.30, style: .continuous)
        Group {
            if let d = domain {
                BrandLogoImage(domain: d, size: size) { fallback(r) }
            } else { fallback(r) }
        }
        .overlay(r.strokeBorder(Palette.cardEdge, lineWidth: 0.6))
    }

    @ViewBuilder private func fallback(_ r: RoundedRectangle) -> some View {
        if let m = VendorBrand.match(name) {
            Image(systemName: m.symbol).font(.system(size: size * 0.42, weight: .bold))
                .foregroundStyle(.white).frame(width: size, height: size).background(m.color, in: r)
        } else {
            Text(initial).font(.system(size: size * 0.42, weight: .bold, design: .rounded))
                .foregroundStyle(.white).frame(width: size, height: size).background(fallbackColor, in: r)
        }
    }

    private var initial: String { String(name.trimmingCharacters(in: .whitespaces).prefix(1)).uppercased() }
    private var fallbackColor: Color {
        let palette: [Color] = [Palette.coolGlow, Palette.warmGlow, Palette.teal, Palette.violet, Palette.cyan, Palette.indigo]
        var h = 5381; for b in name.lowercased().utf8 { h = ((h << 5) &+ h) &+ Int(b) }
        return palette[abs(h) % palette.count].opacity(0.85)
    }
}

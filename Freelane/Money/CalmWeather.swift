import SwiftUI
import SwiftData

/// The "financial weather" — a calm read of where you stand right now. The band is
/// decided by pure math (so it's always honest); the line narrates it in real numbers.
/// Sets the emotional tone at the top of Today and the Dashboard.
enum WeatherBand: String {
    case still, breeze, gust, storm
    var label: String {
        switch self {
        case .still: return "Calm"
        case .breeze: return "Steady"
        case .gust: return "A little tight"
        case .storm: return "Careful"
        }
    }
    var icon: String {
        switch self {
        case .still: return "sun.max.fill"
        case .breeze: return "wind"
        case .gust: return "cloud.sun.fill"
        case .storm: return "cloud.bolt.rain.fill"
        }
    }
    var color: Color {
        switch self {
        case .still: return Palette.teal
        case .breeze: return Palette.cyan
        case .gust: return Palette.warning
        case .storm: return Palette.negative
        }
    }
}

enum CalmWeather {
    static func band(safe: SafeBreakdown, overdrawn: Bool, runwayDays: Double?) -> WeatherBand {
        if overdrawn { return .storm }
        if let r = runwayDays, r < 7 { return .storm }
        if let r = runwayDays, r < 21 { return .gust }
        if safe.isLearning { return .breeze }
        let headroom = safe.initialForToday > 0 ? safe.liveRemaining / safe.initialForToday : 1
        if headroom < 0.2 { return .gust }
        if headroom < 0.55 { return .breeze }
        return .still
    }

    static func line(_ band: WeatherBand, safe: SafeBreakdown, base: String, overdrawn: Bool, runwayDays: Double?) -> String {
        let safeStr = CurrencyFormat.string(safe.liveRemaining, base, compact: true)
        let runway = runwayDays.map { " · about \(Int($0.rounded()))-day runway" } ?? ""
        switch band {
        case .still:  return "Calm waters. \(safeStr) free to spend today, nothing pressing."
        case .breeze: return safe.isLearning ? "Still learning your rhythm — \(safeStr) for today." : "Steady. \(safeStr) for today; an easy pace keeps it that way."
        case .gust:   return "A little tight. \(safeStr) left for today\(runway)."
        case .storm:  return overdrawn ? "A wallet's overdrawn — worth a look before spending more." : "Runway is short\(runway). Easy does it."
        }
    }

    /// A plain-English "what this means + what to do" — shown when the banner is tapped.
    static func explain(_ band: WeatherBand, base: String, overdrawn: Bool, runwayDays: Double?) -> String {
        if overdrawn {
            return "One of your wallets is below its limit. Move money into it, or log a payment that lands there. (Wallets you've marked “ignore” don't count.)"
        }
        let r = runwayDays.map { Int($0.rounded()) }
        switch band {
        case .still:
            return "You're in good shape — nothing to act on. The number above is what's free to spend today."
        case .breeze:
            return "Steady. Your usual pace keeps things comfortable. Nothing to do."
        case .gust:
            return "A bit tight: what's left to spend today is low compared to where it started. Easing up — or moving money into your spending wallets — brings it back."
        case .storm:
            let rw = r.map { "About \($0) days" } ?? "Not many days"
            return "“Runway” = how long your spendable money would last at your everyday pace (big one-off / investment buys are excluded). \(rw) right now — top up your spending wallets or slow down for a bit. It's a heads-up, not an error."
        }
    }
}

/// The banner shown at the top of Today / Dashboard. Tap it for an AI-generated read.
struct CalmWeatherBanner: View {
    var safe: SafeBreakdown
    var base: String
    var overdrawn: Bool
    var runwayDays: Double?
    @State private var showDetail = false

    private var band: WeatherBand { CalmWeather.band(safe: safe, overdrawn: overdrawn, runwayDays: runwayDays) }

    var body: some View {
        Button { showDetail = true } label: {
            HStack(spacing: 12) {
                Image(systemName: band.icon).font(.system(size: 16, weight: .semibold)).foregroundStyle(band.color)
                    .frame(width: 34, height: 34)
                    .background(band.color.opacity(0.16), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text(band.label).font(.system(size: 12.5, weight: .semibold)).foregroundStyle(band.color)
                    Text(CalmWeather.line(band, safe: safe, base: base, overdrawn: overdrawn, runwayDays: runwayDays))
                        .font(.system(size: 12.5)).foregroundStyle(Palette.textSecondary).lineLimit(2)
                }
                Spacer()
                Image(systemName: "chevron.right").font(.system(size: 11, weight: .bold)).foregroundStyle(Palette.textTertiary)
            }
            .padding(13).frame(maxWidth: .infinity, alignment: .leading)
            .glassCard(cornerRadius: Radii.tile, tint: band.color)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .sheet(isPresented: $showDetail) {
            WeatherDetailSheet(safe: safe, band: band, overdrawn: overdrawn, runwayDays: runwayDays, base: base)
        }
    }
}

/// What's-going-on detail for the weather banner — key numbers, a plain explanation,
/// and a deeper AI-written read.
struct WeatherDetailSheet: View {
    let safe: SafeBreakdown
    let band: WeatherBand
    let overdrawn: Bool
    let runwayDays: Double?
    let base: String
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @State private var ai = AIManager()
    @State private var aiText = ""
    @State private var loading = true

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 12) {
                Image(systemName: band.icon).font(.system(size: 18, weight: .semibold)).foregroundStyle(band.color)
                    .frame(width: 44, height: 44).background(band.color.opacity(0.16), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text(band.label).font(Typo.title(18)).foregroundStyle(band.color)
                    Text("Your money weather").font(.system(size: 12)).foregroundStyle(Palette.textTertiary)
                }
                Spacer()
                Button { dismiss() } label: { Image(systemName: "xmark.circle.fill").font(.system(size: 20)).foregroundStyle(Palette.textTertiary) }
                    .buttonStyle(.plain).keyboardShortcut(.cancelAction)
            }.padding(18)

            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    SectionCard(title: "Right now", accent: band.color) {
                        row("Free to spend today", CurrencyFormat.string(safe.liveRemaining, base), band.color)
                        row("Held across wallets", CurrencyFormat.string(safe.walletTotal, base), Palette.textPrimary)
                        if let r = runwayDays { row("Everyday runway", "≈ \(Int(r.rounded())) days", Palette.textSecondary) }
                    }
                    SectionCard(title: "What it means", accent: band.color) {
                        Text(CalmWeather.explain(band, base: base, overdrawn: overdrawn, runwayDays: runwayDays))
                            .font(.system(size: 13)).foregroundStyle(Palette.textSecondary).fixedSize(horizontal: false, vertical: true)
                    }
                    SectionCard(title: "What the AI sees", subtitle: "Live read of your situation", accent: Palette.violet) {
                        if loading {
                            HStack(spacing: 8) { ProgressView().controlSize(.small); Text("Reading your numbers…").font(.system(size: 12)).foregroundStyle(Palette.textTertiary) }
                        } else if aiText.isEmpty {
                            Text("Add your Gemini key in Settings → AI for a deeper, personalized read.").font(.system(size: 12)).foregroundStyle(Palette.textTertiary)
                        } else {
                            Text(aiText).font(.system(size: 13)).foregroundStyle(Palette.textPrimary).fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }.padding(18)
            }
        }
        .frame(width: 460, height: 560)
        .flagshipSheet()
        .task { aiText = await Brain.weatherDetail(context, ai: ai); loading = false }
    }

    private func row(_ label: String, _ value: String, _ color: Color) -> some View {
        HStack {
            Text(label).font(.system(size: 12.5)).foregroundStyle(Palette.textSecondary)
            Spacer()
            Text(value).font(.system(size: 13, weight: .semibold, design: .rounded)).foregroundStyle(color)
        }.padding(.vertical, 3)
    }
}

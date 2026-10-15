import WidgetKit
import SwiftUI
import CoreText
import AppKit

// Self-contained: the widget reads a small JSON the app writes to the shared
// (non-sandboxed) Application Support folder. No app code is imported.

struct WBill: Codable {
    var label: String; var amount: Double; var due: String
    var until: String? = nil
    var estimate: Bool? = nil
}
struct FreelaneSnapshot: Codable {
    var safeToday: Double
    var initialToday: Double
    var walletTotal: Double
    var outstanding: Double
    var landedMTD: Double
    var symbol: String
    var updatedAt: Date
    var bills: [WBill]? = nil
    var nextPayLabel: String? = nil
    var nextPayAmount: Double? = nil
    var nextPayDue: String? = nil
    var prayerTimes: [String]? = nil
    var nextPrayerName: String? = nil
    var nextPrayerTime: String? = nil
    var hijri: String? = nil
    // v2
    var free: Double? = nil
    var setAside: Double? = nil
    var setAsideFor: String? = nil
    var billsPaidMonth: String? = nil
}

func loadSnapshot() -> FreelaneSnapshot? {
    // Prefer the shared App Group container (works once the capability is added to both
    // targets); fall back to Application Support for unsandboxed/dev runs.
    var url: URL
    if let g = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: "group.app.freelane.mac") {
        url = g.appendingPathComponent("widget.json")
    } else {
        url = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
            .appendingPathComponent("Freelane/widget.json")
    }
    guard let data = try? Data(contentsOf: url) else { return nil }
    return try? JSONDecoder().decode(FreelaneSnapshot.self, from: data)
}

func fmtMoney(_ v: Double, _ sym: String) -> String {
    let f = NumberFormatter(); f.numberStyle = .decimal; f.maximumFractionDigits = 0
    return sym + (f.string(from: NSNumber(value: v)) ?? "\(Int(v))")
}

struct WEntry: TimelineEntry { let date: Date; let snap: FreelaneSnapshot? }

struct WProvider: TimelineProvider {
    func placeholder(in context: Context) -> WEntry { WEntry(date: Date(), snap: nil) }
    func getSnapshot(in context: Context, completion: @escaping (WEntry) -> Void) {
        completion(WEntry(date: Date(), snap: loadSnapshot()))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<WEntry>) -> Void) {
        let entry = WEntry(date: Date(), snap: loadSnapshot())
        let next = Calendar.current.date(byAdding: .hour, value: 1, to: Date()) ?? Date().addingTimeInterval(3600)
        completion(Timeline(entries: [entry], policy: .after(next)))
    }
}

// MARK: - Look (the app's Material 3 sage, Freelane Sans from the app's own bundle)

private func dyn(_ light: UInt32, _ dark: UInt32) -> Color {
    func c(_ v: UInt32) -> NSColor {
        NSColor(srgbRed: CGFloat((v >> 16) & 0xff) / 255, green: CGFloat((v >> 8) & 0xff) / 255, blue: CGFloat(v & 0xff) / 255, alpha: 1)
    }
    return Color(nsColor: NSColor(name: nil) { $0.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? c(dark) : c(light) })
}

enum WTone {
    static let band = dyn(0xc2ecd3, 0x284e3c)        // primary container
    static let onBand = dyn(0x284e3c, 0xc2ecd3)
    static let primary = dyn(0x406653, 0xa6d0b8)
    static let pane = dyn(0xffffff, 0x1d201e)
    static let onPane = dyn(0x191c1a, 0xe2e3df)
    static let muted = dyn(0x414844, 0xc1c8c2)
}

private func tag(_ s: String) -> Int { s.unicodeScalars.reduce(0) { ($0 << 8) | Int($1.value) } }

enum WFont {
    /// Freelane Sans lives in the app that carries this widget; use it when it can be read, else the system's rounded face.
    static let ready: Bool = {
        let res = Bundle.main.bundleURL.deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("Resources")
        let url = res.appendingPathComponent("FreelaneSans.ttf")
        guard FileManager.default.fileExists(atPath: url.path) else { return false }
        CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
        return true
    }()
    static func font(_ size: CGFloat, _ weight: CGFloat, rond: CGFloat = 60) -> Font {
        guard ready else {
            return .system(size: size, weight: weight >= 600 ? .semibold : weight >= 500 ? .medium : .regular, design: .rounded)
        }
        let features: [[CFString: Any]] = [[kCTFontOpenTypeFeatureTag: "pnum" as CFString, kCTFontOpenTypeFeatureValue: 1]]
        let attrs: [CFString: Any] = [
            kCTFontNameAttribute: "FreelaneSans-Regular" as CFString,
            kCTFontSizeAttribute: size,
            kCTFontVariationAttribute: [tag("wght"): weight, tag("ROND"): rond, tag("wdth"): 100, tag("opsz"): min(max(size, 6), 144)] as CFDictionary,
            kCTFontFeatureSettingsAttribute: features,
        ]
        return Font(CTFontCreateWithFontDescriptor(CTFontDescriptorCreateWithAttributes(attrs as CFDictionary), size, nil))
    }
}

/// An amount the way the app sets its big figures: a raised, smaller ₱ and the whole pesos.
struct WMoney: View {
    let value: Double
    let symbol: String
    var size: CGFloat = 34
    var color: Color = WTone.onBand
    var body: some View {
        let whole = fmtMoney(value, "")
        (Text(value < 0 ? "−" : "").font(WFont.font(size, 560, rond: 100))
         + Text(symbol).font(WFont.font(size * 0.5, 600, rond: 100)).baselineOffset(size * 0.355)
         + Text(whole.replacingOccurrences(of: "-", with: "")).font(WFont.font(size, 560, rond: 100)))
            .tracking(-0.03 * size)
            .foregroundStyle(color)
            .lineLimit(1).minimumScaleFactor(0.6)
    }
}

// MARK: - Free to spend

struct FreelaneWidgetView: View {
    var entry: WEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        if let s = entry.snap {
            switch family {
            case .systemSmall: small(s)
            case .systemMedium: HStack(alignment: .top, spacing: 16) { small(s); bills(s, max: 3, short: true) }
            default: VStack(alignment: .leading, spacing: 14) { small(s, fill: false); bills(s, max: 4) }
            }
        } else {
            VStack(alignment: .leading, spacing: 6) {
                Text("Free to spend").font(WFont.font(13, 600)).foregroundStyle(WTone.onBand)
                Text("Open Freelane once and it fills in.").font(WFont.font(12, 400)).foregroundStyle(WTone.onBand.opacity(0.8))
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }

    private func small(_ s: FreelaneSnapshot, fill: Bool = true) -> some View {
        let free = s.free ?? s.safeToday
        let setAside = s.setAside ?? 0
        return VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 5) {
                Text(setAside > 0 ? "Free to spend" : "Yours to spend").font(WFont.font(13, 600)).foregroundStyle(WTone.onBand)
                Spacer(minLength: 0)
            }
            WMoney(value: free, symbol: s.symbol, size: family == .systemSmall ? 32 : 38).padding(.top, 2)
            if fill { Spacer(minLength: 4) } else { Color.clear.frame(height: 8) }
            if let m = s.billsPaidMonth {
                Label("\(m)’s bills paid", systemImage: "checkmark").font(WFont.font(11, 600)).foregroundStyle(WTone.onBand)
                    .labelStyle(.titleAndIcon)
            }
            Text(line(s)).font(WFont.font(11, 400)).foregroundStyle(WTone.onBand.opacity(0.85)).lineLimit(2)
        }
        .frame(maxWidth: family == .systemMedium ? 150 : .infinity, maxHeight: fill ? .infinity : nil, alignment: .topLeading)
    }

    private func line(_ s: FreelaneSnapshot) -> String {
        if let a = s.setAside, a > 0 {
            return "\(fmtMoney(a, s.symbol)) set aside" + (s.setAsideFor.map { " for \($0)" } ?? "")
        }
        return "\(fmtMoney(s.walletTotal, s.symbol)) in your wallets"
    }

    @ViewBuilder private func bills(_ s: FreelaneSnapshot, max n: Int, short: Bool = false) -> some View {
        let list = Array((s.bills ?? []).prefix(n))
        VStack(alignment: .leading, spacing: 6) {
            Text("Coming up").font(WFont.font(12, 600)).foregroundStyle(WTone.muted)
            if list.isEmpty {
                Text("No bills on the calendar.").font(WFont.font(12, 400)).foregroundStyle(WTone.muted)
            }
            ForEach(Array(list.enumerated()), id: \.offset) { _, b in
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    VStack(alignment: .leading, spacing: 0) {
                        Text(b.label).font(WFont.font(13, 600)).foregroundStyle(WTone.onPane).lineLimit(1)
                        Text(short ? (b.until ?? b.due) : (b.until.map { "\(b.due) · \($0)" } ?? b.due))
                            .font(WFont.font(11, 400)).foregroundStyle(WTone.muted).lineLimit(1)
                    }
                    Spacer(minLength: 4)
                    Text((b.estimate == true ? "~" : "") + fmtMoney(b.amount, s.symbol)).font(WFont.font(13, 600)).foregroundStyle(WTone.onPane)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(WTone.pane))
    }
}

struct SafeToSpendWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "FreelaneSafeToSpend", provider: WProvider()) { entry in
            FreelaneWidgetView(entry: entry)
                .containerBackground(WTone.band, for: .widget)
        }
        .configurationDisplayName("Free to spend")
        .description("What's free after the week's bills are set aside, and what's coming up.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

// MARK: - Next Income widget

struct NextIncomeView: View {
    var entry: WEntry
    var body: some View {
        let s = entry.snap
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Image(systemName: "arrow.down.left").font(.system(size: 11, weight: .bold)).foregroundStyle(WTone.onBand)
                Text("Next income").font(WFont.font(13, 600)).foregroundStyle(WTone.onBand)
            }
            if let s, let label = s.nextPayLabel, let amt = s.nextPayAmount {
                WMoney(value: amt, symbol: s.symbol, size: 30)
                Text(label).font(WFont.font(12, 600)).foregroundStyle(WTone.onBand).lineLimit(1)
                if let due = s.nextPayDue {
                    Text("due \(due)").font(WFont.font(11, 400)).foregroundStyle(WTone.onBand.opacity(0.8))
                }
            } else {
                Text("—").font(WFont.font(28, 560)).foregroundStyle(WTone.onBand.opacity(0.6))
                Text(s == nil ? "Open Freelane once and it fills in." : "No scheduled income.")
                    .font(WFont.font(11, 400)).foregroundStyle(WTone.onBand.opacity(0.8))
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

struct NextIncomeWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "FreelaneNextIncome", provider: WProvider()) { entry in
            NextIncomeView(entry: entry)
                .containerBackground(WTone.band, for: .widget)
        }
        .configurationDisplayName("Next Income")
        .description("Your next scheduled income, at a glance.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

// MARK: - Next Prayer widget (advances through the day on its own)

struct PrayerEntry: TimelineEntry { let date: Date; let name: String; let time: String; let hijri: String? }

private func prayerToday(_ hhmm: String) -> Date? {
    let p = hhmm.split(separator: ":")
    guard p.count == 2, let h = Int(p[0]), let m = Int(p[1]) else { return nil }
    var c = Calendar.current.dateComponents([.year, .month, .day], from: Date()); c.hour = h; c.minute = m
    return Calendar.current.date(from: c)
}

struct PrayerProvider: TimelineProvider {
    private let names = ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"]
    func placeholder(in context: Context) -> PrayerEntry { PrayerEntry(date: Date(), name: "Fajr", time: "—", hijri: nil) }
    func getSnapshot(in context: Context, completion: @escaping (PrayerEntry) -> Void) {
        let s = loadSnapshot()
        completion(PrayerEntry(date: Date(), name: s?.nextPrayerName ?? "Fajr", time: s?.nextPrayerTime ?? "—", hijri: s?.hijri))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<PrayerEntry>) -> Void) {
        let s = loadSnapshot()
        let hijri = s?.hijri
        let times = s?.prayerTimes ?? []
        let now = Date()
        guard times.count == 5 else {
            let e = PrayerEntry(date: now, name: s?.nextPrayerName ?? "Fajr", time: s?.nextPrayerTime ?? "—", hijri: hijri)
            completion(Timeline(entries: [e], policy: .after(now.addingTimeInterval(3600)))); return
        }
        let parsed: [(name: String, time: String, at: Date)] = zip(names, times).compactMap { (n, t) in
            prayerToday(t).map { (n, t, $0) }
        }
        var entries: [PrayerEntry] = []
        // From now until the next prayer, show the next prayer.
        if let next = parsed.first(where: { $0.at > now }) {
            entries.append(PrayerEntry(date: now, name: next.name, time: next.time, hijri: hijri))
        }
        // At each remaining boundary, flip to the prayer after it (Isha → tomorrow's Fajr).
        for i in parsed.indices where parsed[i].at > now {
            if i + 1 < parsed.count {
                let nx = parsed[i + 1]
                entries.append(PrayerEntry(date: parsed[i].at, name: nx.name, time: nx.time, hijri: hijri))
            } else {
                entries.append(PrayerEntry(date: parsed[i].at, name: "Fajr", time: times[0], hijri: hijri))
            }
        }
        if entries.isEmpty {   // all five already passed today
            entries.append(PrayerEntry(date: now, name: "Fajr", time: times.first ?? "—", hijri: hijri))
        }
        completion(Timeline(entries: entries, policy: .atEnd))
    }
}

struct NextPrayerView: View {
    var entry: PrayerEntry
    @Environment(\.widgetFamily) private var family
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Image(systemName: "moon.stars").font(.system(size: 11, weight: .bold)).foregroundStyle(WTone.onBand)
                Text("Next prayer").font(WFont.font(13, 600)).foregroundStyle(WTone.onBand)
            }
            Text(entry.name).font(WFont.font(30, 560, rond: 100)).foregroundStyle(WTone.onBand).minimumScaleFactor(0.6).lineLimit(1)
            Text(entry.time).font(WFont.font(15, 500)).foregroundStyle(WTone.onBand)
            if family != .systemSmall, let h = entry.hijri {
                Spacer(minLength: 2)
                Text(h).font(WFont.font(11, 400)).foregroundStyle(WTone.onBand.opacity(0.8)).lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

struct NextPrayerWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "FreelaneNextPrayer", provider: PrayerProvider()) { entry in
            NextPrayerView(entry: entry)
                .containerBackground(WTone.band, for: .widget)
        }
        .configurationDisplayName("Next Prayer")
        .description("Your next prayer time, advancing through the day.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

@main
struct FreelaneWidgetBundle: WidgetBundle {
    var body: some Widget {
        SafeToSpendWidget()
        NextIncomeWidget()
        NextPrayerWidget()
    }
}

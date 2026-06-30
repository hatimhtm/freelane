import WidgetKit
import SwiftUI

// Self-contained: the widget reads a small JSON the app writes to the shared
// (non-sandboxed) Application Support folder. No app code is imported.

struct WBill: Codable { var label: String; var amount: Double; var due: String }
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

private let lime = Color(red: 0.95, green: 0.78, blue: 0.38)   // champagne gold (matches Palette.acidLime)

struct FreelaneWidgetView: View {
    var entry: WEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        let s = entry.snap
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 5) {
                Image(systemName: "shield.lefthalf.filled").font(.system(size: 11, weight: .bold)).foregroundStyle(lime)
                Text("SAFE TO SPEND").font(.system(size: 9, weight: .semibold)).kerning(0.4).foregroundStyle(.secondary)
            }
            Text(s.map { fmtMoney($0.safeToday, $0.symbol) } ?? "—")
                .font(.system(size: family == .systemSmall ? 26 : 34, weight: .semibold, design: .rounded))
                .foregroundStyle(lime).minimumScaleFactor(0.6).lineLimit(1)
            if let s {
                Text("of \(fmtMoney(s.initialToday, s.symbol)) today")
                    .font(.system(size: 10)).foregroundStyle(.secondary)
                if family != .systemSmall {
                    Spacer(minLength: 2)
                    HStack(spacing: 14) {
                        stat("Landed", fmtMoney(s.landedMTD, s.symbol))
                        stat("Owed me", fmtMoney(s.outstanding, s.symbol))
                        stat("Wallets", fmtMoney(s.walletTotal, s.symbol))
                    }
                }
                if family == .systemLarge, let bills = s.bills, !bills.isEmpty {
                    Divider().padding(.vertical, 4)
                    Text("UPCOMING BILLS").font(.system(size: 8.5, weight: .semibold)).kerning(0.4).foregroundStyle(.tertiary)
                    ForEach(Array(bills.enumerated()), id: \.offset) { _, b in
                        HStack {
                            Text(b.label).font(.system(size: 11)).foregroundStyle(.primary).lineLimit(1)
                            Text(b.due).font(.system(size: 9.5)).foregroundStyle(.tertiary)
                            Spacer()
                            Text(fmtMoney(b.amount, s.symbol)).font(.system(size: 11, weight: .semibold, design: .rounded)).foregroundStyle(.secondary)
                        }
                    }
                }
            } else {
                Text("Open Freelane once to sync.").font(.system(size: 10)).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func stat(_ l: String, _ v: String) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(l).font(.system(size: 8, weight: .semibold)).foregroundStyle(.tertiary)
            Text(v).font(.system(size: 12, weight: .semibold, design: .rounded)).foregroundStyle(.primary)
        }
    }
}

struct SafeToSpendWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "FreelaneSafeToSpend", provider: WProvider()) { entry in
            FreelaneWidgetView(entry: entry)
                .containerBackground(.black.gradient, for: .widget)
        }
        .configurationDisplayName("Safe to Spend")
        .description("How much you can spend today, at a glance.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

// MARK: - Next Income widget

struct NextIncomeView: View {
    var entry: WEntry
    var body: some View {
        let s = entry.snap
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 5) {
                Image(systemName: "arrow.down.left.circle.fill").font(.system(size: 11, weight: .bold)).foregroundStyle(lime)
                Text("NEXT INCOME").font(.system(size: 9, weight: .semibold)).kerning(0.4).foregroundStyle(.secondary)
            }
            if let s, let label = s.nextPayLabel, let amt = s.nextPayAmount {
                Text(fmtMoney(amt, s.symbol))
                    .font(.system(size: 30, weight: .semibold, design: .rounded))
                    .foregroundStyle(lime).minimumScaleFactor(0.6).lineLimit(1)
                Text(label).font(.system(size: 12, weight: .medium)).foregroundStyle(.primary).lineLimit(1)
                if let due = s.nextPayDue {
                    Text("due \(due)").font(.system(size: 10)).foregroundStyle(.secondary)
                }
            } else {
                Text("—").font(.system(size: 30, weight: .semibold, design: .rounded)).foregroundStyle(.secondary)
                Text(s == nil ? "Open Freelane once to sync." : "No scheduled income.")
                    .font(.system(size: 10)).foregroundStyle(.secondary)
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
                .containerBackground(.black.gradient, for: .widget)
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
            HStack(spacing: 5) {
                Image(systemName: "moon.stars.fill").font(.system(size: 11, weight: .bold)).foregroundStyle(lime)
                Text("NEXT PRAYER").font(.system(size: 9, weight: .semibold)).kerning(0.4).foregroundStyle(.secondary)
            }
            Text(entry.name).font(.system(size: 28, weight: .semibold, design: .rounded))
                .foregroundStyle(lime).minimumScaleFactor(0.6).lineLimit(1)
            Text(entry.time).font(.system(size: 15, weight: .medium)).foregroundStyle(.primary)
            if family != .systemSmall, let h = entry.hijri {
                Spacer(minLength: 2)
                Text(h).font(.system(size: 10)).foregroundStyle(.secondary).lineLimit(1)
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
                .containerBackground(.black.gradient, for: .widget)
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

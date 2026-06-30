import Foundation
@preconcurrency import UserNotifications
import Observation

/// Local notifications — works fully offline. Designed for all-day nudges
/// (daily digest, due reminders) without any server.
@MainActor
@Observable
final class NotificationManager {
    var authorized = false
    var enabled: Bool {
        didSet { UserDefaults.standard.set(enabled, forKey: "notif.enabled") }
    }

    init() {
        enabled = UserDefaults.standard.object(forKey: "notif.enabled") as? Bool ?? false
    }

    /// Fire a REAL macOS notification (Notification Center banner) immediately —
    /// so in-app notifications also show up like a real app. No-op if not authorized.
    nonisolated static func fireBanner(title: String, body: String?, category: String = "FREELANE_DAILY") {
        UNUserNotificationCenter.current().getNotificationSettings { s in
            guard s.authorizationStatus == .authorized || s.authorizationStatus == .provisional else { return }
            let c = UNMutableNotificationContent()
            c.title = title
            if let body, !body.isEmpty { c.body = body }
            c.sound = .default
            c.categoryIdentifier = category
            UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: UUID().uuidString, content: c,
                                             trigger: UNTimeIntervalNotificationTrigger(timeInterval: 0.4, repeats: false)))
        }
    }

    /// Actionable categories (a "Log spend" button on banners). Registered at launch.
    nonisolated static func registerCategories() {
        let logSpend = UNNotificationAction(identifier: "LOG_SPEND", title: "Log a spend", options: [.foreground])
        let cat = UNNotificationCategory(identifier: "FREELANE_DAILY", actions: [logSpend],
                                         intentIdentifiers: [], options: [])
        UNUserNotificationCenter.current().setNotificationCategories([cat])
    }

    func refreshStatus() async {
        let s = await UNUserNotificationCenter.current().notificationSettings()
        authorized = s.authorizationStatus == .authorized || s.authorizationStatus == .provisional
    }

    @discardableResult
    func requestAuthorization() async -> Bool {
        let granted = (try? await UNUserNotificationCenter.current()
            .requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        authorized = granted
        return granted
    }

    /// Schedule recurring daily nudges at the given hours (all-day cadence).
    func scheduleDailyDigest(hours: [Int] = [9, 13, 18]) {
        let center = UNUserNotificationCenter.current()
        // Remove ALL possible digest entries (every hour) before re-adding — leaves prayer
        // reminders ("prayer-*") intact. Clearing the full 0–23 set means changing the digest
        // hours can't orphan a digest scheduled at an old hour.
        center.removePendingNotificationRequests(withIdentifiers: (0..<24).map { "digest-\($0)" })
        guard enabled, authorized else { return }
        for hour in hours {
            var comps = DateComponents()
            comps.hour = hour
            // Pin the trigger to PHT — the whole app runs on Manila time. Without this, the OS
            // resolves the hour against the Mac's current timezone, so "9am" digests fire at the
            // wrong wall-clock (and "Good morning" could land at night) whenever you're off-PHT.
            comps.calendar = PHT.calendar
            comps.timeZone = PHT.zone
            let content = UNMutableNotificationContent()
            content.title = "Freelane"
            content.body = digestLine(for: hour)
            content.sound = .default
            content.categoryIdentifier = "FREELANE_DAILY"
            let trigger = UNCalendarNotificationTrigger(dateMatching: comps, repeats: true)
            center.add(UNNotificationRequest(identifier: "digest-\(hour)", content: content, trigger: trigger))
        }
    }

    /// Fire an immediate notification (used for testing / live events).
    func sendNow(title: String, body: String) {
        guard authorized else { return }
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        let req = UNNotificationRequest(identifier: UUID().uuidString, content: content,
                                        trigger: UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false))
        UNUserNotificationCenter.current().add(req)
    }

    func cancelAll() {
        UNUserNotificationCenter.current().removeAllPendingNotificationRequests()
    }

    private func digestLine(for hour: Int) -> String {
        switch hour {
        case ..<12: return "Good morning — here's your money snapshot for today."
        case 12..<17: return "Midday check-in: how's the day tracking?"
        default: return "Evening wrap-up: what landed and what's still due."
        }
    }
}

import SwiftUI
import SwiftData
import AppKit
import UserNotifications

/// All app data lives in one organized folder.
enum AppPaths {
    /// System Application Support dir, with a hard fallback to the conventional path. The lookup
    /// effectively never returns empty on macOS, but this is the data ROOT — a force-unwrap here
    /// would be an unrecoverable launch crash, so we never gamble on it.
    static var appSupportBase: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.homeDirectoryForCurrentUser
                .appendingPathComponent("Library/Application Support", isDirectory: true)
    }
    static var root: URL {
        let dir = appSupportBase.appendingPathComponent("Freelane", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }
    static var store: URL { root.appendingPathComponent("Freelane.store") }
    static var cache: URL {
        let dir = root.appendingPathComponent("Cache", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }
}

/// Single shared SwiftData container — used by the app window, the menu-bar extra,
/// and App Intents, so they all read/write the same store.
enum AppContainer {
    static let shared: ModelContainer = {
        FreelaneApp.migrateLegacyStoreIfNeeded()
        DataBackup.applyPendingRestoreIfNeeded()   // swap in a staged backup before opening
        do {
            let schema = Schema(FreelaneSchema.models)
            return try ModelContainer(for: schema, configurations: ModelConfiguration(schema: schema, url: AppPaths.store))
        } catch { fatalError("ModelContainer: \(error)") }
    }()
}

/// Cross-window commands (⌘N etc.) post these; RootView opens the right sheet.
extension Notification.Name {
    static let flLogSpend = Notification.Name("freelane.logSpend")
    static let flLogPayment = Notification.Name("freelane.logPayment")
    static let flOpenFeature = Notification.Name("freelane.openFeature")   // userInfo["feature"] = Feature.rawValue
    static let flOpenClient = Notification.Name("freelane.openClient")     // userInfo["clientId"] = UUID string — opens that client's detail
}

@main
struct FreelaneApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var updater = UpdaterModel.shared   // owns the Sparkle updater for the app's lifetime
    // Held here so a change in Settings re-renders the scene and flips the scheme LIVE (no relaunch).
    @AppStorage("appearance") private var appearance = "dark"
    private var scheme: ColorScheme? {
        switch appearance { case "light": return .light; case "system": return nil; default: return .dark }
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .frame(minWidth: 1100, minHeight: 720)
                .preferredColorScheme(scheme)
                .task { UpdaterModel.shared.checkSilently() }   // quiet probe → surfaces an Update badge if newer
        }
        .modelContainer(AppContainer.shared)
        .windowStyle(.hiddenTitleBar)
        .defaultSize(width: 1320, height: 860)
        .windowToolbarStyle(.unified(showsTitle: false))
        .commands {
            CommandGroup(after: .appInfo) {
                CheckForUpdatesCommand()   // Freelane ▸ Check for Updates…
            }
            CommandGroup(after: .newItem) {
                Button("Log Spend") { NotificationCenter.default.post(name: .flLogSpend, object: nil) }
                    .keyboardShortcut("n", modifiers: .command)
                Button("Log Payment") { NotificationCenter.default.post(name: .flLogPayment, object: nil) }
                    .keyboardShortcut("n", modifiers: [.command, .shift])
            }
        }

        // Always-available glance + quick capture from the menu bar.
        MenuBarExtra {
            MenuBarView().modelContainer(AppContainer.shared)
        } label: {
            Image(systemName: "chart.bar.fill")
        }
        .menuBarExtraStyle(.window)
    }

    /// Move data from the old default store into the Freelane folder once.
    static func migrateLegacyStoreIfNeeded() {
        let fm = FileManager.default
        guard !fm.fileExists(atPath: AppPaths.store.path) else { return }
        let base = AppPaths.appSupportBase
        for suffix in ["", "-shm", "-wal"] {
            let old = base.appendingPathComponent("default.store\(suffix)")
            let new = AppPaths.root.appendingPathComponent("Freelane.store\(suffix)")
            if fm.fileExists(atPath: old.path) { try? fm.copyItem(at: old, to: new) }
        }
    }
}

/// Handles OS notification taps (brings the app forward, routes to a page).
final class AppDelegate: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        UNUserNotificationCenter.current().delegate = self
        NotificationManager.registerCategories()
        HotkeyManager.shared.apply()   // register the global capture hotkey if enabled
    }
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .sound]
    }
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let action = response.actionIdentifier
        await MainActor.run {
            NSApp.activate(ignoringOtherApps: true)
            if action == "LOG_SPEND" { NotificationCenter.default.post(name: .flLogSpend, object: nil) }
        }
    }
}

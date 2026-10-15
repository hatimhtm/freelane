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
        if let dev = DevMode.dataDir {
            let dir = URL(fileURLWithPath: dev, isDirectory: true)
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            return dir
        }
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

/// Development only: `FREELANE_DATA_DIR=/path` runs the app on a copy of the data with sync, notifications
/// and the global hotkey off, so a test build can never touch the real store or push to the phone.
enum DevMode {
    static let dataDir: String? = {
        let v = ProcessInfo.processInfo.environment["FREELANE_DATA_DIR"]
        return (v?.isEmpty == false) ? v : nil
    }()
    static var isSandboxed: Bool { dataDir != nil }
}

/// Test builds only: host the v2 shell in a plain AppKit window, placed behind everything so it never
/// covers what you're doing, at the size the mockups were drawn at.
enum DevWindow {
    static var window: NSWindow?
    @MainActor static func open() {
        guard window == nil else { return }
        let dark = ProcessInfo.processInfo.environment["FREELANE_DEV_DARK"] == "1"
        let root = Shell().modelContainer(AppContainer.shared).preferredColorScheme(dark ? .dark : .light)
        let w = NSWindow(contentRect: NSRect(x: 80, y: 80, width: 1440, height: 900),
                         styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView], backing: .buffered, defer: false)
        w.titlebarAppearsTransparent = true
        w.titleVisibility = .hidden
        w.isReleasedWhenClosed = false
        w.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        w.contentView = NSHostingView(rootView: root)
        // The size the mockups were drawn at, whole window, kept on screen.
        let vis = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1512, height: 944)
        w.setFrame(NSRect(x: vis.minX + 20, y: vis.minY, width: 1440, height: min(900, vis.height)), display: false)
        w.orderBack(nil)
        window = w
    }

    /// The menu-bar window, hosted in a plain window so it can be captured.
    static var menuBar: NSWindow?
    @MainActor static func openMenuBar() {
        menuBar?.close()
        let dark = ProcessInfo.processInfo.environment["FREELANE_DEV_DARK"] == "1"
        let root = MenuBarV2().ignoresSafeArea().modelContainer(AppContainer.shared).preferredColorScheme(dark ? .dark : .light)
        let host = NSHostingView(rootView: root)
        let size = host.fittingSize
        let w = NSWindow(contentRect: NSRect(x: 1560, y: 80, width: 360, height: size.height),
                         styleMask: [.titled, .fullSizeContentView], backing: .buffered, defer: false)
        w.titlebarAppearsTransparent = true
        w.titleVisibility = .hidden
        w.isReleasedWhenClosed = false
        w.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        w.contentView = host
        w.orderBack(nil)
        menuBar = w
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
    static let flNew = Notification.Name("freelane.new")                   // v2: open the New menu
    static let flGo = Notification.Name("freelane.go")                     // v2: userInfo["page"] = Place.rawValue
}

@main
struct FreelaneApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var updater = UpdaterModel.shared   // owns the Sparkle updater for the app's lifetime
    // Held here so a change in Settings re-renders the scene and flips the scheme LIVE (no relaunch).
    // DARK is the default and the face the app is designed around. A near-white light theme was
    // tried and rejected on sight — "it almost blinded me" — so light is now an opt-in variant,
    // retuned to warm grey rather than paper white. See `Palette` for the light values.
    @AppStorage("appearance") private var appearance = "dark"
    /// v2 has its own appearance setting: white (light) is the default.
    @AppStorage("appearance.v2") private var appearanceV2 = "light"
    private var isV2: Bool { ProcessInfo.processInfo.environment["FREELANE_V2"] == "1" }
    private var scheme: ColorScheme? {
        if isV2 {
            if DevMode.isSandboxed, ProcessInfo.processInfo.environment["FREELANE_DEV_DARK"] == "1" { return .dark }
            switch appearanceV2 { case "dark": return .dark; case "system": return nil; default: return .light }
        }
        switch appearance { case "light": return .light; case "system": return nil; default: return .dark }
    }

    /// v2 (Material 3 Expressive) while it's being built: on with FREELANE_V2=1.
    @ViewBuilder private var rootView: some View {
        if isV2 { Shell() } else { RootView() }
    }

    var body: some Scene {
        WindowGroup(id: "main") {
            rootView
                .frame(minWidth: 1100, minHeight: 720)
                .preferredColorScheme(scheme)
                .task { UpdaterModel.shared.checkSilently() }   // quiet probe → surfaces an Update badge if newer
        }
        .modelContainer(AppContainer.shared)
        .windowStyle(.hiddenTitleBar)
        .defaultSize(width: isV2 ? 1440 : 1320, height: isV2 ? 900 : 860)
        .windowToolbarStyle(.unified(showsTitle: false))
        .commands {
            CommandGroup(after: .appInfo) {
                CheckForUpdatesCommand()   // Freelane ▸ Check for Updates…
            }
            if isV2 { V2Commands() } else {
                CommandGroup(after: .newItem) {
                    Button("Log Spend") { NotificationCenter.default.post(name: .flLogSpend, object: nil) }
                        .keyboardShortcut("n", modifiers: .command)
                    Button("Log Payment") { NotificationCenter.default.post(name: .flLogPayment, object: nil) }
                        .keyboardShortcut("n", modifiers: [.command, .shift])
                }
            }
        }

        // Always-available glance + quick capture from the menu bar. Test builds leave the menu bar alone.
        MenuBarExtra(isInserted: .constant(!DevMode.isSandboxed)) {
            if isV2 {
                MenuBarV2().modelContainer(AppContainer.shared).preferredColorScheme(scheme)
            } else {
                MenuBarView().modelContainer(AppContainer.shared)
            }
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
        guard !DevMode.isSandboxed else {
            // A test build launched in the background may restore zero windows; open one, behind everything.
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { DevWindow.open() }
            return
        }
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

import Sparkle
import SwiftUI

/// In-app manual updates via Sparkle, served from the signed appcast on GitHub Releases.
/// Nothing installs in the background (`SUEnableAutomaticChecks` is false in Info.plist).
/// On launch a silent, UI-less probe tells us whether a newer build exists so we can show
/// a badge; the user decides when to install. Triggering the real check offers a one-click
/// download → install → relaunch, with the changelog shown. Your data lives in
/// ~/Library/Application Support/Freelane, untouched by an update.
@MainActor
final class UpdaterModel: NSObject, ObservableObject, SPUUpdaterDelegate {
    static let shared = UpdaterModel()

    private(set) var controller: SPUStandardUpdaterController!

    @Published var updateAvailable = false
    @Published var latestVersion: String?

    override init() {
        super.init()
        controller = SPUStandardUpdaterController(startingUpdater: true,
                                                  updaterDelegate: self,
                                                  userDriverDelegate: nil)
    }

    var canCheck: Bool { controller.updater.canCheckForUpdates }

    /// User-initiated check — shows Sparkle's install prompt (with release notes).
    func checkForUpdates() { controller.checkForUpdates(nil) }

    /// Silent probe — no UI; flips `updateAvailable` via the delegate callbacks.
    func checkSilently() {
        guard canCheck else { return }
        controller.updater.checkForUpdateInformation()
    }

    // MARK: SPUUpdaterDelegate
    nonisolated func updater(_ updater: SPUUpdater, didFindValidUpdate item: SUAppcastItem) {
        Task { @MainActor in
            self.updateAvailable = true
            self.latestVersion = item.displayVersionString
        }
    }
    nonisolated func updaterDidNotFindUpdate(_ updater: SPUUpdater) {
        Task { @MainActor in
            self.updateAvailable = false
            self.latestVersion = nil
        }
    }
}

/// `Freelane ▸ Check for Updates…` menu command.
struct CheckForUpdatesCommand: View {
    @ObservedObject private var updater = UpdaterModel.shared
    var body: some View {
        Button("Check for Updates…") { updater.checkForUpdates() }
            .disabled(!updater.canCheck)
    }
}

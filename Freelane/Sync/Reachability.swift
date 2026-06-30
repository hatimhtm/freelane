import Foundation
import Network
import Observation

/// Tiny network-reachability monitor — the spine of offline-first sync.
///
/// The local SwiftData store is always authoritative on this Mac, so the app is fully usable with
/// no network: you log spends, payments, everything, and they're saved locally and marked `dirty`.
/// This monitor just tells the sync layer WHEN it's worth reaching for the cloud — when the path
/// becomes satisfied we flush the queued (dirty) changes; when it isn't, edits simply accumulate.
@MainActor
@Observable
final class Reachability {
    static let shared = Reachability()

    /// Optimistic until the first path update lands (a wrong guess just means one sync attempt
    /// that fails gracefully — never data loss).
    private(set) var online = true

    /// Invoked on the main actor each time connectivity flips from offline → online.
    var onBecameOnline: (() -> Void)?

    private let monitor = NWPathMonitor()
    private let queue = DispatchQueue(label: "freelane.reachability", qos: .utility)

    private init() {
        monitor.pathUpdateHandler = { [weak self] path in
            let up = path.status == .satisfied
            Task { @MainActor in
                guard let self else { return }
                let wasOnline = self.online
                self.online = up
                if up && !wasOnline { self.onBecameOnline?() }
            }
        }
        monitor.start(queue: queue)
    }
}

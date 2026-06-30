import Foundation
import AppKit
import SwiftData

/// Local, offline data safety: timestamped copies of the SwiftData store in a
/// Backups folder. (Data stays on this Mac — no cloud, per the user's choice.)
enum DataBackup {
    static var folder: URL {
        let d = AppPaths.root.appendingPathComponent("Backups", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }

    @discardableResult
    static func backupNow(stamp: String) -> URL? {
        let fm = FileManager.default
        let base = AppPaths.store.path
        let dest = folder.appendingPathComponent("Freelane-\(stamp).store")
        try? fm.removeItem(at: dest)
        guard (try? fm.copyItem(atPath: base, toPath: dest.path)) != nil else { return nil }
        for suffix in ["-wal", "-shm"] {
            let src = base + suffix
            if fm.fileExists(atPath: src) { try? fm.copyItem(atPath: src, toPath: dest.path + suffix) }
        }
        pruneOld(keep: 14)
        return dest
    }

    static func reveal() { NSWorkspace.shared.open(folder) }

    // MARK: - Restore

    struct Item: Identifiable {
        let id = UUID()
        let url: URL
        let date: Date
        let name: String
        let sizeMB: Double
    }

    /// All on-disk backups, newest first.
    static func list() -> [Item] {
        let fm = FileManager.default
        guard let items = try? fm.contentsOfDirectory(at: folder, includingPropertiesForKeys: [.creationDateKey, .fileSizeKey]) else { return [] }
        return items
            .filter { $0.lastPathComponent.hasPrefix("Freelane-") && $0.pathExtension == "store" }
            .map { url in
                let vals = try? url.resourceValues(forKeys: [.creationDateKey, .fileSizeKey])
                return Item(url: url, date: vals?.creationDate ?? .distantPast,
                            name: url.deletingPathExtension().lastPathComponent,
                            sizeMB: Double(vals?.fileSize ?? 0) / 1_000_000)
            }
            .sorted { $0.date > $1.date }
    }

    struct Preview { let spends: Int; let payments: Int; let projects: Int; let clients: Int; let wallets: Int }

    /// Open a backup read-only in a throwaway container and count what it holds, so the user
    /// sees "1,247 spends, 92 payments…" before committing to a restore.
    static func preview(_ backupStore: URL) -> Preview? {
        do {
            let schema = Schema(FreelaneSchema.models)
            let cfg = ModelConfiguration(schema: schema, url: backupStore, allowsSave: false)
            let container = try ModelContainer(for: schema, configurations: cfg)
            let ctx = ModelContext(container)
            func c<T: PersistentModel>(_ t: T.Type) -> Int { ((try? ctx.fetch(FetchDescriptor<T>())) ?? []).count }
            return Preview(spends: c(Spend.self), payments: c(Payment.self), projects: c(Project.self),
                           clients: c(Client.self), wallets: c(Wallet.self))
        } catch { return nil }
    }

    private static var pendingDir: URL { AppPaths.root.appendingPathComponent("PendingRestore", isDirectory: true) }

    /// Stage a backup to be swapped in at the NEXT launch (before the live store opens) — you
    /// can't safely hot-swap a SQLite file under an open container. Validates the source opens
    /// as a real database first, and aborts (cleanly) if any present source file fails to copy,
    /// so a half-copied/corrupt set can never be staged.
    static func stageRestore(from backupStore: URL) -> Bool {
        let fm = FileManager.default
        guard preview(backupStore) != nil else { return false }   // must be a readable Freelane store
        try? fm.removeItem(at: pendingDir)
        try? fm.createDirectory(at: pendingDir, withIntermediateDirectories: true)
        for suffix in ["", "-wal", "-shm"] {
            let src = URL(fileURLWithPath: backupStore.path + suffix)
            let dst = pendingDir.appendingPathComponent("Freelane.store\(suffix)")
            if fm.fileExists(atPath: src.path) {
                do { try fm.copyItem(at: src, to: dst) }
                catch { try? fm.removeItem(at: pendingDir); return false }
            }
        }
        // Validate the COPY (not just the source) opens — guards against a silently corrupt copy.
        let marker = pendingDir.appendingPathComponent("Freelane.store")
        guard fm.fileExists(atPath: marker.path), preview(marker) != nil else {
            try? fm.removeItem(at: pendingDir); return false
        }
        return true
    }

    /// Called at launch BEFORE the container opens. Designed so live data is NEVER at risk:
    /// 1) the staged store must open as a real DB; 2) a safety backup of the CURRENT store is
    /// made AND verified-readable (an unverified recovery point is no recovery point); 3) the
    /// staged files are copied to `.incoming` temps — the LIVE files aren't touched until every
    /// staged file is in place; 4) each live file is replaced via the atomic `replaceItemAt`,
    /// so there's no half-swapped window and no hand-rolled rollback to get wrong. If anything
    /// fails before step 4, live data is untouched and the restore simply retries next launch;
    /// if step 4 ever fails mid-way, the verified safety backup in Backups/ is the recovery.
    static func applyPendingRestoreIfNeeded() {
        let fm = FileManager.default
        let marker = pendingDir.appendingPathComponent("Freelane.store")
        guard fm.fileExists(atPath: marker.path) else { return }

        guard preview(marker) != nil else {
            moneyLog.error("Restore aborted: staged backup isn't a readable database. Live data untouched.")
            try? fm.removeItem(at: pendingDir); return
        }
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd-HHmm"
        guard let safety = backupNow(stamp: "pre-restore-\(f.string(from: Date()))"), preview(safety) != nil else {
            moneyLog.error("Restore deferred: couldn't make a VERIFIED safety backup. Live data untouched; retry next launch.")
            return   // keep pending so it retries; never proceed without a proven recovery point
        }

        // Stage to `.incoming` temps next to the live store. Live files are untouched here.
        var incoming: [(tmp: URL, live: URL)] = []
        var staged = true
        for suffix in ["", "-wal", "-shm"] {
            let src = pendingDir.appendingPathComponent("Freelane.store\(suffix)")
            guard fm.fileExists(atPath: src.path) else { continue }
            let live = URL(fileURLWithPath: AppPaths.store.path + suffix)
            let tmp = URL(fileURLWithPath: AppPaths.store.path + suffix + ".incoming")
            try? fm.removeItem(at: tmp)
            do { try fm.copyItem(at: src, to: tmp); incoming.append((tmp, live)) } catch { staged = false; break }
        }
        guard staged else {
            for (tmp, _) in incoming { try? fm.removeItem(at: tmp) }     // live untouched
            moneyLog.error("Restore aborted before swap: staging copy failed. Live data untouched (safety backup: \(safety.lastPathComponent, privacy: .public)).")
            return   // keep pending; retry next launch
        }

        // Commit: atomically replace each live file with its staged temp. replaceItemAt needs
        // an EXISTING target, so a brand-new file (no live counterpart, e.g. a -wal that didn't
        // exist before) is a plain move — there's no live data there to put at risk.
        for (tmp, live) in incoming {
            if fm.fileExists(atPath: live.path) {
                _ = try? fm.replaceItemAt(live, withItemAt: tmp)        // atomic swap
            } else {
                try? fm.moveItem(at: tmp, to: live)
            }
        }
        // Drop any leftover live -wal/-shm not present in the staged set, so a stale transaction
        // log can't attach to the freshly-restored store.
        let stagedSuffixes = Set(incoming.map { String($0.live.lastPathComponent.dropFirst("Freelane.store".count)) })
        for suffix in ["-wal", "-shm"] where !stagedSuffixes.contains(suffix) {
            try? fm.removeItem(at: URL(fileURLWithPath: AppPaths.store.path + suffix))
        }
        try? fm.removeItem(at: pendingDir)
    }

    private static func pruneOld(keep: Int) {
        let fm = FileManager.default
        guard let items = try? fm.contentsOfDirectory(at: folder, includingPropertiesForKeys: [.creationDateKey])
            .filter({ $0.lastPathComponent.hasPrefix("Freelane-") && $0.pathExtension == "store" }) else { return }
        let sorted = items.sorted { a, b in
            let da = (try? a.resourceValues(forKeys: [.creationDateKey]).creationDate) ?? .distantPast
            let db = (try? b.resourceValues(forKeys: [.creationDateKey]).creationDate) ?? .distantPast
            return da > db
        }
        for old in sorted.dropFirst(keep) {
            try? fm.removeItem(at: old)
            for suffix in ["-wal", "-shm"] { try? fm.removeItem(atPath: old.path + suffix) }
        }
    }
}

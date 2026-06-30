import Foundation
import Security

/// Local file store for the Gemini key — kept beside the data store in Application
/// Support. Used instead of the Keychain so a locally-built (ad-hoc-signed) app
/// doesn't prompt for keychain access on every launch. Single-user, local machine.
///
/// Hardened (P0): written owner-only (0600) so it isn't group/other-readable, and
/// excluded from backups. The Keychain was deliberately abandoned earlier to avoid a
/// per-launch prompt on locally-built apps; with the app itself Touch-ID-locked, that
/// trade still favours the file. (Flip to Keychain only if you accept the prompt.)
enum KeyStore {
    private static var dir: URL {
        let base = (try? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true))
            ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support")
        let d = base.appendingPathComponent("Freelane", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }
    private static var file: URL { dir.appendingPathComponent("gemini.key") }

    static func get() -> String? {
        guard let s = try? String(contentsOf: file, encoding: .utf8) else { return nil }
        let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? nil : t
    }
    static func set(_ key: String?) {
        guard let key, !key.isEmpty else { try? FileManager.default.removeItem(at: file); return }
        // Create the file owner-only (0600) ATOMICALLY at creation, so it never exists with
        // default (group/other-readable) permissions even briefly. createFile overwrites.
        let ok = FileManager.default.createFile(atPath: file.path, contents: Data(key.utf8),
                                                attributes: [.posixPermissions: 0o600])
        if !ok {
            moneyLog.error("KeyStore: failed to write the API key file with 0600 perms.")
            // Last-resort write so the key isn't lost, then tighten perms best-effort.
            try? key.write(to: file, atomically: true, encoding: .utf8)
            do {
                try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
                moneyLog.notice("KeyStore: API key permissions tightened to 0600 in fallback path.")
            } catch { moneyLog.error("KeyStore: fallback chmod 0600 failed: \(error.localizedDescription, privacy: .public)") }
        }
        // Keep the secret out of Time Machine / iCloud backups — log if it doesn't take.
        var u = file
        var rv = URLResourceValues(); rv.isExcludedFromBackup = true
        do { try u.setResourceValues(rv) }
        catch { moneyLog.error("KeyStore: could not exclude key file from backups: \(error.localizedDescription, privacy: .public)") }
    }
}

/// Minimal Keychain wrapper for the Supabase refresh token & credentials.
enum Keychain {
    private static let service = "app.freelane.mac"

    static func set(_ value: String?, for key: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
        SecItemDelete(query as CFDictionary)
        guard let value, let data = value.data(using: .utf8) else { return }
        var add = query
        add[kSecValueData as String] = data
        SecItemAdd(add as CFDictionary, nil)
    }

    static func get(_ key: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data, let s = String(data: data, encoding: .utf8) else { return nil }
        return s
    }
}

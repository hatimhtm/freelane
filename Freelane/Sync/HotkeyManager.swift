import AppKit
import Carbon.HIToolbox

/// A global capture hotkey (⌃⌥Space by default) that brings Freelane forward and opens the
/// quick-spend capture from anywhere. Uses Carbon's RegisterEventHotKey, which — unlike a global
/// NSEvent monitor — does NOT require the Accessibility (TCC) permission.
/// Main-actor isolated: only touched from app launch + the Settings toggle (both main thread).
@MainActor
final class HotkeyManager {
    static let shared = HotkeyManager()
    private var hotKeyRef: EventHotKeyRef?
    private var handlerInstalled = false   // the app-level Carbon handler is installed exactly once

    /// Whether the global hotkey is enabled — ON by default (one keystroke from anywhere is the
    /// whole point of a daily money logger; Carbon hotkeys need no permission prompt). The
    /// Settings toggle still turns it off, persisted under the same key.
    static var enabled: Bool {
        get { UserDefaults.standard.object(forKey: "hotkey.capture.enabled") as? Bool ?? true }
        set { UserDefaults.standard.set(newValue, forKey: "hotkey.capture.enabled") }
    }

    func apply() { Self.enabled ? register() : unregister() }

    /// Install the dispatch handler at most once — it's app-level and persists. It only ever
    /// fires when a hotkey is actually registered, so leaving it installed while disabled is inert.
    private func installHandlerOnce() {
        guard !handlerInstalled else { return }
        handlerInstalled = true
        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(GetApplicationEventTarget(), { _, _, _ -> OSStatus in
            DispatchQueue.main.async {
                NSApp.activate(ignoringOtherApps: true)
                NotificationCenter.default.post(name: .flLogSpend, object: nil)
            }
            return noErr
        }, 1, &spec, nil, nil)
    }

    func register() {
        installHandlerOnce()
        guard hotKeyRef == nil else { return }   // already registered
        let id = EventHotKeyID(signature: "FRLN".fourCharCode, id: 1)
        RegisterEventHotKey(UInt32(kVK_Space), UInt32(controlKey | optionKey), id, GetApplicationEventTarget(), 0, &hotKeyRef)
    }

    func unregister() {
        if let ref = hotKeyRef { UnregisterEventHotKey(ref); hotKeyRef = nil }   // handler stays (inert)
    }
}

private extension String {
    var fourCharCode: FourCharCode {
        var code: FourCharCode = 0
        for byte in utf8.prefix(4) { code = (code << 8) + FourCharCode(byte) }
        return code
    }
}

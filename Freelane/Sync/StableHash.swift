import Foundation

/// Deterministic, process-independent string hash (FNV-1a, 64-bit). Swift's built-in
/// `String.hashValue` is seeded with a per-launch random seed, so it CANNOT be used for any
/// fingerprint that must compare equal across app launches (cache validity, dedup keys). Use
/// this instead anywhere a stored hash is compared to a freshly-computed one.
enum StableHash {
    static func of(_ s: String) -> String {
        var h: UInt64 = 0xcbf29ce484222325
        for b in s.utf8 { h = (h ^ UInt64(b)) &* 0x100000001b3 }
        return String(h, radix: 16)
    }
}

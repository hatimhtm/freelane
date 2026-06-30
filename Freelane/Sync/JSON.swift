import Foundation

/// A tiny JSON value tree so we can decode PostgREST rows without 10 Codable
/// structs, and tolerate missing/extra columns gracefully.
enum JSONValue: Decodable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: JSONValue])
    case array([JSONValue])
    case null

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null; return }
        if let b = try? c.decode(Bool.self) { self = .bool(b); return }
        if let d = try? c.decode(Double.self) { self = .number(d); return }
        if let s = try? c.decode(String.self) { self = .string(s); return }
        if let o = try? c.decode([String: JSONValue].self) { self = .object(o); return }
        if let a = try? c.decode([JSONValue].self) { self = .array(a); return }
        self = .null
    }
}

/// Field accessors over a decoded JSON object.
struct Row {
    let fields: [String: JSONValue]
    init(_ o: [String: JSONValue]) { fields = o }

    func str(_ k: String) -> String? {
        if case let .string(s)? = fields[k] { return s }
        if case let .number(n)? = fields[k] { return String(n) }
        return nil
    }
    func dbl(_ k: String) -> Double? {
        switch fields[k] {
        case .number(let n): return n
        case .string(let s): return Double(s)
        default: return nil
        }
    }
    func bool(_ k: String) -> Bool? {
        if case let .bool(b)? = fields[k] { return b }
        return nil
    }
    func uuid(_ k: String) -> UUID? {
        guard let s = str(k) else { return nil }
        return UUID(uuidString: s)
    }
    func date(_ k: String) -> Date? {
        guard let s = str(k) else { return nil }
        return DateParse.iso(s)
    }
}

enum DateParse {
    private static let isoFrac: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private static let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()
    private static let dateOnly: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.timeZone = TimeZone(identifier: "Asia/Manila")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    static func iso(_ s: String) -> Date? {
        if let d = isoFrac.date(from: s) { return d }
        if let d = iso.date(from: s) { return d }
        if let d = dateOnly.date(from: s) { return d }
        return nil
    }

    static func string(_ d: Date) -> String {
        isoFrac.string(from: d)
    }
}

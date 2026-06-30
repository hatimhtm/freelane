import Foundation

struct SupabaseConfig {
    var url: URL
    var anonKey: String
    static let schema = "finance"   // tables live in the `finance` schema
}

enum SupabaseError: LocalizedError {
    case http(Int, String)
    case badResponse
    case notConfigured
    var errorDescription: String? {
        switch self {
        case .http(let code, let body): return "Server error \(code): \(body)"
        case .badResponse: return "Unexpected server response."
        case .notConfigured: return "Supabase isn't configured yet."
        }
    }
}

/// Thin Supabase Auth + PostgREST client over URLSession. Targets the custom
/// `finance` schema via the Accept-Profile / Content-Profile headers.
struct SupabaseAPI {
    let config: SupabaseConfig
    var accessToken: String?

    private var session: URLSession { .shared }

    // MARK: Auth

    struct AuthResponse: Decodable {
        let access_token: String
        let refresh_token: String
        let expires_in: Int?
    }

    /// Password grant against Supabase Auth. Returns access + refresh tokens.
    func signIn(email: String, password: String) async throws -> AuthResponse {
        try await token(grant: "password", body: ["email": email, "password": password])
    }

    /// Exchange a stored refresh token for a fresh session (silent re-login).
    func refreshSession(refreshToken: String) async throws -> AuthResponse {
        try await token(grant: "refresh_token", body: ["refresh_token": refreshToken])
    }

    private func token(grant: String, body: [String: String]) async throws -> AuthResponse {
        var req = URLRequest(url: config.url.appendingPathComponent("auth/v1/token"))
        req.url?.append(queryItems: [URLQueryItem(name: "grant_type", value: grant)])
        req.httpMethod = "POST"
        req.setValue(config.anonKey, forHTTPHeaderField: "apikey")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, resp) = try await session.data(for: req)
        try Self.check(resp, data)
        return try JSONDecoder().decode(AuthResponse.self, from: data)
    }

    // MARK: PostgREST

    /// Fetch all rows of a table in the finance schema.
    func fetchAll(_ table: String) async throws -> [Row] {
        guard let token = accessToken else { throw SupabaseError.notConfigured }
        var req = URLRequest(url: config.url.appendingPathComponent("rest/v1/\(table)"))
        req.url?.append(queryItems: [URLQueryItem(name: "select", value: "*")])
        req.httpMethod = "GET"
        req.setValue(config.anonKey, forHTTPHeaderField: "apikey")
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue(SupabaseConfig.schema, forHTTPHeaderField: "Accept-Profile")
        let (data, resp) = try await session.data(for: req)
        try Self.check(resp, data)
        let objects = try JSONDecoder().decode([JSONValue].self, from: data)
        return objects.compactMap { if case let .object(o) = $0 { return Row(o) } else { return nil } }
    }

    /// Upsert rows (merge-duplicates) into a finance-schema table.
    func upsert(_ table: String, rows: [[String: Any]]) async throws {
        guard !rows.isEmpty else { return }
        guard let token = accessToken else { throw SupabaseError.notConfigured }
        var req = URLRequest(url: config.url.appendingPathComponent("rest/v1/\(table)"))
        req.httpMethod = "POST"
        req.setValue(config.anonKey, forHTTPHeaderField: "apikey")
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue(SupabaseConfig.schema, forHTTPHeaderField: "Content-Profile")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("resolution=merge-duplicates,return=minimal", forHTTPHeaderField: "Prefer")
        req.httpBody = try JSONSerialization.data(withJSONObject: rows)
        let (data, resp) = try await session.data(for: req)
        try Self.check(resp, data)
    }

    // MARK: Helpers

    private static func check(_ resp: URLResponse, _ data: Data) throws {
        guard let http = resp as? HTTPURLResponse else { throw SupabaseError.badResponse }
        guard (200..<300).contains(http.statusCode) else {
            let body = String(data: data, encoding: .utf8) ?? ""
            throw SupabaseError.http(http.statusCode, String(body.prefix(300)))
        }
    }
}

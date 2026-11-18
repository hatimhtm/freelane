import Foundation

/// The phone's changes, about a second after it makes them, while this app is open.
///
/// Supabase Realtime tells us when a row of ours changes; we don't apply what it says. Each message
/// only asks `CloudSync` for a sync soon, so the one tested path (push, pull, apply only what is newer)
/// stays the only way rows land here. The 10-second poll stays as the safety net and slows down while
/// this link is joined.
///
/// The protocol is Phoenix channels over a WebSocket: join a topic listing the tables (filtered to our
/// own rows), answer with a heartbeat every 25 seconds, send the new token when it's renewed. Any
/// error drops the socket; the next sync tick opens a new one.
@MainActor
final class RealtimeLink {
    static let shared = RealtimeLink()

    private let host = "pgmmyzcsmmepxteepfjy.supabase.co"
    private let apiKey = "sb_publishable_I19DrCBciCMeQaEOS9qlMQ_o_q4dwEw"
    private let topic = "realtime:freelane-mac"
    private let tables = ["fl_wallets", "fl_clients", "fl_projects", "fl_payments", "fl_payment_steps",
                          "fl_withdrawals", "fl_recurring", "fl_loans", "fl_spends", "fl_ledger_entries"]

    private var task: URLSessionWebSocketTask?
    private var heartbeat: Timer?
    private var ref = 0
    private var token: String?
    private var uid: String?
    /// True once the server has accepted the join: changes are flowing.
    private(set) var joined = false

    /// Open the link if it's closed, or hand it a renewed token. Called on every sync, so a dropped
    /// link comes back by itself within one tick.
    func ensure(token: String, uid: String) {
        if task != nil, uid == self.uid {
            if token != self.token {
                self.token = token
                if joined { send(event: "access_token", payload: ["access_token": token]) }
            }
            return
        }
        drop()
        self.token = token
        self.uid = uid
        var comps = URLComponents()
        comps.scheme = "wss"
        comps.host = host
        comps.path = "/realtime/v1/websocket"
        comps.queryItems = [URLQueryItem(name: "apikey", value: apiKey), URLQueryItem(name: "vsn", value: "1.0.0")]
        guard let url = comps.url else { return }
        let t = URLSession.shared.webSocketTask(with: url)
        task = t
        t.resume()
        listen(t)
        let changes = tables.map { ["event": "*", "schema": "public", "table": $0, "filter": "user_id=eq.\(uid)"] }
        send(event: "phx_join", payload: [
            "config": ["broadcast": ["self": false], "presence": ["key": ""], "postgres_changes": changes],
            "access_token": token,
        ])
        let hb = Timer(timeInterval: 25, repeats: true) { _ in
            Task { @MainActor in RealtimeLink.shared.beat() }
        }
        RunLoop.main.add(hb, forMode: .common)
        heartbeat = hb
    }

    /// Close the link, e.g. on sign-out or before reconnecting after a wake.
    func drop() {
        heartbeat?.invalidate()
        heartbeat = nil
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        if joined { syncLog.info("realtime closed") }
        joined = false
    }

    private func beat() {
        guard let t = task else { return }
        ref += 1
        send(t, topic: "phoenix", event: "heartbeat", payload: [:])
    }

    private func send(event: String, payload: [String: Any]) {
        guard let t = task else { return }
        send(t, topic: topic, event: event, payload: payload)
    }

    private func send(_ t: URLSessionWebSocketTask, topic: String, event: String, payload: [String: Any]) {
        ref += 1
        let message: [String: Any] = ["topic": topic, "event": event, "payload": payload, "ref": "\(ref)", "join_ref": "1"]
        guard let data = try? JSONSerialization.data(withJSONObject: message),
              let text = String(data: data, encoding: .utf8) else { return }
        t.send(.string(text)) { error in
            guard error != nil else { return }
            Task { @MainActor in if RealtimeLink.shared.task === t { RealtimeLink.shared.drop() } }
        }
    }

    private func listen(_ t: URLSessionWebSocketTask) {
        t.receive { result in
            Task { @MainActor in RealtimeLink.shared.handle(result, from: t) }
        }
    }

    private func handle(_ result: Result<URLSessionWebSocketTask.Message, Error>, from t: URLSessionWebSocketTask) {
        guard t === task else { return }   // a socket we already dropped
        switch result {
        case .failure:
            drop()
        case .success(let message):
            if case .string(let text) = message, let data = text.data(using: .utf8),
               let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] {
                read(obj)
            }
            if task === t { listen(t) }
        }
    }

    private func read(_ obj: [String: Any]) {
        let event = obj["event"] as? String
        let payload = obj["payload"] as? [String: Any] ?? [:]
        switch event {
        case "postgres_changes":
            let table = ((payload["data"] as? [String: Any])?["table"] as? String) ?? "?"
            syncLog.info("realtime change · \(table, privacy: .public)")
            CloudSync.shared.syncSoon()
        case "phx_reply" where obj["topic"] as? String == topic:
            if payload["status"] as? String == "ok" {
                if !joined {
                    joined = true
                    syncLog.info("realtime joined")
                    // Anything that changed while the link was down comes in now.
                    CloudSync.shared.syncSoon()
                }
            } else {
                syncLog.error("realtime join refused: \(String(describing: payload["response"]).prefix(200), privacy: .public)")
                drop()
            }
        case "phx_error", "phx_close":
            drop()
        case "system":
            if payload["status"] as? String == "error" {
                syncLog.error("realtime: \(String(describing: payload["message"] ?? "error").prefix(200), privacy: .public)")
                drop()
            }
        default:
            break
        }
    }
}

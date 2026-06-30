import Foundation
import EventKit
import Contacts

/// Opt-in Apple-ecosystem integrations (Reminders, Contacts). All are off until the user
/// turns them on in Settings → Integrations, which is where access is requested — nothing
/// prompts by surprise. Flags live in UserDefaults.
/// (Calendar viewing was removed 2026-06-13 by request — the user has a thousand calendar
///  apps; this isn't one of them.)
enum Integrations {
    static var remindersOn: Bool { UserDefaults.standard.bool(forKey: "integ.reminders") }
    static var contactsOn: Bool { UserDefaults.standard.bool(forKey: "integ.contacts") }
}

struct ReminderItem: Identifiable, Sendable { let id: String; let title: String; let due: Date? }

/// Apple Reminders via a shared EventKit store (read; reminders can be completed).
@MainActor
enum EventBridge {
    static let store = EKEventStore()

    static func requestReminders() async -> Bool { (try? await store.requestFullAccessToReminders()) ?? false }

    static var remindersAuthorized: Bool { EKEventStore.authorizationStatus(for: .reminder) == .fullAccess }

    static func incompleteReminders() async -> [ReminderItem] {
        guard Integrations.remindersOn, remindersAuthorized else { return [] }
        let pred = store.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: nil)
        return await withCheckedContinuation { cont in
            store.fetchReminders(matching: pred) { rems in
                let items = (rems ?? []).map { r in
                    ReminderItem(id: r.calendarItemIdentifier, title: r.title ?? "(reminder)",
                                 due: r.dueDateComponents.flatMap { PHT.calendar.date(from: $0) })
                }
                cont.resume(returning: items.sorted { ($0.due ?? .distantFuture) < ($1.due ?? .distantFuture) })
            }
        }
    }

    static func completeReminder(_ id: String) {
        guard let r = store.calendarItem(withIdentifier: id) as? EKReminder else { return }
        r.isCompleted = true
        try? store.save(r, commit: true)
    }
}

/// "Siri, remind me to log my haircut" → Freelane surfaces that reminder as a one-tap spend to
/// capture, and completes the reminder once you've logged it. A reminder is a spend candidate if
/// its title starts with "log " (or already parses as an amount + vendor).
@MainActor
enum RemindersCapture {
    struct Candidate: Identifiable { let id: String; let title: String; let prefill: String; let draft: NaturalCapture.Draft? }

    private static let paymentWords = ["payment", "invoice", "paid", "received", "client", "landed"]

    static func pending(base: String, currencies: [String]) async -> [Candidate] {
        let rems = await EventBridge.incompleteReminders()
        return rems.compactMap { r in
            let raw = r.title.trimmingCharacters(in: .whitespaces)
            let isLog = raw.lowercased().hasPrefix("log ")
            let body = isLog ? String(raw.dropFirst(4)) : raw
            let lower = body.lowercased()
            let draft = NaturalCapture.parse(body, wallets: [], currencies: currencies, base: base)
            // Spend candidates only: an explicit "log …" OR something that parses as an amount+vendor.
            // Exclude anything that looks like a PAYMENT (parsed or by keyword) — payments aren't logged here.
            let looksPayment = (draft?.isPayment ?? false) || paymentWords.contains { lower.contains($0) }
            guard (isLog || draft != nil), !looksPayment else { return nil }
            return Candidate(id: r.id, title: raw, prefill: body, draft: draft)
        }
    }
}

/// Apple Contacts — used to canonicalize a person's name the AI extracted from a spend
/// (e.g. "Ahmed" → "Ahmed Rahmani") so tracked people match your address book.
@MainActor
enum ContactsBridge {
    static func request() async -> Bool { (try? await CNContactStore().requestAccess(for: .contacts)) ?? false }
    static var authorized: Bool { CNContactStore.authorizationStatus(for: .contacts) == .authorized }

    /// The best-matching contact's full name for a given first name / partial name, or nil.
    static func resolveFullName(_ query: String) -> String? {
        guard Integrations.contactsOn, authorized else { return nil }
        let q = query.trimmingCharacters(in: .whitespaces)
        guard q.count >= 2 else { return nil }
        let store = CNContactStore()
        let predicate = CNContact.predicateForContacts(matchingName: q)
        let keys = [CNContactGivenNameKey, CNContactFamilyNameKey] as [CNKeyDescriptor]
        guard let matches = try? store.unifiedContacts(matching: predicate, keysToFetch: keys), let c = matches.first else { return nil }
        let full = [c.givenName, c.familyName].filter { !$0.isEmpty }.joined(separator: " ")
        return full.isEmpty ? nil : full
    }
}

import AppIntents
import CoreSpotlight
import SwiftData
import Foundation

/// Freelane content in the SYSTEM's semantic index — the other half of "control the app with
/// Siri". Intents (Intents.swift) give Siri its VERBS (log a spend, safe-to-spend…); these
/// entities give it NOUNS: the projects, clients and wallets it can find, reference and open
/// by name ("open Acme in Freelane"). macOS 27's Spotlight semantic index picks them up with
/// attribution back to the app — this is contribution INTO the index; nothing is read back.

// MARK: - Entities

struct ProjectEntity: AppEntity, IndexedEntity {
    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Project"
    static var defaultQuery = ProjectEntityQuery()
    var id: UUID
    var title: String
    var clientName: String?

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(title)", subtitle: "\(clientName ?? "Project") · Freelane")
    }

    @MainActor
    static func all() -> [ProjectEntity] {
        let ctx = AppContainer.shared.mainContext
        let clients = ((try? ctx.fetch(FetchDescriptor<Client>())) ?? []).filter { $0.deletedAt == nil }
        return ((try? ctx.fetch(FetchDescriptor<Project>())) ?? [])
            .filter { $0.deletedAt == nil }
            .map { p in ProjectEntity(id: p.id, title: p.title,
                                      clientName: clients.first { $0.id == p.clientId }?.name) }
    }
}

struct ProjectEntityQuery: EntityQuery {
    @MainActor func entities(for identifiers: [UUID]) async throws -> [ProjectEntity] {
        ProjectEntity.all().filter { identifiers.contains($0.id) }
    }
    @MainActor func suggestedEntities() async throws -> [ProjectEntity] {
        Array(ProjectEntity.all().prefix(8))
    }
}

struct ClientEntity: AppEntity, IndexedEntity {
    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Client"
    static var defaultQuery = ClientEntityQuery()
    var id: UUID
    var name: String
    var company: String?

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(name)", subtitle: "\(company ?? "Client") · Freelane")
    }

    @MainActor
    static func all() -> [ClientEntity] {
        let ctx = AppContainer.shared.mainContext
        return ((try? ctx.fetch(FetchDescriptor<Client>())) ?? [])
            .filter { $0.deletedAt == nil && !$0.archived }
            .map { ClientEntity(id: $0.id, name: $0.name, company: $0.company) }
    }
}

struct ClientEntityQuery: EntityQuery {
    @MainActor func entities(for identifiers: [UUID]) async throws -> [ClientEntity] {
        ClientEntity.all().filter { identifiers.contains($0.id) }
    }
    @MainActor func suggestedEntities() async throws -> [ClientEntity] {
        Array(ClientEntity.all().prefix(8))
    }
}

struct WalletEntity: AppEntity, IndexedEntity {
    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Wallet"
    static var defaultQuery = WalletEntityQuery()
    var id: UUID
    var name: String

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(name)", subtitle: "Wallet · Freelane")
    }

    @MainActor
    static func all() -> [WalletEntity] {
        let ctx = AppContainer.shared.mainContext
        return ((try? ctx.fetch(FetchDescriptor<Wallet>())) ?? [])
            .filter { $0.deletedAt == nil && $0.isHolding && !$0.archived }
            .map { WalletEntity(id: $0.id, name: $0.name) }
    }
}

struct WalletEntityQuery: EntityQuery {
    @MainActor func entities(for identifiers: [UUID]) async throws -> [WalletEntity] {
        WalletEntity.all().filter { identifiers.contains($0.id) }
    }
    @MainActor func suggestedEntities() async throws -> [WalletEntity] {
        Array(WalletEntity.all().prefix(8))
    }
}

// MARK: - Entity-taking intents (the nouns become actionable)

/// "Open Acme in Freelane" — lands on Clients with that client's detail already open.
struct OpenClientIntent: AppIntent {
    static var title: LocalizedStringResource = "Open a client"
    static var description = IntentDescription("Open a client's detail in Freelane.")
    static var openAppWhenRun = true

    @Parameter(title: "Client") var client: ClientEntity

    @MainActor
    func perform() async throws -> some IntentResult {
        NotificationCenter.default.post(name: .flOpenFeature, object: nil,
                                        userInfo: ["feature": Feature.clients.rawValue])
        let id = client.id.uuidString
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
            NotificationCenter.default.post(name: .flOpenClient, object: nil, userInfo: ["clientId": id])
        }
        return .result()
    }
}

/// "Open the <project> board in Freelane" — lands on Projects.
struct OpenProjectIntent: AppIntent {
    static var title: LocalizedStringResource = "Open a project"
    static var description = IntentDescription("Open Freelane's project board at a project.")
    static var openAppWhenRun = true

    @Parameter(title: "Project") var project: ProjectEntity

    @MainActor
    func perform() async throws -> some IntentResult {
        NotificationCenter.default.post(name: .flOpenFeature, object: nil,
                                        userInfo: ["feature": Feature.projects.rawValue])
        return .result()
    }
}

// MARK: - Index maintenance

/// Contributes the entities to the Spotlight semantic index (macOS 27 personal context reads
/// from here). Called at launch and after NightShift; cheap and idempotent.
enum SiriIndex {
    static func reindex() async {
        let projects = await ProjectEntity.all()
        let clients = await ClientEntity.all()
        let wallets = await WalletEntity.all()
        let index = CSSearchableIndex.default()
        try? await index.indexAppEntities(projects)
        try? await index.indexAppEntities(clients)
        try? await index.indexAppEntities(wallets)
    }
}

import SwiftUI
import SwiftData

/// The expanded navigation rail: the New button, the places, Settings and sync at the bottom.
/// The selection pill glides between items on a spring.
struct Rail: View {
    let app: AppState
    var needs = 0
    @Namespace private var pill
    @Query(filter: #Predicate<Project> { $0.deletedAt == nil }) private var projects: [Project]

    private let groups: [[Place]] = [[.now, .ledger, .bills, .wallets], [.work, .insights], [.giving, .journal]]

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            NewButton { withAnimation(Flow.spatial) { app.newMenuOpen = true } }
                .padding(.bottom, 24)
                .opacity(app.newMenuOpen ? 0 : 1)
            ForEach(Array(groups.enumerated()), id: \.offset) { gi, group in
                if gi > 0 { Rectangle().fill(Surface.hairline).frame(height: 1).padding(.horizontal, 16).padding(.vertical, 8) }
                ForEach(group) { p in item(p) }
            }
            Spacer(minLength: 12)
            item(.settings)
            SyncLine()
        }
        .padding(.top, 58).padding(.horizontal, 12).padding(.bottom, 10)
    }

    private func count(for p: Place) -> Int {
        switch p {
        case .now: return needs
        case .work: return projects.filter { $0.status == .unpaid || $0.status == .partiallyPaid }.count
        default: return 0
        }
    }

    private func item(_ p: Place) -> some View {
        let on = app.page == p
        return Button { withAnimation(Flow.slow) { app.go(p) } } label: {
            HStack(spacing: 12) {
                Icon(p.glyph, size: 24, filled: on, weight: on ? 500 : 400)
                Text(p.title).font(FS.font(14, 500, rond: 60))
                if count(for: p) > 0 { CountPill(count: count(for: p)) }
            }
            .foregroundStyle(on ? MD.onSecondaryContainer : MD.onSurfaceVariant)
            .padding(.horizontal, 16).frame(height: 48)
            .background {
                if on { Capsule().fill(MD.secondaryContainer).matchedGeometryEffect(id: "pill", in: pill) }
            }
            .contentShape(Capsule())
        }
        .buttonStyle(RailItemStyle())
        .help(p.shortcut.map { "\(p.title)  ⌘\($0.character)" } ?? p.title)
    }
}

private struct RailItemStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.modifier(StateLayer(color: MD.onSurface, pressed: configuration.isPressed))
    }
}

/// The extended FAB at the top of the rail.
struct NewButton: View {
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Icon(Sym.add, size: 24)
                Text("New").font(FS.font(15, 600, rond: 60))
            }
            .foregroundStyle(MD.onPrimaryContainer)
            .padding(.leading, 16).padding(.trailing, 22).frame(height: 56)
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(MD.primaryContainer))
            .shadow(color: .black.opacity(0.10), radius: 1, y: 1)
            .shadow(color: .black.opacity(0.08), radius: 4, y: 3)
        }
        .buttonStyle(FabStyle())
        .help("New  ⌘N")
    }
}

private struct FabStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.modifier(StateLayer(color: MD.onPrimaryContainer, shape: AnyShape(RoundedRectangle(cornerRadius: 16, style: .continuous)), pressed: configuration.isPressed))
    }
}

/// "Synced · just now" at the foot of the rail.
private struct SyncLine: View {
    @State private var sync = CloudSync.shared
    var body: some View {
        HStack(spacing: 8) {
            Icon(DevMode.isSandboxed ? Sym.cloudOff : Sym.cloudDone, size: 18).foregroundStyle(MD.primary)
            Text(DevMode.isSandboxed ? "Offline copy" : "Synced · just now").font(FS.font(12, 400, rond: 40)).foregroundStyle(MD.onSurfaceVariant)
        }
        .padding(.horizontal, 16).padding(.top, 6).padding(.bottom, 4)
    }
}

/// The New menu: the FAB turns into a close button and the actions unfold beneath it.
struct NewMenu: View {
    let app: AppState
    @State private var shown = false
    @Environment(\.accessibilityReduceMotion) private var reduce

    var body: some View {
        ZStack(alignment: .topLeading) {
            MD.onSurface.opacity(0.10).ignoresSafeArea()
                .onTapGesture { withAnimation(Flow.spatial) { app.newMenuOpen = false } }
            VStack(alignment: .leading, spacing: 6) {
                Button { withAnimation(Flow.spatial) { app.newMenuOpen = false } } label: {
                    Icon(Sym.close, size: 24).foregroundStyle(MD.onPrimary)
                        .frame(width: 56, height: 56)
                        .background(Circle().fill(MD.primary))
                }
                .buttonStyle(.plain)
                .padding(.bottom, 4)
                .help("Close  Esc")
                ForEach(Array(NewAction.allCases.enumerated()), id: \.element) { i, a in
                    Button { withAnimation(Flow.spatial) { app.start(a) } } label: {
                        HStack(spacing: 12) {
                            Icon(a.glyph, size: 24)
                            Text(a.title).font(FS.font(16, 600, rond: 60))
                        }
                        .foregroundStyle(MD.onPrimaryContainer)
                        .padding(.leading, 18).padding(.trailing, 24).frame(height: 56)
                        .background(Capsule().fill(MD.primaryContainer))
                        .shadow(color: .black.opacity(0.10), radius: 1, y: 1)
                        .shadow(color: .black.opacity(0.10), radius: 6, y: 4)
                    }
                    .buttonStyle(FabStyle())
                    .scaleEffect(shown || reduce ? 1 : 0.8, anchor: .topLeading)
                    .opacity(shown ? 1 : 0)
                    .offset(y: shown || reduce ? 0 : -8)
                    .animation(reduce ? .easeOut(duration: 0.12) : Flow.fast.delay(Double(i) * 0.025), value: shown)
                }
            }
            .padding(.leading, 12).padding(.top, 58)
        }
        .onAppear { shown = true }
    }
}

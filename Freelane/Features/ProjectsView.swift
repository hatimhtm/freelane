import SwiftUI
import SwiftData
import QuartzCore
import AppKit

/// Physics-based kanban drag (Deck-style). A custom `DragGesture` feeds this controller, which
/// tracks smoothed velocity and the hovered column, and drives a floating ghost card that tilts by
/// drag speed and springs to the cursor — instead of SwiftUI's flat `.draggable`/`.dropDestination`.
@Observable @MainActor
final class KanbanDrag {
    var dragged: UUID?
    var location: CGPoint = .zero
    var velocity: CGVector = .zero
    var hovered: ProjectStatus?
    /// The ghost is springing back to its card after a missed drop — input is ignored until it lands.
    var returning = false
    private var lastTime: CFTimeInterval?
    private var lastLocation: CGPoint = .zero
    private var targets: [ProjectStatus: CGRect] = [:]
    private var homes: [UUID: CGPoint] = [:]   // each card's global center, for the spring-back
    /// Where you grabbed the card, relative to its centre. The ghost is drawn at
    /// `location + grabOffset` so it stays under your fingers instead of snapping its centre to
    /// the pointer — picking a 264×150 card up by its corner used to jerk it ~110pt before it
    /// started moving.
    private(set) var grabOffset: CGSize = .zero
    /// The board's own rect, so a drop in the gutter between two columns still resolves to a lane.
    var boardRect: CGRect = .zero

    /// Where the ghost actually is — this, not the cursor, is what the drop is measured against.
    var ghostPoint: CGPoint {
        CGPoint(x: location.x + grabOffset.width, y: location.y + grabOffset.height)
    }

    func register(_ status: ProjectStatus, _ rect: CGRect) { targets[status] = rect }
    func registerHome(_ id: UUID, _ center: CGPoint) { homes[id] = center }

    func begin(_ id: UUID, at p: CGPoint) {
        returning = false
        if let home = homes[id] {
            grabOffset = CGSize(width: home.x - p.x, height: home.y - p.y)
        } else {
            grabOffset = .zero
        }
        dragged = id; location = p; lastLocation = p; lastTime = CACurrentMediaTime(); velocity = .zero
    }

    /// Only the card that OWNS the drag may move the ghost.
    ///
    /// Without the id check, a second card's `onChanged` (easy to trigger — the pointer passes over
    /// neighbouring cards constantly while dragging) fed its own location into the same controller
    /// and the ghost teleported to whatever the cursor was over. This is the drag "feeling broken".
    func update(_ id: UUID, to p: CGPoint) {
        guard !returning, dragged == id else { return }
        let now = CACurrentMediaTime()
        if let last = lastTime {
            let dt = max(now - last, 1.0 / 240.0)
            let vx = (p.x - lastLocation.x) / dt, vy = (p.y - lastLocation.y) / dt
            velocity = CGVector(dx: velocity.dx * 0.4 + vx * 0.6, dy: velocity.dy * 0.4 + vy * 0.6)  // 60% new, smoothed
        }
        lastTime = now; lastLocation = p; location = p
        hovered = bestTarget(for: ghostPoint)
    }

    /// The column under the point — nearest centre wins when frames overlap.
    ///
    /// This was `targets.first { $0.value.contains(p) }`, and `Dictionary.first` has no defined
    /// order: with adjacent or overlapping column frames the highlighted column was arbitrary and
    /// could differ between frames, which is why the drop target sometimes flickered between two
    /// columns along a boundary.
    private func bestTarget(for p: CGPoint) -> ProjectStatus? {
        let hits = targets.filter { $0.value.contains(p) }
        if !hits.isEmpty {
            return hits.min { a, b in
                abs(a.value.midX - p.x) < abs(b.value.midX - p.x)
            }?.key
        }
        // Anywhere over the board that isn't strictly inside a column — the 16pt gutters, the dead
        // space below a short column, a slight overshoot past the last one — resolves to the
        // NEAREST lane by x. Previously all of that was "no target", so the card sprang back and
        // the drop felt like it had been rejected for no reason.
        guard boardRect.contains(p), !targets.isEmpty else { return nil }
        return targets.min { abs($0.value.midX - p.x) < abs($1.value.midX - p.x) }?.key
    }

    /// The (project, destination column) to commit — nil when dropped on no column, or back on the
    /// column it started in.
    ///
    /// `from` is required precisely so a same-column drop is a no-op. It used to commit, which ran
    /// the full status-change path: re-deriving allocations and, for a drop onto Paid, queuing a
    /// journal post-mortem — for a card the user had simply picked up and put down again.
    func commit(from: ProjectStatus) -> (UUID, ProjectStatus)? {
        guard let id = dragged, let h = hovered, !returning, h != from else { return nil }
        reset()
        return (id, h)
    }

    /// Forget cards that no longer exist, so the spring-home table can't grow forever or send a
    /// ghost back to where a deleted card used to be.
    func pruneHomes(keeping ids: Set<UUID>) {
        homes = homes.filter { ids.contains($0.key) }
    }
    /// Missed drop: spring the ghost back to its card's slot, then release it — instead of
    /// vanishing mid-air. (Deck-style: the card always lands somewhere.)
    func springHome() {
        guard let id = dragged, !returning else { return }
        returning = true
        withAnimation(.spring(response: 0.34, dampingFraction: 0.78)) {
            location = homes[id] ?? location
            velocity = .zero
        }
        // Must outlast the 0.34s spring above — at 0.30 the ghost was released mid-flight and
        // popped out of existence about 40ms before it reached the card.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.36) { [weak self] in
            guard let self, self.returning else { return }
            withAnimation(Motion.snappy) { self.reset() }
        }
    }
    private func reset() {
        dragged = nil; hovered = nil; velocity = .zero; lastTime = nil; returning = false
        grabOffset = .zero
    }

    /// Abandon a drag that will never get an `onEnded` — window deactivation, a cancelled gesture,
    /// the view being torn down. Without this the source card stays frozen at 0.25 opacity with a
    /// stranded ghost above it.
    func cancel() {
        guard dragged != nil else { return }
        withAnimation(Motion.snappy) { reset() }
    }
}

/// The floating drag ghost, isolated in its own view so per-frame `location`/`velocity` updates
/// re-render ONLY this layer — the columns and cards behind it don't re-evaluate on mouse move.
private struct KanbanGhost<Content: View>: View {
    var drag: KanbanDrag
    var boardOrigin: CGPoint
    @ViewBuilder var content: () -> Content

    var body: some View {
        let tilt = max(-10, min(10, drag.velocity.dx * 0.010))
        let speed = min(1, hypot(drag.velocity.dx, drag.velocity.dy) / 2600)
        content()
            .frame(width: 240)
            .scaleEffect(1.04 + speed * 0.03)
            .rotationEffect(.degrees(tilt), anchor: .top)
            .shadow(color: .black.opacity(0.30), radius: 16 + speed * 8, y: 7 + speed * 5)
            .position(x: drag.ghostPoint.x - boardOrigin.x, y: drag.ghostPoint.y - boardOrigin.y)
            .allowsHitTesting(false)
            // Was .spring(response: 0.26), which lagged the pointer by ~150ms on a fast flick —
            // long enough that you could cross into the next column and release while the ghost
            // was visibly still over the previous one. The tilt already sells the physics.
            .animation(.interactiveSpring(response: 0.12, dampingFraction: 0.86), value: drag.location)
    }
}

struct ProjectsView: View {
    @Environment(\.modelContext) private var context
    @Environment(UndoCenter.self) private var undo
    @Query private var settings: [AppSettings]
    @Query private var rateRows: [ExchangeRate]
    @Query(filter: #Predicate<Project> { $0.deletedAt == nil }, sort: \Project.createdAt, order: .reverse) private var projects: [Project]
    @Query(filter: #Predicate<Client> { $0.deletedAt == nil }) private var clients: [Client]
    @Query private var rawAllocations: [PaymentAllocation]
    @Query(filter: #Predicate<Payment> { $0.deletedAt == nil }) private var livePayments: [Payment]
    @Query private var milestones: [ProjectMilestone]

    // Allocations of trashed payments must never count as paid here.
    private var allocations: [PaymentAllocation] { ProjectMath.liveAllocations(rawAllocations, payments: livePayments) }

    @State private var showAdd = false
    @State private var editing: Project?
    @State private var paidOpen = false
    @State private var mode = "Board"
    @State private var pendingDeleteProject: Project?
    @State private var autoScrollX: CGFloat = 0
    @State private var payProject: Project?
    @State private var query = ""

    // Physics kanban drag (Deck-style): the controller + the board's global frame (to place the
    // ghost and detect the auto-scroll edge zones), plus live scroll state for edge auto-scroll.
    @State private var drag = KanbanDrag()
    @State private var boardFrame: CGRect = .zero
    @State private var scrollPos = ScrollPosition()
    @State private var scrollX: CGFloat = 0
    @State private var scrollMaxX: CGFloat = 0
    @State private var autoScroll: Timer?
    @State private var autoScrollStep: CGFloat = 0   // signed pt/tick, updated as the cursor moves
    // Table collapse (Paid collapsed by default)
    @State private var collapsed: Set<String> = ["paid"]

    private var base: String { settings.first?.baseCurrency ?? "PHP" }
    private var rates: Rates { Rates(base: base, rates: rateRows) }
    private func clientName(_ p: Project) -> String { clients.first { $0.id == p.clientId }?.name ?? "—" }
    /// Match a project against the search query (title / client name). Empty = all.
    private func matchesQuery(_ p: Project) -> Bool {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return true }
        return p.title.lowercased().contains(q) || clientName(p).lowercased().contains(q)
    }

    private func move(_ id: UUID, to status: ProjectStatus) {
        guard let p = projects.first(where: { $0.id == id }), p.status != status else { return }
        // Don't silently mark a project Paid while money is still owed — that's a lie to your books.
        // Pop the payment flow pre-filled with the outstanding amount instead.
        if status == .paid, ProjectMath.outstandingNative(project: p, allocations: allocations, rates: rates) > 0.01 {
            payProject = p
            return
        }
        p.status = status
        p.completedAt = status == .paid ? .now : nil
        p.dirty = true
        try? context.save()
        if status == .paid {
            Brain.enqueueProjectPostMortem(context, projectTitle: p.title, clientName: clients.first { $0.id == p.clientId }?.name, outcome: "paid")
        }
    }
    // Oldest → newest keeps late payers at the top of open columns.
    private func oldestFirst(_ s: ProjectStatus) -> [Project] {
        projects.filter { $0.status == s && matchesQuery($0) }
            .sorted { $0.agingAnchor < $1.agingAnchor }
    }
    private var paid: [Project] {
        projects.filter { $0.status == .paid && matchesQuery($0) }
            .sorted { ($0.completedAt ?? $0.createdAt) > ($1.completedAt ?? $1.createdAt) }
    }

    var body: some View {
        Page("Projects", subtitle: "What you're working on, and what it's owed.",
             toolbar: AnyView(addButton)) {
            HStack(spacing: 12) {
                GlassSegment(options: ["Board", "Table"], selection: $mode) { $0 }
                if !projects.isEmpty {
                    SearchField(text: $query, placeholder: "Search project or client").frame(maxWidth: 280)
                }
                Spacer(minLength: 0)
            }
            if projects.isEmpty {
                EmptyStateCard(icon: "folder", title: "No projects yet",
                               message: "Add a project to track deliverables, what's owed, and what's landed.",
                               actionLabel: "New project") { showAdd = true }
            } else if mode == "Board" {
                ZStack(alignment: .topLeading) {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(alignment: .top, spacing: 16) {
                            column("Unpaid", oldestFirst(.unpaid), Palette.cyan, .unpaid)
                            column("Partially paid", oldestFirst(.partiallyPaid), Palette.warning, .partiallyPaid)
                            column("Paid", paid, Palette.positive, .paid, collapsible: true, expanded: paidOpen)
                        }
                        .padding(4)
                    }
                    .scrollPosition($scrollPos)
                    .onReceive(NotificationCenter.default.publisher(for: NSApplication.didResignActiveNotification)) { _ in
                        abandonDrag()
                    }
                    .onScrollGeometryChange(for: CGFloat.self, of: { $0.contentOffset.x }) { _, n in scrollX = n }
                    .onScrollGeometryChange(for: CGFloat.self, of: { max(0, $0.contentSize.width - $0.containerSize.width) }) { _, n in scrollMaxX = n }
                    // The floating physics ghost — follows the cursor, tilts by velocity. Isolated
                    // so per-frame drag updates don't re-render the whole board.
                    if let gid = drag.dragged, let p = projects.first(where: { $0.id == gid }) {
                        KanbanGhost(drag: drag, boardOrigin: boardFrame.origin) { card(p) }
                            .transition(.asymmetric(insertion: .scale(scale: 0.97).combined(with: .opacity),
                                                    removal: .opacity))
                    }
                }
                .background(GeometryReader { g in
                    Color.clear
                        .onAppear { boardFrame = g.frame(in: .global); drag.boardRect = boardFrame }
                        .onChange(of: g.frame(in: .global)) { _, n in boardFrame = n; drag.boardRect = n }
                })
            } else {
                groupedTable
            }
        }
        .sheet(isPresented: $showAdd) { AddProjectSheet() }
        .sheet(item: $editing) { EditProjectSheet(project: $0) }
        .sheet(item: $payProject) { p in
            BulkPaymentSheet(prefillProjectId: p.id,
                             prefillGrossNative: ProjectMath.outstandingNative(project: p, allocations: allocations, rates: rates),
                             prefillCurrency: p.currency)
        }
        .confirmationDialog("Delete this project?", isPresented: Binding(get: { pendingDeleteProject != nil }, set: { if !$0 { pendingDeleteProject = nil } }), presenting: pendingDeleteProject) { p in
            Button("Delete", role: .destructive) {
                // A deal that never got paid fell through → offer a journal question about it.
                if p.status != .paid {
                    Brain.enqueueProjectPostMortem(context, projectTitle: p.title, clientName: clients.first { $0.id == p.clientId }?.name, outcome: "fell_through")
                }
                undo.trashSimple(p, label: "project", context: context); pendingDeleteProject = nil
            }
            Button("Cancel", role: .cancel) { pendingDeleteProject = nil }
        } message: { _ in Text("Removes the project. Logged payments stay in your history.") }
    }

    // Grouped, collapsible spreadsheet — Unpaid first, then Partially paid, Paid last
    // (collapsed by default, since you care about what's still owed).
    private var groupedTable: some View {
        VStack(spacing: 14) {
            tableHeaderRow
            tableGroup("Unpaid", oldestFirst(.unpaid), Palette.cyan, .unpaid)
            tableGroup("Partially paid", oldestFirst(.partiallyPaid), Palette.warning, .partiallyPaid)
            tableGroup("Paid", paid, Palette.positive, .paid)
        }
    }

    private var tableHeaderRow: some View {
        HStack(spacing: 10) {
            Text("PROJECT").frame(maxWidth: .infinity, alignment: .leading)
            Text("CLIENT").frame(width: 140, alignment: .leading)
            Text("AMOUNT").frame(width: 90, alignment: .trailing)
            Text("OUTSTANDING").frame(width: 100, alignment: .trailing)
            Text("DUE").frame(width: 84, alignment: .trailing)
        }
        .font(.system(size: 9, weight: .semibold)).kerning(0.5).foregroundStyle(Palette.textTertiary)
        .padding(.horizontal, 14)
    }

    @ViewBuilder private func tableGroup(_ title: String, _ items: [Project], _ accent: Color, _ status: ProjectStatus) -> some View {
        let isCollapsed = collapsed.contains(status.rawValue)
        VStack(spacing: 0) {
            Button { withAnimation(Motion.snappy) { if isCollapsed { collapsed.remove(status.rawValue) } else { collapsed.insert(status.rawValue) } } } label: {
                HStack(spacing: 8) {
                    Image(systemName: isCollapsed ? "chevron.right" : "chevron.down").font(.system(size: 10, weight: .bold)).foregroundStyle(Palette.textTertiary)
                    Circle().fill(accent).frame(width: 7, height: 7)
                    Text(title).font(.system(size: 12, weight: .semibold)).foregroundStyle(Palette.textPrimary)
                    Text("\(items.count)").font(.system(size: 11, weight: .semibold)).foregroundStyle(Palette.textTertiary)
                        .padding(.horizontal, 6).padding(.vertical, 2).background(Palette.hairline, in: Capsule())
                    Spacer()
                }.padding(.horizontal, 12).padding(.vertical, 9).contentShape(Rectangle())
            }.buttonStyle(.plain)
            if !isCollapsed {
                if items.isEmpty {
                    Text("None").font(.system(size: 11)).foregroundStyle(Palette.textTertiary).frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 14).padding(.bottom, 8)
                } else {
                    ForEach(items) { p in
                        tableRow(p)
                        if p.id != items.last?.id { Divider().overlay(Palette.hairline) }
                    }
                }
            }
        }
        .glassCard(cornerRadius: Radii.tile, tint: accent.opacity(0.4))
    }

    private func tableRow(_ p: Project) -> some View {
        let out = ProjectMath.outstandingNative(project: p, allocations: allocations, rates: rates)
        return Button { editing = p } label: {
            HStack(spacing: 10) {
                Text(p.title).font(.system(size: 12, weight: .medium)).foregroundStyle(Palette.textPrimary).lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
                Text(clientName(p)).font(.system(size: 12)).foregroundStyle(Palette.textSecondary).lineLimit(1).frame(width: 140, alignment: .leading)
                Text(CurrencyFormat.string(p.amount, p.currency, compact: true)).font(Typo.rowFigure(12, .medium)).monospacedDigit().foregroundStyle(Palette.textPrimary).lineLimit(1).frame(width: 90, alignment: .trailing)
                Text(out > 0 ? CurrencyFormat.string(out, p.currency, compact: true) : "—").font(Typo.rowFigure(12, .medium)).monospacedDigit().foregroundStyle(out > 0 ? Palette.warning : Palette.textTertiary).lineLimit(1).frame(width: 100, alignment: .trailing)
                Text(p.dueDate.map { $0.formatted(.dateTime.month().day()) } ?? "—").font(.system(size: 11)).foregroundStyle(Palette.textTertiary).frame(width: 84, alignment: .trailing)
            }.padding(.horizontal, 14).padding(.vertical, 9).contentShape(Rectangle())
        }.buttonStyle(.plain)
        .contextMenu {
            // NOTE: merged with the delivered-toggle that used to live on `draggableCard`. Two
            // nested `.contextMenu`s resolve to the innermost, so that one could never open —
            // "Mark work finished" was unreachable from the board, and it is what sets
            // `workCompletedAt`, which drives `agingAnchor` and therefore the column ordering.
            if p.status != .paid {
                if p.workCompletedAt == nil {
                    Button("Mark work finished", systemImage: "checkmark.seal") { markDelivered(p, true) }
                } else {
                    Button("Reopen — clear delivered", systemImage: "arrow.uturn.backward") { markDelivered(p, false) }
                }
                Divider()
            }
            Button("Edit", systemImage: "pencil") { editing = p }
            Button("Delete project", systemImage: "trash", role: .destructive) { pendingDeleteProject = p }
        }
    }

    private var addButton: some View {
        Button { showAdd = true } label: { Label("Add project", systemImage: "plus") }
            .buttonStyle(.glassProminent).tint(Palette.azure)
    }

    /// What a column is worth: outstanding for the open columns, earned for Paid — the figure you
    /// actually want from each, rather than the same measure everywhere.
    private func columnTotal(_ items: [Project]) -> Double {
        items.reduce(0.0) { sum, p in
            if p.status == .paid {
                return sum + ProjectMath.paidBase(project: p, allocations: allocations)
            }
            return sum + rates.toBase(ProjectMath.outstandingNative(project: p, allocations: allocations, rates: rates), p.currency)
        }
    }

    private func columnBackground(_ accent: Color, _ status: ProjectStatus) -> some View {
        let isTarget = drag.dragged != nil && drag.hovered == status
        return RoundedRectangle(cornerRadius: 18, style: .continuous)
            .fill(isTarget ? accent.opacity(0.14) : Palette.wellFill)
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(isTarget ? accent.opacity(0.7) : Palette.cardEdge, lineWidth: isTarget ? 1.8 : 0.8))
            .shadow(color: isTarget ? accent.opacity(0.35) : .clear, radius: 16)
            .scaleEffect(isTarget ? 1.01 : 1)
            .animation(Motion.snappy, value: isTarget)
    }

    /// Registers a column's global frame as a drop target for the drag controller.
    private func targetReader(_ status: ProjectStatus) -> some View {
        GeometryReader { g in
            Color.clear
                .onAppear { drag.register(status, g.frame(in: .global)) }
                .onChange(of: g.frame(in: .global)) { _, n in drag.register(status, n) }
        }
    }

    /// One component for all three lanes.
    ///
    /// Paid used to be a separate `paidColumn` and looked like it: 13pt sentence-case title against
    /// the others' 10pt uppercase, a count in a capsule pill instead of a bare figure, a glowing
    /// dot the other two had deliberately dropped, no money at all despite `columnTotal` already
    /// having a `.paid` branch, and a width that jumped 200↔264 on expand and reflowed the board.
    private func column(_ title: String, _ items: [Project], _ accent: Color, _ status: ProjectStatus,
                        collapsible: Bool = false, expanded: Bool = true) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Group {
                if collapsible {
                    Button { withAnimation(Motion.snappy) { paidOpen.toggle() } } label: {
                        columnHeader(title, items, accent, showChevron: true, expanded: expanded)
                            .contentShape(Rectangle())
                    }.buttonStyle(.plain).pointerStyle(.link)
                } else {
                    columnHeader(title, items, accent, showChevron: false, expanded: true)
                }
            }

            if !collapsible || expanded {
                if items.isEmpty {
                    Text("Nothing here").font(.system(size: 11)).foregroundStyle(Palette.textTertiary)
                        .frame(maxWidth: .infinity, alignment: .center).padding(.vertical, 14)
                } else {
                    ForEach(items) { p in draggableCard(p) }
                        .transition(.opacity.combined(with: .move(edge: .top)))
                }
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        // maxHeight so the LANE fills the board. Columns used to be only as tall as their content,
        // which made everything below the last card of a short column dead space that rejected
        // drops — and collapsed Paid was a ~50pt strip you had to hit exactly.
        .frame(width: 264, alignment: .topLeading)
        .frame(maxHeight: .infinity, alignment: .topLeading)
        .background(columnBackground(accent, status))
        .background(targetReader(status))
        .animation(Motion.snappy, value: items.count)
    }

    private func columnHeader(_ title: String, _ items: [Project], _ accent: Color,
                              showChevron: Bool, expanded: Bool) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 7) {
                if showChevron {
                    Image(systemName: expanded ? "chevron.down" : "chevron.right")
                        .font(.system(size: 9, weight: .bold)).foregroundStyle(Palette.textTertiary)
                }
                Text(title)
                    .font(.system(size: 10, weight: .semibold))
                    .textCase(.uppercase).kerning(0.8)
                    .foregroundStyle(accent)
                Text("\(items.count)")
                    .font(.system(size: 10, weight: .semibold)).monospacedDigit()
                    .foregroundStyle(Palette.textTertiary)
                Spacer(minLength: 0)
            }
            Text(CurrencyFormat.string(columnTotal(items), base, compact: true))
                .font(Typo.figure(20)).monospacedDigit()
                .foregroundStyle(items.isEmpty ? Palette.textTertiary : Palette.textPrimary)
                .lineLimit(1).minimumScaleFactor(0.7)
        }
        .padding(.bottom, 2)
    }

    // Paid column is COLLAPSED by default (paid projects pile up forever).
    /// A card you tap to edit and drag to move. A physics `DragGesture` (min 10pt so a click is
    /// never mistaken for a drag) feeds the controller; the source dims while its ghost floats.
    private func draggableCard(_ p: Project) -> some View {
        DraggableCardShell(isDragging: drag.dragged == p.id) { card(p) }
            .background(GeometryReader { g in
                // Remember the card's slot so a missed drop can spring the ghost back home.
                let c = g.frame(in: .global)
                Color.clear
                    .onAppear { drag.registerHome(p.id, CGPoint(x: c.midX, y: c.midY)) }
                    .onChange(of: c) { _, n in drag.registerHome(p.id, CGPoint(x: n.midX, y: n.midY)) }
            })
            .contentShape(Rectangle())
            .onTapGesture { editing = p }
            .gesture(
                DragGesture(minimumDistance: 10, coordinateSpace: .global)
                    .onChanged { v in
                        if drag.dragged == nil { withAnimation(Motion.snappy) { drag.begin(p.id, at: v.location) } }
                        drag.update(p.id, to: v.location)
                        updateAutoScroll(cursorX: v.location.x)
                    }
                    .onEnded { _ in
                        stopAutoScroll()
                        if let (id, status) = drag.commit(from: p.status) {
                            withAnimation(Motion.snappy) { move(id, to: status) }
                        } else {
                            // Covers both "dropped on no column" and "dropped back where it
                            // started" — the card visibly returns to its lane instead of the ghost
                            // being deleted where it stands.
                            drag.springHome()
                        }
                    }
            )
            .onDisappear { drag.pruneHomes(keeping: Set(projects.map(\.id))); abandonDrag() }
    }

    /// Edge auto-scroll: dragging a card within 56pt of the board's left/right edge scrolls the
    /// board toward it (faster the closer you get), so off-screen columns are reachable mid-drag.
    /// Edge auto-scroll, driven from an internal position rather than the reported one.
    ///
    /// Three bugs lived in the old version. It computed the next offset from `scrollX`, which is
    /// only updated by `onScrollGeometryChange` a frame or more after `scrollTo` is issued — so at
    /// 60Hz `next == scrollX` came up constantly mid-scroll, and that branch called
    /// `stopAutoScroll()`. Since the timer was only re-armed from `DragGesture.onChanged`, the
    /// commonest case — hold a card at the edge and stop moving the mouse — killed auto-scroll for
    /// the rest of the drag. It also ran on the default run-loop mode, which stalls entirely while
    /// AppKit is tracking a mouse drag, and nothing invalidated it if the view went away mid-drag.
    private func updateAutoScroll(cursorX: CGFloat) {
        let zone: CGFloat = 56
        let leftDepth = (boardFrame.minX + zone) - cursorX
        let rightDepth = cursorX - (boardFrame.maxX - zone)
        let depth = max(leftDepth, rightDepth)
        guard scrollMaxX > 0, depth > 0, boardFrame.width > zone * 2 else { stopAutoScroll(); return }
        let dir: CGFloat = leftDepth > 0 ? -1 : 1
        autoScrollStep = dir * (4 + min(depth, zone) / zone * 10)   // 4–14pt per tick, deeper = faster
        guard autoScroll == nil else { return }

        autoScrollX = scrollX          // seed from reality once, then own it
        let t = Timer(timeInterval: 1.0 / 60.0, repeats: true) { _ in
            MainActor.assumeIsolated {
                guard drag.dragged != nil, !drag.returning else { stopAutoScroll(); return }
                let next = min(max(autoScrollX + autoScrollStep, 0), scrollMaxX)
                // Only stop at the ends of the board — never because a frame hasn't landed yet.
                if next == autoScrollX { stopAutoScroll(); return }
                autoScrollX = next
                scrollPos.scrollTo(x: next)
            }
        }
        // .common, so the timer keeps firing while AppKit tracks the mouse.
        RunLoop.main.add(t, forMode: .common)
        autoScroll = t
    }
    private func stopAutoScroll() { autoScroll?.invalidate(); autoScroll = nil }

    /// Nothing guaranteed `onEnded` would ever arrive. Deactivate the window mid-drag and the card
    /// stayed dimmed, the ghost hung in the air, and the 60Hz scroll timer kept running.
    private func abandonDrag() {
        stopAutoScroll()
        drag.cancel()
    }

    /// Mark the work delivered (or clear it) — starts the "waiting to be paid"
    /// clock from now instead of from when the deal was created.
    private func markDelivered(_ p: Project, _ on: Bool) {
        p.workCompletedAt = on ? .now : nil
        p.updatedAt = .now; p.dirty = true
        try? context.save()
    }

    private func card(_ p: Project) -> some View {
        let client = clients.first { $0.id == p.clientId }
        let clientName = client?.name ?? "—"
        let clientColor = client?.accentColor.flatMap { Color(hex: $0) } ?? Palette.cyan
        let paid = ProjectMath.paidNative(project: p, allocations: allocations, rates: rates)
        let out = ProjectMath.outstandingNative(project: p, allocations: allocations, rates: rates)
        let prog = ProjectMath.progress(project: p, allocations: allocations, rates: rates)
        let overdue = (p.dueDate.map { $0 < PHT.startOfDay() } ?? false) && p.status != .paid
        return VStack(alignment: .leading, spacing: 12) {
            // Client identity is carried by ONE spine down the card's leading edge. It used to be a
            // spine AND a dot beside the name — the same information twice, and the dot competed
            // with the status badge on a card only 170pt wide.
            HStack(alignment: .top, spacing: 9) {
                Capsule().fill(clientColor).frame(width: 3, height: 30)
                VStack(alignment: .leading, spacing: 2) {
                    Text(p.title).font(Typo.title(14)).foregroundStyle(Palette.textPrimary).lineLimit(1)
                    Text(clientName).font(.system(size: 11)).foregroundStyle(Palette.textTertiary).lineLimit(1)
                }
                Spacer(minLength: 4)
                // Overdue REPLACES the status badge rather than sitting beside it: a card can't be
                // shouting two states at once, and overdue is the one that needs acting on.
                if overdue {
                    StatusBadge(text: "Overdue", color: Palette.negative)
                } else {
                    StatusBadge(text: p.status.label, color: p.status.color)
                }
            }
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(CurrencyFormat.string(p.amount, p.currency, compact: true))
                    .font(Typo.figure(23)).monospacedDigit()
                    .foregroundStyle(Palette.textPrimary)
                    .lineLimit(1).minimumScaleFactor(0.6)
                Spacer(minLength: 4)
                if out > 0 {
                    Text(CurrencyFormat.string(out, p.currency, compact: true) + " left")
                        .font(.system(size: 11, weight: .medium)).monospacedDigit()
                        .foregroundStyle(Palette.warning).lineLimit(1)
                }
            }
            // The app's own bar, not the stock ProgressView — which draws a system-blue capsule
            // ignoring the palette entirely, and was the last piece of un-themed AppKit on screen.
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Palette.wellFill).frame(height: 4)
                    Capsule().fill(p.status.color)
                        .frame(width: max(2, geo.size.width * CGFloat(min(1, max(0, prog)))), height: 4)
                }
            }
            .frame(height: 4)

            HStack(spacing: 6) {
                Text("\(CurrencyFormat.string(paid, p.currency, compact: true)) received")
                    .font(.system(size: 11)).monospacedDigit().foregroundStyle(Palette.textTertiary).lineLimit(1)
                Spacer(minLength: 4)
                let ms = milestones.filter { $0.projectId == p.id && $0.deletedAt == nil }
                if !ms.isEmpty {
                    Text("\(ms.filter { $0.done }.count)/\(ms.count) phases")
                        .font(.system(size: 10, weight: .medium)).foregroundStyle(Palette.violet)
                }
            }

            // HOW LONG THIS HAS BEEN SITTING — the thing a freelancer is actually chasing, and the
            // one fact the card never showed. A board that tells you what you're owed but not how
            // stale it is can't tell you who to email today.
            if p.status != .paid {
                let age = PHT.calendar.dateComponents([.day], from: p.agingAnchor, to: .now).day ?? 0
                let delivered = p.workCompletedAt != nil
                let tone: Color = age >= 30 ? Palette.negative : (age >= 14 ? Palette.warning : Palette.textTertiary)
                HStack(spacing: 5) {
                    Image(systemName: delivered ? "checkmark.seal.fill" : "clock")
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(delivered ? Palette.positive : tone)
                    Text(delivered ? "Delivered · waiting \(age)d" : "Open \(age)d")
                        .font(.system(size: 10, weight: .medium))
                        .foregroundStyle(delivered ? Palette.positive : tone)
                    if let due = p.dueDate {
                        Text("· due \(due.formatted(.dateTime.month().day()))")
                            .font(.system(size: 10))
                            .foregroundStyle(overdue ? Palette.negative : Palette.textTertiary)
                    }
                    Spacer(minLength: 0)
                }
                .padding(.top, 1)
            }
        }
        .padding(16)
        .frame(minHeight: 150, alignment: .topLeading)
        .glassCard(cornerRadius: Radii.card, interactive: true)
        .contextMenu {
            // NOTE: merged with the delivered-toggle that used to live on `draggableCard`. Two
            // nested `.contextMenu`s resolve to the innermost, so that one could never open —
            // "Mark work finished" was unreachable from the board, and it is what sets
            // `workCompletedAt`, which drives `agingAnchor` and therefore the column ordering.
            if p.status != .paid {
                if p.workCompletedAt == nil {
                    Button("Mark work finished", systemImage: "checkmark.seal") { markDelivered(p, true) }
                } else {
                    Button("Reopen — clear delivered", systemImage: "arrow.uturn.backward") { markDelivered(p, false) }
                }
                Divider()
            }
            Button("Edit", systemImage: "pencil") { editing = p }
            Button("Delete project", systemImage: "trash", role: .destructive) { pendingDeleteProject = p }
        }
    }
}

struct AddProjectSheet: View {
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @Query(filter: #Predicate<Client> { $0.deletedAt == nil }, sort: \Client.name) private var clients: [Client]
    @Query private var settings: [AppSettings]

    @State private var title = ""
    @State private var clientId: UUID?
    @State private var amount = ""
    @State private var currency = "PHP"
    @FocusState private var titleFocus: Bool

    private let currencies = CurrencyFormat.supported

    /// Tolerant amount parsing — accepts "1,500" as well as "1500.50".
    private var parsedAmount: Double? { Double(amount.replacingOccurrences(of: ",", with: "")) }

    var body: some View {
        SheetScaffold(title: "New project", accent: Palette.violet,
                      canSave: !title.trimmingCharacters(in: .whitespaces).isEmpty && parsedAmount != nil, onSave: save) {
            LabeledField("Title") {
                TextField("Project name", text: $title).textFieldStyle(GlassFieldStyle()).focused($titleFocus)
            }
            LabeledField("Client") {
                GlassMenuPicker(selection: $clientId,
                                options: [nil] + clients.map { Optional($0.id) },
                                label: { id in id.flatMap { i in clients.first { $0.id == i }?.name } ?? "None" })
            }
            HStack(spacing: 12) {
                LabeledField("Amount") { TextField("0", text: $amount).textFieldStyle(GlassFieldStyle()) }
                LabeledField("Currency") { CurrencyMenu(selection: $currency, options: currencies) }
            }
        }
        .onAppear {
            currency = settings.first?.baseCurrency ?? "PHP"
            DispatchQueue.main.async { titleFocus = true }
        }
        .onChange(of: clientId) { _, id in
            if let c = clients.first(where: { $0.id == id }), let cur = c.defaultCurrency, !cur.isEmpty { currency = cur }
        }
    }

    private func save() {
        guard let amt = parsedAmount else { return }
        let p = Project(clientId: clientId, title: title.trimmingCharacters(in: .whitespaces), amount: amt, currency: currency)
        p.dirty = true
        context.insert(p)
        try? context.save()
        dismiss()
    }
}

/// Hover feedback for a card whose whole purpose is being picked up.
///
/// The board's primary interaction is grab-and-drag and the card had none: no lift, no cursor
/// change, nothing. `glassCard(interactive: true)` looks like it would do this, but `Theme.swift`
/// documents that parameter as accepted-for-compatibility and unused.
private struct DraggableCardShell<Content: View>: View {
    let isDragging: Bool
    @ViewBuilder var content: () -> Content
    @State private var hovering = false

    var body: some View {
        content()
            .opacity(isDragging ? 0.25 : 1)
            .scaleEffect(hovering && !isDragging ? 1.008 : 1)
            .pointerStyle(.grabIdle)
            .onHover { hovering = $0 }
            .animation(Motion.snappy, value: isDragging)
            .animation(.easeOut(duration: 0.14), value: hovering)
    }
}

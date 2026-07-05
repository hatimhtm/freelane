import SwiftUI
import SwiftData

/// App-wide "just deleted — Undo" coordinator. Every destructive action routes through here so
/// it's reversible for 10 seconds (and still recoverable from Trash for 30 days after that).
@MainActor @Observable
final class UndoCenter {
    struct Toast: Identifiable {
        let id = UUID()
        let label: String          // e.g. "spend", "payment"
        let undo: () -> Void
    }
    private(set) var toast: Toast?
    private var timer: Task<Void, Never>?

    /// Show a 10-second "Deleted {label} · Undo". The newest deletion replaces any prior toast.
    func offer(_ label: String, undo: @escaping () -> Void) {
        timer?.cancel()
        let shown = Toast(label: label, undo: undo)
        toast = shown
        timer = Task { [weak self] in
            try? await Task.sleep(for: .seconds(10))
            guard !Task.isCancelled else { return }
            // Only auto-dismiss if THIS toast is still the one showing (guards a stale timer
            // from clearing a newer toast offered in the meantime).
            if self?.toast?.id == shown.id { self?.toast = nil }
        }
    }

    /// Soft-delete a simple (no-ledger) entity and offer undo. For ledger-owning entities
    /// (Spend/Payment/Withdrawal/Loan) call the engine delete + `offer { engine.restoreX }`
    /// so balances and project status recompute correctly.
    func trashSimple(_ entity: any SoftDeletable, label: String, context: ModelContext) {
        SoftDelete.trash(entity, ownsLedger: false, context: context)
        try? context.save()
        offer(label) {
            SoftDelete.restore(entity, ownsLedger: false, context: context)
            try? context.save()
        }
    }

    func performUndo() { toast?.undo(); toast = nil; timer?.cancel() }
    func clear() { toast = nil; timer?.cancel() }
}

/// The floating toast itself — sits above content, bottom-center.
struct UndoToastOverlay: View {
    @Environment(UndoCenter.self) private var undo

    var body: some View {
        VStack {
            Spacer()
            if let t = undo.toast {
                HStack(spacing: 14) {
                    Image(systemName: "trash")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Palette.textSecondary)
                    Text("Deleted \(t.label)")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Palette.textPrimary)
                    Divider().frame(height: 16)
                    Button("Undo") { undo.performUndo() }
                        .buttonStyle(.plain)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Palette.teal)
                    Button { undo.clear() } label: {
                        Image(systemName: "xmark").font(.system(size: 10, weight: .bold))
                            .foregroundStyle(Palette.textTertiary)
                    }.buttonStyle(.iconPress)
                }
                .padding(.horizontal, 16).padding(.vertical, 11)
                .glassEffect(Glass.regular, in: Capsule())
                .overlay(Capsule().strokeBorder(Palette.wellStroke, lineWidth: 1))
                .shadow(color: .black.opacity(0.28), radius: 18, y: 8)
                .padding(.bottom, 22)
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.spring(response: 0.34, dampingFraction: 0.82), value: undo.toast?.id)
        .allowsHitTesting(undo.toast != nil)
    }
}

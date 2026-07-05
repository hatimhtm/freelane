import SwiftUI
import SwiftData
import AppKit

/// Pick a timestamped backup, preview what it holds, and restore it. The restore is staged and
/// applied at the next launch (safe swap), and the CURRENT store is auto-backed-up first — so a
/// restore is itself reversible.
struct RestoreBackupSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var items: [DataBackup.Item] = []
    @State private var selected: DataBackup.Item?
    @State private var preview: DataBackup.Preview?
    @State private var loadingPreview = false
    @State private var confirm = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Restore from backup").font(Typo.title(20)).foregroundStyle(Palette.textPrimary)
                    Text("Your current data is backed up first, so this is reversible.")
                        .font(.system(size: 11)).foregroundStyle(Palette.textTertiary)
                }
                Spacer()
                Button { dismiss() } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(Palette.textTertiary) }
                    .buttonStyle(.iconPress)
            }
            .padding(20)

            Divider().overlay(Palette.hairline)

            if items.isEmpty {
                EmptyStateCard(icon: "externaldrive", title: "No backups yet",
                               message: "Use “Back up now” in Settings → Storage to create your first restore point.")
                    .frame(maxHeight: .infinity)
            } else {
                ScrollView {
                    LazyVStack(spacing: 7) {
                        ForEach(items) { item in
                            backupRow(item)
                        }
                    }.padding(16)
                }
            }

            if let p = preview, let sel = selected {
                Divider().overlay(Palette.hairline)
                VStack(alignment: .leading, spacing: 8) {
                    Text("This backup contains")
                        .font(.system(size: 11, weight: .semibold)).foregroundStyle(Palette.textTertiary)
                    Text("\(p.spends) spends · \(p.payments) payments · \(p.projects) projects · \(p.clients) clients · \(p.wallets) wallets")
                        .font(.system(size: 13, weight: .medium)).foregroundStyle(Palette.textPrimary)
                    Button(role: .destructive) { confirm = true } label: {
                        Label("Restore “\(sel.name)”", systemImage: "arrow.counterclockwise")
                    }
                    .buttonStyle(.glassProminent).tint(Palette.warning)
                    .confirmationDialog("Replace all current data with this backup?", isPresented: $confirm) {
                        Button("Back up current & restore", role: .destructive) { doRestore(sel) }
                        Button("Cancel", role: .cancel) {}
                    } message: {
                        Text("Freelane will quit to apply the restore. Your current data is saved as a “pre-restore” backup first.")
                    }
                }
                .padding(20)
            }
        }
        .frame(width: 540, height: 560)
        .flagshipSheet()
        .onAppear { items = DataBackup.list() }
    }

    @ViewBuilder private func backupRow(_ item: DataBackup.Item) -> some View {
        let isSel = selected?.id == item.id
        Button {
            selected = item; preview = nil; loadingPreview = true
            DispatchQueue.global(qos: .userInitiated).async {
                let p = DataBackup.preview(item.url)
                DispatchQueue.main.async { if selected?.id == item.id { preview = p; loadingPreview = false } }
            }
        } label: {
            HStack(spacing: 12) {
                Image(systemName: "externaldrive.fill").font(.system(size: 14))
                    .foregroundStyle(isSel ? Palette.teal : Palette.textTertiary)
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.date.formatted(date: .abbreviated, time: .shortened))
                        .font(.system(size: 13, weight: .medium)).foregroundStyle(Palette.textPrimary)
                    Text(item.name.replacingOccurrences(of: "Freelane-", with: "") + " · \(String(format: "%.1f", item.sizeMB)) MB")
                        .font(.system(size: 10)).foregroundStyle(Palette.textTertiary)
                }
                Spacer()
                if isSel && loadingPreview { ProgressView().controlSize(.small) }
                else if isSel { Image(systemName: "checkmark.circle.fill").foregroundStyle(Palette.teal) }
            }
            .padding(.horizontal, 12).padding(.vertical, 10)
            .background(isSel ? Palette.teal.opacity(0.12) : Palette.card, in: RoundedRectangle(cornerRadius: Radii.field, style: .continuous))
        }
        .buttonStyle(.cardPress)
    }

    private func doRestore(_ item: DataBackup.Item) {
        if DataBackup.stageRestore(from: item.url) {
            // Applied at next launch (before the store opens). Quit so the user reopens cleanly.
            NSApp.terminate(nil)
        }
    }
}

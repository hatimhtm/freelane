import SwiftUI

/// The one empty-state pattern used everywhere: glyph + title + a line of guidance + an
/// optional call-to-action. Replaces the ad-hoc "Nothing here" texts (only PeopleView had a
/// real empty state before).
struct EmptyStateCard: View {
    let icon: String
    let title: String
    let message: String
    var actionLabel: String? = nil
    var action: (() -> Void)? = nil

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 34, weight: .light))
                .foregroundStyle(Palette.textTertiary)
                .frame(width: 70, height: 70)
                .background(Palette.card.opacity(0.6), in: Circle())
            Text(title)
                .font(Typo.title(17)).foregroundStyle(Palette.textPrimary)
            Text(message)
                .font(.system(size: 12.5)).foregroundStyle(Palette.textTertiary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 320)
            if let actionLabel, let action {
                Button(actionLabel, action: action)
                    .buttonStyle(.glassProminent).tint(Palette.teal).controlSize(.regular)
                    .padding(.top, 2)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 36)
    }
}

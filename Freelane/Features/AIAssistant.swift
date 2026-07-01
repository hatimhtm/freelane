import SwiftUI

/// Floating circular AI button present on every page (nav/control layer → real glass).
struct FloatingAIButton: View {
    var page: Feature
    @State private var open = false

    var body: some View {
        Button { open = true } label: {
            Image(systemName: "sparkles")
                .font(.system(size: 19, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 54, height: 54)
        }
        .buttonStyle(.iconPress)
        .glassEffect(Glass.regular.tint(Palette.azure.opacity(0.28)), in: .circle)
        .shadow(color: .black.opacity(0.4), radius: 16, y: 7)
        .sheet(isPresented: $open) { AIChatSheet(page: page) }
        .help("Ask the assistant about \(page.title)")
    }
}

private struct ChatMsg: Identifiable { let id = UUID(); let mine: Bool; let text: String }

struct AIChatSheet: View {
    var page: Feature
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var context
    @State private var ai = AIManager()
    @State private var input = ""
    @State private var messages: [ChatMsg] = []
    @State private var busy = false

    private var pills: [String] {
        switch page {
        case .dashboard, .today: return ["How am I doing this month?", "What should I watch out for?", "Can I afford a ₱3,000 purchase?"]
        case .spending: return ["Where did most of my money go?", "Any unusual spending?", "How do I cut back?"]
        case .payments, .wallets: return ["Best way to withdraw from Wise?", "Which wallet is lowest?", "Summarize my fees"]
        case .projects: return ["What's overdue?", "Who owes me the most?"]
        case .sadaka: return ["What should I give this month?", "How is my giving trending?"]
        default: return ["Give me a quick summary", "What needs my attention?"]
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 10) {
                Image(systemName: "sparkles").foregroundStyle(Palette.azure)
                VStack(alignment: .leading, spacing: 1) {
                    Text("Assistant").font(Typo.title(16)).foregroundStyle(Palette.textPrimary)
                    Text("on \(page.title)").font(.system(size: 11)).foregroundStyle(Palette.textTertiary)
                }
                Spacer()
                Button { dismiss() } label: {
                    Image(systemName: "xmark.circle.fill").font(.system(size: 20)).foregroundStyle(Palette.textTertiary)
                }
                .buttonStyle(.iconPress).keyboardShortcut(.cancelAction)
            }
            .padding(18)

            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    if messages.isEmpty {
                        Text("Ask me anything about \(page.title.lowercased()). I use your local data.")
                            .font(.system(size: 12)).foregroundStyle(Palette.textTertiary)
                        FlowPills(pills: pills) { send($0) }
                    }
                    ForEach(messages) { m in
                        HStack {
                            if m.mine { Spacer(minLength: 40) }
                            Text(m.text).font(.system(size: 13)).foregroundStyle(m.mine ? Palette.ink : Palette.textPrimary)
                                .padding(.horizontal, 12).padding(.vertical, 9)
                                .background(m.mine ? AnyShapeStyle(Palette.azure) : AnyShapeStyle(Palette.card.opacity(0.9)),
                                            in: RoundedRectangle(cornerRadius: Radii.field, style: .continuous))
                            if !m.mine { Spacer(minLength: 40) }
                        }
                    }
                    if busy { ProgressView().controlSize(.small) }
                }
                .padding(.horizontal, 18)
            }

            Divider().overlay(Palette.hairline)
            HStack(spacing: 10) {
                TextField("Message…", text: $input).textFieldStyle(GlassFieldStyle()).onSubmit { send(input) }
                Button { send(input) } label: { Image(systemName: "arrow.up.circle.fill").font(.system(size: 24)).foregroundStyle(Palette.azure) }
                    .buttonStyle(.iconPress).disabled(input.isEmpty || busy)
            }
            .padding(14)
        }
        .frame(width: 460, height: 560)
        .flagshipSheet()
    }

    private func send(_ text: String) {
        let q = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty, !busy else { return }
        let priorTurns = messages.map { (mine: $0.mine, text: $0.text) }   // capture BEFORE appending this one
        messages.append(ChatMsg(mine: true, text: q))
        input = ""
        if !ai.isReady {
            messages.append(ChatMsg(mine: false, text: "Turn on Apple Intelligence or add your Gemini API key in Settings → AI to enable answers."))
            return
        }
        busy = true
        Task {
            let reply = await Brain.answer(context, ai: ai, page: page.title, question: q, history: priorTurns)
            await MainActor.run { messages.append(ChatMsg(mine: false, text: reply)); busy = false }
        }
    }
}

/// Simple wrapping pill row.
private struct FlowPills: View {
    var pills: [String]
    var onTap: (String) -> Void
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(pills, id: \.self) { p in
                Button { onTap(p) } label: {
                    Text(p).font(.system(size: 12, weight: .medium)).foregroundStyle(Palette.azure)
                        .padding(.horizontal, 11).padding(.vertical, 7)
                        .background(Palette.azure.opacity(0.14), in: Capsule())
                        .overlay(Capsule().strokeBorder(Palette.azure.opacity(0.3), lineWidth: 0.7))
                }.buttonStyle(.plain)
            }
        }
    }
}

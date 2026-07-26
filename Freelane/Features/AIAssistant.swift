import SwiftUI

/// Floating circular AI button present on every page (nav/control layer → real glass).
struct FloatingAIButton: View {
    var page: Feature
    @State private var open = false

    @State private var hovering = false

    var body: some View {
        // A 54pt orb parked over the bottom-right corner of every page was covering real content —
        // the "Set budgets" button on Spending, the income chart on Insights. It's smaller now, sits
        // quieter, and expands to name itself on hover, so it earns its place instead of blocking a
        // corner of every screen permanently.
        Button { open = true } label: {
            HStack(spacing: 7) {
                Image(systemName: "sparkles")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Palette.azure)
                if hovering {
                    Text("Ask")
                        .font(.system(size: 12.5, weight: .semibold))
                        .foregroundStyle(Palette.textPrimary)
                }
            }
            .padding(.horizontal, hovering ? 14 : 12)
            .frame(height: 38)
        }
        .buttonStyle(.iconPress)
        .glassEffect(Glass.regular.tint(Palette.azure.opacity(0.20)), in: .capsule)
        .shadow(color: .black.opacity(0.18), radius: 10, y: 4)
        .onHover { hovering = $0 }
        .animation(.easeOut(duration: 0.16), value: hovering)
        .sheet(isPresented: $open) { AIChatSheet(page: page) }
        .help("Ask the assistant about \(page.title)")
    }
}

private struct ChatMsg: Identifiable {
    let id = UUID()
    let mine: Bool
    let text: String
    /// A failure is NOT something the assistant said. Rendering "I couldn't reach a model" as a
    /// normal reply made an app error indistinguishable from an answer, left it in the transcript
    /// forever, and offered no way to retry.
    var isError = false
}

struct AIChatSheet: View {
    var page: Feature
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var context
    @State private var ai = AIManager()
    @State private var input = ""
    @State private var messages: [ChatMsg] = []
    @State private var busy = false
    @State private var job: Task<Void, Never>?
    @FocusState private var composerFocused: Bool

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

            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        if messages.isEmpty {
                            VStack(spacing: 16) {
                                Text("What do you want to know about \(page.title.lowercased())?")
                                    .font(Typo.title(17)).foregroundStyle(Palette.textPrimary)
                                    .multilineTextAlignment(.center)
                                FlowPills(pills: pills) { send($0) }
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.top, 40)
                        }
                        ForEach(Array(messages.enumerated()), id: \.element.id) { i, m in
                            // 6pt within a turn, 18pt between turns, so the transcript has rhythm
                            // instead of one uniform gap that made it read as a log.
                            let newTurn = i > 0 && messages[i - 1].mine != m.mine
                            if m.isError {
                                HStack(alignment: .top, spacing: 8) {
                                    Image(systemName: "exclamationmark.triangle.fill")
                                        .font(.system(size: 11)).foregroundStyle(Palette.warning)
                                    Text(m.text).font(.system(size: 11.5)).foregroundStyle(Palette.textSecondary)
                                        .fixedSize(horizontal: false, vertical: true)
                                    Spacer(minLength: 0)
                                }
                                .padding(.top, newTurn ? 18 : 6)
                            } else {
                                HStack {
                                    if m.mine { Spacer(minLength: 40) }
                                    Text(m.text)
                                        .font(.system(size: 13))
                                        .textSelection(.enabled)
                                        .foregroundStyle(m.mine ? Palette.ink : Palette.textPrimary)
                                        .padding(.horizontal, 12).padding(.vertical, 9)
                                        .background {
                                            let shape = RoundedRectangle(cornerRadius: Radii.field, style: .continuous)
                                            if m.mine { shape.fill(Palette.azure) }
                                            else {
                                                // The assistant bubble was Palette.card at 90% over
                                                // Palette.ink — about a 1.05:1 contrast ratio, i.e.
                                                // functionally invisible. It needs the hairline the
                                                // rest of the app's wells have.
                                                ZStack {
                                                    shape.fill(Palette.wellFill)
                                                    shape.strokeBorder(Palette.wellStroke, lineWidth: 0.8)
                                                }
                                            }
                                        }
                                        .contextMenu {
                                            Button("Copy") {
                                                NSPasteboard.general.clearContents()
                                                NSPasteboard.general.setString(m.text, forType: .string)
                                            }
                                        }
                                    if !m.mine { Spacer(minLength: 40) }
                                }
                                .padding(.top, newTurn ? 18 : 6)
                            }
                        }
                        if busy { ThinkingBubble(onStop: { job?.cancel(); job = nil; busy = false }).padding(.top, 18) }
                        Color.clear.frame(height: 1).id("end")
                    }
                    .padding(.horizontal, 18).padding(.bottom, 12)
                }
                .defaultScrollAnchor(.bottom)
                // Without this the sheet simply never moved: you asked a question, waited, and the
                // reply landed below the fold on a 560pt sheet.
                .onChange(of: messages.count) { _, _ in
                    withAnimation(Motion.list) { proxy.scrollTo("end", anchor: .bottom) }
                }
                .onChange(of: busy) { _, _ in
                    withAnimation(Motion.list) { proxy.scrollTo("end", anchor: .bottom) }
                }
            }

            Divider().overlay(Palette.hairline)
            HStack(spacing: 10) {
                TextField("Ask about your money…", text: $input, axis: .vertical)
                    .lineLimit(1...5)
                    .fieldWell()
                    .focused($composerFocused)
                    .onSubmit { send(input) }
                Button { send(input) } label: {
                    Image(systemName: "arrow.up.circle.fill").font(.system(size: 24)).foregroundStyle(Palette.azure)
                }
                .buttonStyle(.iconPress)
                // Trimmed, because `send` trims too — three spaces used to light the button up and
                // then do nothing when pressed.
                .disabled(input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || busy)
            }
            .padding(14)
            HStack(spacing: 5) {
                Image(systemName: "lock.fill").font(.system(size: 8.5)).foregroundStyle(Palette.textTertiary)
                Text("Answers come from a model running on this Mac.")
                    .font(.system(size: 10)).foregroundStyle(Palette.textTertiary)
                Spacer()
            }
            .padding(.horizontal, 16).padding(.bottom, 12)
        }
        .frame(width: 480, height: 580)
        // Deliberately NOT `flagshipSheet()`: that applies click-outside-to-close, and this is the
        // only sheet in the app holding unsaved free-form text. A stray click on the sidebar used
        // to wipe the whole conversation with no warning and no way back.
        .background(AppBackground())
        .appAppearance()
        .sheetEntrance()
        .onAppear { composerFocused = true }
    }

    private func send(_ text: String) {
        let q = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty, !busy else { return }
        let priorTurns = messages.map { (mine: $0.mine, text: $0.text) }   // capture BEFORE appending this one
        messages.append(ChatMsg(mine: true, text: q))
        input = ""
        if !ai.isReady {
            messages.append(ChatMsg(mine: false, text: ai.unavailableReason, isError: true))
            return
        }
        busy = true
        job = Task {
            let reply = await Brain.answer(context, ai: ai, page: page.title, question: q, history: priorTurns)
            if Task.isCancelled { return }
            await MainActor.run {
                messages.append(ChatMsg(mine: false, text: reply))
                busy = false; job = nil
            }
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

/// What "thinking" looks like when a local 8B model can take thirty seconds.
///
/// It was a bare 16pt spinner flush-left, detached from the conversation, with no way to stop.
/// Thirty seconds of that is the texture of an internal tool. This sits where the reply will
/// appear, in the same shape, and offers a way out once the wait stops being reasonable.
private struct ThinkingBubble: View {
    let onStop: () -> Void
    @State private var phase = 0.0
    @State private var elapsed = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            HStack(spacing: 4) {
                ForEach(0..<3, id: \.self) { i in
                    Circle()
                        .fill(Palette.textTertiary)
                        .frame(width: 5, height: 5)
                        .opacity(reduceMotion ? 0.6 : 0.35 + 0.65 * pulse(i))
                }
            }
            .padding(.horizontal, 13).padding(.vertical, 11)
            .background {
                let shape = RoundedRectangle(cornerRadius: Radii.field, style: .continuous)
                ZStack {
                    shape.fill(Palette.wellFill)
                    shape.strokeBorder(Palette.wellStroke, lineWidth: 0.8)
                }
            }
            if elapsed >= 4 {
                Text("Still thinking…").font(.system(size: 11)).foregroundStyle(Palette.textTertiary)
                Button("Stop", action: onStop).buttonStyle(.glass).controlSize(.small)
            }
            Spacer(minLength: 0)
        }
        .task {
            guard !reduceMotion else { return }
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(200))
                phase += 0.2
                elapsed = Int(phase)
            }
        }
    }

    private func pulse(_ i: Int) -> Double {
        let t = phase * 2.6 - Double(i) * 0.5
        return (sin(t) + 1) / 2
    }
}

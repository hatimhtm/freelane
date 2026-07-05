import SwiftUI

/// In-app Quran reader: pick a surah, read Arabic + translation, and your position is remembered.
struct QuranReaderSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var surahs: [Surah] = []
    @State private var selected: Surah?
    @State private var ayahs: [Ayah] = []
    @State private var loading = false
    @State private var query = ""
    @AppStorage("quran.showEnglish") private var showEnglish = false

    /// Western digits → Arabic-Indic, for traditional end-of-ayah markers (۝١).
    private func arabicNumerals(_ n: Int) -> String {
        let map: [Character: Character] = ["0": "٠", "1": "١", "2": "٢", "3": "٣", "4": "٤",
                                           "5": "٥", "6": "٦", "7": "٧", "8": "٨", "9": "٩"]
        return String(String(n).map { map[$0] ?? $0 })
    }

    private var filtered: [Surah] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return surahs }
        return surahs.filter { $0.englishName.lowercased().contains(q) || "\($0.number)" == q }
    }

    var body: some View {
        HSplitView {
            // Surah list
            VStack(spacing: 0) {
                HStack {
                    Text("Qur'an").font(Typo.title(18)).foregroundStyle(Palette.textPrimary)
                    Spacer()
                    Button { dismiss() } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(Palette.textTertiary) }.buttonStyle(.iconPress)
                }.padding(14)
                SearchField(text: $query, placeholder: "Search surah").padding(.horizontal, 12)
                ScrollView {
                    LazyVStack(spacing: 2) {
                        ForEach(filtered) { s in
                            Button { open(s) } label: { surahRow(s) }.buttonStyle(.plain)
                        }
                    }.padding(10)
                }
            }
            .frame(minWidth: 220, maxWidth: 280)
            .background(Palette.ink2.opacity(0.6))

            // Reader
            Group {
                if loading {
                    VStack { ProgressView(); Text("Loading…").font(.system(size: 12)).foregroundStyle(Palette.textTertiary).padding(.top, 6) }
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let s = selected {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 16) {
                            HStack(alignment: .top) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(s.name).font(.system(size: 28, weight: .bold)).foregroundStyle(Palette.textPrimary)
                                    Text("\(s.englishName) · \(s.englishTranslation) · \(s.ayahs) ayahs").font(.system(size: 12)).foregroundStyle(Palette.textTertiary)
                                }
                                Spacer()
                                Toggle(isOn: $showEnglish) { Text("English").font(.system(size: 11.5)) }
                                    .toggleStyle(.button).tint(Palette.teal).controlSize(.small)
                            }
                            if showEnglish {
                                // Study mode: each ayah with its translation.
                                ForEach(ayahs) { a in
                                    VStack(alignment: .trailing, spacing: 6) {
                                        HStack(alignment: .top) {
                                            Text("\(a.numberInSurah)").font(.system(size: 10, weight: .bold)).foregroundStyle(Palette.teal)
                                                .frame(width: 22, height: 22).background(Palette.teal.opacity(0.14), in: Circle())
                                            Spacer()
                                            Text(a.arabic).font(.system(size: 24, weight: .medium)).foregroundStyle(Palette.textPrimary)
                                                .multilineTextAlignment(.trailing).environment(\.layoutDirection, .rightToLeft).lineSpacing(8)
                                        }
                                        Text(a.translation).font(.system(size: 13)).foregroundStyle(Palette.textSecondary)
                                            .frame(maxWidth: .infinity, alignment: .leading)
                                        Button("Mark as my position") { QuranService.setPosition(surah: s.number, ayah: a.numberInSurah) }
                                            .buttonStyle(.glass).controlSize(.mini)
                                        Divider().overlay(Palette.hairline)
                                    }
                                }
                            } else {
                                // Reading mode: full Arabic. Each ayah is its OWN right-to-left block so the
                                // end-of-ayah number stays anchored to its verse (one giant concatenated RTL
                                // string makes the bidi algorithm scramble the markers + break words).
                                ForEach(ayahs) { a in
                                    Text("\(a.arabic)  \(Text("﴿\(arabicNumerals(a.numberInSurah))﴾").font(.system(size: 19)).foregroundStyle(Palette.teal))")
                                        .font(.system(size: 27, weight: .medium)).foregroundStyle(Palette.textPrimary)
                                        .environment(\.layoutDirection, .rightToLeft)
                                        .multilineTextAlignment(.trailing)
                                        .lineSpacing(14)
                                        .frame(maxWidth: .infinity, alignment: .trailing)
                                        .textSelection(.enabled)
                                        .padding(.vertical, 3)
                                        .contentShape(Rectangle())
                                        .onTapGesture { QuranService.setPosition(surah: s.number, ayah: a.numberInSurah) }
                                }
                                Text("Tap any ayah to mark it as your position.")
                                    .font(.system(size: 10.5)).foregroundStyle(Palette.textTertiary)
                            }
                        }.padding(20)
                    }
                } else {
                    VStack(spacing: 8) {
                        Image(systemName: "book.closed").font(.system(size: 34)).foregroundStyle(Palette.textTertiary)
                        Text("Pick a surah to read").font(.system(size: 13)).foregroundStyle(Palette.textTertiary)
                    }.frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .frame(minWidth: 380)
        }
        .frame(width: 760, height: 620)
        .flagshipSheet()
        .background { Button("") { dismiss() }.keyboardShortcut(.cancelAction).opacity(0) }
        .task {
            surahs = await QuranService.surahList()
            if let resume = surahs.first(where: { $0.number == QuranService.surah }) { open(resume) }
        }
    }

    private func surahRow(_ s: Surah) -> some View {
        let isSel = selected?.number == s.number
        return HStack(spacing: 10) {
            Text("\(s.number)").font(.system(size: 11, weight: .semibold)).foregroundStyle(Palette.textTertiary).frame(width: 24)
            VStack(alignment: .leading, spacing: 1) {
                Text(s.englishName).font(.system(size: 12.5, weight: .medium)).foregroundStyle(Palette.textPrimary)
                Text("\(s.ayahs) ayahs").font(.system(size: 10)).foregroundStyle(Palette.textTertiary)
            }
            Spacer()
            Text(s.name).font(.system(size: 14)).foregroundStyle(Palette.textSecondary)
        }
        .padding(.horizontal, 10).padding(.vertical, 7)
        .background(isSel ? Palette.teal.opacity(0.14) : .clear, in: RoundedRectangle(cornerRadius: Radii.row, style: .continuous))
    }

    private func open(_ s: Surah) {
        selected = s; loading = true; ayahs = []
        QuranService.markRead(surah: s.number)
        Task {
            let a = await QuranService.ayahs(surah: s.number)
            await MainActor.run { ayahs = a; loading = false }
        }
    }
}

import SwiftUI

// A small Material 3 form kit for the sheets on Bills and Work: a white dialog surface, labelled wells,
// a primary focus outline, Cancel as a text button and the one filled button for the sheet's main action.

enum BillsWorkSheetStyle {
    /// Field wells sit one step darker than the dialog in both appearances (the dark dialog is already
    /// surface-container-high, the colour of the ordinary well).
    static let field = Surface.well2
}

/// The sheet's frame: title, fields, then Cancel and the main action (Return saves, Esc cancels).
struct BillsWorkSheet<Content: View>: View {
    let title: String
    let action: String
    let canSave: Bool
    let onCancel: () -> Void
    let onSave: () -> Void
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(title).role(.dialog)
            VStack(alignment: .leading, spacing: 16) { content }
                .padding(.top, 20)
            HStack(spacing: 8) {
                Spacer()
                M3Button(title: "Cancel", kind: .text, action: onCancel)
                    .keyboardShortcut(.cancelAction)
                M3Button(title: action, kind: .filled, action: onSave)
                    .keyboardShortcut(.defaultAction)
                    .disabled(!canSave)
                    .opacity(canSave ? 1 : 0.38)
                    .animation(Flow.effects, value: canSave)
            }
            .padding(.top, 24)
        }
        .padding(24)
        .frame(width: 440)
        .background(Surface.dialog)
    }
}

/// A label above its control.
struct BillsWorkField<Content: View>: View {
    let label: String
    @ViewBuilder var content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).role(.sub, MD.onSurfaceVariant)
            content
        }
    }
}

/// A 48pt text well; its outline turns primary while you type.
struct BillsWorkInput: View {
    let placeholder: String
    @Binding var text: String
    var prefix: String? = nil
    var autofocus = false
    @FocusState private var focused: Bool

    var body: some View {
        HStack(spacing: 4) {
            if let prefix {
                Text(prefix).font(FS.font(15, 600, rond: 100)).foregroundStyle(MD.onSurfaceVariant)
            }
            TextField("", text: $text, prompt: Text(placeholder).foregroundStyle(MD.onSurfaceVariant.opacity(0.6)))
                .textFieldStyle(.plain)
                .font(FS.font(15, 400))
                .foregroundStyle(MD.onSurface)
                .focused($focused)
        }
        .padding(.horizontal, 16)
        .frame(height: 48)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(BillsWorkSheetStyle.field))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(focused ? MD.primary : .clear, lineWidth: 2))
        .animation(Flow.effects, value: focused)
        .contentShape(Rectangle())
        .onTapGesture { focused = true }
        .onAppear { if autofocus { DispatchQueue.main.async { focused = true } } }
    }
}

/// A pop-up menu drawn as a well: the current choice, and a chevron.
struct BillsWorkMenu<Items: View, Leading: View>: View {
    let title: String
    @ViewBuilder var leading: Leading
    @ViewBuilder var items: Items

    var body: some View {
        Menu {
            items
        } label: {
            HStack(spacing: 10) {
                leading
                Text(title).font(FS.font(15, 400)).foregroundStyle(MD.onSurface).lineLimit(1)
                Spacer(minLength: 8)
                Icon(Sym.expandMore, size: 20).foregroundStyle(MD.onSurfaceVariant)
            }
            .padding(.leading, 12).padding(.trailing, 14)
            .frame(height: 48)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(BillsWorkSheetStyle.field))
            .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .menuIndicator(.hidden)
    }
}

/// Parses money the way people type it: "1,500", " 2090 ", "180.50".
enum BillsWorkAmount {
    static func parse(_ s: String) -> Double? {
        let t = s.replacingOccurrences(of: ",", with: "").replacingOccurrences(of: " ", with: "")
            .replacingOccurrences(of: "₱", with: "")
        guard let v = Double(t), v.isFinite, v >= 0 else { return nil }
        return v
    }
    /// "2500", "2500.5": never "2500.0".
    static func edit(_ v: Double) -> String {
        v.truncatingRemainder(dividingBy: 1) == 0 ? String(format: "%.0f", v) : String(format: "%.2f", v)
    }
}

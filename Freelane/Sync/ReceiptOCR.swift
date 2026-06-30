import Foundation
@preconcurrency import Vision
import AppKit

/// On-device receipt OCR (Apple Vision — no network, private). Pick an image/PDF, and it
/// best-guesses the total and the vendor to pre-fill Add Spend. Heuristic, always editable.
enum ReceiptOCR {
    struct Result { var amount: Double?; var vendor: String?; var lines: [String] }

    /// Open a file picker, then OCR the chosen image. Completion is delivered on the main actor.
    @MainActor
    static func pickAndScan(completion: @escaping (Result?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.image, .pdf]
        panel.allowsMultipleSelection = false
        panel.prompt = "Scan"
        panel.message = "Pick a receipt photo or PDF"
        panel.begin { resp in
            guard resp == .OK, let url = panel.url else { completion(nil); return }
            recognize(url: url, completion: completion)
        }
    }

    /// NOT main-actor: the Vision work runs on a background queue; the completion is hopped
    /// back to the main thread so callers can touch UI directly.
    nonisolated static func recognize(url: URL, completion: @escaping (Result?) -> Void) {
        guard let img = NSImage(contentsOf: url),
              let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
            DispatchQueue.main.async { completion(nil) }; return
        }
        // Build + run the request entirely inside the work block (nothing non-Sendable crosses
        // the queue boundary), then read its results synchronously after perform().
        DispatchQueue.global(qos: .userInitiated).async {
            let request = VNRecognizeTextRequest()
            request.recognitionLevel = .accurate
            request.usesLanguageCorrection = true
            try? VNImageRequestHandler(cgImage: cg, options: [:]).perform([request])
            let lines = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
            let result = parse(lines)
            DispatchQueue.main.async { completion(result) }
        }
    }

    private static func parse(_ lines: [String]) -> Result {
        // Vendor: first substantive top line that isn't a header WORD (whole-word match, so
        // "Receipts & More" isn't skipped just for containing "receipt").
        let skip: Set<String> = ["receipt", "invoice", "official", "tax", "vat", "cash", "change", "total"]
        let vendor = lines.prefix(6).first { line in
            let l = line.trimmingCharacters(in: .whitespaces)
            let words = Set(l.lowercased().split { !$0.isLetter }.map(String.init))
            return l.count >= 3 && l.contains(where: { $0.isLetter }) && words.isDisjoint(with: skip)
        }
        // Amount: prefer a number on/after a "total" line; else the largest number on the receipt.
        var largest: Double?
        var nearTotal: Double?
        for (i, line) in lines.enumerated() {
            let isTotal = line.lowercased().contains("total") && !line.lowercased().contains("subtotal")
            let prevTotal = i > 0 && lines[i - 1].lowercased().contains("total")
            for n in numbers(in: line) {
                if largest == nil || n > largest! { largest = n }
                if (isTotal || prevTotal), nearTotal == nil || n > nearTotal! { nearTotal = n }
            }
        }
        return Result(amount: nearTotal ?? largest,
                      vendor: vendor?.trimmingCharacters(in: .whitespaces), lines: lines)
    }

    private static func numbers(in line: String) -> [Double] {
        var out: [Double] = []
        guard let re = try? NSRegularExpression(pattern: #"[0-9][0-9,]*\.?[0-9]{0,2}"#) else { return out }
        let ns = line as NSString
        for m in re.matches(in: line, range: NSRange(location: 0, length: ns.length)) {
            let s = ns.substring(with: m.range).replacingOccurrences(of: ",", with: "")
            if let v = Double(s), v > 0 { out.append(v) }   // keep sub-₱1 prices (0.99 etc.)
        }
        return out
    }
}

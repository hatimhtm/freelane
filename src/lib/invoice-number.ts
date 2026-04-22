// Build next invoice number from a format string like "YYYY-NNN" or "INV-YYYY-NNN".
// Counts existing invoices for the current year and picks the next sequence.

export function buildInvoiceNumber(
  format: string,
  existing: { invoice_number: string; issue_date: string }[],
  now: Date = new Date(),
): string {
  const year = now.getFullYear();
  const ofThisYear = existing.filter((x) => new Date(x.issue_date).getFullYear() === year);

  const sequencePattern = /N+/;
  const match = format.match(sequencePattern);
  const sequenceLength = match?.[0].length ?? 3;

  const maxSeq = ofThisYear.reduce((max, inv) => {
    const num = extractSequence(inv.invoice_number, format);
    return num > max ? num : max;
  }, 0);

  const next = maxSeq + 1;
  return format
    .replace(/YYYY/g, String(year))
    .replace(/YY/g, String(year).slice(-2))
    .replace(sequencePattern, String(next).padStart(sequenceLength, "0"));
}

function extractSequence(invoiceNumber: string, format: string): number {
  // Turn the format into a regex, capturing the NNN part.
  const regexSource = format
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/YYYY/, "\\d{4}")
    .replace(/YY/, "\\d{2}")
    .replace(/N+/, "(\\d+)");
  const match = invoiceNumber.match(new RegExp("^" + regexSource + "$"));
  return match ? Number(match[1]) : 0;
}

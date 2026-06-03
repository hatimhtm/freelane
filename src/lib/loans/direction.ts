// Direction helpers for the bidirectional loans workflow. Pure
// utilities — safe to import from client AND server modules. Kept
// separate from queries.ts (which is "server-only") so the spending
// list + loan-detail sheet can normalize loan direction values in the
// browser without dragging the auth-scoped reader into the bundle.

export type LoanDirectionView = "given" | "received";

const NEW_GIVEN = new Set(["given", "lent"]);
const NEW_RECEIVED = new Set(["received", "borrowed"]);

export function normalizeDirection(
  raw: string | null | undefined,
): LoanDirectionView | null {
  if (!raw) return null;
  if (NEW_GIVEN.has(raw)) return "given";
  if (NEW_RECEIVED.has(raw)) return "received";
  return null;
}

// Shared status label so the spending-list loan badge + the loan detail
// sheet StatusPill + the entity-detail loan section never drift in copy.
// 'partial' and 'partially_returned' collapse to "partial"; 'returned'
// and 'closed' collapse to "returned" (closed is the legacy synonym).
export function loanStatusLabel(status: string): string {
  switch (status) {
    case "open":
      return "open";
    case "partial":
    case "partially_returned":
      return "partial";
    case "returned":
    case "closed":
      return "returned";
    case "forgiven":
      return "forgiven";
    case "written_off":
      return "written off";
    default:
      return status;
  }
}

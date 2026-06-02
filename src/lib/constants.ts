// Single-user Freelane — the password gate authenticates against this fixed
// hidden user in Supabase Auth. Email is a non-secret constant; the password
// is what the user types on the login screen.
export const HIDDEN_OWNER_EMAIL = "owner@freelane.local";

export const APP_NAME = "Freelane";
export const APP_TAGLINE = "Track every freelance coin.";

export const BASE_CURRENCY_FALLBACK = "PHP";

// `sortKey` + `sortDir` drive per-column ordering in the kanban. Unpaid /
// Partially-paid sort by created_at ASC so stalled projects float up.
// Paid sorts by "completed_at" DESC — but the kanban resolves that key via
// `paidSince()` (project.completed_at → most-recent payment.paid_at →
// project.updated_at), so the sort order and the PAID_VISIBLE_DAYS cutoff
// share a single source of truth. "completed_at" here is the conceptual
// column, not literally the DB field.
export const KANBAN_COLUMNS = [
  { id: "unpaid",          label: "Unpaid",          tone: "neutral", sortKey: "created_at",   sortDir: "asc"  },
  { id: "partially_paid",  label: "Partially paid",  tone: "cyan",    sortKey: "created_at",   sortDir: "asc"  },
  { id: "paid",            label: "Paid",            tone: "success", sortKey: "completed_at", sortDir: "desc" },
] as const;

export type KanbanColumnId = typeof KANBAN_COLUMNS[number]["id"];
export type KanbanColumnSortKey = typeof KANBAN_COLUMNS[number]["sortKey"];
export type KanbanColumnSortDir = typeof KANBAN_COLUMNS[number]["sortDir"];

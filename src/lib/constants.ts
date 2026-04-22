// Single-user Freelane — the password gate authenticates against this fixed
// hidden user in Supabase Auth. Email is a non-secret constant; the password
// is what the user types on the login screen.
export const HIDDEN_OWNER_EMAIL = "owner@freelane.local";

export const APP_NAME = "Freelane";
export const APP_TAGLINE = "Track every freelance coin.";

export const BASE_CURRENCY_FALLBACK = "PHP";

export const KANBAN_COLUMNS = [
  { id: "unpaid",          label: "Unpaid",          tone: "neutral" },
  { id: "partially_paid",  label: "Partially paid",  tone: "cyan"    },
  { id: "paid",            label: "Paid",            tone: "success" },
] as const;

export type KanbanColumnId = typeof KANBAN_COLUMNS[number]["id"];

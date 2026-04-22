// Single-user Freelane — the password gate authenticates against this fixed
// hidden user in Supabase Auth. Email is a non-secret constant; the password
// is what the user types on the login screen.
export const HIDDEN_OWNER_EMAIL = "owner@freelane.local";

export const APP_NAME = "Freelane";
export const APP_TAGLINE = "Track every freelance coin.";

export const BASE_CURRENCY_FALLBACK = "PHP";

export const KANBAN_COLUMNS = [
  { id: "quoted",          label: "Quoted",          tone: "neutral" },
  { id: "in_progress",     label: "In progress",     tone: "brand"   },
  { id: "invoiced",        label: "Invoiced",        tone: "amber"   },
  { id: "partially_paid",  label: "Partial",         tone: "cyan"    },
  { id: "paid",            label: "Paid",            tone: "success" },
  { id: "overdue",         label: "Overdue",         tone: "danger"  },
] as const;

export type KanbanColumnId = typeof KANBAN_COLUMNS[number]["id"];

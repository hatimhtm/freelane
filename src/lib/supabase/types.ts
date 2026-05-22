// Hand-written types for the `finance` schema.
// Can be regenerated via `pnpm dlx supabase gen types --schema finance` later.

export type ProjectStatus =
  | "unpaid"
  | "partially_paid"
  | "paid"
  | "archived";

export type InvoiceStatus = "draft" | "issued" | "sent" | "paid" | "void";

export type PaymentMethodKind =
  | "bank"
  | "wallet"
  | "exchange"
  | "crypto"
  | "cash"
  | "other";

export type CurrencyCode = "PHP" | "MAD" | "USD" | "EUR" | "CNY" | (string & {});

export interface Currency {
  code: CurrencyCode;
  name: string;
  symbol: string | null;
}

export interface ExchangeRate {
  user_id: string;
  code: CurrencyCode;
  rate_to_base: number;
  updated_at: string;
}

export interface Settings {
  user_id: string;
  base_currency: CurrencyCode;
  issuer_name: string | null;
  issuer_role: string | null;
  issuer_address: string | null;
  issuer_phone: string | null;
  issuer_email: string | null;
  issuer_cin: string | null;
  invoice_number_format: string;
  invoice_tva_note: string | null;
  invoice_show_tva_note: boolean;
  invoice_footer: string | null;
  invoice_accent_color: string | null;
  invoice_language: string;
  invoice_reminder_days: number;
  theme: string;
  created_at: string;
  updated_at: string;
}

export type EventKind =
  | "client.created" | "client.updated" | "client.archived" | "client.deleted"
  | "project.created" | "project.updated" | "project.status_changed" | "project.deleted"
  | "payment.added" | "payment.updated" | "payment.removed"
  | "invoice.created" | "invoice.updated" | "invoice.reminded" | "invoice.deleted"
  | "template.created" | "template.deleted"
  | "method.created" | "method.updated" | "method.archived"
  | "project.flagged" | "project.unflagged"
  | "client.memory_added"
  | "settings.updated";

export interface ActivityEvent {
  id: string;
  user_id: string;
  kind: EventKind;
  entity_type: string | null;
  entity_id: string | null;
  client_id: string | null;
  title: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface Client {
  id: string;
  user_id: string;
  name: string;
  company: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  ice: string | null;
  rc: string | null;
  tax_id: string | null;
  bank_name: string | null;
  bank_account: string | null;
  iban: string | null;
  swift: string | null;
  email: string | null;
  phone: string | null;
  default_currency: CurrencyCode | null;
  accent_color: string | null;
  notes: string | null;
  // Short one-liner shown on cards + fed to Gemini as quick context.
  short_description: string | null;
  // Gemini-managed living memory. Loose shape — see ClientMemoryConsolidated.
  memory_consolidated: ClientMemoryConsolidated;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

// Gemini consolidates raw client_memory_entries into this single doc per client.
export interface ClientMemoryConsolidated {
  summary?: string;
  facts?: string[];
  watch?: string[];
  preferences?: Record<string, string>;
  updated_at?: string;
  entry_count?: number;
}

export interface ClientMemoryEntry {
  id: string;
  user_id: string;
  client_id: string;
  content: string;
  consolidated_at: string | null;
  created_at: string;
}

export interface Category {
  id: string;
  user_id: string;
  client_id: string | null;
  name: string;
  created_at: string;
}

export interface ProjectTemplate {
  id: string;
  user_id: string;
  name: string;
  title_template: string | null;
  description_template: string | null;
  default_amount: number | null;
  default_currency: CurrencyCode | null;
  default_client_id: string | null;
  default_tags: string[];
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: string;
  user_id: string;
  client_id: string;
  category_id: string | null;
  title: string;
  description: string | null;
  amount: number;
  currency: CurrencyCode;
  status: ProjectStatus;
  kanban_position: number;
  quoted_at: string | null;
  due_date: string | null;
  completed_at: string | null;
  tags: string[];
  notes: string | null;
  // Manual-only overdue flag. Nothing is "overdue" until you say so.
  flagged_overdue: boolean;
  flagged_overdue_at: string | null;
  flagged_overdue_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface Payment {
  id: string;
  user_id: string;
  project_id: string;
  invoice_id: string | null;
  // `amount`/`currency` = what was owed, in the project's currency.
  amount: number;
  currency: CurrencyCode;
  paid_at: string;
  // Legacy free-text method label. The structured rail lives in payment_steps.
  method: string | null;
  reference: string | null;
  notes: string | null;
  // Lock fields (migration 0011). Once fx_locked, dashboard uses net_amount_base
  // directly and never recomputes against market FX.
  net_amount_base: number | null;
  gross_at_market_base: number | null;
  implied_fee_base: number | null;
  fx_locked: boolean;
  created_at: string;
}

// One hop in a payment chain. Most payments have a single step.
export interface PaymentStep {
  id: string;
  payment_id: string;
  step_order: number;
  method_id: string | null;
  amount_in: number;
  currency_in: CurrencyCode;
  amount_out: number;
  currency_out: CurrencyCode;
  is_final: boolean;
  notes: string | null;
  created_at: string;
}

export interface PaymentMethod {
  id: string;
  user_id: string;
  name: string;
  kind: PaymentMethodKind;
  currency_in: CurrencyCode | null;
  currency_out: CurrencyCode | null;
  monthly_fee_php: number;
  notes: string | null;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface Expense {
  id: string;
  user_id: string;
  spent_at: string;
  description: string;
  amount: number;
  currency: CurrencyCode;
  category: string | null;
  vendor: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface LineItem {
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
}

export interface Invoice {
  id: string;
  user_id: string;
  client_id: string;
  invoice_number: string;
  issue_date: string;
  due_date: string | null;
  currency: CurrencyCode;
  status: InvoiceStatus;
  issuer_snapshot: Record<string, unknown>;
  client_snapshot: Record<string, unknown>;
  line_items: LineItem[];
  subtotal: number;
  tva_rate: number;
  tva_amount: number;
  total: number;
  show_tva_note: boolean;
  tva_note: string | null;
  footer: string | null;
  notes: string | null;
  language: string;
  last_reminded_at: string | null;
  created_at: string;
  updated_at: string;
}

// Supabase Database type — permissive Insert/Update so every server-action
// payload type-checks without a generated types file.
type Table<T> = {
  Row: T;
  Insert: Record<string, unknown>;
  Update: Record<string, unknown>;
  Relationships: [];
};

type View<T> = { Row: T; Relationships: [] };

export type Database = {
  finance: {
    Tables: {
      currencies:           Table<Currency>;
      exchange_rates:       Table<ExchangeRate>;
      settings:             Table<Settings>;
      clients:              Table<Client>;
      categories:           Table<Category>;
      projects:             Table<Project>;
      payments:             Table<Payment>;
      payment_steps:        Table<PaymentStep>;
      payment_methods:      Table<PaymentMethod>;
      client_memory_entries: Table<ClientMemoryEntry>;
      ai_focus_cache:       Table<{ user_id: string; insights: unknown; generated_at: string }>;
      expenses:             Table<Expense>;
      invoices:             Table<Invoice>;
      invoice_projects:     Table<{ invoice_id: string; project_id: string }>;
      project_templates:    Table<ProjectTemplate>;
      events:               Table<ActivityEvent>;
    };
    Views: {
      project_totals: View<{
        project_id: string;
        user_id: string;
        total_amount: number;
        currency: CurrencyCode;
        total_paid: number;
        outstanding: number;
      }>;
    };
    Functions: { [_ in never]: never };
    Enums: {
      project_status: ProjectStatus;
      invoice_status: InvoiceStatus;
      payment_method_kind: PaymentMethodKind;
    };
    CompositeTypes: { [_ in never]: never };
  };
};

// Hand-written types for the `finance` schema.
// Can be regenerated via `pnpm dlx supabase gen types --schema finance` later.

export type ProjectStatus =
  | "quoted"
  | "in_progress"
  | "invoiced"
  | "partially_paid"
  | "paid"
  | "overdue"
  | "archived";

export type InvoiceStatus = "draft" | "issued" | "sent" | "paid" | "void";

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
  theme: string;
  created_at: string;
  updated_at: string;
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
  archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: string;
  user_id: string;
  client_id: string | null;
  name: string;
  created_at: string;
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
  created_at: string;
  updated_at: string;
}

export interface Payment {
  id: string;
  user_id: string;
  project_id: string;
  invoice_id: string | null;
  amount: number;
  currency: CurrencyCode;
  paid_at: string;
  method: string | null;
  reference: string | null;
  notes: string | null;
  created_at: string;
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
      currencies:        Table<Currency>;
      exchange_rates:    Table<ExchangeRate>;
      settings:          Table<Settings>;
      clients:           Table<Client>;
      categories:        Table<Category>;
      projects:          Table<Project>;
      payments:          Table<Payment>;
      invoices:          Table<Invoice>;
      invoice_projects:  Table<{ invoice_id: string; project_id: string }>;
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
    };
    CompositeTypes: { [_ in never]: never };
  };
};

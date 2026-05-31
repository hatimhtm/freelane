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

// ─────────────────────────── Spending engine enums (migration 0020) ──

export type RecurringScheduleKind =
  | "weekly"
  | "half_monthly"
  | "monthly"
  | "every_n_months"
  | "yearly";

export type RecurringSkipSource = "user_skip" | "covered_by_prepay";

export type LoanDirection = "borrowed" | "lent";

export type LoanStatus = "open" | "partial" | "closed";

export type LoanInstallmentStatus = "pending" | "paid" | "skipped";

export type UserMemorySource = "observation" | "user_note" | "insight";

// ─────────────────────────── Tier 1 enums (migrations 0026-0031) ──

export type SpendCategoryKind = "consumption" | "investment" | "neutral";

export type PlannedSpendStatus =
  | "planned"
  | "committed"
  | "done"
  | "cancelled";

export type PlannedSpendCertainty = "firm" | "probable" | "maybe";

export type AppChangelogKind = "release" | "improvement" | "fix" | "note";

export type CalmWeatherBand =
  | "still"
  | "breeze"
  | "gust"
  | "storm"
  | "calm_after";

export type CalmWeatherRecommendationKind =
  | "lock"
  | "review"
  | "log"
  | "breathe"
  | "pre_mortem"
  | "tight_open";

export type AiQuestionKind =
  | "clarify_spend"
  | "clarify_payment"
  | "clarify_client"
  | "clarify_recurring"
  | "clarify_loan"
  | "clarify_investment"
  | "clarify_revenue"
  | "memory_gap"
  | "restructure_suggestion"
  | "deal_check"
  | "coaching"
  | "note_followup";

export type AiQuestionSourceType =
  | "spend"
  | "payment"
  | "client"
  | "loan"
  | "recurring_spend"
  | "user_memory_entry"
  | (string & {});

export type PriceIntelligenceSource = "ai_prior" | "web_search" | "user_history";

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
  | "withdrawal.added" | "withdrawal.removed"
  | "spend.added" | "spend.updated" | "spend.removed"
  | "spend_category.created" | "spend_category.updated" | "spend_category.deleted"
  | "recurring_spend.created" | "recurring_spend.updated" | "recurring_spend.deleted"
  | "recurring_spend.paid" | "recurring_spend.skipped"
  | "loan.created" | "loan.updated" | "loan.closed" | "loan.deleted"
  | "loan_installment.added" | "loan_installment.paid" | "loan_installment.skipped" | "loan_installment.deleted"
  | "user_memory.note_added" | "user_memory.observation"
  | "ai_question.queued" | "ai_question.answered" | "ai_question.dismissed"
  | "wallet.opening_balance_set"
  | "planned_spend.created" | "planned_spend.updated" | "planned_spend.committed"
  | "planned_spend.done" | "planned_spend.cancelled" | "planned_spend.deleted"
  | "calm_weather.refreshed"
  | "app_changelog.published"
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
  // When true the fee is unknown and the fee algorithm (leaderboard, fee
  // stats) skips this payment entirely instead of counting it as a real 0.
  fee_unknown: boolean;
  created_at: string;
}

// One hop in a payment chain. Most payments have a single step.
export interface PaymentStep {
  id: string;
  payment_id: string;
  step_order: number;
  // Where this hop's money came FROM (source). Null on legacy rows.
  from_method_id: string | null;
  // Where it landed for this hop (destination). For the final step this is
  // "where the payment landed" (drives holding-wallet balances).
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
  // Recurring monthly fee amount, denominated in monthly_fee_currency.
  // monthly_fee_currency null → the amount is already in the base currency.
  monthly_fee_php: number;
  monthly_fee_currency: CurrencyCode | null;
  // A wallet I keep a running balance in (coin.ph, Cash, GCash, Wise, Bank).
  // Money landed here counts as received but rests until withdrawn or spent.
  is_holding: boolean;
  opening_balance_base: number | null;
  opening_balance_at: string | null;
  notes: string | null;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

// A standalone "I moved money out of a holding wallet" event. Not tied to a
// project — the money was decoupled the moment it landed. Amounts are in the
// base currency (PHP). fee_base = gross_base − net_base.
export interface Withdrawal {
  id: string;
  user_id: string;
  from_method_id: string | null;
  to_method_id: string | null;
  withdrawn_at: string;
  gross_base: number;
  net_base: number;
  fee_base: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// ─────────────────────────── Spending (migration 0020) ──

export interface SpendCategory {
  id: string;
  user_id: string;
  name: string;
  icon: string | null;
  color: string | null;
  sort_order: number;
  archived: boolean;
  // Investment vs Consumption Ledger classification (migration 0030).
  // Drives the 30-day split panel on /spending and roll-up logic in
  // src/lib/spends.ts (`spendsByKind`).
  kind: SpendCategoryKind;
  created_at: string;
  updated_at: string;
}

export interface Spend {
  id: string;
  user_id: string;
  wallet_id: string;
  spent_at: string;
  // Optional time-of-day on the spend (migration 0028). Format "HH:mm:ss".
  // Null when the row is date-only (legacy or backdated entry).
  spent_time: string | null;
  amount: number;
  currency: CurrencyCode;
  // PHP-equivalent locked at entry-time via today's FX (same immutability
  // rule as paid payments — never re-floats with the market).
  amount_base: number;
  description: string | null;
  notes: string | null;
  // Optional, denominated in `currency`.
  vat_amount: number | null;
  // Personal vs business tag, NOT a separate space — merged ledger.
  business_relevant: boolean;
  // Pre-payment marker: 1 = single period; N = this row settles N consecutive
  // recurring periods (the engine emits N-1 skip rows alongside).
  covers_periods: number;
  recurring_spend_id: string | null;
  loan_id: string | null;
  loan_installment_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface SpendCategoryLink {
  spend_id: string;
  category_id: string;
}

export interface SpendItem {
  id: string;
  spend_id: string;
  name: string;
  // Nullable: lets you list items by name without remembering exact prices.
  amount: number | null;
  vat_amount: number | null;
  sort_order: number;
  // Universal notes rule (migration 0029). Per-item freeform context.
  notes: string | null;
  created_at: string;
}

export interface RecurringSpend {
  id: string;
  user_id: string;
  wallet_id: string | null;
  label: string;
  expected_amount: number;
  expected_currency: CurrencyCode;
  schedule_kind: RecurringScheduleKind;
  day_of_month: number | null;
  day_of_week: number | null;       // 0 = Sunday
  every_n_value: number | null;     // N for weekly / every_n_months
  window_before_days: number;
  window_after_days: number;
  default_category_ids: string[];   // SpendCategory.id values (stored as jsonb)
  business_relevant: boolean;
  active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface RecurringSpendSkip {
  recurring_spend_id: string;
  // monthly: "YYYY-MM" · half_monthly: "YYYY-MM-H1"|"YYYY-MM-H2" · weekly: "YYYY-Www" · yearly: "YYYY"
  period_key: string;
  source: RecurringSkipSource;
  spend_id: string | null;
  notes: string | null;
  created_at: string;
}

// ─────────────────────────── Personal loans (migration 0020) ──

export interface Loan {
  id: string;
  user_id: string;
  counterparty: string;
  direction: LoanDirection;
  principal_amount: number;
  principal_currency: CurrencyCode;
  // PHP equiv locked at borrow time.
  principal_base: number;
  borrowed_at: string;
  expected_return_by: string | null;
  status: LoanStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface LoanInstallment {
  id: string;
  loan_id: string;
  due_date: string;
  expected_amount: number;
  expected_currency: CurrencyCode;
  status: LoanInstallmentStatus;
  // Wired when the installment is marked paid → spends row created.
  spend_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// ─────────────────────────── Multi-project payments (migration 0021) ──

export interface PaymentProjectAllocation {
  payment_id: string;
  project_id: string;
  allocation_amount: number;
  allocation_currency: CurrencyCode;
  // PHP-equivalent share of the payment, locked at entry.
  allocation_base: number;
  notes: string | null;
  created_at: string;
}

// ─────────────────────────── User memory (migration 0020) ──
// The AI's running notebook on the user. Mirrors ClientMemoryConsolidated;
// the AI seeds itself from this every call and is graceful with sparse data
// (cold start logs "still learning" observations until patterns emerge).

export interface UserMemoryConsolidated {
  summary?: string;
  patterns?: string[];
  watch?: string[];
  preferences?: Record<string, string>;
  milestones?: string[];
  updated_at?: string;
  entry_count?: number;
}

export interface UserMemory {
  user_id: string;
  memory_consolidated: UserMemoryConsolidated;
  entry_count: number;
  updated_at: string;
}

export interface UserMemoryEntry {
  id: string;
  user_id: string;
  content: string;
  source: UserMemorySource;
  created_at: string;
  consolidated_at: string | null;
}

export interface AiQuestion {
  id: string;
  user_id: string;
  question: string;
  kind: AiQuestionKind;
  context: Record<string, unknown>;
  options: string[] | null;
  source_entity_type: AiQuestionSourceType | null;
  source_entity_id: string | null;
  priority: number;
  created_at: string;
  answered_at: string | null;
  answer: string | null;
  // Free-text reply alongside the chip (universal notes rule, migration 0029).
  answer_notes: string | null;
  dismissed_at: string | null;
}

// ─────────────────────────── Tier 1 entities (migrations 0026-0031) ──

// App changelog — single source of truth read by both /changelog and the
// future macOS Swift app's What's New menu.
export interface AppChangelogEntry {
  id: string;
  author_id: string;
  version: string;
  released_at: string;
  kind: AppChangelogKind;
  title: string;
  body: string | null;
  highlights: string[];
  tier: number | null;
  is_pinned: boolean;
  created_at: string;
  updated_at: string;
}

// A future intent row — MacBook, Apple Dev, Eid prep envelope. Counts against
// runway as if already on the calendar, doesn't count against spend totals
// until materialized.
export interface PlannedSpend {
  id: string;
  user_id: string;
  label: string;
  expected_amount: number;
  expected_currency: CurrencyCode;
  // PHP-equivalent locked at row-creation time.
  expected_base: number;
  planned_for: string;
  planned_for_window_days: number;
  certainty: PlannedSpendCertainty;
  status: PlannedSpendStatus;
  wallet_id: string | null;
  default_category_ids: string[];
  is_big_plan: boolean;
  committed_base: number | null;
  committed_at: string | null;
  done_spend_id: string | null;
  done_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// One structured action chip on the Calm Weather banner.
export interface CalmWeatherRecommendation {
  label: string;
  kind: CalmWeatherRecommendationKind;
  cta_route?: string;
  cta_params?: Record<string, string>;
}

// The exact inputs the Calm Weather brain consumed at generation time.
// Loose shape — evolves with the brain.
export interface CalmWeatherInputSnapshot {
  runwayDays?: number;
  dailyBurn?: number;
  safeToSpend?: number;
  overdueBaseTotal?: number;
  bigPlansBase?: number;
  plannedBase30d?: number;
  stabilityMultiplier?: number;
  patternMultiplier?: number;
  observationDays?: number;
  isLearning?: boolean;
  recurringDueIn7dBase?: number;
  negativeWalletCount?: number;
  calmAfterStormStartedAt?: string;
  [k: string]: unknown;
}

export interface CalmWeatherState {
  user_id: string;
  band: CalmWeatherBand;
  narrative: string;
  secondary: string | null;
  recommendations: CalmWeatherRecommendation[];
  confidence: number;
  input_snapshot: CalmWeatherInputSnapshot;
  model_version: string;
  generated_at: string;
  expires_at: string;
}

export interface PriceIntelligenceRow {
  id: string;
  user_id: string;
  item_name_norm: string;
  store_name: string | null;
  price_low: number | null;
  price_typical: number | null;
  price_high: number | null;
  currency: CurrencyCode;
  location: string | null;
  source: PriceIntelligenceSource;
  last_seen_at: string;
  notes: string | null;
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
      currencies:                  Table<Currency>;
      exchange_rates:              Table<ExchangeRate>;
      settings:                    Table<Settings>;
      clients:                     Table<Client>;
      categories:                  Table<Category>;
      projects:                    Table<Project>;
      payments:                    Table<Payment>;
      payment_steps:               Table<PaymentStep>;
      payment_methods:             Table<PaymentMethod>;
      withdrawals:                 Table<Withdrawal>;
      client_memory_entries:       Table<ClientMemoryEntry>;
      ai_focus_cache:              Table<{ user_id: string; insights: unknown; generated_at: string }>;
      ai_safe_spend_cache:         Table<{ user_id: string; insight: unknown; generated_at: string }>;
      // expenses dropped in migration 0020 — superseded by `spends`.
      spend_categories:            Table<SpendCategory>;
      spends:                      Table<Spend>;
      spend_category_links:        Table<SpendCategoryLink>;
      spend_items:                 Table<SpendItem>;
      recurring_spends:            Table<RecurringSpend>;
      recurring_spend_skips:       Table<RecurringSpendSkip>;
      loans:                       Table<Loan>;
      loan_installments:           Table<LoanInstallment>;
      payment_project_allocations: Table<PaymentProjectAllocation>;
      user_memory:                 Table<UserMemory>;
      user_memory_entries:         Table<UserMemoryEntry>;
      ai_questions:                Table<AiQuestion>;
      price_intelligence:          Table<PriceIntelligenceRow>;
      planned_spends:              Table<PlannedSpend>;
      app_changelog:               Table<AppChangelogEntry>;
      calm_weather_state:          Table<CalmWeatherState>;
      invoices:                    Table<Invoice>;
      invoice_projects:            Table<{ invoice_id: string; project_id: string }>;
      project_templates:           Table<ProjectTemplate>;
      events:                      Table<ActivityEvent>;
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
      project_paid_from_allocations: View<{
        project_id: string;
        user_id: string;
        paid_native: number;
        paid_base: number;
        payment_count: number;
      }>;
    };
    Functions: { [_ in never]: never };
    Enums: {
      project_status:           ProjectStatus;
      invoice_status:           InvoiceStatus;
      payment_method_kind:      PaymentMethodKind;
      recurring_schedule_kind:  RecurringScheduleKind;
      recurring_skip_source:    RecurringSkipSource;
      loan_direction:           LoanDirection;
      loan_status:              LoanStatus;
      loan_installment_status:  LoanInstallmentStatus;
      user_memory_source:       UserMemorySource;
      spend_category_kind:      SpendCategoryKind;
      planned_spend_status:     PlannedSpendStatus;
      planned_spend_certainty:  PlannedSpendCertainty;
      app_changelog_kind:       AppChangelogKind;
      calm_weather_band:        CalmWeatherBand;
    };
    CompositeTypes: { [_ in never]: never };
  };
};

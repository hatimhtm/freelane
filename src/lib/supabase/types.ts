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

// Migration 0088 (Plans redesign) collapsed the lock mechanism — 'committed'
// is no longer written by the app. 'active' is the new "user has declared
// intent" alias the redesign UI surfaces. 'bought' replaces 'done' for new
// purchases. 'abandoned' is the new "user gave up without buying" state
// distinct from 'cancelled' (which stays for back-compat). 'done' is kept
// for historical materialized rows.
export type PlannedSpendStatus =
  | "active"
  | "planned"
  | "bought"
  | "done"
  | "cancelled"
  | "abandoned";

export type PlannedSpendCertainty = "firm" | "probable" | "maybe";

// App changelog enum removed (migrations 0104-0105 pivoted the source of
// truth to CHANGELOG.md at the repo root — freelane-whatsnew-design
// 2026-06-02). The 'app_changelog.published' event kind below stays so
// legacy finance.events rows render in the activity feed.

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

// ─────────────────────────── Tier 2 enums (migrations 0032-0035) ──

export type VendorLinkSource = "auto" | "user" | "ai_suggest" | "seed";

export type VendorKind =
  | "grocery"
  | "food"
  | "fast_food"
  | "drug"
  | "tech"
  | "fuel"
  | "transit"
  | "household"
  | "clothing"
  | "service"
  | "utility"
  | (string & {});

export type EntityKind =
  | "person"
  | "pet"
  | "place"
  | "household"
  | "vendor_ref"
  | "concept"
  | "habit"
  | "ritual"
  | (string & {});

export type IslamicEventKind =
  | "eid_al_fitr"
  | "eid_al_adha"
  | "ramadan_start"
  | "ramadan_end"
  | "arafat"
  | "hijri_new_year";

export type PhCulturalEventKind =
  | "fiesta_san_pablo"
  | "school_year_start"
  | "school_year_end"
  | "midterm"
  | "finals"
  | "semestral_break"
  | (string & {});

// ─────────────────────────── Tier 3 enums (migrations 0036-0039) ──

export type EditorialLetterKind =
  | "end_of_month"
  | "spotlight"
  | "sunday"
  | "year"
  | "anniversary"
  | "regret_mark";

export type MilestoneKind =
  | "peso_month_threshold"
  | "invoice_count"
  | "smoke_free_days"
  | "loan_closed"
  | "sadaka_total"
  | "recurring_dropped"
  | "wallet_filled"
  | "first_landing_in_currency"
  | "logging_streak"
  | "first_plan_done"
  | (string & {});

export type QuietReceiptKind =
  | "loan_repaid"
  | "loan_installment_paid"
  | "recurring_lowered"
  | "recurring_paused"
  | "sadaka_given"
  | "first_withdrawal"
  | "invoice_sent"
  | "plan_committed"
  | "plan_done"
  | (string & {});

export type LifeShiftKind =
  | "rent_changed"
  | "recurring_added"
  | "recurring_paused"
  | "recurring_changed"
  | "currency_entered"
  | "wallet_added"
  | "wallet_negative"
  | "loan_taken"
  | "loan_closed"
  | "plan_committed"
  | "plan_done"
  | (string & {});

// ─────────────────────────── Tier 4 (migrations 0040-0041) ──

export interface MorningLog {
  id: string;
  user_id: string;
  recorded_at: string;
  slept_hours: number | null;
  mood_band: number | null;
  mind_state: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// TODO(post-0053-drop): IntentMirror* types are dead — no reader/writer
// remains in actions.ts/queries.ts. Migration 0053 keeps the finance.intent_mirror
// table as a one-release archive; when 0056 DROPs the table, delete these
// interfaces + the intent_mirror entry in Tables<> below.
export interface IntentMirrorIntentions {
  focus?: string;
  family_target_php?: number;
  watch?: string[];
  [k: string]: unknown;
}

// TODO(post-0053-drop): see IntentMirrorIntentions note above.
export interface IntentMirrorRealitySnapshot {
  landed_total?: number;
  spent_total?: number;
  cigarette_spends?: number;
  fast_food_spends?: number;
  household_total?: number;
  [k: string]: unknown;
}

// TODO(post-0053-drop): see IntentMirrorIntentions note above.
export interface IntentMirror {
  id: string;
  user_id: string;
  week_starts: string;
  intentions: IntentMirrorIntentions;
  intentions_text: string | null;
  reality_snapshot: IntentMirrorRealitySnapshot;
  narrative: string | null;
  confidence: number;
  generated_at: string | null;
  created_at: string;
  updated_at: string;
}

// ─────────────────────────── Tier 5 (migrations 0042-0045) ──

export type ShouldIBuyVerdict =
  | "easy_yes"
  | "fits_the_stretch"
  | "tight_but_possible"
  | "not_this_stretch"
  | (string & {});

export type RateInsightKind =
  | "scope_creep"
  | "revision_burden"
  | "communication_lag"
  | "rate_lag"
  | "underpriced_relative_to_market"
  | "overpriced_relative_to_outcomes"
  | "time_spent_unaccounted"
  | "general"
  | (string & {});

export interface WellbeingCheckin {
  id: string;
  user_id: string;
  week_starts: string;
  prompt: string | null;
  response: string | null;
  mood: number | null;
  energy: number | null;
  echo: string | null;
  generated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface QuietChannel {
  id: string;
  user_id: string;
  client_id: string;
  detected_at: string;
  silence_days: number;
  ai_question_id: string | null;
  resolved_at: string | null;
  reply: string | null;
  written_to_memory_entry_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface RateInsight {
  id: string;
  user_id: string;
  client_id: string | null;
  project_id: string | null;
  kind: RateInsightKind;
  observation: string;
  context: Record<string, unknown>;
  reply: string | null;
  replied_at: string | null;
  suggested_rate: number | null;
  suggested_currency: string | null;
  acted: boolean;
  acted_at: string | null;
  generated_at: string;
  created_at: string;
  updated_at: string;
}

export interface ShouldIBuySession {
  id: string;
  user_id: string;
  item: string;
  amount: number;
  currency: CurrencyCode;
  amount_base: number;
  note: string | null;
  verdict: ShouldIBuyVerdict | null;
  narrative: string | null;
  confidence: number | null;
  bought: boolean | null;
  decided_at: string | null;
  input_snapshot: Record<string, unknown>;
  generated_at: string;
  created_at: string;
  updated_at: string;
}

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
  // Migration 0104 — last CHANGELOG.md version this user opened in
  // Settings -> Updates. Drives the red-dot badge on the Settings
  // landing. NULL means the user has never opened Updates.
  last_seen_version: string | null;
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
  | "vendor.created" | "vendor.updated" | "vendor.archived" | "vendor.deleted"
  | "vendor.linked" | "vendor.unlinked"
  | "entity.created" | "entity.updated" | "entity.archived" | "entity.deleted"
  | "entity.linked" | "entity.unlinked"
  | "wife_state.updated" | "wife_preferences.consolidated"
  | "letter.generated" | "letter.pinned" | "letter.replied" | "letter.deleted" | "letter.skipped_by_gate"
  | "milestone.recorded" | "milestone.replied" | "milestone.deleted"
  | "quiet_receipt.recorded" | "quiet_receipt.replied" | "quiet_receipt.deleted"
  | "life_shift.recorded" | "life_shift.replied" | "life_shift.deleted"
  | "morning_log.saved"
  // TODO(post-0053-drop): no live event writer remains; drop with the table.
  | "intent_mirror.saved" | "intent_mirror.refreshed"
  | "wellbeing.checkin_saved" | "wellbeing.echo_generated"
  | "quiet_channel.detected" | "quiet_channel.resolved"
  | "rate_insight.generated" | "rate_insight.replied" | "rate_insight.acted"
  | "should_i_buy.asked" | "should_i_buy.decided"
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
  // Native opening balance (migration 0047). The form echoes this back so
  // the user sees exactly what they typed instead of an FX-converted value.
  opening_balance_amount: number | null;
  opening_balance_currency: CurrencyCode | null;
  // Anchor snapshot in TIMESTAMPTZ (migration 0049). Holding-balance math
  // compares activity created_at against this to exclude same-day pre-anchor
  // rows precisely. Null on legacy rows — math falls back to date comparison.
  opening_balance_set_at: string | null;
  // Per-wallet overdraft tolerance in base currency (migration 0054). Display
  // + alarm threshold ONLY — never folded into safe-to-spend math. Wallet
  // renders terracotta while balance > -tolerance, rose past it.
  overdraft_tolerance_base: number;
  // Stable wallet brand key (migration 0078). Resolves to the WALLET_BRANDS
  // registry in src/lib/brand/wallets.ts. NULL falls back to fuzzy
  // name-slug matching at render time.
  brand_key: string | null;
  notes: string | null;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

// Per-user cache row for the vendor icon AI-fallback brain (migration
// 0079). Read by src/lib/brand/vendor-icon.ts at render time.
export interface VendorIconCacheRow {
  id: string;
  user_id: string;
  vendor_name_normalized: string;
  canonical_name: string | null;
  brand_color_hex: string | null;
  glyph_kind: "letter" | "symbol" | "category" | "none";
  glyph_value: string | null;
  category_hint: string | null;
  confidence: number | null;
  generated_at: string;
  user_overridden: boolean;
}

// Reference row in finance.wallet_platform_metadata (migration 0080).
// Reference data; read by chatbot when answering withdrawal-routing
// questions. typical_fee_fraction is a [0,1] fraction (0.006 = 0.6%),
// shares units with paymentFee().pct so the brain can compare typical-
// vs-actual without a 100x unit clash.
export interface WalletPlatformMetadataRow {
  brand_key: string;
  display_name: string;
  platform_type: "crypto" | "ewallet" | "bank" | "remittance" | "cash";
  base_currency: string | null;
  typical_fee_fraction: number | null;
  typical_fee_flat_php: number | null;
  typical_speed_hours: number | null;
  supports_inbound: boolean;
  supports_outbound: boolean;
  notes: string | null;
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

// Tag taxonomy (migration 0083). Discriminates the spend_categories row
// so the same storage layer carries audience / category / custom tags.
// Two discriminators coexist on the row:
//   `kind` (SpendCategoryKind enum) = Investment vs Consumption ledger
//     (consumption/investment/neutral). Added by migration 0030.
//   `tag_kind` (TagKind here, TEXT column) = audience/category/custom.
//     Added by migration 0083. Drives the Spending UI tag taxonomy.
// The SQL column name and the TS field name are both `tag_kind` — no
// projection happens at the reader boundary. Both columns live on the
// same row; readers select * and consume both.
export type TagKind = "audience" | "category" | "custom";

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
  // Tag taxonomy (migration 0083). SQL column is `tag_kind` (text), kept
  // distinct from the enum `kind` column above so both discriminators
  // can coexist on the row. No projection — column name matches field.
  tag_kind: TagKind;
  // Migration 0083 — pinned audience seeds are immutable (no rename, no
  // delete). The action layer rejects updates to pinned rows.
  pinned: boolean;
  // Migration 0083 — true only for user-created custom tags via the
  // "+ New tag" affordance. Default seeds stay false.
  created_by_user: boolean;
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
  // "It's For Us" tag (Tier 2 F — migration 0034). Distinct from the Wife
  // category. Means the spend was for the household, not for either person
  // individually.
  for_us: boolean;
  // Explicit "Mark as sadaka" toggle (Phase 2 — migration 0075). When true,
  // the createSpend pipeline writes a sadaka_ledger payment row tied to the
  // spend AND short-circuits the auto-detect hook.
  is_sadaka: boolean;
  // ── Entities workflow — migration 0096 (locked 2026-06-03)
  // "For someone else" toggle on the spend modal + the resolved
  // beneficiary entity. is_for_someone_else can be true with
  // beneficiary_entity_id=null (user knows it was for someone but
  // hasn't identified them) — that signal still drives Gate 1.
  beneficiary_entity_id: string | null;
  is_for_someone_else: boolean;
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
  // Per-item quantity (migration 0048). 1 by default — total line price is
  // `amount`, so unit price = amount / quantity for the leaderboards + AI.
  quantity: number;
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

// App changelog table dropped in migration 0105 — see
// freelane-whatsnew-design 2026-06-02. CHANGELOG.md at the repo root is
// now the single source of truth, parsed by src/lib/changelog/load.ts
// into ChangelogEntry rows for both the in-app Updates surface and the
// /api/changelog.json feed the macOS companion consumes.

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
  // Migration 0088 (Plans redesign) — AI price lookup + target_date +
  // justification + bought tracking + satisfaction rating. All optional;
  // older rows have nulls until first edited.
  price_source: "user" | "ai" | "adjusted";
  ai_price_range_low: number | null;
  ai_price_range_high: number | null;
  ai_price_sources: string[] | null;
  ai_price_at: string | null;
  target_date: string | null;
  justification: string | null;
  bought_at: string | null;
  bought_actual_price: number | null;
  satisfaction_rating: number | null;
  // Migration 0090 — dedicated column for the +14d satisfaction note so
  // it can't clobber the user's pre-existing implementation notes.
  satisfaction_note: string | null;
  // Legacy materialize-spend link from 0027 — still populated for
  // historical 'done' rows; new 'bought' rows don't necessarily fill it
  // (markPlanBought writes a spend but only persists bought_at /
  // bought_actual_price for the archive view).
  done_spend_id: string | null;
  done_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// Migration 0089 — AI-proposed savings strategies attached to a plan.
// Surfaced as 2-3 ranked cards inside the plan detail sheet. Activating
// one writes safe-to-spend.applyStrategy() over the live daily safe.
export type PlanStrategyKind =
  | "reduce_safe"
  | "skip_category"
  | "channel_sadaka_overflow"
  | "wait_for_payment"
  | "cut_eating_out"
  | "pause_other_plan"
  | "alternative_route";

export interface PlanStrategy {
  id: string;
  user_id: string;
  plan_id: string;
  strategy_kind: PlanStrategyKind;
  rank: number;
  title: string;
  body: {
    side_effects?: string[];
    [k: string]: unknown;
  };
  estimated_completion: string | null;
  monthly_save_estimate: number | null;
  realism_score: number | null;
  applicable_now: boolean;
  active: boolean;
  proposed_at: string;
  activated_at: string | null;
  deactivated_at: string | null;
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

// ─────────────────────────── Tier 2 entities (migrations 0032-0035) ──

// AI-consolidated memory mirroring the client/user memory shape — used by
// every named-entity surface (vendors, entities, wife). The shape stays
// loose so future brain upgrades can grow it without a migration.
export interface MemoryConsolidated {
  summary?: string;
  facts?: string[];
  watch?: string[];
  preferences?: Record<string, string>;
  milestones?: string[];
  updated_at?: string;
  entry_count?: number;
  [k: string]: unknown;
}

export interface VendorLocation {
  area?: string;
  barangay?: string;
  landmark?: string;
  gps?: { lat: number; lng: number };
  [k: string]: unknown;
}

export interface Vendor {
  id: string;
  user_id: string;
  canonical_name: string;
  slug: string;
  short_description: string | null;
  location: VendorLocation;
  kinds: VendorKind[];
  memory_consolidated: MemoryConsolidated;
  notes: string | null;
  last_seen_at: string | null;
  archived: boolean;
  // Migration 0084 — vendor identification state. Drives the
  // vendor_identify_request notification dispatch + 30m debounce + 5/hr
  // cap.
  needs_identification: boolean;
  identification_skipped: boolean;
  last_identify_notif_at: string | null;
  // Migration 0092 — canonicalization fields. The Pro canonicalize-vendor
  // brain reads raw_user_typed_name verbatim and proposes canonical_name +
  // aliases + confidence. brand_key is the resolver's pinned glyph key
  // (closes the migration 0084 TODO). last_clarify_notif_at gates the
  // 30-min per-vendor debounce on vendor_clarify notifications.
  raw_user_typed_name: string | null;
  aliases: string[];
  last_clarify_notif_at: string | null;
  confidence: number | null;
  brand_key: string | null;
  created_at: string;
  updated_at: string;
}

// Migration 0085 — PHT-anchored snapshot of the day's starting safe-to-
// spend. Stable across the PHT day; never moves with intraday spends.
export interface DailySafeSnapshot {
  user_id: string;
  pht_date: string;
  initial_safe_base: number;
  currency: string;
  computed_at: string;
}

export interface VendorAlias {
  id: string;
  vendor_id: string;
  alias: string;
  alias_norm: string;
  source: VendorLinkSource;
  created_at: string;
}

export interface SpendVendorLink {
  spend_id: string;
  vendor_id: string;
  source: VendorLinkSource;
  created_at: string;
}

export interface PriceDriftObservation {
  id: string;
  user_id: string;
  vendor_id: string | null;
  spend_id: string | null;
  item_name_norm: string;
  unit_price_base: number;
  paid_base: number;
  observed_at: string;
  created_at: string;
}

// Entities workflow (migration 0097 — locked 2026-06-03).
// introduction_status drives the NEW ELEMENT TRIGGERS state machine:
//   pending → asked → introduced | silenced
// The entity_introduction dispatcher reads + advances this string after
// each first-event trigger (first monetary event, first note, first chat
// mention, first appearance in any LifeOS surface) so the same prompt
// fires AT MOST ONCE per (entity_id, trigger_kind).
export type EntityIntroductionStatus =
  | "pending"
  | "asked"
  | "introduced"
  | "silenced";

export interface Entity {
  id: string;
  user_id: string;
  kind: EntityKind;
  canonical_name: string;
  short_description: string | null;
  aliases: string[];
  memory_consolidated: MemoryConsolidated;
  vague: boolean;
  notes: string | null;
  archived: boolean;
  created_at: string;
  updated_at: string;
  // ── Entities workflow — migration 0097 (locked 2026-06-03)
  raw_user_typed_name: string | null;
  relationship: string | null;
  identification_skipped: boolean;
  last_clarify_notif_at: string | null;
  confidence: number | null;
  discovered_from: string | null;
  introduction_status: EntityIntroductionStatus;
}

export interface SpendEntityLink {
  spend_id: string;
  entity_id: string;
  source: VendorLinkSource;
  created_at: string;
}

export interface WifeSemesterPeriod {
  kind: "midterm" | "finals" | "semestral_break" | "regular" | (string & {});
  starts: string;
  ends: string;
}

export interface WifeSemester {
  name?: string;
  starts?: string;
  ends?: string;
  periods?: WifeSemesterPeriod[];
}

export interface WifeSemesterCalendar {
  current?: WifeSemester;
  upcoming?: WifeSemester[];
  [k: string]: unknown;
}

export interface WifeState {
  user_id: string;
  name: string | null;
  university: string | null;
  year_of_study: number | null;
  expected_graduation: string | null;
  semester_calendar: WifeSemesterCalendar;
  preferences_consolidated: MemoryConsolidated;
  preferences_consolidated_at: string | null;
  notes: string | null;
  updated_at: string;
}

export interface IslamicCalendarRow {
  id: string;
  kind: IslamicEventKind;
  gregorian_date: string;
  hijri_year: number;
  hijri_label: string | null;
  notes: string | null;
  created_at: string;
}

export interface PhCulturalEventRow {
  id: string;
  kind: PhCulturalEventKind;
  gregorian_date: string;
  ends_at: string | null;
  name: string;
  notes: string | null;
  created_at: string;
}

// ─────────────────────────── Tier 3 entities (migrations 0036-0039) ──

export interface EditorialLetter {
  id: string;
  user_id: string;
  kind: EditorialLetterKind;
  period_key: string;
  headline: string;
  body: string;
  blocks: Record<string, unknown>;
  input_snapshot: Record<string, unknown>;
  confidence: number;
  model_version: string;
  pinned: boolean;
  reply: string | null;
  replied_at: string | null;
  generated_at: string;
  created_at: string;
  updated_at: string;
}

export interface Milestone {
  id: string;
  user_id: string;
  kind: MilestoneKind;
  label: string;
  value: number | null;
  unit: string | null;
  context: Record<string, unknown>;
  narrative: string;
  achieved_at: string;
  surfaced: boolean;
  reply: string | null;
  replied_at: string | null;
  generated_at: string;
  created_at: string;
  updated_at: string;
}

export interface QuietReceipt {
  id: string;
  user_id: string;
  kind: QuietReceiptKind;
  source_entity_type: string | null;
  source_entity_id: string | null;
  narrative: string;
  context: Record<string, unknown>;
  occurred_at: string;
  reply: string | null;
  replied_at: string | null;
  generated_at: string;
  created_at: string;
  updated_at: string;
}

export interface LifeShift {
  id: string;
  user_id: string;
  kind: LifeShiftKind;
  label: string;
  before_value: string | null;
  after_value: string | null;
  source_entity_type: string | null;
  source_entity_id: string | null;
  narrative: string;
  context: Record<string, unknown>;
  occurred_at: string;
  reply: string | null;
  replied_at: string | null;
  generated_at: string;
  created_at: string;
  updated_at: string;
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
      // Migration 0089 — AI-proposed savings strategies per plan.
      plan_strategies:             Table<PlanStrategy>;
      // finance.app_changelog dropped in migration 0105 —
      // CHANGELOG.md at the repo root is the new source of truth.
      calm_weather_state:          Table<CalmWeatherState>;
      vendors:                     Table<Vendor>;
      vendor_aliases:              Table<VendorAlias>;
      spend_vendor_links:          Table<SpendVendorLink>;
      price_drift_observations:    Table<PriceDriftObservation>;
      entities:                    Table<Entity>;
      spend_entity_links:          Table<SpendEntityLink>;
      wife_state:                  Table<WifeState>;
      islamic_calendar:            Table<IslamicCalendarRow>;
      ph_cultural_events:          Table<PhCulturalEventRow>;
      letters:                     Table<EditorialLetter>;
      milestones:                  Table<Milestone>;
      quiet_receipts:              Table<QuietReceipt>;
      life_shifts:                 Table<LifeShift>;
      morning_log:                 Table<MorningLog>;
      // TODO(post-0053-drop): finance.intent_mirror kept as a one-release archive
      // per migration 0053. When 0056 DROPs the table, delete this row.
      intent_mirror:               Table<IntentMirror>;
      wellbeing_checkins:          Table<WellbeingCheckin>;
      quiet_channels:              Table<QuietChannel>;
      rate_insights:               Table<RateInsight>;
      should_i_buy_sessions:       Table<ShouldIBuySession>;
      // Migration 0050 — notifications inbox + per-recipient prefs.
      notifications_inbox:         Table<{
        id: string;
        user_id: string;
        kind: string;
        subject: string;
        body: string | null;
        link_url: string | null;
        dedup_key: string | null;
        priority: number;
        read_at: string | null;
        dismissed_at: string | null;
        created_at: string;
        // Migration 0090 — optional scheduled delivery time. Null means
        // deliver immediately. Sweeps flip rows visible by checking
        // deliver_at IS NULL OR deliver_at <= now().
        deliver_at: string | null;
      }>;
      notification_prefs:          Table<{
        user_id: string;
        prefs: unknown;
        updated_at: string;
      }>;
      // Migration 0051 — canonical AI brain cache.
      ai_brain_cache:              Table<{
        user_id: string;
        brain_key: string;
        payload: unknown;
        generated_at: string;
        stale_at: string | null;
        input_fingerprint: string | null;
      }>;
      // Migration 0052 — daily diary (replaces weekly intent_mirror).
      diary_entries:               Table<{
        id: string;
        user_id: string;
        entry_date: string;
        body: string;
        mood: number | null;
        energy: number | null;
        created_at: string;
        updated_at: string;
      }>;
      invoices:                    Table<Invoice>;
      invoice_projects:            Table<{ invoice_id: string; project_id: string }>;
      project_templates:           Table<ProjectTemplate>;
      events:                      Table<ActivityEvent>;
      // Migration 0079 — vendor icon resolver cache (Brand Identity workflow).
      vendor_icon_cache:           Table<VendorIconCacheRow>;
      // Migration 0080 — wallet platform reference data (Payments workflow).
      wallet_platform_metadata:    Table<WalletPlatformMetadataRow>;
      // Migration 0085 — daily safe-to-spend snapshot (LIVE DAILY SAFE).
      daily_safe_snapshots:        Table<DailySafeSnapshot>;
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
      // finance.app_changelog_kind enum dropped in migration 0105.
      calm_weather_band:        CalmWeatherBand;
      vendor_link_source:       VendorLinkSource;
      vendor_kind:              VendorKind;
      entity_kind:              EntityKind;
      islamic_event_kind:       IslamicEventKind;
      ph_cultural_event_kind:   PhCulturalEventKind;
      editorial_letter_kind:    EditorialLetterKind;
      milestone_kind:           MilestoneKind;
      quiet_receipt_kind:       QuietReceiptKind;
      life_shift_kind:          LifeShiftKind;
    };
    CompositeTypes: { [_ in never]: never };
  };
};

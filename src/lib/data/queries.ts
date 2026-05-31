import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import type {
  Client,
  Project,
  Payment,
  PaymentStep,
  PaymentMethod,
  Settings,
  ExchangeRate,
  Category,
  Currency,
  ProjectTemplate,
  ActivityEvent,
  ClientMemoryEntry,
  Withdrawal,
  Spend,
  SpendCategory,
  SpendCategoryLink,
  SpendItem,
  RecurringSpend,
  RecurringSpendSkip,
  Loan,
  LoanInstallment,
  PaymentProjectAllocation,
  UserMemory,
  UserMemoryEntry,
  AiQuestion,
  PriceIntelligenceRow,
} from "@/lib/supabase/types";

async function userOrThrow() {
  const user = await getAuthUser();
  if (!user) throw new Error("Unauthenticated");
  return user;
}

export async function getSession() {
  const supabase = await createClient();
  const user = await getAuthUser();
  return { supabase, user };
}

type DbClient = Awaited<ReturnType<typeof createClient>>;

// Fetch the chain steps for a set of payments, grouped by payment_id.
async function fetchStepsByPayment(
  supabase: DbClient,
  paymentIds: string[],
): Promise<Map<string, PaymentStep[]>> {
  const map = new Map<string, PaymentStep[]>();
  if (paymentIds.length === 0) return map;
  const { data } = await supabase
    .from("payment_steps")
    .select("*")
    .in("payment_id", paymentIds)
    .order("step_order");
  (data ?? []).forEach((s) => {
    const step = s as PaymentStep;
    const arr = map.get(step.payment_id) ?? [];
    arr.push(step);
    map.set(step.payment_id, arr);
  });
  return map;
}

// Flat spend_category_links for a set of spends. Downstream code prefers the
// flat array for global lookups; lib/spends.ts has linksBySpend() for grouping.
async function fetchSpendCategoryLinks(
  supabase: DbClient,
  spendIds: string[],
): Promise<SpendCategoryLink[]> {
  if (spendIds.length === 0) return [];
  const { data } = await supabase
    .from("spend_category_links")
    .select("*")
    .in("spend_id", spendIds);
  return (data ?? []) as SpendCategoryLink[];
}

async function fetchPaymentAllocations(
  supabase: DbClient,
  paymentIds: string[],
): Promise<PaymentProjectAllocation[]> {
  if (paymentIds.length === 0) return [];
  const { data } = await supabase
    .from("payment_project_allocations")
    .select("*")
    .in("payment_id", paymentIds);
  return (data ?? []) as PaymentProjectAllocation[];
}

export async function getDashboardData() {
  const [supabase, user] = await Promise.all([createClient(), userOrThrow()]);

  const [
    settings,
    projects,
    payments,
    rates,
    clients,
    currencies,
    methods,
    withdrawals,
    spends,
    spendCategories,
    recurring,
    recurringSkips,
    loans,
    loanInstallments,
    openAiQuestions,
  ] = await Promise.all([
    supabase.from("settings").select("*").eq("user_id", user.id).maybeSingle(),
    supabase.from("projects").select("*").eq("user_id", user.id).order("updated_at", { ascending: false }),
    supabase.from("payments").select("*").eq("user_id", user.id).order("paid_at", { ascending: false }),
    supabase.from("exchange_rates").select("*").eq("user_id", user.id),
    supabase.from("clients").select("*").eq("user_id", user.id).eq("archived", false).order("name"),
    supabase.from("currencies").select("*"),
    supabase.from("payment_methods").select("*").eq("user_id", user.id).eq("archived", false).order("name"),
    supabase.from("withdrawals").select("*").eq("user_id", user.id).order("withdrawn_at", { ascending: false }),
    supabase.from("spends").select("*").eq("user_id", user.id).order("spent_at", { ascending: false }),
    supabase.from("spend_categories").select("*").eq("user_id", user.id).order("sort_order"),
    supabase.from("recurring_spends").select("*").eq("user_id", user.id).order("label"),
    supabase.from("recurring_spend_skips").select("*"),
    supabase.from("loans").select("*").eq("user_id", user.id).order("status").order("borrowed_at", { ascending: false }),
    supabase.from("loan_installments").select("*").order("due_date"),
    supabase.from("ai_questions").select("*").eq("user_id", user.id)
      .is("answered_at", null).is("dismissed_at", null)
      .order("priority", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const paymentRows = (payments.data ?? []) as Payment[];
  const spendRows = (spends.data ?? []) as Spend[];
  const [stepsByPayment, spendCategoryLinks, paymentAllocations, spendItems] = await Promise.all([
    fetchStepsByPayment(supabase, paymentRows.map((p) => p.id)),
    fetchSpendCategoryLinks(supabase, spendRows.map((s) => s.id)),
    fetchPaymentAllocations(supabase, paymentRows.map((p) => p.id)),
    (async () => {
      if (spendRows.length === 0) return [] as SpendItem[];
      const { data } = await supabase
        .from("spend_items")
        .select("*")
        .in("spend_id", spendRows.map((s) => s.id))
        .order("sort_order");
      return (data ?? []) as SpendItem[];
    })(),
  ]);

  return {
    settings: (settings.data ?? null) as Settings | null,
    projects: (projects.data ?? []) as Project[],
    payments: paymentRows,
    stepsByPayment,
    rates:    (rates.data ?? []) as ExchangeRate[],
    clients:  (clients.data ?? []) as Client[],
    currencies: (currencies.data ?? []) as Currency[],
    methods:  (methods.data ?? []) as PaymentMethod[],
    withdrawals: (withdrawals.data ?? []) as Withdrawal[],
    spends: spendRows,
    spendCategories: (spendCategories.data ?? []) as SpendCategory[],
    spendCategoryLinks,
    spendItems,
    recurring: (recurring.data ?? []) as RecurringSpend[],
    recurringSkips: (recurringSkips.data ?? []) as RecurringSpendSkip[],
    loans: (loans.data ?? []) as Loan[],
    loanInstallments: (loanInstallments.data ?? []) as LoanInstallment[],
    paymentAllocations,
    openAiQuestions: (openAiQuestions.data ?? []) as AiQuestion[],
  };
}

// Pending = unpaid + partially-paid projects, for the "Blocked Money" view.
export async function getPendingData() {
  const [supabase, user] = await Promise.all([createClient(), userOrThrow()]);
  const [projects, clients, payments, rates, settings, loanInstallments] = await Promise.all([
    supabase.from("projects").select("*").eq("user_id", user.id)
      .in("status", ["unpaid", "partially_paid"]).order("quoted_at"),
    supabase.from("clients").select("*").eq("user_id", user.id).order("name"),
    supabase.from("payments").select("*").eq("user_id", user.id),
    supabase.from("exchange_rates").select("*").eq("user_id", user.id),
    supabase.from("settings").select("*").eq("user_id", user.id).maybeSingle(),
    supabase.from("loan_installments").select("*").order("due_date"),
  ]);
  const paymentRows = (payments.data ?? []) as Payment[];
  const paymentAllocations = await fetchPaymentAllocations(supabase, paymentRows.map((p) => p.id));
  return {
    projects: (projects.data ?? []) as Project[],
    clients:  (clients.data ?? []) as Client[],
    payments: paymentRows,
    rates:    (rates.data ?? []) as ExchangeRate[],
    settings: (settings.data ?? null) as Settings | null,
    loanInstallments: (loanInstallments.data ?? []) as LoanInstallment[],
    paymentAllocations,
  };
}

// Payments hub: payments + their chains + methods + projects/clients + rates.
export async function getPaymentsData() {
  const [supabase, user] = await Promise.all([createClient(), userOrThrow()]);
  const [
    payments,
    projects,
    clients,
    rates,
    methods,
    settings,
    currencies,
    withdrawals,
    spends,
    spendCategories,
  ] = await Promise.all([
    supabase.from("payments").select("*").eq("user_id", user.id).order("paid_at", { ascending: false }),
    supabase.from("projects").select("*").eq("user_id", user.id),
    supabase.from("clients").select("*").eq("user_id", user.id).order("name"),
    supabase.from("exchange_rates").select("*").eq("user_id", user.id),
    supabase.from("payment_methods").select("*").eq("user_id", user.id).eq("archived", false).order("name"),
    supabase.from("settings").select("*").eq("user_id", user.id).maybeSingle(),
    supabase.from("currencies").select("*").order("code"),
    supabase.from("withdrawals").select("*").eq("user_id", user.id).order("withdrawn_at", { ascending: false }),
    supabase.from("spends").select("*").eq("user_id", user.id).order("spent_at", { ascending: false }),
    supabase.from("spend_categories").select("*").eq("user_id", user.id).order("sort_order"),
  ]);
  const paymentRows = (payments.data ?? []) as Payment[];
  const spendRows = (spends.data ?? []) as Spend[];
  const [stepsByPayment, paymentAllocations, spendCategoryLinks] = await Promise.all([
    fetchStepsByPayment(supabase, paymentRows.map((p) => p.id)),
    fetchPaymentAllocations(supabase, paymentRows.map((p) => p.id)),
    fetchSpendCategoryLinks(supabase, spendRows.map((s) => s.id)),
  ]);
  return {
    payments: paymentRows,
    stepsByPayment,
    projects: (projects.data ?? []) as Project[],
    clients:  (clients.data ?? []) as Client[],
    rates:    (rates.data ?? []) as ExchangeRate[],
    methods:  (methods.data ?? []) as PaymentMethod[],
    settings: (settings.data ?? null) as Settings | null,
    currencies: (currencies.data ?? []) as Currency[],
    withdrawals: (withdrawals.data ?? []) as Withdrawal[],
    spends: spendRows,
    spendCategories: (spendCategories.data ?? []) as SpendCategory[],
    spendCategoryLinks,
    paymentAllocations,
  };
}

export async function getPaymentMethods() {
  const [supabase, user] = await Promise.all([createClient(), userOrThrow()]);
  const { data } = await supabase
    .from("payment_methods")
    .select("*")
    .eq("user_id", user.id)
    .order("archived")
    .order("name");
  return (data ?? []) as PaymentMethod[];
}

export async function getClients() {
  const [supabase, user] = await Promise.all([createClient(), userOrThrow()]);
  const { data } = await supabase
    .from("clients")
    .select("*")
    .eq("user_id", user.id)
    .order("archived")
    .order("name");
  return (data ?? []) as Client[];
}

// Client detail page: the client + its raw memory entries + projects + payments.
export async function getClientDetail(clientId: string) {
  const [supabase, user] = await Promise.all([createClient(), userOrThrow()]);
  const [client, memory, projects, payments, events] = await Promise.all([
    supabase.from("clients").select("*").eq("user_id", user.id).eq("id", clientId).maybeSingle(),
    supabase.from("client_memory_entries").select("*").eq("client_id", clientId).order("created_at", { ascending: false }),
    supabase.from("projects").select("*").eq("user_id", user.id).eq("client_id", clientId).order("created_at", { ascending: false }),
    supabase.from("payments").select("*").eq("user_id", user.id),
    supabase.from("events").select("*").eq("client_id", clientId).order("created_at", { ascending: false }).limit(40),
  ]);
  return {
    client:  (client.data ?? null) as Client | null,
    memory:  (memory.data ?? []) as ClientMemoryEntry[],
    projects: (projects.data ?? []) as Project[],
    payments: (payments.data ?? []) as Payment[],
    events:  (events.data ?? []) as ActivityEvent[],
  };
}

export async function getProjectsWithClients() {
  const [supabase, user] = await Promise.all([createClient(), userOrThrow()]);

  const [projects, clients, payments, categories, templates, rates, settings] = await Promise.all([
    supabase.from("projects").select("*").eq("user_id", user.id)
      .order("kanban_position").order("created_at"),
    supabase.from("clients").select("*").eq("user_id", user.id).eq("archived", false).order("name"),
    supabase.from("payments").select("*").eq("user_id", user.id),
    supabase.from("categories").select("*").eq("user_id", user.id),
    supabase.from("project_templates").select("*").eq("user_id", user.id).order("name"),
    supabase.from("exchange_rates").select("*").eq("user_id", user.id),
    supabase.from("settings").select("*").eq("user_id", user.id).maybeSingle(),
  ]);

  return {
    projects:   (projects.data ?? []) as Project[],
    clients:    (clients.data ?? []) as Client[],
    payments:   (payments.data ?? []) as Payment[],
    categories: (categories.data ?? []) as Category[],
    templates:  (templates.data ?? []) as ProjectTemplate[],
    rates:      (rates.data ?? []) as ExchangeRate[],
    settings:   (settings.data ?? null) as Settings | null,
  };
}

export async function getSettings() {
  const [supabase, user] = await Promise.all([createClient(), userOrThrow()]);
  const [settings, rates, currencies, methods] = await Promise.all([
    supabase.from("settings").select("*").eq("user_id", user.id).maybeSingle(),
    supabase.from("exchange_rates").select("*").eq("user_id", user.id).order("code"),
    supabase.from("currencies").select("*").order("code"),
    supabase.from("payment_methods").select("*").eq("user_id", user.id).order("archived").order("name"),
  ]);
  return {
    settings:   (settings.data ?? null) as Settings | null,
    rates:      (rates.data ?? []) as ExchangeRate[],
    currencies: (currencies.data ?? []) as Currency[],
    methods:    (methods.data ?? []) as PaymentMethod[],
  };
}

export async function getEvents(limit = 200) {
  const [supabase, user] = await Promise.all([createClient(), userOrThrow()]);
  const [events, clients] = await Promise.all([
    supabase
      .from("events")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(limit),
    supabase.from("clients").select("id,name").eq("user_id", user.id),
  ]);
  return {
    events: (events.data ?? []) as ActivityEvent[],
    clients: (clients.data ?? []) as Pick<Client, "id" | "name">[],
  };
}

export async function getClientEvents(clientId: string, limit = 50) {
  const [supabase, user] = await Promise.all([createClient(), userOrThrow()]);
  const { data } = await supabase
    .from("events")
    .select("*")
    .eq("user_id", user.id)
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as ActivityEvent[];
}

// The year-in-review still reads payments; net_amount_base is the locked PHP.
export async function getYearData() {
  const [supabase, user] = await Promise.all([createClient(), userOrThrow()]);
  const [
    settings,
    projects,
    payments,
    rates,
    clients,
    spends,
    spendCategories,
    recurring,
    recurringSkips,
  ] = await Promise.all([
    supabase.from("settings").select("*").eq("user_id", user.id).maybeSingle(),
    supabase.from("projects").select("*").eq("user_id", user.id),
    supabase.from("payments").select("*").eq("user_id", user.id).order("paid_at", { ascending: false }),
    supabase.from("exchange_rates").select("*").eq("user_id", user.id),
    supabase.from("clients").select("*").eq("user_id", user.id),
    supabase.from("spends").select("*").eq("user_id", user.id).order("spent_at", { ascending: false }),
    supabase.from("spend_categories").select("*").eq("user_id", user.id).order("sort_order"),
    supabase.from("recurring_spends").select("*").eq("user_id", user.id).order("label"),
    supabase.from("recurring_spend_skips").select("*"),
  ]);
  const spendRows = (spends.data ?? []) as Spend[];
  const spendCategoryLinks = await fetchSpendCategoryLinks(supabase, spendRows.map((s) => s.id));
  return {
    settings: (settings.data ?? null) as Settings | null,
    projects: (projects.data ?? []) as Project[],
    payments: (payments.data ?? []) as Payment[],
    rates:    (rates.data ?? []) as ExchangeRate[],
    clients:  (clients.data ?? []) as Client[],
    spends: spendRows,
    spendCategories: (spendCategories.data ?? []) as SpendCategory[],
    spendCategoryLinks,
    recurring: (recurring.data ?? []) as RecurringSpend[],
    recurringSkips: (recurringSkips.data ?? []) as RecurringSpendSkip[],
  };
}

// Spending route: every shape needed to render the chain-modal-style entry +
// the headline totals + filters. Pulls payments/methods/rates so the route can
// run cashflow math against the same snapshot the Dashboard uses.
export async function getSpendingData() {
  const [supabase, user] = await Promise.all([createClient(), userOrThrow()]);
  const [
    spends,
    spendCategories,
    recurring,
    recurringSkips,
    loans,
    loanInstallments,
    withdrawals,
    methods,
    settings,
    currencies,
    rates,
    payments,
    openAiQuestions,
  ] = await Promise.all([
    supabase.from("spends").select("*").eq("user_id", user.id).order("spent_at", { ascending: false }),
    supabase.from("spend_categories").select("*").eq("user_id", user.id).order("sort_order"),
    supabase.from("recurring_spends").select("*").eq("user_id", user.id).order("label"),
    supabase.from("recurring_spend_skips").select("*"),
    supabase.from("loans").select("*").eq("user_id", user.id).order("status").order("borrowed_at", { ascending: false }),
    supabase.from("loan_installments").select("*").order("due_date"),
    supabase.from("withdrawals").select("*").eq("user_id", user.id).order("withdrawn_at", { ascending: false }),
    supabase.from("payment_methods").select("*").eq("user_id", user.id).order("archived").order("name"),
    supabase.from("settings").select("*").eq("user_id", user.id).maybeSingle(),
    supabase.from("currencies").select("*").order("code"),
    supabase.from("exchange_rates").select("*").eq("user_id", user.id),
    supabase.from("payments").select("*").eq("user_id", user.id).order("paid_at", { ascending: false }),
    supabase.from("ai_questions").select("*").eq("user_id", user.id)
      .is("answered_at", null).is("dismissed_at", null)
      .order("priority", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(5),
  ]);
  const spendRows = (spends.data ?? []) as Spend[];
  const paymentRows = (payments.data ?? []) as Payment[];
  const [spendCategoryLinks, spendItems, stepsByPayment] = await Promise.all([
    fetchSpendCategoryLinks(supabase, spendRows.map((s) => s.id)),
    (async () => {
      if (spendRows.length === 0) return [] as SpendItem[];
      const { data } = await supabase
        .from("spend_items")
        .select("*")
        .in("spend_id", spendRows.map((s) => s.id))
        .order("sort_order");
      return (data ?? []) as SpendItem[];
    })(),
    fetchStepsByPayment(supabase, paymentRows.map((p) => p.id)),
  ]);
  return {
    spends: spendRows,
    spendCategories: (spendCategories.data ?? []) as SpendCategory[],
    spendCategoryLinks,
    spendItems,
    recurring: (recurring.data ?? []) as RecurringSpend[],
    recurringSkips: (recurringSkips.data ?? []) as RecurringSpendSkip[],
    loans: (loans.data ?? []) as Loan[],
    loanInstallments: (loanInstallments.data ?? []) as LoanInstallment[],
    withdrawals: (withdrawals.data ?? []) as Withdrawal[],
    methods: (methods.data ?? []) as PaymentMethod[],
    settings: (settings.data ?? null) as Settings | null,
    currencies: (currencies.data ?? []) as Currency[],
    rates: (rates.data ?? []) as ExchangeRate[],
    payments: paymentRows,
    stepsByPayment,
    openAiQuestions: (openAiQuestions.data ?? []) as AiQuestion[],
  };
}

// Single-spend detail for the edit sheet (items + tag links).
export async function getSpendDetail(spendId: string) {
  const [supabase, user] = await Promise.all([createClient(), userOrThrow()]);
  const [spend, items, categoryLinks] = await Promise.all([
    supabase.from("spends").select("*").eq("user_id", user.id).eq("id", spendId).maybeSingle(),
    supabase.from("spend_items").select("*").eq("spend_id", spendId).order("sort_order"),
    supabase.from("spend_category_links").select("*").eq("spend_id", spendId),
  ]);
  return {
    spend: (spend.data ?? null) as Spend | null,
    items: (items.data ?? []) as SpendItem[],
    categoryLinks: (categoryLinks.data ?? []) as SpendCategoryLink[],
  };
}

// Settings recurring form: rules + their skip rows + the wallets/categories
// they reference for the dropdowns.
export async function getRecurringWithSkips() {
  const [supabase, user] = await Promise.all([createClient(), userOrThrow()]);
  const [recurring, skips, methods, categories] = await Promise.all([
    supabase.from("recurring_spends").select("*").eq("user_id", user.id).order("label"),
    supabase.from("recurring_spend_skips").select("*"),
    supabase.from("payment_methods").select("*").eq("user_id", user.id).order("archived").order("name"),
    supabase.from("spend_categories").select("*").eq("user_id", user.id).order("sort_order"),
  ]);
  return {
    recurring: (recurring.data ?? []) as RecurringSpend[],
    skips: (skips.data ?? []) as RecurringSpendSkip[],
    methods: (methods.data ?? []) as PaymentMethod[],
    categories: (categories.data ?? []) as SpendCategory[],
  };
}

// Loans panel: open-first sort, installments grouped via array, plus the
// spends already materialized from past installment payments (so the panel
// can compute "paid so far" without re-querying).
export async function getLoansWithInstallments() {
  const [supabase, user] = await Promise.all([createClient(), userOrThrow()]);
  const [loans, installments, spends, rates] = await Promise.all([
    supabase.from("loans").select("*").eq("user_id", user.id).order("status").order("borrowed_at", { ascending: false }),
    supabase.from("loan_installments").select("*").order("due_date"),
    supabase.from("spends").select("*").eq("user_id", user.id).not("loan_id", "is", null).order("spent_at", { ascending: false }),
    supabase.from("exchange_rates").select("*").eq("user_id", user.id),
  ]);
  return {
    loans: (loans.data ?? []) as Loan[],
    installments: (installments.data ?? []) as LoanInstallment[],
    spends: (spends.data ?? []) as Spend[],
    rates: (rates.data ?? []) as ExchangeRate[],
  };
}

// Raw memory header + entry log. consolidateUserMemory folds entries → header.
export async function getUserMemory() {
  const [supabase, user] = await Promise.all([createClient(), userOrThrow()]);
  const [memory, entries] = await Promise.all([
    supabase.from("user_memory").select("*").eq("user_id", user.id).maybeSingle(),
    supabase.from("user_memory_entries").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
  ]);
  return {
    memory: (memory.data ?? null) as UserMemory | null,
    entries: (entries.data ?? []) as UserMemoryEntry[],
  };
}

// Cache row for the safe-to-spend AI overlay. Null when no insight has been
// generated yet (overlay falls back to deterministic copy).
export async function getAiSafeSpendCacheRow() {
  const [supabase, user] = await Promise.all([createClient(), userOrThrow()]);
  const { data } = await supabase
    .from("ai_safe_spend_cache")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();
  return (data ?? null) as { user_id: string; insight: unknown; generated_at: string } | null;
}

// Open (unanswered + undismissed) AI questions for the life-OS question feed.
export async function getOpenAiQuestions(limit = 10) {
  const [supabase, user] = await Promise.all([createClient(), userOrThrow()]);
  const { data } = await supabase
    .from("ai_questions")
    .select("*")
    .eq("user_id", user.id)
    .is("answered_at", null)
    .is("dismissed_at", null)
    .order("priority", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as AiQuestion[];
}

// Closed AI questions — either answered or dismissed — newest first.
export async function getAiQuestionHistory(limit = 20) {
  const [supabase, user] = await Promise.all([createClient(), userOrThrow()]);
  const { data } = await supabase
    .from("ai_questions")
    .select("*")
    .eq("user_id", user.id)
    .or("answered_at.not.is.null,dismissed_at.not.is.null")
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as AiQuestion[];
}

// Holding wallets that need an opening balance entered (Settings first-time setup).
export async function getOpeningBalances() {
  const [supabase, user] = await Promise.all([createClient(), userOrThrow()]);
  const { data } = await supabase
    .from("payment_methods")
    .select("id,name,opening_balance_base,opening_balance_at")
    .eq("user_id", user.id)
    .eq("is_holding", true)
    .order("name");
  return (data ?? []) as Pick<
    PaymentMethod,
    "id" | "name" | "opening_balance_base" | "opening_balance_at"
  >[];
}

// Price intelligence rows for a normalized item name (price-typo guard + history).
// May return [] in Phase 1.5 since no seeding yet.
export async function getPriceIntelForItem(itemNameNorm: string) {
  const [supabase, user] = await Promise.all([createClient(), userOrThrow()]);
  const { data } = await supabase
    .from("price_intelligence")
    .select("*")
    .eq("user_id", user.id)
    .eq("item_name_norm", itemNameNorm)
    .order("last_seen_at", { ascending: false });
  return (data ?? []) as PriceIntelligenceRow[];
}

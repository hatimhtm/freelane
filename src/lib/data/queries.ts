import "server-only";

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { phtDateString } from "@/lib/utils";
import { BASE_CURRENCY_FALLBACK } from "@/lib/constants";
import type {
  CurrencyCode,
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
  PlannedSpend,
  PlanStrategy,
  CalmWeatherState,
  AppChangelogEntry,
  Vendor,
  VendorAlias,
  SpendVendorLink,
  PriceDriftObservation,
  Entity,
  SpendEntityLink,
  WifeState,
  IslamicCalendarRow,
  PhCulturalEventRow,
  EditorialLetter,
  Milestone,
  QuietReceipt,
  LifeShift,
  MorningLog,
  WellbeingCheckin,
  QuietChannel,
  RateInsight,
  ShouldIBuySession,
  VendorIconCacheRow,
  WalletPlatformMetadataRow,
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

async function fetchSpendVendorLinks(
  supabase: DbClient,
  spendIds: string[],
): Promise<SpendVendorLink[]> {
  if (spendIds.length === 0) return [];
  const { data } = await supabase
    .from("spend_vendor_links")
    .select("*")
    .in("spend_id", spendIds);
  return (data ?? []) as SpendVendorLink[];
}

async function fetchSpendEntityLinks(
  supabase: DbClient,
  spendIds: string[],
): Promise<SpendEntityLink[]> {
  if (spendIds.length === 0) return [];
  const { data } = await supabase
    .from("spend_entity_links")
    .select("*")
    .in("spend_id", spendIds);
  return (data ?? []) as SpendEntityLink[];
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
    plannedSpends,
    calmWeather,
  ] = await Promise.all([
    supabase.from("settings").select("*").eq("user_id", user.id).maybeSingle(),
    supabase.from("projects").select("*").eq("user_id", user.id).order("updated_at", { ascending: false }),
    supabase.from("payments").select("*").eq("user_id", user.id).order("paid_at", { ascending: false }),
    supabase.from("exchange_rates").select("*").eq("user_id", user.id),
    supabase.from("clients").select("*").eq("user_id", user.id).eq("archived", false).order("name"),
    supabase.from("currencies").select("*"),
    // No .eq("archived", false) filter on payment_methods — archived holding
    // wallets can still carry a balance, and dropping them here makes the
    // dashboard's safe-to-spend math disagree with Spending/Today/Plans
    // (each surface filters archived for display only).
    supabase.from("payment_methods").select("*").eq("user_id", user.id).order("archived").order("name"),
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
    supabase.from("planned_spends").select("*").eq("user_id", user.id).order("planned_for"),
    // calm-weather moved into ai_brain_cache (2026-06-02) — the payload column
    // carries the full CalmWeatherState shape that used to live in
    // calm_weather_state. The legacy table is no longer written.
    supabase
      .from("ai_brain_cache")
      .select("payload,generated_at,stale_at")
      .eq("user_id", user.id)
      .eq("brain_key", "calm_weather")
      .maybeSingle(),
  ]);

  // Migration 0089 — active strategies feed safe-to-spend so the
  // dashboard headline reflects the user's plan choices. We read after
  // the Promise.all batch above so the daily-safe surfaces (Income
  // Strip, Pack Rhythm, Wallet Runway) inherit the reduction.
  const activePlanStrategiesQ = await supabase
    .from("plan_strategies")
    .select("*")
    .eq("user_id", user.id)
    .eq("active", true);

  const paymentRows = (payments.data ?? []) as Payment[];
  const spendRows = (spends.data ?? []) as Spend[];
  const [
    stepsByPayment,
    spendCategoryLinks,
    paymentAllocations,
    spendItems,
    vendors,
    vendorAliases,
    spendVendorLinks,
    entities,
    spendEntityLinks,
    wifeState,
    islamicCalendar,
    phCulturalEvents,
  ] = await Promise.all([
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
    supabase.from("vendors").select("*").eq("user_id", user.id).eq("archived", false).order("canonical_name"),
    supabase.from("vendor_aliases").select("*"),
    fetchSpendVendorLinks(supabase, spendRows.map((s) => s.id)),
    supabase.from("entities").select("*").eq("user_id", user.id).eq("archived", false).order("canonical_name"),
    fetchSpendEntityLinks(supabase, spendRows.map((s) => s.id)),
    supabase.from("wife_state").select("*").eq("user_id", user.id).maybeSingle(),
    supabase.from("islamic_calendar").select("*").order("gregorian_date"),
    supabase.from("ph_cultural_events").select("*").order("gregorian_date"),
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
    plannedSpends: (plannedSpends.data ?? []) as PlannedSpend[],
    activePlanStrategies: (activePlanStrategiesQ.data ?? []) as PlanStrategy[],
    calmWeather: ((calmWeather.data?.payload as CalmWeatherState | undefined) ?? null) as CalmWeatherState | null,
    vendors: (vendors.data ?? []) as Vendor[],
    vendorAliases: (vendorAliases.data ?? []) as VendorAlias[],
    spendVendorLinks,
    entities: (entities.data ?? []) as Entity[],
    spendEntityLinks,
    wifeState: (wifeState.data ?? null) as WifeState | null,
    islamicCalendar: (islamicCalendar.data ?? []) as IslamicCalendarRow[],
    phCulturalEvents: (phCulturalEvents.data ?? []) as PhCulturalEventRow[],
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
    plannedSpends,
    calmWeather,
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
    supabase.from("planned_spends").select("*").eq("user_id", user.id).order("planned_for"),
    // calm-weather moved into ai_brain_cache (2026-06-02) — the payload column
    // carries the full CalmWeatherState shape that used to live in
    // calm_weather_state. The legacy table is no longer written.
    supabase
      .from("ai_brain_cache")
      .select("payload,generated_at,stale_at")
      .eq("user_id", user.id)
      .eq("brain_key", "calm_weather")
      .maybeSingle(),
  ]);
  const spendRows = (spends.data ?? []) as Spend[];
  const paymentRows = (payments.data ?? []) as Payment[];
  const [spendCategoryLinks, spendItems, stepsByPayment, activePlanStrategiesQ] = await Promise.all([
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
    // Migration 0089 — active strategies feed safe-to-spend so the
    // Spending dial inherits the daily-safe reduction.
    supabase
      .from("plan_strategies")
      .select("*")
      .eq("user_id", user.id)
      .eq("active", true),
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
    plannedSpends: (plannedSpends.data ?? []) as PlannedSpend[],
    activePlanStrategies: (activePlanStrategiesQ.data ?? []) as PlanStrategy[],
    calmWeather: ((calmWeather.data?.payload as CalmWeatherState | undefined) ?? null) as CalmWeatherState | null,
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
// generated yet (overlay falls back to deterministic copy). Sourced from
// ai_brain_cache as of 2026-06-02 — the legacy ai_safe_spend_cache table is
// retired. The legacy { user_id, insight, generated_at } shape is preserved
// at the call-site boundary so /today/page.tsx keeps reading the same fields.
// Spendings workflow (migration 0085) — PHT-anchored daily safe snapshot.
// Returns null when no snapshot has been written for today's PHT date yet;
// the upsert lives in src/lib/data/actions.ts (upsertDailySafeSnapshot).
export async function getDailySafeSnapshotForToday(): Promise<{
  initial_safe_base: number;
  currency: string;
  computed_at: string;
} | null> {
  const [supabase, user] = await Promise.all([createClient(), userOrThrow()]);
  const phtToday = phtDateString(new Date());
  const { data } = await supabase
    .from("daily_safe_snapshots")
    .select("initial_safe_base,currency,computed_at")
    .eq("user_id", user.id)
    .eq("pht_date", phtToday)
    .maybeSingle();
  if (!data) return null;
  return {
    initial_safe_base: Number(data.initial_safe_base ?? 0),
    currency: String(data.currency ?? "PHP"),
    computed_at: String(data.computed_at ?? ""),
  };
}

export async function getAiSafeSpendCacheRow() {
  const [supabase, user] = await Promise.all([createClient(), userOrThrow()]);
  const { data } = await supabase
    .from("ai_brain_cache")
    .select("payload,generated_at")
    .eq("user_id", user.id)
    .eq("brain_key", "safe_to_spend_ai")
    .maybeSingle();
  if (!data) return null;
  return {
    user_id: user.id,
    insight: data.payload as unknown,
    generated_at: data.generated_at as string,
  };
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

// ─────────────────────────── Tier 1 fetchers ──

// All planned spends (open + closed) — the /plans route shows everything,
// dashboard surfaces filter to active.
export async function getPlannedSpends() {
  const [supabase, user] = await Promise.all([createClient(), userOrThrow()]);
  const { data } = await supabase
    .from("planned_spends")
    .select("*")
    .eq("user_id", user.id)
    .order("planned_for");
  return (data ?? []) as PlannedSpend[];
}

// Full /plans page data — planned spends + everything safe-to-spend math
// needs to project the runway against them.
export async function getPlansData() {
  const [supabase, user] = await Promise.all([createClient(), userOrThrow()]);
  const [
    plannedSpends,
    planStrategies,
    spends,
    payments,
    withdrawals,
    methods,
    rates,
    recurring,
    recurringSkips,
    loanInstallments,
    spendCategories,
    settings,
    currencies,
    calmWeather,
  ] = await Promise.all([
    supabase.from("planned_spends").select("*").eq("user_id", user.id).order("planned_for"),
    // Migration 0089 — all proposed + active strategies for the user.
    // The detail sheet reads per-plan slices; the daily-safe math reads
    // the activePlanStrategies subset.
    supabase
      .from("plan_strategies")
      .select("*")
      .eq("user_id", user.id)
      .order("plan_id")
      .order("rank"),
    supabase.from("spends").select("*").eq("user_id", user.id).order("spent_at", { ascending: false }),
    supabase.from("payments").select("*").eq("user_id", user.id).order("paid_at", { ascending: false }),
    supabase.from("withdrawals").select("*").eq("user_id", user.id).order("withdrawn_at", { ascending: false }),
    // No .eq("archived", false) filter on payment_methods — see note in
    // getDashboardData. Filtering archived for display is a per-view concern.
    supabase.from("payment_methods").select("*").eq("user_id", user.id).order("archived").order("name"),
    supabase.from("exchange_rates").select("*").eq("user_id", user.id),
    supabase.from("recurring_spends").select("*").eq("user_id", user.id).order("label"),
    supabase.from("recurring_spend_skips").select("*"),
    supabase.from("loan_installments").select("*").order("due_date"),
    supabase.from("spend_categories").select("*").eq("user_id", user.id).order("sort_order"),
    supabase.from("settings").select("*").eq("user_id", user.id).maybeSingle(),
    supabase.from("currencies").select("*"),
    // calm-weather moved into ai_brain_cache (2026-06-02) — the payload column
    // carries the full CalmWeatherState shape that used to live in
    // calm_weather_state. The legacy table is no longer written.
    supabase
      .from("ai_brain_cache")
      .select("payload,generated_at,stale_at")
      .eq("user_id", user.id)
      .eq("brain_key", "calm_weather")
      .maybeSingle(),
  ]);
  const paymentRows = (payments.data ?? []) as Payment[];
  const stepsByPayment = await fetchStepsByPayment(supabase, paymentRows.map((p) => p.id));
  const strategies = (planStrategies.data ?? []) as PlanStrategy[];
  return {
    plannedSpends: (plannedSpends.data ?? []) as PlannedSpend[],
    planStrategies: strategies,
    // Slice of strategies the safe-to-spend math should reduce daily
    // surplus by. Read by every surface that calls
    // computeSafeToSpendFromData with activePlanStrategies.
    activePlanStrategies: strategies.filter((s) => s.active),
    spends: (spends.data ?? []) as Spend[],
    payments: paymentRows,
    stepsByPayment,
    withdrawals: (withdrawals.data ?? []) as Withdrawal[],
    methods: (methods.data ?? []) as PaymentMethod[],
    rates: (rates.data ?? []) as ExchangeRate[],
    recurring: (recurring.data ?? []) as RecurringSpend[],
    recurringSkips: (recurringSkips.data ?? []) as RecurringSpendSkip[],
    loanInstallments: (loanInstallments.data ?? []) as LoanInstallment[],
    spendCategories: (spendCategories.data ?? []) as SpendCategory[],
    settings: (settings.data ?? null) as Settings | null,
    currencies: (currencies.data ?? []) as Currency[],
    calmWeather: ((calmWeather.data?.payload as CalmWeatherState | undefined) ?? null) as CalmWeatherState | null,
  };
}

// Calm Weather state — single row per user. Now sourced from the canonical
// ai_brain_cache table (2026-06-02). The payload column carries the full
// CalmWeatherState shape that used to live in calm_weather_state.
export async function getCalmWeatherState() {
  const [supabase, user] = await Promise.all([createClient(), userOrThrow()]);
  const { data } = await supabase
    .from("ai_brain_cache")
    .select("payload")
    .eq("user_id", user.id)
    .eq("brain_key", "calm_weather")
    .maybeSingle();
  return ((data?.payload as CalmWeatherState | undefined) ?? null) as CalmWeatherState | null;
}

// Full app changelog feed — pinned first, then newest first. Single-author
// table (Hatim).
export async function getAppChangelog(limit = 50) {
  const [supabase, user] = await Promise.all([createClient(), userOrThrow()]);
  const { data } = await supabase
    .from("app_changelog")
    .select("*")
    .eq("author_id", user.id)
    .order("is_pinned", { ascending: false })
    .order("released_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as AppChangelogEntry[];
}

// ─────────────────────────── Tier 2 fetchers ──

// Light-weight "known vendors" projection for the SpendModal vendor
// row's inline dropdown. Vendors workflow (locked 2026-06-02):
//   "Vendor: text input + dropdown of matching known vendors. No AI in
//    critical path. On submit, the typed text either resolves to one of
//    these ids OR auto-creates a new vendor (which kicks off the
//    canonicalize-vendor brain in the background)."
// We hand back just id + display_name + slug + aliases so the client can
// fuzz-match by substring without paying for the full Vendor row weight.
export type KnownVendorOption = {
  id: string;
  display_name: string;
  slug: string;
  aliases: string[];
};

export async function getKnownVendorsForModal(): Promise<KnownVendorOption[]> {
  const [supabase, user] = await Promise.all([createClient(), userOrThrow()]);
  const { data } = await supabase
    .from("vendors")
    .select("id, canonical_name, raw_user_typed_name, slug, aliases")
    .eq("user_id", user.id)
    .eq("archived", false);
  const rows = (data ?? []) as Array<{
    id: string;
    canonical_name: string | null;
    raw_user_typed_name: string | null;
    slug: string | null;
    aliases: unknown;
  }>;
  return rows.map((v) => ({
    id: v.id,
    display_name:
      v.canonical_name ?? v.raw_user_typed_name ?? "Untitled vendor",
    slug: v.slug ?? "",
    aliases: Array.isArray(v.aliases)
      ? (v.aliases as unknown[]).filter(
          (a): a is string => typeof a === "string" && a.length > 0,
        )
      : [],
  }));
}

// All vendors + their aliases + the linked-spend rollup. Drives /vendors.
export async function getVendorsData() {
  const [supabase, user] = await Promise.all([createClient(), userOrThrow()]);
  const [vendors, aliases, links, spends, settings] = await Promise.all([
    supabase.from("vendors").select("*").eq("user_id", user.id).order("archived").order("canonical_name"),
    supabase.from("vendor_aliases").select("*"),
    supabase.from("spend_vendor_links").select("*"),
    supabase.from("spends").select("*").eq("user_id", user.id).order("spent_at", { ascending: false }),
    supabase.from("settings").select("*").eq("user_id", user.id).maybeSingle(),
  ]);
  return {
    vendors: (vendors.data ?? []) as Vendor[],
    aliases: (aliases.data ?? []) as VendorAlias[],
    links: (links.data ?? []) as SpendVendorLink[],
    spends: (spends.data ?? []) as Spend[],
    settings: (settings.data ?? null) as Settings | null,
  };
}

// Vendors workflow (/spending/vendors) data loader. Aggregates spends per
// vendor so the sub-view can render lifetime totals, spend counts, last
// visits, and surface the needs-identification queue in a separate
// collapsed section without round-tripping a second query.
//
// Display name uses coalesce(canonical_name, raw_user_typed_name) — the
// brain proposes a canonical form (overwritten on the row when confidence
// >= 0.6), but pre-identification we fall back to the raw text the user
// typed so the UI never shows a null.
export type VendorsSubviewRow = {
  vendor_id: string;
  display_name: string;
  spend_count: number;
  total_base: number;
  last_visit: string | null;
  confidence: number | null;
  archived: boolean;
  needs_identification: boolean;
  identification_skipped: boolean;
  // Pre-resolved canonical_name + brand_key + aliases from the
  // canonicalize-vendor brain. The "Needs identification" panel uses
  // them to seed the chatbot pill with the brain's existing chips
  // (instead of dispatching empty arrays and forcing a re-run on
  // every tap).
  canonical_name: string | null;
  brand_key: string | null;
  aliases: string[];
};

export type VendorsSubviewData = {
  needsIdentification: VendorsSubviewRow[];
  active: VendorsSubviewRow[];
  archived: VendorsSubviewRow[];
  vendorIconCache: VendorIconCacheRow[];
  baseCurrency: CurrencyCode;
};

export async function getVendorsSubviewData(): Promise<VendorsSubviewData> {
  const [supabase, user] = await Promise.all([createClient(), userOrThrow()]);
  const [vendors, links, spends, settings, iconCache] = await Promise.all([
    supabase.from("vendors").select("*").eq("user_id", user.id),
    supabase.from("spend_vendor_links").select("spend_id, vendor_id"),
    supabase
      .from("spends")
      .select("id, amount_base, spent_at")
      .eq("user_id", user.id),
    supabase.from("settings").select("base_currency").eq("user_id", user.id).maybeSingle(),
    supabase.from("vendor_icon_cache").select("*").eq("user_id", user.id),
  ]);
  const vendorRows = (vendors.data ?? []) as Vendor[];
  const linkRows = (links.data ?? []) as Array<{ spend_id: string; vendor_id: string }>;
  const spendRows = (spends.data ?? []) as Array<{
    id: string;
    amount_base: number | null;
    spent_at: string;
  }>;
  const spendById = new Map(spendRows.map((s) => [s.id, s] as const));

  type Agg = { count: number; total: number; last: string | null };
  const agg = new Map<string, Agg>();
  for (const link of linkRows) {
    const sp = spendById.get(link.spend_id);
    if (!sp) continue;
    const a = agg.get(link.vendor_id) ?? { count: 0, total: 0, last: null };
    a.count += 1;
    a.total += Number(sp.amount_base ?? 0);
    if (!a.last || sp.spent_at > a.last) a.last = sp.spent_at;
    agg.set(link.vendor_id, a);
  }

  const buildRow = (v: Vendor): VendorsSubviewRow => {
    const a = agg.get(v.id) ?? { count: 0, total: 0, last: null };
    const display =
      v.canonical_name ?? v.raw_user_typed_name ?? "Untitled vendor";
    return {
      vendor_id: v.id,
      display_name: display,
      spend_count: a.count,
      total_base: a.total,
      last_visit: a.last,
      confidence: v.confidence ?? null,
      archived: !!v.archived,
      needs_identification: !!v.needs_identification,
      identification_skipped: !!v.identification_skipped,
      canonical_name: v.canonical_name ?? null,
      brand_key: v.brand_key ?? null,
      aliases: Array.isArray(v.aliases) ? v.aliases : [],
    };
  };

  const all = vendorRows.map(buildRow);
  const needsIdentification = all
    .filter((r) => r.needs_identification && !r.identification_skipped && !r.archived)
    .sort((a, b) => b.total_base - a.total_base);
  const active = all
    .filter((r) => !r.archived && (!r.needs_identification || r.identification_skipped))
    .sort((a, b) => b.total_base - a.total_base);
  const archived = all
    .filter((r) => r.archived)
    .sort((a, b) => b.total_base - a.total_base);

  return {
    needsIdentification,
    active,
    archived,
    vendorIconCache: (iconCache.data ?? []) as VendorIconCacheRow[],
    baseCurrency: (settings.data?.base_currency ?? BASE_CURRENCY_FALLBACK) as CurrencyCode,
  };
}

// Single-vendor detail. Loads spends linked through spend_vendor_links so the
// detail page can compute heartbeat, drift, absence without a second pass.
export async function getVendorDetail(vendorId: string) {
  const [supabase, user] = await Promise.all([createClient(), userOrThrow()]);
  const [vendor, aliases, links, spends, items, settings, drifts] = await Promise.all([
    supabase.from("vendors").select("*").eq("id", vendorId).eq("user_id", user.id).maybeSingle(),
    supabase.from("vendor_aliases").select("*").eq("vendor_id", vendorId),
    supabase.from("spend_vendor_links").select("*").eq("vendor_id", vendorId),
    supabase.from("spends").select("*").eq("user_id", user.id),
    (async () => {
      const { data: linkRows } = await supabase
        .from("spend_vendor_links")
        .select("spend_id")
        .eq("vendor_id", vendorId);
      const ids = (linkRows ?? []).map((l) => l.spend_id as string);
      if (ids.length === 0) return [] as SpendItem[];
      const { data } = await supabase.from("spend_items").select("*").in("spend_id", ids).order("sort_order");
      return (data ?? []) as SpendItem[];
    })(),
    supabase.from("settings").select("*").eq("user_id", user.id).maybeSingle(),
    supabase.from("price_drift_observations").select("*").eq("vendor_id", vendorId).order("observed_at", { ascending: false }),
  ]);
  return {
    vendor: (vendor.data ?? null) as Vendor | null,
    aliases: (aliases.data ?? []) as VendorAlias[],
    links: (links.data ?? []) as SpendVendorLink[],
    spends: (spends.data ?? []) as Spend[],
    items,
    drifts: (drifts.data ?? []) as PriceDriftObservation[],
    settings: (settings.data ?? null) as Settings | null,
  };
}

// All entities + their links. Drives /entities.
export async function getEntitiesData() {
  const [supabase, user] = await Promise.all([createClient(), userOrThrow()]);
  const [entities, links, spends, settings] = await Promise.all([
    supabase.from("entities").select("*").eq("user_id", user.id).order("archived").order("canonical_name"),
    supabase.from("spend_entity_links").select("*"),
    supabase.from("spends").select("*").eq("user_id", user.id).order("spent_at", { ascending: false }),
    supabase.from("settings").select("*").eq("user_id", user.id).maybeSingle(),
  ]);
  return {
    entities: (entities.data ?? []) as Entity[],
    links: (links.data ?? []) as SpendEntityLink[],
    spends: (spends.data ?? []) as Spend[],
    settings: (settings.data ?? null) as Settings | null,
  };
}

export async function getEntityDetail(entityId: string) {
  const [supabase, user] = await Promise.all([createClient(), userOrThrow()]);
  const [entity, links, spends, settings] = await Promise.all([
    supabase.from("entities").select("*").eq("id", entityId).eq("user_id", user.id).maybeSingle(),
    supabase.from("spend_entity_links").select("*").eq("entity_id", entityId),
    supabase.from("spends").select("*").eq("user_id", user.id),
    supabase.from("settings").select("*").eq("user_id", user.id).maybeSingle(),
  ]);
  return {
    entity: (entity.data ?? null) as Entity | null,
    links: (links.data ?? []) as SpendEntityLink[],
    spends: (spends.data ?? []) as Spend[],
    settings: (settings.data ?? null) as Settings | null,
  };
}

// Wife state (one row per user).
export async function getWifeState() {
  const [supabase, user] = await Promise.all([createClient(), userOrThrow()]);
  const { data } = await supabase
    .from("wife_state")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();
  return (data ?? null) as WifeState | null;
}

// ─────────────────────────── Tier 3 fetchers ──

export async function getLetters(limit = 60) {
  const [supabase, user] = await Promise.all([createClient(), userOrThrow()]);
  const { data } = await supabase
    .from("letters")
    .select("*")
    .eq("user_id", user.id)
    .order("pinned", { ascending: false })
    .order("generated_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as EditorialLetter[];
}

export async function getLetterById(id: string) {
  const [supabase, user] = await Promise.all([createClient(), userOrThrow()]);
  const { data } = await supabase
    .from("letters")
    .select("*")
    .eq("user_id", user.id)
    .eq("id", id)
    .maybeSingle();
  return (data ?? null) as EditorialLetter | null;
}

export async function getMilestones(limit = 80) {
  const [supabase, user] = await Promise.all([createClient(), userOrThrow()]);
  const { data } = await supabase
    .from("milestones")
    .select("*")
    .eq("user_id", user.id)
    .order("achieved_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as Milestone[];
}

export async function getQuietReceipts(limit = 80) {
  const [supabase, user] = await Promise.all([createClient(), userOrThrow()]);
  const { data } = await supabase
    .from("quiet_receipts")
    .select("*")
    .eq("user_id", user.id)
    .order("occurred_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as QuietReceipt[];
}

export async function getLifeShifts(limit = 80) {
  const [supabase, user] = await Promise.all([createClient(), userOrThrow()]);
  const { data } = await supabase
    .from("life_shifts")
    .select("*")
    .eq("user_id", user.id)
    .order("occurred_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as LifeShift[];
}

// /letters page: letters + life shifts together (tabs).
export async function getLettersPageData() {
  const [letters, milestones, receipts, shifts] = await Promise.all([
    getLetters(60),
    getMilestones(80),
    getQuietReceipts(80),
    getLifeShifts(80),
  ]);
  return { letters, milestones, receipts, shifts };
}

// Islamic + PH cultural calendar rows (reference data, RLS=public read).
export async function getCulturalCalendars() {
  const supabase = await createClient();
  const [islamic, phCultural] = await Promise.all([
    supabase.from("islamic_calendar").select("*").order("gregorian_date"),
    supabase.from("ph_cultural_events").select("*").order("gregorian_date"),
  ]);
  return {
    islamic: (islamic.data ?? []) as IslamicCalendarRow[],
    phCultural: (phCultural.data ?? []) as PhCulturalEventRow[],
  };
}

// ─────────────────────────── Tier 4 fetchers ──

export async function getTodayMorningLog() {
  const [supabase, user] = await Promise.all([createClient(), userOrThrow()]);
  const { phtToday } = await import("@/lib/utils");
  const today = phtToday();
  const { data } = await supabase
    .from("morning_log")
    .select("*")
    .eq("user_id", user.id)
    .eq("recorded_at", today)
    .maybeSingle();
  return (data ?? null) as MorningLog | null;
}

// Note: the weekly intent_mirror reader was removed once the diary surface
// (one row per PHT day) became the canonical "today's reflection" entry
// point. The legacy `finance.intent_mirror` table itself stays for one
// release window so existing rows don't vanish — a follow-up migration will
// drop it. Don't re-introduce a reader here.

// T11 — daily diary (replaces weekly intent mirror surface). One row per
// (user, day). entryDate format: YYYY-MM-DD in PHT.

export type DiaryEntry = {
  id: string;
  user_id: string;
  entry_date: string;
  body: string;
  mood: number | null;
  energy: number | null;
  created_at: string;
  updated_at: string;
};

export async function getDiaryEntry(entryDate: string): Promise<DiaryEntry | null> {
  const [supabase, user] = await Promise.all([createClient(), userOrThrow()]);
  const { data } = await supabase
    .from("diary_entries")
    .select("*")
    .eq("user_id", user.id)
    .eq("entry_date", entryDate)
    .maybeSingle();
  return (data ?? null) as DiaryEntry | null;
}

export async function getRecentDiaryEntries(limit = 30): Promise<DiaryEntry[]> {
  const [supabase, user] = await Promise.all([createClient(), userOrThrow()]);
  const { data } = await supabase
    .from("diary_entries")
    .select("*")
    .eq("user_id", user.id)
    .order("entry_date", { ascending: false })
    .limit(limit);
  return ((data ?? []) as DiaryEntry[]);
}

// ─────────────────────────── Tier 5 fetchers ──

export async function getCurrentWellbeingCheckin() {
  const [supabase, user] = await Promise.all([createClient(), userOrThrow()]);
  const { phtToday, phtDateString } = await import("@/lib/utils");
  const today = new Date(phtToday());
  const dow = today.getDay() || 7;
  const monday = new Date(today.getTime() - (dow - 1) * 86_400_000);
  const weekStarts = phtDateString(monday);
  const { data } = await supabase
    .from("wellbeing_checkins")
    .select("*")
    .eq("user_id", user.id)
    .eq("week_starts", weekStarts)
    .maybeSingle();
  return (data ?? null) as WellbeingCheckin | null;
}

export async function getOpenQuietChannels(limit = 10) {
  const [supabase, user] = await Promise.all([createClient(), userOrThrow()]);
  const { data } = await supabase
    .from("quiet_channels")
    .select("*")
    .eq("user_id", user.id)
    .is("resolved_at", null)
    .order("silence_days", { ascending: false })
    .limit(limit);
  return (data ?? []) as QuietChannel[];
}

export async function getOpenQuietChannelForClient(clientId: string) {
  const [supabase, user] = await Promise.all([createClient(), userOrThrow()]);
  const { data } = await supabase
    .from("quiet_channels")
    .select("*")
    .eq("user_id", user.id)
    .eq("client_id", clientId)
    .is("resolved_at", null)
    .order("detected_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data ?? null) as QuietChannel | null;
}

export async function getRateInsights(limit = 40) {
  const [supabase, user] = await Promise.all([createClient(), userOrThrow()]);
  const { data } = await supabase
    .from("rate_insights")
    .select("*")
    .eq("user_id", user.id)
    .order("generated_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as RateInsight[];
}

export async function getRateInsightsForClient(clientId: string, limit = 6) {
  const [supabase, user] = await Promise.all([createClient(), userOrThrow()]);
  const { data } = await supabase
    .from("rate_insights")
    .select("*")
    .eq("user_id", user.id)
    .eq("client_id", clientId)
    .order("generated_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as RateInsight[];
}

// ─── Clients workflow — Facts panel + pattern-change timeline ─────────────
// Facts: live (non-archived) rows from ai_user_facts for the client. The
// facts panel renders these in confidence order; brains read them via the
// server-only getFactsForSubject helper. We keep the query here so the
// detail page can pass facts straight into the panel without re-querying.

export type ClientFactRow = {
  id: string;
  key: string;
  value: Record<string, unknown> | null;
  confidence: number;
  source: "user_answered" | "inferred" | "seeded";
  evidence: string | null;
  updated_at: string;
};

export async function getClientFacts(clientId: string): Promise<ClientFactRow[]> {
  const [supabase, user] = await Promise.all([createClient(), userOrThrow()]);
  const { data } = await supabase
    .from("ai_user_facts")
    .select("id,key,value,confidence,source,evidence,updated_at")
    .eq("user_id", user.id)
    .eq("subject_kind", "client")
    .eq("subject_id", clientId)
    .is("archived_at", null)
    .order("confidence", { ascending: false });
  return ((data ?? []) as unknown) as ClientFactRow[];
}

// Pattern-change timeline: a chronological union of answered open-questions
// AND dispatched client_pattern_change notifications for this client.
// Two row sources, one merged result so the detail-sheet timeline shows
// both "the brain asked" and "you answered" without a second query.
export type ClientPatternHistoryRow = {
  id: string;
  source: "notification" | "open_question";
  pattern_kind: string | null;
  summary: string | null;
  question: string | null;
  answer: string | null;
  created_at: string;
};

export async function getClientPatternHistory(
  clientId: string,
  limit = 20,
): Promise<ClientPatternHistoryRow[]> {
  const [supabase, user] = await Promise.all([createClient(), userOrThrow()]);
  const [{ data: notifications }, { data: questions }] = await Promise.all([
    // Push the client_id filter into Postgres via a jsonb path expression
    // so the inbox table doesn't get rescanned in JS on every detail-sheet
    // render. The defensive JS filter below stays in place as a guard
    // against payloads written before kind_specific.client_id existed.
    supabase
      .from("notifications_inbox")
      .select("id,subject,body,payload,answer,created_at")
      .eq("user_id", user.id)
      .eq("kind", "client_pattern_change")
      .filter("payload->kind_specific->>client_id", "eq", clientId)
      .order("created_at", { ascending: false })
      .limit(limit),
    supabase
      .from("ai_open_questions")
      .select("id,question_text,suggested_answers,fact_key,status,answered_at,created_at")
      .eq("user_id", user.id)
      .eq("subject_kind", "client")
      .eq("subject_id", clientId)
      .eq("status", "answered")
      .order("answered_at", { ascending: false })
      .limit(limit),
  ]);

  const fromNotifications: ClientPatternHistoryRow[] = (notifications ?? [])
    .filter((n) => {
      // Defensive secondary filter — payloads pre-dating kind_specific
      // may not carry client_id; skip them rather than mis-attribute.
      const payload = (n.payload ?? {}) as {
        kind_specific?: { client_id?: string };
      };
      return payload.kind_specific?.client_id === clientId;
    })
    .map((n) => {
      const payload = (n.payload ?? {}) as {
        kind_specific?: {
          pattern_kind?: string;
          summary?: string;
          question?: string;
        };
      };
      const answer = (n.answer ?? null) as
        | { kind?: string; value?: string }
        | string
        | null;
      const answerText =
        typeof answer === "string"
          ? answer
          : (answer?.value as string | undefined) ?? null;
      return {
        id: n.id as string,
        source: "notification" as const,
        pattern_kind: (payload.kind_specific?.pattern_kind as string) ?? null,
        summary: (payload.kind_specific?.summary as string) ?? (n.body as string) ?? null,
        question: (payload.kind_specific?.question as string) ?? null,
        answer: answerText,
        created_at: n.created_at as string,
      };
    });

  // Open-questions store the actual chosen answer in ai_user_facts (one
  // row per fact_key). Pull the matching facts in a single batched query
  // so the timeline can show "You said: …" for these rows too — without
  // it, the open-question branch surfaces question text with no payoff,
  // which is exactly the data point worth seeing.
  const factKeys = Array.from(
    new Set(
      (questions ?? [])
        .map((q) => (q.fact_key as string | null) ?? null)
        .filter((k): k is string => !!k),
    ),
  );
  const answersByKey = new Map<string, string>();
  if (factKeys.length > 0) {
    const { data: facts } = await supabase
      .from("ai_user_facts")
      .select("key,value")
      .eq("user_id", user.id)
      .eq("subject_kind", "client")
      .eq("subject_id", clientId)
      .in("key", factKeys)
      .is("archived_at", null);
    for (const f of facts ?? []) {
      const value = (f.value ?? {}) as { answer?: unknown };
      if (typeof value.answer === "string") {
        answersByKey.set(f.key as string, value.answer);
      }
    }
  }

  const fromQuestions: ClientPatternHistoryRow[] = (questions ?? []).map((q) => ({
    id: q.id as string,
    source: "open_question" as const,
    pattern_kind: (q.fact_key as string) ?? null,
    summary: null,
    question: (q.question_text as string) ?? null,
    answer: answersByKey.get((q.fact_key as string) ?? "") ?? null,
    created_at: (q.answered_at as string) ?? (q.created_at as string),
  }));

  return [...fromNotifications, ...fromQuestions]
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, limit);
}

// Open client_pattern_change notifications per client — batched lookup
// used by the clients page to derive a pattern_changed pill on each card.
// The select includes a `not.is` guard on payload->kind_specific->>client_id
// so the row count is bounded to rows that actually carry the field; the
// per-row JS still extracts the value because PostgREST can't return the
// jsonb path expression in the select list.
export async function getOpenClientPatternChangeMap(): Promise<Map<string, string>> {
  const [supabase, user] = await Promise.all([createClient(), userOrThrow()]);
  const { data } = await supabase
    .from("notifications_inbox")
    .select("payload,created_at")
    .eq("user_id", user.id)
    .eq("kind", "client_pattern_change")
    .is("read_at", null)
    .is("dismissed_at", null)
    .not("payload->kind_specific->>client_id", "is", null)
    .order("created_at", { ascending: false });
  const map = new Map<string, string>();
  for (const row of data ?? []) {
    const payload = (row.payload ?? {}) as {
      kind_specific?: { client_id?: string; pattern_kind?: string };
    };
    const clientId = payload.kind_specific?.client_id;
    const patternKind = payload.kind_specific?.pattern_kind ?? "shift";
    if (clientId && !map.has(clientId)) map.set(clientId, patternKind);
  }
  return map;
}

export async function getShouldIBuySessions(limit = 30) {
  const [supabase, user] = await Promise.all([createClient(), userOrThrow()]);
  const { data } = await supabase
    .from("should_i_buy_sessions")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as ShouldIBuySession[];
}

// ─── Dashboard stats chips (Phase 1.5) ───────────────────────────────────
//
// Years with ANY LifeOS activity — money_ledger rows OR diary entries.
// The Dashboard header renders a [Lifetime] chip followed by one chip per
// active year, each linking to the corresponding /stats scope.

// Memoized per request so a Dashboard sub-page render that fans into Money +
// State + Body + Commitments (or a layout that prefetches all four) only
// pays for the round trip once. The set of active years changes at most
// once per day per user, so per-request memoization is the right scope —
// no cross-request stale risk.
//
// Year derivation: money_ledger.event_at is timestamptz (PostgREST returns
// UTC ISO 8601). For a PHT user a row stamped at 2026-01-01 02:00 PHT is
// 2025-12-31T18:00:00Z, so a raw .slice(0, 4) would attribute it to 2025.
// We pass every event_at through phtDateString() before slicing so the
// year matches the user's PHT calendar.
//
// Bounded fetch: PostgREST defaults to 1000 rows; for old accounts that
// could silently truncate the oldest years. We .order('event_at') asc and
// pull only the first occurrence per year by walking the result set with
// a Set early-exit. event_at is index-covered (money_ledger_user_event_idx
// in 0067) so the asc scan is cheap and we don't need an explicit RPC.
export const getDashboardActiveYears = cache(
  async function getDashboardActiveYears(): Promise<number[]> {
    const [supabase, user] = await Promise.all([createClient(), userOrThrow()]);
    const set = new Set<number>();

    // Page through money_ledger via PostgREST range headers so we don't lose
    // the oldest events to the default 1000-row cap. Each page is cheap
    // (event_at-only) and we early-exit once we've collected one row per
    // year-bucket the user could plausibly have.
    const PAGE = 1000;
    let from = 0;
    let lastSize = PAGE;
    while (lastSize === PAGE) {
      const { data } = await supabase
        .from("money_ledger")
        .select("event_at")
        .eq("user_id", user.id)
        .is("archived_at", null)
        .order("event_at", { ascending: true })
        .range(from, from + PAGE - 1);
      const rows = data ?? [];
      lastSize = rows.length;
      from += rows.length;
      for (const row of rows) {
        const at = row.event_at as string | null;
        if (!at) continue;
        const phtDay = phtDateString(new Date(at));
        const year = Number(phtDay.slice(0, 4));
        if (year > 0) set.add(year);
      }
      // Defensive cap: a single user shouldn't have > 10 pages worth here.
      if (from > PAGE * 50) break;
    }

    // Diary entries are date-only (no TZ) — slice is honest.
    const { data: diaryYears } = await supabase
      .from("diary_entries")
      .select("entry_date")
      .eq("user_id", user.id);
    for (const row of diaryYears ?? []) {
      const at = row.entry_date as string | null;
      if (!at) continue;
      const match = /^(\d{4})/.exec(at);
      if (match) {
        const year = Number(match[1]);
        if (year > 0) set.add(year);
      }
    }

    return Array.from(set).sort((a, b) => b - a);
  },
);

// ─────────────────────────── Brand Identity workflow fetchers ──

// Per-user vendor icon cache rows. Read by PaymentsView / SpendingView /
// VendorsView so the resolveVendorIcon resolver picks up tier-2 AI hits
// without an N+1 round-trip per spend row.
export const getVendorIconCache = cache(
  async (): Promise<VendorIconCacheRow[]> => {
    const [supabase, user] = await Promise.all([createClient(), userOrThrow()]);
    const { data } = await supabase
      .from("vendor_icon_cache")
      .select("*")
      .eq("user_id", user.id);
    return (data ?? []) as VendorIconCacheRow[];
  },
);

// Reference-data table — wallet platform metadata. Read-all RLS policy
// means any authenticated user can fetch every row; we filter by the
// brand_keys the caller cares about so the chatbot context payload
// stays tight. Wrapped in React `cache()` so request-scoped dedupe
// kicks in across callers (today the chatbot fetcher; a wallet detail
// sheet or withdrawal modal could read it next without an extra round
// trip). cache() keys on argument identity, so passing the same array
// reference at multiple call sites is fine — distinct arrays dedupe on
// identity, not contents.
export const getWalletPlatformMetadata = cache(
  async (brandKeys?: string[]): Promise<WalletPlatformMetadataRow[]> => {
    const supabase = await createClient();
    let q = supabase.from("wallet_platform_metadata").select("*");
    if (brandKeys && brandKeys.length > 0) {
      q = q.in("brand_key", brandKeys);
    }
    const { data } = await q;
    return (data ?? []) as WalletPlatformMetadataRow[];
  },
);

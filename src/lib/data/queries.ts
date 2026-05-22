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

export async function getDashboardData() {
  const [supabase, user] = await Promise.all([createClient(), userOrThrow()]);

  const [settings, projects, payments, rates, clients, currencies, methods] =
    await Promise.all([
      supabase.from("settings").select("*").eq("user_id", user.id).maybeSingle(),
      supabase.from("projects").select("*").eq("user_id", user.id).order("updated_at", { ascending: false }),
      supabase.from("payments").select("*").eq("user_id", user.id).order("paid_at", { ascending: false }),
      supabase.from("exchange_rates").select("*").eq("user_id", user.id),
      supabase.from("clients").select("*").eq("user_id", user.id).eq("archived", false).order("name"),
      supabase.from("currencies").select("*"),
      supabase.from("payment_methods").select("*").eq("user_id", user.id).eq("archived", false).order("name"),
    ]);

  const paymentRows = (payments.data ?? []) as Payment[];
  const stepsByPayment = await fetchStepsByPayment(supabase, paymentRows.map((p) => p.id));

  return {
    settings: (settings.data ?? null) as Settings | null,
    projects: (projects.data ?? []) as Project[],
    payments: paymentRows,
    stepsByPayment,
    rates:    (rates.data ?? []) as ExchangeRate[],
    clients:  (clients.data ?? []) as Client[],
    currencies: (currencies.data ?? []) as Currency[],
    methods:  (methods.data ?? []) as PaymentMethod[],
  };
}

// Pending = unpaid + partially-paid projects, for the "Blocked Money" view.
export async function getPendingData() {
  const [supabase, user] = await Promise.all([createClient(), userOrThrow()]);
  const [projects, clients, payments, rates, settings] = await Promise.all([
    supabase.from("projects").select("*").eq("user_id", user.id)
      .in("status", ["unpaid", "partially_paid"]).order("quoted_at"),
    supabase.from("clients").select("*").eq("user_id", user.id).order("name"),
    supabase.from("payments").select("*").eq("user_id", user.id),
    supabase.from("exchange_rates").select("*").eq("user_id", user.id),
    supabase.from("settings").select("*").eq("user_id", user.id).maybeSingle(),
  ]);
  return {
    projects: (projects.data ?? []) as Project[],
    clients:  (clients.data ?? []) as Client[],
    payments: (payments.data ?? []) as Payment[],
    rates:    (rates.data ?? []) as ExchangeRate[],
    settings: (settings.data ?? null) as Settings | null,
  };
}

// Payments hub: payments + their chains + methods + projects/clients + rates.
export async function getPaymentsData() {
  const [supabase, user] = await Promise.all([createClient(), userOrThrow()]);
  const [payments, projects, clients, rates, methods, settings, currencies] = await Promise.all([
    supabase.from("payments").select("*").eq("user_id", user.id).order("paid_at", { ascending: false }),
    supabase.from("projects").select("*").eq("user_id", user.id),
    supabase.from("clients").select("*").eq("user_id", user.id).order("name"),
    supabase.from("exchange_rates").select("*").eq("user_id", user.id),
    supabase.from("payment_methods").select("*").eq("user_id", user.id).eq("archived", false).order("name"),
    supabase.from("settings").select("*").eq("user_id", user.id).maybeSingle(),
    supabase.from("currencies").select("*").order("code"),
  ]);
  const paymentRows = (payments.data ?? []) as Payment[];
  const stepsByPayment = await fetchStepsByPayment(supabase, paymentRows.map((p) => p.id));
  return {
    payments: paymentRows,
    stepsByPayment,
    projects: (projects.data ?? []) as Project[],
    clients:  (clients.data ?? []) as Client[],
    rates:    (rates.data ?? []) as ExchangeRate[],
    methods:  (methods.data ?? []) as PaymentMethod[],
    settings: (settings.data ?? null) as Settings | null,
    currencies: (currencies.data ?? []) as Currency[],
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
  const [settings, projects, payments, rates, clients] = await Promise.all([
    supabase.from("settings").select("*").eq("user_id", user.id).maybeSingle(),
    supabase.from("projects").select("*").eq("user_id", user.id),
    supabase.from("payments").select("*").eq("user_id", user.id).order("paid_at", { ascending: false }),
    supabase.from("exchange_rates").select("*").eq("user_id", user.id),
    supabase.from("clients").select("*").eq("user_id", user.id),
  ]);
  return {
    settings: (settings.data ?? null) as Settings | null,
    projects: (projects.data ?? []) as Project[],
    payments: (payments.data ?? []) as Payment[],
    rates:    (rates.data ?? []) as ExchangeRate[],
    clients:  (clients.data ?? []) as Client[],
  };
}

import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import type {
  Client,
  Project,
  Payment,
  Settings,
  ExchangeRate,
  Invoice,
  Category,
  Currency,
  ProjectTemplate,
  ActivityEvent,
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

export async function getDashboardData() {
  const [supabase, user] = await Promise.all([createClient(), userOrThrow()]);

  const [settings, projects, payments, rates, clients, currencies, invoices] = await Promise.all([
    supabase.from("settings").select("*").eq("user_id", user.id).maybeSingle(),
    supabase.from("projects").select("*").eq("user_id", user.id).order("updated_at", { ascending: false }),
    supabase.from("payments").select("*").eq("user_id", user.id).order("paid_at", { ascending: false }),
    supabase.from("exchange_rates").select("*").eq("user_id", user.id),
    supabase.from("clients").select("*").eq("user_id", user.id).eq("archived", false).order("name"),
    supabase.from("currencies").select("*"),
    supabase.from("invoices").select("*").eq("user_id", user.id).order("issue_date", { ascending: false }),
  ]);

  return {
    settings: (settings.data ?? null) as Settings | null,
    projects: (projects.data ?? []) as Project[],
    payments: (payments.data ?? []) as Payment[],
    rates:    (rates.data ?? []) as ExchangeRate[],
    clients:  (clients.data ?? []) as Client[],
    currencies: (currencies.data ?? []) as Currency[],
    invoices: (invoices.data ?? []) as Invoice[],
  };
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

export async function getProjectsWithClients() {
  const [supabase, user] = await Promise.all([createClient(), userOrThrow()]);

  const [projects, clients, payments, categories, templates] = await Promise.all([
    supabase.from("projects").select("*").eq("user_id", user.id)
      .order("kanban_position").order("created_at"),
    supabase.from("clients").select("*").eq("user_id", user.id).eq("archived", false).order("name"),
    supabase.from("payments").select("*").eq("user_id", user.id),
    supabase.from("categories").select("*").eq("user_id", user.id),
    supabase.from("project_templates").select("*").eq("user_id", user.id).order("name"),
  ]);

  return {
    projects:   (projects.data ?? []) as Project[],
    clients:    (clients.data ?? []) as Client[],
    payments:   (payments.data ?? []) as Payment[],
    categories: (categories.data ?? []) as Category[],
    templates:  (templates.data ?? []) as ProjectTemplate[],
  };
}

export async function getSettings() {
  const [supabase, user] = await Promise.all([createClient(), userOrThrow()]);
  const [settings, rates, currencies] = await Promise.all([
    supabase.from("settings").select("*").eq("user_id", user.id).maybeSingle(),
    supabase.from("exchange_rates").select("*").eq("user_id", user.id).order("code"),
    supabase.from("currencies").select("*").order("code"),
  ]);
  return {
    settings:   (settings.data ?? null) as Settings | null,
    rates:      (rates.data ?? []) as ExchangeRate[],
    currencies: (currencies.data ?? []) as Currency[],
  };
}

export async function getInvoicesWithClients() {
  const [supabase, user] = await Promise.all([createClient(), userOrThrow()]);
  const [invoices, clients] = await Promise.all([
    supabase.from("invoices").select("*").eq("user_id", user.id).order("issue_date", { ascending: false }),
    supabase.from("clients").select("*").eq("user_id", user.id).order("name"),
  ]);
  return {
    invoices: (invoices.data ?? []) as Invoice[],
    clients:  (clients.data ?? []) as Client[],
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

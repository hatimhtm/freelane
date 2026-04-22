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

  const [settings, projects, payments, rates, clients, currencies] = await Promise.all([
    supabase.from("settings").select("*").eq("user_id", user.id).maybeSingle(),
    supabase.from("projects").select("*").eq("user_id", user.id).order("updated_at", { ascending: false }),
    supabase.from("payments").select("*").eq("user_id", user.id).order("paid_at", { ascending: false }),
    supabase.from("exchange_rates").select("*").eq("user_id", user.id),
    supabase.from("clients").select("*").eq("user_id", user.id).eq("archived", false).order("name"),
    supabase.from("currencies").select("*"),
  ]);

  return {
    settings: (settings.data ?? null) as Settings | null,
    projects: (projects.data ?? []) as Project[],
    payments: (payments.data ?? []) as Payment[],
    rates:    (rates.data ?? []) as ExchangeRate[],
    clients:  (clients.data ?? []) as Client[],
    currencies: (currencies.data ?? []) as Currency[],
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

  const [projects, clients, payments, categories] = await Promise.all([
    supabase.from("projects").select("*").eq("user_id", user.id)
      .order("kanban_position").order("created_at"),
    supabase.from("clients").select("*").eq("user_id", user.id).eq("archived", false).order("name"),
    supabase.from("payments").select("*").eq("user_id", user.id),
    supabase.from("categories").select("*").eq("user_id", user.id),
  ]);

  return {
    projects:   (projects.data ?? []) as Project[],
    clients:    (clients.data ?? []) as Client[],
    payments:   (payments.data ?? []) as Payment[],
    categories: (categories.data ?? []) as Category[],
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

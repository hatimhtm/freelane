"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logEvent } from "@/lib/data/events";
import type { ProjectStatus } from "@/lib/supabase/types";

async function userOrThrow() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthenticated");
  return { supabase, userId: user.id };
}

// ───────────────────────────────────────── Clients ──
export type ClientInput = {
  name: string;
  company?: string;
  address?: string;
  city?: string;
  country?: string;
  ice?: string;
  rc?: string;
  tax_id?: string;
  bank_name?: string;
  bank_account?: string;
  iban?: string;
  swift?: string;
  email?: string;
  phone?: string;
  default_currency?: string;
  notes?: string;
};

export async function createClientRecord(input: ClientInput) {
  const { supabase, userId } = await userOrThrow();
  const { error, data } = await supabase
    .from("clients")
    .insert({ ...input, user_id: userId })
    .select("id")
    .single();
  if (error) throw error;
  await logEvent({
    userId,
    kind: "client.created",
    title: `Added client · ${input.name}`,
    entityType: "client",
    entityId: data.id as string,
    clientId: data.id as string,
  });
  revalidatePath("/clients");
  revalidatePath("/projects");
  revalidatePath("/dashboard");
  return data;
}

export async function updateClientRecord(id: string, input: Partial<ClientInput>) {
  const { supabase, userId } = await userOrThrow();
  const { error } = await supabase.from("clients").update(input).eq("id", id);
  if (error) throw error;
  await logEvent({
    userId,
    kind: "client.updated",
    title: `Updated client · ${input.name ?? ""}`.trim(),
    entityType: "client",
    entityId: id,
    clientId: id,
  });
  revalidatePath("/clients");
  revalidatePath("/projects");
}

export async function archiveClient(id: string, archived = true) {
  const { supabase, userId } = await userOrThrow();
  const { error } = await supabase.from("clients").update({ archived }).eq("id", id);
  if (error) throw error;
  await logEvent({
    userId,
    kind: "client.archived",
    title: archived ? "Archived client" : "Unarchived client",
    entityType: "client",
    entityId: id,
    clientId: id,
    metadata: { archived },
  });
  revalidatePath("/clients");
}

export async function deleteClient(id: string) {
  const { supabase, userId } = await userOrThrow();
  const { error } = await supabase.from("clients").delete().eq("id", id);
  if (error) throw error;
  await logEvent({
    userId,
    kind: "client.deleted",
    title: "Deleted client",
    entityType: "client",
    entityId: id,
  });
  revalidatePath("/clients");
  revalidatePath("/projects");
  revalidatePath("/dashboard");
}

// ───────────────────────────────────────── Projects ──
export type ProjectInput = {
  client_id: string;
  title: string;
  description?: string;
  amount: number;
  currency: string;
  status?: ProjectStatus;
  due_date?: string | null;
  category_id?: string | null;
  tags?: string[];
};

export async function createProject(input: ProjectInput) {
  const { supabase, userId } = await userOrThrow();
  const status = input.status ?? "unpaid";
  const extras: Record<string, unknown> = {};
  if (status === "paid") extras.completed_at = new Date().toISOString().slice(0, 10);

  const { error, data } = await supabase
    .from("projects")
    .insert({ ...input, ...extras, user_id: userId, status })
    .select("id")
    .single();
  if (error) throw error;

  // Creating a project directly in "paid" status (unusual but possible) should
  // also log a payment so the dashboard credits the earnings.
  if (status === "paid" && input.amount > 0) {
    await supabase.from("payments").insert({
      user_id: userId,
      project_id: data.id as string,
      amount: input.amount,
      currency: input.currency,
      paid_at: new Date().toISOString().slice(0, 10),
      method: "Marked paid",
    });
  }

  await logEvent({
    userId,
    kind: "project.created",
    title: `New project · ${input.title}`,
    entityType: "project",
    entityId: data.id as string,
    clientId: input.client_id,
    metadata: { amount: input.amount, currency: input.currency, status },
  });
  revalidatePath("/projects");
  revalidatePath("/payments");
  revalidatePath("/dashboard");
  return data;
}

export async function updateProject(id: string, input: Partial<ProjectInput>) {
  const { supabase, userId } = await userOrThrow();
  const { error } = await supabase.from("projects").update(input).eq("id", id);
  if (error) throw error;
  await logEvent({
    userId,
    kind: "project.updated",
    title: `Updated project${input.title ? ` · ${input.title}` : ""}`,
    entityType: "project",
    entityId: id,
    clientId: input.client_id,
  });
  revalidatePath("/projects");
  revalidatePath("/dashboard");
}

export async function updateProjectStatus(id: string, status: ProjectStatus, kanbanPosition?: number) {
  const { supabase, userId } = await userOrThrow();
  const patch: Record<string, unknown> = { status };
  if (typeof kanbanPosition === "number") patch.kanban_position = kanbanPosition;
  if (status === "paid") patch.completed_at = new Date().toISOString().slice(0, 10);
  const { error } = await supabase.from("projects").update(patch).eq("id", id);
  if (error) throw error;

  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  // When status flips to "paid", auto-create a payment for any outstanding
  // amount so the dashboard totals, charts, and top-clients all reflect it.
  // Without this, the payments table stays empty and the project shows up
  // in "Pending" instead of "Earned".
  if (status === "paid" && project) {
    const { data: existingPayments } = await supabase
      .from("payments")
      .select("amount,currency")
      .eq("project_id", id);
    const paid = (existingPayments ?? [])
      .filter((p) => p.currency === project.currency)
      .reduce((s, p) => s + Number(p.amount), 0);
    const outstanding = Number(project.amount) - paid;
    if (outstanding > 0) {
      await supabase.from("payments").insert({
        user_id: userId,
        project_id: id,
        amount: outstanding,
        currency: project.currency,
        paid_at: new Date().toISOString().slice(0, 10),
        method: "Marked paid",
      });
    }
  }

  await logEvent({
    userId,
    kind: "project.status_changed",
    title: `${project?.title ?? "Project"} → ${status.replace("_", " ")}`,
    entityType: "project",
    entityId: id,
    clientId: project?.client_id as string | undefined,
    metadata: { status },
  });
  revalidatePath("/projects");
  revalidatePath("/payments");
  revalidatePath("/dashboard");
}

export async function deleteProject(id: string) {
  const { supabase, userId } = await userOrThrow();
  const { data: project } = await supabase
    .from("projects")
    .select("title,client_id")
    .eq("id", id)
    .maybeSingle();
  const { error } = await supabase.from("projects").delete().eq("id", id);
  if (error) throw error;
  await logEvent({
    userId,
    kind: "project.deleted",
    title: `Deleted project · ${project?.title ?? ""}`.trim(),
    entityType: "project",
    entityId: id,
    clientId: project?.client_id as string | undefined,
  });
  revalidatePath("/projects");
  revalidatePath("/dashboard");
}

// ───────────────────────────────────────── Payments ──
export type PaymentInput = {
  project_id: string;
  amount: number;
  currency: string;
  paid_at: string;
  method?: string;
  reference?: string;
  notes?: string;
};

export async function addPayment(input: PaymentInput) {
  const { supabase, userId } = await userOrThrow();

  const { error: payErr, data: paymentRow } = await supabase
    .from("payments")
    .insert({ ...input, user_id: userId })
    .select("id")
    .single();
  if (payErr) throw payErr;

  // Recompute project status based on new totals (only for same-currency payments).
  const [{ data: project }, { data: payments }] = await Promise.all([
    supabase.from("projects").select("*").eq("id", input.project_id).single(),
    supabase.from("payments").select("amount,currency").eq("project_id", input.project_id),
  ]);
  if (project) {
    const paid = (payments ?? [])
      .filter((p) => p.currency === project.currency)
      .reduce((sum, p) => sum + Number(p.amount), 0);
    let nextStatus: ProjectStatus;
    if (paid >= Number(project.amount)) nextStatus = "paid";
    else if (paid > 0) nextStatus = "partially_paid";
    else nextStatus = "unpaid";
    if (nextStatus !== project.status && project.status !== "archived") {
      await supabase.from("projects").update({ status: nextStatus }).eq("id", project.id);
    }
  }

  await logEvent({
    userId,
    kind: "payment.added",
    title: `Payment · ${input.currency} ${Number(input.amount).toFixed(2)} on ${project?.title ?? ""}`.trim(),
    entityType: "payment",
    entityId: paymentRow?.id as string | undefined,
    clientId: project?.client_id as string | undefined,
    metadata: { amount: input.amount, currency: input.currency, project_id: input.project_id },
  });

  revalidatePath("/projects");
  revalidatePath("/payments");
  revalidatePath("/dashboard");
}

export async function updatePayment(
  id: string,
  input: Partial<PaymentInput> & { invoice_id?: string | null },
) {
  const { supabase } = await userOrThrow();
  const { error } = await supabase.from("payments").update(input).eq("id", id);
  if (error) throw error;
  revalidatePath("/projects");
  revalidatePath("/payments");
  revalidatePath("/dashboard");
}

export async function deletePayment(id: string) {
  const { supabase } = await userOrThrow();

  // Grab the project id before deleting so we can recompute status afterwards.
  const { data: payment } = await supabase
    .from("payments")
    .select("project_id")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase.from("payments").delete().eq("id", id);
  if (error) throw error;

  if (payment?.project_id) {
    const [{ data: project }, { data: remaining }] = await Promise.all([
      supabase.from("projects").select("*").eq("id", payment.project_id).maybeSingle(),
      supabase.from("payments").select("amount,currency").eq("project_id", payment.project_id),
    ]);
    if (project && project.status !== "archived") {
      const paid = (remaining ?? [])
        .filter((p) => p.currency === project.currency)
        .reduce((s, p) => s + Number(p.amount), 0);
      let nextStatus: ProjectStatus;
      if (paid >= Number(project.amount)) nextStatus = "paid";
      else if (paid > 0) nextStatus = "partially_paid";
      else nextStatus = "unpaid";
      if (nextStatus !== project.status) {
        await supabase.from("projects").update({ status: nextStatus }).eq("id", project.id);
      }
    }
  }

  revalidatePath("/projects");
  revalidatePath("/payments");
  revalidatePath("/dashboard");
}

// Creates a draft invoice pre-filled from a payment (single line item = the payment)
// and links them. Returns the new invoice id so the UI can redirect to the editor.
export async function createInvoiceFromPayment(paymentId: string) {
  const { supabase, userId } = await userOrThrow();

  const { data: payment } = await supabase
    .from("payments")
    .select("*")
    .eq("id", paymentId)
    .single();
  if (!payment) throw new Error("Payment not found");

  if (payment.invoice_id) return { id: payment.invoice_id as string, created: false };

  const [{ data: project }, { data: settings }, { data: existingInvoices }] = await Promise.all([
    supabase.from("projects").select("*").eq("id", payment.project_id).single(),
    supabase.from("settings").select("*").eq("user_id", userId).maybeSingle(),
    supabase.from("invoices").select("invoice_number,issue_date").eq("user_id", userId),
  ]);
  if (!project) throw new Error("Project not found");

  const { data: client } = await supabase.from("clients").select("*").eq("id", project.client_id).single();
  if (!client) throw new Error("Client not found");

  const { buildInvoiceNumber } = await import("@/lib/invoice-number");
  const invoiceNumber = buildInvoiceNumber(
    settings?.invoice_number_format ?? "YYYY-NNN",
    (existingInvoices ?? []).map((i) => ({
      invoice_number: i.invoice_number as string,
      issue_date: i.issue_date as string,
    })),
    new Date(payment.paid_at),
  );

  const amount = Number(payment.amount);
  const lineItems = [
    {
      description: project.title + (project.description ? ` — ${project.description}` : ""),
      quantity: 1,
      unit_price: amount,
      amount,
    },
  ];

  const { data: newInvoice, error: invErr } = await supabase
    .from("invoices")
    .insert({
      user_id: userId,
      client_id: client.id,
      invoice_number: invoiceNumber,
      issue_date: payment.paid_at,
      currency: payment.currency,
      status: "draft",
      language: settings?.invoice_language ?? "fr",
      line_items: lineItems,
      subtotal: amount,
      tva_rate: 0,
      tva_amount: 0,
      total: amount,
      show_tva_note: settings?.invoice_show_tva_note ?? true,
      tva_note: settings?.invoice_tva_note,
      footer: settings?.invoice_footer,
      issuer_snapshot: {
        name: settings?.issuer_name,
        role: settings?.issuer_role,
        address: settings?.issuer_address,
        phone: settings?.issuer_phone,
        email: settings?.issuer_email,
        cin: settings?.issuer_cin,
      },
      client_snapshot: {
        name: client.name,
        company: client.company,
        address: client.address,
        city: client.city,
        country: client.country,
        ice: client.ice,
        rc: client.rc,
        tax_id: client.tax_id,
      },
    })
    .select("id")
    .single();
  if (invErr || !newInvoice) throw invErr ?? new Error("Failed to create invoice");

  const { error: linkErr } = await supabase
    .from("payments")
    .update({ invoice_id: newInvoice.id })
    .eq("id", paymentId);
  if (linkErr) throw linkErr;

  revalidatePath("/payments");
  revalidatePath("/invoices");
  return { id: newInvoice.id as string, created: true };
}

// ───────────────────────────────────────── Settings ──
export async function updateSettings(input: Record<string, unknown>) {
  const { supabase, userId } = await userOrThrow();
  const { error } = await supabase
    .from("settings")
    .upsert({ user_id: userId, ...input }, { onConflict: "user_id" });
  if (error) throw error;
  revalidatePath("/settings");
  revalidatePath("/dashboard");
}

export async function upsertExchangeRate(code: string, rate: number) {
  const { supabase, userId } = await userOrThrow();
  const { error } = await supabase
    .from("exchange_rates")
    .upsert(
      { user_id: userId, code, rate_to_base: rate },
      { onConflict: "user_id,code" },
    );
  if (error) throw error;
  revalidatePath("/settings");
  revalidatePath("/dashboard");
}

export async function deleteExchangeRate(code: string) {
  const { supabase, userId } = await userOrThrow();
  const { error } = await supabase
    .from("exchange_rates")
    .delete()
    .eq("user_id", userId)
    .eq("code", code);
  if (error) throw error;
  revalidatePath("/settings");
  revalidatePath("/dashboard");
}

/**
 * Refresh exchange rates from frankfurter.app (free, no API key, ECB-sourced).
 * Updates `rate_to_base` for every currency the user has configured EXCEPT
 * their base currency (which stays at 1.0 by definition).
 *
 * Frankfurter returns rates relative to a single base currency:
 *   https://api.frankfurter.app/latest?base=USD
 * We pass the user's base currency as `base` and read `rates[code]` for each
 * configured non-base code. PHP/MAD/CNY are all supported by frankfurter.
 */
export async function refreshExchangeRatesFromAPI() {
  const { supabase, userId } = await userOrThrow();

  const [settingsResult, ratesResult] = await Promise.all([
    supabase.from("settings").select("base_currency").eq("user_id", userId).maybeSingle(),
    supabase.from("exchange_rates").select("code").eq("user_id", userId),
  ]);

  const baseCurrency = settingsResult.data?.base_currency ?? "USD";
  const codes = (ratesResult.data ?? []).map((r) => r.code).filter((c) => c !== baseCurrency);

  if (codes.length === 0) return { updated: 0, base: baseCurrency };

  const url = `https://api.frankfurter.app/latest?base=${baseCurrency}&symbols=${codes.join(",")}`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`frankfurter.app returned HTTP ${response.status}`);
  }
  const json = (await response.json()) as { rates?: Record<string, number> };
  const fxRates = json.rates ?? {};

  // frankfurter returns "1 base = X target"; our schema stores "1 target = N base",
  // i.e. the inverse. So rate_to_base = 1 / fxRates[code].
  const updates = codes
    .filter((code) => typeof fxRates[code] === "number" && fxRates[code] > 0)
    .map((code) => ({
      user_id: userId,
      code,
      rate_to_base: 1 / fxRates[code],
    }));

  if (updates.length > 0) {
    const { error } = await supabase
      .from("exchange_rates")
      .upsert(updates, { onConflict: "user_id,code" });
    if (error) throw error;
  }

  revalidatePath("/settings");
  revalidatePath("/dashboard");
  return { updated: updates.length, base: baseCurrency };
}

// ───────────────────────────────────────── Project templates ──
export type ProjectTemplateInput = {
  name: string;
  title_template?: string | null;
  description_template?: string | null;
  default_amount?: number | null;
  default_currency?: string | null;
  default_client_id?: string | null;
  default_tags?: string[];
};

export async function createProjectTemplate(input: ProjectTemplateInput) {
  const { supabase, userId } = await userOrThrow();
  const { error, data } = await supabase
    .from("project_templates")
    .insert({ ...input, user_id: userId })
    .select("id")
    .single();
  if (error) throw error;
  revalidatePath("/projects");
  revalidatePath("/settings");
  return data;
}

export async function updateProjectTemplate(id: string, input: Partial<ProjectTemplateInput>) {
  const { supabase } = await userOrThrow();
  const { error } = await supabase.from("project_templates").update(input).eq("id", id);
  if (error) throw error;
  revalidatePath("/projects");
  revalidatePath("/settings");
}

export async function deleteProjectTemplate(id: string) {
  const { supabase } = await userOrThrow();
  const { error } = await supabase.from("project_templates").delete().eq("id", id);
  if (error) throw error;
  revalidatePath("/projects");
  revalidatePath("/settings");
}

// ───────────────────────────────────────── Invoices ──
export type InvoiceInput = {
  client_id: string;
  invoice_number: string;
  issue_date: string;
  due_date?: string | null;
  currency: string;
  line_items: { description: string; quantity: number; unit_price: number; amount: number }[];
  subtotal: number;
  tva_rate: number;
  tva_amount: number;
  total: number;
  show_tva_note: boolean;
  tva_note?: string | null;
  footer?: string | null;
  notes?: string | null;
  language?: string;
  issuer_snapshot: Record<string, unknown>;
  client_snapshot: Record<string, unknown>;
};

export async function createInvoice(input: InvoiceInput) {
  const { supabase, userId } = await userOrThrow();
  const { data, error } = await supabase
    .from("invoices")
    .insert({ ...input, user_id: userId, status: "draft" })
    .select("id")
    .single();
  if (error) throw error;
  await logEvent({
    userId,
    kind: "invoice.created",
    title: `Invoice · ${input.invoice_number}`,
    entityType: "invoice",
    entityId: data.id as string,
    clientId: input.client_id,
    metadata: { total: input.total, currency: input.currency },
  });
  revalidatePath("/invoices");
  return data;
}

export async function markInvoiceReminded(id: string) {
  const { supabase, userId } = await userOrThrow();
  const { error } = await supabase
    .from("invoices")
    .update({ last_reminded_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
  const { data: invoice } = await supabase
    .from("invoices")
    .select("invoice_number,client_id")
    .eq("id", id)
    .maybeSingle();
  await logEvent({
    userId,
    kind: "invoice.reminded",
    title: `Nudged ${invoice?.invoice_number ?? "invoice"}`,
    entityType: "invoice",
    entityId: id,
    clientId: invoice?.client_id as string | undefined,
  });
  revalidatePath("/invoices");
  revalidatePath("/dashboard");
}

export async function updateInvoice(id: string, input: Partial<InvoiceInput>) {
  const { supabase } = await userOrThrow();
  const { error } = await supabase.from("invoices").update(input).eq("id", id);
  if (error) throw error;
  revalidatePath("/invoices");
  revalidatePath(`/invoices/${id}`);
}

export async function deleteInvoice(id: string) {
  const { supabase } = await userOrThrow();
  const { error } = await supabase.from("invoices").delete().eq("id", id);
  if (error) throw error;
  revalidatePath("/invoices");
}

// ───────────────────────────────────────── Expenses ──
export type ExpenseInput = {
  spent_at?: string;
  description: string;
  amount: number;
  currency: string;
  category?: string | null;
  vendor?: string | null;
  notes?: string | null;
};

export async function createExpense(input: ExpenseInput) {
  const { supabase, userId } = await userOrThrow();
  const { error, data } = await supabase
    .from("expenses")
    .insert({
      user_id: userId,
      spent_at: input.spent_at ?? new Date().toISOString().slice(0, 10),
      description: input.description,
      amount: input.amount,
      currency: input.currency,
      category: input.category ?? null,
      vendor: input.vendor ?? null,
      notes: input.notes ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  revalidatePath("/expenses");
  revalidatePath("/dashboard");
  return data;
}

export async function updateExpense(id: string, input: Partial<ExpenseInput>) {
  const { supabase } = await userOrThrow();
  const { error } = await supabase.from("expenses").update(input).eq("id", id);
  if (error) throw error;
  revalidatePath("/expenses");
  revalidatePath("/dashboard");
}

export async function deleteExpense(id: string) {
  const { supabase } = await userOrThrow();
  const { error } = await supabase.from("expenses").delete().eq("id", id);
  if (error) throw error;
  revalidatePath("/expenses");
  revalidatePath("/dashboard");
}

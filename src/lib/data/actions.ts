"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
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
  revalidatePath("/clients");
  revalidatePath("/projects");
  revalidatePath("/dashboard");
  return data;
}

export async function updateClientRecord(id: string, input: Partial<ClientInput>) {
  const { supabase } = await userOrThrow();
  const { error } = await supabase.from("clients").update(input).eq("id", id);
  if (error) throw error;
  revalidatePath("/clients");
  revalidatePath("/projects");
}

export async function archiveClient(id: string, archived = true) {
  const { supabase } = await userOrThrow();
  const { error } = await supabase.from("clients").update({ archived }).eq("id", id);
  if (error) throw error;
  revalidatePath("/clients");
}

export async function deleteClient(id: string) {
  const { supabase } = await userOrThrow();
  const { error } = await supabase.from("clients").delete().eq("id", id);
  if (error) throw error;
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
  const { error, data } = await supabase
    .from("projects")
    .insert({ ...input, user_id: userId, status: input.status ?? "quoted" })
    .select("id")
    .single();
  if (error) throw error;
  revalidatePath("/projects");
  revalidatePath("/dashboard");
  return data;
}

export async function updateProject(id: string, input: Partial<ProjectInput>) {
  const { supabase } = await userOrThrow();
  const { error } = await supabase.from("projects").update(input).eq("id", id);
  if (error) throw error;
  revalidatePath("/projects");
  revalidatePath("/dashboard");
}

export async function updateProjectStatus(id: string, status: ProjectStatus, kanbanPosition?: number) {
  const { supabase } = await userOrThrow();
  const patch: Record<string, unknown> = { status };
  if (typeof kanbanPosition === "number") patch.kanban_position = kanbanPosition;
  const { error } = await supabase.from("projects").update(patch).eq("id", id);
  if (error) throw error;
  revalidatePath("/projects");
  revalidatePath("/dashboard");
}

export async function deleteProject(id: string) {
  const { supabase } = await userOrThrow();
  const { error } = await supabase.from("projects").delete().eq("id", id);
  if (error) throw error;
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

  const { error: payErr } = await supabase
    .from("payments")
    .insert({ ...input, user_id: userId });
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
    let nextStatus: ProjectStatus = project.status;
    if (paid >= Number(project.amount)) nextStatus = "paid";
    else if (paid > 0) nextStatus = "partially_paid";
    if (nextStatus !== project.status) {
      await supabase.from("projects").update({ status: nextStatus }).eq("id", project.id);
    }
  }

  revalidatePath("/projects");
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
  const { error } = await supabase.from("payments").delete().eq("id", id);
  if (error) throw error;
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
  revalidatePath("/invoices");
  return data;
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

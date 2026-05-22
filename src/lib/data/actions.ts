"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logEvent } from "@/lib/data/events";
import type { CurrencyCode, ProjectStatus } from "@/lib/supabase/types";

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
  accent_color?: string;
  short_description?: string;
  notes?: string;
};

// Only these columns may be written from the client form. Whitelisting fixes
// the edit bug: the dialog used to send the whole row (id/user_id/created_at/
// updated_at), and writing the primary key + audit timestamps back made the
// update silently no-op / confuse the touch trigger. Never trust the payload.
const CLIENT_WRITABLE = [
  "name", "company", "address", "city", "country", "ice", "rc", "tax_id",
  "bank_name", "bank_account", "iban", "swift", "email", "phone",
  "default_currency", "accent_color", "short_description", "notes",
] as const;

function pickClientFields(input: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const key of CLIENT_WRITABLE) {
    if (key in input) out[key] = input[key];
  }
  return out;
}

export async function createClientRecord(input: ClientInput) {
  const { supabase, userId } = await userOrThrow();
  const { error, data } = await supabase
    .from("clients")
    .insert({ ...pickClientFields(input), user_id: userId })
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
  const patch = pickClientFields(input);
  const { error } = await supabase.from("clients").update(patch).eq("id", id).eq("user_id", userId);
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
  revalidatePath(`/clients/${id}`);
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

// Set status directly (kanban override). Does NOT fabricate a payment anymore —
// money is recorded only via addPaymentWithChain, where the exact landed PHP is
// entered. Flipping to "paid" with no payments on file is allowed (manual
// override) but the dashboard's earned totals come from real payment rows.
export async function updateProjectStatus(id: string, status: ProjectStatus, kanbanPosition?: number) {
  const { supabase, userId } = await userOrThrow();
  const patch: Record<string, unknown> = { status };
  if (typeof kanbanPosition === "number") patch.kanban_position = kanbanPosition;
  if (status === "paid") patch.completed_at = new Date().toISOString().slice(0, 10);
  const { error } = await supabase.from("projects").update(patch).eq("id", id).eq("user_id", userId);
  if (error) throw error;

  const { data: project } = await supabase
    .from("projects")
    .select("title,client_id")
    .eq("id", id)
    .maybeSingle();

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
  revalidatePath("/pending");
}

// ───────────────────────────────────────── Overdue flags (manual only) ──
export async function flagProjectOverdue(id: string, reason?: string) {
  const { supabase, userId } = await userOrThrow();
  const { error } = await supabase
    .from("projects")
    .update({
      flagged_overdue: true,
      flagged_overdue_at: new Date().toISOString(),
      flagged_overdue_reason: reason ?? null,
    })
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw error;
  await logEvent({ userId, kind: "project.flagged", title: "Flagged overdue", entityType: "project", entityId: id });
  revalidatePath("/pending");
  revalidatePath("/dashboard");
}

export async function unflagProjectOverdue(id: string) {
  const { supabase, userId } = await userOrThrow();
  const { error } = await supabase
    .from("projects")
    .update({ flagged_overdue: false, flagged_overdue_at: null, flagged_overdue_reason: null })
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw error;
  await logEvent({ userId, kind: "project.unflagged", title: "Cleared overdue flag", entityType: "project", entityId: id });
  revalidatePath("/pending");
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
//
// Every payment is a CHAIN of one or more hops. The simple case is a single
// hop (client → my PHP wallet). A complex case chains rails (bank → crypto
// exchange → wallet). The final hop's PHP output is the locked landed amount;
// it never re-floats with the market once saved (fx_locked = true).

type RatePair = { code: string; rate_to_base: number };

function toBaseAmount(amount: number, currency: string, rates: RatePair[]): number {
  const r = rates.find((x) => x.code === currency)?.rate_to_base ?? 1;
  return amount * r;
}

// Recompute a project's payment status from same-currency payment totals.
// (Mixed-currency partials fall through to base comparison.)
async function recomputeProjectStatus(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
) {
  const [{ data: project }, { data: payments }, { data: rates }] = await Promise.all([
    supabase.from("projects").select("*").eq("id", projectId).maybeSingle(),
    supabase.from("payments").select("amount,currency,gross_at_market_base").eq("project_id", projectId),
    supabase.from("exchange_rates").select("code,rate_to_base"),
  ]);
  if (!project || project.status === "archived") return project ?? null;

  const sameCurrency = (payments ?? []).filter((p) => p.currency === project.currency);
  const mixed = (payments ?? []).length !== sameCurrency.length;

  let paidRatio: number;
  if (mixed) {
    // Compare in base currency when payments span currencies.
    const projectBase = toBaseAmount(Number(project.amount), project.currency, (rates ?? []) as RatePair[]);
    const paidBase = (payments ?? []).reduce(
      (s, p) => s + Number(p.gross_at_market_base ?? toBaseAmount(Number(p.amount), p.currency, (rates ?? []) as RatePair[])),
      0,
    );
    paidRatio = projectBase > 0 ? paidBase / projectBase : 0;
  } else {
    const paid = sameCurrency.reduce((s, p) => s + Number(p.amount), 0);
    paidRatio = Number(project.amount) > 0 ? paid / Number(project.amount) : 0;
  }

  const nextStatus: ProjectStatus = paidRatio >= 1 ? "paid" : paidRatio > 0 ? "partially_paid" : "unpaid";
  if (nextStatus !== project.status) {
    await supabase.from("projects").update({ status: nextStatus }).eq("id", project.id);
  }
  return project;
}

export type PaymentInput = {
  project_id: string;
  amount: number;
  currency: string;
  paid_at: string;
  method?: string;
  reference?: string;
  notes?: string;
};

export type ChainStepInput = {
  method_id: string | null;
  amount_in: number;
  currency_in: string;
  amount_out: number;
  currency_out: string;
  notes?: string;
};

export type PaymentChainInput = {
  project_id: string;
  paid_at: string;
  steps: ChainStepInput[];
  reference?: string;
  notes?: string;
};

// The canonical "I got paid" action. Takes the full chain, snapshots the
// market value + the implied total fee, and locks the landed PHP.
export async function addPaymentWithChain(input: PaymentChainInput) {
  const { supabase, userId } = await userOrThrow();
  if (!input.steps.length) throw new Error("A payment needs at least one step.");

  const first = input.steps[0];
  const final = input.steps[input.steps.length - 1];

  const [{ data: project }, { data: settings }, { data: rates }] = await Promise.all([
    supabase.from("projects").select("*").eq("id", input.project_id).single(),
    supabase.from("settings").select("base_currency").eq("user_id", userId).maybeSingle(),
    supabase.from("exchange_rates").select("code,rate_to_base").eq("user_id", userId),
  ]);
  if (!project) throw new Error("Project not found");
  const baseCurrency = settings?.base_currency ?? "PHP";
  const rateRows = (rates ?? []) as RatePair[];

  // net = the final hop's output, expressed in base currency (PHP).
  const netBase =
    final.currency_out === baseCurrency
      ? Number(final.amount_out)
      : toBaseAmount(Number(final.amount_out), final.currency_out, rateRows);
  // gross = what the first hop was worth at mid-market today (the "no-fee" value).
  const grossBase = toBaseAmount(Number(first.amount_in), first.currency_in, rateRows);
  const feeBase = Math.max(0, grossBase - netBase);

  const { data: paymentRow, error: payErr } = await supabase
    .from("payments")
    .insert({
      user_id: userId,
      project_id: input.project_id,
      amount: first.amount_in,
      currency: first.currency_in,
      paid_at: input.paid_at,
      reference: input.reference ?? null,
      notes: input.notes ?? null,
      net_amount_base: Math.round(netBase * 100) / 100,
      gross_at_market_base: Math.round(grossBase * 100) / 100,
      implied_fee_base: Math.round(feeBase * 100) / 100,
      fx_locked: true,
    })
    .select("id")
    .single();
  if (payErr || !paymentRow) throw payErr ?? new Error("Failed to save payment");

  const stepRows = input.steps.map((s, i) => ({
    payment_id: paymentRow.id,
    step_order: i + 1,
    method_id: s.method_id,
    amount_in: s.amount_in,
    currency_in: s.currency_in,
    amount_out: s.amount_out,
    currency_out: s.currency_out,
    is_final: i === input.steps.length - 1,
    notes: s.notes ?? null,
  }));
  const { error: stepErr } = await supabase.from("payment_steps").insert(stepRows);
  if (stepErr) throw stepErr;

  await recomputeProjectStatus(supabase, input.project_id);

  await logEvent({
    userId,
    kind: "payment.added",
    title: `Payment · ${first.currency_in} ${Number(first.amount_in).toFixed(2)} → ${baseCurrency} ${netBase.toFixed(0)} net on ${project.title}`,
    entityType: "payment",
    entityId: paymentRow.id as string,
    clientId: project.client_id as string,
    metadata: {
      net_base: netBase,
      gross_base: grossBase,
      fee_base: feeBase,
      steps: input.steps.length,
      project_id: input.project_id,
    },
  });

  revalidatePath("/today");
  revalidatePath("/projects");
  revalidatePath("/payments");
  revalidatePath("/dashboard");
  revalidatePath("/pending");
  // clientId returned so the UI can re-consolidate this client's AI memory
  // out-of-band — the memory keeps learning as money moves.
  return { id: paymentRow.id as string, clientId: project.client_id as string };
}

// Legacy single-hop quick-add (project sheet). Snapshots lock fields + writes
// a 1-step chain so it produces valid new-schema data.
export async function addPayment(input: PaymentInput) {
  return addPaymentWithChain({
    project_id: input.project_id,
    paid_at: input.paid_at,
    reference: input.reference,
    notes: input.notes,
    steps: [
      {
        method_id: null,
        amount_in: input.amount,
        currency_in: input.currency,
        amount_out: input.amount,
        currency_out: input.currency,
      },
    ],
  });
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

// Edit a past payment's medium + actual received in one go — works on ANY
// payment, including old ones logged before fee tracking (or the auto "Marked
// paid" rows). The fee is derived, never guessed by %:
//   gross = what you were owed at market  (snapshot if present, else amount×rate)
//   fee   = gross − net                    (the real money the rails + FX ate)
// feeUnknown: you don't remember the cut → net = gross, so the fee counts as 0
// instead of inflating from a stale net. Persisting gross keeps reads stable.
export async function updatePaymentDetails(
  paymentId: string,
  input: { methodId?: string | null; netReceivedBase?: number; feeUnknown?: boolean },
) {
  const { supabase, userId } = await userOrThrow();

  const [{ data: payment }, { data: settings }, { data: rates }, { data: steps }] = await Promise.all([
    supabase
      .from("payments")
      .select("id,project_id,amount,currency,gross_at_market_base,net_amount_base")
      .eq("id", paymentId)
      .single(),
    supabase.from("settings").select("base_currency").eq("user_id", userId).maybeSingle(),
    supabase.from("exchange_rates").select("code,rate_to_base").eq("user_id", userId),
    supabase.from("payment_steps").select("id,step_order,is_final").eq("payment_id", paymentId),
  ]);
  if (!payment) throw new Error("Payment not found");

  const baseCurrency = settings?.base_currency ?? "PHP";
  const rateRows = (rates ?? []) as RatePair[];

  // Use the frozen gross if we have it; otherwise value what was owed at today's rate.
  const gross =
    payment.gross_at_market_base != null
      ? Number(payment.gross_at_market_base)
      : toBaseAmount(Number(payment.amount), payment.currency as CurrencyCode, rateRows);

  // net: "I don't know the fee" → net = gross (fee 0). Else the entered amount,
  // or the existing net if none was passed.
  const net = input.feeUnknown
    ? gross
    : Math.max(0, Number(input.netReceivedBase ?? payment.net_amount_base ?? gross) || 0);
  const fee = Math.max(0, gross - net);

  const { error } = await supabase
    .from("payments")
    .update({
      net_amount_base: Math.round(net * 100) / 100,
      gross_at_market_base: Math.round(gross * 100) / 100,
      implied_fee_base: Math.round(fee * 100) / 100,
      fx_locked: true,
    })
    .eq("id", paymentId);
  if (error) throw error;

  // Tag the medium. If the chain has steps, set the method on the final hop;
  // otherwise create a single tagged step so the leaderboard can group it.
  if (input.methodId !== undefined) {
    const ordered = (steps ?? []).slice().sort((a, b) => Number(a.step_order) - Number(b.step_order));
    if (ordered.length > 0) {
      const finalStep = ordered.find((s) => s.is_final) ?? ordered[ordered.length - 1];
      const { error: stepErr } = await supabase
        .from("payment_steps")
        .update({ method_id: input.methodId })
        .eq("id", finalStep.id);
      if (stepErr) throw stepErr;
    } else {
      const { error: stepErr } = await supabase.from("payment_steps").insert({
        payment_id: paymentId,
        step_order: 1,
        method_id: input.methodId,
        amount_in: payment.amount,
        currency_in: payment.currency,
        amount_out: Math.round(net * 100) / 100,
        currency_out: baseCurrency,
        is_final: true,
      });
      if (stepErr) throw stepErr;
    }
  }

  const { data: project } = await supabase
    .from("projects")
    .select("client_id,title")
    .eq("id", payment.project_id)
    .maybeSingle();

  await logEvent({
    userId,
    kind: "payment.updated",
    title: `Updated payment${project?.title ? ` on ${project.title}` : ""} · received ${baseCurrency} ${net.toFixed(0)}, fee ${baseCurrency} ${fee.toFixed(0)}`,
    entityType: "payment",
    entityId: paymentId,
    clientId: (project?.client_id as string) ?? null,
    metadata: { net_base: net, gross_base: gross, fee_base: fee, fee_unknown: !!input.feeUnknown },
  });

  revalidatePath("/today");
  revalidatePath("/payments");
  revalidatePath("/dashboard");
  revalidatePath("/projects");
  return { clientId: (project?.client_id as string) ?? null };
}

export async function deletePayment(id: string) {
  const { supabase } = await userOrThrow();

  // Grab the project id before deleting so we can recompute status afterwards.
  const { data: payment } = await supabase
    .from("payments")
    .select("project_id")
    .eq("id", id)
    .maybeSingle();

  // payment_steps cascade-delete via FK.
  const { error } = await supabase.from("payments").delete().eq("id", id);
  if (error) throw error;

  if (payment?.project_id) {
    await recomputeProjectStatus(supabase, payment.project_id);
  }

  revalidatePath("/projects");
  revalidatePath("/payments");
  revalidatePath("/dashboard");
  revalidatePath("/pending");
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

// ───────────────────────────────────────── Currencies ──
// Global reference list. Add a currency before setting its rate.
export async function createCurrency(input: { code: string; name: string; symbol?: string }) {
  const { supabase } = await userOrThrow();
  const code = input.code.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) throw new Error("Currency code must be 3 letters (e.g. GBP).");
  const { error } = await supabase
    .from("currencies")
    .upsert({ code, name: input.name.trim(), symbol: input.symbol?.trim() || code }, { onConflict: "code" });
  if (error) throw error;
  revalidatePath("/settings");
}

export async function deleteCurrency(code: string) {
  const { supabase } = await userOrThrow();
  const { error } = await supabase.from("currencies").delete().eq("code", code);
  // FK RESTRICT: a currency in use by a rate/project/payment can't be deleted.
  if (error) throw new Error("Can't delete — this currency is still used by a rate, project, or payment.");
  revalidatePath("/settings");
}

// "Automatic exchange rate": only hits frankfurter when stored rates are older
// than maxAgeHours. Called fire-and-forget from the app shell on mount
// (throttled client-side), so unpaid balances are always valued at fresh rates
// without a cron. Paid amounts are locked and never touched.
export async function refreshRatesIfStale(maxAgeHours = 24) {
  const { supabase, userId } = await userOrThrow();
  const { data } = await supabase
    .from("exchange_rates")
    .select("updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (data?.updated_at) {
    const ageHours = (Date.now() - new Date(data.updated_at).getTime()) / 3_600_000;
    if (ageHours < maxAgeHours) return { refreshed: false };
  }
  try {
    const res = await refreshExchangeRatesFromAPI();
    return { refreshed: (res?.updated ?? 0) > 0 };
  } catch {
    return { refreshed: false };
  }
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

// ───────────────────────────────────────── Payment methods ──
export type PaymentMethodInput = {
  name: string;
  kind?: string;
  currency_in?: string | null;
  currency_out?: string | null;
  monthly_fee_php?: number;
  notes?: string | null;
};

export async function createPaymentMethod(input: PaymentMethodInput) {
  const { supabase, userId } = await userOrThrow();
  const { error, data } = await supabase
    .from("payment_methods")
    .insert({
      user_id: userId,
      name: input.name,
      kind: input.kind ?? "wallet",
      currency_in: input.currency_in ?? null,
      currency_out: input.currency_out ?? null,
      monthly_fee_php: input.monthly_fee_php ?? 0,
      notes: input.notes ?? null,
    })
    .select("id")
    .single();
  if (error) throw error;
  await logEvent({ userId, kind: "method.created", title: `Added method · ${input.name}`, entityType: "payment_method", entityId: data.id as string });
  revalidatePath("/settings");
  revalidatePath("/payments");
  return data;
}

export async function updatePaymentMethod(id: string, input: Partial<PaymentMethodInput>) {
  const { supabase, userId } = await userOrThrow();
  const { error } = await supabase.from("payment_methods").update(input).eq("id", id).eq("user_id", userId);
  if (error) throw error;
  await logEvent({ userId, kind: "method.updated", title: `Updated method${input.name ? ` · ${input.name}` : ""}`, entityType: "payment_method", entityId: id });
  revalidatePath("/settings");
  revalidatePath("/payments");
}

export async function archivePaymentMethod(id: string, archived = true) {
  const { supabase, userId } = await userOrThrow();
  const { error } = await supabase.from("payment_methods").update({ archived }).eq("id", id).eq("user_id", userId);
  if (error) throw error;
  await logEvent({ userId, kind: "method.archived", title: archived ? "Archived method" : "Restored method", entityType: "payment_method", entityId: id });
  revalidatePath("/settings");
  revalidatePath("/payments");
}

// Hard delete. Past payment_steps that used this method keep their amounts but
// lose the label (FK is ON DELETE SET NULL → they read as "Untagged" in the
// leaderboard). Prefer archive unless you really want it gone.
export async function deletePaymentMethod(id: string) {
  const { supabase, userId } = await userOrThrow();
  const { error } = await supabase.from("payment_methods").delete().eq("id", id).eq("user_id", userId);
  if (error) throw error;
  revalidatePath("/settings");
  revalidatePath("/payments");
}

// ───────────────────────────────────────── Client memory ──
//
// Raw entry is stored, then Gemini folds all unconsolidated notes into the
// client's living memory_consolidated doc (best-effort; no-op without a key).
export async function addClientMemoryEntry(clientId: string, content: string) {
  const { supabase, userId } = await userOrThrow();
  const trimmed = content.trim();
  if (!trimmed) throw new Error("Write something first.");
  const { error, data } = await supabase
    .from("client_memory_entries")
    .insert({ user_id: userId, client_id: clientId, content: trimmed })
    .select("id")
    .single();
  if (error) throw error;
  await logEvent({
    userId,
    kind: "client.memory_added",
    title: "Added to client memory",
    entityType: "client",
    entityId: clientId,
    clientId,
  });
  revalidatePath(`/clients/${clientId}`);
  return data;
}

// Slower companion the UI fires AFTER the note appears — keeps "add note"
// instant while Gemini consolidates the living memory in its own request.
export async function consolidateClientMemoryAction(clientId: string) {
  const { consolidateClientMemory } = await import("@/lib/ai/client-memory");
  await consolidateClientMemory(clientId);
  revalidatePath(`/clients/${clientId}`);
}

export async function deleteClientMemoryEntry(id: string, clientId: string) {
  const { supabase, userId } = await userOrThrow();
  const { error } = await supabase.from("client_memory_entries").delete().eq("id", id).eq("user_id", userId);
  if (error) throw error;
  revalidatePath(`/clients/${clientId}`);
}

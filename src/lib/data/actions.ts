"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logEvent } from "@/lib/data/events";
import type {
  AiQuestion,
  AiQuestionKind,
  AiQuestionSourceType,
  CurrencyCode,
  LoanDirection,
  LoanStatus,
  ProjectStatus,
  RecurringScheduleKind,
  RecurringSpend,
} from "@/lib/supabase/types";

async function userOrThrow() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthenticated");
  return { supabase, userId: user.id };
}

// Drops the AI safe-to-spend cache row for this user so the next read recomputes
// from scratch. Called from every mutation that changes the math (spends,
// payments, withdrawals, recurring paid/skipped, loan installments, rule edits).
// Best-effort: failures don't block the parent mutation. Reuses the caller's
// supabase client when passed to avoid the redundant createClient() round-trip
// on hot paths.
async function invalidateAiSafeSpendCache(
  userId: string,
  existing?: Awaited<ReturnType<typeof createClient>>,
): Promise<void> {
  try {
    const supabase = existing ?? (await createClient());
    await supabase.from("ai_safe_spend_cache").delete().eq("user_id", userId);
  } catch {
    // Swallow — cache is regenerable; not worth failing a real write.
  }
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
  const { error } = await supabase.from("clients").update({ archived }).eq("id", id).eq("user_id", userId);
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
  const { error } = await supabase.from("clients").delete().eq("id", id).eq("user_id", userId);
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

// Mirror of CLIENT_WRITABLE: only these columns may be written from a project
// form. Stops the dialog from echoing back id/user_id/created_at/updated_at and
// silently breaking the touch trigger or trying to flip user_id.
const PROJECT_WRITABLE = [
  "client_id", "category_id", "title", "description", "amount", "currency",
  "status", "due_date", "completed_at", "tags", "notes",
] as const;

function pickProjectFields(input: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const key of PROJECT_WRITABLE) {
    if (key in input) out[key] = input[key];
  }
  return out;
}

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

  // Creating a project directly in "paid" status (unusual but possible) routes
  // through addPaymentWithChain so allocations, locks, and cache invalidation
  // all run — a raw INSERT bypasses every guard the chain pipeline holds.
  if (status === "paid" && input.amount > 0) {
    await addPaymentWithChain({
      project_id: data.id as string,
      paid_at: new Date().toISOString().slice(0, 10),
      steps: [
        {
          method_id: null,
          amount_in: input.amount,
          currency_in: input.currency,
          amount_out: input.amount,
          currency_out: input.currency,
        },
      ],
      notes: "Marked paid on project creation",
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
  const patch = pickProjectFields(input as Record<string, unknown>);
  const { error } = await supabase.from("projects").update(patch).eq("id", id).eq("user_id", userId);
  if (error) throw error;
  await logEvent({
    userId,
    kind: "project.updated",
    title: `Updated project${input.title ? ` · ${input.title}` : ""}`,
    entityType: "project",
    entityId: id,
    clientId: input.client_id,
  });
  await invalidateAiSafeSpendCache(userId, supabase);
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
  const { error } = await supabase.from("projects").delete().eq("id", id).eq("user_id", userId);
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

// Recompute a project's payment status from allocations (migration 0021).
// allocation_amount is summed in the project currency when all allocations
// match; allocations in other currencies fall through to base comparison via
// allocation_base. Skipped on archived projects.
async function recomputeProjectStatus(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
) {
  const [{ data: project }, { data: allocations }, { data: rates }] = await Promise.all([
    supabase.from("projects").select("*").eq("id", projectId).maybeSingle(),
    supabase
      .from("payment_project_allocations")
      .select("allocation_amount,allocation_currency,allocation_base")
      .eq("project_id", projectId),
    supabase.from("exchange_rates").select("code,rate_to_base"),
  ]);
  if (!project || project.status === "archived") return project ?? null;

  const allocs = allocations ?? [];
  const sameCurrency = allocs.filter((a) => a.allocation_currency === project.currency);
  const mixed = allocs.length !== sameCurrency.length;

  let paidRatio: number;
  if (mixed) {
    // Compare in base currency when allocations span currencies.
    const projectBase = toBaseAmount(Number(project.amount), project.currency, (rates ?? []) as RatePair[]);
    const paidBase = allocs.reduce(
      (s, a) =>
        s +
        Number(
          a.allocation_base ??
            toBaseAmount(Number(a.allocation_amount), a.allocation_currency, (rates ?? []) as RatePair[]),
        ),
      0,
    );
    paidRatio = projectBase > 0 ? paidBase / projectBase : 0;
  } else {
    const paid = sameCurrency.reduce((s, a) => s + Number(a.allocation_amount), 0);
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
  from_method_id?: string | null; // source the money came from
  method_id: string | null;       // destination it landed on for this hop
  amount_in: number;
  currency_in: string;
  amount_out: number;
  currency_out: string;
  notes?: string;
};

export type PaymentProjectAllocationInput = {
  project_id: string;
  allocation_amount: number;
  currency: string;
  notes?: string;
};

export type PaymentChainInput = {
  // Optional now — when `projects` is provided the legacy single project_id is
  // ignored (but accepted for back-compat with single-project callers).
  project_id?: string;
  projects?: PaymentProjectAllocationInput[];
  paid_at: string;
  steps: ChainStepInput[];
  reference?: string;
  notes?: string;
};

// The canonical "I got paid" action. Takes the full chain, snapshots the
// market value + the implied total fee, and locks the landed PHP.
// Multi-project: if input.projects is provided, splits net_amount_base pro-rata
// across allocations (per allocation_base via today's FX). The denormalized
// payments.project_id is set to the LARGEST allocation's project_id.
export async function addPaymentWithChain(input: PaymentChainInput) {
  const { supabase, userId } = await userOrThrow();
  if (!input.steps.length) throw new Error("A payment needs at least one step.");

  const first = input.steps[0];
  const final = input.steps[input.steps.length - 1];

  const [{ data: settings }, { data: rates }] = await Promise.all([
    supabase.from("settings").select("base_currency").eq("user_id", userId).maybeSingle(),
    supabase.from("exchange_rates").select("code,rate_to_base").eq("user_id", userId),
  ]);
  const baseCurrency = settings?.base_currency ?? "PHP";
  const rateRows = (rates ?? []) as RatePair[];

  const hasMulti = !!(input.projects && input.projects.length > 0);
  if (!hasMulti && !input.project_id) throw new Error("Payment needs a project.");

  // Resolve the headline project for denormalized payments.project_id. With
  // multiple allocations, the LARGEST share wins (broken ties → first listed).
  let primaryProjectId: string;
  if (hasMulti) {
    const sorted = [...input.projects!].sort(
      (a, b) => Number(b.allocation_amount) - Number(a.allocation_amount),
    );
    primaryProjectId = sorted[0].project_id;
  } else {
    primaryProjectId = input.project_id!;
  }

  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", primaryProjectId)
    .single();
  if (!project) throw new Error("Project not found");

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
      project_id: primaryProjectId,
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
    from_method_id: s.from_method_id ?? null,
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

  // Allocations — multi-project pro-rates netBase across shares by allocation_base
  // (each share's PHP value at today's FX, then normalized so allocations sum
  // exactly to netBase even when FX rounding would have drifted). Single-project
  // payments write one row mirroring net_amount_base for backwards compat with
  // recomputeProjectStatus + project_paid_from_allocations.
  if (hasMulti) {
    const shareBaseRaw = input.projects!.map((p) =>
      toBaseAmount(Number(p.allocation_amount), p.currency, rateRows),
    );
    const totalShareBase = shareBaseRaw.reduce((s, v) => s + v, 0);
    const netBaseRounded = Math.round(netBase * 100) / 100;
    // Round the first N-1 shares independently; force the last share to absorb
    // the rounding remainder so allocations sum EXACTLY to net_amount_base.
    // Otherwise N/2 centavos of drift can flip recomputeProjectStatus between
    // paid and partially_paid.
    const roundedShares: number[] = [];
    let runningSum = 0;
    for (let i = 0; i < input.projects!.length; i++) {
      if (i < input.projects!.length - 1) {
        const raw = totalShareBase > 0 ? (shareBaseRaw[i] / totalShareBase) * netBase : 0;
        const rounded = Math.round(raw * 100) / 100;
        roundedShares.push(rounded);
        runningSum += rounded;
      } else {
        const last = Math.round((netBaseRounded - runningSum) * 100) / 100;
        roundedShares.push(last);
      }
    }
    const allocRows = input.projects!.map((p, i) => ({
      payment_id: paymentRow.id,
      project_id: p.project_id,
      allocation_amount: p.allocation_amount,
      allocation_currency: p.currency,
      allocation_base: roundedShares[i],
      notes: p.notes ?? null,
    }));
    const { error: allocErr } = await supabase
      .from("payment_project_allocations")
      .insert(allocRows);
    if (allocErr) throw allocErr;
  } else {
    const { error: allocErr } = await supabase.from("payment_project_allocations").insert({
      payment_id: paymentRow.id,
      project_id: primaryProjectId,
      allocation_amount: first.amount_in,
      allocation_currency: first.currency_in,
      allocation_base: Math.round(netBase * 100) / 100,
      notes: null,
    });
    if (allocErr) throw allocErr;
  }

  // Recompute every touched project (multi-project payments fan out).
  const touchedProjectIds = hasMulti
    ? Array.from(new Set(input.projects!.map((p) => p.project_id)))
    : [primaryProjectId];
  for (const pid of touchedProjectIds) {
    await recomputeProjectStatus(supabase, pid);
  }

  await logEvent({
    userId,
    kind: "payment.added",
    title: `Payment · ${first.currency_in} ${Number(first.amount_in).toFixed(2)} → ${baseCurrency} ${netBase.toFixed(0)} net on ${project.title}${hasMulti ? ` +${touchedProjectIds.length - 1} more` : ""}`,
    entityType: "payment",
    entityId: paymentRow.id as string,
    clientId: project.client_id as string,
    metadata: {
      net_base: netBase,
      gross_base: grossBase,
      fee_base: feeBase,
      steps: input.steps.length,
      project_id: primaryProjectId,
      project_ids: touchedProjectIds,
      multi_project: hasMulti,
    },
  });

  await invalidateAiSafeSpendCache(userId, supabase);

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

// Safe-field edits ONLY (notes, reference, invoice_id, method). Direct money
// edits (project_id / amount / currency / paid_at) bypass allocation rewrites
// and project status recompute — go through updatePaymentDetails for the
// gross/net/method edit, or delete + addPaymentWithChain to redo the chain.
export async function updatePayment(
  id: string,
  input: Partial<PaymentInput> & { invoice_id?: string | null },
) {
  const { supabase, userId } = await userOrThrow();
  if ("project_id" in input || "amount" in input || "currency" in input || "paid_at" in input) {
    throw new Error(
      "updatePayment only accepts safe fields (notes, reference, invoice_id, method). Use updatePaymentDetails or addPaymentWithChain for money edits.",
    );
  }
  const { error } = await supabase.from("payments").update(input).eq("id", id).eq("user_id", userId);
  if (error) throw error;
  await logEvent({
    userId,
    kind: "payment.updated",
    title: "Updated payment",
    entityType: "payment",
    entityId: id,
    metadata: { fields_changed: Object.keys(input) },
  });
  await invalidateAiSafeSpendCache(userId);
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
  input: { fromMethodId?: string | null; methodId?: string | null; netReceivedBase?: number; feeUnknown?: boolean },
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
      // Unknown fee → flagged so the fee algorithm skips it (not a real 0).
      fee_unknown: !!input.feeUnknown,
      fx_locked: true,
    })
    .eq("id", paymentId);
  if (error) throw error;

  // Tag where it came FROM (source, on the first hop) and where it landed (the
  // final hop's destination). If the chain has steps, update them; otherwise
  // create a single from → to step so the leaderboard can group it.
  if (input.methodId !== undefined || input.fromMethodId !== undefined) {
    const ordered = (steps ?? []).slice().sort((a, b) => Number(a.step_order) - Number(b.step_order));
    if (ordered.length > 0) {
      if (input.methodId !== undefined) {
        const finalStep = ordered.find((s) => s.is_final) ?? ordered[ordered.length - 1];
        const { error: toErr } = await supabase
          .from("payment_steps")
          .update({ method_id: input.methodId })
          .eq("id", finalStep.id);
        if (toErr) throw toErr;
      }
      if (input.fromMethodId !== undefined) {
        const { error: fromErr } = await supabase
          .from("payment_steps")
          .update({ from_method_id: input.fromMethodId })
          .eq("id", ordered[0].id);
        if (fromErr) throw fromErr;
      }
    } else {
      const { error: stepErr } = await supabase.from("payment_steps").insert({
        payment_id: paymentId,
        step_order: 1,
        from_method_id: input.fromMethodId ?? null,
        method_id: input.methodId ?? null,
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

  await invalidateAiSafeSpendCache(userId);
  revalidatePath("/today");
  revalidatePath("/payments");
  revalidatePath("/dashboard");
  revalidatePath("/projects");
  return { clientId: (project?.client_id as string) ?? null };
}

export async function deletePayment(id: string) {
  const { supabase, userId } = await userOrThrow();

  // Grab affected projects before deleting so we can recompute their status
  // afterwards. Multi-project payments fan out to each allocation.
  const [{ data: payment }, { data: allocations }] = await Promise.all([
    supabase.from("payments").select("project_id").eq("id", id).maybeSingle(),
    supabase.from("payment_project_allocations").select("project_id").eq("payment_id", id),
  ]);

  // payment_steps + payment_project_allocations cascade-delete via FK.
  const { error } = await supabase.from("payments").delete().eq("id", id).eq("user_id", userId);
  if (error) throw error;

  const touched = new Set<string>();
  if (payment?.project_id) touched.add(payment.project_id as string);
  for (const a of allocations ?? []) touched.add(a.project_id as string);
  for (const pid of touched) {
    await recomputeProjectStatus(supabase, pid);
  }

  await invalidateAiSafeSpendCache(userId);
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
  monthly_fee_currency?: string | null;
  is_holding?: boolean;
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
      monthly_fee_currency: input.monthly_fee_currency ?? null,
      is_holding: input.is_holding ?? false,
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

// ───────────────────────────────────────── Withdrawals ──
//
// Moving money OUT of a holding wallet (coin.ph → Cash). Standalone — not tied
// to any project; the money was decoupled the moment it landed. Same fee math
// as a payment chain: fee = gross out − net received. The fee reduces what
// counts as kept (in this month) and joins the fee totals — but it does NOT
// appear in the receive leaderboard.
export type WithdrawalInput = {
  from_method_id: string;
  to_method_id?: string | null;
  withdrawn_at: string;
  gross_base: number; // taken out of the wallet (PHP)
  net_base: number;   // received into hand/cash (PHP)
  notes?: string | null;
};

export async function createWithdrawal(input: WithdrawalInput) {
  const { supabase, userId } = await userOrThrow();
  const gross = Math.max(0, Number(input.gross_base) || 0);
  const net = Math.max(0, Number(input.net_base) || 0);
  if (gross <= 0) throw new Error("Enter how much you took out.");
  if (net > gross) throw new Error("Received can't be more than what you took out.");
  const fee = Math.max(0, gross - net);

  const { error, data } = await supabase
    .from("withdrawals")
    .insert({
      user_id: userId,
      from_method_id: input.from_method_id,
      to_method_id: input.to_method_id ?? null,
      withdrawn_at: input.withdrawn_at,
      gross_base: Math.round(gross * 100) / 100,
      net_base: Math.round(net * 100) / 100,
      fee_base: Math.round(fee * 100) / 100,
      notes: input.notes ?? null,
    })
    .select("id")
    .single();
  if (error) throw error;

  // Side effects from here on are best-effort: the withdrawal itself is
  // already saved, and the user shouldn't see the whole mutation fail because
  // an audit log row or cache invalidation hiccupped. Each block is isolated
  // so one failure doesn't cascade into the next.
  try {
    const { data: fromMethod } = await supabase
      .from("payment_methods")
      .select("name")
      .eq("id", input.from_method_id)
      .maybeSingle();
    await logEvent({
      userId,
      kind: "withdrawal.added",
      title: `Withdrew ${(fromMethod?.name as string) ?? "wallet"} · received PHP ${net.toFixed(0)}, fee PHP ${fee.toFixed(0)}`,
      entityType: "withdrawal",
      entityId: data.id as string,
      metadata: { gross_base: gross, net_base: net, fee_base: fee, from_method_id: input.from_method_id },
    });
  } catch (err) {
    console.error("createWithdrawal: logEvent failed (non-fatal)", err);
  }

  try {
    await invalidateAiSafeSpendCache(userId, supabase);
  } catch (err) {
    console.error("createWithdrawal: cache invalidation failed (non-fatal)", err);
  }

  revalidatePath("/today");
  revalidatePath("/payments");
  revalidatePath("/dashboard");
  return data;
}

export async function deleteWithdrawal(id: string) {
  const { supabase, userId } = await userOrThrow();
  const { error } = await supabase.from("withdrawals").delete().eq("id", id).eq("user_id", userId);
  if (error) throw error;
  await logEvent({ userId, kind: "withdrawal.removed", title: "Removed a withdrawal", entityType: "withdrawal", entityId: id });
  await invalidateAiSafeSpendCache(userId);
  revalidatePath("/today");
  revalidatePath("/payments");
  revalidatePath("/dashboard");
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

// ───────────────────────────────────────── Spends ──
//
// Spends are the headline outflow ledger. amount_base is LOCKED at entry time
// via today's FX (same immutability rule as paid payments). Categories are
// stored as link rows (many-per-spend tag model). Optional `items` are sparse
// receipt-like sub-rows. covers_periods > 1 with a recurring_spend_id means
// this single row pays for N consecutive periods — the engine emits N-1 skip
// rows so the reminder layer stays quiet. loan_installment_id wires the spend
// to a specific installment, flipping it to paid + caching the back-edge.

export type SpendItemInput = {
  name: string;
  amount?: number | null;
  vat_amount?: number | null;
};

export type SpendInput = {
  wallet_id: string;
  spent_at?: string;
  amount: number;
  currency: string;
  description?: string | null;
  notes?: string | null;
  vat_amount?: number | null;
  business_relevant?: boolean;
  covers_periods?: number;
  recurring_spend_id?: string | null;
  loan_id?: string | null;
  loan_installment_id?: string | null;
  categoryIds?: string[];
  items?: SpendItemInput[];
};

export async function createSpend(input: SpendInput) {
  const { supabase, userId } = await userOrThrow();
  const amount = Number(input.amount);
  if (!(amount > 0)) throw new Error("Spend amount must be greater than 0.");
  if (!input.wallet_id) throw new Error("Pick a wallet.");
  if (!input.currency) throw new Error("Pick a currency.");

  const { data: rates } = await supabase
    .from("exchange_rates")
    .select("code,rate_to_base")
    .eq("user_id", userId);
  const rateRows = (rates ?? []) as RatePair[];
  const amountBase = toBaseAmount(amount, input.currency, rateRows);
  const spentAt = input.spent_at ?? new Date().toISOString().slice(0, 10);
  const coversPeriods = Math.max(1, Math.floor(Number(input.covers_periods ?? 1)));

  const { data: spendRow, error: spendErr } = await supabase
    .from("spends")
    .insert({
      user_id: userId,
      wallet_id: input.wallet_id,
      spent_at: spentAt,
      amount,
      currency: input.currency,
      amount_base: Math.round(amountBase * 100) / 100,
      description: input.description ?? null,
      notes: input.notes ?? null,
      vat_amount: input.vat_amount ?? null,
      business_relevant: !!input.business_relevant,
      covers_periods: coversPeriods,
      recurring_spend_id: input.recurring_spend_id ?? null,
      loan_id: input.loan_id ?? null,
      loan_installment_id: input.loan_installment_id ?? null,
    })
    .select("id")
    .single();
  if (spendErr || !spendRow) throw spendErr ?? new Error("Failed to save spend");
  const spendId = spendRow.id as string;

  if (input.categoryIds?.length) {
    const linkRows = input.categoryIds.map((cid) => ({ spend_id: spendId, category_id: cid }));
    const { error: linkErr } = await supabase.from("spend_category_links").insert(linkRows);
    if (linkErr) throw linkErr;
  }

  if (input.items?.length) {
    const itemRows = input.items.map((it, i) => ({
      spend_id: spendId,
      name: it.name,
      amount: it.amount ?? null,
      vat_amount: it.vat_amount ?? null,
      sort_order: i,
    }));
    const { error: itemErr } = await supabase.from("spend_items").insert(itemRows);
    if (itemErr) throw itemErr;
  }

  // Pre-payment: a single row settles N consecutive recurring periods. Emit
  // N-1 skip rows for the future periods so the reminder engine stays quiet.
  if (coversPeriods > 1 && input.recurring_spend_id) {
    const { data: rule } = await supabase
      .from("recurring_spends")
      .select("*")
      .eq("id", input.recurring_spend_id)
      .maybeSingle();
    if (rule) {
      const { prepayPeriodKeys } = await import("@/lib/recurring");
      const futureKeys = prepayPeriodKeys(
        rule as unknown as RecurringSpend,
        new Date(spentAt),
        coversPeriods,
      );
      if (futureKeys.length > 0) {
        const skipRows = futureKeys.map((key) => ({
          recurring_spend_id: input.recurring_spend_id,
          period_key: key,
          source: "covered_by_prepay" as const,
          spend_id: spendId,
        }));
        // Upsert so re-saves don't conflict with existing skips for the same period.
        const { error: skipErr } = await supabase
          .from("recurring_spend_skips")
          .upsert(skipRows, { onConflict: "recurring_spend_id,period_key" });
        if (skipErr) throw skipErr;
      }
    }
  }

  // Loan installment: flip the installment to paid + wire the back-edge.
  if (input.loan_installment_id) {
    const { error: instErr } = await supabase
      .from("loan_installments")
      .update({ status: "paid", spend_id: spendId })
      .eq("id", input.loan_installment_id);
    if (instErr) throw instErr;
  }

  await logEvent({
    userId,
    kind: "spend.added",
    title: `Spent ${input.currency} ${amount.toFixed(2)}${input.description ? ` · ${input.description}` : ""}`,
    entityType: "spend",
    entityId: spendId,
    metadata: {
      amount_base: amountBase,
      wallet_id: input.wallet_id,
      business_relevant: !!input.business_relevant,
      covers_periods: coversPeriods,
      recurring_spend_id: input.recurring_spend_id ?? null,
      loan_id: input.loan_id ?? null,
      loan_installment_id: input.loan_installment_id ?? null,
      category_count: input.categoryIds?.length ?? 0,
    },
  });

  await invalidateAiSafeSpendCache(userId, supabase);
  revalidatePath("/spending");
  revalidatePath("/today");
  revalidatePath("/dashboard");
  return { id: spendId };
}

// Patch editable fields on a spend. NEVER recomputes amount_base from
// amount × current FX — past spends are immutable to FX drift. If you really
// changed the spent amount, the base also changes (that's a correction, not a
// re-float), so the FX rate at update time is used for the new amount.
export async function updateSpend(id: string, input: Partial<SpendInput>) {
  const { supabase, userId } = await userOrThrow();

  const patch: Record<string, unknown> = {};
  const writable: (keyof SpendInput)[] = [
    "wallet_id",
    "spent_at",
    "description",
    "notes",
    "vat_amount",
    "business_relevant",
    "covers_periods",
    "recurring_spend_id",
    "loan_id",
    "loan_installment_id",
  ];
  for (const k of writable) {
    if (k in input) patch[k] = (input as Record<string, unknown>)[k] ?? null;
  }

  // If amount/currency changed, recompute amount_base via TODAY's FX. This is a
  // correction, not a re-float — the user explicitly changed what was spent.
  if (input.amount !== undefined || input.currency !== undefined) {
    const { data: existing } = await supabase
      .from("spends")
      .select("amount,currency")
      .eq("id", id)
      .maybeSingle();
    if (!existing) throw new Error("Spend not found");
    const nextAmount = Number(input.amount ?? existing.amount);
    const nextCurrency = (input.currency ?? existing.currency) as string;
    if (!(nextAmount > 0)) throw new Error("Spend amount must be greater than 0.");
    const { data: rates } = await supabase
      .from("exchange_rates")
      .select("code,rate_to_base")
      .eq("user_id", userId);
    const base = toBaseAmount(nextAmount, nextCurrency, (rates ?? []) as RatePair[]);
    patch.amount = nextAmount;
    patch.currency = nextCurrency;
    patch.amount_base = Math.round(base * 100) / 100;
  }

  if (Object.keys(patch).length > 0) {
    const { error } = await supabase.from("spends").update(patch).eq("id", id).eq("user_id", userId);
    if (error) throw error;
  }

  if (input.categoryIds) {
    await supabase.from("spend_category_links").delete().eq("spend_id", id);
    if (input.categoryIds.length > 0) {
      const linkRows = input.categoryIds.map((cid) => ({ spend_id: id, category_id: cid }));
      const { error: linkErr } = await supabase.from("spend_category_links").insert(linkRows);
      if (linkErr) throw linkErr;
    }
  }

  if (input.items) {
    await supabase.from("spend_items").delete().eq("spend_id", id);
    if (input.items.length > 0) {
      const itemRows = input.items.map((it, i) => ({
        spend_id: id,
        name: it.name,
        amount: it.amount ?? null,
        vat_amount: it.vat_amount ?? null,
        sort_order: i,
      }));
      const { error: itemErr } = await supabase.from("spend_items").insert(itemRows);
      if (itemErr) throw itemErr;
    }
  }

  await logEvent({
    userId,
    kind: "spend.updated",
    title: `Updated spend${input.description ? ` · ${input.description}` : ""}`,
    entityType: "spend",
    entityId: id,
  });

  await invalidateAiSafeSpendCache(userId);
  revalidatePath("/spending");
  revalidatePath("/today");
  revalidatePath("/dashboard");
}

export async function deleteSpend(id: string) {
  const { supabase, userId } = await userOrThrow();
  // spend_category_links + spend_items cascade-delete via FK.
  const { error } = await supabase.from("spends").delete().eq("id", id).eq("user_id", userId);
  if (error) throw error;
  await logEvent({
    userId,
    kind: "spend.removed",
    title: "Removed a spend",
    entityType: "spend",
    entityId: id,
  });
  await invalidateAiSafeSpendCache(userId);
  revalidatePath("/spending");
  revalidatePath("/today");
  revalidatePath("/dashboard");
}

// ───────────────────────────────────────── Spend categories ──
export type SpendCategoryInput = {
  name: string;
  icon?: string | null;
  color?: string | null;
  sort_order?: number;
};

export async function createSpendCategory(input: SpendCategoryInput) {
  const { supabase, userId } = await userOrThrow();
  const name = input.name.trim();
  if (!name) throw new Error("Category needs a name.");
  const { data, error } = await supabase
    .from("spend_categories")
    .insert({
      user_id: userId,
      name,
      icon: input.icon ?? null,
      color: input.color ?? null,
      sort_order: input.sort_order ?? 0,
    })
    .select("id")
    .single();
  if (error) throw error;
  await logEvent({
    userId,
    kind: "spend_category.created",
    title: `Added category · ${name}`,
    entityType: "spend_category",
    entityId: data.id as string,
  });
  revalidatePath("/settings");
  revalidatePath("/spending");
  return data;
}

export async function updateSpendCategory(id: string, input: Partial<SpendCategoryInput>) {
  const { supabase, userId } = await userOrThrow();
  const patch: Record<string, unknown> = {};
  if ("name" in input) patch.name = input.name?.trim();
  if ("icon" in input) patch.icon = input.icon ?? null;
  if ("color" in input) patch.color = input.color ?? null;
  if ("sort_order" in input) patch.sort_order = input.sort_order ?? 0;
  const { error } = await supabase
    .from("spend_categories")
    .update(patch)
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw error;
  await logEvent({
    userId,
    kind: "spend_category.updated",
    title: `Updated category${input.name ? ` · ${input.name}` : ""}`,
    entityType: "spend_category",
    entityId: id,
  });
  revalidatePath("/settings");
  revalidatePath("/spending");
}

export async function archiveSpendCategory(id: string, archived = true) {
  const { supabase, userId } = await userOrThrow();
  const { error } = await supabase
    .from("spend_categories")
    .update({ archived })
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw error;
  await logEvent({
    userId,
    kind: "spend_category.updated",
    title: archived ? "Archived category" : "Restored category",
    entityType: "spend_category",
    entityId: id,
    metadata: { archived },
  });
  revalidatePath("/settings");
  revalidatePath("/spending");
}

export async function deleteSpendCategory(id: string) {
  const { supabase, userId } = await userOrThrow();
  // spend_category_links cascade-delete via FK; existing spends keep their
  // remaining tags (and lose this one) and stay in the ledger.
  const { error } = await supabase
    .from("spend_categories")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw error;
  await logEvent({
    userId,
    kind: "spend_category.deleted",
    title: "Deleted category",
    entityType: "spend_category",
    entityId: id,
  });
  revalidatePath("/settings");
  revalidatePath("/spending");
}

// ───────────────────────────────────────── Recurring spends ──
export type RecurringSpendInput = {
  wallet_id?: string | null;
  label: string;
  expected_amount: number;
  expected_currency: string;
  schedule_kind: RecurringScheduleKind;
  day_of_month?: number | null;
  day_of_week?: number | null;
  every_n_value?: number | null;
  window_before_days?: number;
  window_after_days?: number;
  default_category_ids?: string[];
  business_relevant?: boolean;
  active?: boolean;
  notes?: string | null;
};

export async function createRecurringSpend(input: RecurringSpendInput) {
  const { supabase, userId } = await userOrThrow();
  const label = input.label.trim();
  if (!label) throw new Error("Recurring rule needs a label.");
  if (!(Number(input.expected_amount) > 0)) throw new Error("Expected amount must be greater than 0.");

  const { data, error } = await supabase
    .from("recurring_spends")
    .insert({
      user_id: userId,
      wallet_id: input.wallet_id ?? null,
      label,
      expected_amount: input.expected_amount,
      expected_currency: input.expected_currency,
      schedule_kind: input.schedule_kind,
      day_of_month: input.day_of_month ?? null,
      day_of_week: input.day_of_week ?? null,
      every_n_value: input.every_n_value ?? null,
      window_before_days: input.window_before_days ?? 3,
      window_after_days: input.window_after_days ?? 3,
      default_category_ids: input.default_category_ids ?? [],
      business_relevant: !!input.business_relevant,
      active: input.active ?? true,
      notes: input.notes ?? null,
    })
    .select("id")
    .single();
  if (error) throw error;

  await logEvent({
    userId,
    kind: "recurring_spend.created",
    title: `Added recurring · ${label}`,
    entityType: "recurring_spend",
    entityId: data.id as string,
    metadata: { schedule_kind: input.schedule_kind, expected_amount: input.expected_amount, expected_currency: input.expected_currency },
  });
  await invalidateAiSafeSpendCache(userId);
  revalidatePath("/settings");
  revalidatePath("/today");
  revalidatePath("/dashboard");
  return data;
}

export async function updateRecurringSpend(id: string, input: Partial<RecurringSpendInput>) {
  const { supabase, userId } = await userOrThrow();
  const patch: Record<string, unknown> = {};
  const writable: (keyof RecurringSpendInput)[] = [
    "wallet_id",
    "label",
    "expected_amount",
    "expected_currency",
    "schedule_kind",
    "day_of_month",
    "day_of_week",
    "every_n_value",
    "window_before_days",
    "window_after_days",
    "default_category_ids",
    "business_relevant",
    "active",
    "notes",
  ];
  for (const k of writable) {
    if (k in input) patch[k] = (input as Record<string, unknown>)[k];
  }
  const { error } = await supabase
    .from("recurring_spends")
    .update(patch)
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw error;

  await logEvent({
    userId,
    kind: "recurring_spend.updated",
    title: `Updated recurring${input.label ? ` · ${input.label}` : ""}`,
    entityType: "recurring_spend",
    entityId: id,
  });
  await invalidateAiSafeSpendCache(userId);
  revalidatePath("/settings");
  revalidatePath("/today");
  revalidatePath("/dashboard");
}

export async function deleteRecurringSpend(id: string) {
  const { supabase, userId } = await userOrThrow();
  // recurring_spend_skips cascade-delete via FK. Past spends with
  // recurring_spend_id pointing here become orphaned (SET NULL) and remain
  // in the ledger — past money paid is immutable.
  const { error } = await supabase
    .from("recurring_spends")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw error;
  await logEvent({
    userId,
    kind: "recurring_spend.deleted",
    title: "Deleted recurring",
    entityType: "recurring_spend",
    entityId: id,
  });
  await invalidateAiSafeSpendCache(userId);
  revalidatePath("/settings");
  revalidatePath("/today");
  revalidatePath("/dashboard");
}

export type MarkRecurringPaidInput = {
  recurring_spend_id: string;
  wallet_id: string;
  amount: number;
  currency: string;
  paid_at: string;
  covers_periods?: number;
  description?: string | null;
  notes?: string | null;
};

// "I paid this recurring this period" from the Today nudge. Inherits the rule's
// default categories + business_relevant flag, then defers to createSpend (which
// handles covers_periods → skip rows + cache invalidation).
export async function markRecurringPaid(input: MarkRecurringPaidInput) {
  const { supabase, userId } = await userOrThrow();
  const { data: rule } = await supabase
    .from("recurring_spends")
    .select("*")
    .eq("id", input.recurring_spend_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!rule) throw new Error("Recurring rule not found.");

  const result = await createSpend({
    wallet_id: input.wallet_id,
    spent_at: input.paid_at,
    amount: input.amount,
    currency: input.currency,
    description: input.description ?? (rule.label as string),
    notes: input.notes ?? null,
    business_relevant: rule.business_relevant as boolean,
    covers_periods: input.covers_periods ?? 1,
    recurring_spend_id: input.recurring_spend_id,
    categoryIds: (rule.default_category_ids as string[]) ?? [],
  });

  await logEvent({
    userId,
    kind: "recurring_spend.paid",
    title: `Paid recurring · ${rule.label}`,
    entityType: "recurring_spend",
    entityId: input.recurring_spend_id,
    metadata: {
      spend_id: result.id,
      covers_periods: input.covers_periods ?? 1,
    },
  });
  await invalidateAiSafeSpendCache(userId);
  return result;
}

export async function markRecurringSkipped(
  recurring_spend_id: string,
  period_key: string,
  notes?: string | null,
) {
  const { supabase, userId } = await userOrThrow();
  // Verify the rule belongs to this user (RLS-via-recurring on the skips table
  // already guards this, but the explicit check gives a friendlier error).
  const { data: rule } = await supabase
    .from("recurring_spends")
    .select("id,label")
    .eq("id", recurring_spend_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!rule) throw new Error("Recurring rule not found.");

  const { error } = await supabase
    .from("recurring_spend_skips")
    .upsert(
      {
        recurring_spend_id,
        period_key,
        source: "user_skip",
        notes: notes ?? null,
      },
      { onConflict: "recurring_spend_id,period_key" },
    );
  if (error) throw error;

  await logEvent({
    userId,
    kind: "recurring_spend.skipped",
    title: `Skipped recurring · ${rule.label} · ${period_key}`,
    entityType: "recurring_spend",
    entityId: recurring_spend_id,
    metadata: { period_key },
  });
  await invalidateAiSafeSpendCache(userId);
  revalidatePath("/today");
  revalidatePath("/dashboard");
}

// ───────────────────────────────────────── Loans ──
export type LoanInstallmentSeed = {
  due_date: string;
  expected_amount: number;
  expected_currency: string;
  notes?: string | null;
};

export type LoanInput = {
  counterparty: string;
  direction: LoanDirection;
  principal_amount: number;
  principal_currency: string;
  borrowed_at?: string;
  expected_return_by?: string | null;
  notes?: string | null;
  installments?: LoanInstallmentSeed[];
};

export async function createLoan(input: LoanInput) {
  const { supabase, userId } = await userOrThrow();
  const counterparty = input.counterparty.trim();
  if (!counterparty) throw new Error("Loan needs a counterparty name.");
  if (!(Number(input.principal_amount) > 0)) throw new Error("Principal must be greater than 0.");

  const { data: rates } = await supabase
    .from("exchange_rates")
    .select("code,rate_to_base")
    .eq("user_id", userId);
  const principalBase = toBaseAmount(
    Number(input.principal_amount),
    input.principal_currency,
    (rates ?? []) as RatePair[],
  );

  const { data: loan, error: loanErr } = await supabase
    .from("loans")
    .insert({
      user_id: userId,
      counterparty,
      direction: input.direction,
      principal_amount: input.principal_amount,
      principal_currency: input.principal_currency,
      principal_base: Math.round(principalBase * 100) / 100,
      borrowed_at: input.borrowed_at ?? new Date().toISOString().slice(0, 10),
      expected_return_by: input.expected_return_by ?? null,
      notes: input.notes ?? null,
    })
    .select("id")
    .single();
  if (loanErr || !loan) throw loanErr ?? new Error("Failed to save loan");

  if (input.installments?.length) {
    const rows = input.installments.map((inst) => ({
      loan_id: loan.id,
      due_date: inst.due_date,
      expected_amount: inst.expected_amount,
      expected_currency: inst.expected_currency,
      notes: inst.notes ?? null,
    }));
    const { error: instErr } = await supabase.from("loan_installments").insert(rows);
    if (instErr) throw instErr;
  }

  await logEvent({
    userId,
    kind: "loan.created",
    title: `${input.direction === "borrowed" ? "Borrowed from" : "Lent to"} ${counterparty} · ${input.principal_currency} ${Number(input.principal_amount).toFixed(2)}`,
    entityType: "loan",
    entityId: loan.id as string,
    metadata: {
      direction: input.direction,
      principal_amount: input.principal_amount,
      principal_currency: input.principal_currency,
      principal_base: principalBase,
      installment_count: input.installments?.length ?? 0,
    },
  });
  await invalidateAiSafeSpendCache(userId);
  revalidatePath("/loans");
  revalidatePath("/today");
  revalidatePath("/dashboard");
  return loan;
}

export async function updateLoan(
  id: string,
  input: Partial<Pick<LoanInput, "counterparty" | "expected_return_by" | "notes"> & { status: LoanStatus }>,
) {
  const { supabase, userId } = await userOrThrow();
  const patch: Record<string, unknown> = {};
  if ("counterparty" in input) patch.counterparty = input.counterparty?.trim();
  if ("expected_return_by" in input) patch.expected_return_by = input.expected_return_by ?? null;
  if ("notes" in input) patch.notes = input.notes ?? null;
  if ("status" in input) patch.status = input.status;
  const { error } = await supabase.from("loans").update(patch).eq("id", id).eq("user_id", userId);
  if (error) throw error;
  await logEvent({
    userId,
    kind: "loan.updated",
    title: `Updated loan${input.counterparty ? ` · ${input.counterparty}` : ""}`,
    entityType: "loan",
    entityId: id,
  });
  await invalidateAiSafeSpendCache(userId);
  revalidatePath("/loans");
  revalidatePath("/today");
  revalidatePath("/dashboard");
}

export async function closeLoan(id: string) {
  const { supabase, userId } = await userOrThrow();
  const { error } = await supabase
    .from("loans")
    .update({ status: "closed" })
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw error;
  await logEvent({
    userId,
    kind: "loan.closed",
    title: "Closed loan",
    entityType: "loan",
    entityId: id,
  });
  await invalidateAiSafeSpendCache(userId);
  revalidatePath("/loans");
  revalidatePath("/today");
  revalidatePath("/dashboard");
}

export async function deleteLoan(id: string) {
  const { supabase, userId } = await userOrThrow();
  // loan_installments cascade-delete via FK. Past spends with loan_id pointing
  // here become orphaned (SET NULL) — actual money paid stays in the ledger.
  const { error } = await supabase.from("loans").delete().eq("id", id).eq("user_id", userId);
  if (error) throw error;
  await logEvent({
    userId,
    kind: "loan.deleted",
    title: "Deleted loan",
    entityType: "loan",
    entityId: id,
  });
  await invalidateAiSafeSpendCache(userId);
  revalidatePath("/loans");
  revalidatePath("/today");
  revalidatePath("/dashboard");
}

// ───────────────────────────────────────── Loan installments ──
export type LoanInstallmentInput = {
  loan_id: string;
  due_date: string;
  expected_amount: number;
  expected_currency: string;
  notes?: string | null;
};

export async function createLoanInstallment(input: LoanInstallmentInput) {
  const { supabase, userId } = await userOrThrow();
  if (!(Number(input.expected_amount) > 0)) throw new Error("Installment amount must be greater than 0.");
  const { data, error } = await supabase
    .from("loan_installments")
    .insert({
      loan_id: input.loan_id,
      due_date: input.due_date,
      expected_amount: input.expected_amount,
      expected_currency: input.expected_currency,
      notes: input.notes ?? null,
    })
    .select("id")
    .single();
  if (error) throw error;
  await logEvent({
    userId,
    kind: "loan_installment.added",
    title: `Added installment · due ${input.due_date}`,
    entityType: "loan_installment",
    entityId: data.id as string,
    metadata: {
      loan_id: input.loan_id,
      due_date: input.due_date,
      expected_amount: input.expected_amount,
      expected_currency: input.expected_currency,
    },
  });
  await invalidateAiSafeSpendCache(userId);
  revalidatePath("/loans");
  revalidatePath("/today");
  revalidatePath("/dashboard");
  return data;
}

export type MarkLoanInstallmentPaidInput = {
  installment_id: string;
  wallet_id: string;
  amount: number;
  currency: string;
  paid_at: string;
  notes?: string | null;
};

// Materialize a paid installment as a real spend. Auto-tags "Loan repayment"
// (the seeded category from migration 0020) when the user has it. createSpend
// flips the installment to paid + wires the back-edge.
export async function markLoanInstallmentPaid(input: MarkLoanInstallmentPaidInput) {
  const { supabase, userId } = await userOrThrow();

  const { data: installment } = await supabase
    .from("loan_installments")
    .select("id,loan_id,expected_amount,expected_currency")
    .eq("id", input.installment_id)
    .maybeSingle();
  if (!installment) throw new Error("Installment not found.");

  const { data: loanRepaymentCat } = await supabase
    .from("spend_categories")
    .select("id")
    .eq("user_id", userId)
    .eq("name", "Loan repayment")
    .maybeSingle();

  const result = await createSpend({
    wallet_id: input.wallet_id,
    spent_at: input.paid_at,
    amount: input.amount,
    currency: input.currency,
    notes: input.notes ?? null,
    loan_id: installment.loan_id as string,
    loan_installment_id: input.installment_id,
    categoryIds: loanRepaymentCat ? [loanRepaymentCat.id as string] : [],
  });

  await logEvent({
    userId,
    kind: "loan_installment.paid",
    title: `Paid installment · ${input.currency} ${Number(input.amount).toFixed(2)}`,
    entityType: "loan_installment",
    entityId: input.installment_id,
    metadata: { loan_id: installment.loan_id, spend_id: result.id },
  });
  await invalidateAiSafeSpendCache(userId);
  return result;
}

export async function markLoanInstallmentSkipped(installment_id: string) {
  const { supabase, userId } = await userOrThrow();
  // Defense-in-depth: confirm the parent loan belongs to this user before the
  // UPDATE. RLS via parent loan ownership already covers us, but a direct
  // check here means a forged id can never even reach the write.
  const { data: owned } = await supabase
    .from("loan_installments")
    .select("id, loans!inner(user_id)")
    .eq("id", installment_id)
    .eq("loans.user_id", userId)
    .maybeSingle();
  if (!owned) throw new Error("Installment not found.");
  const { error } = await supabase
    .from("loan_installments")
    .update({ status: "skipped" })
    .eq("id", installment_id);
  if (error) throw error;
  await logEvent({
    userId,
    kind: "loan_installment.skipped",
    title: "Skipped installment",
    entityType: "loan_installment",
    entityId: installment_id,
  });
  await invalidateAiSafeSpendCache(userId);
  revalidatePath("/loans");
  revalidatePath("/today");
  revalidatePath("/dashboard");
}

export async function deleteLoanInstallment(id: string) {
  const { supabase, userId } = await userOrThrow();
  // Same defense-in-depth as markLoanInstallmentSkipped — RLS covers us but
  // make the ownership check explicit before a destructive DELETE.
  const { data: owned } = await supabase
    .from("loan_installments")
    .select("id, loans!inner(user_id)")
    .eq("id", id)
    .eq("loans.user_id", userId)
    .maybeSingle();
  if (!owned) throw new Error("Installment not found.");
  const { error } = await supabase.from("loan_installments").delete().eq("id", id);
  if (error) throw error;
  await logEvent({
    userId,
    kind: "loan_installment.deleted",
    title: "Deleted installment",
    entityType: "loan_installment",
    entityId: id,
  });
  await invalidateAiSafeSpendCache(userId);
  revalidatePath("/loans");
  revalidatePath("/today");
  revalidatePath("/dashboard");
}

// ───────────────────────────────────────── User memory ──
//
// Raw entries accumulate, then Gemini folds them into the living
// memory_consolidated doc on user_memory (mirrors the client memory pattern).
// recordUserMemoryNote logs a user-authored note + triggers consolidation.
// recordUserMemoryObservation is silent — the AI calling layer batches and
// consolidates separately to keep the activity feed clean.

export async function recordUserMemoryNote(content: string) {
  const { supabase, userId } = await userOrThrow();
  const trimmed = content.trim();
  if (!trimmed) throw new Error("Write something first.");
  const { data, error } = await supabase
    .from("user_memory_entries")
    .insert({ user_id: userId, content: trimmed, source: "user_note" })
    .select("id")
    .single();
  if (error) throw error;
  await logEvent({
    userId,
    kind: "user_memory.note_added",
    title: "Added to your money memory",
    entityType: "user_memory",
    entityId: data.id as string,
  });
  // Non-blocking: kick off consolidation but don't await the heavy Gemini call.
  // Mirrors the consolidateClientMemoryAction pattern — the UI re-renders fast
  // while the AI fold runs in the background.
  void import("@/lib/ai/user-memory").then((m) => m.consolidateUserMemory()).catch(() => {});
  revalidatePath("/settings");
  return data;
}

export async function recordUserMemoryObservation(content: string) {
  const { supabase, userId } = await userOrThrow();
  const trimmed = content.trim();
  if (!trimmed) return null;
  const { data, error } = await supabase
    .from("user_memory_entries")
    .insert({ user_id: userId, content: trimmed, source: "observation" })
    .select("id")
    .single();
  if (error) throw error;
  // No event log: observations are AI-internal noise; the activity feed stays
  // for things the user did. The calling layer batches consolidation.
  return data;
}

// ───────────────────────────────────────── Wallet opening balance ──
//
// Anchors what a holding wallet was carrying on a given date so the runway
// countdown + safe-to-spend dial can subtract spends/withdrawals from a real
// starting point instead of zero. Opening_balance is in PHP — the user picks
// the wallet, types the PHP value they had on that day, and the math layer
// sums everything from opening_balance_at forward. Touching this changes
// holdings → safe-to-spend cache must be dropped.
export type WalletOpeningBalanceInput = {
  methodId: string;
  amountBase: number;
  dateOpt?: string;
};

export async function setWalletOpeningBalance(input: WalletOpeningBalanceInput) {
  const { supabase, userId } = await userOrThrow();
  if (!Number.isFinite(input.amountBase) || input.amountBase < 0) {
    throw new Error("Opening balance must be 0 or more.");
  }
  const opening_balance_at = input.dateOpt ?? new Date().toISOString().slice(0, 10);
  const { error } = await supabase
    .from("payment_methods")
    .update({
      opening_balance_base: input.amountBase,
      opening_balance_at,
    })
    .eq("id", input.methodId)
    .eq("user_id", userId);
  if (error) throw error;
  await logEvent({
    userId,
    kind: "wallet.opening_balance_set",
    title: `Set opening balance · PHP ${input.amountBase.toFixed(2)}`,
    entityType: "payment_method",
    entityId: input.methodId,
    metadata: { amount_base: input.amountBase, at: opening_balance_at },
  });
  await invalidateAiSafeSpendCache(userId, supabase);
  revalidatePath("/settings");
  revalidatePath("/dashboard");
  revalidatePath("/today");
}

// ───────────────────────────────────────── AI questions (Phase 1.5) ──
//
// Thin server-action wrappers around ai/ai-questions so the AI Questions card
// on /today can call them directly from a client component. The heavy logic
// (memory-fold on answer, event logging) lives in the underlying module.
export async function queueAiQuestionAction(input: {
  question: string;
  kind: AiQuestionKind;
  context: Record<string, unknown>;
  options?: string[];
  sourceEntityType?: AiQuestionSourceType;
  sourceEntityId?: string;
  priority?: number;
}): Promise<AiQuestion> {
  const { queueAiQuestion } = await import("@/lib/ai/ai-questions");
  const row = await queueAiQuestion(input);
  revalidatePath("/today");
  return row;
}

export async function answerAiQuestionAction(id: string, answer: string): Promise<void> {
  const { answerAiQuestion } = await import("@/lib/ai/ai-questions");
  await answerAiQuestion(id, answer);
  revalidatePath("/today");
  revalidatePath("/settings");
}

export async function dismissAiQuestionAction(id: string): Promise<void> {
  const { dismissAiQuestion } = await import("@/lib/ai/ai-questions");
  await dismissAiQuestion(id);
  revalidatePath("/today");
}

// Triggers the periodic curiosity sweep that fills the AI Questions inbox.
// Manual entry-point for "ask me what you're missing now" + the future cron.
export async function runCuriositySweepAction(): Promise<{
  queued: number;
  questions: AiQuestion[];
}> {
  const { runCuriositySweep } = await import("@/lib/ai/curiosity-sweep");
  const summary = await runCuriositySweep();
  revalidatePath("/today");
  return summary;
}

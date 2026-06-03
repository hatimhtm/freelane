"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logEvent } from "@/lib/data/events";
import { phtToday } from "@/lib/utils";
import {
  ALL_BRAIN_KEYS,
  FINANCIAL_INVALIDATION_EXEMPT,
  SPEND_INVALIDATION_FLOOR_BASE,
} from "@/lib/ai/cache-keys";
import {
  insertLedger,
  archiveLedger,
  replaceLedgerRow,
} from "@/lib/data/money-ledger";
import { onIncomeContribution } from "@/lib/sadaka/contribution";
import { onSpendCreated as onSpendSadakaDetect } from "@/lib/sadaka/auto-detect";
import {
  insertSadakaLedgerRow,
  findLiveLedgerRowBySource,
  archiveSadakaLedgerRow,
} from "@/lib/sadaka/ledger";
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

// Result wrapper for actions whose UX needs to surface the REAL underlying
// error. Next 16 masks any thrown error from a server action in production
// builds with a generic "Server Components render" message; returning a
// structured value sidesteps that and lets the toast show what actually
// went wrong. Always logs the message server-side too so the same info
// reaches Vercel logs.
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

async function safeRun<T>(label: string, fn: () => Promise<T>): Promise<ActionResult<T>> {
  return safeRunLabeled("freelane-action", label, fn);
}

// Canonical labeled-prefix variant — exported so notifications/actions.ts
// (and any future "use server" module) can reuse the exact same error +
// console-log contract without re-declaring its own copy. The prefix lets
// each caller surface its own log namespace (freelane-action, freelane-notif,
// …) while keeping ONE implementation of the try/catch + ActionResult shape.
export async function safeRunLabeled<T>(
  prefix: string,
  label: string,
  fn: () => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // eslint-disable-next-line no-console
    console.error(`[${prefix}:${label}]`, message);
    return { ok: false, error: message || "Something went wrong." };
  }
}

// Drops every spend-driven entry from ai_brain_cache so the next read of any
// affected brain recomputes from scratch. Called from every mutation that
// changes the math (spends, payments, withdrawals, recurring paid/skipped,
// loan installments, rule edits). Best-effort: failures don't block the
// parent mutation. Reuses the caller's supabase client when passed to avoid
// the redundant createClient() round-trip on hot paths.
//
// The brain-key list is driven off the canonical ALL_BRAIN_KEYS catalogue
// in cache-keys.ts — adding a new brain there automatically buses it here.
// FINANCIAL_INVALIDATION_EXEMPT brains (year_recall, eid_prep) are
// deliberately excluded because their freshness is calendar-driven, not
// spend-driven; they refresh on TTL alone.
//
// The optional `opts.amountBase` gate lets the caller skip invalidation for
// trivially small spends (< SPEND_INVALIDATION_FLOOR_BASE). A ₱5 cigarette
// doesn't change the headline; a ₱200+ spend does. All other mutation kinds
// (payments, wallet anchors, recurring rules, plans) pass no amount and
// invalidate unconditionally.
//
// As of 2026-06-02 calm-weather and safe-to-spend-ai both live in
// ai_brain_cache (migrated onto withBrainCache). The earlier per-table writes
// against ai_safe_spend_cache and calm_weather_state are now dead, so this
// fan-out collapses to a single delete against the canonical table.
/**
 * Drops every spend-driven entry from ai_brain_cache so the next read of any
 * affected brain recomputes from scratch. Also fires the chatbot's
 * "significant state-change" hook — surfaceNextOpenQuestion is invoked
 * fire-and-forget when opts.surfaceQuestion is true (wallet first-anchor,
 * plan add, recurring rule add, payment received, etc.) so a structural
 * change has a chance to drip-feed a clarifying question.
 *
 * The IDLE side (daily PHT-midnight surfacing + stale 'asked' recycling)
 * lives in src/app/api/cron/surface-question/route.ts and is scheduled in
 * vercel.json. This function only owns the event-driven half; the cron
 * picks up the rest.
 */
async function invalidateAiSafeSpendCache(
  userId: string,
  existing?: Awaited<ReturnType<typeof createClient>>,
  opts: { amountBase?: number; surfaceQuestion?: boolean } = {},
): Promise<void> {
  if (
    typeof opts.amountBase === "number" &&
    opts.amountBase < SPEND_INVALIDATION_FLOOR_BASE
  ) {
    return; // tiny spend — TTL/fingerprint still catches the drift if needed
  }
  try {
    const supabase = existing ?? (await createClient());
    const keysToInvalidate = ALL_BRAIN_KEYS.filter(
      (k) => !FINANCIAL_INVALIDATION_EXEMPT.includes(k),
    );
    await supabase
      .from("ai_brain_cache")
      .delete()
      .eq("user_id", userId)
      .in("brain_key", keysToInvalidate as unknown as string[]);
  } catch {
    // Swallow — the cache is regenerable; not worth failing a real write.
  }
  if (opts.surfaceQuestion) {
    await maybeSurfaceClarifyingQuestion();
  }
}

// Spendings workflow (migration 0085) — upsert today's PHT-anchored
// initial safe-to-spend snapshot. Best-effort: a failure here just
// means the next read recomputes (the LIVE DAILY SAFE display
// fallback in computeSafeToSpend handles a null snapshot gracefully).
export async function upsertDailySafeSnapshot(input: {
  initialSafeBase: number;
  currency: string;
}): Promise<ActionResult<{ pht_date: string }>> {
  return safeRun("upsertDailySafeSnapshot", async () => {
    const { supabase, userId } = await userOrThrow();
    const phtDate = phtToday();
    // Destructure { error } so RLS denials / constraint violations /
    // transport failures surface up through safeRun as ok:false. Without
    // this, the upsert silently no-ops and the calling page fabricates
    // an in-memory snapshot that the next render's DB read can't see —
    // violating the "stable across the PHT day" invariant the snapshot
    // exists to provide.
    const { error } = await supabase
      .from("daily_safe_snapshots")
      .upsert(
        {
          user_id: userId,
          pht_date: phtDate,
          initial_safe_base: Math.max(0, Math.round(input.initialSafeBase)),
          currency: input.currency,
          computed_at: new Date().toISOString(),
        },
        { onConflict: "user_id,pht_date", ignoreDuplicates: false },
      );
    if (error) throw error;
    return { pht_date: phtDate };
  });
}

// Fire-and-forget hook for mutations that don't otherwise touch the AI
// brain cache (vendor / entity / client creation) but still represent a
// "significant event" worth letting the chatbot brain consider asking
// about. Safe to call from anywhere — failures are swallowed.
export async function maybeSurfaceClarifyingQuestion(): Promise<void> {
  try {
    const { surfaceNextOpenQuestion } = await import(
      "@/lib/ai/open-questions-actions"
    );
    // Await the call so module-eval throws and synchronous failures
    // before the promise even forms cannot bubble past the try/catch.
    // The brain itself is best-effort; we still don't block on its
    // result by ignoring the resolved/rejected outcome via .catch.
    try {
      await surfaceNextOpenQuestion();
    } catch {
      // brain runtime failure — swallowed
    }
  } catch {
    // ignore — dynamic import safety net
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
  // New client = structural event — chatbot brain may want to ask about
  // them. Fire-and-forget; doesn't gate the response.
  await maybeSurfaceClarifyingQuestion();
  // Seed initial facts from any notes the user typed on creation. The
  // dialog's debounce doesn't fire for brand-new clients (no id yet);
  // this is the single chance to capture them on first save.
  if (typeof input.notes === "string" && input.notes.trim().length > 0) {
    try {
      const { extractClientFactsAction } = await import("@/lib/ai/facts-actions");
      void extractClientFactsAction(data.id as string, input.notes).catch(() => {});
    } catch {
      // dynamic-import safety net — ignore.
    }
  }
  revalidatePath("/clients");
  revalidatePath("/projects");
  revalidatePath("/dashboard");
  return data;
}

export async function updateClientRecord(id: string, input: Partial<ClientInput>) {
  const { supabase, userId } = await userOrThrow();
  const patch = pickClientFields(input);

  // Capture prior notes BEFORE the update so we can skip the facts-
  // extraction fallback when notes didn't change. Saves a Supabase
  // round-trip for the prior-facts read on identity saves (e.g. someone
  // tweaks the phone number without touching notes).
  let priorNotes: string | null = null;
  if (typeof input.notes === "string") {
    const { data: prior } = await supabase
      .from("clients")
      .select("notes")
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle();
    priorNotes = (prior?.notes as string | null) ?? null;
  }

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

  // Server-side facts-extraction fallback — only when notes actually
  // changed. The client dialog also schedules a 30s debounce, but a save
  // that finalises a quick typing burst (or a save while the timer
  // hasn't elapsed yet) would otherwise miss the extraction window.
  // Brain-cache fingerprint guards against re-running on identical
  // notes, but skipping the action entirely on identity-saves avoids
  // even the prior-facts read.
  if (typeof input.notes === "string" && input.notes !== (priorNotes ?? "")) {
    try {
      const { extractClientFactsAction } = await import("@/lib/ai/facts-actions");
      void extractClientFactsAction(id, input.notes).catch(() => {});
    } catch {
      // dynamic-import safety net — ignore.
    }
  }

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
  if (status === "paid") extras.completed_at = phtToday();

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
      paid_at: phtToday(),
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
  if (status === "paid") patch.completed_at = phtToday();
  const { error } = await supabase.from("projects").update(patch).eq("id", id).eq("user_id", userId);
  if (error) throw error;

  const { data: project } = await supabase
    .from("projects")
    .select("title,client_id,amount")
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

  // Pattern-change hook — flipping a project to paid is the moment the
  // baseline absorbs a new completed-amount sample, so the z-score check
  // becomes meaningful. Fire-and-forget; brain failures must not block
  // the status flip itself.
  const clientId = project?.client_id as string | undefined;
  if (clientId && status === "paid") {
    try {
      const { runClientPatternChangeForEvent } = await import(
        "@/lib/ai/client-pattern-actions"
      );
      void runClientPatternChangeForEvent(clientId, {
        kind: "project_status_change",
        projectId: id,
        amount: Number(project?.amount ?? 0),
      }).catch(() => {});
    } catch {
      // dynamic-import safety net — ignore.
    }
  }

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

// Resolve a spend's description against the user's vendors + entities tables.
// Explicit IDs from the caller short-circuit auto-resolution (the user already
// decided). Returns the IDs the spend should be linked to.
async function resolveLinksForSpend(args: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  description: string | null;
  explicitVendorIds?: string[];
  explicitEntityIds?: string[];
}): Promise<{ vendorIds: string[]; entityIds: string[] }> {
  const desc = (args.description ?? "").trim();
  const vendorIds = args.explicitVendorIds ?? [];
  const entityIds = args.explicitEntityIds ?? [];

  // If the caller fully supplied both lists, skip the lookup entirely.
  if (args.explicitVendorIds && args.explicitEntityIds) {
    return { vendorIds, entityIds };
  }
  if (!desc) return { vendorIds, entityIds };

  // One round-trip to fetch the lookup tables. Cheap — per-user tables stay
  // small (< 1000 rows even for active users).
  const [{ data: vendorsData }, { data: aliasesData }, { data: entitiesData }] = await Promise.all([
    args.supabase.from("vendors").select("*").eq("user_id", args.userId).eq("archived", false),
    args.supabase.from("vendor_aliases").select("*"),
    args.supabase.from("entities").select("*").eq("user_id", args.userId).eq("archived", false),
  ]);

  if (!args.explicitVendorIds) {
    const { resolveVendor } = await import("@/lib/vendor-resolution");
    const res = resolveVendor(desc, vendorsData ?? [], aliasesData ?? []);
    if (res.vendor) vendorIds.push(res.vendor.id);
  }
  if (!args.explicitEntityIds) {
    const { matchEntitiesInDescription } = await import("@/lib/entity-resolution");
    const matches = matchEntitiesInDescription(desc, entitiesData ?? []);
    for (const m of matches) {
      if (!entityIds.includes(m.entity.id)) entityIds.push(m.entity.id);
    }
  }
  return { vendorIds, entityIds };
}

// Accepts "HH:mm" or "HH:mm:ss" from the spend modal's time picker; returns
// "HH:mm:ss" for Postgres `time` columns. Empty/null pass through as null so
// the row stays date-only. Anything malformed → null (defensive).
function normalizeTimeOfDay(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(trimmed);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  const s = Number(match[3] ?? 0);
  if (h < 0 || h > 23 || m < 0 || m > 59 || s < 0 || s > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
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

  // Mirror the income onto money_ledger (Phase 1.5). The landing wallet
  // is the final hop's method_id. Skipped (no wallet) only when the chain
  // ended on null — pre-holding-wallet quick-adds. Best-effort.
  const landingWalletId = final.method_id ?? null;
  if (landingWalletId && netBase > 0) {
    await insertLedger({
      client: supabase,
      kind: "income",
      amount_base: netBase,
      wallet_id: landingWalletId,
      related_kind: "payment",
      related_id: paymentRow.id as string,
      event_at: new Date(input.paid_at).toISOString(),
      note: "addPaymentWithChain",
    });
  }

  // Sadaka contribution hook — Pro brain decides the rate for THIS income
  // event, writes a contribution row to sadaka_ledger. Best-effort; never
  // throws (the payment has already landed and the user's wallet is correct).
  await onIncomeContribution({
    paymentId: paymentRow.id as string,
    netAmountBase: netBase,
    paidAt: input.paid_at,
  }).catch(() => {});

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

  // Payment received = structural event (cash arrived) — give the
  // chatbot brain a chance to surface a follow-up question.
  await invalidateAiSafeSpendCache(userId, supabase, { surfaceQuestion: true });

  // Fire-and-forget client-pattern detection. Wrapped in catch so a brain
  // failure (Gemini outage, missing baseline table, anything) NEVER blocks
  // the payment landing. Dynamic import keeps the data module decoupled
  // from the AI surface.
  try {
    const { runClientPatternChangeForEvent } = await import(
      "@/lib/ai/client-pattern-actions"
    );
    void runClientPatternChangeForEvent(project.client_id as string, {
      kind: "payment",
      paymentId: paymentRow.id as string,
      walletId: final.method_id ?? null,
    }).catch(() => {});
  } catch {
    // dynamic-import safety net — ignore.
  }

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
//
// money_ledger contract (single source of truth — do NOT trace the comment
// chain for this):
//   • updatePayment           — NOT a ledger writer. Safe-field metadata only;
//                               wallet math is untouched, so nothing to mirror.
//   • updatePaymentDetails    — IS the atomic money-edit writer. Calls
//                               replaceLedgerRow (SECURITY DEFINER RPC from
//                               migration 0070) so the prior live row is
//                               archived + the fresh row inserted in one step.
//                               Reviewers do NOT need to chase a delete +
//                               re-create path for the money edit.
//   • addPaymentWithChain     — writes the initial income row tied to the
//                               chain's landing wallet (final step's method_id).
//   • deletePayment           — archives the live ledger row for the payment.
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

  // Mirror the edited income on money_ledger (Phase 1.5). Single atomic
  // RPC archives the prior live row + inserts the fresh one so the wallet
  // can never end up half-archived. Wallet resolved from the final step
  // after any method_id edit above.
  try {
    const { data: finalStepRow } = await supabase
      .from("payment_steps")
      .select("method_id")
      .eq("payment_id", paymentId)
      .order("step_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const landingWalletId = (finalStepRow?.method_id as string | null) ?? null;
    if (landingWalletId && net > 0) {
      await replaceLedgerRow({
        client: supabase,
        related_kind: "payment",
        related_id: paymentId,
        event_at: new Date().toISOString(),
        kind: "income",
        amount_base: net,
        wallet_id: landingWalletId,
        note: "updatePaymentDetails",
      });
    } else {
      // No landing wallet or zero net — just archive the live row.
      await archiveLedger("payment", paymentId, supabase);
    }
  } catch {
    // Best-effort — replaceLedgerRow already logs to money_ledger_write_failures.
  }

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

  // Archive the live ledger row for this payment. Audit trail kept.
  await archiveLedger("payment", id, supabase);

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

// NOTE: `expenses` is the legacy freelancer-expenses table — it is NOT
// mirrored to money_ledger, NOT read by the forecast brain, and NOT
// consumed by any wallet-balance reader. So createExpense / updateExpense
// / deleteExpense deliberately do NOT call invalidateAiSafeSpendCache.
// The active spending pipeline is finance.spends (createSpend etc.) which
// DOES invalidate.
export async function createExpense(input: ExpenseInput) {
  const { supabase, userId } = await userOrThrow();
  const { error, data } = await supabase
    .from("expenses")
    .insert({
      user_id: userId,
      spent_at: input.spent_at ?? phtToday(),
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
  // T14 — per-wallet overdraft tolerance (₱ base). Display + alarm threshold
  // only; never folded into safe-to-spend math.
  overdraft_tolerance_base?: number;
  notes?: string | null;
  // Stable brand identifier from src/lib/brand/wallets.ts (migration 0078).
  // Explicit picker write — what the resolver fallback comment calls out
  // as the user's escape hatch when fuzzy-match misses an idiosyncratic
  // wallet name. Pass null to clear and fall back to fuzzy matching.
  brand_key?: string | null;
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
      overdraft_tolerance_base: input.overdraft_tolerance_base ?? 0,
      notes: input.notes ?? null,
      brand_key: input.brand_key ?? null,
    })
    .select("id")
    .single();
  if (error) throw error;
  await logEvent({ userId, kind: "method.created", title: `Added method · ${input.name}`, entityType: "payment_method", entityId: data.id as string });
  // New wallet = significant structural change — give the chatbot brain a
  // chance to ask a follow-up about how this wallet will be used.
  await invalidateAiSafeSpendCache(userId, supabase, { surfaceQuestion: true });
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

// Dedicated brand-picker write. Wraps updatePaymentMethod with the result
// shape the picker UI needs (ActionResult so the toast can surface the
// real underlying error) and the explicit "set to null = clear" semantics
// the resolver fallback path relies on. Mirrors the brief's call-out of
// the picker as the user's escape hatch for idiosyncratically named
// wallets — fuzzy fallback stays in place once brand_key is null again.
export async function updateMethodBrand(
  id: string,
  brandKey: string | null,
): Promise<ActionResult<{ id: string; brand_key: string | null }>> {
  return safeRun("updateMethodBrand", async () => {
    const { supabase, userId } = await userOrThrow();
    const normalized = brandKey?.trim() ? brandKey.trim() : null;
    const { error } = await supabase
      .from("payment_methods")
      .update({ brand_key: normalized })
      .eq("id", id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    await logEvent({
      userId,
      kind: "method.updated",
      title: `Updated wallet brand${normalized ? ` · ${normalized}` : " · cleared"}`,
      entityType: "payment_method",
      entityId: id,
    });
    revalidatePath("/settings");
    revalidatePath("/payments");
    revalidatePath("/dashboard");
    return { id, brand_key: normalized };
  });
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

  // Mirror onto money_ledger as an outflow on the source wallet. v1
  // ignores to_method_id (transfer kind is a future enhancement).
  await insertLedger({
    client: supabase,
    kind: "outflow",
    amount_base: -1 * gross,
    wallet_id: input.from_method_id,
    related_kind: "withdrawal",
    related_id: data.id as string,
    event_at: new Date(input.withdrawn_at).toISOString(),
    note: "createWithdrawal",
  });

  revalidatePath("/today");
  revalidatePath("/payments");
  revalidatePath("/dashboard");
  return data;
}

export async function deleteWithdrawal(id: string) {
  const { supabase, userId } = await userOrThrow();
  const { error } = await supabase.from("withdrawals").delete().eq("id", id).eq("user_id", userId);
  if (error) throw error;
  await archiveLedger("withdrawal", id, supabase);
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
  // Universal notes rule (Tier 1, migration 0029) — per-item freeform context.
  notes?: string | null;
  // Per-item quantity (migration 0048). Defaults to 1 on save.
  quantity?: number | null;
};

export type SpendInput = {
  wallet_id: string;
  spent_at?: string;
  // Tier 1: optional time-of-day on the spend (migration 0028). Format "HH:mm".
  // Null when the row is date-only (legacy / backdated entry).
  spent_time?: string | null;
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
  // Tier 2: "It's For Us" tag (migration 0034 — household line).
  for_us?: boolean;
  // Tier 2: explicit vendor + entity associations. When omitted, the server
  // auto-resolves from the description against finance.vendors + .entities
  // and only inserts links where it finds a confident match.
  vendorIds?: string[];
  entityIds?: string[];
  // Vendors workflow — free-form vendor name typed in the spend modal's
  // Vendor row (locked 2026-06-02 freelane-vendors-design). When the
  // text matches an existing vendor by slug we link to it; when it's
  // unknown we createVendor (which kicks off canonicalize-vendor in the
  // background — no AI blocks the save path). Ignored when explicit
  // vendorIds are also provided.
  vendorName?: string | null;
  // Sadaka workflow (migration 0075): the explicit "Mark as sadaka" toggle.
  // When true, the createSpend path writes a sadaka_ledger payment row tied
  // to the spend AND a money_ledger sadaka_payment outflow. The auto-detect
  // pipeline short-circuits — explicit beats inferred.
  is_sadaka?: boolean;
  // Entities workflow (migration 0096): "For someone else" toggle +
  // beneficiary entity picker. is_for_someone_else can be true with
  // beneficiary_entity_id=null when the user knows it was for someone
  // but hasn't picked an entity — beneficiary_typed_name then feeds
  // Gate 1 propose-entity-from-signal.
  is_for_someone_else?: boolean;
  beneficiary_entity_id?: string | null;
  beneficiary_typed_name?: string | null;
};

export async function createSpend(input: SpendInput): Promise<ActionResult<{ id: string }>> {
  return safeRun("createSpend", async () => {
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
  const spentAt = input.spent_at ?? phtToday();
  const coversPeriods = Math.max(1, Math.floor(Number(input.covers_periods ?? 1)));

  const { data: spendRow, error: spendErr } = await supabase
    .from("spends")
    .insert({
      user_id: userId,
      wallet_id: input.wallet_id,
      spent_at: spentAt,
      spent_time: normalizeTimeOfDay(input.spent_time),
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
      for_us: !!input.for_us,
      is_sadaka: !!input.is_sadaka,
      // Entities workflow — beneficiary fields. Server tolerates the
      // is_for_someone_else=true / beneficiary_entity_id=null state
      // (Gate 1 fires below on the typed name).
      is_for_someone_else: !!input.is_for_someone_else,
      beneficiary_entity_id: input.beneficiary_entity_id ?? null,
    })
    .select("id")
    .single();
  if (spendErr || !spendRow) throw spendErr ?? new Error("Failed to save spend");
  const spendId = spendRow.id as string;

  // Mirror onto money_ledger as an outflow on the spend's wallet (Phase 1.5).
  await insertLedger({
    client: supabase,
    kind: "outflow",
    amount_base: -1 * amountBase,
    wallet_id: input.wallet_id,
    related_kind: "spend",
    related_id: spendId,
    event_at: new Date(spentAt).toISOString(),
    note: "createSpend",
  });

  if (input.categoryIds?.length) {
    const linkRows = input.categoryIds.map((cid) => ({ spend_id: spendId, category_id: cid }));
    const { error: linkErr } = await supabase.from("spend_category_links").insert(linkRows);
    if (linkErr) throw linkErr;
  }

  // Insert spend_items BEFORE spend_vendor_links. The vendor_price_history
  // link trigger checks `count(*) from spend_items where spend_id = ...`
  // to decide whether to emit a whole-visit observation; if the link
  // insert lands first the trigger sees zero items and writes a duplicate
  // whole-visit row alongside the per-item rows the item trigger will
  // emit moments later. Migration 0094 also makes the link trigger
  // DEFERRABLE INITIALLY DEFERRED so it fires at commit time — between
  // the two safeguards (insertion order + deferred trigger) the double-
  // count failure mode is closed from both angles.
  if (input.items?.length) {
    const itemRows = input.items.map((it, i) => ({
      spend_id: spendId,
      name: it.name,
      amount: it.amount ?? null,
      vat_amount: it.vat_amount ?? null,
      notes: it.notes ?? null,
      quantity: it.quantity && it.quantity > 0 ? it.quantity : 1,
      sort_order: i,
    }));
    const { error: itemErr } = await supabase.from("spend_items").insert(itemRows);
    if (itemErr) throw itemErr;
  }

  // Vendors workflow — if the spend modal handed us a typed vendor name
  // (and the caller didn't pre-resolve a vendorIds list), match it
  // against the user's existing vendors by slug; create a new vendor
  // row when no match is found. createVendor is the canonical entry
  // point — it owns archive-collision handling, kickoff of
  // canonicalize-vendor in the background, and the vendor_icon
  // best-effort write. The spend save path stays AI-free / non-blocking.
  let resolvedVendorIds: string[] | undefined = input.vendorIds;
  const typedVendorName = (input.vendorName ?? "").trim();
  if (!input.vendorIds && typedVendorName) {
    const { vendorSlug } = await import("@/lib/spending/vendor-extract");
    const typedSlug = vendorSlug(typedVendorName);
    const { data: byslug } = await supabase
      .from("vendors")
      .select("id")
      .eq("user_id", userId)
      .eq("slug", typedSlug)
      .eq("archived", false)
      .maybeSingle();
    if (byslug?.id) {
      resolvedVendorIds = [byslug.id as string];
    } else {
      // Unknown vendor — auto-create. createVendor is wrapped in
      // safeRun, so even a transient failure here MUST NOT take down
      // the spend save itself: fall back to leaving the spend
      // unlinked (the description-based resolver below still has a
      // chance to match a known alias).
      const created = await createVendor({ canonical_name: typedVendorName });
      if (created.ok) {
        resolvedVendorIds = [created.data.id];
      }
    }
  }

  // Tier 2: vendor + entity links. Explicit IDs from the caller win; if none
  // provided, auto-resolve from the description against the user's vendors
  // and entities. Auto-resolved links carry source='auto' so the user can
  // override without losing the original tag.
  const { vendorIds, entityIds } = await resolveLinksForSpend({
    supabase,
    userId,
    description: input.description ?? null,
    explicitVendorIds: resolvedVendorIds,
    explicitEntityIds: input.entityIds,
  });
  if (vendorIds.length) {
    // Vendors typed-in by the user (vendorName path) count as "user"
    // intent — same as explicit vendorIds — so the dispatcher /
    // canonicalize-vendor pipeline doesn't treat them as silent
    // auto-matches the user can override.
    const userIntendedVendor = !!input.vendorIds || typedVendorName.length > 0;
    const rows = vendorIds.map((vid) => ({
      spend_id: spendId,
      vendor_id: vid,
      source: userIntendedVendor ? "user" : "auto",
    }));
    await supabase.from("spend_vendor_links").insert(rows);
    // Refresh last_seen_at for each linked vendor.
    await supabase
      .from("vendors")
      .update({ last_seen_at: spentAt })
      .in("id", vendorIds)
      .eq("user_id", userId)
      .lt("last_seen_at", spentAt);
  }
  if (entityIds.length) {
    const rows = entityIds.map((eid) => ({
      spend_id: spendId,
      entity_id: eid,
      source: input.entityIds ? "user" : "auto",
    }));
    await supabase.from("spend_entity_links").insert(rows);
  }

  // Entities workflow — beneficiary linkage. When the user picked a
  // known entity from the "For someone else" picker, mirror the link
  // into spend_entity_links (source='user') so legacy readers (Sadaka
  // auto-detect mechanism 1, entity detail history, stats aggregates)
  // keep working alongside the new column. Idempotent on conflict.
  if (input.is_for_someone_else && input.beneficiary_entity_id) {
    try {
      // Overwrite-source semantics (verifier fix): if the auto-resolver
      // above already inserted a row with source='auto' for the same
      // entity, upgrade it to 'user' so downstream consumers that
      // distinguish user-intent from inferred matches don't misclassify
      // the explicit beneficiary pick.
      await supabase.from("spend_entity_links").upsert(
        {
          spend_id: spendId,
          entity_id: input.beneficiary_entity_id,
          source: "user",
        },
        { onConflict: "spend_id,entity_id" },
      );
    } catch {
      // Best-effort — the beneficiary_entity_id column on spends is the
      // primary source of truth; the link mirror is for reader parity.
    }
    // Fire the Trigger 1 introduction hook (first monetary event with
    // this entity). Idempotent via introduction_status; safe to call on
    // every beneficiary spend.
    try {
      const { fireFirstMonetaryEvent } = await import(
        "@/lib/entities/introductions"
      );
      void fireFirstMonetaryEvent({
        entityId: input.beneficiary_entity_id,
        eventKind: "beneficiary_spend",
        amountBase,
      }).catch(() => {});
    } catch {
      /* dynamic-import safety net */
    }
    // Entities workflow — pattern-change driver. Verifier fix: the
    // brain + baseline cache table were both shipped but never wired
    // into a write path. Run all four pattern checks + refresh the
    // baseline. Fire-and-forget; the driver swallows every error so the
    // primary mutation is never blocked by a brain failure.
    try {
      const { runEntityPatternChangeForEvent } = await import(
        "@/lib/entities/pattern-actions"
      );
      void runEntityPatternChangeForEvent({
        kind: "beneficiary_spend",
        spendId: spendId,
        entityId: input.beneficiary_entity_id,
        amountBase,
        spentAt: new Date(spentAt).toISOString(),
      }).catch(() => {});
    } catch {
      /* dynamic-import safety net */
    }
  }

  // Entities workflow — Gate 1. When the user typed a beneficiary name
  // but did NOT pick an existing entity, scan the typed name through
  // propose-entity-from-signal so the user is prompted to add it.
  if (
    input.is_for_someone_else &&
    !input.beneficiary_entity_id &&
    (input.beneficiary_typed_name ?? "").trim().length > 0
  ) {
    try {
      const { scanForCandidateEntity } = await import(
        "@/lib/entities/discovery"
      );
      void scanForCandidateEntity({
        sourceKind: "spend_note",
        sourceText: input.description ?? "",
        candidateName: input.beneficiary_typed_name!.trim(),
        signalId: spendId,
      }).catch(() => {});
    } catch {
      /* dynamic-import safety net */
    }
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

  // Sadaka hooks (migration 0073 + 0075).
  //
  // The explicit "Mark as sadaka" toggle writes a sadaka_ledger payment row
  // AND a money_ledger sadaka_payment outflow tied to the spend. The
  // sadaka_payment row is signed negative (CHECK constraint enforces it).
  // The parent spend's outflow row already debited the wallet, so the
  // sadaka_payment mirror is purely a category-tagged ledger trail — the
  // dashboard's reconciliation reads sadaka_payment as a sub-class of
  // outflow when summing wallet balances; the partial unique index on
  // money_ledger keys off (related_kind, related_id), so the sadaka_payment
  // row uses related_kind='sadaka' to coexist with the spend's outflow row
  // under the same related_id space.
  //
  // When the toggle is OFF, the auto-detect hook runs through the four
  // mechanisms (entity flag / charity vendor / pattern rule / classifier).
  if (input.is_sadaka) {
    const sadakaRowId = await insertSadakaLedgerRow({
      kind: "payment",
      amount_base: -1 * Math.abs(amountBase),
      source_kind: "spend",
      source_id: spendId,
      reasoning: "Marked sadaka",
      event_at: new Date(spentAt).toISOString(),
      // mirror_wallet_id is intentionally null here — the parent spend
      // already debited the wallet. The sadaka_ledger.insertSadakaLedgerRow
      // mirror writes a sadaka_payment money_ledger row only when the
      // mirror wallet is provided AND the parent spend hasn't already
      // produced its own outflow. Wiring a sadaka_payment row tied to the
      // same wallet would double-debit; leave the mirror off.
    });
    void sadakaRowId;
  } else {
    await onSpendSadakaDetect({
      id: spendId,
      user_id: userId,
      amount_base: amountBase,
      description: input.description ?? null,
      notes: input.notes ?? null,
      is_sadaka: false,
      spent_at: new Date(spentAt).toISOString(),
    }).catch(() => {});
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

  // Tiny spends (< floor) skip the AI brain bust — TTL/fingerprint still
  // catches drift if it matters. Keeps the LLM cost honest on the chatty
  // ₱5 cigarette case.
  await invalidateAiSafeSpendCache(userId, supabase, { amountBase });
  revalidatePath("/spending");
  revalidatePath("/today");
  revalidatePath("/dashboard");
  return { id: spendId };
  });
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
    "spent_time",
    "description",
    "notes",
    "vat_amount",
    "business_relevant",
    "covers_periods",
    "recurring_spend_id",
    "loan_id",
    "loan_installment_id",
    "for_us",
    "is_sadaka",
    // Entities workflow — beneficiary fields editable post-create. A
    // user editing a spend can now turn "For someone else" on/off, swap
    // the beneficiary, or clear a wrongly-picked one. The mirror
    // spend_entity_links + Gate 1 + introduction-trigger sync runs
    // below after the row patch lands.
    "is_for_someone_else",
    "beneficiary_entity_id",
  ];
  // Snapshot the pre-edit state before the patch lands so the
  // beneficiary-transition sync below can decide what changed.
  const beneficiaryWillChange =
    "is_for_someone_else" in input || "beneficiary_entity_id" in input;
  let priorBeneficiary: {
    is_for_someone_else: boolean | null;
    beneficiary_entity_id: string | null;
  } | null = null;
  if (beneficiaryWillChange) {
    const { data: prior } = await supabase
      .from("spends")
      .select("is_for_someone_else,beneficiary_entity_id")
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle();
    if (prior) {
      priorBeneficiary = {
        is_for_someone_else: (prior as { is_for_someone_else: boolean | null })
          .is_for_someone_else ?? null,
        beneficiary_entity_id: (prior as { beneficiary_entity_id: string | null })
          .beneficiary_entity_id ?? null,
      };
    }
  }
  for (const k of writable) {
    if (k in input) {
      const raw = (input as Record<string, unknown>)[k];
      patch[k] = k === "spent_time" ? normalizeTimeOfDay(raw as string | null | undefined) : raw ?? null;
    }
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

  // Money-affecting edits → archive the prior ledger row + insert a fresh
  // one with the new wallet / date / amount. Best-effort, non-blocking.
  const moneyAffecting =
    "wallet_id" in patch ||
    "spent_at" in patch ||
    "amount" in patch ||
    "currency" in patch ||
    "amount_base" in patch;
  if (moneyAffecting) {
    try {
      const { data: latest } = await supabase
        .from("spends")
        .select("wallet_id,spent_at,amount_base")
        .eq("id", id)
        .maybeSingle();
      if (latest) {
        const nextAmountBase = Number(latest.amount_base ?? 0);
        if (nextAmountBase > 0) {
          await replaceLedgerRow({
            client: supabase,
            related_kind: "spend",
            related_id: id,
            event_at: new Date(latest.spent_at as string).toISOString(),
            kind: "outflow",
            amount_base: -1 * nextAmountBase,
            wallet_id: latest.wallet_id as string,
            note: "updateSpend",
          });
        } else {
          await archiveLedger("spend", id, supabase);
        }
      }
    } catch {
      // Best-effort — replaceLedgerRow already logs to money_ledger_write_failures.
    }
  }

  // Sadaka conflict resolution (migration 0073/0075).
  //
  // When is_sadaka transitions true → false on an edit, archive the LIVE
  // sadaka_ledger payment row tied to this spend. The append-only invariant
  // is preserved (the row stays in the table with archived_at set; we never
  // DELETE). When is_sadaka transitions false → true, write a fresh payment
  // row. Money-affecting edits (amount / wallet) also re-archive then re-
  // insert so the pool reflects the new amount.
  //
  // Verifier fix (high): the trigger condition now ALSO includes
  // beneficiary changes. The Sadaka auto-detect mechanism 1 fires when a
  // spend's beneficiary entity has entities.sadaka_recipient=true. When
  // the user edits the beneficiary away from that recipient (clear it or
  // pick a non-recipient), the prior auto_detected sadaka_ledger row
  // tied to this spend stays live and the pool double-counts. Including
  // beneficiaryWillChange in the trigger lets CASE A archive the
  // orphaned auto_detected row before CASE D re-runs detection.
  if ("is_sadaka" in patch || moneyAffecting || beneficiaryWillChange) {
    try {
      const { data: latestSpend } = await supabase
        .from("spends")
        .select("is_sadaka,amount_base,spent_at,beneficiary_entity_id")
        .eq("id", id)
        .maybeSingle();
      const existingSadakaRow = await findLiveLedgerRowBySource("spend", id);
      const wantsSadaka = !!(latestSpend as { is_sadaka: boolean } | null)?.is_sadaka;
      const wantsAuto = !wantsSadaka;
      // CASE A: spend is now NOT sadaka but a live payment row exists →
      // archive it. The auto-detect pipeline doesn't re-fire on edit; the
      // user can re-mark explicitly if they want it back.
      if (existingSadakaRow && existingSadakaRow.kind === "payment" && wantsAuto) {
        await archiveSadakaLedgerRow(existingSadakaRow.id, "edit · un-marked");
      }
      // CASE A' (verifier fix): beneficiary swapped/cleared on a spend
      // whose live sadaka row is an auto_detected mirror. If the NEW
      // beneficiary isn't a sadaka_recipient (or was cleared entirely),
      // the auto_detected row is orphaned — archive it so CASE D's
      // re-run of onSpendSadakaDetect can either insert a fresh row for
      // the new recipient or leave the slot empty. Skipped when the
      // spend is explicitly marked sadaka — that's an explicit payment
      // owned by the user, not an auto-mirror to invalidate.
      if (
        existingSadakaRow &&
        existingSadakaRow.kind === "auto_detected" &&
        !wantsSadaka &&
        beneficiaryWillChange
      ) {
        const nextEntityId =
          (latestSpend as { beneficiary_entity_id: string | null } | null)
            ?.beneficiary_entity_id ?? null;
        let nextStillRecipient = false;
        if (nextEntityId) {
          const { data: recipientRow } = await supabase
            .from("entities")
            .select("sadaka_recipient")
            .eq("id", nextEntityId)
            .eq("user_id", userId)
            .maybeSingle();
          nextStillRecipient = !!(
            recipientRow as { sadaka_recipient?: boolean | null } | null
          )?.sadaka_recipient;
        }
        if (!nextStillRecipient) {
          await archiveSadakaLedgerRow(
            existingSadakaRow.id,
            "edit · beneficiary changed",
          );
        }
      }
      // CASE B: spend is now sadaka. Two transitions to cover:
      //   • false→true on a spend with an existing auto_detected (or
      //     payment) live row: archive the live row first so the partial
      //     unique on (source_kind, source_id) clears, then insert the
      //     explicit payment row. This makes the editorial state honest —
      //     the Activity feed reads "Marked sadaka", not stale
      //     "Auto-detected · …" — and prevents the partial-unique reject
      //     that would otherwise swallow the insert.
      //   • money-affecting edit on a spend already marked sadaka: archive
      //     the prior payment row and write a fresh one with the new
      //     amount + event_at.
      if (wantsSadaka) {
        const isMoneyEditOnExplicitPayment =
          existingSadakaRow?.kind === "payment" && moneyAffecting;
        const isFalseToTrue =
          existingSadakaRow == null || existingSadakaRow.kind !== "payment";
        if (isMoneyEditOnExplicitPayment || isFalseToTrue) {
          // Archive any live row blocking the slot — covers payment edits
          // AND the false→true transition over an auto_detected row.
          if (existingSadakaRow) {
            const reason =
              existingSadakaRow.kind === "payment"
                ? "edit · replaced"
                : "edit · upgraded to payment";
            await archiveSadakaLedgerRow(existingSadakaRow.id, reason);
          }
          const nextAmount = Number(
            (latestSpend as { amount_base: number } | null)?.amount_base ?? 0,
          );
          if (nextAmount > 0) {
            await insertSadakaLedgerRow({
              kind: "payment",
              amount_base: -1 * Math.abs(nextAmount),
              source_kind: "spend",
              source_id: id,
              reasoning:
                existingSadakaRow && existingSadakaRow.kind === "payment"
                  ? "Marked sadaka (edited)"
                  : "Marked sadaka",
              event_at: new Date(
                (latestSpend as { spent_at: string } | null)?.spent_at ??
                  new Date().toISOString(),
              ).toISOString(),
            });
          }
        }
      }
    } catch {
      // Best-effort — pool reconciliation lives in the read path.
    }
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
        notes: it.notes ?? null,
        quantity: it.quantity && it.quantity > 0 ? it.quantity : 1,
        sort_order: i,
      }));
      const { error: itemErr } = await supabase.from("spend_items").insert(itemRows);
      if (itemErr) throw itemErr;
    }
  }

  // Tier 2: vendor + entity links — only touched when the caller passes the
  // arrays explicitly (no implicit auto-rewrite on every patch).
  if (input.vendorIds) {
    await supabase.from("spend_vendor_links").delete().eq("spend_id", id);
    if (input.vendorIds.length > 0) {
      const rows = input.vendorIds.map((vid) => ({
        spend_id: id,
        vendor_id: vid,
        source: "user",
      }));
      await supabase.from("spend_vendor_links").insert(rows);
    }
  }
  if (input.entityIds) {
    await supabase.from("spend_entity_links").delete().eq("spend_id", id);
    if (input.entityIds.length > 0) {
      const rows = input.entityIds.map((eid) => ({
        spend_id: id,
        entity_id: eid,
        source: "user",
      }));
      await supabase.from("spend_entity_links").insert(rows);
    }
  }

  // Entities workflow — beneficiary transition sync (verifier fix).
  // Mirrors the createSpend side-effects on the edit path so the user
  // can correct mistakes without leaving stale links / silent
  // notifications / mis-firing introduction hooks.
  if (beneficiaryWillChange && priorBeneficiary) {
    try {
      const nextIsForSomeoneElse =
        "is_for_someone_else" in input
          ? !!input.is_for_someone_else
          : !!priorBeneficiary.is_for_someone_else;
      const nextEntityId =
        "beneficiary_entity_id" in input
          ? input.beneficiary_entity_id ?? null
          : priorBeneficiary.beneficiary_entity_id;
      const priorEntityId = priorBeneficiary.beneficiary_entity_id;

      // CASE A: beneficiary cleared (or toggle turned off) — drop the
      // mirror link row written by the original createSpend. Only the
      // user-source row is removed so any auto-resolver row stays.
      if (priorEntityId && (nextEntityId !== priorEntityId || !nextIsForSomeoneElse)) {
        await supabase
          .from("spend_entity_links")
          .delete()
          .eq("spend_id", id)
          .eq("entity_id", priorEntityId)
          .eq("source", "user");
      }
      // CASE B: beneficiary set or swapped — upsert the new mirror row
      // with source='user' (overwrite-source semantics so an existing
      // auto row gets upgraded to user). Then fire the trigger 1
      // introduction hook on the NEW entity. Idempotent via
      // introduction_status, safe to call.
      if (nextIsForSomeoneElse && nextEntityId) {
        await supabase.from("spend_entity_links").upsert(
          {
            spend_id: id,
            entity_id: nextEntityId,
            source: "user",
          },
          { onConflict: "spend_id,entity_id" },
        );
        try {
          const { fireFirstMonetaryEvent } = await import(
            "@/lib/entities/introductions"
          );
          const { data: spendRow } = await supabase
            .from("spends")
            .select("amount_base, spent_at")
            .eq("id", id)
            .maybeSingle();
          const amountBase = Number(
            (spendRow as { amount_base: number | null } | null)?.amount_base ?? 0,
          );
          const spentAt =
            (spendRow as { spent_at: string | null } | null)?.spent_at ??
            new Date().toISOString();
          void fireFirstMonetaryEvent({
            entityId: nextEntityId,
            eventKind: "beneficiary_spend",
            amountBase,
          }).catch(() => {});
          // Verifier fix: the createSpend path runs pattern detection
          // + baseline refresh on every beneficiary event, but the
          // edit path (beneficiary transition) silently skipped it.
          // Mirror the same fire-and-forget driver call here so a
          // beneficiary swap on an existing spend refreshes the
          // pattern cache and surfaces a shift if the math fires.
          try {
            const { runEntityPatternChangeForEvent } = await import(
              "@/lib/entities/pattern-actions"
            );
            void runEntityPatternChangeForEvent({
              kind: "beneficiary_spend",
              spendId: id,
              entityId: nextEntityId,
              amountBase,
              spentAt: new Date(spentAt).toISOString(),
            }).catch(() => {});
          } catch {
            /* dynamic-import safety net */
          }
        } catch {
          /* dynamic-import safety net */
        }
      }
      // CASE C: typed-only beneficiary on the edit path (toggle on,
      // entity id null, beneficiary_typed_name supplied) — same Gate 1
      // flow as createSpend.
      if (
        nextIsForSomeoneElse &&
        !nextEntityId &&
        (input.beneficiary_typed_name ?? "").trim().length > 0
      ) {
        try {
          const { scanForCandidateEntity } = await import(
            "@/lib/entities/discovery"
          );
          // Verifier fix: when the user edits ONLY the beneficiary
          // fields and never touches description/notes, input.description
          // is undefined and the brain receives empty source context.
          // Fall back to the persisted spend row's description + notes
          // so propose-entity-from-signal still has the surrounding
          // context it would have had on create.
          let sourceText = input.description ?? "";
          if (!sourceText.trim()) {
            try {
              const { data: persisted } = await supabase
                .from("spends")
                .select("description, notes")
                .eq("id", id)
                .maybeSingle();
              const desc = (
                (persisted as { description?: string | null } | null)
                  ?.description ?? ""
              ).toString();
              const notesText = (
                (persisted as { notes?: string | null } | null)?.notes ?? ""
              ).toString();
              sourceText = [desc, notesText].filter(Boolean).join("\n");
            } catch {
              /* best-effort */
            }
          }
          void scanForCandidateEntity({
            sourceKind: "spend_note",
            sourceText,
            candidateName: input.beneficiary_typed_name!.trim(),
            signalId: id,
          }).catch(() => {});
        } catch {
          /* dynamic-import safety net */
        }
      }
      // CASE D: a beneficiary change might re-classify the spend
      // through the sadaka_recipient pipeline. Re-run onSpendSadakaDetect
      // when the beneficiary entity changed AND the spend isn't already
      // explicitly marked sadaka.
      if (priorEntityId !== nextEntityId) {
        try {
          const { data: postRow } = await supabase
            .from("spends")
            .select("amount_base,description,notes,is_sadaka,spent_at")
            .eq("id", id)
            .maybeSingle();
          if (postRow && !(postRow as { is_sadaka: boolean }).is_sadaka) {
            await onSpendSadakaDetect({
              id,
              user_id: userId,
              amount_base: Number(
                (postRow as { amount_base: number }).amount_base ?? 0,
              ),
              description: (postRow as { description: string | null }).description,
              notes: (postRow as { notes: string | null }).notes,
              is_sadaka: false,
              spent_at: new Date(
                (postRow as { spent_at: string }).spent_at,
              ).toISOString(),
            }).catch(() => {});
          }
        } catch {
          /* best-effort */
        }
      }
    } catch {
      // Best-effort — primary write already landed.
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
  // Pre-fetch the live sadaka_ledger row tied to this spend so the archive
  // happens BEFORE the FK cascade nukes downstream rows. The spend itself
  // is the source_id; once the spend row is gone we can still archive by id
  // (sadaka_ledger has no FK to spends — source_id is opaque).
  const existingSadakaRow = await findLiveLedgerRowBySource("spend", id).catch(() => null);
  // spend_category_links + spend_items cascade-delete via FK.
  const { error } = await supabase.from("spends").delete().eq("id", id).eq("user_id", userId);
  if (error) throw error;
  await archiveLedger("spend", id, supabase);
  if (existingSadakaRow) {
    await archiveSadakaLedgerRow(existingSadakaRow.id, "spend deleted").catch(() => {});
  }
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
  // Tier 1, migration 0030. Investment vs Consumption Ledger classification.
  kind?: "consumption" | "investment" | "neutral";
  // Migration 0083 — tag taxonomy: audience / category / custom.
  // SQL column is `tag_kind`/text; TS exposes as `tagKind` for clarity.
  // Default = "category" if omitted. The createCustomTag wrapper (see
  // src/app/(app)/spending/_actions/tag-actions.ts) always passes
  // "custom" + created_by_user=true.
  tagKind?: "audience" | "category" | "custom";
  createdByUser?: boolean;
};

export async function createSpendCategory(
  input: SpendCategoryInput,
): Promise<ActionResult<{ id: string }>> {
  return safeRun("createSpendCategory", async () => {
    const { supabase, userId } = await userOrThrow();
    const name = input.name.trim();
    if (!name) throw new Error("Category needs a name.");
    // Audience tag kind is reserved for the four pinned seeds — UI must
    // never create new audience tags after migration 0083.
    if (input.tagKind === "audience") {
      throw new Error("Audience tags are immutable seeds; can't create new ones.");
    }
    // Pre-check: the spend_categories unique(user_id, name) constraint
    // (migration 0020) is case-SENSITIVE and DOES include archived
    // rows. Two failure modes the raw insert exposes:
    //   1. User types 'Travel' when a custom tag 'travel' already
    //      exists — raw Postgres conflict error bubbles up via safeRun.
    //   2. User archived 'Pets' from settings, then tries to add 'Pets'
    //      again — same conflict, no UI path to recover the row.
    // Case-insensitive lookup handles both: existing active row →
    // friendly "already exists" error; existing archived row →
    // un-archive in place + return its id (caller treats it as a
    // creation; the toast surfaces the restore in the UI layer).
    const { data: dup } = await supabase
      .from("spend_categories")
      .select("id, archived")
      .eq("user_id", userId)
      .ilike("name", name)
      .maybeSingle();
    if (dup) {
      if ((dup as { archived?: boolean }).archived) {
        const { error: unarchiveError } = await supabase
          .from("spend_categories")
          .update({ archived: false })
          .eq("id", (dup as { id: string }).id)
          .eq("user_id", userId);
        if (unarchiveError) throw unarchiveError;
        await logEvent({
          userId,
          kind: "spend_category.updated",
          title: `Restored tag · ${name}`,
          entityType: "spend_category",
          entityId: (dup as { id: string }).id,
          metadata: { archived: false, restored: true },
        });
        revalidatePath("/settings");
        revalidatePath("/spending");
        return { id: (dup as { id: string }).id };
      }
      throw new Error(`Tag "${name}" already exists.`);
    }
    // Investment vs Consumption ledger default depends on tag_kind.
    // Custom user-created tags default to 'neutral' so they don't
    // silently skew the Investment vs Consumption split panel — user
    // tags like "vacation" or "gift" don't have a single right answer.
    // Predefined category-kind tags keep the legacy 'consumption'
    // default. Caller can always override.
    const defaultLedgerKind =
      input.tagKind === "custom" ? "neutral" : "consumption";
    const { data, error } = await supabase
      .from("spend_categories")
      .insert({
        user_id: userId,
        name,
        icon: input.icon ?? null,
        color: input.color ?? null,
        sort_order: input.sort_order ?? 0,
        kind: input.kind ?? defaultLedgerKind,
        tag_kind: input.tagKind ?? "category",
        created_by_user: input.createdByUser ?? false,
        pinned: false,
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
    return { id: data.id as string };
  });
}

export async function updateSpendCategory(
  id: string,
  input: Partial<SpendCategoryInput>,
): Promise<ActionResult<void>> {
  return safeRun("updateSpendCategory", async () => {
    const { supabase, userId } = await userOrThrow();
    // Pinned (audience seed) rows are a CLOSED taxonomy per migration
    // 0083: name change blocked, kind change blocked, archive blocked,
    // delete blocked. Carving out archive (the previous behaviour) let
    // a user silently remove "Business" from both the audience radio
    // and the chip row with no UI affordance to restore — breaking the
    // axis. Reject every patch on pinned rows.
    const { data: existing } = await supabase
      .from("spend_categories")
      .select("pinned, tag_kind")
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle();
    if (existing && (existing as { pinned?: boolean }).pinned) {
      throw new Error("Pinned audience tags can't be edited.");
    }
    const patch: Record<string, unknown> = {};
    if ("name" in input) patch.name = input.name?.trim();
    if ("icon" in input) patch.icon = input.icon ?? null;
    if ("color" in input) patch.color = input.color ?? null;
    if ("sort_order" in input) patch.sort_order = input.sort_order ?? 0;
    if ("kind" in input) patch.kind = input.kind ?? "consumption";
    if ("tagKind" in input) patch.tag_kind = input.tagKind ?? "category";
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
  });
}

export async function archiveSpendCategory(id: string, archived = true) {
  const { supabase, userId } = await userOrThrow();
  // Mirror updateSpendCategory / deleteSpendCategory: pinned audience
  // seeds are immutable, archive included. Without this guard a user
  // could archive "Business" or "For us" from settings and silently
  // break the audience axis with no in-UI path to restore.
  const { data: existing } = await supabase
    .from("spend_categories")
    .select("pinned")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (existing && (existing as { pinned?: boolean }).pinned) {
    throw new Error("Pinned audience tags can't be archived.");
  }
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

export async function deleteSpendCategory(
  id: string,
): Promise<ActionResult<void>> {
  return safeRun("deleteSpendCategory", async () => {
    const { supabase, userId } = await userOrThrow();
    // Pinned audience tags can NEVER be deleted (migration 0083 contract).
    const { data: existing } = await supabase
      .from("spend_categories")
      .select("pinned")
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle();
    if (existing && (existing as { pinned?: boolean }).pinned) {
      throw new Error("Pinned audience tags can't be deleted.");
    }
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
  });
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
  // New recurring rule = structural event — chatbot brain may want to
  // ask a clarifying question about it.
  await invalidateAiSafeSpendCache(userId, undefined, { surfaceQuestion: true });
  revalidatePath("/settings");
  revalidatePath("/today");
  revalidatePath("/dashboard");
  return data;
}

export async function updateRecurringSpend(id: string, input: Partial<RecurringSpendInput>) {
  const { supabase, userId } = await userOrThrow();
  // Read prior state so we can detect Tier 3 life shifts (pause / amount change).
  const { data: prior } = await supabase
    .from("recurring_spends")
    .select("active,expected_amount,expected_currency,label")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
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
  // Tier 3 hooks: detect paused or amount-changed life shifts.
  if (prior) {
    const priorActive = (prior as { active: boolean }).active;
    const priorAmount = Number((prior as { expected_amount: number }).expected_amount ?? 0);
    const priorCurrency = (prior as { expected_currency: string }).expected_currency;
    const priorLabel = (prior as { label: string }).label;
    const nextActive = "active" in patch ? !!patch.active : priorActive;
    const nextAmount = "expected_amount" in patch ? Number(patch.expected_amount) : priorAmount;
    try {
      const { recordLifeShift } = await import("@/lib/ai/life-shift-writer");
      const { recordQuietReceipt } = await import("@/lib/ai/quiet-receipt-writer");
      if (priorActive && !nextActive) {
        await Promise.all([
          recordLifeShift({
            kind: "recurring_paused",
            label: `${priorLabel} recurring paused`,
            beforeValue: `${priorAmount} ${priorCurrency}`,
            afterValue: "paused",
            sourceEntityType: "recurring_spend",
            sourceEntityId: id,
            context: { label: priorLabel, amount: priorAmount, currency: priorCurrency },
          }),
          recordQuietReceipt({
            kind: "recurring_paused",
            sourceEntityType: "recurring_spend",
            sourceEntityId: id,
            context: { label: priorLabel, amount: priorAmount, currency: priorCurrency },
          }),
        ]);
        // Tier 3 letter auto-trigger — worth-saying gate runs first.
        try {
          const { tryAutoGenerateLetter } = await import("@/lib/ai/letters-auto-trigger");
          await tryAutoGenerateLetter({
            triggerKind: "recurring_paused",
            letterKind: "spotlight",
            triggerPayload: { label: priorLabel, amount: priorAmount, currency: priorCurrency },
          });
        } catch {
          // Best-effort.
        }
      } else if (
        priorActive &&
        nextActive &&
        priorAmount > 0 &&
        Math.abs(nextAmount - priorAmount) / priorAmount > 0.15
      ) {
        await recordLifeShift({
          kind: "recurring_changed",
          label: `${priorLabel} recurring changed`,
          beforeValue: `${priorAmount} ${priorCurrency}`,
          afterValue: `${nextAmount} ${priorCurrency}`,
          sourceEntityType: "recurring_spend",
          sourceEntityId: id,
          context: { label: priorLabel, before: priorAmount, after: nextAmount },
        });
        // Tier 3 letter auto-trigger — life-shift path. Worth-saying
        // gate decides if the shift is heavy enough for a letter.
        try {
          const { tryAutoGenerateLetter } = await import("@/lib/ai/letters-auto-trigger");
          await tryAutoGenerateLetter({
            triggerKind: "recurring_changed",
            letterKind: "spotlight",
            triggerPayload: { label: priorLabel, before: priorAmount, after: nextAmount },
          });
        } catch {
          // Best-effort.
        }
        if (nextAmount < priorAmount) {
          await recordQuietReceipt({
            kind: "recurring_lowered",
            sourceEntityType: "recurring_spend",
            sourceEntityId: id,
            context: { label: priorLabel, before: priorAmount, after: nextAmount },
          });
          // Tier 3 letter auto-trigger — the "you spent less" quiet
          // receipt. Worth-saying gate decides if the lowering is real
          // substance or noise.
          try {
            const { tryAutoGenerateLetter } = await import("@/lib/ai/letters-auto-trigger");
            await tryAutoGenerateLetter({
              triggerKind: "recurring_lowered",
              letterKind: "spotlight",
              triggerPayload: { label: priorLabel, before: priorAmount, after: nextAmount },
            });
          } catch {
            // Best-effort.
          }
        }
      }
    } catch {
      // Best-effort.
    }
  }
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
  if (!result.ok) throw new Error(result.error);

  await logEvent({
    userId,
    kind: "recurring_spend.paid",
    title: `Paid recurring · ${rule.label}`,
    entityType: "recurring_spend",
    entityId: input.recurring_spend_id,
    metadata: {
      spend_id: result.data.id,
      covers_periods: input.covers_periods ?? 1,
    },
  });
  await invalidateAiSafeSpendCache(userId);
  return result.data;
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
      borrowed_at: input.borrowed_at ?? phtToday(),
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
  // New loan = structural event — surface a clarifying question.
  await invalidateAiSafeSpendCache(userId, undefined, { surfaceQuestion: true });
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
  const { data: loanRow } = await supabase
    .from("loans")
    .select("counterparty,principal_base,direction")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
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
  // Tier 3 hook: quiet receipt for the closure (best-effort).
  if (loanRow) {
    try {
      const { recordQuietReceipt } = await import("@/lib/ai/quiet-receipt-writer");
      await recordQuietReceipt({
        kind: "loan_repaid",
        sourceEntityType: "loan",
        sourceEntityId: id,
        context: {
          counterparty: (loanRow as { counterparty: string }).counterparty,
          principal_base: Number((loanRow as { principal_base: number }).principal_base ?? 0),
          direction: (loanRow as { direction: string }).direction,
        },
      });
    } catch {
      // Best-effort.
    }
    // Tier 3 letter auto-trigger — loan close worth holding up. The
    // worth-saying gate weighs principal + days-open + recent shelf
    // before greenlighting the letter.
    try {
      const { tryAutoGenerateLetter } = await import("@/lib/ai/letters-auto-trigger");
      await tryAutoGenerateLetter({
        triggerKind: "loan_repaid",
        letterKind: "spotlight",
        triggerPayload: {
          counterparty: (loanRow as { counterparty: string }).counterparty,
          principal_base: Number((loanRow as { principal_base: number }).principal_base ?? 0),
          direction: (loanRow as { direction: string }).direction,
        },
      });
    } catch {
      // Best-effort.
    }
  }
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
  if (!result.ok) throw new Error(result.error);

  await logEvent({
    userId,
    kind: "loan_installment.paid",
    title: `Paid installment · ${input.currency} ${Number(input.amount).toFixed(2)}`,
    entityType: "loan_installment",
    entityId: input.installment_id,
    metadata: { loan_id: installment.loan_id, spend_id: result.data.id },
  });
  await invalidateAiSafeSpendCache(userId);
  return result.data;
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
  // Native amount the user typed (in `amountCurrency`).
  amount: number;
  amountCurrency: CurrencyCode;
  dateOpt?: string;
};

export async function setWalletOpeningBalance(input: WalletOpeningBalanceInput): Promise<ActionResult<{ amountBase: number }>> {
  return safeRun("setWalletOpeningBalance", async () => {
    const { supabase, userId } = await userOrThrow();
    if (!Number.isFinite(input.amount)) throw new Error("Opening balance must be a number.");
    if (!input.amountCurrency) throw new Error("Pick a currency.");
    const opening_balance_at = input.dateOpt ?? phtToday();

    const { data: rates } = await supabase
      .from("exchange_rates")
      .select("code,rate_to_base")
      .eq("user_id", userId);
    const amountBase =
      Math.round(toBaseAmount(input.amount, input.amountCurrency, (rates ?? []) as RatePair[]) * 100) / 100;

    // Detect first-anchor for THIS wallet so we only surface a clarifying
    // question on the meaningful structural change (the calibration that
    // unlocks runway math), not on every re-anchor.
    const { data: prior } = await supabase
      .from("payment_methods")
      .select("opening_balance_set_at")
      .eq("id", input.methodId)
      .eq("user_id", userId)
      .maybeSingle();
    const isFirstAnchor =
      !prior || (prior.opening_balance_set_at as string | null) == null;

    const { error } = await supabase
      .from("payment_methods")
      .update({
        opening_balance_amount: input.amount,
        opening_balance_currency: input.amountCurrency,
        opening_balance_base: amountBase,
        opening_balance_at,
        // Snapshot the moment of save so holdingBalances can ignore activity
        // that the user logged earlier today before recalibrating. Date alone
        // can't distinguish "10am withdrawal" from "12pm anchor" — this can.
        opening_balance_set_at: new Date().toISOString(),
      })
      .eq("id", input.methodId)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    // Hatim 2026-06-01: anchoring a wallet balance is a calibration, not a
    // financial event. No activity-log row, no quiet-receipt, no milestone.
    // Just propagate the new number everywhere the system reads from it so
    // /today, /spending, /payments, /plans, /dashboard all show the same
    // figure as soon as the setting saves.
    //
    // Mirror the anchor onto money_ledger as an 'adjustment' row so the
    // ledger reader can see "the user said this was the truth at T". The
    // reader's anchor filter (event_at >= opening_balance_set_at) already
    // gates pre-anchor activity; this row is the canonical zero-point at
    // the anchor instant.
    //
    // Gated to FIRST anchor only. Re-anchoring used to write a fresh
    // zero-amount adjustment row every save — they never moved the balance
    // (amount_base = 0) but accumulated indefinitely as orphan rows with
    // null related_id, polluting the audit trail and bumping the brain
    // fingerprint count for no reason. The new partial unique index keys
    // on (related_kind, related_id) WHERE related_id IS NOT NULL so it
    // wouldn't have deduped these anyway.
    if (isFirstAnchor) {
      await insertLedger({
        client: supabase,
        kind: "adjustment",
        amount_base: 0,
        wallet_id: input.methodId,
        related_kind: null,
        related_id: null,
        note: "setWalletOpeningBalance first anchor",
      });
    }
    await invalidateAiSafeSpendCache(userId, supabase, {
      surfaceQuestion: isFirstAnchor,
    });
    revalidatePath("/settings");
    revalidatePath("/dashboard");
    revalidatePath("/today");
    revalidatePath("/spending");
    revalidatePath("/payments");
    revalidatePath("/plans");
    return { amountBase };
  });
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

// ───────────────────────────────────────── Planned spends (Tier 1 + Plans redesign 2026-06) ──
//
// Future intent rows the runway math counts as if already on the calendar.
// Lifecycle (post-0088 redesign):
//   planned/active → bought (markPlanBought writes a spend) → or abandoned
//                  → or cancelled (kept for back-compat with pre-redesign UI)
//
// The lock mechanism (committed status + committed_base + committed_at)
// was removed in migration 0088 — the user can edit any plan anytime,
// and money no longer parks per plan. AI-proposed savings strategies
// stored in finance.plan_strategies replace the lock as the way users
// commit to a plan (via safe-to-spend.applyStrategy).

export type PlannedSpendInput = {
  label: string;
  expected_amount: number;
  expected_currency: string;
  planned_for: string;                       // "YYYY-MM-DD"
  planned_for_window_days?: number;
  certainty?: "firm" | "probable" | "maybe";
  wallet_id?: string | null;
  default_category_ids?: string[];
  is_big_plan?: boolean;
  notes?: string | null;
  // Plans redesign (0088) additions — all optional so callers from older
  // code paths still type-check.
  price_source?: "user" | "ai" | "adjusted";
  target_date?: string | null;
  justification?: string | null;
};

export async function createPlannedSpend(input: PlannedSpendInput): Promise<ActionResult<{ id: string }>> {
  return safeRun("createPlannedSpend", async () => {
    const { supabase, userId } = await userOrThrow();
    const label = input.label.trim();
    if (!label) throw new Error("Plan needs a label.");
    if (!(Number(input.expected_amount) >= 0)) {
      throw new Error("Expected amount must be 0 or greater.");
    }
    if (!input.planned_for) throw new Error("Pick a date.");

    const { data: rates } = await supabase
      .from("exchange_rates")
      .select("code,rate_to_base")
      .eq("user_id", userId);
    const expectedBase = Math.round(
      toBaseAmount(Number(input.expected_amount), input.expected_currency, (rates ?? []) as RatePair[]) * 100,
    ) / 100;

    const { data, error } = await supabase
      .from("planned_spends")
      .insert({
        user_id: userId,
        label,
        expected_amount: Number(input.expected_amount),
        expected_currency: input.expected_currency,
        expected_base: expectedBase,
        planned_for: input.planned_for,
        planned_for_window_days: input.planned_for_window_days ?? 0,
        certainty: input.certainty ?? "firm",
        status: "planned",
        wallet_id: input.wallet_id ?? null,
        default_category_ids: input.default_category_ids ?? [],
        is_big_plan: !!input.is_big_plan,
        notes: input.notes ?? null,
        price_source: input.price_source ?? "user",
        target_date: input.target_date ?? null,
        justification: input.justification ?? null,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    await logEvent({
      userId,
      kind: "planned_spend.created",
      title: `Planned · ${label}`,
      entityType: "planned_spend",
      entityId: data.id as string,
      metadata: { expected_base: expectedBase, planned_for: input.planned_for },
    });
    // New plan = structural event — surface a clarifying question.
    await invalidateAiSafeSpendCache(userId, supabase, { surfaceQuestion: true });
    revalidatePath("/plans");
    revalidatePath("/today");
    revalidatePath("/dashboard");
    return { id: data.id as string };
  });
}

export async function updatePlannedSpend(id: string, input: Partial<PlannedSpendInput>) {
  const { supabase, userId } = await userOrThrow();
  const patch: Record<string, unknown> = {};
  if ("label" in input) patch.label = input.label?.trim();
  if ("planned_for" in input) patch.planned_for = input.planned_for;
  if ("planned_for_window_days" in input) patch.planned_for_window_days = input.planned_for_window_days ?? 0;
  if ("certainty" in input) patch.certainty = input.certainty;
  if ("wallet_id" in input) patch.wallet_id = input.wallet_id ?? null;
  if ("default_category_ids" in input) patch.default_category_ids = input.default_category_ids ?? [];
  if ("is_big_plan" in input) patch.is_big_plan = !!input.is_big_plan;
  if ("notes" in input) patch.notes = input.notes ?? null;
  // Plans redesign (0088) — new fields editable anytime.
  if ("price_source" in input) patch.price_source = input.price_source ?? "user";
  if ("target_date" in input) patch.target_date = input.target_date ?? null;
  if ("justification" in input) patch.justification = input.justification ?? null;

  if (input.expected_amount !== undefined || input.expected_currency !== undefined) {
    const { data: existing } = await supabase
      .from("planned_spends")
      .select("expected_amount,expected_currency")
      .eq("id", id)
      .maybeSingle();
    if (!existing) throw new Error("Plan not found");
    const amount = Number(input.expected_amount ?? existing.expected_amount);
    const currency = (input.expected_currency ?? existing.expected_currency) as string;
    // Mirror createPlannedSpend's >= 0 contract — Plans redesign (0088)
    // supports the "blank price + AI fills" flow on EDIT too, not just
    // create. A user who clears the price on an existing plan should hit
    // the same AI re-lookup path as a brand-new plan.
    if (!(amount >= 0)) throw new Error("Expected amount must be 0 or greater.");
    const { data: rates } = await supabase
      .from("exchange_rates")
      .select("code,rate_to_base")
      .eq("user_id", userId);
    const expectedBase = Math.round(
      toBaseAmount(amount, currency, (rates ?? []) as RatePair[]) * 100,
    ) / 100;
    patch.expected_amount = amount;
    patch.expected_currency = currency;
    patch.expected_base = expectedBase;
  }

  if (Object.keys(patch).length === 0) return;

  const { error } = await supabase
    .from("planned_spends")
    .update(patch)
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw error;

  await logEvent({
    userId,
    kind: "planned_spend.updated",
    title: `Updated plan${input.label ? ` · ${input.label}` : ""}`,
    entityType: "planned_spend",
    entityId: id,
  });
  await invalidateAiSafeSpendCache(userId, supabase);
  revalidatePath("/plans");
  revalidatePath("/today");
  revalidatePath("/dashboard");
}

// Plans redesign (migration 0088) — the lock mechanism (commitPlannedSpend /
// uncommitPlannedSpend) is REMOVED. The user can edit any plan anytime,
// and money no longer parks per plan. AI-proposed savings strategies
// stored in finance.plan_strategies (migration 0089) replace the lock as
// the way users commit to a plan (via safe-to-spend.applyStrategy).
//
// markPlanBought replaces materializePlannedSpend: it still writes a real
// spend through createSpend, but the plan row tracks bought_at +
// bought_actual_price for the archive view + the satisfaction-check
// notification flow.

export type MarkPlanBoughtInput = {
  amount: number;
  currency: string;
  wallet_id: string;
  spent_at?: string;
  spent_time?: string | null;
  description?: string | null;
  notes?: string | null;
  business_relevant?: boolean;
  categoryIds?: string[];
  vat_amount?: number | null;
  items?: SpendItemInput[];
};

export async function markPlanBought(
  id: string,
  input: MarkPlanBoughtInput,
): Promise<ActionResult<{ id: string }>> {
  return safeRun("markPlanBought", async () => {
    const { supabase, userId } = await userOrThrow();
    const { data: plan } = await supabase
      .from("planned_spends")
      .select("*")
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle();
    if (!plan) throw new Error("Plan not found");
    if (plan.status === "bought" || plan.status === "done") {
      throw new Error("Plan is already bought");
    }

    const result = await createSpend({
      wallet_id: input.wallet_id,
      spent_at: input.spent_at,
      spent_time: input.spent_time ?? null,
      amount: input.amount,
      currency: input.currency,
      description: input.description ?? plan.label,
      notes: input.notes ?? plan.notes,
      vat_amount: input.vat_amount ?? null,
      business_relevant: input.business_relevant,
      categoryIds: input.categoryIds ?? (plan.default_category_ids ?? []),
      items: input.items,
    });
    if (!result.ok) throw new Error(result.error);
    const spendId = result.data.id;

    // Compute the actual price in base for the archive view. The base
    // rate snapshot lives on the spend row already; we duplicate the
    // base figure on planned_spends so the archive table doesn't need a
    // join to render.
    const { data: rates } = await supabase
      .from("exchange_rates")
      .select("code,rate_to_base")
      .eq("user_id", userId);
    const actualBase =
      Math.round(
        toBaseAmount(Number(input.amount), input.currency, (rates ?? []) as RatePair[]) * 100,
      ) / 100;

    const boughtAt = input.spent_at ?? phtToday();
    await supabase
      .from("planned_spends")
      .update({
        status: "bought",
        done_spend_id: spendId,
        done_at: new Date().toISOString(),
        bought_at: boughtAt,
        bought_actual_price: actualBase,
      })
      .eq("id", id);

    // Deactivate any active strategy for the plan — the plan has
    // completed its cycle. Best-effort: a failure here is harmless
    // because the daily-safe reduction is read-time only.
    try {
      await supabase
        .from("plan_strategies")
        .update({ active: false, deactivated_at: new Date().toISOString() })
        .eq("user_id", userId)
        .eq("plan_id", id)
        .eq("active", true);
    } catch {
      // Best-effort.
    }

    await logEvent({
      userId,
      kind: "planned_spend.done",
      title: `Plan bought · ${plan.label}`,
      entityType: "planned_spend",
      entityId: id,
      metadata: { spend_id: spendId, bought_at: boughtAt, actual_base: actualBase },
    });
    // Tier 3 hook: quiet receipt for the plan landing.
    try {
      const { recordQuietReceipt } = await import("@/lib/ai/quiet-receipt-writer");
      await recordQuietReceipt({
        kind: "plan_done",
        sourceEntityType: "planned_spend",
        sourceEntityId: id,
        context: {
          label: plan.label,
          spend_id: spendId,
        },
      });
    } catch {
      // Best-effort.
    }
    // Tier 3 letter auto-trigger — plan landed. Worth-saying gate
    // weighs the plan's actual price + recent letter shelf + user
    // engagement before greenlighting.
    try {
      const { tryAutoGenerateLetter } = await import("@/lib/ai/letters-auto-trigger");
      await tryAutoGenerateLetter({
        triggerKind: "plan_done",
        letterKind: "spotlight",
        triggerPayload: {
          label: plan.label,
          spend_id: spendId,
          actual_base: actualBase,
        },
      });
    } catch {
      // Best-effort.
    }
    // createSpend above already invalidates both the safe-to-spend cache and
    // calm_weather_state via invalidateAiSafeSpendCache, so we don't need an
    // extra mark here. revalidatePath only.
    revalidatePath("/plans");
    return { id: spendId };
  });
}

export async function cancelPlannedSpend(id: string) {
  const { supabase, userId } = await userOrThrow();
  const { data: plan } = await supabase
    .from("planned_spends")
    .select("status")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!plan) throw new Error("Plan not found");
  if (plan.status === "done" || plan.status === "bought") {
    throw new Error("Plan is already bought — can't cancel.");
  }
  const { error } = await supabase
    .from("planned_spends")
    .update({ status: "cancelled" })
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw error;
  // Cancel MUST deactivate the plan's active strategy, otherwise the
  // daily-safe reduction keeps shaving surplus indefinitely. Same fix
  // markPlanBought already applies (lines 3631-3640 above).
  try {
    await supabase
      .from("plan_strategies")
      .update({ active: false, deactivated_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("plan_id", id)
      .eq("active", true);
  } catch {
    // Best-effort.
  }
  await logEvent({
    userId,
    kind: "planned_spend.cancelled",
    title: "Cancelled a plan",
    entityType: "planned_spend",
    entityId: id,
  });
  await invalidateAiSafeSpendCache(userId, supabase);
  revalidatePath("/plans");
  revalidatePath("/today");
  revalidatePath("/dashboard");
  revalidatePath("/spending");
}

export async function deletePlannedSpend(id: string) {
  const { supabase, userId } = await userOrThrow();
  const { error } = await supabase
    .from("planned_spends")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw error;
  await logEvent({
    userId,
    kind: "planned_spend.deleted",
    title: "Deleted a plan",
    entityType: "planned_spend",
    entityId: id,
  });
  await invalidateAiSafeSpendCache(userId, supabase);
  revalidatePath("/plans");
}

// ───────────────────────────────────────── Calm Weather (Tier 1) ──
//
// All cache invalidation now flows through invalidateAiSafeSpendCache, which
// coupled-deletes both the safe-to-spend cache and the calm_weather_state row.
// Tier-1 reviewer #2 flagged that a separate markCalmWeatherStale helper was
// easy to forget at new mutation sites; coupling fixed that class of bug.

export async function refreshCalmWeatherAction(): Promise<void> {
  const { refreshCalmWeather } = await import("@/lib/ai/calm-weather");
  await refreshCalmWeather({ force: true });
  revalidatePath("/today");
  revalidatePath("/dashboard");
}

// ───────────────────────────────────────── App Changelog (markdown pivot) ──
//
// The app changelog lives at CHANGELOG.md in the repo root. The old SQL-
// backed create/update/delete actions that wrote to finance.app_changelog
// were removed when the table was dropped in migration 0105 — see
// freelane-whatsnew-design and the load.ts parser.
//
// The single server-side write the new flow still needs is a stamp of the
// per-user "last opened the Updates page on this version" marker. The
// Settings landing reads it to paint a small red dot when the user
// hasn't acknowledged the latest release yet. Writes flow through the
// same safeRun + ActionResult contract as the rest of the file.

export async function markUpdatesSeen(
  version: string,
): Promise<ActionResult<{ version: string }>> {
  return safeRun("markUpdatesSeen", async () => {
    const { supabase, userId } = await userOrThrow();
    const trimmed = version.trim();
    if (!trimmed) throw new Error("Version required.");
    const { error } = await supabase
      .from("settings")
      .update({ last_seen_version: trimmed })
      .eq("user_id", userId);
    if (error) throw error;
    revalidatePath("/settings");
    // The Updates page reads last_seen_version server-side, so a soft-
    // nav back into the route must see the freshly stamped value too —
    // a single revalidate of the parent /settings doesn't cover the
    // nested route segment cache.
    revalidatePath("/settings/updates");
    return { version: trimmed };
  });
}

// AI question with free-text note alongside the chip (universal notes rule).
export async function answerAiQuestionWithNotesAction(
  id: string,
  answer: string,
  answerNotes?: string,
): Promise<void> {
  const { answerAiQuestion } = await import("@/lib/ai/ai-questions");
  await answerAiQuestion(id, answer, answerNotes);
  revalidatePath("/today");
  revalidatePath("/settings");
}

// ───────────────────────────────────────── Vendors (Tier 2) ──

export type VendorInput = {
  canonical_name: string;
  short_description?: string | null;
  location?: Record<string, unknown>;
  kinds?: string[];
  notes?: string | null;
};

// CRITICAL BUG FIX (locked 2026-06-02 Vendors workflow): createVendor
// previously threw on unique(user_id, slug) collisions (Postgres error
// 23505) and any uncaught throw from a server action surfaces as the
// generic "An error occurred in the Server Components render" message
// in production. We now:
//   1. Wrap the whole body in safeRunLabeled so the real error reaches
//      the caller as ActionResult<{ id: string }> instead of a thrown
//      string that Next 16 masks.
//   2. Pre-check for an existing vendor with the same (user_id, slug)
//      and return its id when found — so the always-ask canonicalize
//      flow can re-use the row instead of failing the spend.
//   3. Use awaited try/catch around the dynamic-imported AI module so
//      module-eval throws cannot bubble past safeRunLabeled.
export async function createVendor(
  input: VendorInput,
): Promise<ActionResult<{ id: string; reused: boolean }>> {
  return safeRun("create-vendor", async () => {
    const { supabase, userId } = await userOrThrow();
    const name = input.canonical_name.trim();
    if (!name) throw new Error("Vendor needs a name.");
    const { vendorSlug } = await import("@/lib/spending/vendor-extract");
    const slug = vendorSlug(name);

    // Pre-check: a vendor with this slug already belongs to the user.
    // Two paths converge here in the always-ask flow (manual "+ Add
    // vendor" modal + auto-create when an unknown vendor is typed in the
    // spend modal); racing those would otherwise hit the unique
    // constraint and surface as a generic 500.
    //
    // Archived rows retain their slug (archiveVendor flips `archived` only
    // — it never nulls the slug column), so a re-add of a soft-archived
    // vendor MUST NOT silently resurrect the hidden row. Filtering
    // `archived = false` here keeps the reused-path semantics tight to
    // the user's mental model ("Add brings up the SAME vendor I'm using
    // today" — not "Add un-hides whatever I once archived"). Restoring
    // from archive is a separate intent and lives in archiveVendor's
    // restore flow.
    const { data: existing } = await supabase
      .from("vendors")
      .select("id")
      .eq("user_id", userId)
      .eq("slug", slug)
      .eq("archived", false)
      .maybeSingle();
    if (existing) {
      // NB: This path is intentionally READ-ONLY — short_description /
      // notes / kinds from the new input are NOT merged onto the existing
      // row. Edits should route through a dedicated updateVendor action
      // so the user sees the change land + the canonicalize brain gets a
      // chance to re-evaluate. Re-using a row here is an idempotent
      // insert, not a silent patch.
      return { id: existing.id as string, reused: true };
    }

    const { data, error } = await supabase
      .from("vendors")
      .insert({
        user_id: userId,
        canonical_name: name,
        // Vendors workflow — preserve the raw text the user typed for
        // the canonicalize brain. canonical_name doubles as the legacy
        // display name until the brain proposes a clean form (kickoff
        // overwrites canonical_name only when confidence >= 0.6).
        raw_user_typed_name: name,
        slug,
        short_description: input.short_description ?? null,
        location: input.location ?? {},
        kinds: input.kinds ?? [],
        notes: input.notes ?? null,
      })
      .select("id")
      .single();
    if (error) {
      // Race fallback — concurrent insert won the unique constraint.
      // Re-read instead of bubbling the 23505 up as a server error.
      // Same archived-exclusion contract as the pre-check above: the
      // unique index on (user_id, slug) includes archived rows, so a
      // collision on a hidden vendor is reported with a friendlier
      // message instead of silently resurrecting it.
      if (String(error.code) === "23505") {
        const { data: raced } = await supabase
          .from("vendors")
          .select("id")
          .eq("user_id", userId)
          .eq("slug", slug)
          .eq("archived", false)
          .maybeSingle();
        if (raced) return { id: raced.id as string, reused: true };
        // 23505 with no live row = the collision is against an archived
        // vendor. Translate to a user-friendly error so the toast doesn't
        // surface raw constraint internals.
        throw new Error(
          `An archived vendor with that name exists. Restore it from the archive instead.`,
        );
      }
      // Friendly translations for the other Postgres constraint codes
      // we can predict. safeRun still logs the raw error to console via
      // safeRunLabeled, so the diagnostic trail survives even though
      // the toast stays human.
      const pgCode = String(error.code ?? "");
      if (pgCode === "23502") {
        throw new Error("Vendor is missing a required field.");
      }
      if (pgCode === "23514") {
        throw new Error("Vendor input failed a validation check.");
      }
      if (pgCode === "42501") {
        throw new Error("You don't have permission to add a vendor.");
      }
      // Generic fallback — the raw Postgres message can leak schema
      // names and constraint identifiers into the user-facing toast.
      // Hide them; the original error is still captured by console.error
      // inside safeRunLabeled.
      throw new Error("Couldn’t add vendor.");
    }
    const newId = data.id as string;

    await logEvent({
      userId,
      kind: "vendor.created",
      title: `Vendor · ${name}`,
      entityType: "vendor",
      entityId: newId,
      metadata: { slug },
    });

    // New vendor = structural event — chatbot brain may want to ask
    // about this place. Fire-and-forget; dynamic import wrapped to
    // contain module-eval throws inside safeRun.
    try {
      await maybeSurfaceClarifyingQuestion();
    } catch {
      /* dynamic-import safety net — never blocks the create */
    }

    // Brand Identity workflow — fire the vendor icon brain. We AWAIT it
    // (with a try/catch so failures never block the create) so the
    // vendor_icon_cache row lands BEFORE the always-ask kickoff runs.
    try {
      const { identifyVendorIconAction } = await import("@/lib/ai/vendor-icon-actions");
      await identifyVendorIconAction(name);
    } catch {
      /* best-effort — brain failure cannot block vendor create */
    }

    // Vendors workflow — ALWAYS-ASK canonicalization. The kickoff helper
    // runs the Pro canonicalize-vendor brain async then queues a
    // vendor_clarify notification regardless of confidence. Debouncing
    // (30m per vendor + 3/day cap) is enforced inside the helper.
    try {
      const { kickoffVendorCanonicalize } = await import(
        "@/lib/vendors/canonicalize-kickoff"
      );
      void kickoffVendorCanonicalize({
        vendorId: newId,
        vendorName: name,
      }).catch(() => {});
    } catch {
      /* dynamic-import safety net */
    }

    revalidatePath("/vendors");
    revalidatePath("/spending");
    revalidatePath("/spending/vendors");
    return { id: newId, reused: false };
  });
}

// Dispatcher helper for the vendor_identify_request kind. Gates (run in
// this order — the cheapest checks first):
//   1. Vendor row's needs_identification=false OR identification_skipped
//      → skip silently.
//   2. Curated PH brand registry hit → flip needs_identification=false
//      and skip silently. Without this, every Jollibee/SM/7-Eleven
//      vendor would prompt the user to describe a place the app
//      already knows.
//   3. vendor_icon_cache row with user_overridden=true OR a high-
//      confidence (>= 0.7) non-overridden glyph_kind != 'none' row
//      → flip needs_identification=false and skip silently. The
//      auto-identify brain ran before we got here (createVendor awaits
//      it), so this branch catches the brain's wins too.
//   4. 30-minute debounce against last_identify_notif_at on the vendor.
//   5. 5/hour cap across all vendor_identify_request rows for this
//      user (counts dispatched rows regardless of read/dismissed
//      state — intentional, prevents apology spam during heavy
//      vendor-creation sessions).
//
// On dispatch: writes last_identify_notif_at = now to throttle the next
// dispatch for THIS vendor for 30 minutes regardless of cap state.
// Legacy Spendings-workflow dispatcher for vendor_identify_request
// notifications. The Vendors workflow (2026-06-02) ALWAYS asks via the
// new vendor_clarify kind + canonicalize-kickoff helper, so this helper
// is no longer invoked from the createVendor fast path. It is kept here
// (rather than deleted) so the Spendings workflow's gate logic + 5/hr
// cap stay documented in one place. If the always-ask experiment is
// reversed, re-wire by calling this from createVendor.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function _maybeDispatchVendorIdentifyRequest(args: {
  vendorId: string;
  vendorName: string;
}): Promise<void> {
  const THIRTY_MIN_MS = 30 * 60 * 1000;
  const ONE_HOUR_MS = 60 * 60 * 1000;
  const CAP_PER_HOUR = 5;
  const HIGH_CONFIDENCE_THRESHOLD = 0.7;
  const { supabase, userId } = await userOrThrow();
  // Pull current vendor flags (we just inserted the row but RLS makes a
  // re-read trivially cheap and confirms the row is visible).
  const { data: row } = await supabase
    .from("vendors")
    .select("needs_identification, identification_skipped, last_identify_notif_at")
    .eq("id", args.vendorId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!row) return;
  const r = row as {
    needs_identification?: boolean;
    identification_skipped?: boolean;
    last_identify_notif_at?: string | null;
  };
  if (!r.needs_identification || r.identification_skipped) return;

  // Curated PH brand registry — if the vendor matches a curated chain
  // (Jollibee, SM, 7-Eleven, GCash, etc.) the resolver already has an
  // icon and the user shouldn't be asked to describe it. Flip the flag
  // and skip the notification.
  try {
    const { lookupCuratedVendorBrand, normalizeVendorName } = await import(
      "@/lib/brand/vendors"
    );
    const curatedHit = lookupCuratedVendorBrand(args.vendorName);
    if (curatedHit) {
      await supabase
        .from("vendors")
        .update({ needs_identification: false })
        .eq("id", args.vendorId)
        .eq("user_id", userId);
      return;
    }
    // High-confidence cache row (user-overridden or auto-identified)
    // → already identified; flip and skip. Catches the auto-brain's
    // wins from the awaited identifyVendorIconAction call upstream.
    const norm = normalizeVendorName(args.vendorName);
    if (norm) {
      const { data: cacheRow } = await supabase
        .from("vendor_icon_cache")
        .select("user_overridden, glyph_kind, confidence")
        .eq("user_id", userId)
        .eq("vendor_name_normalized", norm)
        .maybeSingle();
      const cr = cacheRow as
        | { user_overridden?: boolean; glyph_kind?: string; confidence?: number }
        | null;
      const isIdentified =
        !!cr &&
        (cr.user_overridden === true ||
          (cr.glyph_kind !== undefined &&
            cr.glyph_kind !== "none" &&
            (cr.confidence ?? 0) >= HIGH_CONFIDENCE_THRESHOLD));
      if (isIdentified) {
        await supabase
          .from("vendors")
          .update({ needs_identification: false })
          .eq("id", args.vendorId)
          .eq("user_id", userId);
        return;
      }
    }
  } catch {
    /* best-effort — module load failure cannot block dispatch */
  }

  // 30m per-vendor debounce.
  if (r.last_identify_notif_at) {
    const last = new Date(r.last_identify_notif_at).getTime();
    if (Number.isFinite(last) && Date.now() - last < THIRTY_MIN_MS) return;
  }
  // 5/hour cap.
  const { countNotificationsInWindow, postNotification } = await import(
    "@/lib/notifications/dispatcher"
  );
  const recentCount = await countNotificationsInWindow(
    "vendor_identify_request",
    ONE_HOUR_MS,
  );
  if (recentCount >= CAP_PER_HOUR) return;
  // Dispatch.
  await postNotification({
    kind: "vendor_identify_request",
    subject: `Tell me about: ${args.vendorName}`,
    body: "What is this? I'll get an icon for it.",
    dedupKey: `vendor_identify:${args.vendorId}`,
    priority: 0,
    payload: {
      kind_specific: {
        vendor_id: args.vendorId,
        vendor_name: args.vendorName,
      },
    },
  });
  await supabase
    .from("vendors")
    .update({ last_identify_notif_at: new Date().toISOString() })
    .eq("id", args.vendorId)
    .eq("user_id", userId);
}

export async function updateVendor(id: string, input: Partial<VendorInput>) {
  const { supabase, userId } = await userOrThrow();
  const patch: Record<string, unknown> = {};
  if ("canonical_name" in input) {
    const trimmed = input.canonical_name?.trim();
    if (!trimmed) throw new Error("Vendor name can't be empty.");
    const { vendorSlug } = await import("@/lib/spending/vendor-extract");
    patch.canonical_name = trimmed;
    patch.slug = vendorSlug(trimmed);
  }
  if ("short_description" in input) patch.short_description = input.short_description ?? null;
  if ("location" in input) patch.location = input.location ?? {};
  if ("kinds" in input) patch.kinds = input.kinds ?? [];
  if ("notes" in input) patch.notes = input.notes ?? null;
  if (Object.keys(patch).length === 0) return;
  const { error } = await supabase
    .from("vendors")
    .update(patch)
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw error;
  await logEvent({
    userId,
    kind: "vendor.updated",
    title: `Updated vendor${input.canonical_name ? ` · ${input.canonical_name}` : ""}`,
    entityType: "vendor",
    entityId: id,
  });
  // Brand Identity — re-identify ONLY when the canonical name actually
  // changed. The action wrapper itself short-circuits if a non-overridden
  // cache row already exists with high confidence, so this is also
  // idempotent on repeated updates.
  if (input.canonical_name) {
    try {
      const { identifyVendorIconAction } = await import("@/lib/ai/vendor-icon-actions");
      void identifyVendorIconAction(input.canonical_name);
    } catch {
      /* best-effort */
    }
  }
  revalidatePath("/vendors");
  revalidatePath(`/vendors/${id}`);
  revalidatePath("/spending");
}

export async function archiveVendor(id: string, archived = true) {
  const { supabase, userId } = await userOrThrow();
  const { error } = await supabase
    .from("vendors")
    .update({ archived })
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw error;
  await logEvent({
    userId,
    kind: "vendor.archived",
    title: archived ? "Archived vendor" : "Restored vendor",
    entityType: "vendor",
    entityId: id,
    metadata: { archived },
  });
  revalidatePath("/vendors");
}

export async function deleteVendor(id: string) {
  const { supabase, userId } = await userOrThrow();
  const { error } = await supabase
    .from("vendors")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw error;
  await logEvent({
    userId,
    kind: "vendor.deleted",
    title: "Deleted vendor",
    entityType: "vendor",
    entityId: id,
  });
  revalidatePath("/vendors");
}

export async function createVendorAlias(vendorId: string, alias: string) {
  const { supabase, userId } = await userOrThrow();
  const trimmed = alias.trim();
  if (!trimmed) throw new Error("Alias can't be empty.");
  // RLS via parent — confirm ownership client-side first to surface a nice error.
  const { data: vendor } = await supabase
    .from("vendors")
    .select("id")
    .eq("id", vendorId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!vendor) throw new Error("Vendor not found.");
  const { normalizeAlias } = await import("@/lib/vendor-resolution");
  const norm = normalizeAlias(trimmed);
  const { error } = await supabase
    .from("vendor_aliases")
    .insert({ vendor_id: vendorId, alias: trimmed, alias_norm: norm, source: "user" });
  if (error) throw error;
  revalidatePath(`/vendors/${vendorId}`);
}

export async function deleteVendorAlias(aliasId: string, vendorId: string) {
  const { supabase, userId } = await userOrThrow();
  const { data: vendor } = await supabase
    .from("vendors")
    .select("id")
    .eq("id", vendorId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!vendor) throw new Error("Vendor not found.");
  const { error } = await supabase.from("vendor_aliases").delete().eq("id", aliasId);
  if (error) throw error;
  revalidatePath(`/vendors/${vendorId}`);
}

// ───────────────────────────────────────── Entities (Tier 2) ──

export type EntityInput = {
  kind: string;
  canonical_name: string;
  short_description?: string | null;
  aliases?: string[];
  vague?: boolean;
  notes?: string | null;
  // Entities workflow — internal flag. When true, createEntity skips
  // the always-ask Gate 2 kickoff. Used by acceptEntityDiscovery so the
  // user gets exactly ONE notification (the Gate 1 entity_discovery_request
  // they just answered) instead of two (discovery_request + a fresh
  // entity_clarify firing as a side effect of createEntity). The caller
  // is responsible for setting canonical_name + relationship + confidence
  // before/after the insert so the entity row reflects the user's Gate 1
  // answer.
  suppressKickoff?: boolean;
};

// CRITICAL BUG FIX (locked 2026-06-03 Entities workflow): createEntity
// previously bubbled the raw Postgres error message to the toast (via
// `throw new Error(error.message)`), leaking constraint identifiers and
// schema names into the user-facing surface AND failing the always-ask
// canonicalize flow when two paths converged on the same (user_id,
// lower(canonical_name)) pair. Mirrors the createVendor hardening from
// the Vendors workflow:
//   1. Pre-check for an existing entity by (user_id, lower(canonical_name))
//      so manual + Gate 1 confirmation paths can re-use the row instead
//      of failing.
//   2. 23505 race fallback re-reads and returns the existing id with
//      reused=true. The unique index in finance.entities was added in
//      0033 (canonical_name + user_id pair via the canonical-name trgm
//      index); even when no formal UNIQUE constraint exists, the
//      pre-check is still the safe path for the always-ask flow that
//      may surface the same name multiple times.
//   3. Friendly translations for 23502 (not_null_violation), 23514
//      (check_violation — introduction_status check from 0097), and
//      42501 (RLS violation) so the toast stays human.
//   4. Generic "Couldn’t add entity." fallback hides raw PG text. safeRun
//      still logs the original error to console.
//
// The returned ActionResult shape extends with `reused: boolean` to match
// createVendor. Existing callers that destructure { id } keep working
// (TypeScript widens via the discriminated union; readers that ignore
// reused stay valid).
export async function createEntity(
  input: EntityInput,
): Promise<ActionResult<{ id: string; reused: boolean }>> {
  return safeRun("createEntity", async () => {
    const { supabase, userId } = await userOrThrow();
    const name = input.canonical_name.trim();
    if (!name) throw new Error("Entity needs a name.");
    if (!input.kind) throw new Error("Pick a kind.");

    // Pre-check: an entity with the same canonical_name (case-insensitive)
    // already exists for this user. Two paths converge on this row in the
    // always-ask flow (manual "+ New entity" modal + Gate 1 confirmation
    // when the user accepts a propose-entity-from-signal suggestion); a
    // race would otherwise surface as either a unique-constraint 23505
    // or a duplicate row that breaks the entity_clarify dedup_key.
    //
    // archived rows are excluded — restoring is a separate intent (mirrors
    // createVendor's archived-exclusion semantics).
    const { data: existing } = await supabase
      .from("entities")
      .select("id")
      .eq("user_id", userId)
      .ilike("canonical_name", name)
      .eq("archived", false)
      .maybeSingle();
    if (existing) {
      // Read-only re-use — short_description / notes / kind from the new
      // input are NOT merged onto the existing row. Edits go through
      // updateEntity so the user sees the change land + the canonicalize
      // brain gets a chance to re-evaluate.
      return { id: existing.id as string, reused: true };
    }

    const { data, error } = await supabase
      .from("entities")
      .insert({
        user_id: userId,
        kind: input.kind,
        canonical_name: name,
        // Entities workflow — preserve the raw text the user typed for
        // the canonicalize-entity brain (parallel to vendors.raw_user_typed_name).
        raw_user_typed_name: name,
        short_description: input.short_description ?? null,
        aliases: input.aliases ?? [],
        vague: !!input.vague,
        notes: input.notes ?? null,
      })
      .select("id")
      .single();
    if (error) {
      // 23505 race fallback — concurrent insert won the unique constraint.
      // Re-read instead of bubbling the raw 23505 up as a server error.
      if (String(error.code) === "23505") {
        const { data: raced } = await supabase
          .from("entities")
          .select("id")
          .eq("user_id", userId)
          .ilike("canonical_name", name)
          .eq("archived", false)
          .maybeSingle();
        if (raced) return { id: raced.id as string, reused: true };
        throw new Error(
          `An archived entity with that name exists. Restore it from the archive instead.`,
        );
      }
      // Friendly translations for the Postgres constraint codes we can
      // predict. safeRun still logs the raw error to console via
      // safeRunLabeled, so the diagnostic trail survives.
      const pgCode = String(error.code ?? "");
      if (pgCode === "23502") {
        throw new Error("Entity is missing a required field.");
      }
      if (pgCode === "23514") {
        throw new Error("Entity input failed a validation check.");
      }
      if (pgCode === "42501") {
        throw new Error("You don't have permission to add an entity.");
      }
      // Generic fallback — the raw Postgres message can leak schema
      // names and constraint identifiers into the user-facing toast.
      throw new Error("Couldn’t add entity.");
    }
    const newId = data.id as string;

    await logEvent({
      userId,
      kind: "entity.created",
      title: `Entity · ${name}`,
      entityType: "entity",
      entityId: newId,
      metadata: { kind: input.kind, vague: !!input.vague },
    });

    // New entity = structural event — chatbot brain may want to ask
    // about it. Fire-and-forget; never blocks the create.
    try {
      await maybeSurfaceClarifyingQuestion();
    } catch {
      /* dynamic-import safety net — never blocks the create */
    }

    // Entities workflow — ALWAYS-ASK Gate 2 canonicalization. The kickoff
    // helper runs the Pro canonicalize-entity brain async then queues an
    // entity_clarify notification regardless of confidence. Debouncing
    // (30m per entity + 3/day cap) lives inside the helper.
    //
    // suppressKickoff (verifier fix): when acceptEntityDiscovery is the
    // caller, the user already answered the canonicalize question via
    // Gate 1's modal — firing a fresh entity_clarify here would land a
    // second notification on the inbox seconds after the first. The
    // caller patches relationship + canonical_name + confidence directly
    // so Gate 2 is functionally complete without the kickoff.
    if (!input.suppressKickoff) {
      try {
        const { kickoffEntityCanonicalize } = await import(
          "@/lib/entities/discovery"
        );
        void kickoffEntityCanonicalize({
          entityId: newId,
          entityName: name,
          relationshipHint: null,
        }).catch(() => {});
      } catch {
        /* dynamic-import safety net */
      }
    }

    revalidatePath("/entities");
    revalidatePath("/clients/people");
    return { id: newId, reused: false };
  });
}

export async function updateEntity(id: string, input: Partial<EntityInput>) {
  const { supabase, userId } = await userOrThrow();
  const patch: Record<string, unknown> = {};
  if ("kind" in input) patch.kind = input.kind;
  if ("canonical_name" in input) {
    const t = input.canonical_name?.trim();
    if (!t) throw new Error("Entity name can't be empty.");
    patch.canonical_name = t;
  }
  if ("short_description" in input) patch.short_description = input.short_description ?? null;
  if ("aliases" in input) patch.aliases = input.aliases ?? [];
  if ("vague" in input) patch.vague = !!input.vague;
  if ("notes" in input) patch.notes = input.notes ?? null;
  if (Object.keys(patch).length === 0) return;

  // Verifier fix: wire Trigger 2 (first_note) introduction. Snapshot
  // the prior notes value BEFORE the patch lands; when notes transition
  // from empty -> non-empty (or notes are written for the first time),
  // fire fireFirstNote. Idempotent via introduction_status + per-trigger
  // fact key.
  const noteTransitionRelevant = "notes" in input;
  let priorNotes: string | null = null;
  if (noteTransitionRelevant) {
    const { data: priorRow } = await supabase
      .from("entities")
      .select("notes")
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle();
    priorNotes = (priorRow as { notes: string | null } | null)?.notes ?? null;
  }
  const { error } = await supabase
    .from("entities")
    .update(patch)
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw error;
  if (noteTransitionRelevant) {
    const nextNotes = (input.notes ?? null)?.trim?.() ?? null;
    const priorNotesTrimmed = priorNotes?.trim?.() ?? null;
    if (nextNotes && nextNotes.length > 0 && !priorNotesTrimmed) {
      try {
        const { fireFirstNote } = await import("@/lib/entities/introductions");
        void fireFirstNote({
          entityId: id,
          noteExcerpt: nextNotes,
        }).catch(() => {});
      } catch {
        /* dynamic-import safety net */
      }
    }
  }
  await logEvent({
    userId,
    kind: "entity.updated",
    title: `Updated entity${input.canonical_name ? ` · ${input.canonical_name}` : ""}`,
    entityType: "entity",
    entityId: id,
  });
  revalidatePath("/entities");
  revalidatePath(`/entities/${id}`);
  revalidatePath("/clients/people");
  revalidatePath(`/clients/people/${id}`);
}

export async function archiveEntity(id: string, archived = true) {
  const { supabase, userId } = await userOrThrow();
  const { error } = await supabase
    .from("entities")
    .update({ archived })
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw error;
  await logEvent({
    userId,
    kind: "entity.archived",
    title: archived ? "Archived entity" : "Restored entity",
    entityType: "entity",
    entityId: id,
    metadata: { archived },
  });
  revalidatePath("/entities");
}

export async function deleteEntity(id: string) {
  const { supabase, userId } = await userOrThrow();
  const { error } = await supabase
    .from("entities")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw error;
  await logEvent({
    userId,
    kind: "entity.deleted",
    title: "Deleted entity",
    entityType: "entity",
    entityId: id,
  });
  revalidatePath("/entities");
}

// ───────────────────────────────────────── Wife state (Tier 2) ──

export type WifeStateInput = {
  name?: string | null;
  university?: string | null;
  year_of_study?: number | null;
  expected_graduation?: string | null;
  semester_calendar?: Record<string, unknown>;
  notes?: string | null;
};

export async function updateWifeStateAction(input: WifeStateInput) {
  const { supabase, userId } = await userOrThrow();
  const patch: Record<string, unknown> = {};
  for (const k of ["name", "university", "year_of_study", "expected_graduation", "notes"] as const) {
    if (k in input) patch[k] = (input as Record<string, unknown>)[k] ?? null;
  }
  if ("semester_calendar" in input) patch.semester_calendar = input.semester_calendar ?? {};
  const { error } = await supabase
    .from("wife_state")
    .upsert({ user_id: userId, ...patch }, { onConflict: "user_id" });
  if (error) throw error;
  await logEvent({
    userId,
    kind: "wife_state.updated",
    title: "Updated wife context",
    entityType: "wife_state",
    entityId: userId,
  });
  revalidatePath("/settings");
  revalidatePath("/today");
}

export async function consolidateWifePreferencesAction(): Promise<void> {
  const { consolidateWifePreferences } = await import("@/lib/ai/wife-preferences");
  await consolidateWifePreferences();
  revalidatePath("/today");
  revalidatePath("/settings");
}

// ───────────────────────────────────────── Tier 3 (letters, milestones, etc.) ──

export async function refreshLetterAction(input: {
  kind: "end_of_month" | "spotlight" | "sunday" | "year" | "anniversary" | "regret_mark";
  periodKey?: string;
  force?: boolean;
  // When true the call is treated as a scheduled auto-fire (cron/Sunday
  // landing / end-of-month) and goes through the worth-saying gate. The
  // /letters Generate-modal UI passes false (default) — the user
  // explicitly asked for the letter, so the gate is bypassed (matches
  // the comment in letters-auto-trigger.ts about manual generation).
  autoTriggered?: boolean;
}): Promise<{ id: string } | null> {
  // Scheduled / auto-fire path: route Sunday + end_of_month through the
  // worth-saying gate so the time-keyed letters share the same quality
  // bar as the receipt-driven triggers. The gate returns proceeded=false
  // when the trigger is too thin; we don't synthesize an id then.
  if (input.autoTriggered) {
    const { tryAutoGenerateLetter } = await import("@/lib/ai/letters-auto-trigger");
    const triggerKind: string = input.kind === "sunday" ? "sunday" : input.kind;
    await tryAutoGenerateLetter({
      triggerKind,
      letterKind: input.kind,
      triggerPayload: { auto: true, period_key: input.periodKey },
      periodKey: input.periodKey,
    });
    revalidatePath("/letters");
    revalidatePath("/today");
    // The gate may have skipped (proceeded=false) or generated. Look up
    // the row keyed by (user, kind, period_key) so the caller still gets
    // an id when the letter exists.
    const { supabase, userId } = await userOrThrow();
    const { periodKeyFor } = await import("@/lib/ai/editorial-letter");
    const periodKey = input.periodKey ?? periodKeyFor(input.kind);
    const { data } = await supabase
      .from("letters")
      .select("id")
      .eq("user_id", userId)
      .eq("kind", input.kind)
      .eq("period_key", periodKey)
      .maybeSingle();
    return data ? { id: (data as { id: string }).id } : null;
  }

  const [{ generateLetter }, { getDashboardData, getUserMemory, getMilestones, getQuietReceipts, getLifeShifts }] = await Promise.all([
    import("@/lib/ai/editorial-letter"),
    import("@/lib/data/queries"),
  ]);
  const [data, memory, milestones, receipts, shifts] = await Promise.all([
    getDashboardData(),
    getUserMemory(),
    getMilestones(120),
    getQuietReceipts(120),
    getLifeShifts(120),
  ]);
  const letter = await generateLetter({
    kind: input.kind,
    periodKey: input.periodKey,
    force: !!input.force,
    inputs: {
      payments: data.payments,
      spends: data.spends,
      spendCategories: data.spendCategories,
      spendCategoryLinks: data.spendCategoryLinks,
      vendors: data.vendors,
      milestones,
      quietReceipts: receipts,
      lifeShifts: shifts,
      userMemory: memory.memory?.memory_consolidated ?? null,
    },
  });
  revalidatePath("/letters");
  revalidatePath("/today");
  return letter ? { id: letter.id } : null;
}

export async function pinLetterAction(id: string, pinned: boolean): Promise<void> {
  const { supabase, userId } = await userOrThrow();
  const { error } = await supabase
    .from("letters")
    .update({ pinned })
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw error;
  await logEvent({
    userId,
    kind: "letter.pinned",
    title: pinned ? "Pinned letter" : "Unpinned letter",
    entityType: "letter",
    entityId: id,
    metadata: { pinned },
  });
  revalidatePath("/letters");
  revalidatePath(`/letters/${id}`);
  revalidatePath("/today");
}

export async function replyToLetterAction(id: string, reply: string): Promise<void> {
  const { supabase, userId } = await userOrThrow();
  const trimmed = reply.trim();
  if (!trimmed) throw new Error("Write something first.");
  const { data, error } = await supabase
    .from("letters")
    .update({ reply: trimmed, replied_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId)
    .select("headline,kind,period_key")
    .single();
  if (error) throw error;
  const letterRow = data as { headline: string; kind: string; period_key: string };
  // Fold into user memory so the corpus carries Hatim's own voice forward.
  try {
    await supabase.from("user_memory_entries").insert({
      user_id: userId,
      content: `Letter reply (${letterRow.kind} ${letterRow.period_key}) — "${letterRow.headline}" — ${trimmed}`,
      source: "user_note",
    });
  } catch {
    // Best-effort — the reply is already persisted on the letter row.
  }
  await logEvent({
    userId,
    kind: "letter.replied",
    title: `Replied · ${letterRow.headline.slice(0, 64)}`,
    entityType: "letter",
    entityId: id,
  });
  void import("@/lib/ai/user-memory").then((m) => m.consolidateUserMemory()).catch(() => {});
  revalidatePath("/letters");
  revalidatePath(`/letters/${id}`);
}

export async function deleteLetterAction(id: string): Promise<void> {
  const { supabase, userId } = await userOrThrow();
  const { error } = await supabase
    .from("letters")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw error;
  await logEvent({
    userId,
    kind: "letter.deleted",
    title: "Deleted a letter",
    entityType: "letter",
    entityId: id,
  });
  revalidatePath("/letters");
}

export async function runMilestoneSweepAction(): Promise<{ recorded: number }> {
  const [{ runMilestoneSweep }, { getDashboardData }] = await Promise.all([
    import("@/lib/ai/milestone-namer"),
    import("@/lib/data/queries"),
  ]);
  const data = await getDashboardData();
  const out = await runMilestoneSweep({
    payments: data.payments,
    spends: data.spends,
    spendCategories: data.spendCategories,
    spendCategoryLinks: data.spendCategoryLinks,
  });
  revalidatePath("/letters");
  revalidatePath("/today");
  return out;
}

export async function dismissMilestoneSurfacingAction(id: string): Promise<void> {
  const { supabase, userId } = await userOrThrow();
  const { error } = await supabase
    .from("milestones")
    .update({ surfaced: false })
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw error;
  revalidatePath("/today");
}

export async function replyToMilestoneAction(id: string, reply: string): Promise<void> {
  const { supabase, userId } = await userOrThrow();
  const trimmed = reply.trim();
  if (!trimmed) throw new Error("Write something first.");
  const { data, error } = await supabase
    .from("milestones")
    .update({ reply: trimmed, replied_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId)
    .select("label")
    .single();
  if (error) throw error;
  await logEvent({
    userId,
    kind: "milestone.replied",
    title: `Replied · ${(data as { label: string }).label.slice(0, 64)}`,
    entityType: "milestone",
    entityId: id,
  });
  revalidatePath("/letters");
}

export async function deleteMilestoneAction(id: string): Promise<void> {
  const { supabase, userId } = await userOrThrow();
  const { error } = await supabase
    .from("milestones")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw error;
  await logEvent({
    userId,
    kind: "milestone.deleted",
    title: "Deleted a milestone",
    entityType: "milestone",
    entityId: id,
  });
  revalidatePath("/letters");
  revalidatePath("/today");
}

// Manually log a life shift (for "What Changed" tab on /letters).
export async function logLifeShiftAction(input: {
  kind: string;
  label: string;
  beforeValue?: string;
  afterValue?: string;
  occurredAt?: string;
  narrative?: string;
}): Promise<{ id: string } | null> {
  const { recordLifeShift } = await import("@/lib/ai/life-shift-writer");
  const out = await recordLifeShift({
    kind: input.kind,
    label: input.label,
    beforeValue: input.beforeValue ?? null,
    afterValue: input.afterValue ?? null,
    occurredAt: input.occurredAt,
    narrative: input.narrative,
  });
  revalidatePath("/letters");
  return out;
}

export async function deleteLifeShiftAction(id: string): Promise<void> {
  const { supabase, userId } = await userOrThrow();
  const { error } = await supabase
    .from("life_shifts")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw error;
  await logEvent({
    userId,
    kind: "life_shift.deleted",
    title: "Deleted a life shift",
    entityType: "life_shift",
    entityId: id,
  });
  revalidatePath("/letters");
}

export async function deleteQuietReceiptAction(id: string): Promise<void> {
  const { supabase, userId } = await userOrThrow();
  const { error } = await supabase
    .from("quiet_receipts")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw error;
  await logEvent({
    userId,
    kind: "quiet_receipt.deleted",
    title: "Deleted a quiet receipt",
    entityType: "quiet_receipt",
    entityId: id,
  });
  revalidatePath("/letters");
  revalidatePath("/today");
}

// ───────────────────────────────────────── Tier 4 (body + behavior) ──

export type MorningLogInput = {
  recordedAt?: string;
  sleptHours?: number | null;
  moodBand?: number | null;
  mindState?: string | null;
  notes?: string | null;
};

export async function saveMorningLogAction(input: MorningLogInput): Promise<ActionResult<{ recordedAt: string }>> {
  return safeRun("saveMorningLog", async () => {
    const { supabase, userId } = await userOrThrow();
    const recordedAt = input.recordedAt ?? phtToday();
    const { error } = await supabase
      .from("morning_log")
      .upsert(
        {
          user_id: userId,
          recorded_at: recordedAt,
          slept_hours: input.sleptHours ?? null,
          mood_band: input.moodBand ?? null,
          mind_state: input.mindState ?? null,
          notes: input.notes ?? null,
        },
        { onConflict: "user_id,recorded_at" },
      );
    if (error) throw new Error(error.message);
    await logEvent({
      userId,
      kind: "morning_log.saved",
      title: "Logged the morning",
      entityType: "morning_log",
      entityId: userId,
      metadata: { recorded_at: recordedAt, slept_hours: input.sleptHours, mood_band: input.moodBand },
    });
    revalidatePath("/today");
    return { recordedAt };
  });
}

// T11 — intent_mirror UI surfaces removed. saveDiaryEntryAction (below) is the
// daily-grain replacement. The intent_mirror table is kept as an archive
// (see migration 0053) — readers/writers from this layer are gone.

// ───────────────────────────────────────── Tier 5 (AI conversation) ──

export async function saveCheckinResponseAction(input: {
  response: string;
  mood?: number | null;
  energy?: number | null;
  weekMoneyShape?: { landed?: number; spent?: number; surplus?: number };
}): Promise<ActionResult<{ id: string | null }>> {
  return safeRun("saveCheckinResponse", async () => {
    const { echoCheckin } = await import("@/lib/ai/tuesday-checkin");
    const row = await echoCheckin(input);
    revalidatePath("/today");
    return { id: row?.id ?? null };
  });
}

export async function runQuietChannelSweepAction(): Promise<{ detected: number }> {
  const { runQuietChannelSweep } = await import("@/lib/ai/quiet-channel-watcher");
  const out = await runQuietChannelSweep();
  revalidatePath("/clients");
  revalidatePath("/today");
  return out;
}

export async function resolveQuietChannelAction(input: { quietChannelId: string; reply: string }): Promise<{ written_to_memory_entry_id: string | null } | null> {
  const { resolveQuietChannel } = await import("@/lib/ai/quiet-channel-watcher");
  const out = await resolveQuietChannel(input);
  revalidatePath("/clients");
  revalidatePath("/today");
  return out;
}

export async function runRateInsightSweepAction(): Promise<{ generated: number }> {
  const { runRateInsightSweep } = await import("@/lib/ai/project-rate-insight");
  const out = await runRateInsightSweep();
  revalidatePath("/clients");
  revalidatePath("/projects");
  return { generated: out.generated };
}

export async function replyToRateInsightAction(input: { rateInsightId: string; reply: string }): Promise<void> {
  const { replyToRateInsight } = await import("@/lib/ai/project-rate-insight");
  await replyToRateInsight(input);
  revalidatePath("/clients");
}

export async function markRateInsightActedAction(id: string, acted: boolean): Promise<void> {
  const { supabase, userId } = await userOrThrow();
  const { error } = await supabase
    .from("rate_insights")
    .update({ acted, acted_at: acted ? new Date().toISOString() : null })
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw error;
  await logEvent({
    userId,
    kind: "rate_insight.acted",
    title: acted ? "Acted on rate insight" : "Unmarked rate insight",
    entityType: "rate_insight",
    entityId: id,
    metadata: { acted },
  });
  revalidatePath("/clients");
}

export async function deleteRateInsightAction(id: string): Promise<void> {
  const { supabase, userId } = await userOrThrow();
  const { error } = await supabase
    .from("rate_insights")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw error;
  revalidatePath("/clients");
}

// askShouldIBuyAction / recordShouldIBuyDecisionAction /
// deleteShouldIBuySessionAction were removed in the Should-I-Buy collapse
// (freelane-shouldibuy-design 2026-06-02). The /should-i-buy route now
// redirects to /, the dedicated client view is deleted, and the purchase-
// decision brain is reached through the chatbot's intent-classifier — the
// chatbot calls askShouldIBuy() directly from src/lib/ai/should-i-buy.ts
// in src/lib/ai/chat-actions.ts. Migration 0103 backfills historical
// should_i_buy_sessions rows into chat_messages as a read-only archive.

// ─────────────────────────────────────── Diary (T11) ──
// Daily diary entry — replaces the weekly intent_mirror surface. One row per
// (user, day). NO AI mirror — pure user-written. Mood + energy optional.
//
// Type is single-sourced in queries.ts (DiaryEntry); re-exported here as
// DiaryEntryRow for callers that imported it from the actions module.
// Drop the alias once every call site updates to DiaryEntry directly.
export type { DiaryEntry as DiaryEntryRow } from "./queries";

export type SaveDiaryEntryInput = {
  entryDate: string;
  body: string;
  mood?: number | null;
  energy?: number | null;
};

export async function saveDiaryEntryAction(
  input: SaveDiaryEntryInput,
): Promise<ActionResult<{ entryDate: string }>> {
  return safeRun("saveDiaryEntry", async () => {
    const { supabase, userId } = await userOrThrow();
    const { error } = await supabase
      .from("diary_entries")
      .upsert(
        {
          user_id: userId,
          entry_date: input.entryDate,
          body: input.body ?? "",
          mood: input.mood ?? null,
          energy: input.energy ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,entry_date" },
      );
    if (error) throw error;
    revalidatePath("/today");
    revalidatePath("/");
    return { entryDate: input.entryDate };
  });
}

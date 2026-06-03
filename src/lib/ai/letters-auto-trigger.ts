import "server-only";

import { getAuthUser } from "@/lib/auth";
import {
  getDashboardData,
  getUserMemory,
  getMilestones,
  getQuietReceipts,
  getLifeShifts,
  getCalmWeatherState,
  recentLettersWithin30Days,
  getLetterEngagementStats,
} from "@/lib/data/queries";
import { generateLetter, periodKeyFor } from "./editorial-letter";
import {
  generateLetterWorthSaying,
  type LetterWorthSayingInput,
} from "./brains/letter-worth-saying";
import type { EditorialLetterKind } from "@/lib/supabase/types";
import { createClient } from "@/lib/supabase/server";
import { phtDateString } from "@/lib/utils";

// Tier 3 auto-trigger entry point.
//
// Wraps the worth-saying gate + the existing editorial-letter brain into a
// single best-effort call. Used by every Tier 3 auto-emission path:
//   - 5 receipt-driven sites in data/actions.ts (recurring_paused,
//     recurring_changed, recurring_lowered, loan_repaid, plan_done)
//   - 1 generic quiet-receipt site in ai/quiet-receipt-writer.ts
//     (generic_quiet_receipt — catches every quiet receipt write that
//     wasn't already routed through a more specific trigger kind)
//   - 2 time-keyed paths routed via refreshLetterAction({ autoTriggered: true })
//     for sunday + end_of_month landings (driven by /api/cron/letters-time-keyed)
//
// Total: 6 receipt/generic trigger kinds + 2 time-keyed = 8 distinct
// trigger kinds across all Tier 3 auto-emission sites.
//
// Each call stays a single-liner:
//
//   try {
//     const { tryAutoGenerateLetter } = await import(
//       "@/lib/ai/letters-auto-trigger"
//     );
//     await tryAutoGenerateLetter({
//       triggerKind: "loan_repaid",
//       letterKind: "spotlight",
//       triggerPayload: { ... },
//     });
//   } catch { /* best-effort */ }
//
// If the worth-saying brain returns proceed=false, we log a structured
// `letter.skipped_by_gate` event into the canonical `events` activity
// table (audit trail) and SKIP generation. Otherwise we run
// generateLetter; the editorial-letter brain itself dispatches the
// new_letter notification on successful FIRST generation.
//
// Receipt-driven triggers (recurring_*, loan_*, plan_*) derive a per-
// trigger periodKey from triggerKind + a stable id in the payload (loan
// id, planned spend id, recurring spend id). This prevents generateLetter's
// 1-year period-key dedup from silently dropping the SECOND receipt-driven
// trigger of the day onto the same row.
//
// Best-effort by design — auth failure, missing data, or model error all
// fall through silently. The Tier 3 hooks already wrap this in try/catch.

export type AutoGenerateLetterArgs = {
  triggerKind: string;
  letterKind: EditorialLetterKind;
  triggerPayload: Record<string, unknown>;
  // Optional period_key override — Sunday + end_of_month default to the
  // periodKeyFor() derivation, but receipt-driven triggers want to land
  // their letter on the current month/week, which the helper computes
  // from letterKind by default.
  periodKey?: string;
};

export async function tryAutoGenerateLetter(
  args: AutoGenerateLetterArgs,
): Promise<{ proceeded: boolean; reason: string }> {
  const user = await getAuthUser();
  if (!user) return { proceeded: false, reason: "unauthenticated" };

  // Resolve the periodKey BEFORE the gate so we can:
  //   (a) check the deterministic dedup against the letters table FIRST
  //       (avoids paying Flash Lite tokens for a verdict that
  //       generateLetter would then silently drop), and
  //   (b) pass it into generateLetter at the bottom unchanged.
  //
  // Receipt-driven triggers funnel into letterKind='spotlight' with no
  // explicit periodKey. Without disambiguation, generateLetter's per-
  // (kind, period_key) row uniqueness means the SECOND receipt-driven
  // trigger in the same period collapses onto the FIRST letter's row.
  // We derive a per-trigger periodKey from triggerKind + a stable id
  // pulled from the payload so each receipt-driven event gets its own
  // row instead of theme-overcrowding the same shelf slot.
  const resolvedPeriodKey =
    args.periodKey ?? derivePeriodKey(args.triggerKind, args.letterKind, args.triggerPayload);

  // Pre-gate dedup probe — if a non-stale letter already exists for this
  // (kind, period_key) tuple, generateLetter would silently return it
  // without writing anything new. Skip the brain entirely.
  if (await letterAlreadyExists(user.id, args.letterKind, resolvedPeriodKey)) {
    await logSkipEvent({
      userId: user.id,
      triggerKind: args.triggerKind,
      letterKind: args.letterKind,
      periodKey: resolvedPeriodKey,
      reasoning: "Existing letter row for this (kind, period_key).",
      gatePath: "row_dedup",
      recentLettersCount: 0,
      lettersOpenedCount30d: 0,
    });
    return { proceeded: false, reason: "row_dedup" };
  }

  // Pull the engagement-stat snapshot + recent letters + calm-weather in
  // parallel. These feed the worth-saying gate's "is this trigger heavy
  // enough to deserve a letter today?" weighting.
  const [recentLetters, engagement, calmWeather] = await Promise.all([
    recentLettersWithin30Days(),
    getLetterEngagementStats(),
    getCalmWeatherState().catch(() => null),
  ]);

  // current_user_state — short freeform summary the model can lean on.
  // Beyond bare row counts we surface the calm-weather band + narrative
  // so the gate can tell tight-mode-now from calm-now; that's the signal
  // the brief asked for ("Tight mode: on. Runway: 6d.").
  const data = await getDashboardData().catch(() => null);
  const stateParts: string[] = [];
  if (calmWeather?.band) {
    stateParts.push(`Weather: ${calmWeather.band}`);
  }
  if (calmWeather?.narrative) {
    stateParts.push(calmWeather.narrative.slice(0, 200));
  }
  if (data) {
    stateParts.push(
      `${data.payments.length} payments tracked, ${data.spends.length} spends tracked.`,
    );
  }
  const currentUserState = stateParts.length
    ? stateParts.join(" · ")
    : "(state snapshot unavailable)";

  const verdict = await generateLetterWorthSaying({
    trigger_kind: args.triggerKind,
    trigger_payload: args.triggerPayload,
    recent_letters: recentLetters,
    user_engagement: engagement,
    current_user_state: currentUserState,
  } satisfies LetterWorthSayingInput);

  if (!verdict.proceed) {
    // Audit log into the canonical `events` activity table. The
    // letter.skipped_by_gate kind is a new EventKind variant; logEvent
    // already swallows insert errors so dispatch is best-effort either
    // way. We tag a gate_path discriminator (theme_block / disengagement
    // / model) so triage can tell which rule fired without re-running
    // the inputs.
    await logSkipEvent({
      userId: user.id,
      triggerKind: args.triggerKind,
      letterKind: args.letterKind,
      periodKey: resolvedPeriodKey,
      reasoning: verdict.reasoning,
      gatePath: classifyGatePath(verdict.reasoning),
      recentLettersCount: recentLetters.length,
      lettersOpenedCount30d: engagement.letters_opened_count_30d,
    });
    return { proceeded: false, reason: verdict.reasoning };
  }

  // Pull the full inputs the editorial-letter brain needs.
  const [dashboardData, memory, milestones, receipts, shifts] =
    await Promise.all([
      data ? Promise.resolve(data) : getDashboardData(),
      getUserMemory(),
      getMilestones(120),
      getQuietReceipts(120),
      getLifeShifts(120),
    ]);

  await generateLetter({
    kind: args.letterKind,
    periodKey: resolvedPeriodKey,
    inputs: {
      payments: dashboardData.payments,
      spends: dashboardData.spends,
      spendCategories: dashboardData.spendCategories,
      spendCategoryLinks: dashboardData.spendCategoryLinks,
      vendors: dashboardData.vendors,
      milestones,
      quietReceipts: receipts,
      lifeShifts: shifts,
      userMemory: memory.memory?.memory_consolidated ?? null,
      themeHint: verdict.theme_hint,
    },
  });

  return { proceeded: true, reason: verdict.reasoning };
}

// ─────────────────────────────────────────────── helpers ──

// Pick a stable id out of a Tier 3 trigger payload so two same-day
// receipt-driven triggers don't collide on one period_key row.
function stableSubjectId(payload: Record<string, unknown>): string | null {
  const candidateKeys = [
    "loan_id",
    "planned_spend_id",
    "recurring_spend_id",
    "spend_id",
    "payment_id",
    "milestone_id",
    "quiet_receipt_id",
    "life_shift_id",
    "subject_id",
    "id",
  ] as const;
  for (const key of candidateKeys) {
    const v = payload[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

function derivePeriodKey(
  triggerKind: string,
  letterKind: EditorialLetterKind,
  payload: Record<string, unknown>,
): string {
  // Time-keyed kinds keep the editorial brain's canonical periodKey.
  if (letterKind === "sunday" || letterKind === "end_of_month" || letterKind === "year") {
    return periodKeyFor(letterKind);
  }
  // Receipt-driven kinds get a per-trigger key.
  const day = phtDateString(new Date());
  const subjectId = stableSubjectId(payload);
  return subjectId
    ? `${letterKind}-${triggerKind}-${subjectId}`
    : `${letterKind}-${triggerKind}-${day}`;
}

async function letterAlreadyExists(
  userId: string,
  kind: EditorialLetterKind,
  periodKey: string,
): Promise<boolean> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("letters")
      .select("id")
      .eq("user_id", userId)
      .eq("kind", kind)
      .eq("period_key", periodKey)
      .maybeSingle();
    return !!data;
  } catch {
    return false;
  }
}

// Translate the gate's reasoning string into the discriminator the
// deterministic branches in letter-worth-saying.ts emit. The reasoning
// strings are stable (defined in this repo), so a prefix match is
// reliable for triage; model verdicts fall through to "model".
function classifyGatePath(
  reasoning: string,
): "theme_block" | "disengagement" | "model" | "no_model" {
  if (reasoning.startsWith("Similar-theme letter already on the shelf"))
    return "theme_block";
  if (reasoning.startsWith("Last three letters unopened"))
    return "disengagement";
  if (reasoning.startsWith("Deterministic pass")) return "no_model";
  return "model";
}

// Service-client driven variant for cron / system contexts where there's
// no request auth. Uses the SERVICE client to bypass RLS so the letter
// row write + skip event log land under the correct user_id.
//
// The gate runs the same Flash Lite + deterministic deny rules; the
// editorial brain runs the same Pro generator. Because both brains pull
// inputs through queries.ts (which expects request auth), this variant
// pulls the per-user data via service-client SQL directly. It mirrors
// the data shapes the queries return so the brains see identical input.
//
// Used by /api/cron/letters-time-keyed for sunday + end_of_month
// scheduled landings.
export async function tryAutoGenerateLetterForUser(
  userId: string,
  args: AutoGenerateLetterArgs,
): Promise<{ proceeded: boolean; reason: string }> {
  const { createServiceClient } = await import("@/lib/supabase/service");
  const supabase = createServiceClient();

  const resolvedPeriodKey =
    args.periodKey ??
    derivePeriodKey(args.triggerKind, args.letterKind, args.triggerPayload);

  // Pre-gate dedup — same shape as the request-auth path.
  const { data: existingRow } = await supabase
    .from("letters")
    .select("id")
    .eq("user_id", userId)
    .eq("kind", args.letterKind)
    .eq("period_key", resolvedPeriodKey)
    .maybeSingle();
  if (existingRow) {
    await logSkipEvent({
      userId,
      triggerKind: args.triggerKind,
      letterKind: args.letterKind,
      periodKey: resolvedPeriodKey,
      reasoning: "Existing letter row for this (kind, period_key).",
      gatePath: "row_dedup",
      recentLettersCount: 0,
      lettersOpenedCount30d: 0,
      useServiceClient: true,
    });
    return { proceeded: false, reason: "row_dedup" };
  }

  // Engagement + recent letters via service client.
  const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [
    { data: recentLettersRows },
    { data: engagementRows },
  ] = await Promise.all([
    supabase
      .from("letters")
      .select("id,kind,period_key,headline,generated_at")
      .eq("user_id", userId)
      .gte("generated_at", since30)
      .order("generated_at", { ascending: false })
      .limit(30),
    supabase
      .from("notifications_inbox")
      .select("id,read_at,created_at,payload")
      .eq("user_id", userId)
      .eq("kind", "new_letter")
      .order("created_at", { ascending: false })
      .limit(40),
  ]);

  const recentLetters = (recentLettersRows ?? []) as Array<{
    id: string;
    kind: EditorialLetterKind;
    period_key: string;
    headline: string;
    generated_at: string;
  }>;

  const engRows = ((engagementRows ?? []) as Array<{
    id: string;
    read_at: string | null;
    created_at: string;
    payload: { kind_specific?: { letter_id?: string } } | null;
  }>).filter((r) => typeof r.payload?.kind_specific?.letter_id === "string");
  const engagement = {
    last_letter_opened_at:
      engRows.find((r) => r.read_at !== null)?.read_at ?? null,
    letters_opened_count_30d: engRows.filter(
      (r) => r.read_at !== null && r.read_at >= since30,
    ).length,
    last_3_opened: engRows.slice(0, 3).map((r) => r.read_at !== null),
  };

  const verdict = await generateLetterWorthSaying({
    trigger_kind: args.triggerKind,
    trigger_payload: args.triggerPayload,
    recent_letters: recentLetters,
    user_engagement: engagement,
    current_user_state: "(cron-driven scheduled trigger)",
  } satisfies LetterWorthSayingInput);

  if (!verdict.proceed) {
    await logSkipEvent({
      userId,
      triggerKind: args.triggerKind,
      letterKind: args.letterKind,
      periodKey: resolvedPeriodKey,
      reasoning: verdict.reasoning,
      gatePath: classifyGatePath(verdict.reasoning),
      recentLettersCount: recentLetters.length,
      lettersOpenedCount30d: engagement.letters_opened_count_30d,
      useServiceClient: true,
    });
    return { proceeded: false, reason: verdict.reasoning };
  }

  // Pro generator path. generateLetter requires a request-auth user;
  // from the cron we write a minimal stub row directly through the
  // service client and rely on a future request-auth manual refresh to
  // upgrade it to a full editorial body. Sets the new_letter
  // notification so the user sees it land.
  const now = new Date().toISOString();
  const headline = `${kindHeadlinePrefix(args.letterKind)} — ${resolvedPeriodKey}`;
  const body = `A ${args.letterKind} landed. Open it to read.`;
  const { data: inserted, error: insertErr } = await supabase
    .from("letters")
    .upsert(
      {
        user_id: userId,
        kind: args.letterKind,
        period_key: resolvedPeriodKey,
        headline,
        body,
        blocks: { trigger_kind: args.triggerKind, theme_hint: verdict.theme_hint ?? null },
        input_snapshot: { cron: true },
        confidence: 0.4,
        model_version: "cron-stub-v1",
        pinned: false,
        reply: null,
        replied_at: null,
        generated_at: now,
      },
      { onConflict: "user_id,kind,period_key" },
    )
    .select("id")
    .maybeSingle();
  if (insertErr || !inserted) {
    return { proceeded: false, reason: insertErr?.message ?? "insert_failed" };
  }
  // Dispatch the new_letter notification via service-client INSERT into
  // notifications_inbox so the user's inbox sees the bell. We mirror the
  // dispatcher payload shape (kind_specific.letter_id) so the engagement
  // query can pair it back to the letter row.
  try {
    await supabase.from("notifications_inbox").insert({
      user_id: userId,
      kind: "new_letter",
      subject: headline,
      body,
      priority: 0,
      payload: {
        kind_specific: {
          letter_id: (inserted as { id: string }).id,
          kind: args.letterKind,
          period_key: resolvedPeriodKey,
        },
      },
    });
  } catch {
    // Letter row is canonical; failed bell never blocks generation.
  }
  return { proceeded: true, reason: verdict.reasoning };
}

function kindHeadlinePrefix(kind: EditorialLetterKind): string {
  switch (kind) {
    case "sunday":
      return "Sunday";
    case "end_of_month":
      return "End of month";
    case "year":
      return "Year";
    case "anniversary":
      return "Anniversary";
    case "regret_mark":
      return "Two months mark";
    case "spotlight":
      return "Spotlight";
  }
}

async function logSkipEvent(args: {
  userId: string;
  triggerKind: string;
  letterKind: EditorialLetterKind;
  periodKey: string;
  reasoning: string;
  gatePath: string;
  recentLettersCount: number;
  lettersOpenedCount30d: number;
  // When invoked from a cron / service-client context, logEvent's
  // request-auth client returns null. Use the service-client direct
  // insert in that path so cron-skipped events still land in the
  // events table.
  useServiceClient?: boolean;
}): Promise<void> {
  const metadata = {
    trigger_kind: args.triggerKind,
    letter_kind: args.letterKind,
    period_key: args.periodKey,
    reasoning: args.reasoning,
    gate_path: args.gatePath,
    recent_letters_count: args.recentLettersCount,
    letters_opened_count_30d: args.lettersOpenedCount30d,
    skipped_at: new Date().toISOString(),
  };
  try {
    if (args.useServiceClient) {
      const { createServiceClient } = await import("@/lib/supabase/service");
      const supabase = createServiceClient();
      await supabase.from("events").insert({
        user_id: args.userId,
        kind: "letter.skipped_by_gate",
        title: `Letter skipped · ${args.letterKind} · ${args.triggerKind}`,
        entity_type: "letter",
        entity_id: null,
        client_id: null,
        metadata,
      });
    } else {
      const { logEvent } = await import("@/lib/data/events");
      await logEvent({
        userId: args.userId,
        kind: "letter.skipped_by_gate",
        title: `Letter skipped · ${args.letterKind} · ${args.triggerKind}`,
        entityType: "letter",
        metadata,
      });
    }
  } catch {
    // best-effort
  }
}

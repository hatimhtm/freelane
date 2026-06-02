import "server-only";

import { Type } from "@google/genai";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { withBrainCache, fingerprintFromIds } from "../cache";
import { BRAIN_KEYS } from "../cache-keys";
import { gemini, hasGemini, pickModel } from "../models";
import { scrubForbiddenPhrases } from "../voice-scrub";
import { phtDateString } from "@/lib/utils";

// client_pattern_change — Pro brain (math gate + Gemini-authored copy).
//
// Detects when a client's payment behavior shifts. Two patterns watched:
//   1. payment_method: the wallet a payment lands on differs from the
//      dominant wallet of the most recent N=5 payments.
//   2. project_size_shift: a new project amount falls > 2 stddev away
//      from the rolling sample mean of completed-project amounts (the
//      design memo originally specified EWMA + z; this implementation uses
//      a flat sample mean over a 20-payment window — see
//      refreshClientPatternBaselines for the rationale).
//
// The math gate (≥3 priors AND ≥60% dominant wallet majority for
// payment_method; ≥3 priors AND |z| ≥ 2 for project_size_shift) stays on
// the deterministic side so Gemini cost only burns once a real shift has
// already been confirmed. After the gate fires the Pro tier authors the
// summary + question + suggested answers from the structured math signal
// {clientName, fromWallet, toWallet, zScore, direction}. If Gemini is
// unavailable or the model output is malformed, we fall back to the
// deterministic templates below so the notification path never breaks on
// a model hiccup.
//
// Cache mechanics: ai_brain_cache is keyed by (user_id, brain_key) — there
// is exactly ONE row per user per brain_key. The per-event fingerprint
// (clientId + eventId + patternKind + payload) gates regen via
// withBrainCache, but it does NOT carve out a separate cache slot per
// event. Double-dispatch protection lives in the notification dispatcher's
// dedupKey (postNotification below), NOT in the brain cache. On a real
// shift the brain RETURNS the decision and the wrapper fires the
// notification AFTER (so a notification-dispatch crash never poisons the
// brain cache with a stale "no shift" payload).

export type ClientPatternKind = "payment_method" | "project_size_shift";

export type ClientPatternChangeInput = {
  clientId: string;
  // Stable event identifier — payment_id, project_status_change event_id,
  // or any unique tag for the triggering event. Mixed into the brain
  // cache fingerprint so the per-event dispatch is idempotent.
  eventId: string;
  // Event type the brain should evaluate.
  patternKind: ClientPatternKind;
  // payment_method inputs
  newPaymentWalletId?: string | null;
  excludePaymentId?: string | null;
  // project_size_shift inputs
  newProjectAmount?: number | null;
  excludeProjectId?: string | null;
};

export type ClientPatternChangeDecision = {
  changed: boolean;
  pattern_kind: ClientPatternKind;
  summary: string;
  z_score: number | null;
  ask_user: boolean;
  question: string;
  suggested_answers: string[];
  // New wallet id for the dedupKey downstream — null when not relevant.
  new_wallet_id: string | null;
};

function noShift(patternKind: ClientPatternKind): ClientPatternChangeDecision {
  return {
    changed: false,
    pattern_kind: patternKind,
    summary: "",
    z_score: null,
    ask_user: false,
    question: "",
    suggested_answers: [],
    new_wallet_id: null,
  };
}

// Dominant wallet across the most-recent N payments for a client,
// EXCLUDING the triggering payment id (passed in by the caller) so the
// baseline doesn't absorb the event it's about to be compared against.
// Returns null when there's no history (first payment seed — no shift
// to compare against). Counts ties as the most-recent winner.
//
// Reader strategy:
//   1. Try the cached histogram in client_pattern_baselines.typical_payment_wallets
//      first — that row is refreshed AFTER each event by
//      refreshClientPatternBaselines over the SAME N=5 window. A single
//      indexed read replaces the projects → payments → payment_steps
//      join when the cache is warm AND the triggering payment isn't in
//      the window (the cache row is event-agnostic; excluding a specific
//      payment from a stored histogram isn't safe without the per-row
//      ids).
//   2. Fall back to the live join when the cache is cold or the triggering
//      payment may overlap the window — that's the only path that can
//      honour excludePaymentId precisely. The live path keeps the math
//      correct on the very first event after a baseline reset.
const PATTERN_WALLET_WINDOW = 5;

async function dominantWalletForClient(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  clientId: string,
  excludePaymentId: string | null,
  n = PATTERN_WALLET_WINDOW,
): Promise<{ walletId: string | null; runs: number; lookbackCount: number }> {
  // Cache fast path: when there's no exclusion needed AND the cached
  // histogram is non-empty, derive the dominant wallet directly.
  if (n === PATTERN_WALLET_WINDOW && !excludePaymentId) {
    const { data: baseline } = await supabase
      .from("client_pattern_baselines")
      .select("typical_payment_wallets")
      .eq("user_id", userId)
      .eq("client_id", clientId)
      .maybeSingle();
    const histogram = (baseline?.typical_payment_wallets ?? null) as
      | Array<{ wallet_id: string; count: number }>
      | null;
    if (Array.isArray(histogram) && histogram.length > 0) {
      let bestWallet: string | null = null;
      let bestCount = 0;
      let total = 0;
      for (const row of histogram) {
        const c = Number(row?.count ?? 0);
        if (!Number.isFinite(c) || c <= 0) continue;
        total += c;
        if (c > bestCount) {
          bestCount = c;
          bestWallet = String(row?.wallet_id ?? "") || null;
        }
      }
      if (bestWallet) {
        return { walletId: bestWallet, runs: bestCount, lookbackCount: total };
      }
    }
  }

  // Fallback path — pull the most recent N payments for this client. We
  // hop through projects → payments → payment_steps (final hop's
  // method_id is the landing wallet) so the dominant-wallet inference
  // matches what addPaymentWithChain wrote. This branch also runs when
  // an excludePaymentId is in play, since the cached histogram can't be
  // safely decremented without the underlying payment ids.
  const { data: projects } = await supabase
    .from("projects")
    .select("id")
    .eq("user_id", userId)
    .eq("client_id", clientId);
  const projectIds = (projects ?? []).map((p) => p.id as string);
  if (projectIds.length === 0) {
    return { walletId: null, runs: 0, lookbackCount: 0 };
  }

  let q = supabase
    .from("payments")
    .select("id,paid_at")
    .eq("user_id", userId)
    .in("project_id", projectIds)
    .not("paid_at", "is", null)
    .order("paid_at", { ascending: false, nullsFirst: false })
    .limit(n + 1); // +1 buffer to absorb the excluded id without losing N priors
  if (excludePaymentId) q = q.neq("id", excludePaymentId);
  const { data: payments } = await q;
  const paymentIds = (payments ?? []).map((p) => p.id as string).slice(0, n);
  if (paymentIds.length === 0) {
    return { walletId: null, runs: 0, lookbackCount: 0 };
  }

  const { data: steps } = await supabase
    .from("payment_steps")
    .select("payment_id,method_id,is_final,step_order")
    .in("payment_id", paymentIds);

  // Pick the final hop's method_id per payment.
  const finalByPayment = new Map<string, string | null>();
  for (const s of steps ?? []) {
    if (!s.is_final) continue;
    finalByPayment.set(s.payment_id as string, (s.method_id as string | null) ?? null);
  }
  const wallets = paymentIds
    .map((id) => finalByPayment.get(id) ?? null)
    .filter((w): w is string => !!w);
  if (wallets.length === 0) {
    return { walletId: null, runs: 0, lookbackCount: paymentIds.length };
  }
  const counts = new Map<string, number>();
  for (const w of wallets) counts.set(w, (counts.get(w) ?? 0) + 1);
  let bestWallet: string | null = null;
  let bestCount = 0;
  for (const [w, c] of counts) {
    if (c > bestCount) {
      bestWallet = w;
      bestCount = c;
    }
  }
  return {
    walletId: bestWallet,
    runs: bestCount,
    lookbackCount: paymentIds.length,
  };
}

// Read baseline mean/stddev/count from the cached row written by
// client-pattern-actions.ts:refreshClientPatternBaselines. Returns null
// when no baseline exists yet (first project — no comparison possible).
//
// The baseline cache fold-in is debounced: the actions module refreshes
// AFTER detection, so the row we read here reflects history BEFORE the
// triggering event. For project_size_shift we still subtract the
// triggering project amount when present (the cache may have been
// refreshed by a concurrent event) — defence in depth.
async function readBaseline(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  clientId: string,
  excludeAmount: number | null,
): Promise<{ mean: number; stddev: number; count: number } | null> {
  const { data } = await supabase
    .from("client_pattern_baselines")
    .select("typical_project_amount_mean,typical_project_amount_stddev,typical_project_count")
    .eq("user_id", userId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (!data) return null;
  let mean = Number(data.typical_project_amount_mean ?? 0);
  let stddev = Number(data.typical_project_amount_stddev ?? 0);
  let count = Number(data.typical_project_count ?? 0);
  if (!Number.isFinite(mean) || !Number.isFinite(stddev)) return null;

  // Best-effort subtract of the triggering amount in case the cache was
  // refreshed concurrently. Reverses sum + sum-of-squares; rebuilds the
  // mean+stddev so the z-score we compute downstream doesn't fold the
  // event back into the comparison set.
  if (excludeAmount && excludeAmount > 0 && count > 1) {
    const sum = mean * count;
    const ssd = stddev * stddev * (count - 1);
    const sumOfSquares = ssd + count * mean * mean;
    const nextCount = count - 1;
    const nextSum = sum - excludeAmount;
    const nextSumOfSquares = sumOfSquares - excludeAmount * excludeAmount;
    if (nextCount > 0) {
      const nextMean = nextSum / nextCount;
      const nextVar =
        nextCount > 1
          ? (nextSumOfSquares - nextCount * nextMean * nextMean) /
            (nextCount - 1)
          : 0;
      count = nextCount;
      mean = Number.isFinite(nextMean) ? nextMean : mean;
      stddev = Number.isFinite(nextVar) && nextVar > 0 ? Math.sqrt(nextVar) : 0;
    }
  }
  return { mean, stddev, count };
}

async function walletNameLookup(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  walletIds: string[],
): Promise<Map<string, string>> {
  const ids = Array.from(new Set(walletIds.filter(Boolean)));
  if (ids.length === 0) return new Map();
  const { data } = await supabase
    .from("payment_methods")
    .select("id,label")
    .eq("user_id", userId)
    .in("id", ids);
  const out = new Map<string, string>();
  for (const m of data ?? []) {
    out.set(m.id as string, (m.label as string) ?? "wallet");
  }
  return out;
}

async function clientNameLookup(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  clientId: string,
): Promise<string> {
  const { data } = await supabase
    .from("clients")
    .select("name")
    .eq("user_id", userId)
    .eq("id", clientId)
    .maybeSingle();
  return (data?.name as string) ?? "this client";
}

// PHT month bucket — used in the dedup key so a second shift inside the
// same month doesn't fire a duplicate notification. The bucket aligns
// with the freelancer's reporting cadence (monthly tax + monthly money
// review), not with the daily Today cards. Built from phtDateString so
// the timezone math stays in one place.
function phtMonthBucket(d: Date): string {
  return phtDateString(d).slice(0, 7);
}

// Pro-tier copy generator. The math gate already decided a shift is real;
// this brain just translates {clientName, fromWallet, toWallet, zScore,
// direction} into the freelancer voice (one short summary, one question,
// three suggested answers). Returns null on any failure so the caller
// falls back to the deterministic templates — the math decision stays
// authoritative even when Gemini is unavailable.
const NARRATOR_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    summary: { type: Type.STRING },
    question: { type: Type.STRING },
    suggested_answers: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
  },
  required: ["summary", "question", "suggested_answers"],
} as const;

const NARRATOR_SYSTEM_PROMPT = `You narrate a confirmed client-pattern shift for a freelancer.

The math has already decided this is a real shift — your job is the copy, not the decision.

Inputs you receive are structured: client name, the kind of shift (payment_method or project_size_shift),
and per-kind fields (from/to wallet names; z-score + direction).

Output rules:
- summary: ONE short sentence stating what changed in plain words. No imperative.
- question: ONE short question that asks whether this is the new normal.
- suggested_answers: exactly THREE short reply options the user can tap. Affirm / deny / unsure shape.
- Freelancer voice: warm, sharp, plain. Statement not advice.
- NEVER use: "you should", "consider", "save more", "stay positive", "well done", "great job", "amazing"
- No emojis. No markdown.

Return ONLY {"summary": string, "question": string, "suggested_answers": string[]} JSON.`;

type NarratorInput =
  | {
      kind: "payment_method";
      clientName: string;
      fromWallet: string;
      toWallet: string;
    }
  | {
      kind: "project_size_shift";
      clientName: string;
      zScore: number;
      direction: "up" | "down";
    };

type NarratorOutput = {
  summary: string;
  question: string;
  suggested_answers: string[];
};

async function generatePatternCopy(
  input: NarratorInput,
): Promise<NarratorOutput | null> {
  if (!hasGemini()) return null;
  try {
    const lines: string[] = [
      `CLIENT NAME: ${input.clientName}`,
      `PATTERN KIND: ${input.kind}`,
    ];
    if (input.kind === "payment_method") {
      lines.push(`USUAL LANDING WALLET: ${input.fromWallet}`);
      lines.push(`THIS-EVENT LANDING WALLET: ${input.toWallet}`);
    } else {
      lines.push(`Z-SCORE: ${input.zScore.toFixed(1)}`);
      lines.push(`DIRECTION: ${input.direction}`);
    }
    lines.push("", "Author the summary + question + 3 suggested answers.");
    const prompt = lines.join("\n");

    const res = await gemini().models.generateContent({
      model: pickModel("heavy"),
      contents: prompt,
      config: {
        systemInstruction: NARRATOR_SYSTEM_PROMPT,
        temperature: 0.2,
        responseMimeType: "application/json",
        responseSchema: NARRATOR_RESPONSE_SCHEMA,
      },
    });

    const parsed = JSON.parse((res.text ?? "{}").trim()) as Partial<
      NarratorOutput
    >;
    const summary = scrubForbiddenPhrases(String(parsed.summary ?? "").trim());
    const question = scrubForbiddenPhrases(
      String(parsed.question ?? "").trim(),
    );
    const suggested = Array.isArray(parsed.suggested_answers)
      ? parsed.suggested_answers
          .map((s) => scrubForbiddenPhrases(String(s ?? "").trim()))
          .filter((s) => s.length > 0)
          .slice(0, 3)
      : [];
    if (!summary || !question || suggested.length < 3) return null;
    return { summary, question, suggested_answers: suggested };
  } catch {
    return null;
  }
}

export async function detectClientPatternChange(
  input: ClientPatternChangeInput,
): Promise<ClientPatternChangeDecision> {
  const user = await getAuthUser();
  if (!user) return noShift(input.patternKind);
  const supabase = await createClient();

  const fp = await fingerprintFromIds([
    "client_pattern_change",
    input.clientId,
    input.eventId,
    input.patternKind,
    String(input.newPaymentWalletId ?? ""),
    String(input.newProjectAmount ?? ""),
  ]);

  const cached = await withBrainCache<ClientPatternChangeDecision>({
    brainKey: BRAIN_KEYS.CLIENT_PATTERN_CHANGE,
    fingerprint: fp,
    phtDayAnchored: false,
    regen: async () => {
      // NOTE: this regen() deliberately RE-THROWS on transient failure.
      // withBrainCache catches and returns the prior cached entry instead
      // of writing a poisoned "no shift" decision. Caching a no-shift on
      // a DB hiccup would silently suppress the genuine shift for the
      // next hour until TTL elapsed.

      // Branch on pattern kind. Each branch returns early with noShift()
      // when the math says "this isn't a real shift", keeping the
      // notification path off entirely.
      if (input.patternKind === "payment_method") {
        const wallet = input.newPaymentWalletId ?? null;
        if (!wallet) return noShift("payment_method");
        const dominant = await dominantWalletForClient(
          supabase,
          user.id,
          input.clientId,
          input.excludePaymentId ?? null,
        );
        // No prior history → can't call this a shift yet. Require at
        // least 3 prior payments AND a clear majority (runs / lookback
        // ≥ 0.6) so a 2/5 thin majority on a new client doesn't fire.
        if (
          !dominant.walletId ||
          dominant.lookbackCount < 3 ||
          dominant.runs / dominant.lookbackCount < 0.6
        ) {
          return noShift("payment_method");
        }
        if (dominant.walletId === wallet) {
          return noShift("payment_method");
        }

        const walletNames = await walletNameLookup(supabase, user.id, [
          wallet,
          dominant.walletId,
        ]);
        const clientName = await clientNameLookup(supabase, user.id, input.clientId);
        const fromName = walletNames.get(dominant.walletId) ?? "previous wallet";
        const toName = walletNames.get(wallet) ?? "new wallet";

        // Pro narrator authors the user-facing copy from the math signal.
        // Fall back to deterministic templates when Gemini is off or the
        // response is malformed — the math gate above stays authoritative.
        const fallback: NarratorOutput = {
          summary: `${clientName} paid via ${toName} this time — usually they land on ${fromName}.`,
          question: `Is ${clientName} switching their default payment method to ${toName}?`,
          suggested_answers: [
            `Yes — switch to ${toName}`,
            `No — one-off, keep ${fromName}`,
            "Not sure yet",
          ],
        };
        const copy =
          (await generatePatternCopy({
            kind: "payment_method",
            clientName,
            fromWallet: fromName,
            toWallet: toName,
          })) ?? fallback;

        return {
          changed: true,
          pattern_kind: "payment_method",
          summary: copy.summary,
          z_score: null,
          ask_user: true,
          question: copy.question,
          suggested_answers: copy.suggested_answers,
          new_wallet_id: wallet,
        };
      }

      if (input.patternKind === "project_size_shift") {
        const amount = Number(input.newProjectAmount ?? 0);
        if (!Number.isFinite(amount) || amount <= 0) {
          return noShift("project_size_shift");
        }
        const baseline = await readBaseline(
          supabase,
          user.id,
          input.clientId,
          input.excludeProjectId ? amount : null,
        );
        // Need at least a small sample to call shift; 3 priors keeps
        // the early-history noise out.
        if (!baseline || baseline.count < 3 || baseline.stddev <= 0) {
          return noShift("project_size_shift");
        }
        const z = (amount - baseline.mean) / baseline.stddev;
        if (Math.abs(z) < 2) return noShift("project_size_shift");

        const clientName = await clientNameLookup(supabase, user.id, input.clientId);
        const direction: "up" | "down" = z > 0 ? "up" : "down";

        const fallback: NarratorOutput = {
          summary: `${clientName}'s new project is well ${direction} from their usual size (z=${z.toFixed(1)}).`,
          question:
            direction === "up"
              ? `Is ${clientName}'s scope growing — bigger projects from here?`
              : `Is ${clientName}'s scope shrinking — smaller projects from here?`,
          suggested_answers: [
            "Yes — this is the new normal",
            "No — one-off, ignore for the baseline",
            "Not sure yet",
          ],
        };
        const copy =
          (await generatePatternCopy({
            kind: "project_size_shift",
            clientName,
            zScore: z,
            direction,
          })) ?? fallback;

        return {
          changed: true,
          pattern_kind: "project_size_shift",
          summary: copy.summary,
          z_score: Math.round(z * 10) / 10,
          ask_user: true,
          question: copy.question,
          suggested_answers: copy.suggested_answers,
          new_wallet_id: null,
        };
      }

      return noShift(input.patternKind);
    },
  });

  const decision = cached?.payload ?? noShift(input.patternKind);

  // Dispatch the notification AFTER withBrainCache returns. Doing this
  // inside regen() couples the cache write to the dispatch — a postback
  // crash would freeze the cache row at "no shift" for the TTL window and
  // silently suppress the real shift. The dispatcher's dedup key catches
  // replays so calling on every cache hit is safe.
  if (decision.changed && decision.ask_user) {
    await maybeDispatchNotification(decision, input).catch(() => {});
  }

  return decision;
}

async function maybeDispatchNotification(
  decision: ClientPatternChangeDecision,
  input: ClientPatternChangeInput,
): Promise<void> {
  // Dynamic import so the brain module stays decoupled from the
  // dispatcher's "use server" surface (matches the calm-weather +
  // post-payday pattern — see calm-weather.ts:postNotification call).
  const { postNotification } = await import("@/lib/notifications/dispatcher");
  const supabase = await createClient();
  const user = await getAuthUser();
  if (!user) return;
  const clientName = await clientNameLookup(supabase, user.id, input.clientId);
  const monthBucket = phtMonthBucket(new Date());
  // Include the new wallet id (when present) so a SECOND distinct shift
  // in the same month produces a separate notification — otherwise the
  // monthly bucket would silently squash week-1 GCash and week-3 Wise
  // into one notification. For project_size_shift, mirror the same
  // approach with the project id (Math.round(z) is too coarse — z=2.4 and
  // z=2.3 both round to 2, collapsing two genuine shifts).
  const dedupSuffix = decision.new_wallet_id
    ? `:${decision.new_wallet_id}`
    : decision.pattern_kind === "project_size_shift" && input.excludeProjectId
    ? `:p${input.excludeProjectId}`
    : decision.z_score !== null
    ? `:z${Math.round(decision.z_score)}`
    : "";
  await postNotification({
    kind: "client_pattern_change",
    subject: `${clientName}: pattern shift`,
    body: decision.summary,
    linkUrl: `/clients/${input.clientId}`,
    priority: 1,
    dedupKey: `client_pattern_change:${input.clientId}:${decision.pattern_kind}:${monthBucket}${dedupSuffix}`,
    payload: {
      choices: decision.suggested_answers,
      kind_specific: {
        client_id: input.clientId,
        pattern_kind: decision.pattern_kind,
        summary: decision.summary,
        question: decision.question,
        suggested_answers: decision.suggested_answers,
        event_id: input.eventId,
      },
    },
  });
}

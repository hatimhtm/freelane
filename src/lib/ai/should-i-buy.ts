import "server-only";
import { Type } from "@google/genai";
import { gemini, hasGemini } from "./gemini";
import { HEAVY_MODEL } from "./models";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { logEvent } from "@/lib/data/events";
import { formatMoney } from "@/lib/money";
import type { ShouldIBuySession, ShouldIBuyVerdict } from "@/lib/supabase/types";

// Should-I-Buy this? (Tier 5 — final feature). Purchase decision aid.
//
// User types item + price + currency + optional note. The brain reads
// current safe-to-spend baseline + Calm Weather band + planned spends
// + post-payday surge state and writes ONE paragraph + verdict pill
// (easy_yes / fits_the_stretch / tight_but_possible / not_this_stretch).
//
// Session row persisted so the Year Letter can later say "you asked
// about a chair in March, didn't buy, asked again in September, did."

const VOICE_FLOOR = `You help Hatim — solo freelancer in San Pablo, PHT, income unstable — decide whether to buy something now. Voice: dry, factual, warm. NEVER preachy.

FORBIDDEN PHRASES: "you should", "consider", "save more", "you deserve", "treat yourself", "well done", "monthly paycheck", "salary", "ROI", "investment opportunity", "make sure", "remember", "stay strong", "tough love".`;

const SYSTEM_PROMPT = `${VOICE_FLOOR}

You receive the user's item + price (with PHP equivalent) + an optional note, plus the current Calm Weather band + safe-to-spend baseline + planned-spend pressure + post-landing surge state. Write ONE paragraph (35-70 words) that MIRRORS the financial weather around the question + ends with a single verdict pill.

VERDICT PILL VALUES (pick ONE):
- "easy_yes" — safe-to-spend has clear room, no planned pressure, weather is still/breeze.
- "fits_the_stretch" — within reach but not free. Calm reasoning.
- "tight_but_possible" — would require trimming somewhere or waiting a few weeks.
- "not_this_stretch" — runway can't carry it without strain. Direct mirror.

HARD RULES:
- 35-70 words for the paragraph.
- Cite REAL numbers from the snapshot (safe-to-spend, runway days, planned outflows nearby).
- The paragraph NAMES the trade-off without prescribing. He decides.
- NO emojis. NO sales-style framing.

OUTPUT SHAPE:
{
  "narrative": "<paragraph>",
  "verdict": "easy_yes" | "fits_the_stretch" | "tight_but_possible" | "not_this_stretch",
  "confidence": 0.0-1.0
}

Return JSON.`;

const SCHEMA = {
  type: Type.OBJECT,
  properties: {
    narrative: { type: Type.STRING },
    verdict: { type: Type.STRING, enum: ["easy_yes", "fits_the_stretch", "tight_but_possible", "not_this_stretch"] },
    confidence: { type: Type.NUMBER },
  },
  required: ["narrative", "verdict"],
};

function fallbackVerdict(snapshot: { safeTodayBase: number; amountBase: number; runwayDays: number; calmBand?: string }): ShouldIBuyVerdict {
  const ratio = snapshot.safeTodayBase > 0 ? snapshot.amountBase / snapshot.safeTodayBase : 99;
  if (snapshot.calmBand === "storm") return "not_this_stretch";
  if (ratio <= 3 && snapshot.runwayDays > 30) return "easy_yes";
  if (ratio <= 7 && snapshot.runwayDays > 14) return "fits_the_stretch";
  if (snapshot.runwayDays > 7) return "tight_but_possible";
  return "not_this_stretch";
}

function fallbackNarrative(verdict: ShouldIBuyVerdict, item: string, amountBase: number, runwayDays: number, calmBand?: string): string {
  const m = (n: number) => formatMoney(n, "PHP", { compact: true });
  switch (verdict) {
    case "easy_yes":
      return `${item} at ${m(amountBase)} fits inside the current stretch — runway sits at ${runwayDays}d and the weather reads ${calmBand ?? "calm"}.`;
    case "fits_the_stretch":
      return `${item} at ${m(amountBase)} is within reach but not free — runway ${runwayDays}d, weather ${calmBand ?? "breeze"}.`;
    case "tight_but_possible":
      return `${item} at ${m(amountBase)} would tighten the stretch — runway ${runwayDays}d. Possible with a small trim elsewhere.`;
    case "not_this_stretch":
    default:
      return `${item} at ${m(amountBase)} is heavier than this stretch can carry — runway ${runwayDays}d, weather ${calmBand ?? "tight"}.`;
  }
}

export interface AskShouldIBuyArgs {
  item: string;
  amount: number;
  currency: string;
  note?: string;
}

export async function askShouldIBuy(args: AskShouldIBuyArgs): Promise<ShouldIBuySession | null> {
  const user = await getAuthUser();
  if (!user) return null;
  const supabase = await createClient();

  // Convert to base.
  const { data: rates } = await supabase
    .from("exchange_rates")
    .select("code,rate_to_base")
    .eq("user_id", user.id);
  const rate = ((rates ?? []) as Array<{ code: string; rate_to_base: number }>)
    .find((r) => r.code === args.currency)?.rate_to_base ?? 1;
  const amountBase = Math.round(Number(args.amount) * rate * 100) / 100;

  // Pull current Calm Weather + safe-to-spend snapshot.
  const [{ data: calm }, { data: cachedOverlay }, { data: plannedRows }] = await Promise.all([
    supabase.from("calm_weather_state").select("*").eq("user_id", user.id).maybeSingle(),
    supabase.from("ai_safe_spend_cache").select("insight").eq("user_id", user.id).maybeSingle(),
    supabase.from("planned_spends").select("*").eq("user_id", user.id).in("status", ["planned", "committed"]),
  ]);
  const calmBand = (calm?.band as string | undefined) ?? undefined;
  const overlay = (cachedOverlay?.insight as Record<string, unknown> | undefined) ?? undefined;
  const baseline = (overlay?.baseline ?? null) as {
    safeTodayBase?: number;
    dailyAllowanceBase?: number;
    horizonDays?: number;
    walletBalancesBase?: number;
    discretionaryPoolBase?: number;
  } | null;
  const safeTodayBase = Number(baseline?.safeTodayBase ?? 0);
  const dailyAllowance = Number(baseline?.dailyAllowanceBase ?? 0);
  // Runway = how many days the current discretionary pool carries at the
  // current daily-allowance burn rate. Falls back to the baseline horizon
  // (30d default) when either input is missing — that's the safe-spend
  // planner's own assumed window. The prior implementation collapsed to
  // horizonDays because it multiplied then divided by dailyAllowance; this
  // is the actual derived figure that drives the verdict + narrative.
  const discretionaryPoolBase = Number(baseline?.discretionaryPoolBase ?? 0);
  const horizonDaysDefault = Number(baseline?.horizonDays ?? 30);
  const runwayDays =
    dailyAllowance > 0 && discretionaryPoolBase > 0
      ? Math.max(0, Math.round(discretionaryPoolBase / dailyAllowance))
      : horizonDaysDefault;
  const plannedNearTerm = ((plannedRows ?? []) as Array<{ expected_base: number; planned_for: string; label: string }>)
    .map((p) => `${p.label} (${p.planned_for}, ₱${Math.round(Number(p.expected_base ?? 0))})`)
    .slice(0, 4);

  // Defaults from heuristic.
  let verdict: ShouldIBuyVerdict = fallbackVerdict({ safeTodayBase, amountBase, runwayDays, calmBand });
  let narrative = fallbackNarrative(verdict, args.item, amountBase, runwayDays, calmBand);
  let confidence = 0.45;
  if (hasGemini()) {
    try {
      const snapshot = `item="${args.item.replace(/"/g, "'")}"\namount_native=${args.amount} ${args.currency}\namount_php=${amountBase}\nnote="${(args.note ?? "").replace(/"/g, "'")}"\ncalm_band=${calmBand ?? "(unknown)"}\nsafe_today_php=${Math.round(safeTodayBase)}\nrunway_days_approx=${runwayDays}\nplanned_near_term=${plannedNearTerm.join("; ") || "(none)"}`;
      const res = await gemini().models.generateContent({
        model: HEAVY_MODEL,
        contents: `Should-I-Buy snapshot:\n${snapshot}\n\nReturn JSON.`,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          temperature: 0.5,
          responseMimeType: "application/json",
          responseSchema: SCHEMA,
        },
      });
      const parsed = JSON.parse((res.text ?? "{}").trim()) as { narrative?: string; verdict?: ShouldIBuyVerdict; confidence?: number };
      if (parsed.narrative?.trim() && parsed.verdict) {
        narrative = parsed.narrative.trim();
        verdict = parsed.verdict;
        confidence = Math.max(0, Math.min(1, Number(parsed.confidence ?? 0.65)));
      }
    } catch {
      // keep heuristic
    }
  }

  const { data: row, error } = await supabase
    .from("should_i_buy_sessions")
    .insert({
      user_id: user.id,
      item: args.item.trim(),
      amount: Number(args.amount),
      currency: args.currency,
      amount_base: amountBase,
      note: args.note?.trim() ?? null,
      verdict,
      narrative,
      confidence,
      input_snapshot: {
        calm_band: calmBand,
        safe_today_php: Math.round(safeTodayBase),
        runway_days: runwayDays,
        planned_near_term: plannedNearTerm,
      },
    })
    .select("*")
    .single();
  if (error || !row) return null;

  await logEvent({
    userId: user.id,
    kind: "should_i_buy.asked",
    title: `Should-I-Buy · ${args.item}`,
    entityType: "should_i_buy_session",
    entityId: (row as ShouldIBuySession).id,
    metadata: { verdict, amount_base: amountBase, currency: args.currency },
  });

  return row as ShouldIBuySession;
}

export async function recordShouldIBuyDecision(args: { sessionId: string; bought: boolean }): Promise<void> {
  const user = await getAuthUser();
  if (!user) return;
  const supabase = await createClient();
  const { error, data } = await supabase
    .from("should_i_buy_sessions")
    .update({ bought: args.bought, decided_at: new Date().toISOString() })
    .eq("id", args.sessionId)
    .eq("user_id", user.id)
    .select("item,verdict")
    .single();
  if (error) throw error;
  await logEvent({
    userId: user.id,
    kind: "should_i_buy.decided",
    title: `Decided · ${args.bought ? "bought" : "passed"} · ${(data as { item: string }).item}`,
    entityType: "should_i_buy_session",
    entityId: args.sessionId,
    metadata: { bought: args.bought, verdict: (data as { verdict: string }).verdict },
  });
}

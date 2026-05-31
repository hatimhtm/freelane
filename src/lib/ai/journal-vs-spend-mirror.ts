import "server-only";
import { Type } from "@google/genai";
import { gemini, hasGemini } from "./gemini";
import { HEAVY_MODEL } from "./models";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { formatMoney } from "@/lib/money";
import { phtDateString, phtToday } from "@/lib/utils";
import type {
  IntentMirror,
  IntentMirrorRealitySnapshot,
  Payment,
  Spend,
  SpendCategory,
  SpendCategoryLink,
} from "@/lib/supabase/types";

// Journal vs Spend Reality Mirror (#36) — Hatim 2026-06-01: "framed as
// gentle push toward saving for building a family". The mirror NEVER
// accuses. It NAMES the gap between intention and reality, and lets the
// gentle nudge toward "for the house" be implied rather than stated.

const DAY_MS = 86_400_000;

const SYSTEM_PROMPT = `You write the Journal vs Spend Reality Mirror for Hatim — a SOLO freelancer in San Pablo, PHT. He is building a family. Income is UNSTABLE.

The user wrote intentions for the week. You receive: those intentions + the week's actual spend snapshot. Write a SHORT mirror paragraph (3-5 sentences, ≤ 80 words) that names the gap honestly + gently nudges toward saving for the household — implicit, never preachy.

HARD RULES (NON-NEGOTIABLE):
- FORBIDDEN PHRASES: "you should", "consider", "try to", "remember", "make sure to", "you failed", "you missed", "you didn't", "you need to", "save more", "spend less", "budget", "monthly paycheck", "your salary", "well done", "great job".
- REPLACEMENT FRAMING: "the week leaned toward…", "the runway absorbed…", "the household side stayed at…", "for the house", "building the family".
- NEVER accuse. NEVER moralize. NEVER cheer.
- Family-building frame allowed AT MOST ONCE. Never as a goal.
- Cite REAL numbers from the snapshot.
- Cigarettes / fast food: factual citation, never moralized.

EXAMPLES (do not copy literally):
{
  "narrative": "The intention named slowing fast food and tucking ₱2,000 toward the household. The week landed differently — ₱1,840 on Fast food, ₱220 for the house. Cigarettes held steady at ₱340. Three landings yet to be folded in."
}

Return JSON: { "narrative": "<paragraph>", "confidence": 0-1 }`;

const SCHEMA = {
  type: Type.OBJECT,
  properties: {
    narrative: { type: Type.STRING },
    confidence: { type: Type.NUMBER },
  },
  required: ["narrative"],
};

// Compute the ISO Monday of the week the given date is in.
function isoMonday(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const dow = x.getDay() || 7;
  x.setDate(x.getDate() - (dow - 1));
  return x;
}

// Build the reality snapshot for the week starting on the given Monday.
function buildRealitySnapshot(args: {
  monday: Date;
  payments: Payment[];
  spends: Spend[];
  spendCategories: SpendCategory[];
  spendCategoryLinks: SpendCategoryLink[];
}): IntentMirrorRealitySnapshot {
  const start = args.monday;
  const end = new Date(start.getTime() + 7 * DAY_MS - 1);
  const inWindow = (d: string) => {
    const x = new Date(d);
    return x >= start && x <= end;
  };
  const weekSpends = args.spends.filter((s) => inWindow(s.spent_at));
  const weekPayments = args.payments.filter((p) => inWindow(p.paid_at));
  const cigCat = args.spendCategories.find((c) => /cigarettes?/i.test(c.name));
  const fastCat = args.spendCategories.find((c) => /fast.*food/i.test(c.name));
  const totalSpend = weekSpends.reduce((sum, s) => sum + Number(s.amount_base ?? 0), 0);
  const totalLanded = weekPayments.reduce((sum, p) => sum + Number(p.net_amount_base ?? 0), 0);
  const cigSpend = cigCat
    ? weekSpends
        .filter((s) => args.spendCategoryLinks.some((l) => l.spend_id === s.id && l.category_id === cigCat.id))
        .reduce((sum, s) => sum + Number(s.amount_base ?? 0), 0)
    : 0;
  const fastFoodSpend = fastCat
    ? weekSpends
        .filter((s) => args.spendCategoryLinks.some((l) => l.spend_id === s.id && l.category_id === fastCat.id))
        .reduce((sum, s) => sum + Number(s.amount_base ?? 0), 0)
    : 0;
  const householdTotal = weekSpends.filter((s) => s.for_us).reduce((sum, s) => sum + Number(s.amount_base ?? 0), 0);
  return {
    landed_total: Math.round(totalLanded),
    spent_total: Math.round(totalSpend),
    cigarette_spends: Math.round(cigSpend),
    fast_food_spends: Math.round(fastFoodSpend),
    household_total: Math.round(householdTotal),
  };
}

export interface RefreshIntentMirrorArgs {
  weekStarts?: string;          // "YYYY-MM-DD" — defaults to last Monday
  payments: Payment[];
  spends: Spend[];
  spendCategories: SpendCategory[];
  spendCategoryLinks: SpendCategoryLink[];
}

export async function refreshIntentMirror(args: RefreshIntentMirrorArgs): Promise<IntentMirror | null> {
  const user = await getAuthUser();
  if (!user) return null;
  const supabase = await createClient();
  const weekStartsStr = args.weekStarts ?? phtDateString(isoMonday(new Date(phtToday())));
  const monday = new Date(weekStartsStr);

  // Pull intentions if a row exists (user may have logged intentions earlier).
  const { data: existing } = await supabase
    .from("intent_mirror")
    .select("*")
    .eq("user_id", user.id)
    .eq("week_starts", weekStartsStr)
    .maybeSingle();
  const intentionsObj = (existing?.intentions as IntentMirror["intentions"]) ?? {};
  const intentionsText = (existing?.intentions_text as string | null) ?? null;
  const snapshot = buildRealitySnapshot({
    monday,
    payments: args.payments,
    spends: args.spends,
    spendCategories: args.spendCategories,
    spendCategoryLinks: args.spendCategoryLinks,
  });

  let narrative = fallbackMirror(intentionsObj, intentionsText, snapshot);
  let confidence = 0.4;
  if (hasGemini() && (intentionsText || Object.keys(intentionsObj).length > 0)) {
    try {
      const promptInputs = `week_starts=${weekStartsStr}\nintentions=${JSON.stringify(intentionsObj).slice(0, 600)}\nintentions_text="${intentionsText ?? ""}"\nreality_snapshot=${JSON.stringify(snapshot)}`;
      const res = await gemini().models.generateContent({
        model: HEAVY_MODEL,
        contents: `Mirror snapshot:\n${promptInputs}\n\nReturn JSON.`,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          temperature: 0.5,
          responseMimeType: "application/json",
          responseSchema: SCHEMA,
        },
      });
      const parsed = JSON.parse((res.text ?? "{}").trim()) as {
        narrative?: string;
        confidence?: number;
      };
      if (parsed.narrative?.trim()) {
        narrative = parsed.narrative.trim();
        confidence = Math.max(0, Math.min(1, Number(parsed.confidence ?? 0.7)));
      }
    } catch {
      // keep fallback
    }
  }

  const row = {
    user_id: user.id,
    week_starts: weekStartsStr,
    intentions: intentionsObj,
    intentions_text: intentionsText,
    reality_snapshot: snapshot,
    narrative,
    confidence,
    generated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from("intent_mirror")
    .upsert(row, { onConflict: "user_id,week_starts" })
    .select("*")
    .single();
  if (error || !data) return null;
  return data as IntentMirror;
}

function fallbackMirror(
  intentions: IntentMirror["intentions"],
  intentionsText: string | null,
  reality: IntentMirrorRealitySnapshot,
): string {
  const focus = intentions.focus ?? intentionsText ?? "the week's intentions";
  const m = (n: number) => formatMoney(n, "PHP", { compact: true });
  return `Named: ${focus}. The week landed at ${m(reality.spent_total ?? 0)} spent against ${m(reality.landed_total ?? 0)} landed. Household ${m(reality.household_total ?? 0)}; cigarettes ${m(reality.cigarette_spends ?? 0)}; fast food ${m(reality.fast_food_spends ?? 0)}.`;
}

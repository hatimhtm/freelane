import "server-only";
import { Type } from "@google/genai";
import { gemini, hasGemini } from "./gemini";
import { HEAVY_MODEL } from "./models";
import { getAuthUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type {
  MemoryConsolidated,
  Spend,
  SpendCategory,
  SpendCategoryLink,
  WifeState,
} from "@/lib/supabase/types";

// Wife Preferences Corpus (#25) — Gemini reads every Wife-tagged spend's
// description + notes + items and consolidates a "she lights up at: ube,
// white roses, Dali in Mayapa" structure. Lives in
// wife_state.preferences_consolidated.
//
// Modeled on src/lib/ai/user-memory.ts. Best-effort: failures don't break
// the parent caller (which usually fires after a spend save).
//
// IMPORTANT (Hatim 2026-06-01 — wife reality):
//   - Wife works + pays her own tuition + they don't live together yet.
//   - GCash is HER account; not Hatim's to rebalance.
//   - The corpus is about PREFERENCES, not budget. It NEVER outputs spending
//     advice; it outputs OBSERVATIONS the AI can use to color the narrative.

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    summary: { type: Type.STRING },
    facts: { type: Type.ARRAY, maxItems: 6, items: { type: Type.STRING } },
    preferences: {
      type: Type.OBJECT,
      properties: {
        lights_up_at: { type: Type.STRING, nullable: true },
        wary_of:     { type: Type.STRING, nullable: true },
        favorite_places: { type: Type.STRING, nullable: true },
        typical_gifts: { type: Type.STRING, nullable: true },
        nudge: { type: Type.STRING, nullable: true },
      },
    },
    watch: { type: Type.ARRAY, maxItems: 3, items: { type: Type.STRING } },
  },
  required: ["summary", "facts", "preferences"],
  propertyOrdering: ["summary", "facts", "preferences", "watch"],
};

const SYSTEM_PROMPT = `You consolidate the Wife Preferences Corpus for Hatim, a SOLO freelancer in San Pablo, Philippines. His wife is a 3rd-year university student. She works + pays her own tuition + they don't live together yet. Finances are NOT pooled.

You receive every Wife-tagged spend description + notes + items from the last 6 months, plus any prior consolidated facts. Your job: distill an OBSERVATIONAL corpus the AI can color future narratives with. NOT a budget. NOT advice.

HARD RULES (NON-NEGOTIABLE):
- Output is OBSERVATIONS, never directives. "She lights up at ube" — yes. "He should buy more ube" — no.
- FORBIDDEN PHRASES: "should", "consider", "save", "budget", "you might want to", "remember to", "make sure".
- FORBIDDEN FRAMINGS: anything that treats the wife's money or schedule as Hatim's to manage. She is independent.
- Family-building / "building a house" framing allowed AT MOST ONCE, only in the summary, only if the data clearly supports it.
- Cite REAL items / places / prices when relevant. Don't invent.

WHAT YOU WRITE:
- summary: 1-2 sentences. Quiet portrait.
- facts: 3-6 short factual lines. "Ube ice cream appears 4x in last 3 months." "Dali in Mayapa is the typical drop spot." "Birthday March 11 — last year's gift was white roses."
- preferences: structured observations (lights_up_at, wary_of, favorite_places, typical_gifts, nudge). nudge is a SINGLE OBSERVATIONAL line that the End-of-Month Letter / Year Letter can quote — never an instruction.
- watch: things worth noticing on the next pass (open questions, possible upcoming events).

EXAMPLES:
{
  "summary": "Wife's spending shows a quiet love of ube and small ritual gifts; Dali in Mayapa is the go-to spot.",
  "facts": ["Ube ice cream appears 4× last 90d.", "White roses bought twice — once on her birthday.", "Dali Mayapa is the most frequent vendor.", "Avg Wife-tagged spend: ₱312."],
  "preferences": {
    "lights_up_at": "Ube, white roses, surprise carinderia meals",
    "favorite_places": "Dali Mayapa, the carinderia near the bus terminal",
    "typical_gifts": "Small floral gifts, ube ice cream pints",
    "nudge": "A small white-rose bouquet around her exam week tends to land."
  },
  "watch": ["Her midterms in October — usual ritual?", "Possible upcoming birthday — confirm March 11"]
}

Return JSON.`;

export async function consolidateWifePreferences(opts: { lookbackDays?: number } = {}): Promise<MemoryConsolidated | null> {
  if (!hasGemini()) return null;
  const user = await getAuthUser();
  if (!user) return null;
  const supabase = await createClient();
  const lookback = opts.lookbackDays ?? 180;
  const since = new Date(Date.now() - lookback * 86_400_000).toISOString().slice(0, 10);

  // Fetch the Wife category id, then every spend tagged Wife in the window.
  const [{ data: categories }, { data: wifeRow }] = await Promise.all([
    supabase.from("spend_categories").select("*").eq("user_id", user.id),
    supabase.from("wife_state").select("*").eq("user_id", user.id).maybeSingle(),
  ]);
  const wifeCat = ((categories ?? []) as SpendCategory[]).find((c) => /wife/i.test(c.name));
  if (!wifeCat) return null;
  const wife = (wifeRow ?? null) as WifeState | null;
  const prior = wife?.preferences_consolidated ?? {};

  const [{ data: links }, { data: spends }] = await Promise.all([
    supabase.from("spend_category_links").select("*").eq("category_id", wifeCat.id),
    supabase
      .from("spends")
      .select("id,description,notes,amount_base,spent_at,for_us")
      .eq("user_id", user.id)
      .gte("spent_at", since),
  ]);
  const linkIds = new Set(((links ?? []) as SpendCategoryLink[]).map((l) => l.spend_id));
  const wifeSpends = ((spends ?? []) as Pick<Spend, "id" | "description" | "notes" | "amount_base" | "spent_at" | "for_us">[]).filter((s) => linkIds.has(s.id));
  if (wifeSpends.length < 3) return null;

  // Also fetch item names linked to those spends — surfaces the "ube ice cream"
  // signal that wouldn't show in the description alone.
  const { data: items } = await supabase
    .from("spend_items")
    .select("spend_id,name,amount,notes")
    .in("spend_id", wifeSpends.map((s) => s.id));
  const itemsBySpend = new Map<string, Array<{ name: string; amount: number | null; notes: string | null }>>();
  for (const it of (items ?? []) as Array<{ spend_id: string; name: string; amount: number | null; notes: string | null }>) {
    const arr = itemsBySpend.get(it.spend_id) ?? [];
    arr.push({ name: it.name, amount: it.amount ?? null, notes: it.notes ?? null });
    itemsBySpend.set(it.spend_id, arr);
  }

  const lines = wifeSpends
    .sort((a, b) => b.spent_at.localeCompare(a.spent_at))
    .slice(0, 60)
    .map((sp) => {
      const its = (itemsBySpend.get(sp.id) ?? []).map((i) => `${i.name}${i.amount ? ` ₱${i.amount.toFixed(0)}` : ""}${i.notes ? ` [${i.notes}]` : ""}`).join("; ");
      return `- ${sp.spent_at} ₱${Number(sp.amount_base ?? 0).toFixed(0)}${sp.for_us ? " (FOR US)" : ""}: ${sp.description ?? "(no description)"}${sp.notes ? ` — ${sp.notes}` : ""}${its ? ` :: items: ${its}` : ""}`;
    })
    .join("\n");
  const priorJson = prior && Object.keys(prior).length ? JSON.stringify(prior).slice(0, 1500) : "(none)";

  try {
    const res = await gemini().models.generateContent({
      model: HEAVY_MODEL,
      contents: `Wife-tagged spends last ${lookback} days:\n${lines}\n\nPRIOR CONSOLIDATED:\n${priorJson}\n\nReturn JSON.`,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        temperature: 0.45,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
      },
    });
    const parsed = JSON.parse((res.text ?? "{}").trim()) as MemoryConsolidated;
    const consolidated: MemoryConsolidated = {
      ...parsed,
      updated_at: new Date().toISOString(),
      entry_count: wifeSpends.length,
    };
    await supabase
      .from("wife_state")
      .upsert(
        {
          user_id: user.id,
          preferences_consolidated: consolidated,
          preferences_consolidated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
    return consolidated;
  } catch {
    return null;
  }
}

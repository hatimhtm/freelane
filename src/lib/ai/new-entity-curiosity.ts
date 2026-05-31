import "server-only";
import { Type } from "@google/genai";
import { gemini, hasGemini } from "./gemini";
import { HEAVY_MODEL } from "./models";
import { getAuthUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { queueAiQuestion } from "./ai-questions";
import { matchEntitiesInDescription, normalizeEntityText } from "@/lib/entity-resolution";
import type {
  Entity,
  Spend,
} from "@/lib/supabase/types";

// New Entity Curiosity (#1) — when the AI sees a spend description that
// references a noun-like entity it doesn't know about (e.g. "cat treats"
// with no "Our cats" entity), it queues a curiosity question rather than
// silently letting the spend pass.
//
// This is paired with First-Visit Curiosity Pulse (#37): the first
// curiosity sweep after creation asks the main questions ("how many cats?",
// "are they indoor?") and accepts vague answers per Vague Entity Support (H).

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    candidates: {
      type: Type.ARRAY,
      maxItems: 4,
      items: {
        type: Type.OBJECT,
        properties: {
          phrase: { type: Type.STRING },
          kind: { type: Type.STRING, enum: ["person", "pet", "place", "concept", "habit", "ritual"] },
          confidence: { type: Type.NUMBER },
          question: { type: Type.STRING },
          chips: {
            type: Type.ARRAY,
            maxItems: 4,
            items: { type: Type.STRING },
          },
        },
        required: ["phrase", "kind", "confidence", "question"],
        propertyOrdering: ["phrase", "kind", "confidence", "question", "chips"],
      },
    },
  },
  required: ["candidates"],
};

const SYSTEM_PROMPT = `You are the New Entity Curiosity layer for a SOLO freelancer in San Pablo, Philippines. Income unstable, base currency PHP.

You receive recent spend descriptions + notes from the last 14 days. Find references to ENTITIES the user has NOT yet captured (people, pets, places, concepts, habits, rituals). For each meaningful unknown, write ONE curiosity question.

GOOD CANDIDATES:
- A spend "cat treats ₱180" with no "Our cats" entity → ask about the cats.
- A spend "gift for Lola" with no "Lola" entity → ask who Lola is.
- A spend "carinderia near the bus terminal" → vague place; offer to track it.

NOT CANDIDATES:
- Generic groceries, transport, rent — these are categories, not entities.
- Known entities the user already has.
- Vendors (those go through the vendor pipeline).
- Anything that smells like a one-time mention with no follow-up value.

HARD RULES (NON-NEGOTIABLE):
- Each question 8-18 words. Curious, warm, NEVER preachy.
- FORBIDDEN PHRASES: "should", "consider", "save", "budget", "tell me about" (replace with specific anchored question).
- Chips: 3-4 short, valid answers. Vague answers always allowed ("don't know yet", "it's complicated").
- Confidence: 0-1. 0.8+ = obvious, 0.5 = worth asking, < 0.4 = drop.

EXAMPLES:
{
  "phrase": "cat treats",
  "kind": "pet",
  "confidence": 0.9,
  "question": "You bought cat treats — how many cats live with you, and how old?",
  "chips": ["1 cat", "2 cats", "3+ cats", "don't know yet"]
}
{
  "phrase": "carinderia near terminal",
  "kind": "place",
  "confidence": 0.6,
  "question": "That carinderia near the terminal — should I track it as a regular vendor?",
  "chips": ["yes, track it", "no", "it's just a one-off"]
}

Return JSON: { "candidates": [...] }`;

interface SnapshotItem {
  description: string;
  notes: string | null;
  amountBase: number;
  spentAt: string;
}

// Scan recent spends, dedupe by phrase, queue AI questions for the candidates
// that survive the model's filter. Returns the number of questions queued.
export async function runNewEntityCuriosity(opts: { lookbackDays?: number } = {}): Promise<{
  queued: number;
}> {
  const user = await getAuthUser();
  if (!user) return { queued: 0 };
  const supabase = await createClient();

  const lookback = opts.lookbackDays ?? 14;
  const since = new Date(Date.now() - lookback * 86_400_000).toISOString().slice(0, 10);

  const [{ data: spendsData }, { data: entitiesData }, { data: openQs }] = await Promise.all([
    supabase
      .from("spends")
      .select("id,description,notes,amount_base,spent_at")
      .eq("user_id", user.id)
      .gte("spent_at", since)
      .order("spent_at", { ascending: false })
      .limit(60),
    supabase.from("entities").select("*").eq("user_id", user.id).eq("archived", false),
    supabase
      .from("ai_questions")
      .select("question,kind,context")
      .eq("user_id", user.id)
      .is("answered_at", null)
      .is("dismissed_at", null)
      .eq("kind", "memory_gap"),
  ]);

  const spends = (spendsData ?? []) as Pick<Spend, "id" | "description" | "notes" | "amount_base" | "spent_at">[];
  const entities = (entitiesData ?? []) as Entity[];
  const knownTexts = entities.flatMap((e) => [e.canonical_name, ...(e.aliases ?? [])]);

  // Filter spends where a description hints at an unmatched noun.
  const items: SnapshotItem[] = [];
  for (const sp of spends) {
    if (!sp.description?.trim()) continue;
    const matched = matchEntitiesInDescription(sp.description, entities);
    if (matched.length > 0) continue;
    items.push({
      description: sp.description,
      notes: sp.notes,
      amountBase: Number(sp.amount_base ?? 0),
      spentAt: sp.spent_at,
    });
  }
  if (items.length === 0 || !hasGemini()) return { queued: 0 };

  // De-dup by normalized description before sending to Gemini — saves tokens
  // and avoids re-asking the same thing across multiple spends.
  const dedupKeys = new Set<string>();
  const dedupedItems: SnapshotItem[] = [];
  for (const it of items) {
    const k = normalizeEntityText(it.description);
    if (dedupKeys.has(k)) continue;
    dedupKeys.add(k);
    dedupedItems.push(it);
  }
  const sample = dedupedItems.slice(0, 15);
  const snapshot = sample
    .map((it) => `- "${it.description}"${it.notes ? ` (${it.notes})` : ""} · ${it.spentAt} · ₱${it.amountBase.toFixed(0)}`)
    .join("\n");
  const known = knownTexts.slice(0, 40).join(", ") || "(none yet)";

  try {
    const res = await gemini().models.generateContent({
      model: HEAVY_MODEL,
      contents: `Recent unmatched spend descriptions:\n${snapshot}\n\nKnown entities: ${known}\n\nReturn JSON.`,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        temperature: 0.5,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
      },
    });
    const parsed = JSON.parse((res.text ?? "{}").trim()) as {
      candidates?: Array<{ phrase?: string; kind?: string; confidence?: number; question?: string; chips?: string[] }>;
    };
    const candidates = (parsed.candidates ?? []).filter((c) => c.phrase && c.question && (c.confidence ?? 0) >= 0.4);

    // Skip candidates whose question is already in the open queue (dedupe).
    const askedQuestions = new Set(((openQs ?? []) as Array<{ question: string }>).map((q) => q.question.toLowerCase().trim()));
    let queued = 0;
    for (const cand of candidates) {
      const q = cand.question!.trim();
      if (askedQuestions.has(q.toLowerCase())) continue;
      await queueAiQuestion({
        question: q,
        kind: "memory_gap",
        context: { phrase: cand.phrase, kind: cand.kind, confidence: cand.confidence },
        options: cand.chips ?? [],
        priority: cand.confidence && cand.confidence > 0.75 ? 3 : 5,
      });
      askedQuestions.add(q.toLowerCase());
      queued++;
    }
    return { queued };
  } catch {
    return { queued: 0 };
  }
}

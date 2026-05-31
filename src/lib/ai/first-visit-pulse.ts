import "server-only";
import { Type } from "@google/genai";
import { gemini, hasGemini } from "./gemini";
import { HEAVY_MODEL } from "./models";
import { getAuthUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { queueAiQuestion } from "./ai-questions";
import type { Entity, Vendor } from "@/lib/supabase/types";

// First-Visit Curiosity Pulse (#37) — fires ONCE when an entity (or vendor)
// is newly seen for the first time. Asks the MAIN questions immediately
// instead of waiting for the curiosity sweep to circle back.
//
// Hatim 2026-06-01: "ask main questions immediately but accepts vague
// answers". Paired with Vague Entity Support (H). The question chips always
// include "don't know yet" and "it's complicated".

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    questions: {
      type: Type.ARRAY,
      maxItems: 3,
      items: {
        type: Type.OBJECT,
        properties: {
          question: { type: Type.STRING },
          chips: {
            type: Type.ARRAY,
            maxItems: 4,
            items: { type: Type.STRING },
          },
        },
        required: ["question"],
        propertyOrdering: ["question", "chips"],
      },
    },
  },
  required: ["questions"],
};

const SYSTEM_PROMPT = `You write the FIRST-VISIT curiosity questions for a new entity in the Freelane life-OS for Hatim — a SOLO freelancer in San Pablo, Philippines.

You receive ONE entity that was just created (kind + canonical name + short description). Write the 1-3 most useful curiosity questions to anchor it in memory.

HARD RULES:
- Questions are CURIOUS, never demanding. "How many cats live with you?" not "List your cats."
- ALWAYS include "don't know yet" or "it's complicated" as an answer chip — vague answers are valid.
- 8-18 words per question.
- FORBIDDEN: "should", "consider", "save", "budget", advice framing.
- If kind = "person": ask relationship + frequency of contact.
- If kind = "pet": count + age + indoor/outdoor.
- If kind = "place": where (area / landmark) + how often.
- If kind = "household": who shares it + biggest shared expense.
- If kind = "concept" / "habit" / "ritual": what triggers it + frequency.

EXAMPLES:
Pet "Our cats":
  Q1: "How many cats live with you, and roughly how old are they?"  chips: ["1 cat", "2 cats", "3+", "don't know yet"]
  Q2: "Indoor or outdoor?"                                          chips: ["indoor", "outdoor", "both", "it's complicated"]

Place "Carinderia near terminal":
  Q1: "Where exactly is that carinderia — which terminal, which barangay?" chips: ["bus terminal", "jeepney terminal", "don't know yet"]

Return JSON: { "questions": [{ "question": "...", "chips": [...] }, ...] }`;

interface FirstVisitInput {
  kind: "entity" | "vendor";
  name: string;
  description: string | null;
  entityKind?: string;
}

export async function pulseFirstVisit(input: FirstVisitInput): Promise<{ queued: number }> {
  if (!hasGemini()) return { queued: 0 };
  const user = await getAuthUser();
  if (!user) return { queued: 0 };

  const context = `kind=${input.kind}\nname="${input.name}"\nentityKind=${input.entityKind ?? "(n/a)"}\ndescription=${input.description ?? "(none)"}`;
  try {
    const res = await gemini().models.generateContent({
      model: HEAVY_MODEL,
      contents: `Just-created entity for first-visit pulse:\n\n${context}\n\nReturn JSON.`,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        temperature: 0.4,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
      },
    });
    const parsed = JSON.parse((res.text ?? "{}").trim()) as {
      questions?: Array<{ question?: string; chips?: string[] }>;
    };
    const qs = (parsed.questions ?? []).filter((q) => q.question);
    let queued = 0;
    for (const q of qs) {
      // Ensure vague chips are always present.
      const chips = ensureVagueChips(q.chips ?? []);
      await queueAiQuestion({
        question: q.question!.trim(),
        kind: input.kind === "vendor" ? "clarify_client" : "memory_gap",
        context: { firstVisit: true, target: input.name, entityKind: input.entityKind ?? null },
        options: chips,
        priority: 4,
      });
      queued++;
    }
    return { queued };
  } catch {
    return { queued: 0 };
  }
}

function ensureVagueChips(chips: string[]): string[] {
  const lower = chips.map((c) => c.toLowerCase());
  const out = [...chips];
  if (!lower.some((c) => c.includes("don't know") || c.includes("dont know") || c.includes("not sure"))) {
    out.push("don't know yet");
  }
  if (!lower.some((c) => c.includes("complicated"))) {
    out.push("it's complicated");
  }
  return out.slice(0, 4);
}

// Convenience wrapper for entity creation.
export async function pulseEntityFirstVisit(e: Entity): Promise<void> {
  if (e.vague) {
    // Vague entities get a single question instead of three — Hatim said
    // vague answers are valid, no pressure.
    await queueAiQuestion({
      question: `You just added "${e.canonical_name}" as a vague entity. Want to give it a real name now, or leave it fuzzy?`,
      kind: "memory_gap",
      context: { vagueEntity: true, entityId: e.id },
      options: ["give it a real name", "leave it fuzzy", "delete it"],
      priority: 5,
    });
    return;
  }
  await pulseFirstVisit({
    kind: "entity",
    name: e.canonical_name,
    description: e.short_description,
    entityKind: e.kind,
  });
}

export async function pulseVendorFirstVisit(v: Vendor): Promise<void> {
  await pulseFirstVisit({
    kind: "vendor",
    name: v.canonical_name,
    description: v.short_description ?? null,
  });
}

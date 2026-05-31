import "server-only";
import { Type } from "@google/genai";
import { gemini, hasGemini } from "./gemini";
import { HEAVY_MODEL } from "./models";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { logEvent } from "@/lib/data/events";
import { phtToday } from "@/lib/utils";
import type { LifeShiftKind } from "@/lib/supabase/types";

// Life Shifts (#14 — What Changed). Auto-logged from mutations OR manually
// entered from /letters → What Changed tab. One paragraph + date + source.
//
// This brain writes the paragraph when the caller doesn't already have one.
// Same observational voice as letters and quiet receipts.

const SYSTEM_PROMPT = `You write the "What Changed" paragraph for Hatim's life-shifts log.

A life shift is a structural change, not a single transaction. Rent moved. Recurring rule paused. New currency entered. Wallet added. Loan closed. Plan committed.

You receive: kind, before/after values, source pointer. Write 25-50 words of paragraph that NAMES the change without judging it.

HARD RULES (NON-NEGOTIABLE):
- FORBIDDEN PHRASES: "you should", "consider", "save", "budget", "make sure to", "try to", "remember to", "well done", "congratulations".
- Voice: dry, observational. Cite REAL values from the snapshot.
- Don't speculate on the reason for the change unless the snapshot supplies it.
- Use PHT date format YYYY-MM-DD when citing dates.

GOOD EXAMPLES:
- "Rent shifted from ₱3,500 to ₱4,200 on 2026-08-15 — recurring rule updated, anchor date held."
- "Gym recurring rule paused on 2026-09-02. Last paid ₱800 on August 12."
- "KRW enters as a currency on 2026-10-04 — a Korean client paid through Wise, ₱22,400 landed."

Return JSON: { "narrative": "<paragraph>" }`;

const SCHEMA = {
  type: Type.OBJECT,
  properties: { narrative: { type: Type.STRING } },
  required: ["narrative"],
};

export interface RecordLifeShiftArgs {
  kind: LifeShiftKind;
  label: string;
  beforeValue?: string | null;
  afterValue?: string | null;
  sourceEntityType?: string;
  sourceEntityId?: string;
  context?: Record<string, unknown>;
  occurredAt?: string;
  narrative?: string;
}

export async function recordLifeShift(args: RecordLifeShiftArgs): Promise<{ id: string } | null> {
  const user = await getAuthUser();
  if (!user) return null;
  const supabase = await createClient();

  let narrative = args.narrative ?? "";
  if (!narrative && hasGemini()) {
    try {
      const snapshot = `kind=${args.kind}\nlabel="${args.label}"\nbefore=${args.beforeValue ?? "(n/a)"}\nafter=${args.afterValue ?? "(n/a)"}\noccurred=${args.occurredAt ?? phtToday()}\ncontext=${JSON.stringify(args.context ?? {}).slice(0, 600)}`;
      const res = await gemini().models.generateContent({
        model: HEAVY_MODEL,
        contents: `Life shift snapshot:\n${snapshot}\n\nReturn JSON.`,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          temperature: 0.45,
          responseMimeType: "application/json",
          responseSchema: SCHEMA,
        },
      });
      const parsed = JSON.parse((res.text ?? "{}").trim()) as { narrative?: string };
      if (parsed.narrative?.trim()) narrative = parsed.narrative.trim();
    } catch {
      // fall through
    }
  }
  if (!narrative) narrative = args.label;

  const { data, error } = await supabase
    .from("life_shifts")
    .insert({
      user_id: user.id,
      kind: args.kind,
      label: args.label,
      before_value: args.beforeValue ?? null,
      after_value: args.afterValue ?? null,
      source_entity_type: args.sourceEntityType ?? null,
      source_entity_id: args.sourceEntityId ?? null,
      narrative,
      context: args.context ?? {},
      occurred_at: args.occurredAt ?? phtToday(),
    })
    .select("id")
    .single();
  if (error || !data) return null;

  await logEvent({
    userId: user.id,
    kind: "life_shift.recorded",
    title: `What changed · ${args.label.slice(0, 80)}`,
    entityType: "life_shift",
    entityId: (data as { id: string }).id,
    metadata: { kind: args.kind },
  });

  return { id: (data as { id: string }).id };
}

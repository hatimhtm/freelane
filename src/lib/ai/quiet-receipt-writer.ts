import "server-only";
import { Type } from "@google/genai";
import { gemini, hasGemini } from "./gemini";
import { HEAVY_MODEL } from "./models";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { logEvent } from "@/lib/data/events";
import { phtToday } from "@/lib/utils";
import type { QuietReceiptKind } from "@/lib/supabase/types";

// Quiet Receipts (#13) — write a one-line receipt for small good things.
//
// Callers invoke recordQuietReceipt({ kind, narrative? }) from any server
// action that just witnessed a "small good thing" (a loan moved to closed,
// a recurring rule got paused, a Sadaka was logged, a plan was committed).
//
// If no narrative is provided, this brain writes one. AI line is
// observational — never congratulatory.

const SYSTEM_PROMPT = `You write a ONE-LINE quiet receipt for a "small good thing" that just happened in Hatim's Freelane ledger.

HARD RULES (NON-NEGOTIABLE):
- 10-22 words.
- FORBIDDEN PHRASES: "well done", "great job", "congratulations", "keep it up", "amazing", "achievement", "you should", "consider", "save", "budget", "remember to".
- Voice: dry, observational. Mirror, never cheer.
- Cite the REAL number / name from the snapshot.
- Acceptable shapes:
  - "Tito's loan closed — ₱8,500 settled across 4 installments since March."
  - "Wifi rule paused — last paid April 12 at ₱700."
  - "Sadaka of ₱150 logged to a stranger at Robinsons."

Return JSON: { "narrative": "<sentence>" }`;

const SCHEMA = {
  type: Type.OBJECT,
  properties: { narrative: { type: Type.STRING } },
  required: ["narrative"],
};

export interface RecordQuietReceiptArgs {
  kind: QuietReceiptKind;
  sourceEntityType?: string;
  sourceEntityId?: string;
  context?: Record<string, unknown>;
  occurredAt?: string;
  narrative?: string;
  snapshot?: string;
}

export async function recordQuietReceipt(args: RecordQuietReceiptArgs): Promise<{ id: string } | null> {
  const user = await getAuthUser();
  if (!user) return null;
  const supabase = await createClient();

  let narrative = args.narrative ?? "";
  if (!narrative && hasGemini()) {
    try {
      const snapshot = args.snapshot ?? `kind=${args.kind}\ncontext=${JSON.stringify(args.context ?? {}).slice(0, 600)}`;
      const res = await gemini().models.generateContent({
        model: HEAVY_MODEL,
        contents: `Quiet receipt snapshot:\n${snapshot}\n\nReturn JSON.`,
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
      // Fall through.
    }
  }
  if (!narrative) {
    narrative = `${args.kind.replace(/_/g, " ")}`;
  }

  const { data, error } = await supabase
    .from("quiet_receipts")
    .insert({
      user_id: user.id,
      kind: args.kind,
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
    kind: "quiet_receipt.recorded",
    title: `Receipt · ${narrative.slice(0, 64)}`,
    entityType: "quiet_receipt",
    entityId: (data as { id: string }).id,
    metadata: { kind: args.kind },
  });

  return { id: (data as { id: string }).id };
}

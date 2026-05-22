import "server-only";
import { Type } from "@google/genai";
import { gemini, MODEL, hasGemini } from "./gemini";
import { createClient } from "@/lib/supabase/server";
import type { ClientMemoryConsolidated } from "@/lib/supabase/types";

const SYSTEM = `You maintain a living memory document about a single freelance client, for a solo freelancer's money-tracking app.

You receive: the client's name, a short description, the CURRENT consolidated memory (JSON), and any NEW raw notes the user just wrote. Merge them into one updated memory.

RULES:
- Keep it factual and concise. No flattery, no filler.
- "summary": 1-2 sentences capturing who this client is and how they pay.
- "facts": durable truths (payment cadence, preferred currency/method, rate, timezone). Dedupe; merge updates (newer overrides older).
- "watch": current risks or things to keep an eye on (late payments, disputes). Drop items once they're resolved by a newer note.
- "preferences": small key/value pairs (language, tone) when known.
- Never invent details not present in the notes or prior memory.
- If a new note contradicts an old fact, trust the newer note.`;

const SCHEMA = {
  type: Type.OBJECT,
  properties: {
    summary: { type: Type.STRING },
    facts: { type: Type.ARRAY, items: { type: Type.STRING } },
    watch: { type: Type.ARRAY, items: { type: Type.STRING } },
    preferences: {
      type: Type.OBJECT,
      properties: {
        language: { type: Type.STRING },
        tone: { type: Type.STRING },
      },
    },
  },
  required: ["summary", "facts", "watch"],
  propertyOrdering: ["summary", "facts", "watch", "preferences"],
};

// Folds every unconsolidated note into the client's living memory doc. Called
// after a note is added. Best-effort: if Gemini isn't configured or errors, the
// raw notes still stand on their own in the UI.
export async function consolidateClientMemory(clientId: string): Promise<void> {
  if (!hasGemini()) return;
  const supabase = await createClient();

  const [{ data: client }, { data: entries }] = await Promise.all([
    supabase.from("clients").select("name,short_description,memory_consolidated").eq("id", clientId).maybeSingle(),
    supabase.from("client_memory_entries").select("id,content,created_at").eq("client_id", clientId).order("created_at"),
  ]);
  if (!client || !entries?.length) return;

  const prior = (client.memory_consolidated ?? {}) as ClientMemoryConsolidated;
  const prompt = `Client: ${client.name}${client.short_description ? ` — ${client.short_description}` : ""}

CURRENT MEMORY (JSON):
${JSON.stringify({ summary: prior.summary ?? "", facts: prior.facts ?? [], watch: prior.watch ?? [], preferences: prior.preferences ?? {} }, null, 2)}

ALL NOTES (oldest first):
${entries.map((e) => `- (${String(e.created_at).slice(0, 10)}) ${e.content}`).join("\n")}

Return the updated memory as JSON.`;

  try {
    const res = await gemini().models.generateContent({
      model: MODEL,
      contents: prompt,
      config: {
        systemInstruction: SYSTEM,
        temperature: 0.2,
        responseMimeType: "application/json",
        responseSchema: SCHEMA,
      },
    });
    const parsed = JSON.parse((res.text ?? "{}").trim());
    const consolidated: ClientMemoryConsolidated = {
      summary: parsed.summary,
      facts: parsed.facts ?? [],
      watch: parsed.watch ?? [],
      preferences: parsed.preferences ?? {},
      updated_at: new Date().toISOString(),
      entry_count: entries.length,
    };
    await supabase.from("clients").update({ memory_consolidated: consolidated }).eq("id", clientId);
    await supabase
      .from("client_memory_entries")
      .update({ consolidated_at: new Date().toISOString() })
      .eq("client_id", clientId)
      .is("consolidated_at", null);
  } catch {
    // Leave raw notes as-is; consolidation can retry on the next note.
  }
}

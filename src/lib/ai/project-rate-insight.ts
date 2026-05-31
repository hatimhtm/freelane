import "server-only";
import { Type } from "@google/genai";
import { gemini, hasGemini } from "./gemini";
import { HEAVY_MODEL } from "./models";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { logEvent } from "@/lib/data/events";
import type {
  Client,
  ClientMemoryEntry,
  Payment,
  Project,
  RateInsight,
  RateInsightKind,
} from "@/lib/supabase/types";

// Project-Note Rate Insight (E — replaces #16) — Hatim 2026-06-01: "AI
// reads project notes for friction. Surfaces calm note + free-text box.
// Reply feeds rate reasoning."
//
// Brain pipeline:
//   1. Per client, gather the last 6 projects + their notes + client_memory
//   2. Send to Gemini: "find friction signals + propose ONE calm observation
//      OR return null"
//   3. Persist as rate_insights row tied to (user, client, optional project)
//   4. Hatim's reply (via the action) updates the row; the corpus persists.

const DAY_MS = 86_400_000;
const PROJECT_WINDOW_DAYS = 365;
const PROJECT_LIMIT = 6;

const VOICE_FLOOR = `You read Hatim's project + client notes for FRICTION SIGNALS. He's a solo freelancer in San Pablo, PHT. Income unstable.

FORBIDDEN PHRASES: "you should", "consider", "try to", "remember", "make sure", "raise your rate by X%", "you deserve more", "well done", "amazing", "salary", "monthly paycheck", "as your assistant".

Voice: dry, observational. NEVER preachy. NEVER cheerleading. The user reads and decides.`;

const SYSTEM_PROMPT = `${VOICE_FLOOR}

You receive Hatim's last 6 projects + their notes + the client's memory entries for ONE client. Find ONE friction signal — scope creep, revision burden, communication lag, rate lag, time spent unaccounted, etc. — and write a CALM observation that NAMES the pattern without advising.

HARD RULES:
- 25-55 words.
- Cite REAL project names + REAL counts ("4 of the last 6 projects mention scope creep").
- DON'T propose a percentage. If a suggested rate is appropriate, the field is for HATIM to fill — leave suggested_rate null.
- DON'T claim to know the cause. Just NAME the pattern.
- Pick the strongest single signal. If none meaningfully crosses, return { "no_signal": true } and SKIP everything else.

OUTPUT JSON SHAPE:
{
  "no_signal": false,
  "kind": "scope_creep" | "revision_burden" | "communication_lag" | "rate_lag" | "underpriced_relative_to_market" | "overpriced_relative_to_outcomes" | "time_spent_unaccounted" | "general",
  "observation": "<paragraph>",
  "context": { "evidence": [<short pointers>], "client_id": "<uuid>" }
}

Or { "no_signal": true } if nothing meaningful.

Return JSON.`;

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    no_signal: { type: Type.BOOLEAN },
    kind: { type: Type.STRING },
    observation: { type: Type.STRING },
    context: { type: Type.OBJECT, properties: {} },
  },
  required: ["no_signal"],
};

export interface RateInsightSweepResult {
  generated: number;
  insights: RateInsight[];
}

export async function runRateInsightSweep(): Promise<RateInsightSweepResult> {
  const user = await getAuthUser();
  if (!user) return { generated: 0, insights: [] };
  const supabase = await createClient();

  const [{ data: clients }, { data: projects }, { data: payments }, { data: memoryEntries }, { data: existing }] = await Promise.all([
    supabase.from("clients").select("*").eq("user_id", user.id).eq("archived", false),
    supabase.from("projects").select("*").eq("user_id", user.id),
    supabase.from("payments").select("*").eq("user_id", user.id),
    supabase.from("client_memory_entries").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(200),
    supabase.from("rate_insights").select("client_id,generated_at").eq("user_id", user.id),
  ]);

  const allClients = (clients ?? []) as Client[];
  const allProjects = (projects ?? []) as Project[];
  const allPayments = (payments ?? []) as Payment[];
  const allMemory = (memoryEntries ?? []) as ClientMemoryEntry[];
  const existingByClient = new Map<string, string>();
  for (const row of ((existing ?? []) as Array<{ client_id: string | null; generated_at: string }>)) {
    if (!row.client_id) continue;
    const prev = existingByClient.get(row.client_id);
    if (!prev || row.generated_at > prev) existingByClient.set(row.client_id, row.generated_at);
  }

  const now = Date.now();
  const out: RateInsight[] = [];

  for (const client of allClients) {
    const lastInsightAt = existingByClient.get(client.id);
    if (lastInsightAt) {
      const ageDays = (now - new Date(lastInsightAt).getTime()) / DAY_MS;
      if (ageDays < 30) continue;  // re-evaluate at most monthly per client
    }

    const clientProjects = allProjects
      .filter((p) => p.client_id === client.id)
      .filter((p) => {
        if (!p.updated_at) return false;
        const ageDays = (now - new Date(p.updated_at).getTime()) / DAY_MS;
        return ageDays <= PROJECT_WINDOW_DAYS;
      })
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .slice(0, PROJECT_LIMIT);

    if (clientProjects.length < 2) continue;  // need signal density

    const clientMemory = allMemory.filter((m) => m.client_id === client.id).slice(0, 10);

    if (!hasGemini()) continue;

    const projectLines = clientProjects
      .map((p) => `- ${p.title} (${p.status}, ${p.currency} ${p.amount}, due ${p.due_date ?? "n/a"}) notes: ${p.notes ? `"${p.notes.slice(0, 280)}"` : "(none)"}`)
      .join("\n");
    const memoryLines = clientMemory.map((m) => `- ${m.content.slice(0, 200)}`).join("\n");
    const clientPaymentCount = allPayments.filter((pay) =>
      clientProjects.some((proj) => proj.id === pay.project_id),
    ).length;
    const snapshot = `client_id=${client.id}
client_name="${client.name}"
short_description="${client.short_description ?? ""}"
default_currency=${client.default_currency ?? "(n/a)"}
projects_window=${PROJECT_WINDOW_DAYS}d
projects:
${projectLines}
memory_recent:
${memoryLines || "(none)"}
payments_recorded=${clientPaymentCount}`;

    try {
      const res = await gemini().models.generateContent({
        model: HEAVY_MODEL,
        contents: `Rate insight snapshot:\n${snapshot}\n\nReturn JSON.`,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          temperature: 0.4,
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
        },
      });
      const parsed = JSON.parse((res.text ?? "{}").trim()) as {
        no_signal?: boolean;
        kind?: string;
        observation?: string;
        context?: Record<string, unknown>;
      };
      if (parsed.no_signal || !parsed.observation?.trim()) continue;

      const { data: row, error } = await supabase
        .from("rate_insights")
        .insert({
          user_id: user.id,
          client_id: client.id,
          project_id: null,
          kind: (parsed.kind as RateInsightKind) ?? "general",
          observation: parsed.observation.trim(),
          context: { ...(parsed.context ?? {}), client_id: client.id },
        })
        .select("*")
        .single();
      if (error || !row) continue;
      out.push(row as RateInsight);
      await logEvent({
        userId: user.id,
        kind: "rate_insight.generated",
        title: `Rate insight · ${client.name}`,
        entityType: "rate_insight",
        entityId: (row as RateInsight).id,
        clientId: client.id,
        metadata: { kind: (row as RateInsight).kind },
      });
    } catch {
      // Skip on failure.
    }
  }

  return { generated: out.length, insights: out };
}

// Replying to a rate insight folds the reply into user_memory_entries so
// future "should I raise my rate" conversations carry the prior reasoning.
export async function replyToRateInsight(args: { rateInsightId: string; reply: string }): Promise<void> {
  const user = await getAuthUser();
  if (!user) return;
  const supabase = await createClient();
  const trimmed = args.reply.trim();
  if (!trimmed) throw new Error("Reply is empty.");
  const { data: insight, error } = await supabase
    .from("rate_insights")
    .update({ reply: trimmed, replied_at: new Date().toISOString() })
    .eq("id", args.rateInsightId)
    .eq("user_id", user.id)
    .select("client_id,observation,kind")
    .single();
  if (error || !insight) throw new Error("Rate insight not found.");
  const row = insight as { client_id: string | null; observation: string; kind: string };
  // Fold into user_memory.
  try {
    await supabase.from("user_memory_entries").insert({
      user_id: user.id,
      content: `Rate insight reply (${row.kind}${row.client_id ? `, client ${row.client_id}` : ""}) — Observation: "${row.observation.slice(0, 200)}" | Reply: ${trimmed}`,
      source: "user_note",
    });
  } catch {
    // Best-effort.
  }
  await logEvent({
    userId: user.id,
    kind: "rate_insight.replied",
    title: `Replied to rate insight`,
    entityType: "rate_insight",
    entityId: args.rateInsightId,
    clientId: row.client_id ?? null,
  });
}

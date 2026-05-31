import "server-only";
import { Type } from "@google/genai";
import { gemini, hasGemini } from "./gemini";
import { HEAVY_MODEL } from "./models";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { phtToday } from "@/lib/utils";
import { queueAiQuestion } from "./ai-questions";
import { logEvent } from "@/lib/data/events";
import type { Client, Payment, Project, QuietChannel } from "@/lib/supabase/types";

// Quiet-Channel Watcher (#18 modified) — Hatim 2026-06-01: "MUST USE the
// data to auto-write notes into client profiles."
//
// Detect: clients with ≥ 1 payment historically but no payment in the
// last 45 days (or 60-180 day cluster). Queue an AI question. When Hatim
// answers, the answer becomes a client_memory_entries row.

const DAY_MS = 86_400_000;
const SILENCE_FLOOR_DAYS = 45;
const SILENCE_HORIZON_DAYS = 180;

const QUESTION_SCHEMA = {
  type: Type.OBJECT,
  properties: { question: { type: Type.STRING } },
  required: ["question"],
};

const VOICE_FLOOR = `Voice: dry, observational, warm. Hatim is a solo freelancer in San Pablo, PHT. Income is unstable.

FORBIDDEN PHRASES: "you should", "consider", "try to", "make sure", "remember", "follow up", "reach out (use 'check in' if needed)", "salary", "monthly paycheck".`;

const QUESTION_PROMPT = `${VOICE_FLOOR}

A client has gone quiet. Ask Hatim ONE short, specific question to capture what's known. The answer will become a note on the client profile so the corpus can use it next time.

HARD RULES:
- 10-22 words, ending with a question mark.
- Reference the silence honestly with the count of days in the snapshot.
- DON'T propose actions. Just ASK what's known.

GOOD:
- "Sander hasn't paid in 67 days — do you know what's going on with him?"
- "Carla quiet for 92 days. Anything you've heard?"

Return JSON: { "question": "<question>" }`;

const MEMORY_PROMPT = `${VOICE_FLOOR}

Hatim answered a quiet-channel question. Convert the answer into a SHORT note (10-25 words) suitable to land on the client's profile. Quotes the user verbatim when useful; never editorializes.

HARD RULES:
- 10-25 words.
- Use Hatim's own framing. Don't add advice.

GOOD:
- "Hiring freeze on their side; he'll resume Q2 once budgets reopen."
- "Personal — wife had surgery. Said he'd be back end of the year."

Return JSON: { "note": "<sentence>" }`;

const MEMORY_SCHEMA = {
  type: Type.OBJECT,
  properties: { note: { type: Type.STRING } },
  required: ["note"],
};

interface SilenceDetection {
  client: Client;
  silenceDays: number;
  lastPaymentAt: string | null;
}

function detectSilence(clients: Client[], payments: Payment[], projects: Project[], now: Date): SilenceDetection[] {
  const projectsByClient = new Map<string, Project[]>();
  for (const p of projects) {
    const arr = projectsByClient.get(p.client_id) ?? [];
    arr.push(p);
    projectsByClient.set(p.client_id, arr);
  }
  const lastPaymentByClient = new Map<string, string>();
  for (const pay of payments) {
    const project = projects.find((p) => p.id === pay.project_id);
    if (!project) continue;
    const prev = lastPaymentByClient.get(project.client_id);
    if (!prev || pay.paid_at > prev) {
      lastPaymentByClient.set(project.client_id, pay.paid_at);
    }
  }
  const out: SilenceDetection[] = [];
  for (const client of clients) {
    if (client.archived) continue;
    const lastPaid = lastPaymentByClient.get(client.id);
    if (!lastPaid) continue;  // need historical payment to mean anything
    const daysSilent = Math.round((now.getTime() - new Date(lastPaid).getTime()) / DAY_MS);
    if (daysSilent < SILENCE_FLOOR_DAYS || daysSilent > SILENCE_HORIZON_DAYS) continue;
    out.push({ client, silenceDays: daysSilent, lastPaymentAt: lastPaid });
  }
  // Most-silent first.
  out.sort((a, b) => b.silenceDays - a.silenceDays);
  return out;
}

export async function runQuietChannelSweep(): Promise<{ detected: number }> {
  const user = await getAuthUser();
  if (!user) return { detected: 0 };
  const supabase = await createClient();
  const today = phtToday();
  const now = new Date(today);

  const [{ data: clients }, { data: payments }, { data: projects }, { data: existing }] = await Promise.all([
    supabase.from("clients").select("*").eq("user_id", user.id),
    supabase.from("payments").select("*").eq("user_id", user.id),
    supabase.from("projects").select("*").eq("user_id", user.id),
    supabase.from("quiet_channels").select("client_id").eq("user_id", user.id).is("resolved_at", null),
  ]);

  const existingOpen = new Set(((existing ?? []) as Array<{ client_id: string }>).map((q) => q.client_id));
  const detections = detectSilence(
    ((clients ?? []) as Client[]),
    ((payments ?? []) as Payment[]),
    ((projects ?? []) as Project[]),
    now,
  ).filter((d) => !existingOpen.has(d.client.id));

  let count = 0;
  for (const det of detections.slice(0, 4)) {
    // Generate the AI question (with deterministic fallback).
    let question = `${det.client.name} hasn't paid in ${det.silenceDays} days — anything you've heard?`;
    if (hasGemini()) {
      try {
        const snapshot = `client_name="${det.client.name}"\nsilence_days=${det.silenceDays}\nlast_payment_at=${det.lastPaymentAt}\nshort_description="${det.client.short_description ?? ""}"`;
        const res = await gemini().models.generateContent({
          model: HEAVY_MODEL,
          contents: `Quiet channel snapshot:\n${snapshot}\n\nReturn JSON.`,
          config: {
            systemInstruction: QUESTION_PROMPT,
            temperature: 0.55,
            responseMimeType: "application/json",
            responseSchema: QUESTION_SCHEMA,
          },
        });
        const parsed = JSON.parse((res.text ?? "{}").trim()) as { question?: string };
        if (parsed.question?.trim()) question = parsed.question.trim();
      } catch {
        // Use deterministic fallback.
      }
    }

    const aiQuestionRow = await queueAiQuestion({
      question,
      kind: "clarify_client",
      context: {
        client_id: det.client.id,
        client_name: det.client.name,
        silence_days: det.silenceDays,
        last_payment_at: det.lastPaymentAt,
      },
      sourceEntityType: "client",
      sourceEntityId: det.client.id,
      options: ["hiring freeze", "personal life", "moved on", "don't know"],
      priority: 3,
    });

    const { data: qcRow } = await supabase
      .from("quiet_channels")
      .insert({
        user_id: user.id,
        client_id: det.client.id,
        detected_at: today,
        silence_days: det.silenceDays,
        ai_question_id: aiQuestionRow?.id ?? null,
      })
      .select("id")
      .single();

    if (qcRow) {
      await logEvent({
        userId: user.id,
        kind: "quiet_channel.detected",
        title: `Quiet channel · ${det.client.name}`,
        entityType: "quiet_channel",
        entityId: (qcRow as { id: string }).id,
        clientId: det.client.id,
        metadata: { silence_days: det.silenceDays },
      });
      count += 1;
    }
  }

  return { detected: count };
}

export async function resolveQuietChannel(args: {
  quietChannelId: string;
  reply: string;
}): Promise<{ written_to_memory_entry_id: string | null } | null> {
  const user = await getAuthUser();
  if (!user) return null;
  const supabase = await createClient();
  const trimmed = args.reply.trim();
  if (!trimmed) throw new Error("Reply is empty.");

  // Fetch row + client info.
  const { data: qc } = await supabase
    .from("quiet_channels")
    .select("*")
    .eq("id", args.quietChannelId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!qc) throw new Error("Quiet channel not found.");
  const row = qc as QuietChannel;

  // Convert reply into a short client-memory note.
  let note = trimmed;
  if (hasGemini()) {
    try {
      const res = await gemini().models.generateContent({
        model: HEAVY_MODEL,
        contents: `Hatim's reply about the quiet client: "${trimmed.replace(/"/g, "'")}"\nReturn JSON.`,
        config: {
          systemInstruction: MEMORY_PROMPT,
          temperature: 0.4,
          responseMimeType: "application/json",
          responseSchema: MEMORY_SCHEMA,
        },
      });
      const parsed = JSON.parse((res.text ?? "{}").trim()) as { note?: string };
      if (parsed.note?.trim()) note = parsed.note.trim();
    } catch {
      // Use reply as-is.
    }
  }

  // Insert into client_memory_entries.
  const { data: memEntry } = await supabase
    .from("client_memory_entries")
    .insert({ user_id: user.id, client_id: row.client_id, content: note })
    .select("id")
    .single();

  // Mark the quiet_channel resolved.
  await supabase
    .from("quiet_channels")
    .update({
      resolved_at: new Date().toISOString(),
      reply: trimmed,
      written_to_memory_entry_id: (memEntry as { id: string } | null)?.id ?? null,
    })
    .eq("id", args.quietChannelId)
    .eq("user_id", user.id);

  // Mark the ai_question answered too (if any).
  if (row.ai_question_id) {
    try {
      const { answerAiQuestion } = await import("./ai-questions");
      await answerAiQuestion(row.ai_question_id, trimmed);
    } catch {
      // Best-effort.
    }
  }

  await logEvent({
    userId: user.id,
    kind: "quiet_channel.resolved",
    title: "Quiet channel resolved",
    entityType: "quiet_channel",
    entityId: args.quietChannelId,
    clientId: row.client_id,
  });

  return { written_to_memory_entry_id: (memEntry as { id: string } | null)?.id ?? null };
}

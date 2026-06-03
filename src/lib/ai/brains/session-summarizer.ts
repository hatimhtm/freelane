import "server-only";

import { Type } from "@google/genai";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { gemini, hasGemini, pickModel } from "../models";
import { scrubForbiddenPhrases } from "../voice-scrub";
import { safeRunLabeled, type ActionResult } from "@/lib/data/actions";

// Flash Lite end-of-session digester.
//
// Reads all chat_messages for the session (archived_at IS NULL), summarizes
// in ≤ 400 chars + extracts up to 8 short key_facts, writes a
// chat_session_summaries row, then marks the messages archived_at = now()
// so the next chat-answer turn reads digests instead of raw messages.
//
// Idempotent at the call boundary: a second call after the messages are
// already archived no-ops (the SELECT returns nothing → early return).

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    summary: { type: Type.STRING },
    key_facts: {
      type: Type.ARRAY,
      maxItems: 8,
      items: { type: Type.STRING },
    },
  },
  required: ["summary"],
} as const;

const SYSTEM_PROMPT = `You compress a chat session into a tiny digest. The user is a solo freelance dev in the Philippines; the chat is about their money.

Rules:
- summary ≤ 400 characters. One paragraph. No bullets.
- Plain, calm, short. NEVER use "you should", "consider", "save more", "stay positive", "well done", "great job", "amazing".
- Cite the topic + the conclusion (or "no conclusion reached") in the user's voice.
- key_facts: up to 8 SHORT factual claims that came out of the session — things the user revealed about themselves (e.g. "user prefers GCash for daily spending", "user is saving for a M3 Pro MacBook").
- When the session contains a SHOULD-I-BUY DECISIONS block, ALWAYS surface one summary line per decision: "asked about <item> · <verdict>". Keep the line inside the ≤ 400 char summary budget.
- If the session had < 2 user messages, return summary "(too short to summarize)" and empty key_facts.

Return ONLY the JSON.`;

export async function summarizeSession(
  sessionId: string,
): Promise<ActionResult<{ summary: string; messageCount: number } | null>> {
  return safeRunLabeled("freelane-chat", "summarize", async () => {
    const user = await getAuthUser();
    if (!user) throw new Error("Unauthenticated");
    const supabase = await createClient();

    const { data: messages } = await supabase
      .from("chat_messages")
      .select("id,role,content,page_key,page_context,created_at")
      .eq("user_id", user.id)
      .eq("session_id", sessionId)
      .is("archived_at", null)
      .order("created_at", { ascending: true });

    const rows = messages ?? [];
    if (rows.length < 2) return null;

    const pageKey = (rows[0] as { page_key: string }).page_key;
    const startedAt = (rows[0] as { created_at: string }).created_at;
    const endedAt = (rows[rows.length - 1] as { created_at: string }).created_at;

    // Detect should_i_buy decisions made during this session.
    // postChatMessage tags routed should_i_buy turns with
    // page_context.routed_intent='should_i_buy' and a
    // page_context.decision_result={item,verdict} on the assistant row.
    // We surface one bullet line per decision so the digest carries the
    // decision summary into the user's per-page history (freelane-
    // shouldibuy-design 2026-06-02).
    type RowShape = {
      role: string;
      content: string;
      page_context: Record<string, unknown> | null;
      created_at: string;
    };
    const decisionLines = (rows as RowShape[])
      .filter((m) => m.role === "assistant" && !!m.page_context)
      .map((m) => {
        const ctx = m.page_context as Record<string, unknown>;
        if (ctx.routed_intent !== "should_i_buy") return null;
        const decision = ctx.decision_result as
          | { item?: string; verdict?: string | null }
          | undefined;
        if (!decision || !decision.item) return null;
        const verdict =
          (decision.verdict as string | null | undefined) ?? "(no verdict)";
        return `asked about ${decision.item} · ${verdict}`;
      })
      .filter((line): line is string => !!line)
      .slice(0, 6);

    let summary = "(no summary)";
    if (hasGemini()) {
      try {
        const transcript = (rows as RowShape[])
          .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
          .join("\n\n");
        const decisionsBlock = decisionLines.length
          ? `\n\nSHOULD-I-BUY DECISIONS (surface one line per item in the summary):\n${decisionLines.map((d) => `- ${d}`).join("\n")}`
          : "";
        const res = await gemini().models.generateContent({
          model: pickModel("fast"),
          contents: `Transcript:\n\n${transcript}${decisionsBlock}\n\nReturn the JSON now.`,
          config: {
            systemInstruction: SYSTEM_PROMPT,
            temperature: 0.3,
            responseMimeType: "application/json",
            responseSchema: RESPONSE_SCHEMA,
          },
        });
        const parsed = JSON.parse((res.text ?? "{}").trim()) as {
          summary?: string;
          key_facts?: string[];
        };
        summary = scrubForbiddenPhrases(
          (parsed.summary ?? "").trim() || "(no summary)",
        );
      } catch {
        // Best-effort — fall through with a placeholder summary.
        summary = "(summary unavailable)";
      }
    }

    await supabase.from("chat_session_summaries").upsert(
      {
        user_id: user.id,
        session_id: sessionId,
        page_key: pageKey,
        summary,
        message_count: rows.length,
        started_at: startedAt,
        ended_at: endedAt,
      },
      { onConflict: "session_id" },
    );

    // Archive the messages so future chat-answer calls read digests.
    await supabase
      .from("chat_messages")
      .update({ archived_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .eq("session_id", sessionId)
      .is("archived_at", null);

    return { summary, messageCount: rows.length };
  });
}

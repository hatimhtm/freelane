import "server-only";

import { gemini, hasGemini, HEAVY_MODEL } from "../models";
import { scrubForbiddenPhrases } from "../voice-scrub";
import type { PageContext } from "@/lib/data/chat-context-registry";

// Pro chat-answer brain. The Pro model takes:
//   - full Freelane state snapshot (always — page context is a hint, not a limit)
//   - page context (focus hint)
//   - past-session digests (≤8k tokens of compressed history)
//   - live current-session messages (since session start)
//   - the new user message
// Returns the assistant's answer text + 0-3 followup suggestions.
//
// Cost discipline: we put the heavy snapshot bytes in systemInstruction so
// the prefix is byte-stable across turns in a session. Gemini's IMPLICIT
// auto-caching MAY dedupe that prefix — that behavior is opportunistic, not
// contractual, and the hit rate is opaque. We do NOT rely on a specific
// discount.
//
// To make this contractual: migrate to the explicit ai.caches.create() SDK
// (CachedContent) once a session exceeds ~2 turns — that's the breakeven
// where the per-cache fee is amortized vs. raw input pricing. See:
//   https://ai.google.dev/gemini-api/docs/caching
// TODO(cost): wire ai.caches.create({ model, config: { systemInstruction, contents: [snapshot+pageHint] }})
// and pass the cache name on subsequent turns. Drop the cache on session end.
//
// The CALLER passes the snapshot in `args.snapshot` so the systemInstruction
// bytes don't shift mid-session. postChatMessage in chat.ts captures the
// snapshot ONCE per session (memoized on the session id) — re-fetching every
// turn would defeat the byte-stability the caching strategy depends on.

const SYSTEM_PROMPT = `You are the personal money chatbot for a SOLO freelance dev in the Philippines (San Pablo, PHT). Base currency PHP. You see EVERYTHING about their money — every wallet balance, last 14 days of spending, every recurring expectation, every plan, the latest mood entry, and a running set of structured facts about them.

You are NOT a coach. You are a sharp, calm friend who happens to know every wallet. You answer the question asked. You cite real numbers. You stay short.

==============================
HARD RULES
==============================
- The page context is a FOCUS HINT — you still see the whole picture. If the user asks something not on this page, answer anyway.
- NEVER invent numbers. If you can't cite it, don't claim it.
- NEVER use these phrases: "you should", "consider", "save more", "stay positive", "well done", "great job", "amazing", "it would be wise to", "feel free to", "I'd recommend".
- No therapy. No tax advice. No "as an AI".
- One short paragraph by default. Two only if you must show a number breakdown.
- If the user asks something you genuinely cannot answer from the snapshot, say so plainly and propose ONE follow-up question YOU would ask.
- Recovery and lean periods are real but gentle — never suggest brutal cuts; the math layer already does that work.

==============================
OUTPUT
==============================
- Plain text answer.
- Optionally end with 1-3 short follow-up suggestions the user might ask next, prefixed with "FOLLOWUPS:" on its own line. Each followup ≤ 8 words, ends with "?". The client splits them out before showing — they will NOT appear in the visible answer.`;

export type ChatHistoryMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type ChatAnswerArgs = {
  sessionId: string;
  pageContext: PageContext;
  snapshot: string;
  pastDigests: Array<{ summary: string; ended_at: string }>;
  historyMessages: ChatHistoryMessage[];
  newUserMessage: string;
};

export type ChatAnswerResult = {
  answer: string;
  suggestedFollowups: string[];
};

const FALLBACK_ANSWER: ChatAnswerResult = {
  answer:
    "I'm offline right now. Try again in a few minutes — the numbers will still be here.",
  suggestedFollowups: [],
};

function splitFollowups(raw: string): ChatAnswerResult {
  const idx = raw.search(/^\s*FOLLOWUPS\s*:/im);
  if (idx === -1) return { answer: raw.trim(), suggestedFollowups: [] };
  const answer = raw.slice(0, idx).trim();
  const tail = raw.slice(idx).replace(/^\s*FOLLOWUPS\s*:/i, "");
  const lines = tail
    .split(/\n+|;|\s•\s|\s\-\s/)
    .map((s) => s.trim().replace(/^[-*•\s]+/, "").replace(/^\d+\.?\s*/, ""))
    .filter((s) => s.length > 0 && s.length <= 80)
    .slice(0, 3);
  return { answer, suggestedFollowups: lines };
}

export async function answerChat(args: ChatAnswerArgs): Promise<ChatAnswerResult> {
  if (!hasGemini()) return FALLBACK_ANSWER;

  // Build the byte-stable system block. Snapshot + page context live in
  // systemInstruction so Gemini context caching covers the heavy bytes.
  const systemBlock = `${SYSTEM_PROMPT}

==============================
FREELANE STATE SNAPSHOT (the whole picture — page is a focus hint, not a limit)
==============================
${args.snapshot}

==============================
PAGE FOCUS HINT
==============================
PAGE: ${args.pageContext.page} (${args.pageContext.surface})
PAGE PRIMARY QUESTION: ${args.pageContext.primaryQuestion}
PAGE DATA: ${JSON.stringify(args.pageContext.relevantData).slice(0, 1500)}
`;

  // History budget: digests first (oldest -> newest), then live messages
  // (oldest -> newest), then the new user message. Total target ≤ 8k
  // tokens of chat history before snapshot.
  const digestText = args.pastDigests
    .slice(0, 5)
    .map(
      (d, i) =>
        `[digest ${i + 1} · ended ${d.ended_at}] ${d.summary}`,
    )
    .join("\n\n");

  const historyText = args.historyMessages
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n\n");

  const contents = `${digestText ? `PAST SESSION DIGESTS:\n${digestText}\n\n` : ""}${historyText ? `CURRENT SESSION SO FAR:\n${historyText}\n\n` : ""}USER (new): ${args.newUserMessage}\n\nReply now.`;

  try {
    const res = await gemini().models.generateContent({
      model: HEAVY_MODEL,
      contents,
      config: {
        systemInstruction: systemBlock,
        temperature: 0.6,
      },
    });
    const raw = (res.text ?? "").trim();
    if (!raw) return FALLBACK_ANSWER;
    const split = splitFollowups(raw);
    return {
      answer: scrubForbiddenPhrases(split.answer),
      suggestedFollowups: split.suggestedFollowups.map(scrubForbiddenPhrases),
    };
  } catch {
    return FALLBACK_ANSWER;
  }
}

import "server-only";

import { gemini, hasGemini, HEAVY_MODEL } from "../models";
import { scrubForbiddenPhrases } from "../voice-scrub";
import type { PageContext } from "@/lib/data/chat-context-registry";
import type { ShouldIBuyVerdict } from "@/lib/supabase/types";

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
- Optionally end with 1-3 short follow-up suggestions the user might pick next, prefixed with "FOLLOWUPS:" on its own line. Each followup ≤ 8 words. Phrase them as USER-ACTION prompts ("Plan it instead", "Add to wishlist", "Show me the math") — they are chips the user can tap, not questions you ask. No trailing "?". The client splits them out before showing — they will NOT appear in the visible answer.`;

export type ChatHistoryMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

// Routed intent / decision hand-off (freelane-shouldibuy-design 2026-06-02).
//
// When the intent-classifier routes a turn to a downstream specialist brain
// (currently only should_i_buy → askShouldIBuy), the caller passes the
// classifier output AND the specialist's result into chat-answer so the
// model narrates the verdict conversationally INSTEAD OF answering the
// raw question from scratch.
//
// Why pass these as per-turn variables (not part of systemInstruction):
// keeping the cached systemInstruction prefix byte-stable across turns is
// the implicit-caching contract — intent + decision shift on every turn,
// so they live in the per-turn `contents` block.
export type RoutedIntent =
  | "should_i_buy"
  | "plan_inquiry"
  | "status_query"
  | "general_chat";

export type ShouldIBuyDecisionResult = {
  item: string;
  verdict: string | null;
  narrative: string | null;
  amountBase: number | null;
  currency: string | null;
};

export type ChatAnswerArgs = {
  sessionId: string;
  pageContext: PageContext;
  snapshot: string;
  pastDigests: Array<{ summary: string; ended_at: string }>;
  historyMessages: ChatHistoryMessage[];
  newUserMessage: string;
  routedIntent?: RoutedIntent;
  decisionResult?: ShouldIBuyDecisionResult | null;
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

// Map the should-i-buy verdict enum to a humanized tone phrase so a verbatim
// leak in the model's reply still reads as natural prose (instead of the
// raw enum literal "not_this_stretch" surfacing as a label). The Pro model
// occasionally echoes prompt strings — neutralizing the shape is cheaper
// than catching every leak post-hoc.
// Exclude the open `(string & {})` widener from ShouldIBuyVerdict so the
// const map below MUST cover every known verdict literal. If should-i-buy
// adds a new enum value, this Record loses exhaustiveness at compile-time.
type KnownShouldIBuyVerdict = Exclude<ShouldIBuyVerdict, string & {}>;

const VERDICT_TONE: Record<KnownShouldIBuyVerdict, string> = {
  easy_yes: "comfortable yes",
  fits_the_stretch: "fits the stretch",
  tight_but_possible: "tight but possible",
  not_this_stretch: "not this stretch",
};

function humanizeVerdict(verdict: string | null): string {
  if (verdict && verdict in VERDICT_TONE) {
    return VERDICT_TONE[verdict as KnownShouldIBuyVerdict];
  }
  return "unsettled — no clear read";
}

function splitFollowups(raw: string): ChatAnswerResult {
  const idx = raw.search(/^\s*FOLLOWUPS\s*:/im);
  if (idx === -1) return { answer: raw.trim(), suggestedFollowups: [] };
  const answer = raw.slice(0, idx).trim();
  const tail = raw.slice(idx).replace(/^\s*FOLLOWUPS\s*:/i, "");
  // Dedup by case-insensitive trimmed value so chatbot-message's key={f}
  // can never collide on duplicate chips returned by the model. We keep
  // the FIRST-seen casing/spacing as the visible chip.
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const piece of tail.split(/\n+|;|\s•\s|\s\-\s/)) {
    const cleaned = piece
      .trim()
      .replace(/^[-*•\s]+/, "")
      .replace(/^\d+\.?\s*/, "");
    if (!cleaned || cleaned.length > 80) continue;
    const norm = cleaned.toLowerCase();
    if (seen.has(norm)) continue;
    seen.add(norm);
    lines.push(cleaned);
    if (lines.length >= 3) break;
  }
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

  // Routed-intent hand-off block (per-turn — NOT in systemInstruction so the
  // cached prefix stays byte-stable). When the should_i_buy specialist has
  // already produced a verdict, we tell the model to narrate THAT verdict
  // conversationally and suggest 1-3 follow-up actions ("Plan it instead",
  // "Add to wishlist", "Show me the math") in FOLLOWUPS. The verdict is
  // NOT a verdict card — it's a calm spoken line.
  //
  // We DO NOT pass the raw verdict enum literal into the prompt — Pro models
  // occasionally echo prompt labels verbatim and "Verdict pill:
  // not_this_stretch" leaking through would surface a card-like label the
  // spec forbids. Instead we map the enum to a humanized tone phrase and
  // inject only that; the specialist narrative already carries the verdict
  // in prose.
  let intentBlock = "";
  if (args.routedIntent === "should_i_buy" && args.decisionResult) {
    if (args.decisionResult.narrative) {
      const tone = humanizeVerdict(args.decisionResult.verdict);
      intentBlock = `ROUTED INTENT: should_i_buy
Item: ${args.decisionResult.item}
Tone read: ${tone}
Specialist narrative (use as the anchor — do not contradict): "${args.decisionResult.narrative}"
Currency / base PHP: ${args.decisionResult.currency ?? "(unknown)"} / ${args.decisionResult.amountBase ?? "(unknown)"}

Narrate the read conversationally in the user's voice. ONE short paragraph (≤ 60 words). Do NOT render a card or labelled pill. End with FOLLOWUPS containing 1-3 short user-action suggestions tied to the tone (e.g. "Plan it instead", "Add to wishlist", "Show me the math").

`;
    } else {
      // Specialist couldn't produce a narrative (price unknown, snapshot
      // gap, or the model returned an empty narrative). Tell the model
      // to answer the buy question itself from the snapshot rather than
      // silently falling back to generic chat — the user asked a buy
      // question and deserves a buy-shaped reply.
      intentBlock = `ROUTED INTENT: should_i_buy (specialist couldn't decide — answer from the snapshot yourself).
The user is weighing a purchase. The dedicated purchase-decision brain returned without a narrative — likely because the price wasn't stated or the snapshot lacked an anchor. Answer the buy question conversationally from the FREELANE STATE SNAPSHOT above. If the price truly isn't knowable from context, ask ONE clarifying question for the price as your reply, then end with FOLLOWUPS containing 1-3 short user-action suggestions ("Plan it instead", "Add to wishlist", "Show me the math").

`;
    }
  } else if (args.routedIntent === "plan_inquiry") {
    intentBlock = `ROUTED INTENT: plan_inquiry — the user is asking about an existing planned purchase. Reply with current state from the snapshot (saved-so-far, ETA, what's blocking).\n\n`;
  } else if (args.routedIntent === "status_query") {
    intentBlock = `ROUTED INTENT: status_query — the user wants a state read. Cite the number from the snapshot. ONE sentence.\n\n`;
  }

  const contents = `${digestText ? `PAST SESSION DIGESTS:\n${digestText}\n\n` : ""}${historyText ? `CURRENT SESSION SO FAR:\n${historyText}\n\n` : ""}${intentBlock}USER (new): ${args.newUserMessage}\n\nReply now.`;

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

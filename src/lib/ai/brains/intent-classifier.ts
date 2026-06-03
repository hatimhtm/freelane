import "server-only";

import { Type } from "@google/genai";
import { gemini, hasGemini, pickModel } from "../models";
import { withBrainCache, fingerprintFromIds, scopedBrainKey } from "../cache";
import { BRAIN_KEYS } from "../cache-keys";
import { phtDateString } from "@/lib/utils";

// Flash Lite brain — routes every chatbot user message into a downstream
// pipeline:
//   - should_i_buy   → askShouldIBuy (Pro purchase-decision brain) →
//                      narrative chat-answer
//   - plan_inquiry   → chat-answer with plan_id_hint focus
//   - status_query   → chat-answer with topic focus
//   - general_chat   → chat-answer default
//
// Runs BEFORE chat-answer on every postChatMessage turn (excluding the
// vendor identify / clarify activeCard guards which are already deterministic
// intent dispatch).
//
// Why Flash Lite: classification is the canonical Flash-Lite shape — short
// input, tiny structured output, latency-bound. The HEAVY model would burn
// cost on a routing decision that doesn't need reasoning depth.
//
// Cache slot is scoped per (page_key, truncated message hash, PHT day) via
// scopedBrainKey(INTENT_CLASSIFIER, 'msg', `${page_key}:${hash}:${pht_day}`)
// so re-typing the same question on the same page on the same day is a
// guaranteed cache hit. EXEMPT from financial-mutation invalidation (see
// cache-keys.ts FINANCIAL_INVALIDATION_EXEMPT) — classification keys off
// the message text + page + day, not the user's money state.
//
// Confidence floor: postChatMessage falls through to default chat-answer
// when confidence < INTENT_CONFIDENCE_FLOOR so low-signal chit-chat doesn't
// get mis-routed into a purchase-decision narrative. Exported so the caller
// stays the single source of truth on the threshold.

export const INTENT_CONFIDENCE_FLOOR = 0.7;

export type ChatIntent =
  | "should_i_buy"
  | "plan_inquiry"
  | "status_query"
  | "general_chat";

export type ShouldIBuyPayload = {
  item_name: string;
  estimated_price: number | null;
  estimated_currency: string | null;
  urgency: "low" | "medium" | "high" | null;
  raw_query: string;
};

export type PlanInquiryPayload = {
  plan_id_hint: string | null;
};

export type StatusQueryPayload = {
  topic: string;
};

export type IntentExtractedPayload =
  | { kind: "should_i_buy"; data: ShouldIBuyPayload }
  | { kind: "plan_inquiry"; data: PlanInquiryPayload }
  | { kind: "status_query"; data: StatusQueryPayload }
  | { kind: "general_chat"; data: null };

export type ChatHistoryTurn = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type IntentClassifierInput = {
  user_message: string;
  page_key: string;
  recent_chat_history: ChatHistoryTurn[];
  wallet_snapshot: string;
  active_card_context: Record<string, unknown> | null;
};

export type IntentClassifierResult = {
  intent: ChatIntent;
  confidence: number;
  extracted_payload: IntentExtractedPayload;
};

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    intent: {
      type: Type.STRING,
      enum: ["should_i_buy", "plan_inquiry", "status_query", "general_chat"],
    },
    confidence: { type: Type.NUMBER },
    item_name: { type: Type.STRING },
    estimated_price: { type: Type.NUMBER },
    estimated_currency: { type: Type.STRING },
    urgency: {
      type: Type.STRING,
      enum: ["low", "medium", "high", "unknown"],
    },
    plan_id_hint: { type: Type.STRING },
    topic: { type: Type.STRING },
  },
  required: ["intent", "confidence"],
} as const;

const SYSTEM_PROMPT = `You route chat messages from a solo freelance dev (San Pablo, PHT, currency PHP) into ONE intent for downstream brains.

INTENTS:
- should_i_buy:  user is weighing whether to buy a specific item / service. Cues: "should I buy", "is X worth it", "can I afford", "thinking of getting", "tempted to", "is it ok to spend on". Pulls item_name, estimated_price (if mentioned), estimated_currency, urgency.
- plan_inquiry:  user is asking about an existing planned purchase / savings strategy. Cues: "the macbook plan", "how am I doing on", "when can I afford the". Pulls plan_id_hint (the rough label of the plan).
- status_query:  user wants a state read — "what's my safe today", "how much in GCash", "runway", "this week's spend", "any payments due". Pulls topic (short noun phrase).
- general_chat:  anything else — venting, philosophical, off-topic, greetings, conversational follow-ups, clarifications, asking for advice without a buy decision.

RULES:
- ONE intent. Pick the strongest signal. Tied / unclear → general_chat with confidence ≤ 0.5.
- confidence ∈ [0, 1]. ≥ 0.85 = very obvious. 0.7-0.85 = strong cue. 0.5-0.7 = soft cue. < 0.5 = guess.
- For should_i_buy: estimated_price ONLY if the user states a number; leave 0 / empty otherwise. estimated_currency defaults to "PHP" when ambiguous (user is in PH). urgency from cue words: "now", "today" → high; "this month" → medium; "someday" → low; no cue → unknown.
- For plan_inquiry: plan_id_hint is the user's words for the plan (e.g. "macbook", "apple dev"). Empty when not named.
- For status_query: topic is ≤ 4 words.
- DO NOT extract fields for intents you didn't pick. Leave them empty.
- Output JSON only.`;

function emptyResult(): IntentClassifierResult {
  return {
    intent: "general_chat",
    confidence: 0,
    extracted_payload: { kind: "general_chat", data: null },
  };
}

// Heuristic fallback — only fires when Gemini is unavailable OR the call
// throws. Conservative on purpose: misclassifying chit-chat as a buy
// decision is far worse than missing a buy decision and falling through to
// default chat-answer. ALL heuristic returns sit at confidence ≤ 0.6 so the
// caller's INTENT_CONFIDENCE_FLOOR (0.7) keeps them out of the should_i_buy
// fast path unless Gemini also agrees.
function heuristicClassify(message: string): IntentClassifierResult {
  const m = message.toLowerCase().trim();
  if (!m) return emptyResult();

  // should_i_buy cues — must be a CLEAR buying-question shape.
  const buyCues = [
    /\bshould i (buy|get|grab|order|cop)\b/,
    /\bcan i afford\b/,
    /\bworth it\b/,
    /\btempted to (buy|get)\b/,
    /\bok(ay)? to (buy|spend)\b/,
    /\bthinking of (buying|getting)\b/,
  ];
  if (buyCues.some((rx) => rx.test(m))) {
    return {
      intent: "should_i_buy",
      confidence: 0.55,
      extracted_payload: {
        kind: "should_i_buy",
        data: {
          item_name: message.trim().slice(0, 60),
          estimated_price: null,
          estimated_currency: "PHP",
          urgency: null,
          raw_query: message.trim(),
        },
      },
    };
  }

  // status_query cues.
  const statusCues = [
    /\bsafe (to spend|today)\b/,
    /\brunway\b/,
    /\bhow much (do i|is)\b/,
    /\b(what|how)'?s my (balance|wallet|gcash|coin|cash)\b/,
    /\b(this|next) (week|month)\b.*(spent|spend|payments?)\b/,
  ];
  if (statusCues.some((rx) => rx.test(m))) {
    return {
      intent: "status_query",
      confidence: 0.5,
      extracted_payload: {
        kind: "status_query",
        data: { topic: m.slice(0, 40) },
      },
    };
  }

  return emptyResult();
}

// 32-bit stable hash of the message — used in the cache slot key so identical
// repeats on the same page on the same day are a cache hit. Truncated to 12
// hex chars to keep the brain_key column compact.
function truncatedMessageHash(message: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < message.length; i++) {
    h ^= message.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0").slice(0, 12);
}

function trimmedMessage(message: string): string {
  // Normalize whitespace so trailing newlines / extra spaces don't break
  // the cache slot key for what is otherwise the same question.
  return message.trim().replace(/\s+/g, " ");
}

function parsePayload(
  raw: Partial<{
    intent: ChatIntent;
    confidence: number;
    item_name: string;
    estimated_price: number;
    estimated_currency: string;
    urgency: "low" | "medium" | "high" | "unknown";
    plan_id_hint: string;
    topic: string;
  }>,
  rawQuery: string,
): IntentClassifierResult {
  const intent: ChatIntent =
    raw.intent === "should_i_buy" ||
    raw.intent === "plan_inquiry" ||
    raw.intent === "status_query"
      ? raw.intent
      : "general_chat";
  const confidence = Math.max(0, Math.min(1, Number(raw.confidence ?? 0)));

  switch (intent) {
    case "should_i_buy": {
      const itemName = (raw.item_name ?? rawQuery).trim().slice(0, 80) || rawQuery.slice(0, 80);
      const price =
        typeof raw.estimated_price === "number" && raw.estimated_price > 0
          ? Math.round(raw.estimated_price * 100) / 100
          : null;
      const currency = (raw.estimated_currency ?? "PHP").trim().slice(0, 6).toUpperCase() || "PHP";
      const urgencyRaw = raw.urgency;
      const urgency: ShouldIBuyPayload["urgency"] =
        urgencyRaw === "low" || urgencyRaw === "medium" || urgencyRaw === "high"
          ? urgencyRaw
          : null;
      return {
        intent,
        confidence,
        extracted_payload: {
          kind: "should_i_buy",
          data: {
            item_name: itemName,
            estimated_price: price,
            estimated_currency: currency,
            urgency,
            raw_query: rawQuery,
          },
        },
      };
    }
    case "plan_inquiry": {
      const hint = (raw.plan_id_hint ?? "").trim().slice(0, 80) || null;
      return {
        intent,
        confidence,
        extracted_payload: { kind: "plan_inquiry", data: { plan_id_hint: hint } },
      };
    }
    case "status_query": {
      const topic = (raw.topic ?? "").trim().slice(0, 60) || rawQuery.slice(0, 60);
      return {
        intent,
        confidence,
        extracted_payload: { kind: "status_query", data: { topic } },
      };
    }
    default:
      return {
        intent: "general_chat",
        confidence,
        extracted_payload: { kind: "general_chat", data: null },
      };
  }
}

export async function classifyIntent(
  input: IntentClassifierInput,
): Promise<IntentClassifierResult> {
  const message = trimmedMessage(input.user_message);
  if (!message) return emptyResult();
  // Very short input is almost certainly an acknowledgement / greeting.
  // Short-circuit to general_chat with a tiny confidence so the caller
  // falls through to default chat-answer without paying for a model call.
  if (message.length < 4) {
    return {
      intent: "general_chat",
      confidence: 0.1,
      extracted_payload: { kind: "general_chat", data: null },
    };
  }

  const phtDay = phtDateString(new Date());
  const hash = truncatedMessageHash(`${input.page_key}|${message}`);
  const cacheSlot = scopedBrainKey(
    BRAIN_KEYS.INTENT_CLASSIFIER,
    "msg",
    `${input.page_key}:${hash}:${phtDay}`,
  );
  const fp = await fingerprintFromIds([
    "intent_classifier_v1",
    input.page_key,
    hash,
    phtDay,
  ]);

  const cached = await withBrainCache<IntentClassifierResult>({
    brainKey: cacheSlot,
    fingerprint: fp,
    phtDayAnchored: true,
    regen: async () => {
      if (!hasGemini()) return heuristicClassify(message);
      try {
        // Last 6 turns of chat history give the model the conversational
        // pivot ("yeah but the AirPods" only reads as should_i_buy if the
        // model can see the buy question two turns up). Trim each turn to
        // 240 chars so a long history doesn't dominate the prompt.
        const history = (input.recent_chat_history ?? [])
          .slice(-6)
          .map(
            (t) =>
              `${t.role.toUpperCase()}: ${(t.content ?? "").slice(0, 240)}`,
          )
          .join("\n");

        const cardSummary = input.active_card_context
          ? `${JSON.stringify(input.active_card_context).slice(0, 240)}`
          : "(none)";

        const prompt = `PAGE: ${input.page_key}
WALLET SNAPSHOT (compressed):
${(input.wallet_snapshot ?? "").slice(0, 800)}

ACTIVE CARD CONTEXT: ${cardSummary}

RECENT CHAT (last 6 turns, oldest -> newest):
${history || "(no recent turns)"}

NEW USER MESSAGE:
${message}

Return JSON ONLY.`;

        const res = await gemini().models.generateContent({
          model: pickModel("fast"),
          contents: prompt,
          config: {
            systemInstruction: SYSTEM_PROMPT,
            temperature: 0.1,
            responseMimeType: "application/json",
            responseSchema: RESPONSE_SCHEMA,
          },
        });
        const parsed = JSON.parse((res.text ?? "{}").trim()) as Partial<{
          intent: ChatIntent;
          confidence: number;
          item_name: string;
          estimated_price: number;
          estimated_currency: string;
          urgency: "low" | "medium" | "high" | "unknown";
          plan_id_hint: string;
          topic: string;
        }>;
        return parsePayload(parsed, message);
      } catch {
        return heuristicClassify(message);
      }
    },
  });

  return cached?.payload ?? heuristicClassify(message);
}

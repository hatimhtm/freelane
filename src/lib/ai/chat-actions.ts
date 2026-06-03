"use server";

import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { safeRunLabeled, type ActionResult } from "@/lib/data/actions";
import {
  getChatbotContextForPath,
  isClarifyVendorIntent,
  isIdentifyVendorIntent,
  type ChatbotActiveCardArg,
  type PageContext,
} from "@/lib/data/chat-context-registry";
import { clarifyVendorAction } from "@/lib/ai/chatbot/intent-handlers/clarify-vendor";
import { getFreelaneStateSnapshot } from "./freelane-state-snapshot";
import {
  answerChat,
  type ChatHistoryMessage,
  type ShouldIBuyDecisionResult,
} from "./brains/chat-answer";
import {
  classifyIntent,
  INTENT_CONFIDENCE_FLOOR,
} from "./brains/intent-classifier";
import { summarizeSession } from "./brains/session-summarizer";
import {
  completeVendorIdentificationAction,
  skipVendorIdentificationAction,
} from "@/app/(app)/spending/_actions/vendor-identify-actions";

// Server-actions module for the per-page persistent chatbot. Every entry
// point is wrapped in safeRunLabeled so the client toast surfaces real
// errors (Next 16 masks server-action throws otherwise).

const SESSION_IDLE_MS = 30 * 60 * 1000; // 30m idle ends the session
const HISTORY_MESSAGE_CAP = 30;
const DIGEST_LIMIT = 5;

// Session-scoped snapshot memo. The chat-answer brain depends on the
// systemInstruction (which embeds the snapshot) being byte-stable across
// turns so Gemini auto-caching can dedupe the prefix. Within a single
// runtime, hold the snapshot we fetched on the first turn for this session
// and reuse it on every later turn. STATE_SNAPSHOT also has its own 5m
// Supabase-side cache + ALL_BRAIN_KEYS invalidation — this memo is a tier
// above that, scoped strictly to the session id.
//
// Why a Map: server actions don't share React context. On a serverless
// platform each cold instance starts empty; the first turn re-fetches
// (which is fine — we eat one snapshot read, but every subsequent turn on
// that warm instance reuses the bytes).
const sessionSnapshotMemo = new Map<
  string,
  { text: string; capturedAt: number }
>();
// Bound memo to avoid unbounded growth across many sessions on a warm
// instance — we evict the oldest entries once we cross the cap.
const SESSION_SNAPSHOT_MEMO_CAP = 64;

function rememberSessionSnapshot(sessionId: string, text: string): void {
  if (sessionSnapshotMemo.size >= SESSION_SNAPSHOT_MEMO_CAP) {
    // Map iteration is insertion order — drop the oldest.
    const oldestKey = sessionSnapshotMemo.keys().next().value;
    if (oldestKey) sessionSnapshotMemo.delete(oldestKey);
  }
  sessionSnapshotMemo.set(sessionId, { text, capturedAt: Date.now() });
}

function forgetSessionSnapshot(sessionId: string): void {
  sessionSnapshotMemo.delete(sessionId);
}

type SessionRow = {
  id: string;
  session_id: string;
  page_key: string;
  created_at: string;
};

async function findActiveSession(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  pageKey: string,
): Promise<string | null> {
  // "Active" session = newest unarchived message on this page within the
  // idle window. New users / new pages: no active session yet.
  const { data } = await supabase
    .from("chat_messages")
    .select("session_id,created_at")
    .eq("user_id", userId)
    .eq("page_key", pageKey)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const ageMs = Date.now() - new Date(data.created_at as string).getTime();
  if (ageMs > SESSION_IDLE_MS) return null;
  return data.session_id as string;
}

export async function startOrContinueChatSession(args: {
  pageKey: string;
  pathname: string;
  activeCard?: ChatbotActiveCardArg;
}): Promise<ActionResult<{ sessionId: string; pageContext: PageContext }>> {
  return safeRunLabeled("freelane-chat", "startSession", async () => {
    const user = await getAuthUser();
    if (!user) throw new Error("Unauthenticated");
    const supabase = await createClient();

    let sessionId = await findActiveSession(supabase, user.id, args.pageKey);
    if (!sessionId) sessionId = crypto.randomUUID();

    const pageContext = await getChatbotContextForPath(
      args.pathname,
      user.id,
      args.activeCard,
    );
    return { sessionId, pageContext };
  });
}

export async function postChatMessage(args: {
  sessionId: string;
  pageKey: string;
  pathname: string;
  content: string;
  activeCard?: ChatbotActiveCardArg;
}): Promise<
  ActionResult<{
    assistantContent: string;
    suggestedFollowups: string[];
    userMessageId: string;
    assistantMessageId: string;
  }>
> {
  return safeRunLabeled("freelane-chat", "post", async () => {
    const user = await getAuthUser();
    if (!user) throw new Error("Unauthenticated");
    const content = args.content.trim();
    if (!content) throw new Error("Empty message.");
    const supabase = await createClient();

    const pageContext = await getChatbotContextForPath(
      args.pathname,
      user.id,
      args.activeCard,
    );

    // Intent dispatch — when the chatbot was opened from a notification
    // with a specific intent payload (e.g. vendor_identify_request), the
    // user's reply is a structured signal, not free-form chat. Route to
    // the matching action and short-circuit with a canned acknowledgement
    // so the brain doesn't double-handle the reply.
    //
    // identify_vendor: any non-empty reply other than "skip" triggers
    // completeVendorIdentificationAction(userDescription = content);
    // exact "skip" (case-insensitive, trimmed) triggers
    // skipVendorIdentificationAction.
    if (isIdentifyVendorIntent(args.activeCard)) {
      const { vendor_id: vendorId, vendor_name: vendorName } =
        args.activeCard.data;
      const trimmedLower = content.trim().toLowerCase();
      const isSkip = trimmedLower === "skip";

      // Persist the user message first so the session shows the reply
      // even when the action runs out-of-band.
      const { data: userRow } = await supabase
        .from("chat_messages")
        .insert({
          user_id: user.id,
          session_id: args.sessionId,
          page_key: args.pageKey,
          role: "user",
          content,
          page_context: pageContext as unknown as Record<string, unknown>,
        })
        .select("id")
        .single();
      if (!userRow) throw new Error("Couldn't save your message.");

      let assistantContent: string;
      if (isSkip) {
        const result = await skipVendorIdentificationAction(vendorId);
        assistantContent = result.ok
          ? `Got it — skipping ${vendorName}. I'll stop asking about this one.`
          : `Couldn't skip ${vendorName}: ${result.error ?? "unknown error"}`;
      } else {
        const result = await completeVendorIdentificationAction({
          vendorId,
          vendorName,
          userDescription: content,
        });
        assistantContent = result.ok
          ? `Thanks — saved that for ${vendorName}. I'll use it next time.`
          : `Couldn't save that for ${vendorName}: ${result.error ?? "unknown error"}`;
      }

      const { data: assistantRow } = await supabase
        .from("chat_messages")
        .insert({
          user_id: user.id,
          session_id: args.sessionId,
          page_key: args.pageKey,
          role: "assistant",
          content: assistantContent,
          page_context: pageContext as unknown as Record<string, unknown>,
        })
        .select("id")
        .single();

      return {
        assistantContent,
        suggestedFollowups: [],
        userMessageId: userRow.id as string,
        assistantMessageId: (assistantRow?.id as string) ?? "",
      };
    }

    // Vendors workflow — always-ask canonicalize intent. User's reply
    // (chip pick OR typed canonical OR "skip") routes through the
    // clarify-vendor handler. Mirrors the identify_vendor path above.
    if (isClarifyVendorIntent(args.activeCard)) {
      const { vendor_id: vendorId, vendor_name: vendorName } =
        args.activeCard.data;
      const { data: userRow } = await supabase
        .from("chat_messages")
        .insert({
          user_id: user.id,
          session_id: args.sessionId,
          page_key: args.pageKey,
          role: "user",
          content,
          page_context: pageContext as unknown as Record<string, unknown>,
        })
        .select("id")
        .single();
      if (!userRow) throw new Error("Couldn't save your message.");

      const result = await clarifyVendorAction({
        vendorId,
        vendorName,
        reply: content,
      });

      let assistantContent: string;
      if (!result.ok) {
        assistantContent = `Couldn't save that for ${vendorName}: ${result.error ?? "unknown error"}`;
      } else if (result.data.skipped) {
        assistantContent = `Got it — I'll leave ${vendorName} alone.`;
      } else {
        assistantContent = `Saved. I'll remember "${vendorName}" as "${content.trim()}".`;
      }

      const { data: assistantRow } = await supabase
        .from("chat_messages")
        .insert({
          user_id: user.id,
          session_id: args.sessionId,
          page_key: args.pageKey,
          role: "assistant",
          content: assistantContent,
          page_context: pageContext as unknown as Record<string, unknown>,
        })
        .select("id")
        .single();

      return {
        assistantContent,
        suggestedFollowups: [],
        userMessageId: userRow.id as string,
        assistantMessageId: (assistantRow?.id as string) ?? "",
      };
    }

    // Session-scoped snapshot capture: first turn fetches, every later turn
    // reuses the same bytes so chat-answer's systemInstruction is byte-stable
    // and Gemini auto-caching can dedupe the heavy prefix across turns.
    let snapshotText: string;
    const memoed = sessionSnapshotMemo.get(args.sessionId);
    if (memoed) {
      snapshotText = memoed.text;
    } else {
      const snapshot = await getFreelaneStateSnapshot();
      snapshotText = snapshot.text;
      rememberSessionSnapshot(args.sessionId, snapshotText);
    }

    // Insert the user row FIRST so a downstream brain failure still leaves
    // a record of what the user said.
    const { data: userRow } = await supabase
      .from("chat_messages")
      .insert({
        user_id: user.id,
        session_id: args.sessionId,
        page_key: args.pageKey,
        role: "user",
        content,
        page_context: pageContext as unknown as Record<string, unknown>,
      })
      .select("id")
      .single();
    if (!userRow) throw new Error("Couldn't save your message.");

    // Intent classification (freelane-shouldibuy-design 2026-06-02).
    //
    // Flash Lite routes the user's message into one of:
    //   should_i_buy | plan_inquiry | status_query | general_chat
    // For should_i_buy with confidence ≥ INTENT_CONFIDENCE_FLOOR we run the
    // Pro purchase-decision brain (askShouldIBuy) here and pass the verdict
    // into chat-answer so the model narrates the decision conversationally
    // instead of answering from scratch. Other intents pass through with
    // just the routed-intent hint; general_chat is the default path.
    let routedIntent: "should_i_buy" | "plan_inquiry" | "status_query" | "general_chat" =
      "general_chat";
    let decisionResult: ShouldIBuyDecisionResult | null = null;
    try {
      // Recent history for intent context — last 6 turns of THIS session.
      // Filter by row id (NOT content) so a verbatim repeat of an earlier
      // turn doesn't drop the older message as well — content-match would
      // strip both rows and starve the classifier of the conversational
      // pivot ("yeah but the AirPods").
      const { data: histForIntent } = await supabase
        .from("chat_messages")
        .select("id,role,content,created_at")
        .eq("user_id", user.id)
        .eq("session_id", args.sessionId)
        .is("archived_at", null)
        .order("created_at", { ascending: false })
        .limit(7);
      const justInsertedId = userRow.id as string;
      const recentHistory = (histForIntent ?? [])
        .filter((m) => m.id !== justInsertedId)
        .reverse()
        .map((m) => ({
          role: (m.role as "user" | "assistant" | "system"),
          content: m.content as string,
        }))
        .slice(-6);

      const intent = await classifyIntent({
        user_message: content,
        page_key: args.pageKey,
        recent_chat_history: recentHistory,
        // Trim the heavy snapshot for the classifier — it only needs a
        // headline to disambiguate ambiguous status_query vs general_chat.
        wallet_snapshot: snapshotText.slice(0, 600),
        active_card_context: (args.activeCard ?? null) as
          | Record<string, unknown>
          | null,
      });

      if (intent.confidence >= INTENT_CONFIDENCE_FLOOR) {
        routedIntent = intent.intent;
      }

      if (
        intent.intent === "should_i_buy" &&
        intent.confidence >= INTENT_CONFIDENCE_FLOOR &&
        intent.extracted_payload.kind === "should_i_buy"
      ) {
        const payload = intent.extracted_payload.data;
        // Only run the Pro purchase-decision brain when the user named a
        // real price. Passing ₱1 as a token amount would lock the verdict
        // to "easy_yes" and seed the narrative tone falsely for a real
        // ₱30k purchase. When the price is missing we still route the
        // intent (so chat-answer's narrative-less should_i_buy branch
        // fires) but leave decisionResult null — the brain will ask the
        // user for the price as a clarifying question.
        if (payload.estimated_price && payload.estimated_price > 0) {
          const { askShouldIBuy } = await import("@/lib/ai/should-i-buy");
          const currency = (payload.estimated_currency ?? "PHP") || "PHP";
          const session = await askShouldIBuy({
            item: payload.item_name || content.slice(0, 60),
            amount: payload.estimated_price,
            currency,
            note: payload.raw_query,
          });
          if (session) {
            decisionResult = {
              item: session.item,
              verdict: session.verdict ?? null,
              narrative: session.narrative ?? null,
              amountBase: Number(session.amount_base ?? 0) || null,
              currency: session.currency ?? null,
            };
          }
        } else {
          // Surface the item to chat-answer even without a price so the
          // narrative-less branch can name what's being weighed.
          decisionResult = {
            item: payload.item_name || content.slice(0, 60),
            verdict: null,
            narrative: null,
            amountBase: null,
            currency: payload.estimated_currency ?? "PHP",
          };
        }
      }
    } catch (err) {
      // Intent classification is best-effort — any failure falls through
      // to default chat-answer with routedIntent = general_chat. We still
      // surface the error as a server-side warn so the brain stack stays
      // observable: a thrown classifier looks identical to a real
      // 'general_chat' verdict in the chat_messages table otherwise, and
      // hit-rate / failure-mode analysis becomes impossible.
      console.warn("[chat-actions] intent classifier failed", err);
    }

    // Live history + past digests (per page, ordered oldest -> newest).
    const [{ data: history }, { data: digests }] = await Promise.all([
      supabase
        .from("chat_messages")
        .select("role,content,created_at")
        .eq("user_id", user.id)
        .eq("session_id", args.sessionId)
        .is("archived_at", null)
        .order("created_at", { ascending: true })
        .limit(HISTORY_MESSAGE_CAP),
      supabase
        .from("chat_session_summaries")
        .select("summary,ended_at")
        .eq("user_id", user.id)
        .eq("page_key", args.pageKey)
        .order("ended_at", { ascending: false })
        .limit(DIGEST_LIMIT),
    ]);

    // Strip the just-inserted user row from the history pass — it's the
    // newUserMessage. (We re-include all OTHER rows so the brain has the
    // full session-so-far context.)
    const liveHistory: ChatHistoryMessage[] = (history ?? [])
      .filter((m) => !(m.role === "user" && m.content === content))
      .map((m) => ({
        role: m.role as "user" | "assistant" | "system",
        content: m.content as string,
      }));

    // Digests are stored newest -> oldest from the query; flip so the
    // brain sees oldest -> newest in its prompt.
    const pastDigests = (digests ?? [])
      .slice()
      .reverse()
      .map((d) => ({
        summary: d.summary as string,
        ended_at: d.ended_at as string,
      }));

    const result = await answerChat({
      sessionId: args.sessionId,
      pageContext,
      snapshot: snapshotText,
      pastDigests,
      historyMessages: liveHistory,
      newUserMessage: content,
      routedIntent,
      decisionResult,
    });

    // Tag the assistant row's page_context with the routed intent (and
    // decision metadata when present) so the session-summarizer can detect
    // should_i_buy turns inside the digest pass without re-running the
    // classifier.
    const assistantPageContext: Record<string, unknown> = {
      ...(pageContext as unknown as Record<string, unknown>),
    };
    if (routedIntent !== "general_chat") {
      assistantPageContext.routed_intent = routedIntent;
    }
    if (decisionResult) {
      assistantPageContext.decision_result = {
        item: decisionResult.item,
        verdict: decisionResult.verdict,
      };
    }
    const { data: assistantRow } = await supabase
      .from("chat_messages")
      .insert({
        user_id: user.id,
        session_id: args.sessionId,
        page_key: args.pageKey,
        role: "assistant",
        content: result.answer,
        page_context: assistantPageContext,
      })
      .select("id")
      .single();

    return {
      assistantContent: result.answer,
      suggestedFollowups: result.suggestedFollowups,
      userMessageId: userRow.id as string,
      assistantMessageId: (assistantRow?.id as string) ?? "",
    };
  });
}

export async function endChatSession(
  sessionId: string,
): Promise<ActionResult<null>> {
  return safeRunLabeled("freelane-chat", "endSession", async () => {
    const user = await getAuthUser();
    if (!user) return null;
    // Fire-and-forget the Flash Lite digest so the user doesn't wait on
    // modal-close / navigation / page-unload. sweepStaleSessions is the
    // safety net if the runtime is torn down before the promise settles.
    // We deliberately don't await; errors are swallowed so the UI never
    // sees a "session-end failed" toast on what's effectively background
    // cleanup.
    void summarizeSession(sessionId).catch(() => {});
    forgetSessionSnapshot(sessionId);
    return null;
  });
}

export async function clearChat(args: {
  pageKey: string;
  pathname: string;
}): Promise<ActionResult<{ sessionId: string }>> {
  return safeRunLabeled("freelane-chat", "clearChat", async () => {
    const user = await getAuthUser();
    if (!user) throw new Error("Unauthenticated");
    const supabase = await createClient();

    // Close any active session on this page first. clearChat is a user
    // gesture — we still fire-and-forget the digest so the new session
    // surfaces instantly. The old session's snapshot memo is forgotten so
    // the next session captures fresh bytes on its first turn.
    const activeId = await findActiveSession(supabase, user.id, args.pageKey);
    if (activeId) {
      void summarizeSession(activeId).catch(() => {});
      forgetSessionSnapshot(activeId);
    }

    // New session id; the next message will use it.
    return { sessionId: crypto.randomUUID() };
  });
}

export async function listChatHistory(args: {
  pageKey: string;
  sessionId: string;
}): Promise<
  ActionResult<{
    messages: Array<{
      id: string;
      role: "user" | "assistant" | "system";
      content: string;
      createdAt: string;
    }>;
    digests: Array<{
      sessionId: string;
      summary: string;
      startedAt: string;
      endedAt: string;
      messageCount: number;
    }>;
  }>
> {
  return safeRunLabeled("freelane-chat", "listHistory", async () => {
    const user = await getAuthUser();
    if (!user) throw new Error("Unauthenticated");
    const supabase = await createClient();

    const [{ data: messages }, { data: digests }] = await Promise.all([
      supabase
        .from("chat_messages")
        .select("id,role,content,created_at")
        .eq("user_id", user.id)
        .eq("session_id", args.sessionId)
        .is("archived_at", null)
        .order("created_at", { ascending: true })
        .limit(HISTORY_MESSAGE_CAP),
      supabase
        .from("chat_session_summaries")
        .select("session_id,summary,started_at,ended_at,message_count")
        .eq("user_id", user.id)
        .eq("page_key", args.pageKey)
        .order("ended_at", { ascending: false })
        .limit(DIGEST_LIMIT),
    ]);

    return {
      messages: (messages ?? []).map((m) => ({
        id: m.id as string,
        role: m.role as "user" | "assistant" | "system",
        content: m.content as string,
        createdAt: m.created_at as string,
      })),
      digests: (digests ?? []).map((d) => ({
        sessionId: d.session_id as string,
        summary: d.summary as string,
        startedAt: d.started_at as string,
        endedAt: d.ended_at as string,
        messageCount: d.message_count as number,
      })),
    };
  });
}

// T33: idle batch sweep — invoked on app load (best-effort) to close any
// session whose last message is older than the idle window AND still has
// unarchived rows. beforeunload + visibilitychange can drop on flaky
// networks; this is the safety net.
export async function sweepStaleSessions(): Promise<ActionResult<{ closed: number }>> {
  return safeRunLabeled("freelane-chat", "sweep", async () => {
    const user = await getAuthUser();
    if (!user) return { closed: 0 };
    const supabase = await createClient();

    const cutoff = new Date(Date.now() - SESSION_IDLE_MS).toISOString();
    const { data } = await supabase
      .from("chat_messages")
      .select("session_id")
      .eq("user_id", user.id)
      .is("archived_at", null)
      .lt("created_at", cutoff);

    const sessionIds = Array.from(
      new Set((data ?? []).map((r) => r.session_id as string)),
    );
    let closed = 0;
    for (const sid of sessionIds) {
      // Double-check no fresh message landed since the SELECT.
      const { data: fresh } = await supabase
        .from("chat_messages")
        .select("created_at")
        .eq("user_id", user.id)
        .eq("session_id", sid)
        .is("archived_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!fresh) continue;
      const ageMs = Date.now() - new Date(fresh.created_at as string).getTime();
      if (ageMs <= SESSION_IDLE_MS) continue;
      await summarizeSession(sid);
      forgetSessionSnapshot(sid);
      closed += 1;
    }
    return { closed };
  });
}

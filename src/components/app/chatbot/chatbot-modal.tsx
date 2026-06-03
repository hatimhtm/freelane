"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { ArrowUp, Eraser, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { CenterModal, CenterModalBody } from "@/components/ui/center-modal";
import { useChatbot } from "./chatbot-context-provider";
import { ChatbotMessage } from "./chatbot-message";
import { ChatbotPillsBar } from "./chatbot-pills-bar";
import { ChatbotSessionDigest } from "./chatbot-session-digest";
import { postChatMessage, listChatHistory } from "@/lib/ai/chat-actions";
import { getChatbotPills } from "@/lib/ai/pills-actions";

// Center-screen chatbot modal. Per the design brief:
//   - header: page name + clear-chat + close
//   - past-session digests (last 5, collapsed; ChatbotSessionDigest)
//   - live current-session messages
//   - starter pills bar (visible only when session has 0 user messages)
//   - input + send

type LocalMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
  // Follow-up suggestion chips parsed out of the chat-answer brain's
  // FOLLOWUPS: tail. Only present on the LATEST assistant message — older
  // assistant bubbles drop their chips when a newer reply lands so the
  // chip row never accumulates stale choices below the scroll.
  followups?: string[];
};

type LocalDigest = {
  sessionId: string;
  summary: string;
  startedAt: string;
  endedAt: string;
  messageCount: number;
};

export function ChatbotModal() {
  const {
    sessionId,
    pageKey,
    pathname,
    modalOpen,
    closeModal,
    clearChatNow,
    prefill,
    activeCard,
    sessionEpoch,
  } = useChatbot();

  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [digests, setDigests] = useState<LocalDigest[]>([]);
  const [pills, setPills] = useState<string[] | null>(null);
  const [pillsLoading, setPillsLoading] = useState(false);
  const [input, setInput] = useState("");
  const [sending, startSending] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Pre-fill from the command-palette / external dispatchers.
  useEffect(() => {
    if (modalOpen && prefill) setInput(prefill);
  }, [modalOpen, prefill]);

  // Load history + digests when the modal opens or the session resets.
  useEffect(() => {
    if (!modalOpen || !sessionId) {
      setMessages([]);
      setDigests([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const res = await listChatHistory({ pageKey, sessionId });
      if (cancelled) return;
      if (res.ok) {
        setMessages(res.data.messages);
        setDigests(res.data.digests);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [modalOpen, sessionId, pageKey, sessionEpoch]);

  // LAZY pills: fetched ONLY when the modal opens, and only when there are
  // no messages yet (pills are starter prompts; redundant once chatting).
  useEffect(() => {
    if (!modalOpen) return;
    if (messages.length > 0) return;
    if (pills !== null) return;
    setPillsLoading(true);
    void (async () => {
      const res = await getChatbotPills({ pageKey, pathname });
      setPillsLoading(false);
      if (res.ok) setPills(res.data);
    })();
  }, [modalOpen, messages.length, pills, pageKey, pathname]);

  // Reset pills when session resets so the next blank session gets fresh
  // starter prompts.
  useEffect(() => {
    setPills(null);
  }, [sessionEpoch]);

  // Auto-scroll to newest on message change.
  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length]);

  const send = useCallback(
    (overrideText?: string) => {
      const text = (overrideText ?? input).trim();
      if (!text || !sessionId) return;
      setInput("");
      const tempId = `tmp-${crypto.randomUUID()}`;
      setMessages((prev) => [
        ...prev,
        { id: tempId, role: "user", content: text, createdAt: new Date().toISOString() },
      ]);
      startSending(async () => {
        const res = await postChatMessage({
          sessionId,
          pageKey,
          pathname,
          content: text,
          activeCard: activeCard
            ? { key: activeCard.key, label: activeCard.label, data: activeCard.data }
            : undefined,
        });
        if (!res.ok) {
          toast.error(res.error || "Couldn't send.");
          // Roll back the optimistic user bubble so the user can retry.
          setMessages((prev) => prev.filter((m) => m.id !== tempId));
          return;
        }
        setMessages((prev) => [
          // Clear followups on any prior assistant bubble so chips only
          // live on the freshest assistant reply.
          ...prev.map((m) => {
            if (m.id === tempId) return { ...m, id: res.data.userMessageId };
            if (m.role === "assistant" && m.followups)
              return { ...m, followups: undefined };
            return m;
          }),
          {
            id:
              res.data.assistantMessageId ||
              `asst-${crypto.randomUUID()}`,
            role: "assistant" as const,
            content: res.data.assistantContent,
            createdAt: new Date().toISOString(),
            followups: res.data.suggestedFollowups,
          },
        ]);
      });
    },
    [input, sessionId, pageKey, pathname, activeCard],
  );

  const pageLabel = pageKey
    .replace(/\./g, " · ")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
  const modalTitle = activeCard
    ? `${pageLabel} · ${activeCard.label}`
    : pageLabel;

  return (
    <CenterModal
      open={modalOpen}
      onOpenChange={(v) => (v ? null : closeModal())}
      title={modalTitle}
      description="Sharp friend who sees every wallet. Ask anything."
      size="lg"
    >
      <CenterModalBody>
        <div className="flex h-full flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
              {messages.length} in this session
            </div>
            <button
              type="button"
              onClick={() => void clearChatNow()}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground"
            >
              <Eraser className="h-3 w-3" />
              Clear chat
            </button>
          </div>

          <div
            ref={scrollRef}
            className="min-h-[200px] flex-1 space-y-3 overflow-y-auto rounded-md bg-foreground/[0.015] p-3"
          >
            {digests.length > 0 && (
              <div className="space-y-1.5">
                {digests.map((d) => (
                  <ChatbotSessionDigest
                    key={d.sessionId}
                    summary={d.summary}
                    startedAt={d.startedAt}
                    endedAt={d.endedAt}
                    messageCount={d.messageCount}
                  />
                ))}
              </div>
            )}
            {messages.length === 0 && (
              <ChatbotPillsBar
                pills={pills ?? []}
                onPick={send}
                loading={pillsLoading || pills === null}
              />
            )}
            {messages.map((m) => (
              <ChatbotMessage
                key={m.id}
                role={m.role}
                content={m.content}
                createdAt={m.createdAt}
                followups={m.followups}
                onPickFollowup={send}
              />
            ))}
            {sending && (
              <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Thinking…
              </div>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
            className="relative"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask your money…"
              className="h-11 w-full rounded-md border border-border bg-background px-3 pr-11 text-sm outline-none focus-visible:ring-2 focus-visible:ring-foreground/15"
            />
            <button
              type="submit"
              disabled={sending || !input.trim() || !sessionId}
              aria-label="Send"
              className="absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md bg-foreground text-background transition-opacity disabled:opacity-40"
            >
              {sending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ArrowUp className="h-3.5 w-3.5" />
              )}
            </button>
          </form>
        </div>
      </CenterModalBody>
    </CenterModal>
  );
}

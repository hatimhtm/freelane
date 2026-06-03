"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import {
  startOrContinueChatSession,
  endChatSession,
  clearChat,
  sweepStaleSessions,
} from "@/lib/ai/chat-actions";
import { seedInitialOpenQuestions } from "@/lib/ai/open-questions-actions";
import { toast } from "sonner";

// Chatbot React context. One global instance mounted at the (app) layout
// so every page sees the same session/pageKey state. The provider:
//
//   - Derives pageKey from the active pathname (client-side; the server
//     uses the same derivation in chat-context-registry).
//   - Calls startOrContinueChatSession() on every navigation to either
//     resume the active session or open a new one for the new page.
//   - Watches visibility + idle + beforeunload to end the session.
//   - Sweeps stale sessions on mount as a safety net for missed
//     beforeunload deliveries.

const SESSION_IDLE_MS = 30 * 60 * 1000;
const HIDDEN_END_MS = 5 * 60 * 1000;

// Client-side mirror of pageKeyFromPath() in chat-context-registry.ts.
// Keep these two in lockstep — the server uses its own derivation but the
// pageKey value must match byte-for-byte.
function clientPageKey(pathname: string): string {
  const path = pathname.split("?")[0].replace(/\/+$/, "");
  if (!path || path === "/") return "today";
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) return "today";
  if (segments[0] === "today") return "today";
  if (segments[0] === "dashboard")
    return segments[1] ? `dashboard.${segments[1]}` : "dashboard";
  if (segments[0] === "spending")
    return segments[1] ? `spending.${segments[1]}` : "spending";
  if (segments[0] === "clients") return segments[1] ? "clients.detail" : "clients";
  if (segments[0] === "projects")
    return segments[1] ? "projects.detail" : "projects";
  if (segments[0] === "vendors") return segments[1] ? "vendors.detail" : "vendors";
  if (segments[0] === "entities")
    return segments[1] ? "entities.detail" : "entities";
  if (segments[0] === "letters") return segments[1] ? "letters.detail" : "letters";
  if (segments[0] === "plans") return "plans";
  if (segments[0] === "payments") return "payments";
  if (segments[0] === "should-i-buy") return "should_i_buy";
  if (segments[0] === "settings")
    return segments[1] ? `settings.${segments[1]}` : "settings";
  if (segments[0] === "stats") {
    // /stats/[scope]/[subtab] — pageKey shapes:
    //   /stats/me                  → stats.me
    //   /stats/me/letters          → stats.me.letters
    //   /stats/year-2026/behavior  → stats.year-2026.behavior
    // Lets the chatbot scope properly when the user clicks "Respond in
    // chat" from a letter-reader modal opened on a stats subtab.
    if (!segments[1]) return "stats";
    if (!segments[2]) return `stats.${segments[1]}`;
    return `stats.${segments[1]}.${segments[2]}`;
  }
  return segments.join(".");
}

// Active card context. Set when the user opens the chatbot via a per-card
// AI dot — the modal header reads "${pageLabel} · ${card.label}" and the
// server-side chatbot context registry merges card.data into relevantData.
export type ChatbotActiveCard = {
  key: string;
  label: string;
  data?: Record<string, unknown>;
};

// Re-export for AiDot — keeps a single canonical name across the codebase.
import type { AiDotCardContext } from "@/components/widgets/ai-dot";

// Preferred public API for opening the chatbot scoped to a specific card.
// Wraps the canonical `freelane:open-chatbot` CustomEvent dispatch so
// callers don't reach into window directly. The CustomEvent listener
// inside this provider remains wired so legacy / external dispatchers
// (command palette, future integrations) keep working. New code should
// import this function; the event is retained as the legacy transport.
export function setActiveCardContext(
  card: AiDotCardContext | null,
  question?: string,
): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("freelane:open-chatbot", {
      detail: { activeCard: card, question },
    }),
  );
}

type ChatbotState = {
  sessionId: string | null;
  pageKey: string;
  pathname: string;
  modalOpen: boolean;
  prefill: string | null;
  activeCard: ChatbotActiveCard | null;
  setActiveCard: (card: ChatbotActiveCard | null) => void;
  openModal: (prefill?: string) => void;
  openModalForCard: (card: ChatbotActiveCard, prefill?: string) => void;
  closeModal: () => void;
  endSession: () => Promise<void>;
  clearChatNow: () => Promise<void>;
  // Bumped whenever a new session starts (clear or session-end). The modal
  // re-fetches its history when this number changes.
  sessionEpoch: number;
};

const ChatbotContext = createContext<ChatbotState | null>(null);

export function useChatbot(): ChatbotState {
  const ctx = useContext(ChatbotContext);
  if (!ctx) throw new Error("useChatbot must be inside ChatbotContextProvider");
  return ctx;
}

export function ChatbotContextProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/today";
  const pageKey = useMemo(() => clientPageKey(pathname), [pathname]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [prefill, setPrefill] = useState<string | null>(null);
  const [activeCard, setActiveCard] = useState<ChatbotActiveCard | null>(null);
  const [sessionEpoch, setSessionEpoch] = useState(0);

  const lastActivityRef = useRef<number>(Date.now());
  const hiddenSinceRef = useRef<number | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  sessionIdRef.current = sessionId;

  // Resolve/create the active session whenever the page changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await startOrContinueChatSession({ pageKey, pathname });
      if (cancelled) return;
      if (res.ok) {
        setSessionId(res.data.sessionId);
        setSessionEpoch((e) => e + 1);
        lastActivityRef.current = Date.now();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pageKey, pathname]);

  // One-shot stale-session sweep on mount. Best-effort safety net for
  // beforeunload deliveries that didn't complete. Same pass seeds the
  // initial open-questions on cold-start — the seed action is
  // idempotent (re-running checks the conflict row + cooldown), so
  // mounting on every page load is safe and fixes the "empty queue on
  // first launch" gap from the verifier.
  useEffect(() => {
    void sweepStaleSessions().catch(() => {});
    void seedInitialOpenQuestions().catch(() => {});
  }, []);

  // Listen for the command-palette + legacy event so existing entrypoints
  // still open the chatbot. The new event name is freelane:open-chatbot;
  // we also keep the freelane:open-ask-ai listener until every dispatcher
  // is migrated.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | { question?: string; activeCard?: ChatbotActiveCard }
        | undefined;
      setPrefill(detail?.question ?? null);
      // ALWAYS overwrite — including with null — so each open call is
      // authoritative about its card scope. Previously a subsequent open
      // from the command palette (which dispatches with no detail)
      // wouldn't clear a stale activeCard from a prior card click, and
      // the chatbot would resume scoped to the wrong card.
      setActiveCard(detail?.activeCard ?? null);
      setModalOpen(true);
    };
    window.addEventListener("freelane:open-chatbot", handler as EventListener);
    window.addEventListener("freelane:open-ask-ai", handler as EventListener);
    return () => {
      window.removeEventListener(
        "freelane:open-chatbot",
        handler as EventListener,
      );
      window.removeEventListener(
        "freelane:open-ask-ai",
        handler as EventListener,
      );
    };
  }, []);

  // Visibility-driven session end. When the tab stays hidden for 5+ minutes
  // we end the session — coming back from coffee shouldn't continue
  // yesterday's thread.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenSinceRef.current = Date.now();
      } else {
        const since = hiddenSinceRef.current;
        hiddenSinceRef.current = null;
        if (since && Date.now() - since >= HIDDEN_END_MS) {
          const sid = sessionIdRef.current;
          if (sid) {
            void endChatSession(sid).catch(() => {});
            setSessionId(null);
            setSessionEpoch((e) => e + 1);
          }
        }
        lastActivityRef.current = Date.now();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // Idle timer: 30m no interaction = session ends.
  useEffect(() => {
    const tick = setInterval(() => {
      const sid = sessionIdRef.current;
      if (!sid) return;
      if (Date.now() - lastActivityRef.current > SESSION_IDLE_MS) {
        void endChatSession(sid).catch(() => {});
        setSessionId(null);
        setSessionEpoch((e) => e + 1);
      }
    }, 60_000);
    const bumpActivity = () => {
      lastActivityRef.current = Date.now();
    };
    window.addEventListener("keydown", bumpActivity);
    window.addEventListener("mousemove", bumpActivity);
    window.addEventListener("touchstart", bumpActivity);
    return () => {
      clearInterval(tick);
      window.removeEventListener("keydown", bumpActivity);
      window.removeEventListener("mousemove", bumpActivity);
      window.removeEventListener("touchstart", bumpActivity);
    };
  }, []);

  // beforeunload — best-effort sync session-end. Uses fetch keepalive so
  // the browser carries the request past navigation. NB: a Next server
  // action POST with keepalive isn't trivially constructable from the
  // client; we fall back to a fire-and-forget action call which the
  // browser MAY drop. sweepStaleSessions on next load is the safety net.
  useEffect(() => {
    const onBeforeUnload = () => {
      const sid = sessionIdRef.current;
      if (!sid) return;
      // Best-effort: kick off the server action and don't wait. If the
      // browser kills the connection, sweepStaleSessions catches it on
      // the next app load.
      void endChatSession(sid).catch(() => {});
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  const openModal = useCallback((p?: string) => {
    setPrefill(p ?? null);
    setModalOpen(true);
    lastActivityRef.current = Date.now();
  }, []);

  const openModalForCard = useCallback(
    (card: ChatbotActiveCard, p?: string) => {
      setActiveCard(card);
      setPrefill(p ?? null);
      setModalOpen(true);
      lastActivityRef.current = Date.now();
    },
    [],
  );

  const closeModal = useCallback(() => {
    setModalOpen(false);
    setPrefill(null);
    setActiveCard(null);
  }, []);

  // Defensive: clear activeCard whenever the session epoch bumps (idle
  // expiry, visibility-driven end, manual clear). Without this, a
  // freshly-opened command-palette session inherits the stale card label
  // in the modal title until the user navigates pages.
  useEffect(() => {
    if (!modalOpen) setActiveCard(null);
  }, [sessionEpoch, modalOpen]);

  const endSession = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    const res = await endChatSession(sid);
    if (!res.ok) toast.error(res.error || "Couldn't end the chat.");
    setSessionId(null);
    setSessionEpoch((e) => e + 1);
  }, []);

  const clearChatNow = useCallback(async () => {
    const res = await clearChat({ pageKey, pathname });
    if (!res.ok) {
      toast.error(res.error || "Couldn't clear the chat.");
      return;
    }
    setSessionId(res.data.sessionId);
    setSessionEpoch((e) => e + 1);
  }, [pageKey, pathname]);

  const value: ChatbotState = {
    sessionId,
    pageKey,
    pathname,
    modalOpen,
    prefill,
    activeCard,
    setActiveCard,
    openModal,
    openModalForCard,
    closeModal,
    endSession,
    clearChatNow,
    sessionEpoch,
  };

  return (
    <ChatbotContext.Provider value={value}>{children}</ChatbotContext.Provider>
  );
}

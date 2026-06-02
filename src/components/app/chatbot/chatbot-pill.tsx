"use client";

import { MessagesSquare } from "lucide-react";
import { useChatbot } from "./chatbot-context-provider";
import { ChatbotModal } from "./chatbot-modal";

// Persistent floating pill, bottom-right, every page. Replaces the v1
// AskAiFloating button. Hides itself when the modal is open so the user's
// attention is single-pointed.

export function ChatbotPill({ enabled }: { enabled: boolean }) {
  const { modalOpen, openModal } = useChatbot();

  if (!enabled) return null;

  return (
    <>
      {!modalOpen && (
        <button
          type="button"
          aria-label="Open chatbot"
          onClick={() => openModal()}
          className="fixed bottom-6 right-6 z-30 grid h-14 w-14 place-items-center rounded-full bg-foreground text-background shadow-lg transition-transform hover:-translate-y-0.5 hover:shadow-xl"
        >
          <MessagesSquare className="h-5 w-5" />
        </button>
      )}
      <ChatbotModal />
    </>
  );
}

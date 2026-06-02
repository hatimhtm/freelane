"use server";

import { getAuthUser } from "@/lib/auth";
import { safeRunLabeled, type ActionResult } from "@/lib/data/actions";
import { getChatbotContextForPath } from "@/lib/data/chat-context-registry";
import { getFreelaneStateSnapshot } from "./freelane-state-snapshot";
import { generateChatbotPills } from "./brains/pills-generator";

// Lazy pill generator: only called when the chatbot modal opens, not on
// page load. Cached 5m via the underlying brain wrapper.

export async function getChatbotPills(args: {
  pageKey: string;
  pathname: string;
}): Promise<ActionResult<string[]>> {
  return safeRunLabeled("freelane-chat", "pills", async () => {
    const user = await getAuthUser();
    if (!user) throw new Error("Unauthenticated");
    const pageContext = await getChatbotContextForPath(args.pathname, user.id);
    const snapshot = await getFreelaneStateSnapshot();
    return generateChatbotPills(pageContext, snapshot.text);
  });
}

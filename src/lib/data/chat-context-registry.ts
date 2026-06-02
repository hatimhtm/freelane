import "server-only";

// Page-aware chatbot context registry.
//
// Each registered entry maps a URL prefix to a typed async fetcher that
// returns a PageContext object. The chatbot uses this to seed the Pro
// brain's "focus hint" (NOT a data limit; the full state snapshot still
// lands in the system prompt). The page-specific fetcher gives the brain
// "while the user was here, this is what they were looking at."
//
// Adding a new context: register a fetcher here. The default fallback at
// the bottom covers unmatched routes with a calm "what about money?"
// primary question so the modal still surfaces useful starter pills.

export type PageContext = {
  page: string;
  surface: string;
  primaryQuestion: string;
  relevantData: Record<string, unknown>;
  suggestPills: boolean;
};

// Optional per-card data fetcher. When the chatbot is opened from a
// per-widget AI dot, the active card identifier flows in via
// getChatbotContextForPath(path, userId, activeCard). If the matched
// registry entry provides a fetchCard handler, its result is merged into
// the PageContext's relevantData under the `activeCard` key.
export type ChatbotActiveCardArg = {
  key: string;
  label: string;
  data?: Record<string, unknown>;
};

type RegistryEntry = {
  match: (path: string) => boolean;
  fetch: (userId: string) => Promise<PageContext>;
  fetchCard?: (
    userId: string,
    card: ChatbotActiveCardArg,
  ) => Promise<Partial<PageContext>>;
};

// Lazy global on globalThis to dodge TDZ when self-registering modules
// circularly import this file. Each side-effect import calls
// registerChatbotContext at module-evaluation time; storing the array on
// globalThis under a stable string key keeps that safe regardless of
// circular import order. The string is inlined (not held in a const) so
// even the function declaration's body cannot trip TDZ.
function getRegistry(): RegistryEntry[] {
  const g = globalThis as unknown as Record<string, RegistryEntry[] | undefined>;
  if (!g["__freelane_chat_registry__"]) g["__freelane_chat_registry__"] = [];
  return g["__freelane_chat_registry__"]!;
}

export function registerChatbotContext(entry: RegistryEntry): void {
  getRegistry().push(entry);
}

// Stable page_key derivation for persistence + brain digests. Strips dynamic
// segments so /clients/abc-123 → "clients.detail", /spending/spends →
// "spending.spends", etc. Falls back to the literal pathname so deep links
// don't collide silently.
export function pageKeyFromPath(pathname: string): string {
  const path = pathname.split("?")[0].replace(/\/+$/, "");
  if (!path || path === "/") return "today";
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) return "today";
  if (segments[0] === "today") return "today";
  if (segments[0] === "dashboard") {
    return segments[1] ? `dashboard.${segments[1]}` : "dashboard";
  }
  if (segments[0] === "spending") {
    return segments[1] ? `spending.${segments[1]}` : "spending";
  }
  if (segments[0] === "clients") {
    return segments[1] ? "clients.detail" : "clients";
  }
  if (segments[0] === "projects") {
    return segments[1] ? "projects.detail" : "projects";
  }
  if (segments[0] === "vendors") {
    return segments[1] ? "vendors.detail" : "vendors";
  }
  if (segments[0] === "entities") {
    return segments[1] ? "entities.detail" : "entities";
  }
  if (segments[0] === "letters") {
    return segments[1] ? "letters.detail" : "letters";
  }
  if (segments[0] === "plans") return "plans";
  if (segments[0] === "payments") return "payments";
  if (segments[0] === "should-i-buy") return "should_i_buy";
  if (segments[0] === "settings") {
    return segments[1] ? `settings.${segments[1]}` : "settings";
  }
  return segments.join(".");
}

const DEFAULT_CONTEXT: (path: string) => PageContext = (path) => ({
  page: pageKeyFromPath(path),
  surface: path,
  primaryQuestion: "Anything else on your mind about money?",
  relevantData: {},
  suggestPills: true,
});

// Side-effect imports for self-registering page contexts. The registry is
// stored on globalThis (see getRegistry() above) so import order can't
// cause TDZ. Each imported module's module-evaluation body calls
// registerChatbotContext() and pushes its fetcher onto the global array.
import "@/app/(app)/today/_components/today-chatbot-context";
import "@/app/(app)/dashboard/_components/dashboard-data";
import "@/app/(app)/spending/_components/spending-data";

export async function getChatbotContextForPath(
  pathname: string,
  userId: string,
  activeCard?: ChatbotActiveCardArg,
): Promise<PageContext> {
  // Iterate registrations in order; first match wins. Stable, predictable
  // routing — the boss-cross-reference test walks each entry.
  for (const entry of getRegistry()) {
    if (entry.match(pathname)) {
      try {
        const base = await entry.fetch(userId);
        if (!activeCard) return base;
        let merged: PageContext = {
          ...base,
          relevantData: {
            ...base.relevantData,
            activeCard: {
              key: activeCard.key,
              label: activeCard.label,
              data: activeCard.data ?? {},
            },
          },
        };
        if (entry.fetchCard) {
          try {
            const cardCtx = await entry.fetchCard(userId, activeCard);
            merged = {
              ...merged,
              ...cardCtx,
              relevantData: {
                ...merged.relevantData,
                ...(cardCtx.relevantData ?? {}),
              },
            };
          } catch {
            // Card fetcher failures fall through to the base + activeCard merge.
          }
        }
        return merged;
      } catch {
        // A broken fetcher must not break the chatbot — fall through.
        return DEFAULT_CONTEXT(pathname);
      }
    }
  }
  return DEFAULT_CONTEXT(pathname);
}

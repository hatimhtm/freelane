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

// Known chatbot intents. When activeCard.data.intent matches one of
// these, postChatMessage routes the user's reply to the corresponding
// server action instead of forwarding it to the chat-answer brain.
// Keep this list in sync with the dispatcher in chat-actions.ts.
export const CHATBOT_INTENT = {
  IDENTIFY_VENDOR: "identify_vendor",
  // Vendors workflow — always-ask canonicalize. Payload carries
  // suggested_answers (top brain chips), alternatives, allow_skip.
  CLARIFY_VENDOR: "clarify_vendor",
  // Vendors workflow — per-card AI dot on Active vendor cards.
  // Unlike CLARIFY_VENDOR (a structured-reply intent), VENDOR_DETAIL
  // is a casual Q/A scope: the user is asking the chatbot about THIS
  // vendor. postChatMessage forwards the reply to chat-answer with
  // the vendor's context (price history, recent spends) merged into
  // PageContext.relevantData. No structured-action short-circuit.
  VENDOR_DETAIL: "vendor_detail",
  // Entities workflow — Gate 2 canonicalize. Payload carries
  // suggested_answers + alternatives + suggested_relationship +
  // allow_skip. The reply handler writes canonical_name + relationship
  // + pushes raw_user_typed_name onto aliases (mirror of clarify_vendor).
  CLARIFY_ENTITY: "clarify_entity",
  // Entities workflow — chatbot-internal capture for the
  // propose-entity-from-signal Trigger 3 (first chat mention). When the
  // chatbot itself notices a previously-unknown person-like name in a
  // user message, it asks INLINE (no notification) — this intent flags
  // the reply so the chat-context layer can route the answer to
  // acceptEntityDiscovery + noteFirstChatMention.
  IDENTIFY_ENTITY: "identify_entity",
} as const;
export type ChatbotIntent =
  (typeof CHATBOT_INTENT)[keyof typeof CHATBOT_INTENT];

// Narrow type guard for the activeCard payload. Intent-carrying cards
// share a stable shape: { intent, ...intent-specific fields }. The
// fields are validated at the action boundary.
export function isIdentifyVendorIntent(
  card: ChatbotActiveCardArg | undefined,
): card is ChatbotActiveCardArg & {
  data: { intent: "identify_vendor"; vendor_id: string; vendor_name: string };
} {
  if (!card?.data) return false;
  const d = card.data as Record<string, unknown>;
  return (
    d.intent === CHATBOT_INTENT.IDENTIFY_VENDOR &&
    typeof d.vendor_id === "string" &&
    typeof d.vendor_name === "string"
  );
}

// Vendors workflow — always-ask canonicalize intent. The reply handler
// in src/lib/ai/chatbot/intent-handlers/clarify-vendor.ts writes the
// canonical_name + brand_key + pushes raw_user_typed_name onto aliases.
export function isClarifyVendorIntent(
  card: ChatbotActiveCardArg | undefined,
): card is ChatbotActiveCardArg & {
  data: { intent: "clarify_vendor"; vendor_id: string; vendor_name: string };
} {
  if (!card?.data) return false;
  const d = card.data as Record<string, unknown>;
  return (
    d.intent === CHATBOT_INTENT.CLARIFY_VENDOR &&
    typeof d.vendor_id === "string" &&
    typeof d.vendor_name === "string"
  );
}

// Entities workflow — Gate 2 always-ask canonicalize intent. The reply
// handler writes canonical_name + relationship + pushes
// raw_user_typed_name onto aliases on the entity row.
export function isClarifyEntityIntent(
  card: ChatbotActiveCardArg | undefined,
): card is ChatbotActiveCardArg & {
  data: { intent: "clarify_entity"; entity_id: string; entity_name: string };
} {
  if (!card?.data) return false;
  const d = card.data as Record<string, unknown>;
  return (
    d.intent === CHATBOT_INTENT.CLARIFY_ENTITY &&
    typeof d.entity_id === "string" &&
    typeof d.entity_name === "string"
  );
}

// Entities workflow — chatbot inline Trigger 3 (first chat mention).
// The chatbot fires propose-entity-from-signal when a user message
// references a previously-unknown person-like name, and asks INLINE.
// Reply routes through acceptEntityDiscovery + noteFirstChatMention.
export function isProposeEntityIntent(
  card: ChatbotActiveCardArg | undefined,
): card is ChatbotActiveCardArg & {
  data: {
    intent: "identify_entity";
    candidate_name: string;
    signal_fingerprint: string;
    suggested_name?: string;
    suggested_relationship?: string | null;
  };
} {
  if (!card?.data) return false;
  const d = card.data as Record<string, unknown>;
  return (
    d.intent === CHATBOT_INTENT.IDENTIFY_ENTITY &&
    typeof d.candidate_name === "string" &&
    typeof d.signal_fingerprint === "string"
  );
}

// Vendors workflow — per-card AI dot on Active vendor cards. Pure
// Q/A scope (no structured-reply short-circuit), so this guard only
// drives the per-card data fetcher in spending-data.ts — there's no
// matching intent handler in chat-actions.
export function isVendorDetailIntent(
  card: ChatbotActiveCardArg | undefined,
): card is ChatbotActiveCardArg & {
  data: { intent: "vendor_detail"; vendor_id: string; vendor_name: string };
} {
  if (!card?.data) return false;
  const d = card.data as Record<string, unknown>;
  return (
    d.intent === CHATBOT_INTENT.VENDOR_DETAIL &&
    typeof d.vendor_id === "string" &&
    typeof d.vendor_name === "string"
  );
}

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
    // Entities workflow — /clients/people is the new home for the
    // entities surface. Two depths: "clients.people" for the list,
    // "clients.people.detail" for the per-entity view. Anything else
    // under /clients/ matches the historical clients.detail bucket.
    if (segments[1] === "people") {
      return segments[2] ? "clients.people.detail" : "clients.people";
    }
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
  if (segments[0] === "payments") {
    // Payments has three subtabs (wallets / withdrawals / history) since
    // the Design Structure restructure. Brand Identity workflow extends
    // the chatbot context per subtab so withdrawal-routing answers can
    // lean on wallet_platform_metadata for the specific surface.
    return segments[1] ? `payments.${segments[1]}` : "payments";
  }
  // /should-i-buy route was deleted (freelane-shouldibuy-design 2026-06-02);
  // next.config.ts redirects it to /. Any stale dispatcher that still passes
  // the path falls through to the default `segments.join(".")` below — but
  // the redirect kicks in first at the HTTP layer.
  if (segments[0] === "settings") {
    return segments[1] ? `settings.${segments[1]}` : "settings";
  }
  if (segments[0] === "stats") {
    // /stats/[scope]/[subtab] — mirrors clientPageKey in
    // chatbot-context-provider.tsx. The Letters subtab in particular
    // surfaces letter-reader modals whose "Respond in chat" handoff
    // depends on the page_key landing as stats.{scope}.letters.
    if (!segments[1]) return "stats";
    if (!segments[2]) return `stats.${segments[1]}`;
    return `stats.${segments[1]}.${segments[2]}`;
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
import "@/app/(app)/payments/_components/payments-data";

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

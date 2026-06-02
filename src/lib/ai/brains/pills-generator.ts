import "server-only";

import { Type } from "@google/genai";
import { gemini, hasGemini, pickModel } from "../models";
import { withBrainCache, fingerprintFromIds } from "../cache";
import { BRAIN_KEYS } from "../cache-keys";
import { scrubForbiddenPhrases } from "../voice-scrub";
import type { PageContext } from "@/lib/data/chat-context-registry";

// Flash Lite brain — 3-5 page-aware starter pills, lazy on modal open.
//
// Why Flash Lite: pills are short, low-stakes, page-local. The Pro brain
// is wasted on "tap one of these to get talking" prompts. Generation is
// cached per (pageKey + snapshot prefix) for 5 minutes so re-opening the
// modal is a cache hit.
//
// Forbidden phrase scrub on output: even Flash Lite drifts toward
// "consider", "you should", "save more" coaching language we don't want.

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    pills: {
      type: Type.ARRAY,
      minItems: 3,
      maxItems: 5,
      items: { type: Type.STRING },
    },
  },
  required: ["pills"],
} as const;

const SYSTEM_PROMPT = `You write tiny conversation starters for a freelance dev's personal money chatbot.

Voice: plain, warm, sharp. No coaching, no advice-shape language. Pills are QUESTIONS the user might ask THEIR money, not statements TO the user.

Hard rules:
- 3-5 pills max
- Each pill ≤ 8 words, ideally 4-6
- Each pill ends with "?" — they're questions
- Cite real numbers from the snapshot when you can ("₱8,200", "GCash")
- Page-specific: if the page is Today, ask about TODAY; if Spending, ask about WHERE money is going; if Dashboard, ask about THE MONTH
- NEVER use: "you should", "consider", "save more", "stay positive", "well done", "great job", "amazing"
- No "let's", no "we", no "Hi/Hello"

Return ONLY {"pills": [...]} JSON.`;

const FALLBACK_PILLS: Record<string, string[]> = {
  today: [
    "Did I overspend yet today?",
    "What's left in the main wallet?",
    "Why is Safe-to-Spend lower than yesterday?",
  ],
  spending: [
    "Where did the most go this week?",
    "Any category drifting?",
    "What's my biggest leak?",
  ],
  dashboard: [
    "How's the month tracking?",
    "What's outstanding right now?",
    "Who owes me money?",
  ],
  default: [
    "What changed since yesterday?",
    "Where's the money going?",
    "What should I steer next?",
  ],
};

function fallbackFor(pageKey: string): string[] {
  if (pageKey.startsWith("today")) return FALLBACK_PILLS.today;
  if (pageKey.startsWith("spending")) return FALLBACK_PILLS.spending;
  if (pageKey.startsWith("dashboard")) return FALLBACK_PILLS.dashboard;
  return FALLBACK_PILLS.default;
}

export async function generateChatbotPills(
  pageContext: PageContext,
  snapshot: string,
): Promise<string[]> {
  if (!hasGemini()) return fallbackFor(pageContext.page);

  // Fingerprint = page + first 1k chars of snapshot. Cheap, stable.
  const fp = await fingerprintFromIds([
    pageContext.page,
    snapshot.slice(0, 1000),
  ]);
  const cached = await withBrainCache<{ pills: string[] }>({
    brainKey: BRAIN_KEYS.CHATBOT_PILLS,
    fingerprint: fp,
    phtDayAnchored: false,
    regen: async () => {
      try {
        const prompt = `PAGE: ${pageContext.page} (${pageContext.surface})
PAGE PRIMARY QUESTION: ${pageContext.primaryQuestion}
PAGE DATA: ${JSON.stringify(pageContext.relevantData).slice(0, 800)}

FULL FREELANE STATE SNAPSHOT (use NUMBERS, not invented figures):
${snapshot.slice(0, 4000)}

Return the JSON now.`;
        const res = await gemini().models.generateContent({
          model: pickModel("fast"),
          contents: prompt,
          config: {
            systemInstruction: SYSTEM_PROMPT,
            temperature: 0.7,
            responseMimeType: "application/json",
            responseSchema: RESPONSE_SCHEMA,
          },
        });
        const parsed = JSON.parse((res.text ?? "{}").trim()) as {
          pills?: string[];
        };
        const cleaned = (parsed.pills ?? [])
          .map((p) => scrubForbiddenPhrases(String(p).trim()))
          .filter((p) => p.length > 0 && p.length <= 80)
          .slice(0, 5);
        return { pills: cleaned.length >= 3 ? cleaned : fallbackFor(pageContext.page) };
      } catch {
        return { pills: fallbackFor(pageContext.page) };
      }
    },
  });
  return cached?.payload.pills ?? fallbackFor(pageContext.page);
}

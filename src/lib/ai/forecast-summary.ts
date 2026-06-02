import "server-only";
import { Type } from "@google/genai";
import { gemini, hasGemini } from "./gemini";
import { HEAVY_MODEL } from "./models";
import { fingerprintFromIds, withBrainCache } from "./cache";
import { BRAIN_KEYS } from "./cache-keys";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { phtDateString } from "@/lib/utils";
import { toBase } from "@/lib/money";
import type { CurrencyCode, ExchangeRate } from "@/lib/supabase/types";

// Forecast Summary — the /dashboard/money headline brain. Plain English,
// freelancer voice, 24h cached. Pro model.
//
// Input shape (deliberately small): last 90d aggregate from money_ledger
// plus active plans, recurring outflows, expected recurring income. The
// brain produces a one-liner, an end-of-month estimate, a confidence
// number, and up to three short callouts.

export type ForecastSummary = {
  one_liner: string;
  end_of_month_estimate: string;
  confidence: number;
  callouts: string[];
  fromAi: boolean;
};

// Phrases the brand voice forbids. Filtered post-generation; if found the
// output is rewritten with a neutral fallback that still respects the
// directional sign of the underlying number.
const FORBIDDEN_PHRASES = [
  "you should",
  "consider",
  "save more",
  "stay positive",
  "well done",
  "great job",
  "amazing",
];

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    one_liner: { type: Type.STRING },
    end_of_month_estimate: { type: Type.STRING },
    confidence: { type: Type.NUMBER },
    callouts: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ["one_liner", "end_of_month_estimate", "confidence", "callouts"],
  propertyOrdering: [
    "one_liner",
    "end_of_month_estimate",
    "confidence",
    "callouts",
  ],
};

const SYSTEM_PROMPT = `You are the forecast brain on a SOLO freelancer's dashboard in San Pablo, Philippines.

Voice: short, declarative, in the user's own freelancer-on-uneven-income register. NO coaching. NO praise. NO suggestions. NO emojis.

Output JSON with:
- one_liner: <= 14 words. The headline. State what the next 30 days look like.
- end_of_month_estimate: <= 8 words. Just the number framing (e.g. "Net around -₱4,200 by month end").
- confidence: 0..1.
- callouts: 0-3 lines, each <= 10 words. Concrete facts only, no advice.

FORBIDDEN phrases: "you should", "consider", "save more", "stay positive", "well done", "great job", "amazing".`;

function passesForbiddenFilter(s: string): boolean {
  const lower = s.toLowerCase();
  return !FORBIDDEN_PHRASES.some((p) => lower.includes(p));
}

function honestOneLiner(facts: FactBundle): string {
  // Direction-sensitive fallback so the AI's calm-voice scrub doesn't
  // contradict a -₱20k net. The 90d net is the most honest cheap signal.
  const net = facts.ledger90d.net;
  if (net >= 0) return "Trailing 90 days net positive.";
  return "Trailing 90 days net negative.";
}

function scrub(
  summary: ForecastSummary,
  facts: FactBundle,
): ForecastSummary {
  const filtered = summary.callouts.filter(passesForbiddenFilter);
  // The end_of_month_estimate is constrained to <=8 words about a number,
  // so the practical risk of a forbidden phrase slipping through is small
  // — but a "consider net around X" completion would still slip past the
  // one_liner + callouts filter. Apply the same filter here and fall back
  // to the direction-sensitive trend phrase the fallback() builds.
  const net = facts.ledger90d.net;
  const fallbackEstimate = `Trend ${net >= 0 ? "up" : "down"} ₱${Math.abs(
    Math.round(net / 3),
  ).toLocaleString()}/mo`;
  return {
    ...summary,
    one_liner: passesForbiddenFilter(summary.one_liner)
      ? summary.one_liner
      : honestOneLiner(facts),
    end_of_month_estimate: passesForbiddenFilter(summary.end_of_month_estimate)
      ? summary.end_of_month_estimate
      : fallbackEstimate,
    callouts: filtered,
  };
}

type FactBundle = {
  ledger90d: { income: number; outflow: number; net: number; count: number };
  upcomingRecurringOutflowBase: number;
  expectedRecurringIncomeBase: number;
  activePlans: number;
  committedBase: number;
  currentPeriodStage: string;
};

async function gatherFacts(): Promise<FactBundle | null> {
  const supabase = await createClient();
  const user = await getAuthUser();
  if (!user) return null;
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString();

  // Promise.allSettled instead of Promise.all so a missing table on a
  // stale schema (e.g. recurring_payments doesn't exist yet) fails soft
  // — the brain falls back to 0 for that side instead of swallowing the
  // whole forecast. The data fan-out at the call site already catches a
  // null return; this guards against a single sub-query rejecting the
  // whole bundle.
  const settled = await Promise.allSettled([
    supabase
      .from("money_ledger")
      .select("amount_base,kind")
      .eq("user_id", user.id)
      .is("archived_at", null)
      .gte("event_at", since),
    supabase
      .from("recurring_spends")
      .select("expected_amount,expected_currency,active")
      .eq("user_id", user.id),
    // Recurring income side: recurring_payments (when present) carries the
    // freelancer's predictable inflow rules. Tolerate the table being
    // absent by falling back to 0.
    supabase
      .from("recurring_payments")
      .select("expected_amount,expected_currency,active")
      .eq("user_id", user.id),
    supabase
      .from("planned_spends")
      .select("expected_base,status")
      .eq("user_id", user.id),
    supabase
      .from("exchange_rates")
      .select("code,rate_to_base")
      .eq("user_id", user.id),
  ]);

  type RowList = { data: Record<string, unknown>[] | null } | null;
  const pick = (idx: number): RowList =>
    settled[idx].status === "fulfilled"
      ? (settled[idx].value as RowList)
      : null;
  const ledger = pick(0)?.data ?? [];
  const recurringOutflows = (pick(1)?.data ?? []) as Array<{
    expected_amount: number | null;
    expected_currency: string | null;
    active: boolean | null;
  }>;
  const recurringIncomes = (pick(2)?.data ?? []) as Array<{
    expected_amount: number | null;
    expected_currency: string | null;
    active: boolean | null;
  }>;
  const plans = (pick(3)?.data ?? []) as Array<{
    expected_base: number | null;
    status: string | null;
  }>;
  const rates = pick(4)?.data ?? [];

  let income = 0;
  let outflow = 0;
  for (const row of ledger ?? []) {
    const v = Number(row.amount_base ?? 0);
    if (v > 0) income += v;
    else outflow += v;
  }

  const rateRows = (rates ?? []) as Pick<ExchangeRate, "code" | "rate_to_base">[];

  // Sum recurring outflow expected_amounts in PHP base — non-PHP rules
  // pass through toBase so the dashboard number isn't polluted by raw
  // foreign-currency amounts.
  const upcomingRecurringOutflowBase = (recurringOutflows ?? [])
    .filter((r) => r.active)
    .reduce(
      (s, r) =>
        s +
        toBase(
          Number(r.expected_amount ?? 0),
          (r.expected_currency ?? "PHP") as CurrencyCode,
          rateRows,
        ),
      0,
    );

  const expectedRecurringIncomeBase = (recurringIncomes ?? [])
    .filter((r) => r.active)
    .reduce(
      (s, r) =>
        s +
        toBase(
          Number(r.expected_amount ?? 0),
          (r.expected_currency ?? "PHP") as CurrencyCode,
          rateRows,
        ),
      0,
    );

  // Migration 0088 — 'active' is the redesign alias for "intent declared".
  // Lock mechanism + committed_base column are gone; the safe-to-spend
  // strategy hook covers what the lock used to.
  const activePlans = (plans ?? []).filter(
    (p) => p.status === "planned" || p.status === "active",
  ).length;
  const committedBase = 0;

  return {
    ledger90d: {
      income: Math.round(income),
      outflow: Math.round(outflow),
      net: Math.round(income + outflow),
      count: (ledger ?? []).length,
    },
    upcomingRecurringOutflowBase: Math.round(upcomingRecurringOutflowBase),
    expectedRecurringIncomeBase: Math.round(expectedRecurringIncomeBase),
    activePlans,
    committedBase: Math.round(committedBase),
    currentPeriodStage: phtDateString(new Date()),
  };
}

function fallback(facts: FactBundle | null): ForecastSummary {
  if (!facts) {
    return {
      one_liner: "Not enough data to call yet.",
      end_of_month_estimate: "Unknown",
      confidence: 0.2,
      callouts: [],
      fromAi: false,
    };
  }
  const net = facts.ledger90d.net;
  return {
    one_liner: honestOneLiner(facts),
    end_of_month_estimate: `Trend ${net >= 0 ? "up" : "down"} ₱${Math.abs(
      Math.round(net / 3),
    ).toLocaleString()}/mo`,
    confidence: 0.4,
    callouts: facts.activePlans
      ? [`${facts.activePlans} active plan${facts.activePlans === 1 ? "" : "s"} on deck.`]
      : [],
    fromAi: false,
  };
}

// Cheap fingerprint over the same signals the brain reads. Missed
// invalidation (e.g. a future writer that forgets invalidateAiSafeSpendCache)
// then still busts the cache on the next read via cache.ts:159.
async function summaryFingerprint(facts: FactBundle): Promise<string> {
  return fingerprintFromIds([
    String(facts.ledger90d.count),
    String(facts.ledger90d.income),
    String(facts.ledger90d.outflow),
    String(facts.activePlans),
    String(facts.committedBase),
    String(facts.upcomingRecurringOutflowBase),
    String(facts.expectedRecurringIncomeBase),
  ]);
}

export async function getForecastSummary(): Promise<ForecastSummary | null> {
  // Facts are cheap (one batched fan-out) and produce the fingerprint
  // withBrainCache needs for trigger #4. Gathering them outside withBrainCache
  // means a fingerprint-matched hit short-circuits before the regen path runs.
  const facts = await gatherFacts();
  if (!facts) return null;
  const fingerprint = await summaryFingerprint(facts);

  const cached = await withBrainCache<ForecastSummary>({
    brainKey: BRAIN_KEYS.FORECAST_SUMMARY,
    fingerprint,
    regen: async () => {
      if (!hasGemini()) return fallback(facts);
      try {
        const prompt = `Facts (PHP base):
- Trailing 90d income: ₱${facts.ledger90d.income.toLocaleString()}
- Trailing 90d outflow: ₱${Math.abs(facts.ledger90d.outflow).toLocaleString()}
- Trailing 90d net: ₱${facts.ledger90d.net.toLocaleString()}
- Active plans: ${facts.activePlans}
- Committed plan pool: ₱${facts.committedBase.toLocaleString()}
- Upcoming recurring outflow (per period): ₱${facts.upcomingRecurringOutflowBase.toLocaleString()}
- Expected recurring income (per period): ₱${facts.expectedRecurringIncomeBase.toLocaleString()}
- Today PHT: ${facts.currentPeriodStage}

Write the JSON.`;
        const result = await gemini().models.generateContent({
          model: HEAVY_MODEL,
          contents: prompt,
          config: {
            systemInstruction: SYSTEM_PROMPT,
            temperature: 0.4,
            responseMimeType: "application/json",
            responseSchema: RESPONSE_SCHEMA,
          },
        });
        const text = result.text ?? "";
        if (!text) return fallback(facts);
        const parsed = JSON.parse(text) as Omit<ForecastSummary, "fromAi">;
        return scrub({ ...parsed, fromAi: true }, facts);
      } catch {
        return fallback(facts);
      }
    },
  });
  return cached?.payload ?? null;
}

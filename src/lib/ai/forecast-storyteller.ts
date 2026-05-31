import "server-only";
import { Type } from "@google/genai";
import { gemini, hasGemini } from "./gemini";
import { HEAVY_MODEL } from "./models";
import { buildCashflowAtlas, type CashflowAtlas } from "@/lib/cashflow-atlas";
import { holdingBalances } from "@/lib/payment-chain";
import { plannedInRange } from "@/lib/planned-spends";
import { formatMoney } from "@/lib/money";
import { phtDateString } from "@/lib/utils";
import type {
  ExchangeRate,
  LoanInstallment,
  Payment,
  PaymentMethod,
  PaymentStep,
  PlannedSpend,
  RecurringSpend,
  RecurringSpendSkip,
  Spend,
  Withdrawal,
} from "@/lib/supabase/types";

// Forecast Storyteller — writes the upcoming 30 days as a paragraph in
// Hatim's voice. NOT a chart caption; a quiet narrative the dashboard hero
// can show. Reads the cashflow atlas + planned spends + recurring + loans
// and turns them into a single 2-4 sentence story.
//
// Key moments are surfaced as a structured list under the narrative so the
// UI can render them as date pills under the story.

const HORIZON_DAYS = 30;

export interface ForecastInputs {
  payments: Payment[];
  withdrawals: Withdrawal[];
  spends: Spend[];
  recurring: RecurringSpend[];
  recurringSkips: RecurringSpendSkip[];
  loanInstallments: LoanInstallment[];
  plannedSpends: PlannedSpend[];
  methods: PaymentMethod[];
  stepsByPayment: Map<string, PaymentStep[]>;
  rates: ExchangeRate[];
  now?: Date;
}

export interface ForecastMoment {
  date: string;          // "YYYY-MM-DD"
  label: string;
  amountBase: number;
  kind: "recurring" | "loan" | "planned" | "low_point" | "income_expected";
}

export interface ForecastStory {
  // Headline — a short, evocative one-line summary. "A narrow stretch with
  // breathing room past the 18th." 8-16 words.
  headline: string;
  // Narrative — 2-4 sentences. The actual story.
  narrative: string;
  // Key moments — surface as date pills under the story.
  moments: ForecastMoment[];
  // Confidence 0-1.
  confidence: number;
  // Was AI involved?
  fromAi: boolean;
  // Atlas reference data for the visualization.
  atlasMinBase: number;
  atlasMinDate: string | null;
  startBalanceBase: number;
}

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    headline: { type: Type.STRING },
    narrative: { type: Type.STRING },
    confidence: { type: Type.NUMBER },
  },
  required: ["headline", "narrative"],
  propertyOrdering: ["headline", "narrative", "confidence"],
};

const SYSTEM_PROMPT = `You are the Forecast Storyteller for a SOLO freelancer in San Pablo, Philippines. Income is UNSTABLE (CNY/USD/EUR landings via Wise / coin.ph). Base currency PHP.

Read the cashflow atlas snapshot and write the NEXT 30 DAYS as a quiet story — not a forecast, a STORY. The reader is Hatim himself, and he already knows the structure of his life; this is the AI naming the shape he's about to walk through.

==============================
WHAT YOU WRITE
==============================
1. headline: 8-16 words, evocative but specific. Cite at least one number or date.
   Good: "A narrow stretch through the 18th, then ₱70k MacBook day Friday."
   Bad: "Looking ahead to next month"
2. narrative: 2-4 sentences total. Total ≤ 90 words. Walks the user through the shape — opening days, midpoint, end. Name the inflection points by date AND amount. Family-building frame allowed sparingly, never as a goal.

==============================
HARD RULES (NON-NEGOTIABLE)
==============================
- FORBIDDEN PHRASES: "your salary", "payday", "monthly paycheck", "until next pay", "your monthly budget", "monthly budget", "budget for", "save more", "you should", "consider", "make sure to", "remember to", "try to", "might want to", "set aside money", "treat yourself", "stay on track", "manage your finances", "financial health". These read as generic SaaS — they are wrong here.
- REPLACEMENT FRAMING: a landing, the next CNY corridor, a narrow stretch, a wide stretch, the runway sits at, the 18th will carry, between landings, this stretch.
- Cite REAL numbers and REAL dates from the snapshot. Don't invent figures, vendor names, or client names. If the snapshot has no entry for a category, don't fabricate one.
- No goals. No budgets. No "you should". Mirror, don't direct.
- No emojis. No hedging ("might want to", "perhaps", "consider"). No motivational fluff.
- Voice: dry, observant, warm. Hatim is a writer-coder kind of person. Sentences can run, but earn their length.
- Cigarette / fast food / ordering: factual citation with a number is fine. Never moralized.
- Family-building frame ("for the house", "building the family") allowed AT MOST ONCE in a narrative, only in a calm or wide-stretch tone, NEVER framed as a goal.

==============================
GOOD VS BAD EXAMPLES
==============================
Good headline: "A narrow stretch through the 18th, then ₱70k MacBook day Friday."
Bad headline: "Plan your month and set aside money for upcoming bills."

Good narrative: "Opening at ₱34,200 on May 31, the next two weeks carry rent + wifi (₱4,200 on the 5th). The MacBook drop on June 4 takes the runway from 28d to 12d. Between then and the next CNY corridor, the discretionary surface narrows."
Bad narrative: "You should plan ahead for next month's expenses and consider saving for emergencies. Your monthly budget will be tight."

Return JSON: { headline, narrative, confidence }.`;

function buildAtlasSnapshot(args: {
  atlas: CashflowAtlas;
  inputs: ForecastInputs;
  startBalance: number;
  moments: ForecastMoment[];
}): string {
  const m = (n: number) => formatMoney(n, "PHP", { compact: true });
  const a = args.atlas;
  const start = a.days[0]?.date ? phtDateString(a.days[0].date) : "";
  const end = a.days[a.days.length - 1]?.date ? phtDateString(a.days[a.days.length - 1].date) : "";
  const momentsLines = args.moments.map((m0) => `- ${m0.date} · ${m0.label} · ${m(m0.amountBase)} · ${m0.kind}`);
  return `HORIZON: ${start} → ${end} (30 days)
START BALANCE: ${m(args.startBalance)}
ATLAS MIN BALANCE: ${m(a.minBalance)}${a.minBalanceDate ? ` on ${phtDateString(a.minBalanceDate)}` : ""}
ATLAS ZERO CROSSING: ${a.zeroCrossingDate ? phtDateString(a.zeroCrossingDate) : "none"}

KEY MOMENTS:
${momentsLines.join("\n") || "- (no scheduled commitments)"}

DAILY OUTFLOW BASELINE: ${m(a.days[0]?.expectedSpend ?? 0)}/day (rolling 30d avg)
DAILY INCOME BASELINE:  ${m(a.days[0]?.expectedIncome ?? 0)}/day (rolling 30d avg)`;
}

function extractMoments(atlas: CashflowAtlas): ForecastMoment[] {
  const out: ForecastMoment[] = [];
  for (const day of atlas.days) {
    for (const e of day.events) {
      out.push({
        date: day.dayKey,
        label: e.label,
        amountBase: e.amount,
        kind: e.kind === "income_pulse" ? "income_expected" : (e.kind as "recurring" | "loan" | "planned"),
      });
    }
  }
  // Sort by amount desc, take top 8.
  return out
    .sort((a, b) => Math.abs(b.amountBase) - Math.abs(a.amountBase))
    .slice(0, 8)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function generateForecastStory(inputs: ForecastInputs): Promise<ForecastStory> {
  const now = inputs.now ?? new Date();
  const atlas = buildCashflowAtlas({ ...inputs, now, horizonDays: HORIZON_DAYS });
  const holdings = holdingBalances(
    inputs.methods,
    inputs.payments,
    inputs.stepsByPayment,
    inputs.withdrawals,
    inputs.spends,
  );
  const startBalance = holdings.reduce((s, h) => s + h.balance, 0);
  const moments = extractMoments(atlas);

  const planned30d = plannedInRange(inputs.plannedSpends, now, new Date(now.getTime() + HORIZON_DAYS * 86_400_000));
  // Tag low-point as a moment.
  if (atlas.minBalanceDate && atlas.minBalance < startBalance * 0.6) {
    moments.push({
      date: phtDateString(atlas.minBalanceDate),
      label: "Low point",
      amountBase: atlas.minBalance,
      kind: "low_point",
    });
  }

  // Fallback story (deterministic).
  let headline = fallbackHeadline(atlas, startBalance, planned30d.total);
  let narrative = fallbackNarrative(atlas, startBalance, planned30d.total);
  let confidence = 0.55;
  let fromAi = false;

  if (hasGemini()) {
    try {
      const snapshot = buildAtlasSnapshot({ atlas, inputs, startBalance, moments });
      const res = await gemini().models.generateContent({
        model: HEAVY_MODEL,
        contents: `Snapshot:\n\n${snapshot}\n\nReturn JSON.`,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          temperature: 0.55,
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
        },
      });
      const parsed = JSON.parse((res.text ?? "{}").trim()) as {
        headline?: string;
        narrative?: string;
        confidence?: number;
      };
      if (parsed.headline && parsed.narrative) {
        headline = parsed.headline.trim();
        narrative = parsed.narrative.trim();
        confidence = Math.max(0, Math.min(1, Number(parsed.confidence ?? 0.7)));
        fromAi = true;
      }
    } catch {
      // Keep deterministic story.
    }
  }

  return {
    headline,
    narrative,
    moments: moments.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 6),
    confidence,
    fromAi,
    atlasMinBase: atlas.minBalance,
    atlasMinDate: atlas.minBalanceDate ? phtDateString(atlas.minBalanceDate) : null,
    startBalanceBase: startBalance,
  };
}

function fallbackHeadline(atlas: CashflowAtlas, startBalance: number, planned30d: number): string {
  const m = (n: number) => formatMoney(n, "PHP", { compact: true });
  if (atlas.zeroCrossingDate) {
    return `A narrow stretch — the runway crosses zero around ${shortDateLabel(atlas.zeroCrossingDate)}.`;
  }
  if (planned30d > startBalance * 0.5) {
    return `Heavy stretch ahead — ${m(planned30d)} of planned outflows in 30 days.`;
  }
  if (atlas.minBalance < startBalance * 0.4) {
    return `Wide stretch with one narrow point — atlas dips to ${m(atlas.minBalance)}${atlas.minBalanceDate ? ` around ${shortDateLabel(atlas.minBalanceDate)}` : ""}.`;
  }
  return `Steady 30 days. Atlas low at ${m(atlas.minBalance)}; nothing crowding the calendar.`;
}

function fallbackNarrative(atlas: CashflowAtlas, startBalance: number, planned30d: number): string {
  const m = (n: number) => formatMoney(n, "PHP", { compact: true });
  const start = atlas.days[0]?.date ? shortDateLabel(atlas.days[0].date) : "today";
  const end = atlas.days[atlas.days.length - 1]?.date
    ? shortDateLabel(atlas.days[atlas.days.length - 1].date)
    : "end of horizon";
  const lowLabel = atlas.minBalanceDate ? shortDateLabel(atlas.minBalanceDate) : "the low point";
  if (atlas.zeroCrossingDate) {
    return `Opening at ${m(startBalance)} on ${start}, the projection narrows fast — ${m(planned30d)} in planned outflows and recurring rhythms bring the runway under zero by ${shortDateLabel(atlas.zeroCrossingDate)}. The stretch is asking for a deferral or an early landing before then.`;
  }
  if (planned30d === 0) {
    return `Opening at ${m(startBalance)} on ${start}, the next 30 days carry no planned big spends. Rent, wifi, and the recurring rhythms alone read the atlas to a low of ${m(atlas.minBalance)} around ${lowLabel}, then steady through ${end}.`;
  }
  return `Opening at ${m(startBalance)} on ${start}, the runway carries ${m(planned30d)} of planned outflows across the 30 days. The atlas reads a low of ${m(atlas.minBalance)} around ${lowLabel}, then steadies into ${end}.`;
}

function shortDateLabel(d: Date): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[d.getMonth()]} ${d.getDate()}`;
}

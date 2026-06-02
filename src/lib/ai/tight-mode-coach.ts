import "server-only";
import { Type } from "@google/genai";
import { gemini, hasGemini } from "./gemini";
import { HEAVY_MODEL } from "./models";
import {
  fingerprintFromIds,
  readBrainCache,
  withBrainCache,
  type CachedBrainPayload,
} from "./cache";
import { BRAIN_KEYS } from "./cache-keys";
import { safeToSpend } from "@/lib/safe-to-spend";
import { holdingBalances } from "@/lib/payment-chain";
import { computeWalletBalancesFromLedger } from "@/lib/data/wallet-balance";
import { logLedgerReadFailure } from "@/lib/data/money-ledger";
import { buildCashflowAtlas } from "@/lib/cashflow-atlas";
import { plannedInRange, committedPoolBase } from "@/lib/planned-spends";
import { formatMoney } from "@/lib/money";
import type {
  CalmWeatherState,
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

// Tight Mode Coach — surfaces during a storm band. The opposite of a budget
// app: instead of telling Hatim what he can't do, it shows what's flex, what's
// locked, and what one concrete move clears the most pressure.
//
// Output is a 3-section read:
//   - "Locked" — the unavoidable outflows in the next 14 days (recurring,
//     loans, committed plans). Read the number. No panic.
//   - "Flex" — discretionary surface still available. PHP/day for next 7d.
//   - "The one move" — single highest-leverage action that meaningfully widens
//     the runway. Examples: defer Apple Dev renewal, lock the MacBook fund
//     into a holding wallet that's hard to touch, log a Sadaka that's been
//     hanging, reach out to Sander about the unpaid invoice, etc.
//
// AI handles the "one move" line. Locked + flex are deterministic.

const FORECAST_HORIZON_DAYS = 14;

export interface TightModeInputs {
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
  calmWeather?: CalmWeatherState | null;
  now?: Date;
}

export interface TightModeRead {
  // Whether the band is actually tight enough to show the coach.
  active: boolean;
  // PHP locked in next 14d (recurring + loans + committed plans).
  locked14dBase: number;
  // Per-day discretionary surface in next 7d.
  flexPerDayBase: number;
  // Total wallet right now.
  walletTotalBase: number;
  // Runway in days.
  runwayDays: number;
  // The single AI-written move (one sentence in Hatim's voice).
  oneMove: string;
  // 2-3 supporting facts the coach surfaces under "Locked" + "Flex".
  notes: TightModeNote[];
  // Was AI involved or fallback? Used by UI to soften confidence chip.
  fromAi: boolean;
}

export interface TightModeNote {
  label: string;
  amountBase: number;
  kind: "recurring" | "loan" | "planned" | "income_expected" | "wallet";
}

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    oneMove: { type: Type.STRING },
  },
  required: ["oneMove"],
  propertyOrdering: ["oneMove"],
};

const SYSTEM_PROMPT = `You are the Tight Mode Coach for a SOLO freelancer in San Pablo, Philippines. He's in a financially tight stretch right now. Your job: write ONE sentence — the highest-leverage move he can make today to widen the runway meaningfully.

==============================
HARD RULES (NON-NEGOTIABLE)
==============================
- ONE sentence. 16-26 words. Imperative or declarative — never preachy.
- Name a SPECIFIC, REAL number or entity FROM THE SNAPSHOT. If the snapshot does NOT name a specific client, loan counterparty, or vendor, use a GENERIC factual move (defer the next big planned spend, lock a portion in coin.ph, log missed spends). DO NOT invent names like "Sander" — the examples below are illustrative only.
- FORBIDDEN PHRASES: "save more", "spend less", "budget", "monthly budget", "cut costs", "you should", "consider", "make sure to", "remember to", "try to", "treat yourself", "stay positive", "financial health", "manage your money", "your salary", "your paycheck", "until next pay", "monthly paycheck", "payday".
- REPLACEMENT FRAMING: defer X, lock ₱Y for Z, reach out about the invoice, log the missing Sadaka, slow the discretionary to ₱N/day for 7 days, parking ₱N somewhere harder to touch.
- Income is UNSTABLE — never assume a paycheck or fixed monthly inflow. Reaching out about a pending invoice IS a valid move; "wait for payday" is NOT.
- Never moralize. Cigarettes, fast food, ordering — cite a number only, no judgment.

==============================
ILLUSTRATIVE EXAMPLES (DO NOT COPY NAMES)
==============================
- "Reach out to the client owing the largest outstanding amount — that one payment widens the runway by 18 days."
- "Defer the Apple Dev renewal 30 days; pushes ₱5,500 outside the storm window."
- "Lock ₱5,000 into coin.ph specifically labeled for the Eid envelope so it's harder to touch this week."
- "Log any Sadaka or rent payment you've made off-app — the ledger looks tighter than reality if those are missing."

Return JSON: { "oneMove": "<sentence>" }`;

const TIGHT_BANDS = new Set<string>(["storm", "gust"]);

// Cheap deterministic check — true when we should surface the coach at all.
export function shouldShowTightMode(weather: CalmWeatherState | null | undefined): boolean {
  return !!weather && TIGHT_BANDS.has(weather.band);
}

function buildSnapshot(args: {
  inputs: TightModeInputs;
  locked14dBase: number;
  flexPerDayBase: number;
  walletTotalBase: number;
  runwayDays: number;
  notes: TightModeNote[];
}): string {
  const m = (n: number) => formatMoney(n, "PHP", { compact: true });
  const lines = args.notes.map((n) => `- ${n.kind}: ${n.label} — ${m(n.amountBase)}`);
  return `WEATHER BAND: ${args.inputs.calmWeather?.band ?? "(unknown)"}
WALLET TOTAL: ${m(args.walletTotalBase)}
RUNWAY DAYS: ${args.runwayDays}
LOCKED 14d: ${m(args.locked14dBase)}
FLEX/day (7d): ${m(args.flexPerDayBase)}

KEY NOTES:
${lines.join("\n") || "- (none)"}

UNPAID INVOICES STANDING:
${unpaidInvoiceLines(args.inputs)}

PLANNED IN 30d:
${plannedSummary(args.inputs)}`;
}

function unpaidInvoiceLines(inputs: TightModeInputs): string {
  // Without /clients fetch we don't have the names — read payment notes/loan
  // counterparties as a stand-in. Cheap heuristic that still gives the AI
  // something to reach for.
  // For real client-level lookup the brain would need projects + clients fed
  // in; here we let it work off the loan side (which is where unpaid friend
  // money lives) and the AI can name a generic action if needed.
  const openLoanLines = inputs.loanInstallments
    .filter((i) => i.status === "pending")
    .slice(0, 3)
    .map((i) => `- pending loan installment ${i.due_date}: ${i.expected_amount} ${i.expected_currency}`);
  return openLoanLines.join("\n") || "- (none surfaced)";
}

function plannedSummary(inputs: TightModeInputs): string {
  const m = (n: number) => formatMoney(n, "PHP", { compact: true });
  const now = inputs.now ?? new Date();
  const horizonEnd = new Date(now.getTime() + 30 * 86_400_000);
  const { rows } = plannedInRange(inputs.plannedSpends, now, horizonEnd);
  return rows
    .slice(0, 5)
    .map((p) => `- ${p.label} (${p.certainty}, ${p.status}): ${m(Number(p.expected_base ?? 0))} on ${p.planned_for}`)
    .join("\n") || "- (none)";
}

// Cache-only read for the hot first-paint path. Returns whatever's in the
// brain cache (possibly stale, possibly null). The client widget reads this
// + decides whether to fire refreshTightMode().
export async function getTightModeCached(): Promise<CachedBrainPayload<TightModeRead> | null> {
  return readBrainCache<TightModeRead>(BRAIN_KEYS.TIGHT_MODE);
}

export async function computeTightMode(
  inputs: TightModeInputs,
  opts: { force?: boolean } = {},
): Promise<TightModeRead> {
  const result = await withBrainCache<TightModeRead>({
    brainKey: BRAIN_KEYS.TIGHT_MODE,
    fingerprint: await tightModeFingerprint(inputs),
    force: opts.force,
    regen: () => computeTightModeRegen(inputs),
  });
  if (result) return result.payload;
  // Pathological fallback — withBrainCache returns null only when the regen
  // path itself errored AND no prior cache exists. Run once without the
  // wrapper so callers never see undefined.
  return computeTightModeRegen(inputs);
}

async function computeTightModeRegen(inputs: TightModeInputs): Promise<TightModeRead> {
  const now = inputs.now ?? new Date();
  const active = shouldShowTightMode(inputs.calmWeather);

  // Compute deterministic facts first (cheap; we always need them).
  // Phase 1.5: ledger reader first; thread through safe-to-spend + atlas
  // so they read the same canonical wallet truth.
  const tightLedgerBalanceMap = await computeWalletBalancesFromLedger(inputs.methods).catch(
    (err) => {
      const message = err instanceof Error ? err.message : String(err);
      void logLedgerReadFailure(`tight-mode wallet-balance read: ${message}`);
      return new Map();
    },
  );
  const tightLedgerBalanceForChain = new Map<string, number>();
  for (const [k, v] of tightLedgerBalanceMap) tightLedgerBalanceForChain.set(k, v.balance);
  const safe = safeToSpend({ ...inputs, ledgerBalances: tightLedgerBalanceForChain, now });
  const atlas = buildCashflowAtlas({ ...inputs, ledgerBalances: tightLedgerBalanceForChain, now });
  const holdings = holdingBalances(
    inputs.methods,
    inputs.payments,
    inputs.stepsByPayment,
    inputs.withdrawals,
    inputs.spends,
    tightLedgerBalanceForChain,
  );
  const walletTotalBase = holdings.reduce((s, h) => s + h.balance, 0);

  const next14 = atlas.days.slice(0, FORECAST_HORIZON_DAYS);
  const locked14dRecurring = next14.reduce((s, d) => s + d.recurringDue, 0);
  const locked14dLoans = next14.reduce((s, d) => s + d.loanDue, 0);
  const horizonEnd14d = new Date(now.getTime() + FORECAST_HORIZON_DAYS * 86_400_000);
  const locked14dPlanned = plannedInRange(inputs.plannedSpends, now, horizonEnd14d).total;
  const committed = committedPoolBase(inputs.plannedSpends);
  const locked14dBase = locked14dRecurring + locked14dLoans + locked14dPlanned + committed;

  const next7 = atlas.days.slice(0, 7);
  const flex7dRecurring = next7.reduce((s, d) => s + d.recurringDue, 0);
  const flex7dLoans = next7.reduce((s, d) => s + d.loanDue, 0);
  const flex7dPlanned = next7.reduce((s, d) => s + d.plannedSpend, 0);
  const flexPool = Math.max(0, walletTotalBase - flex7dRecurring - flex7dLoans - flex7dPlanned);
  const flexPerDayBase = Math.round(flexPool / 7);

  // Runway from atlas.
  let runwayDays = atlas.days.length;
  for (let i = 0; i < atlas.days.length; i++) {
    if (atlas.days[i].endOfDayBalance <= safe.colFloorBase) {
      runwayDays = i;
      break;
    }
  }

  const notes: TightModeNote[] = [];
  if (locked14dRecurring > 0) {
    notes.push({ label: "Recurring next 14d", amountBase: locked14dRecurring, kind: "recurring" });
  }
  if (locked14dLoans > 0) {
    notes.push({ label: "Loan installments 14d", amountBase: locked14dLoans, kind: "loan" });
  }
  if (locked14dPlanned > 0) {
    notes.push({ label: "Planned spends 14d", amountBase: locked14dPlanned, kind: "planned" });
  }
  if (walletTotalBase < flex7dRecurring + flex7dLoans) {
    notes.push({ label: "Wallets vs locked 7d", amountBase: walletTotalBase, kind: "wallet" });
  }

  if (!active) {
    // Not in storm/gust — return a quiet read so the surface can decide to hide.
    return {
      active: false,
      locked14dBase,
      flexPerDayBase,
      walletTotalBase,
      runwayDays,
      oneMove: "",
      notes,
      fromAi: false,
    };
  }

  // Fallback move — deterministic. Only used if AI is offline / fails.
  let oneMove = fallbackOneMove({ inputs, locked14dBase, flexPerDayBase, walletTotalBase, runwayDays });
  let fromAi = false;

  if (hasGemini()) {
    try {
      const snapshot = buildSnapshot({ inputs, locked14dBase, flexPerDayBase, walletTotalBase, runwayDays, notes });
      const res = await gemini().models.generateContent({
        model: HEAVY_MODEL,
        contents: `Snapshot:\n\n${snapshot}\n\nReturn JSON.`,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          temperature: 0.45,
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
        },
      });
      const parsed = JSON.parse((res.text ?? "{}").trim()) as { oneMove?: string };
      if (parsed.oneMove && parsed.oneMove.trim().length > 0) {
        oneMove = parsed.oneMove.trim();
        fromAi = true;
      }
    } catch {
      // Fall through to deterministic move.
    }
  }

  return {
    active,
    locked14dBase,
    flexPerDayBase,
    walletTotalBase,
    runwayDays,
    oneMove,
    notes,
    fromAi,
  };
}

function fallbackOneMove(args: {
  inputs: TightModeInputs;
  locked14dBase: number;
  flexPerDayBase: number;
  walletTotalBase: number;
  runwayDays: number;
}): string {
  const m = (n: number) => formatMoney(n, "PHP", { compact: true });
  const planned = args.inputs.plannedSpends.filter((p) => p.status === "planned" || p.status === "active");
  const biggestPlan = planned.sort((a, b) => Number(b.expected_base ?? 0) - Number(a.expected_base ?? 0))[0];
  if (biggestPlan && Number(biggestPlan.expected_base ?? 0) > 5000) {
    return `Defer or downsize ${biggestPlan.label} (${m(Number(biggestPlan.expected_base ?? 0))}) so the runway widens past ${args.runwayDays + 14}d.`;
  }
  if (args.locked14dBase > args.walletTotalBase) {
    return `Log any missed spends or payments first — locked ${m(args.locked14dBase)} already exceeds the ${m(args.walletTotalBase)} on hand, so reality is probably less tight than this reads.`;
  }
  return `Slow discretionary to ${m(args.flexPerDayBase)}/day for the next 7 days — that gives the runway room to breathe without touching essentials.`;
}

// Fingerprint = same financial-input surface as safe-to-spend +
// calm_weather band, since tight-mode reads both. A change to any of these
// busts the cache via trigger #4 even if invalidateAiSafeSpendCache missed.
async function tightModeFingerprint(inputs: TightModeInputs): Promise<string> {
  const sortedSpends = [...inputs.spends]
    .sort((a, b) => b.spent_at.localeCompare(a.spent_at))
    .slice(0, 5)
    .map((s) => s.id);
  const lastPayment = [...inputs.payments]
    .sort((a, b) => b.paid_at.localeCompare(a.paid_at))[0]?.id ?? null;
  const lastWithdrawal = [...inputs.withdrawals]
    .sort((a, b) => b.withdrawn_at.localeCompare(a.withdrawn_at))[0]?.id ?? null;
  const lastPlanned = [...inputs.plannedSpends]
    .sort((a, b) =>
      (b.updated_at ?? b.created_at ?? "").localeCompare(a.updated_at ?? a.created_at ?? ""),
    )[0]?.id ?? null;
  const band = inputs.calmWeather?.band ?? "(none)";
  return fingerprintFromIds([
    ...sortedSpends,
    lastPayment,
    lastWithdrawal,
    lastPlanned,
    `band:${band}`,
    ...inputs.methods.map((m) => m.id),
  ]);
}

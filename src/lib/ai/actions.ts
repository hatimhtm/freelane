"use server";

import { Type } from "@google/genai";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { phtDateString } from "@/lib/utils";
import { gemini, MODEL, hasGemini } from "./gemini";
import { methodLeaderboard, chainSignature, sortedSteps, monthlyFeeBase, holdingBalances } from "@/lib/payment-chain";
import { computeWalletBalancesFromLedger } from "@/lib/data/wallet-balance";
import { logLedgerReadFailure } from "@/lib/data/money-ledger";
import {
  cashflowMetrics,
  outstanding,
  landedInRange,
  spendsInRange,
  spendsByCategoryInRange,
  recurringExpectedInRange,
} from "@/lib/dashboard-calc";
import { formatMoney, toBase } from "@/lib/money";
import { linksBySpend, businessPersonalSplit, totalVatBase } from "@/lib/spends";
import { loansWithBalance, totalOwedBase, totalLentBase } from "@/lib/loans";
import { pendingRecurringNow } from "@/lib/recurring";
import { safeToSpend } from "@/lib/safe-to-spend";
import { PH_COL_CONTEXT } from "@/lib/ph-col";
import { getDashboardData, getUserMemory } from "@/lib/data/queries";
import { recordUserMemoryNote } from "@/lib/data/actions";
import {
  computeSafeToSpendInsight,
  type SafeToSpendOverlay,
} from "./safe-to-spend-ai";
import type {
  Client,
  CurrencyCode,
  ExchangeRate,
  Loan,
  LoanInstallment,
  Payment,
  PaymentMethod,
  PaymentStep,
  PlannedSpend,
  Project,
  RecurringSpend,
  RecurringSpendSkip,
  Settings,
  Spend,
  SpendCategory,
  SpendCategoryLink,
  UserMemoryConsolidated,
  Withdrawal,
} from "@/lib/supabase/types";

export type MoneyInsight = { title: string; detail: string; kind: "routing" | "anomaly" | "forecast" | "chase" | "note" };

type DbClient = Awaited<ReturnType<typeof createClient>>;

// ONE snapshot of the whole ledger + the spending engine — clients + their
// living memory, every outstanding balance, payment chains and rail costs,
// recurring fees, cashflow numbers PLUS: spending breakdown (categories,
// business/personal, VAT), wallet running balances, recurring schedules and
// what's pending right now, loans with installments, the rule-based
// safe-to-spend baseline (incl. recovery state), the user's running memory,
// the PH cost-of-living priors, and explicit data-availability notes so the
// AI knows when it's still learning. "Ask your money", focus, insights, and
// the spending-insight engine all read from this.
async function buildLedgerSnapshot(userId: string, supabase: DbClient): Promise<string> {
  const [
    settingsR,
    paymentsR,
    projectsR,
    clientsR,
    ratesR,
    methodsR,
    withdrawalsR,
    spendsR,
    spendCategoriesR,
    spendLinksR,
    recurringR,
    recurringSkipsR,
    loansR,
    loanInstallmentsR,
    userMemoryR,
    plannedSpendsR,
  ] = await Promise.all([
    supabase.from("settings").select("*").eq("user_id", userId).maybeSingle(),
    supabase.from("payments").select("*").eq("user_id", userId).order("paid_at", { ascending: false }),
    supabase.from("projects").select("*").eq("user_id", userId),
    supabase.from("clients").select("*").eq("user_id", userId),
    supabase.from("exchange_rates").select("*").eq("user_id", userId),
    supabase.from("payment_methods").select("*").eq("user_id", userId),
    supabase.from("withdrawals").select("*").eq("user_id", userId).order("withdrawn_at", { ascending: false }),
    supabase.from("spends").select("*").eq("user_id", userId).order("spent_at", { ascending: false }),
    supabase.from("spend_categories").select("*").eq("user_id", userId).order("sort_order"),
    supabase.from("spend_category_links").select("*"),
    supabase.from("recurring_spends").select("*").eq("user_id", userId).order("label"),
    supabase.from("recurring_spend_skips").select("*"),
    supabase.from("loans").select("*").eq("user_id", userId).order("borrowed_at", { ascending: false }),
    supabase.from("loan_installments").select("*").order("due_date"),
    supabase.from("user_memory").select("*").eq("user_id", userId).maybeSingle(),
    supabase.from("planned_spends").select("*").eq("user_id", userId),
  ]);
  const settings = settingsR.data as Settings | null;
  const currency = (settings?.base_currency ?? "PHP") as CurrencyCode;
  const payments = (paymentsR.data ?? []) as Payment[];
  const projects = (projectsR.data ?? []) as Project[];
  const clients = (clientsR.data ?? []) as Client[];
  const rates = (ratesR.data ?? []) as ExchangeRate[];
  const methods = (methodsR.data ?? []) as PaymentMethod[];
  const withdrawals = (withdrawalsR.data ?? []) as Withdrawal[];
  const spends = (spendsR.data ?? []) as Spend[];
  const spendCategories = (spendCategoriesR.data ?? []) as SpendCategory[];
  const spendCategoryLinks = (spendLinksR.data ?? []) as SpendCategoryLink[];
  const recurring = (recurringR.data ?? []) as RecurringSpend[];
  const recurringSkips = (recurringSkipsR.data ?? []) as RecurringSpendSkip[];
  const plannedSpends = (plannedSpendsR.data ?? []) as PlannedSpend[];
  const loans = (loansR.data ?? []) as Loan[];
  const loanInstallments = (loanInstallmentsR.data ?? []) as LoanInstallment[];
  const userMemoryRow = userMemoryR.data as { memory_consolidated?: UserMemoryConsolidated } | null;
  const userMemory = (userMemoryRow?.memory_consolidated ?? {}) as UserMemoryConsolidated;

  const stepsRes = await supabase
    .from("payment_steps")
    .select("*")
    .in("payment_id", payments.length ? payments.map((p) => p.id) : ["00000000-0000-0000-0000-000000000000"]);
  const stepsByPayment = new Map<string, PaymentStep[]>();
  ((stepsRes.data ?? []) as PaymentStep[]).forEach((s) => {
    const arr = stepsByPayment.get(s.payment_id) ?? [];
    arr.push(s);
    stepsByPayment.set(s.payment_id, arr);
  });

  const now = new Date();
  const DAY = 86_400_000;
  const startMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const start30 = new Date(now.getTime() - 30 * DAY);
  const horizonEnd = new Date(now.getTime() + 30 * DAY);

  const metrics = cashflowMetrics(payments, now, 0, withdrawals);
  const rows = outstanding(projects, payments, clients, rates);
  const projectsById = new Map(projects.map((p) => [p.id, p]));
  const methodsById = new Map(methods.map((m) => [m.id, m]));
  const leaderboard = methodLeaderboard(payments, stepsByPayment, methodsById, rates);
  // Phase 1.5: ledger reader first; thread through safeToSpend below.
  const actionsLedgerBalanceMap = await computeWalletBalancesFromLedger(methods).catch(
    (err) => {
      const message = err instanceof Error ? err.message : String(err);
      void logLedgerReadFailure(`actions wallet-balance read: ${message}`);
      return new Map();
    },
  );
  const actionsLedgerBalanceForChain = new Map<string, number>();
  for (const [k, v] of actionsLedgerBalanceMap) actionsLedgerBalanceForChain.set(k, v.balance);
  const holdings = holdingBalances(methods, payments, stepsByPayment, withdrawals, spends, actionsLedgerBalanceForChain);

  const m = (n: number) => formatMoney(n, currency, { compact: true });

  const perClient = clients.map((c) => {
    const ids = new Set(projects.filter((p) => p.client_id === c.id).map((p) => p.id));
    const landed = payments.filter((p) => ids.has(p.project_id)).reduce((s, p) => s + Number(p.net_amount_base ?? 0), 0);
    const owed = rows.filter((r) => r.client?.id === c.id).reduce((s, r) => s + r.outstandingBase, 0);
    const last = payments.filter((p) => ids.has(p.project_id)).map((p) => p.paid_at).sort().pop();
    const mem = c.memory_consolidated ?? {};
    const memBits = [
      mem.summary,
      ...(mem.facts ?? []).map((f) => `fact: ${f}`),
      ...(mem.watch ?? []).map((w) => `⚠ ${w}`),
    ].filter(Boolean).join("; ");
    return `- ${c.name}: landed ${m(landed)}, owes ${m(owed)}, last paid ${last ?? "never"}${c.short_description ? ` · ${c.short_description}` : ""}${memBits ? ` · MEMORY: ${memBits}` : ""}`;
  });

  const recent = payments.slice(0, 12).map((p) => {
    const proj = projectsById.get(p.project_id);
    const sig = chainSignature(sortedSteps(stepsByPayment.get(p.id) ?? []), methodsById);
    const gross = Number(p.gross_at_market_base ?? 0);
    const feeStr = p.fee_unknown
      ? "fee unknown — excluded from fee stats"
      : (() => {
          const pct = gross > 0 ? (Number(p.implied_fee_base ?? 0) / gross) * 100 : 0;
          return `fee ${m(Number(p.implied_fee_base ?? 0))}, ${pct.toFixed(1)}%`;
        })();
    return `- ${p.paid_at}: ${proj?.title ?? "?"} via ${sig} → ${m(Number(p.net_amount_base ?? 0))} net (${feeStr})`;
  });

  // ── Spending engine ──
  const linkIndex = linksBySpend(spendCategoryLinks);
  const catNameById = new Map(spendCategories.map((c) => [c.id, c.name]));
  const spendsMtd = spends.filter((sp) => new Date(sp.spent_at) >= startMonth);
  const spends30 = spends.filter((sp) => new Date(sp.spent_at) >= start30);
  const totalSpendMtd = spendsInRange(spends, startMonth, now);
  const totalSpend30 = spendsInRange(spends, start30, now);
  const split30 = businessPersonalSplit(spends30);
  const vat30 = totalVatBase(spends30, rates);
  const catTotalsMtd = spendsByCategoryInRange(spends, linkIndex, startMonth, now)
    .slice(0, 8)
    .map((t) => `${catNameById.get(t.categoryId) ?? "untagged"} ${m(t.total)}`);
  const catTotals30 = spendsByCategoryInRange(spends, linkIndex, start30, now)
    .slice(0, 8)
    .map((t) => `${catNameById.get(t.categoryId) ?? "untagged"} ${m(t.total)}`);
  const recentSpends = spends.slice(0, 10).map((sp) => {
    const cats = (linkIndex.get(sp.id) ?? []).map((id) => catNameById.get(id) ?? "?").join("/");
    return `- ${sp.spent_at.slice(0, 10)}: ${sp.description ?? "?"} ${m(Number(sp.amount_base ?? 0))}${cats ? ` [${cats}]` : ""}${sp.business_relevant ? " · biz" : ""}`;
  });

  // ── Recurring schedule snapshot ──
  const pending = pendingRecurringNow(recurring, recurringSkips, now);
  const pendingIds = new Set(pending.map((p) => p.rule.id));
  const recurringLines = recurring
    .filter((r) => r.active)
    .map((r) => {
      const expectedBase = toBase(Number(r.expected_amount), r.expected_currency as CurrencyCode, rates);
      const live = pending.find((p) => p.rule.id === r.id);
      const due = live ? ` · DUE NOW (anchor ${phtDateString(live.anchor)})` : "";
      return `- ${r.label} (${r.schedule_kind}): expected ${m(expectedBase)}${due}`;
    });
  const recurringForward = recurringExpectedInRange(recurring, recurringSkips, rates, now, horizonEnd);

  // ── Loans ──
  const lwb = loansWithBalance(loans, loanInstallments, spends, now);
  const owedBase = totalOwedBase(lwb);
  const lentBase = totalLentBase(lwb);
  const loanLines = lwb
    .filter((l) => l.derivedStatus !== "closed")
    .slice(0, 8)
    .map((l) => {
      const nextDue = l.upcoming[0];
      const next = nextDue
        ? ` · next ${nextDue.due_date}: ${m(toBase(Number(nextDue.expected_amount), nextDue.expected_currency as CurrencyCode, rates))}`
        : "";
      const od = l.overdue.length ? ` · ${l.overdue.length} OVERDUE` : "";
      return `- ${l.loan.counterparty} (${l.loan.direction}): balance ${m(l.balanceBase)}${next}${od}`;
    });

  // ── Safe-to-spend baseline (rule-based — the AI layer's overlay tunes it) ──
  // Pass plannedSpends so the AI's baseline matches the headline the user
  // sees on Today / Dashboard / Spending / Plans. Without it the AI quoted a
  // higher safeTodayBase than the user saw.
  const sts = safeToSpend({
    payments,
    withdrawals,
    spends,
    recurring,
    recurringSkips,
    loanInstallments,
    methods,
    stepsByPayment,
    rates,
    plannedSpends,
    ledgerBalances: actionsLedgerBalanceForChain,
    now,
  });

  // ── Data availability — how much history the AI is reasoning over ──
  const oldestSpend = spends.length ? new Date(spends[spends.length - 1].spent_at).getTime() : null;
  const oldestPayment = payments.length ? new Date(payments[payments.length - 1].paid_at).getTime() : null;
  const oldest = [oldestSpend, oldestPayment].filter((v): v is number => v !== null).sort()[0] ?? null;
  const observationDays = oldest === null ? 0 : Math.max(0, Math.round((now.getTime() - oldest) / DAY));

  // ── User memory (the AI's running notebook on the user) ──
  const memBits = [
    userMemory.summary ? `summary: ${userMemory.summary}` : "",
    ...(userMemory.patterns ?? []).map((p) => `pattern: ${p}`),
    ...(userMemory.watch ?? []).map((w) => `watch: ${w}`),
    ...(userMemory.milestones ?? []).map((ms) => `milestone: ${ms}`),
  ].filter(Boolean);
  const prefs = userMemory.preferences ?? {};
  const prefLines = Object.entries(prefs).map(([k, v]) => `pref ${k}: ${v}`);

  return `Base currency: ${currency}. Today: ${phtDateString(now)}.

DATA AVAILABILITY:
- Observations: ~${observationDays}d of history
- Spends logged: ${spends.length}
- Payments logged: ${payments.length}
- Active recurring rules: ${recurring.filter((r) => r.active).length}
- Open loans: ${lwb.filter((l) => l.derivedStatus !== "closed").length}

CASHFLOW — this month landed ${m(metrics.mtd)} (MoM ${metrics.momDelta === null ? "n/a" : (metrics.momDelta * 100).toFixed(0) + "%"}); last month ${m(metrics.lastMonth)}; this week ${m(metrics.wtd)} (last week ${m(metrics.lastWeek)}); YTD ${m(metrics.ytd)}; fees this month ${m(metrics.feesMtd)}.
trailing 30d income: ${m(landedInRange(payments, start30, now))}.
TOTAL OUTSTANDING: ${m(rows.reduce((s, r) => s + r.outstandingBase, 0))} across ${rows.length} projects.

SPENDING — this month ${m(totalSpendMtd)} (${spendsMtd.length} spends); trailing 30d ${m(totalSpend30)} (${spends30.length} spends).
30d split: personal ${m(split30.personal)} · business ${m(split30.business)} · VAT ${m(vat30)}.
TOP CATEGORIES this month: ${catTotalsMtd.join(", ") || "none yet"}.
TOP CATEGORIES last 30d: ${catTotals30.join(", ") || "none yet"}.

RECENT SPENDS:
${recentSpends.join("\n") || "- none yet"}

WALLET BALANCES (received − withdrawn − spent, base ${currency}):
${holdings.length ? holdings.map((h) => `- ${h.name}: ${m(h.balance)} (received ${m(h.received)}, withdrawn ${m(h.withdrawn)})`).join("\n") : "- nothing parked"}
${withdrawals.length ? `WITHDRAWAL FEES: ${m(withdrawals.reduce((s, w) => s + Number(w.fee_base ?? 0), 0))} total across ${withdrawals.length} withdrawals (count as fees).` : ""}

RECURRING SCHEDULES (active rules):
${recurringLines.join("\n") || "- none"}
PENDING NOW (in window, not yet settled): ${pendingIds.size}
RECURRING FORWARD (next 30d expected): ${m(recurringForward)}.

LOANS — owe others ${m(owedBase)} · lent ${m(lentBase)}.
${loanLines.join("\n") || "- no open loans"}

SAFE-TO-SPEND BASELINE (rolling ${sts.horizonDays}d horizon, COL floor ${m(sts.colFloorBase)}/day):
- safe today: ${m(sts.safeTodayBase)} (rule-based, before AI overlay)
- daily allowance: ${m(sts.dailyAllowanceBase)} · discretionary pool ${m(sts.discretionaryPoolBase)}
- wallet balances ${m(sts.walletBalancesBase)} · committed pool ${m(sts.committedPoolBase)} (recurring ${m(sts.recurringForwardBase)} + loans ${m(sts.loanForwardBase)} + feeFloor ${m(sts.feeFloorBase)})
- stability ${sts.stabilityScore.toFixed(2)} (mult ×${sts.stabilityMultiplier.toFixed(2)}) · ${sts.isLearning ? "STILL LEARNING (sparse income)" : "calibrated"}
- ${sts.inRecovery ? `RECOVERY MODE — overspend ${m(sts.trailingOverspendBase)}, tax ${m(sts.recoveryDailyTaxBase)}/day` : "not in recovery"}

USER MEMORY (the AI's running notebook on the user):
${memBits.length ? memBits.map((b) => `- ${b}`).join("\n") : "- (none yet — still learning)"}
${prefLines.length ? prefLines.map((p) => `- ${p}`).join("\n") : ""}

CLIENTS (with AI memory):
${perClient.join("\n") || "- none"}

OUTSTANDING (most urgent first = amount × days waiting):
${rows.slice(0, 10).map((r) => `- ${r.client?.name ?? "?"}: ${r.project.title} ${formatMoney(r.outstandingNative, r.project.currency as CurrencyCode)} (${r.daysAged}d${r.project.flagged_overdue ? ", FLAGGED" : ""})`).join("\n") || "- none"}

PAYMENT ROUTES by effective fee (cheapest first):
${leaderboard.slice(0, 8).map((l) => `- ${l.signature}: ${(l.effectivePct * 100).toFixed(1)}% over ${l.count} payments (${m(l.volumeBase)})${l.monthlyFeesBase > 0 ? ` + ${m(l.monthlyFeesBase)}/mo fixed` : ""}`).join("\n") || "- none tagged yet"}

METHODS: ${methods.map((mm) => { const f = monthlyFeeBase(mm, rates); return `${mm.name}${f > 0 ? ` (${m(f)}/mo)` : ""}`; }).join(", ") || "none"}

RECENT PAYMENTS (with chain + fee):
${recent.join("\n") || "- none"}

PH COST-OF-LIVING PRIORS:
${PH_COL_CONTEXT}`;
}

const INSIGHT_SYSTEM = `You are a sharp, plain-spoken financial co-pilot for a SOLO freelancer who invoices clients abroad in various currencies and settles into one base currency (shown in the snapshot — use that currency's symbol/code, never assume).

You get a snapshot: landed income this/last month, outstanding balances, fees per payment chain (including any fixed monthly fees), top clients, and per-client watch flags. Surface 1–3 CONCRETE insights worth acting on today.

HARD RULES:
1. 1 to 3 insights. Quality over quantity. If nothing's notable, return 1 calm "note".
2. Reference REAL numbers from the snapshot (amounts in the base currency, %, client/method names). Never invent figures.
3. title ≤ 8 words. detail ≤ 24 words, imperative or diagnostic, no filler ("I recommend", "you should consider").
4. Prefer: routing tips (cheaper payment chain — account for monthly fees, not just %), fee anomalies, who to chase (use watch flags + aging), or a one-line cashflow read.
5. ALSO surface: spending anomalies (category drift vs trailing 30d / user memory), RECOVERY-mode flags from the safe-to-spend baseline, recurring drift (rule with anchor passing without a paid spend), and loan-installment urgency (overdue or due within ~7d).
6. If DATA AVAILABILITY shows < 21d of observations or < 5 spends/payments, prefer "note" insights that acknowledge sparse data instead of forecasting.
7. No tax advice. No flattery.`;

const INSIGHT_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    insights: {
      type: Type.ARRAY,
      minItems: 1,
      maxItems: 3,
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          detail: { type: Type.STRING },
          kind: { type: Type.STRING, enum: ["routing", "anomaly", "forecast", "chase", "note"] },
        },
        required: ["title", "detail", "kind"],
        propertyOrdering: ["title", "detail", "kind"],
      },
    },
  },
  required: ["insights"],
  propertyOrdering: ["insights"],
};

export async function generateMoneyInsights(): Promise<{ ok: boolean; insights: MoneyInsight[]; error?: string }> {
  if (!hasGemini()) return { ok: false, insights: [], error: "Gemini isn't configured." };
  const user = await getAuthUser();
  if (!user) return { ok: false, insights: [], error: "Unauthenticated" };
  const supabase = await createClient();
  const snapshot = await buildLedgerSnapshot(user.id, supabase);

  try {
    const res = await gemini().models.generateContent({
      model: MODEL,
      contents: `Snapshot:\n\n${snapshot}\n\nReturn 1–3 insights as JSON.`,
      config: {
        systemInstruction: INSIGHT_SYSTEM,
        temperature: 0.4,
        responseMimeType: "application/json",
        responseSchema: INSIGHT_SCHEMA,
      },
    });
    const parsed = JSON.parse((res.text ?? "{}").trim());
    return { ok: true, insights: (parsed.insights ?? []).slice(0, 3) as MoneyInsight[] };
  } catch (err) {
    return { ok: false, insights: [], error: (err as Error).message };
  }
}

// ───────────────────────────────────────── Today's Focus (cached) ──
// Reads the cache instantly; regenerates on demand or when older than 24h.

export async function readFocusCache(): Promise<{ insights: MoneyInsight[]; generatedAt: string | null }> {
  const user = await getAuthUser();
  if (!user) return { insights: [], generatedAt: null };
  const supabase = await createClient();
  const { data } = await supabase
    .from("ai_focus_cache")
    .select("insights,generated_at")
    .eq("user_id", user.id)
    .maybeSingle();
  return {
    insights: ((data?.insights as MoneyInsight[]) ?? []),
    generatedAt: (data?.generated_at as string) ?? null,
  };
}

export async function getDailyFocus(
  opts: { force?: boolean } = {},
): Promise<{ ok: boolean; insights: MoneyInsight[]; generatedAt: string | null; error?: string }> {
  if (!hasGemini()) return { ok: false, insights: [], generatedAt: null, error: "Gemini isn't configured." };
  const user = await getAuthUser();
  if (!user) return { ok: false, insights: [], generatedAt: null, error: "Unauthenticated" };
  const supabase = await createClient();

  if (!opts.force) {
    const { data } = await supabase
      .from("ai_focus_cache")
      .select("insights,generated_at")
      .eq("user_id", user.id)
      .maybeSingle();
    if (data?.generated_at) {
      const ageHours = (Date.now() - new Date(data.generated_at as string).getTime()) / 3_600_000;
      if (ageHours < 24) {
        return { ok: true, insights: ((data.insights as MoneyInsight[]) ?? []), generatedAt: data.generated_at as string };
      }
    }
  }

  const snapshot = await buildLedgerSnapshot(user.id, supabase);
  try {
    const res = await gemini().models.generateContent({
      model: MODEL,
      contents: `Snapshot:\n\n${snapshot}\n\nReturn 1–3 insights as JSON.`,
      config: {
        systemInstruction: INSIGHT_SYSTEM,
        temperature: 0.4,
        responseMimeType: "application/json",
        responseSchema: INSIGHT_SCHEMA,
      },
    });
    const parsed = JSON.parse((res.text ?? "{}").trim());
    const insights = ((parsed.insights ?? []).slice(0, 3)) as MoneyInsight[];
    const generatedAt = new Date().toISOString();
    await supabase.from("ai_focus_cache").upsert({ user_id: user.id, insights, generated_at: generatedAt }, { onConflict: "user_id" });
    return { ok: true, insights, generatedAt };
  } catch (err) {
    return { ok: false, insights: [], generatedAt: null, error: (err as Error).message };
  }
}

const ASK_SYSTEM = `You are the personal money analyst for a SOLO freelancer who invoices abroad in various currencies and settles into one base currency (shown in the snapshot — use that currency, never assume PHP). Answer their question using ONLY the snapshot provided.

RULES:
- Be concise: 1–4 sentences. Lead with the answer.
- Cite real numbers (amounts in the base currency, %, dates, client/method names) straight from the snapshot.
- If the snapshot can't answer it, say so plainly and suggest what to log.
- Plain, warm, sharp. No tax advice, no disclaimers, no "as an AI".`;

// "Ask your money" — natural-language Q&A grounded in a full snapshot of the
// ledger. The creative front door to everything the data knows.
export async function askYourMoney(question: string): Promise<{ ok: boolean; answer?: string; error?: string }> {
  if (!hasGemini()) return { ok: false, error: "Gemini isn't configured." };
  const q = question.trim();
  if (!q) return { ok: false, error: "Ask something first." };
  const user = await getAuthUser();
  if (!user) return { ok: false, error: "Unauthenticated" };
  const supabase = await createClient();

  const snapshot = await buildLedgerSnapshot(user.id, supabase);

  try {
    const res = await gemini().models.generateContent({
      model: MODEL,
      contents: `Snapshot:\n${snapshot}\n\nQuestion: ${q}`,
      config: { systemInstruction: ASK_SYSTEM, temperature: 0.4 },
    });
    return { ok: true, answer: (res.text ?? "").trim() };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

const FOLLOWUP_SYSTEM = `You draft a short follow-up message a freelancer sends a client about an unpaid balance.

RULES:
- 2–4 sentences. Warm, professional, never pushy or guilt-trippy.
- Match the tone implied by the client memory (e.g. casual with a long-time boss, more formal with a new client).
- Mention the project and amount naturally; reference how long it's been only if it helps.
- Write in the relationship's language if the memory says so (e.g. French), else English.
- Return ONLY the message text — no preamble, no signature placeholder, no quotes.`;

export async function draftFollowUp(clientId: string): Promise<{ ok: boolean; message?: string; error?: string }> {
  if (!hasGemini()) return { ok: false, error: "Gemini isn't configured." };
  const user = await getAuthUser();
  if (!user) return { ok: false, error: "Unauthenticated" };
  const supabase = await createClient();

  const [clientR, projectsR, paymentsR, ratesR, settingsR] = await Promise.all([
    supabase.from("clients").select("*").eq("id", clientId).eq("user_id", user.id).maybeSingle(),
    supabase.from("projects").select("*").eq("user_id", user.id).eq("client_id", clientId),
    supabase.from("payments").select("*").eq("user_id", user.id),
    supabase.from("exchange_rates").select("*").eq("user_id", user.id),
    supabase.from("settings").select("*").eq("user_id", user.id).maybeSingle(),
  ]);
  const client = clientR.data as Client | null;
  if (!client) return { ok: false, error: "Client not found" };
  const projects = (projectsR.data ?? []) as Project[];
  const payments = (paymentsR.data ?? []) as Payment[];
  const rates = (ratesR.data ?? []) as ExchangeRate[];

  const rows = outstanding(projects, payments, [client], rates);
  const top = rows[0];
  if (!top) return { ok: false, error: "Nothing outstanding for this client." };

  const mem = client.memory_consolidated ?? {};
  const memText = [mem.summary, ...(mem.facts ?? []), ...(mem.watch ?? [])].filter(Boolean).join("; ");

  const prompt = `Client: ${client.name}${client.short_description ? ` (${client.short_description})` : ""}
Memory: ${memText || "none"}
Unpaid: ${top.project.title} — ${formatMoney(top.outstandingNative, top.project.currency as CurrencyCode)}, ${top.daysAged} days since quoted.

Draft the follow-up message.`;

  try {
    const res = await gemini().models.generateContent({
      model: MODEL,
      contents: prompt,
      config: { systemInstruction: FOLLOWUP_SYSTEM, temperature: 0.6 },
    });
    return { ok: true, message: (res.text ?? "").trim() };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// ───────────────────────────────────────── Safe-to-spend AI overlay ──
// Pulls the same dashboard snapshot the UI uses + the user's running memory
// and delegates to computeSafeToSpendInsight. The rule-based baseline lives
// inside that call — we only wire data + cache policy here.

export async function getSafeToSpendInsight(
  opts: { force?: boolean; justLandedNetBase?: number } = {},
): Promise<SafeToSpendOverlay> {
  const data = await getDashboardData();
  const { memory } = await getUserMemory();
  return computeSafeToSpendInsight({
    inputs: {
      payments: data.payments,
      withdrawals: data.withdrawals,
      spends: data.spends,
      recurring: data.recurring,
      recurringSkips: data.recurringSkips,
      loanInstallments: data.loanInstallments,
      methods: data.methods,
      stepsByPayment: data.stepsByPayment,
      rates: data.rates,
    },
    userMemory: memory?.memory_consolidated ?? undefined,
    spendCategories: data.spendCategories,
    spendCategoryLinks: data.spendCategoryLinks,
    loans: data.loans,
    loanInstallments: data.loanInstallments,
    justLandedNetBase: opts.justLandedNetBase,
    force: opts.force,
  });
}

// ───────────────────────────────────────── User memory (wrappers) ──
// recordUserMemoryNote already triggers consolidation via dynamic import, so
// this action is a thin server-side entry point for UI forms. The dynamic
// import here keeps the AI layer out of the data/actions module graph.

export async function recordUserNoteAction(content: string): Promise<void> {
  await recordUserMemoryNote(content);
  try {
    const mod = await import("./user-memory");
    if (typeof mod.consolidateUserMemory === "function") {
      await mod.consolidateUserMemory();
    }
  } catch {
    // No-op: consolidation retries on the next note or memory-touching event.
  }
}

export async function consolidateUserMemoryAction(): Promise<void> {
  try {
    const mod = await import("./user-memory");
    if (typeof mod.consolidateUserMemory === "function") {
      await mod.consolidateUserMemory();
    }
  } catch {
    // Silently no-op — the memory simply stays at its previous fold.
  }
}

// ───────────────────────────────────────── Spending insights ──
// Same shape as generateMoneyInsights, but focused on SPENDING patterns
// (anomalies, recovery, recurring drift, loan urgency) rather than routing.
// Reads the same extended snapshot so the model sees the full picture.

const SPENDING_INSIGHT_SYSTEM = `You are a sharp, plain-spoken money co-pilot for a SOLO freelancer in the Philippines (base PHP). You see the full ledger PLUS the spending engine: trailing 30d spend by category, business/personal split, VAT total, every recurring rule + pending/forward, every open loan with installments, wallet balances, the rule-based safe-to-spend baseline (including recovery state), and the user's running memory.

Surface 1-3 CONCRETE insights about SPENDING — not invoicing routing. Examples of GOOD insights:
- "Groceries 35% above your trailing 30d" / anomaly
- "Rent window opens in 3 days, ₱15,000 expected" / forecast
- "Recovery mode active — discretionary lean for ~14d" / forecast
- "Maria loan ₱2,000 installment 2d overdue" / chase
- "VAT recoverable ₱1,240 this month" / note

HARD RULES:
1. 1 to 3 insights. Quality over quantity. If nothing's notable, return 1 calm "note".
2. Reference REAL numbers from the snapshot (₱ amounts, %, category/rule/loan names). NEVER invent figures.
3. title ≤ 8 words. detail ≤ 24 words, imperative or diagnostic. No filler.
4. Prefer: category drift vs trailing baseline OR user memory, pending recurring inside the next ~7d, overdue loan installments, recovery-mode flags, VAT-recoverable signals.
5. If DATA AVAILABILITY shows < 21d of observations or < 5 spends: return ONE "note" acknowledging the cold start, no forecasts.
6. Respect the PH cost-of-living floor — NEVER suggest cuts to essentials.
7. No tax advice. No flattery. No therapy.`;

export async function generateSpendingInsight(): Promise<{ ok: boolean; insights: MoneyInsight[]; error?: string }> {
  if (!hasGemini()) return { ok: false, insights: [], error: "Gemini isn't configured." };
  const user = await getAuthUser();
  if (!user) return { ok: false, insights: [], error: "Unauthenticated" };
  const supabase = await createClient();
  const snapshot = await buildLedgerSnapshot(user.id, supabase);

  try {
    const res = await gemini().models.generateContent({
      model: MODEL,
      contents: `Snapshot:\n\n${snapshot}\n\nReturn 1–3 spending insights as JSON.`,
      config: {
        systemInstruction: SPENDING_INSIGHT_SYSTEM,
        temperature: 0.3,
        responseMimeType: "application/json",
        responseSchema: INSIGHT_SCHEMA,
      },
    });
    const parsed = JSON.parse((res.text ?? "{}").trim());
    return { ok: true, insights: (parsed.insights ?? []).slice(0, 3) as MoneyInsight[] };
  } catch (err) {
    return { ok: false, insights: [], error: (err as Error).message };
  }
}

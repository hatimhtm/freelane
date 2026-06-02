import "server-only";
import { phtDateString } from "@/lib/utils";
import { Type } from "@google/genai";
import { gemini, hasGemini, HEAVY_MODEL } from "./models";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { queueAiQuestion } from "./ai-questions";
import { PH_COL_CONTEXT } from "@/lib/ph-col";
import { toBase, formatMoney } from "@/lib/money";
import {
  chainSignature,
  sortedSteps,
  holdingBalances,
} from "@/lib/payment-chain";
import { computeWalletBalancesFromLedger } from "@/lib/data/wallet-balance";
import { logLedgerReadFailure } from "@/lib/data/money-ledger";
import {
  cashflowMetrics,
  landedInRange,
  spendsInRange,
  spendsByCategoryInRange,
  recurringExpectedInRange,
} from "@/lib/dashboard-calc";
import { linksBySpend, businessPersonalSplit } from "@/lib/spends";
import { loansWithBalance } from "@/lib/loans";
import { safeToSpend } from "@/lib/safe-to-spend";
import type {
  AiQuestion,
  AiQuestionKind,
  AiQuestionSourceType,
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
  UserMemory,
  UserMemoryConsolidated,
  UserMemoryEntry,
  Withdrawal,
} from "@/lib/supabase/types";

const DAY_MS = 86_400_000;
const MAX_OPEN_QUESTIONS = 10;
const RECENT_ANSWERED_LIMIT = 20;
const STALE_CLIENT_DAYS = 60;
const RECURRING_DRIFT_THRESHOLD = 0.1;
const LOAN_DUE_SOON_DAYS = 7;

const KNOWN_KINDS: readonly AiQuestionKind[] = [
  "clarify_spend",
  "clarify_payment",
  "clarify_client",
  "clarify_recurring",
  "clarify_loan",
  "clarify_investment",
  "clarify_revenue",
  "memory_gap",
  "restructure_suggestion",
  "deal_check",
  "coaching",
  "note_followup",
] as const;

const KNOWN_KIND_SET = new Set<string>(KNOWN_KINDS);

const KNOWN_SOURCE_TYPES = new Set<AiQuestionSourceType>([
  "spend",
  "payment",
  "client",
  "loan",
  "recurring_spend",
  "user_memory_entry",
]);

export const SYSTEM_PROMPT = `You are the curiosity loop of a life-OS for a SOLO freelancer in San Pablo, Laguna, Philippines (base PHP). Every periodic sweep you pick 1-5 things you WISH you knew to make the system sharper.

HARD RULES:
- Be PROACTIVE. Ask about ambiguity, gaps, drifts, anomalies. Read EVERY note (.notes field across spends/payments/loans/clients/user_memory) and FLAG references you cannot resolve.
- MIX kinds across the batch. Do NOT make all 5 clarify_spend. Cover: clarify_spend, clarify_payment, clarify_client, clarify_recurring, clarify_loan, clarify_investment, clarify_revenue, memory_gap, restructure_suggestion, deal_check, coaching, note_followup.
- restructure_suggestion is FOR DATA HYGIENE — propose merges of redundant categories, splits of overloaded ones, renames of unclear vendor tokens. The user confirms before any actual restructure happens.
- Each question must cite REAL data: a real spend amount + date, a real client name, a real category, a real note quote. NEVER invent.
- Priority 1-9: 1 = blocks today's decisions (e.g. loan due tomorrow with unclear repayment plan), 5 = useful curiosity, 9 = nice-to-know.
- Pre-fill options[] (answer chips) when applicable. E.g. for a category merge proposal: ["Merge them", "Keep separate", "Rename to..."].
- source_entity_type + source_entity_id when the question is ABOUT a specific row — so the UI can deep-link. Use the EXACT id from the snapshot.
- NEVER ask about things in the consolidated memory or recently answered/dismissed questions list. You HAVE that context — use it.
- Cold start (sparse data): pivot to ONBOARDING questions like "What's currently in your coin.ph wallet?" or "Any monthly subscriptions I should know about?". Use kind="memory_gap" + source_entity_type=null.
- Plain, warm, sharp. No "as an AI". No filler. No therapy.

PH COST-OF-LIVING PRIORS:
${PH_COL_CONTEXT}`;

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    questions: {
      type: Type.ARRAY,
      minItems: 1,
      maxItems: 5,
      items: {
        type: Type.OBJECT,
        properties: {
          question: { type: Type.STRING },
          kind: {
            type: Type.STRING,
            enum: [...KNOWN_KINDS],
          },
          context: { type: Type.OBJECT, nullable: true },
          options: {
            type: Type.ARRAY,
            nullable: true,
            items: { type: Type.STRING },
          },
          source_entity_type: { type: Type.STRING, nullable: true },
          source_entity_id: { type: Type.STRING, nullable: true },
          priority: { type: Type.INTEGER },
        },
        required: ["question", "kind", "priority"],
        propertyOrdering: [
          "question",
          "kind",
          "context",
          "options",
          "source_entity_type",
          "source_entity_id",
          "priority",
        ],
      },
    },
  },
  required: ["questions"],
  propertyOrdering: ["questions"],
};

type DbClient = Awaited<ReturnType<typeof createClient>>;

interface KnownEntityIndex {
  spend: Set<string>;
  payment: Set<string>;
  client: Set<string>;
  loan: Set<string>;
  recurring_spend: Set<string>;
  user_memory_entry: Set<string>;
}

interface SweepSnapshot {
  text: string;
  knownIds: KnownEntityIndex;
}

interface RawQuestion {
  question?: unknown;
  kind?: unknown;
  context?: unknown;
  options?: unknown;
  source_entity_type?: unknown;
  source_entity_id?: unknown;
  priority?: unknown;
}

function clampPriority(n: unknown): number {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return 5;
  return Math.max(1, Math.min(9, v));
}

function coerceKind(raw: unknown): AiQuestionKind {
  if (typeof raw === "string" && KNOWN_KIND_SET.has(raw)) {
    return raw as AiQuestionKind;
  }
  return "memory_gap";
}

function snippetNote(text: string | null | undefined, max = 60): string | null {
  if (!text) return null;
  const t = text.trim().replace(/\s+/g, " ");
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

async function buildCuriositySnapshot(
  userId: string,
  supabase: DbClient,
): Promise<SweepSnapshot> {
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
    memoryEntriesR,
    recentQuestionsR,
    plannedR,
  ] = await Promise.all([
    supabase.from("settings").select("*").eq("user_id", userId).maybeSingle(),
    supabase.from("payments").select("*").eq("user_id", userId).order("paid_at", { ascending: false }),
    supabase.from("projects").select("*").eq("user_id", userId),
    supabase.from("clients").select("*").eq("user_id", userId),
    supabase.from("exchange_rates").select("*").eq("user_id", userId),
    supabase.from("payment_methods").select("*").eq("user_id", userId),
    supabase.from("withdrawals").select("*").eq("user_id", userId),
    supabase.from("spends").select("*").eq("user_id", userId).order("spent_at", { ascending: false }),
    supabase.from("spend_categories").select("*").eq("user_id", userId).order("sort_order"),
    supabase.from("spend_category_links").select("*"),
    supabase.from("recurring_spends").select("*").eq("user_id", userId).order("label"),
    supabase.from("recurring_spend_skips").select("*"),
    supabase.from("loans").select("*").eq("user_id", userId).order("borrowed_at", { ascending: false }),
    supabase.from("loan_installments").select("*").order("due_date"),
    supabase.from("user_memory").select("*").eq("user_id", userId).maybeSingle(),
    supabase
      .from("user_memory_entries")
      .select("id,content,source,created_at,consolidated_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(40),
    supabase
      .from("ai_questions")
      .select("id,question,kind,answer,answered_at,dismissed_at,created_at")
      .eq("user_id", userId)
      .or("answered_at.not.is.null,dismissed_at.not.is.null")
      .order("created_at", { ascending: false })
      .limit(RECENT_ANSWERED_LIMIT),
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
  const loans = (loansR.data ?? []) as Loan[];
  const loanInstallments = (loanInstallmentsR.data ?? []) as LoanInstallment[];
  const userMemoryRow = userMemoryR.data as UserMemory | null;
  const memoryEntries = (memoryEntriesR.data ?? []) as UserMemoryEntry[];
  const recentQuestions = (recentQuestionsR.data ?? []) as Array<
    Pick<AiQuestion, "id" | "question" | "kind" | "answer" | "answered_at" | "dismissed_at">
  >;
  const plannedSpends = (plannedR.data ?? []) as PlannedSpend[];

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
  const startMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const start30 = new Date(now.getTime() - 30 * DAY_MS);
  const horizonEnd = new Date(now.getTime() + 30 * DAY_MS);
  const staleCutoff = new Date(now.getTime() - STALE_CLIENT_DAYS * DAY_MS);
  const soonCutoff = new Date(now.getTime() + LOAN_DUE_SOON_DAYS * DAY_MS);

  const m = (n: number) => formatMoney(n, currency, { compact: true });

  const methodsById = new Map(methods.map((mm) => [mm.id, mm]));
  const projectsById = new Map(projects.map((p) => [p.id, p]));
  const clientsById = new Map(clients.map((c) => [c.id, c]));
  const catNameById = new Map(spendCategories.map((c) => [c.id, c.name]));
  const linkIndex = linksBySpend(spendCategoryLinks);

  // ── Cashflow + spending overview ──
  const metrics = cashflowMetrics(payments, now, 0, withdrawals);
  const totalSpendMtd = spendsInRange(spends, startMonth, now);
  const totalSpend30 = spendsInRange(spends, start30, now);
  const split30 = businessPersonalSplit(spends.filter((sp) => new Date(sp.spent_at) >= start30));
  const catTotals30 = spendsByCategoryInRange(spends, linkIndex, start30, now);
  const topCats30 = catTotals30
    .slice(0, 8)
    .map((t) => `${catNameById.get(t.categoryId) ?? "untagged"} ${m(t.total)}`);

  // ── Stale clients ──
  const lastPaymentByClient = new Map<string, string>();
  for (const p of payments) {
    const proj = projectsById.get(p.project_id);
    if (!proj) continue;
    const prev = lastPaymentByClient.get(proj.client_id);
    if (!prev || p.paid_at > prev) lastPaymentByClient.set(proj.client_id, p.paid_at);
  }
  const staleClients = clients
    .filter((c) => !c.archived)
    .map((c) => {
      const last = lastPaymentByClient.get(c.id);
      return { client: c, lastPaidAt: last ?? null };
    })
    .filter((row) => {
      if (!row.lastPaidAt) return true;
      return new Date(row.lastPaidAt) < staleCutoff;
    });

  // ── Vague spends (description but no notes, or just a vendor token) ──
  const vagueSpends = spends
    .slice(0, 60)
    .filter((sp) => {
      const desc = (sp.description ?? "").trim();
      const notes = (sp.notes ?? "").trim();
      if (!desc && !notes) return true;
      if (desc && !notes && desc.length <= 12 && !desc.includes(" ")) return true;
      return false;
    })
    .slice(0, 10);

  // ── Payments with vague notes / fee_unknown / missing chain ──
  const vaguePayments = payments
    .slice(0, 40)
    .filter((p) => {
      if (p.fee_unknown) return true;
      const steps = stepsByPayment.get(p.id) ?? [];
      if (steps.length === 0) return true;
      const notes = (p.notes ?? "").trim();
      if (notes && /\b([A-Z]{2,4})\b/.test(notes)) return true;
      return false;
    })
    .slice(0, 8);

  // ── Recurring drift (paid amounts vs expected) ──
  const recurringDrift: string[] = [];
  for (const rule of recurring.filter((r) => r.active)) {
    const expectedBase = toBase(
      Number(rule.expected_amount),
      rule.expected_currency as CurrencyCode,
      rates,
    );
    const paidSpends = spends.filter((sp) => sp.recurring_spend_id === rule.id);
    if (paidSpends.length < 2) continue;
    const avgPaid =
      paidSpends.reduce((s, sp) => s + Number(sp.amount_base ?? 0), 0) / paidSpends.length;
    if (expectedBase <= 0) continue;
    const drift = Math.abs(avgPaid - expectedBase) / expectedBase;
    if (drift > RECURRING_DRIFT_THRESHOLD) {
      recurringDrift.push(
        `- ${rule.label} [id:${rule.id}]: expected ${m(expectedBase)}, avg paid ${m(avgPaid)} (${(drift * 100).toFixed(0)}% drift across ${paidSpends.length} settlements)`,
      );
    }
  }

  // ── Loans approaching due date / overdue ──
  const lwb = loansWithBalance(loans, loanInstallments, spends, now);
  const loanFlags = lwb
    .filter((l) => l.derivedStatus !== "closed")
    .map((l) => {
      const overdue = l.overdue;
      const dueSoon = l.upcoming.filter((i) => new Date(i.due_date) <= soonCutoff);
      const expectedReturn = l.loan.expected_return_by;
      const expectedSoon =
        expectedReturn && new Date(expectedReturn) <= soonCutoff && new Date(expectedReturn) >= now;
      if (overdue.length === 0 && dueSoon.length === 0 && !expectedSoon) return null;
      const parts: string[] = [];
      if (overdue.length) parts.push(`${overdue.length} OVERDUE`);
      if (dueSoon.length) parts.push(`${dueSoon.length} due in ${LOAN_DUE_SOON_DAYS}d`);
      if (expectedSoon) parts.push(`lump-sum expected by ${expectedReturn}`);
      return `- ${l.loan.counterparty} (${l.loan.direction}) [id:${l.loan.id}]: balance ${m(l.balanceBase)} · ${parts.join(", ")}${l.loan.notes ? ` · note: "${snippetNote(l.loan.notes)}"` : ""}`;
    })
    .filter((v): v is string => v !== null);

  // ── Wallets past their overdraft tolerance ──
  // Mirrors calm-weather: a wallet at -200 with a 500 tolerance is
  // intentionally within tolerance and not an alarm. Only over_overdraft
  // raises a sweep question.
  // Phase 1.5: ledger reader first.
  const curiosityLedgerBalanceMap = await computeWalletBalancesFromLedger(methods).catch(
    (err) => {
      const message = err instanceof Error ? err.message : String(err);
      void logLedgerReadFailure(`curiosity-sweep wallet-balance read: ${message}`);
      return new Map();
    },
  );
  const curiosityLedgerBalanceForChain = new Map<string, number>();
  for (const [k, v] of curiosityLedgerBalanceMap) curiosityLedgerBalanceForChain.set(k, v.balance);
  const holdings = holdingBalances(methods, payments, stepsByPayment, withdrawals, spends, curiosityLedgerBalanceForChain);
  const negativeWallets = holdings.filter((h) => h.status === "over_overdraft");

  // ── Category co-occurrence (might warrant merge) ──
  const coCount = new Map<string, number>();
  for (const [, catIds] of linkIndex.entries()) {
    if (catIds.length < 2) continue;
    const sorted = [...catIds].sort();
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const key = `${sorted[i]}|${sorted[j]}`;
        coCount.set(key, (coCount.get(key) ?? 0) + 1);
      }
    }
  }
  const heavyCoOccur = [...coCount.entries()]
    .filter(([, n]) => n >= 4)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([key, n]) => {
      const [a, b] = key.split("|");
      return `- "${catNameById.get(a) ?? "?"}" + "${catNameById.get(b) ?? "?"}" co-tagged on ${n} spends`;
    });

  // ── Unresolved memory-entry tokens ──
  const unresolvedNotes = memoryEntries
    .filter((e) => /\b([A-Z]{2,4})\b|"[^"]+"/.test(e.content))
    .slice(0, 6)
    .map((e) => `- ${e.created_at.slice(0, 10)} [id:${e.id}]: "${snippetNote(e.content, 100)}"`);

  // ── Sadaka months below baseline ──
  const sadakaCatId = spendCategories.find((c) => /sadaka/i.test(c.name))?.id ?? null;
  let sadakaLine = "";
  if (sadakaCatId) {
    const sadakaMtd = spends
      .filter((sp) => new Date(sp.spent_at) >= startMonth)
      .filter((sp) => (linkIndex.get(sp.id) ?? []).includes(sadakaCatId))
      .reduce((s, sp) => s + Number(sp.amount_base ?? 0), 0);
    const incomeMtd = metrics.mtd;
    if (incomeMtd > 0) {
      const pct = sadakaMtd / incomeMtd;
      if (pct < 0.015) {
        sadakaLine = `- Sadaka MTD ${m(sadakaMtd)} = ${(pct * 100).toFixed(2)}% of income ${m(incomeMtd)} (below 1.5% baseline)`;
      }
    }
  }

  // ── Investments / revenue gaps ──
  const investmentMentions = memoryEntries
    .filter((e) => /\binvest|stock|crypto|fund|portfolio\b/i.test(e.content))
    .slice(0, 3)
    .map((e) => `- ${e.created_at.slice(0, 10)} [id:${e.id}]: "${snippetNote(e.content, 100)}"`);

  // ── Recurring forward ──
  const recurringForward = recurringExpectedInRange(recurring, recurringSkips, rates, now, horizonEnd);

  // ── Safe-to-spend (read for recovery state) ──
  // Pass plannedSpends so the sweep's recovery flag and any cited
  // safeTodayBase line up with what the user sees on Today / Dashboard /
  // Spending / Plans. Without it the sweep ran on a higher baseline.
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
    ledgerBalances: curiosityLedgerBalanceForChain,
    now,
  });

  // ── Per-client recap (with memory) ──
  const perClient = clients
    .filter((c) => !c.archived)
    .map((c) => {
      const last = lastPaymentByClient.get(c.id) ?? null;
      const mem = c.memory_consolidated ?? {};
      const memBits = [
        mem.summary,
        ...(mem.facts ?? []).map((f) => `fact: ${f}`),
        ...(mem.watch ?? []).map((w) => `watch: ${w}`),
      ]
        .filter(Boolean)
        .join("; ");
      const notes = snippetNote(c.notes);
      return `- ${c.name} [id:${c.id}]: last paid ${last ?? "never"}${notes ? ` · notes: "${notes}"` : ""}${memBits ? ` · MEMORY: ${memBits}` : ""}`;
    });

  // ── Recent spends with their notes ──
  const recentSpendsBlock = spends.slice(0, 15).map((sp) => {
    const cats = (linkIndex.get(sp.id) ?? []).map((id) => catNameById.get(id) ?? "?").join("/");
    const note = snippetNote(sp.notes);
    const desc = sp.description ?? "?";
    return `- ${sp.spent_at.slice(0, 10)} [id:${sp.id}]: ${desc} ${m(Number(sp.amount_base ?? 0))}${cats ? ` [${cats}]` : ""}${note ? ` · note: "${note}"` : ""}${sp.business_relevant ? " · biz" : ""}`;
  });

  // ── Recent payments with notes ──
  const recentPaymentsBlock = payments.slice(0, 12).map((p) => {
    const proj = projectsById.get(p.project_id);
    const client = proj ? clientsById.get(proj.client_id) : null;
    const sig = chainSignature(sortedSteps(stepsByPayment.get(p.id) ?? []), methodsById);
    const note = snippetNote(p.notes);
    const feeFlag = p.fee_unknown ? " · FEE UNKNOWN" : "";
    return `- ${p.paid_at.slice(0, 10)} [id:${p.id}]: ${client?.name ?? "?"} / ${proj?.title ?? "?"} via ${sig} → ${m(Number(p.net_amount_base ?? 0))}${feeFlag}${note ? ` · note: "${note}"` : ""}`;
  });

  // ── Recurring rules with notes ──
  const recurringBlock = recurring
    .filter((r) => r.active)
    .map((r) => {
      const expectedBase = toBase(
        Number(r.expected_amount),
        r.expected_currency as CurrencyCode,
        rates,
      );
      const note = snippetNote(r.notes);
      return `- ${r.label} [id:${r.id}] (${r.schedule_kind}): expected ${m(expectedBase)}${note ? ` · note: "${note}"` : ""}`;
    });

  // ── Loans block (full open list with notes) ──
  const loansBlock = lwb
    .filter((l) => l.derivedStatus !== "closed")
    .map((l) => {
      const note = snippetNote(l.loan.notes);
      const nextDue = l.upcoming[0];
      const next = nextDue
        ? ` · next ${nextDue.due_date}: ${m(toBase(Number(nextDue.expected_amount), nextDue.expected_currency as CurrencyCode, rates))}`
        : l.loan.expected_return_by
          ? ` · lump-sum by ${l.loan.expected_return_by}`
          : "";
      return `- ${l.loan.counterparty} (${l.loan.direction}) [id:${l.loan.id}]: balance ${m(l.balanceBase)}${next}${note ? ` · note: "${note}"` : ""}`;
    });

  // ── User memory consolidated doc ──
  const consolidated = (userMemoryRow?.memory_consolidated ?? {}) as UserMemoryConsolidated;
  const memText = JSON.stringify(
    {
      summary: consolidated.summary ?? "",
      patterns: consolidated.patterns ?? [],
      watch: consolidated.watch ?? [],
      preferences: consolidated.preferences ?? {},
      milestones: consolidated.milestones ?? [],
    },
    null,
    2,
  );

  // ── Recently answered/dismissed questions ──
  const recentlyHandled = recentQuestions.map((q) => {
    const state = q.answered_at ? `ANSWERED: ${snippetNote(q.answer, 60) ?? "(empty)"}` : "DISMISSED";
    return `- [${q.kind}] "${snippetNote(q.question, 80)}" → ${state}`;
  });

  // ── Data availability ──
  const oldestSpend = spends.length ? new Date(spends[spends.length - 1].spent_at).getTime() : null;
  const oldestPayment = payments.length ? new Date(payments[payments.length - 1].paid_at).getTime() : null;
  const oldest = [oldestSpend, oldestPayment].filter((v): v is number => v !== null).sort()[0] ?? null;
  const observationDays = oldest === null ? 0 : Math.max(0, Math.round((now.getTime() - oldest) / DAY_MS));

  const knownIds: KnownEntityIndex = {
    spend: new Set(spends.map((s) => s.id)),
    payment: new Set(payments.map((p) => p.id)),
    client: new Set(clients.map((c) => c.id)),
    loan: new Set(loans.map((l) => l.id)),
    recurring_spend: new Set(recurring.map((r) => r.id)),
    user_memory_entry: new Set(memoryEntries.map((e) => e.id)),
  };

  const text = `Base currency: ${currency}. Today: ${phtDateString(now)}.

DATA AVAILABILITY:
- Observations: ~${observationDays}d of history
- Spends: ${spends.length} · Payments: ${payments.length} · Active recurring: ${recurring.filter((r) => r.active).length} · Open loans: ${lwb.filter((l) => l.derivedStatus !== "closed").length}
- Clients: ${clients.filter((c) => !c.archived).length} · Categories: ${spendCategories.filter((c) => !c.archived).length}

CASHFLOW — MTD ${m(metrics.mtd)} · last month ${m(metrics.lastMonth)} · trailing 30d income ${m(landedInRange(payments, start30, now))} · fees MTD ${m(metrics.feesMtd)}.

SPENDING — MTD ${m(totalSpendMtd)} · trailing 30d ${m(totalSpend30)} (personal ${m(split30.personal)} / business ${m(split30.business)}).
TOP CATEGORIES (30d): ${topCats30.join(", ") || "none yet"}.

SAFE-TO-SPEND state: safe today ${m(sts.safeTodayBase)} · stability ${sts.stabilityScore.toFixed(2)} · ${sts.isLearning ? "STILL LEARNING" : "calibrated"}${sts.inRecovery ? ` · RECOVERY (overspend ${m(sts.trailingOverspendBase)})` : ""}.

RECURRING FORWARD (30d expected): ${m(recurringForward)}.

────────────────── CURIOSITY SIGNALS ──────────────────

STALE CLIENTS (no payment in ${STALE_CLIENT_DAYS}d+):
${staleClients.length ? staleClients.map((r) => `- ${r.client.name} [id:${r.client.id}]: last paid ${r.lastPaidAt ?? "never"}${r.client.notes ? ` · notes: "${snippetNote(r.client.notes)}"` : ""}`).join("\n") : "- none"}

VAGUE SPENDS (description-only or no detail at all):
${vagueSpends.length ? vagueSpends.map((sp) => `- ${sp.spent_at.slice(0, 10)} [id:${sp.id}]: "${sp.description ?? "(no description)"}" ${m(Number(sp.amount_base ?? 0))}`).join("\n") : "- none"}

VAGUE / UNRESOLVED PAYMENTS (fee_unknown, missing chain, or initials in notes):
${vaguePayments.length ? vaguePayments.map((p) => `- ${p.paid_at.slice(0, 10)} [id:${p.id}]: net ${m(Number(p.net_amount_base ?? 0))}${p.fee_unknown ? " · FEE UNKNOWN" : ""}${(stepsByPayment.get(p.id) ?? []).length === 0 ? " · NO CHAIN" : ""}${p.notes ? ` · note: "${snippetNote(p.notes)}"` : ""}`).join("\n") : "- none"}

RECURRING DRIFT (paid amount differs >${(RECURRING_DRIFT_THRESHOLD * 100).toFixed(0)}% from expected):
${recurringDrift.join("\n") || "- none"}

LOANS DUE SOON / OVERDUE:
${loanFlags.join("\n") || "- none"}

NEGATIVE WALLETS:
${negativeWallets.length ? negativeWallets.map((h) => `- ${h.name} [id:${h.methodId}]: ${m(h.balance)}`).join("\n") : "- none"}

CATEGORIES OFTEN CO-TAGGED (possible merge candidates):
${heavyCoOccur.join("\n") || "- none"}

UNRESOLVED TOKENS IN USER MEMORY NOTES (initials, quoted names):
${unresolvedNotes.join("\n") || "- none"}

INVESTMENT MENTIONS (likely needs feedback loop):
${investmentMentions.join("\n") || "- none"}

SADAKA STATUS:
${sadakaLine || "- on or above baseline (or no income MTD)"}

────────────────── CONTEXT ──────────────────

ACTIVE RECURRING RULES:
${recurringBlock.join("\n") || "- none"}

OPEN LOANS:
${loansBlock.join("\n") || "- none"}

CLIENTS (with memory):
${perClient.join("\n") || "- none"}

RECENT SPENDS:
${recentSpendsBlock.join("\n") || "- none"}

RECENT PAYMENTS:
${recentPaymentsBlock.join("\n") || "- none"}

USER MEMORY (consolidated):
${memText}

RECENTLY ANSWERED / DISMISSED QUESTIONS (do NOT re-ask these):
${recentlyHandled.join("\n") || "- none"}

PH COST-OF-LIVING PRIORS:
${PH_COL_CONTEXT}`;

  return { text, knownIds };
}

export async function runCuriositySweep(): Promise<{
  queued: number;
  questions: AiQuestion[];
}> {
  try {
    if (!hasGemini()) return { queued: 0, questions: [] };
    const user = await getAuthUser();
    if (!user) return { queued: 0, questions: [] };
    const supabase = await createClient();

    const { count } = await supabase
      .from("ai_questions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .is("answered_at", null)
      .is("dismissed_at", null);
    if ((count ?? 0) >= MAX_OPEN_QUESTIONS) {
      return { queued: 0, questions: [] };
    }

    const snapshot = await buildCuriositySnapshot(user.id, supabase);

    const res = await gemini().models.generateContent({
      model: HEAVY_MODEL,
      contents: `Snapshot:\n\n${snapshot.text}\n\nReturn 1-5 questions as JSON.`,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        temperature: 0.6,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
      },
    });

    const parsed = JSON.parse((res.text ?? "{}").trim()) as { questions?: RawQuestion[] };
    const raw = (parsed.questions ?? []).slice(0, 5);

    const queued: AiQuestion[] = [];
    for (const item of raw) {
      const question = typeof item.question === "string" ? item.question.trim() : "";
      if (!question) continue;
      const kind = coerceKind(item.kind);
      const priority = clampPriority(item.priority);

      const rawSourceType =
        typeof item.source_entity_type === "string" ? item.source_entity_type : null;
      const rawSourceId =
        typeof item.source_entity_id === "string" ? item.source_entity_id : null;

      let sourceEntityType: AiQuestionSourceType | undefined;
      let sourceEntityId: string | undefined;
      if (rawSourceType && rawSourceId) {
        if (KNOWN_SOURCE_TYPES.has(rawSourceType as AiQuestionSourceType)) {
          const bucket = snapshot.knownIds[rawSourceType as keyof KnownEntityIndex];
          if (bucket && bucket.has(rawSourceId)) {
            sourceEntityType = rawSourceType as AiQuestionSourceType;
            sourceEntityId = rawSourceId;
          } else {
            // Model invented an id that's not in the snapshot — drop the link.
            continue;
          }
        }
      }

      const context =
        item.context && typeof item.context === "object" && !Array.isArray(item.context)
          ? (item.context as Record<string, unknown>)
          : {};
      const options = Array.isArray(item.options)
        ? item.options.filter((o): o is string => typeof o === "string" && o.trim().length > 0)
        : undefined;

      try {
        const row = await queueAiQuestion({
          question,
          kind,
          context,
          options: options && options.length ? options : undefined,
          sourceEntityType,
          sourceEntityId,
          priority,
        });
        queued.push(row);
      } catch {
        // Skip individual failures; keep the sweep best-effort.
      }
    }

    return { queued: queued.length, questions: queued };
  } catch {
    return { queued: 0, questions: [] };
  }
}

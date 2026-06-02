import "server-only";
import { phtDateString } from "@/lib/utils";
import { Type } from "@google/genai";
import { gemini, MODEL, hasGemini } from "./gemini";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { formatMoney } from "@/lib/money";
import {
  cashflowMetrics,
  landedInRange,
  spendsInRange,
  spendsByCategoryInRange,
  recurringExpectedInRange,
} from "@/lib/dashboard-calc";
import { holdingBalances } from "@/lib/payment-chain";
import { computeWalletBalancesFromLedger } from "@/lib/data/wallet-balance";
import { logLedgerReadFailure } from "@/lib/data/money-ledger";
import { linksBySpend, businessPersonalSplit } from "@/lib/spends";
import { loansWithBalance, totalOwedBase, totalLentBase } from "@/lib/loans";
import { safeToSpend } from "@/lib/safe-to-spend";
import type {
  CurrencyCode,
  ExchangeRate,
  Loan,
  LoanInstallment,
  Payment,
  PaymentMethod,
  PaymentStep,
  PlannedSpend,
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

const SYSTEM = `You maintain a living memory document about a SOLO freelancer in the Philippines, for their personal money + life-OS app.

You receive:
- CURRENT consolidated memory (JSON)
- New raw notes the user wrote
- A summary of their recent ledger (income, spending, recovery state, wallet balances)

Merge ALL of it into one updated memory. Learn from the data itself, not just the notes.

RULES:
- Factual + concise. No flattery, no filler, no therapy.
- summary: 1-2 sentences on their financial + life shape (e.g. "Freelance dev in Manila, fluctuating income, tends to spend on tech + groceries").
- patterns: durable truths mined from data — typical income cadence, spend ratios by category, behavior anomalies. Dedupe; newer overrides older.
- watch: CURRENT risks. Drop items the data shows resolved.
- preferences: language, tone, lifestyle notes, family (e.g. the wife).
- milestones: significant transitions ("moved May 2026", "rent changed ₱3500 → ₱X").
- NEVER invent specifics not supported by the notes or data.
- If a note and the data conflict, prefer the more recent signal.
- If sparse data (< 1 week observations), keep memory minimal + acknowledge in summary.`;

const SCHEMA = {
  type: Type.OBJECT,
  properties: {
    summary: { type: Type.STRING },
    patterns: { type: Type.ARRAY, items: { type: Type.STRING } },
    watch: { type: Type.ARRAY, items: { type: Type.STRING } },
    preferences: {
      type: Type.OBJECT,
      properties: {
        language: { type: Type.STRING },
        tone: { type: Type.STRING },
        lifestyle: { type: Type.STRING },
      },
    },
    milestones: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ["summary", "patterns", "watch"],
  propertyOrdering: ["summary", "patterns", "watch", "preferences", "milestones"],
};

// Folds the user's notes AND their full ledger snapshot into the living memory
// doc. Runs after a note is added AND whenever the ledger materially changes
// (new payment, new spend, recurring/loan activity), so the AI's notebook on
// the user keeps itself current — even with no manual notes.
// Best-effort: if Gemini isn't configured or errors, raw notes/data still stand.
export async function consolidateUserMemory(): Promise<void> {
  if (!hasGemini()) return;
  const user = await getAuthUser();
  if (!user) return;
  const userId = user.id;
  const supabase = await createClient();

  const [
    settingsR,
    memoryR,
    entriesR,
    paymentsR,
    withdrawalsR,
    methodsR,
    spendsR,
    spendLinksR,
    categoriesR,
    recurringR,
    skipsR,
    loansR,
    installmentsR,
    ratesR,
    plannedR,
  ] = await Promise.all([
    supabase.from("settings").select("*").eq("user_id", userId).maybeSingle(),
    supabase.from("user_memory").select("*").eq("user_id", userId).maybeSingle(),
    supabase
      .from("user_memory_entries")
      .select("id,content,source,created_at,consolidated_at")
      .eq("user_id", userId)
      .is("consolidated_at", null)
      .order("created_at"),
    supabase.from("payments").select("*").eq("user_id", userId).order("paid_at", { ascending: false }),
    supabase.from("withdrawals").select("*").eq("user_id", userId),
    supabase.from("payment_methods").select("*").eq("user_id", userId),
    supabase.from("spends").select("*").eq("user_id", userId).order("spent_at", { ascending: false }),
    supabase.from("spend_category_links").select("*"),
    supabase.from("spend_categories").select("*").eq("user_id", userId),
    supabase.from("recurring_spends").select("*").eq("user_id", userId),
    supabase.from("recurring_spend_skips").select("*"),
    supabase.from("loans").select("*").eq("user_id", userId),
    supabase.from("loan_installments").select("*"),
    supabase.from("exchange_rates").select("*").eq("user_id", userId),
    supabase.from("planned_spends").select("*").eq("user_id", userId),
  ]);

  const settings = settingsR.data as Settings | null;
  const currency = (settings?.base_currency ?? "PHP") as CurrencyCode;
  const memory = memoryR.data as UserMemory | null;
  const entries = (entriesR.data ?? []) as UserMemoryEntry[];
  const payments = (paymentsR.data ?? []) as Payment[];
  const withdrawals = (withdrawalsR.data ?? []) as Withdrawal[];
  const methods = (methodsR.data ?? []) as PaymentMethod[];
  const spends = (spendsR.data ?? []) as Spend[];
  const spendLinks = (spendLinksR.data ?? []) as SpendCategoryLink[];
  const categories = (categoriesR.data ?? []) as SpendCategory[];
  const recurring = (recurringR.data ?? []) as RecurringSpend[];
  const skips = (skipsR.data ?? []) as RecurringSpendSkip[];
  const loans = (loansR.data ?? []) as Loan[];
  const installments = (installmentsR.data ?? []) as LoanInstallment[];
  const rates = (ratesR.data ?? []) as ExchangeRate[];
  const plannedSpends = (plannedR.data ?? []) as PlannedSpend[];

  // No notes AND nothing in the ledger → nothing to learn from yet.
  if (entries.length === 0 && payments.length === 0 && spends.length === 0) return;

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
  const start30 = new Date(now.getTime() - 30 * DAY);
  const start7 = new Date(now.getTime() - 7 * DAY);
  const horizonEnd = new Date(now.getTime() + 30 * DAY);

  const metrics = cashflowMetrics(payments, now, 0, withdrawals);
  const income30 = landedInRange(payments, start30, now);
  const income7 = landedInRange(payments, start7, now);
  const spend30 = spendsInRange(spends, start30, now);
  const spend7 = spendsInRange(spends, start7, now);

  const linkIndex = linksBySpend(spendLinks);
  const catTotals = spendsByCategoryInRange(spends, linkIndex, start30, now);
  const catNameById = new Map(categories.map((c) => [c.id, c.name]));
  const split = businessPersonalSplit(spends.filter((sp) => new Date(sp.spent_at) >= start30));

  const recurringForward = recurringExpectedInRange(recurring, skips, rates, now, horizonEnd);
  const loansBal = loansWithBalance(loans, installments, spends, now);
  const owed = totalOwedBase(loansBal);
  const lent = totalLentBase(loansBal);
  const overdueLoans = loansBal.filter((l) => l.overdue.length > 0);

  // Phase 1.5: ledger reader first.
  const userMemLedgerBalanceMap = await computeWalletBalancesFromLedger(methods).catch(
    (err) => {
      const message = err instanceof Error ? err.message : String(err);
      void logLedgerReadFailure(`user-memory wallet-balance read: ${message}`);
      return new Map();
    },
  );
  const userMemLedgerBalanceForChain = new Map<string, number>();
  for (const [k, v] of userMemLedgerBalanceMap) userMemLedgerBalanceForChain.set(k, v.balance);
  const holdings = holdingBalances(methods, payments, stepsByPayment, withdrawals, spends, userMemLedgerBalanceForChain);

  // Pass plannedSpends so the AI's baseline matches the headline the user
  // sees on Today/Dashboard/Spending/Plans. Without it the AI reads a higher
  // safeTodayBase than the user, and its notes drift over time.
  const sts = safeToSpend({
    payments,
    withdrawals,
    spends,
    recurring,
    recurringSkips: skips,
    loanInstallments: installments,
    methods,
    stepsByPayment,
    rates,
    plannedSpends,
    ledgerBalances: userMemLedgerBalanceForChain,
    now,
  });

  const m = (n: number) => formatMoney(n, currency, { compact: true });

  const observationDays = (() => {
    const oldestSpend = spends.length ? new Date(spends[spends.length - 1].spent_at).getTime() : null;
    const oldestPayment = payments.length ? new Date(payments[payments.length - 1].paid_at).getTime() : null;
    const oldest = [oldestSpend, oldestPayment].filter((v): v is number => v !== null).sort()[0] ?? null;
    if (oldest === null) return 0;
    return Math.max(0, Math.round((now.getTime() - oldest) / DAY));
  })();

  const topCats = catTotals.slice(0, 5).map((t) => `${catNameById.get(t.categoryId) ?? "?"} ${m(t.total)}`).join(", ");
  const activeRecurring = recurring.filter((r) => r.active);

  const ledger = `LEDGER SNAPSHOT (base ${currency}, today ${phtDateString(now)}, ~${observationDays}d of observations):

INCOME — trailing 7d ${m(income7)}, trailing 30d ${m(income30)} · MTD ${m(metrics.mtd)} (MoM ${metrics.momDelta === null ? "n/a" : (metrics.momDelta * 100).toFixed(0) + "%"}) · last month ${m(metrics.lastMonth)} · YTD ${m(metrics.ytd)} · fees this month ${m(metrics.feesMtd)}.

SPEND — trailing 7d ${m(spend7)}, trailing 30d ${m(spend30)} · split last 30d: personal ${m(split.personal)}, business ${m(split.business)}.
Top categories (30d): ${topCats || "none yet"}.

FORWARD COMMITMENTS (next 30d) — recurring ${m(recurringForward)} across ${activeRecurring.length} active rules${activeRecurring.length ? ` (${activeRecurring.slice(0, 6).map((r) => r.label).join(", ")}${activeRecurring.length > 6 ? "…" : ""})` : ""}.

SAFE-TO-SPEND (rolling ${sts.horizonDays}d, COL floor ${m(sts.colFloorBase)}/day):
- wallet balances ${m(sts.walletBalancesBase)} · committed pool ${m(sts.committedPoolBase)} · discretionary ${m(sts.discretionaryPoolBase)}
- daily allowance ${m(sts.dailyAllowanceBase)} → safe today ${m(sts.safeTodayBase)}
- ${sts.inRecovery ? `RECOVERY MODE — trailing overspend ${m(sts.trailingOverspendBase)}, tax ${m(sts.recoveryDailyTaxBase)}/day` : "not in recovery"}${sts.isLearning ? " · still learning (sparse income history)" : ""}
- stability ${sts.stabilityScore.toFixed(2)} (mult ${sts.stabilityMultiplier.toFixed(2)})

LOANS — owe others ${m(owed)} across ${loansBal.filter((l) => l.loan.direction === "borrowed" && l.derivedStatus !== "closed").length} open · lent ${m(lent)} across ${loansBal.filter((l) => l.loan.direction === "lent" && l.derivedStatus !== "closed").length} open${overdueLoans.length ? ` · ${overdueLoans.length} loan(s) with overdue installments` : ""}.

WALLETS:
${methods.length ? methods.map((mm) => `- ${mm.name}${mm.is_holding ? ` (holding: ${m(holdings.find((h) => h.methodId === mm.id)?.balance ?? 0)})` : ""}`).join("\n") : "- none"}

RECENT SPENDS (newest first):
${spends.slice(0, 8).map((sp) => {
    const cats = (linkIndex.get(sp.id) ?? []).map((id) => catNameById.get(id) ?? "?").join("/");
    return `- ${sp.spent_at.slice(0, 10)}: ${sp.description ?? "?"} ${m(Number(sp.amount_base ?? 0))}${cats ? ` [${cats}]` : ""}${sp.business_relevant ? " · biz" : ""}`;
  }).join("\n") || "- none yet"}`;

  const prior = (memory?.memory_consolidated ?? {}) as UserMemoryConsolidated;
  const prompt = `CURRENT MEMORY (JSON):
${JSON.stringify({
    summary: prior.summary ?? "",
    patterns: prior.patterns ?? [],
    watch: prior.watch ?? [],
    preferences: prior.preferences ?? {},
    milestones: prior.milestones ?? [],
  }, null, 2)}

NEW NOTES the user wrote (oldest first, source in brackets):
${entries.length ? entries.map((e) => `- (${String(e.created_at).slice(0, 10)}) [${e.source}] ${e.content}`).join("\n") : "- (none)"}

${ledger}

Return the updated memory as JSON, folding in everything above.`;

  try {
    const res = await gemini().models.generateContent({
      model: MODEL,
      contents: prompt,
      config: {
        systemInstruction: SYSTEM,
        temperature: 0.2,
        responseMimeType: "application/json",
        responseSchema: SCHEMA,
      },
    });
    const parsed = JSON.parse((res.text ?? "{}").trim());
    const priorCount = memory?.entry_count ?? 0;
    const consolidated: UserMemoryConsolidated = {
      summary: parsed.summary,
      patterns: parsed.patterns ?? [],
      watch: parsed.watch ?? [],
      preferences: parsed.preferences ?? {},
      milestones: parsed.milestones ?? [],
      updated_at: new Date().toISOString(),
      entry_count: priorCount + entries.length,
    };
    await supabase
      .from("user_memory")
      .upsert(
        {
          user_id: userId,
          memory_consolidated: consolidated,
          entry_count: priorCount + entries.length,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
    if (entries.length) {
      await supabase
        .from("user_memory_entries")
        .update({ consolidated_at: new Date().toISOString() })
        .eq("user_id", userId)
        .is("consolidated_at", null);
    }
  } catch {
    // Leave existing memory as-is; consolidation retries on the next note/event.
  }
}

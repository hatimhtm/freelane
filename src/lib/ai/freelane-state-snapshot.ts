import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { withBrainCache } from "./cache";
import { BRAIN_KEYS } from "./cache-keys";
import { holdingBalances } from "@/lib/payment-chain";
import { computeWalletBalancesFromLedger } from "@/lib/data/wallet-balance";
import { logLedgerReadFailure } from "@/lib/data/money-ledger";
import { computeSafeToSpendFromData } from "@/lib/safe-to-spend";
import { formatMoney } from "@/lib/money";
import { phtDateString } from "@/lib/utils";
import { BASE_CURRENCY_FALLBACK } from "@/lib/constants";
import type { CurrencyCode } from "@/lib/supabase/types";

// Freelane state snapshot — compact text representation of "the user's
// money right now" handed to the Pro chat-answer brain on session start.
//
// Page context is a focus HINT, not a data limit: the brain always sees
// the whole picture (wallets, period state, sadaka pool, plans, recent
// mood, recent spend pattern, ai_user_facts) and decides what to surface.
// Cached 5 minutes via STATE_SNAPSHOT — every financial mutation that
// already invalidates the ALL_BRAIN_KEYS sweep (spend ≥ ₱200, payment,
// wallet anchor, planned spend, recurring rule) busts this too. The TTL
// is the calm-time freshness; the sweep is the truth.
//
// Cost discipline: snapshot fingerprint is keyed off the day + last-mod
// timestamps so a re-call mid-session is a cache hit; Gemini's own
// context-caching benefits from the byte-stable system prompt this
// produces.

const SNAPSHOT_LOOKBACK_DAYS = 14;
const DAY_MS = 86_400_000;
const RECENT_SPEND_LIMIT = 12;
const RECENT_FACT_LIMIT = 30;
const RECENT_PLAN_LIMIT = 8;
// Hard byte cap on the rendered snapshot text. The component limits above
// (RECENT_*) already keep the typical payload well below this, but a power
// user with many wallets / long fact values / many plans could drift past
// it. The cap is a backstop, not the primary lever — every additional
// kilobyte rides in EVERY Pro chat-answer call. 8 KB is comfortable head
// room above a real-world snapshot (~3-4 KB) without burning Pro tokens.
const SNAPSHOT_MAX_CHARS = 8000;

export type FreelaneSnapshot = {
  text: string;
  generatedAt: string;
  baseCurrency: CurrencyCode;
};

export async function getFreelaneStateSnapshot(opts: {
  force?: boolean;
} = {}): Promise<FreelaneSnapshot> {
  const user = await getAuthUser();
  if (!user) {
    return {
      text: "NO USER",
      generatedAt: new Date().toISOString(),
      baseCurrency: BASE_CURRENCY_FALLBACK as CurrencyCode,
    };
  }

  const cached = await withBrainCache<FreelaneSnapshot>({
    brainKey: BRAIN_KEYS.STATE_SNAPSHOT,
    // Snapshot is a free-floating freshness window, not a today-bucket — a
    // snapshot taken at 23:55 PHT is still useful at 00:05 the next day.
    phtDayAnchored: false,
    force: opts.force,
    regen: () => buildSnapshot(user.id),
  });

  if (cached) return cached.payload;
  return buildSnapshot(user.id);
}

async function buildSnapshot(userId: string): Promise<FreelaneSnapshot> {
  const supabase = await createClient();
  const now = new Date();
  const lookbackStart = new Date(now.getTime() - SNAPSHOT_LOOKBACK_DAYS * DAY_MS);

  const [
    { data: settings },
    { data: rates },
    { data: methods },
    { data: payments },
    { data: paymentSteps },
    { data: withdrawals },
    { data: spends },
    { data: recurring },
    { data: recurringSkips },
    { data: loanInstallments },
    { data: plannedSpends },
    { data: spendCategories },
    { data: spendCategoryLinks },
    { data: facts },
    { data: latestDiary },
    { data: plans },
  ] = await Promise.all([
    supabase.from("settings").select("base_currency").eq("user_id", userId).maybeSingle(),
    supabase.from("exchange_rates").select("code,rate_to_base").eq("user_id", userId),
    supabase.from("payment_methods").select("*").eq("user_id", userId).eq("archived", false),
    supabase.from("payments").select("*").eq("user_id", userId),
    supabase.from("payment_steps").select("*").eq("user_id", userId),
    supabase.from("withdrawals").select("*").eq("user_id", userId),
    supabase.from("spends").select("*").eq("user_id", userId).gte("spent_at", lookbackStart.toISOString().slice(0, 10)),
    supabase.from("recurring_spends").select("*").eq("user_id", userId).eq("active", true),
    supabase.from("recurring_spend_skips").select("*").eq("user_id", userId),
    supabase.from("loan_installments").select("*").eq("user_id", userId),
    supabase.from("planned_spends").select("*").eq("user_id", userId),
    supabase.from("spend_categories").select("*").eq("user_id", userId),
    supabase.from("spend_category_links").select("*"),
    supabase
      .from("ai_user_facts")
      .select("subject_kind,subject_id,key,value,confidence,source")
      .eq("user_id", userId)
      .order("confidence", { ascending: false })
      .limit(RECENT_FACT_LIMIT),
    supabase
      .from("diary_entries")
      .select("entry_date,body,mood,energy")
      .eq("user_id", userId)
      .order("entry_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
    // "plans" in Freelane today is the planned_spends table (single source
    // of upcoming non-recurring outflows). When a richer Plans workflow
    // ships, swap this fetch — the snapshot text format is stable.
    supabase
      .from("planned_spends")
      .select("id,label,planned_for,amount,currency,status,notes")
      .eq("user_id", userId)
      .order("planned_for", { ascending: true })
      .limit(RECENT_PLAN_LIMIT),
  ]);

  const baseCurrency = (settings?.base_currency ?? BASE_CURRENCY_FALLBACK) as CurrencyCode;
  const rateRows = (rates ?? []) as Array<{ code: string; rate_to_base: number }>;

  // group payment_steps by payment_id for holdingBalances() signature
  const stepsByPayment = new Map<string, typeof paymentSteps>();
  for (const ps of paymentSteps ?? []) {
    const list = stepsByPayment.get(ps.payment_id) ?? [];
    list.push(ps);
    stepsByPayment.set(ps.payment_id, list);
  }

  const m = (n: number) => formatMoney(n, baseCurrency, { compact: true });

  // Wallets + period state via existing rollups so the snapshot text agrees
  // with the dashboards exactly — chat answers built off a different math
  // path than the UI is a worse error than the chat being slow.
  // Phase 1.5: ledger reader first; threaded through safeToSpend below.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stateLedgerBalanceMap = methods
    ? await computeWalletBalancesFromLedger(methods as any).catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        void logLedgerReadFailure(`state-snapshot wallet-balance read: ${message}`);
        return new Map();
      })
    : new Map();
  const stateLedgerBalanceForChain = new Map<string, number>();
  for (const [k, v] of stateLedgerBalanceMap) stateLedgerBalanceForChain.set(k, v.balance);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const holdings = methods && payments && withdrawals && spends
    ? holdingBalances(
        methods as any,
        payments as any,
        stepsByPayment as any,
        withdrawals as any,
        spends as any,
        stateLedgerBalanceForChain,
      )
    : [];

  let safeTodayBase = 0;
  let inRecovery = false;
  let stabilityMultiplier = 1;
  let dailyAllowanceBase = 0;
  let discretionaryPoolBase = 0;
  try {
    if (
      payments && withdrawals && spends && recurring && recurringSkips &&
      loanInstallments && methods
    ) {
      const sts = computeSafeToSpendFromData(
        {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          payments: payments as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          withdrawals: withdrawals as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          spends: spends as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          recurring: recurring as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          recurringSkips: recurringSkips as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          loanInstallments: loanInstallments as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          methods: methods as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          stepsByPayment: stepsByPayment as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          rates: rateRows as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          plannedSpends: (plannedSpends ?? []) as any,
          ledgerBalances: stateLedgerBalanceForChain,
        } as never,
        now,
      );
      safeTodayBase = sts.safeTodayBase;
      inRecovery = sts.inRecovery;
      stabilityMultiplier = sts.stabilityMultiplier;
      dailyAllowanceBase = sts.dailyAllowanceBase;
      discretionaryPoolBase = sts.discretionaryPoolBase;
    }
  } catch {
    // Snapshot is best-effort; the brain will tell the user "I'm still
    // learning your situation" instead of falsifying numbers.
  }

  // Recent spend pattern: top categories + most recent N rows for context.
  const catById = new Map((spendCategories ?? []).map((c) => [c.id, c.name as string]));
  const tagsBySpend = new Map<string, string[]>();
  for (const link of spendCategoryLinks ?? []) {
    const arr = tagsBySpend.get(link.spend_id) ?? [];
    arr.push(catById.get(link.category_id) ?? "untagged");
    tagsBySpend.set(link.spend_id, arr);
  }
  const recentSpends = (spends ?? [])
    .slice()
    .sort((a, b) => String(b.spent_at).localeCompare(String(a.spent_at)))
    .slice(0, RECENT_SPEND_LIMIT)
    .map((s) => {
      const tags = (tagsBySpend.get(s.id) ?? []).join(", ");
      const desc = s.description ?? "";
      return `- ${String(s.spent_at).slice(0, 10)} ${m(Number(s.amount_base ?? 0))}${tags ? ` [${tags}]` : ""}${desc ? `: ${desc}` : ""}`;
    });

  // Top categories by spend in lookback window.
  const totalsByCat = new Map<string, number>();
  for (const s of spends ?? []) {
    const tags = tagsBySpend.get(s.id) ?? ["untagged"];
    for (const t of tags) {
      totalsByCat.set(t, (totalsByCat.get(t) ?? 0) + Number(s.amount_base ?? 0));
    }
  }
  const topCategories = Array.from(totalsByCat.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, total]) => `- ${name}: ${m(total)}`);

  const factLines = (facts ?? []).map((f) => {
    const subj =
      f.subject_kind === "user"
        ? "user"
        : `${f.subject_kind}:${f.subject_id ?? "?"}`;
    const valStr = typeof f.value === "string" ? f.value : JSON.stringify(f.value);
    return `- [${subj}] ${f.key} = ${valStr} (conf ${Number(f.confidence).toFixed(2)}, src ${f.source})`;
  });

  const moodLine = latestDiary
    ? `${phtDateString(new Date(latestDiary.entry_date))} mood=${latestDiary.mood ?? "?"} energy=${latestDiary.energy ?? "?"}: ${(latestDiary.body ?? "").slice(0, 200)}`
    : "(no diary entry yet)";

  const planLines = (plans ?? []).map((p) => {
    const amt =
      p.amount != null ? `${m(Number(p.amount))} ${p.currency ?? ""}`.trim() : "?";
    return `- ${p.label ?? "Plan"}: ${amt} due ${p.planned_for ?? "?"} · ${p.status ?? "planned"}`;
  });

  const walletLines = holdings.length
    ? holdings
        .map(
          (h) =>
            `- ${h.name}: ${m(h.balance)}${h.status === "over_overdraft" ? " (over)" : h.status === "within_tolerance" ? " (in tolerance)" : ""}`,
        )
        .join("\n")
    : "- none";

  const text = `WHEN: ${phtDateString(now)} PHT
BASE CURRENCY: ${baseCurrency}

WALLETS:
${walletLines}

PERIOD STATE:
- safeTodayBase: ${m(safeTodayBase)}
- dailyAllowance: ${m(dailyAllowanceBase)}
- discretionaryPool: ${m(discretionaryPoolBase)}
- stabilityMultiplier: ×${stabilityMultiplier.toFixed(2)}
- inRecovery: ${inRecovery}

TOP CATEGORIES (last ${SNAPSHOT_LOOKBACK_DAYS}d):
${topCategories.join("\n") || "- (no spending logged)"}

RECENT SPENDS:
${recentSpends.join("\n") || "- (none)"}

PLANS:
${planLines.join("\n") || "- (none yet)"}

MOOD/DIARY (latest):
${moodLine}

USER FACTS (top ${RECENT_FACT_LIMIT}):
${factLines.join("\n") || "- (none yet)"}
`;

  // Backstop the byte cap. If we tripped it the user has unusually many
  // wallets / plans / facts; trim from the tail (USER FACTS) since it's
  // the lowest-priority block. Dev-only warn so we notice if it's firing.
  let capped = text;
  if (capped.length > SNAPSHOT_MAX_CHARS) {
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.warn(
        `[freelane-state-snapshot] cap hit: ${capped.length} chars > ${SNAPSHOT_MAX_CHARS}; truncating tail`,
      );
    }
    capped = capped.slice(0, SNAPSHOT_MAX_CHARS - 32).trimEnd() + "\n…(truncated)";
  }

  return {
    text: capped,
    generatedAt: new Date().toISOString(),
    baseCurrency,
  };
}

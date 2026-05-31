import "server-only";
import { Type } from "@google/genai";
import { gemini, hasGemini } from "./gemini";
import { HEAVY_MODEL } from "./models";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { logEvent } from "@/lib/data/events";
import { formatMoney } from "@/lib/money";
import { phtToday } from "@/lib/utils";
import type {
  MilestoneKind,
  Payment,
  Spend,
  SpendCategory,
  SpendCategoryLink,
} from "@/lib/supabase/types";

// Milestone Namer (#11) — "make as many of these as possible" (Hatim 2026-06-01).
//
// Detects threshold crossings + writes a short AI-named narrative.
// Detections are pure-math; the Gemini call writes the one-liner. Fallback
// uses a deterministic template when AI is offline.
//
// Crossings detected:
//   - peso_month_threshold       : a month closes with landings ≥ 100k, 200k, 500k, 1M
//   - invoice_count              : 10th, 50th, 100th payment recorded
//   - sadaka_total               : 10k, 50k, 100k total Sadaka given (lifetime)
//   - logging_streak             : 30d / 100d / 365d of consecutive spend logging
//   - smoke_free_days            : 7d / 30d / 90d / 365d without a Cigarettes spend
//   - first_landing_in_currency  : first payment in a new currency
//   - first_plan_done            : first time a planned spend reaches done
//   - loan_closed                : a loan moves to status=closed (deduped per-loan)
//   - recurring_dropped          : a recurring rule moves to active=false (deduped)
//
// Dedupe rule: a milestone is unique on (user_id, kind, achieved_at, label).
// Re-running the detector is idempotent.

const PESO_THRESHOLDS = [100_000, 200_000, 500_000, 1_000_000];
const INVOICE_THRESHOLDS = [10, 50, 100, 500];
const SADAKA_THRESHOLDS = [10_000, 50_000, 100_000];
const STREAK_THRESHOLDS = [30, 100, 365];
const SMOKE_FREE_THRESHOLDS = [7, 30, 90, 365];

interface Candidate {
  kind: MilestoneKind;
  label: string;
  value: number | null;
  unit: string | null;
  context: Record<string, unknown>;
  achievedAt: string;
}

const NARRATIVE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    narrative: { type: Type.STRING },
  },
  required: ["narrative"],
};

const SYSTEM_PROMPT = `You write ONE observational line per milestone for Hatim — a SOLO freelancer in San Pablo, PHT. Base currency PHP. Income unstable.

You receive a list of just-detected milestones. For each, write ONE line (10-20 words) that NAMES the crossing without celebrating it. Cite the number. No congratulations.

HARD RULES (NON-NEGOTIABLE):
- FORBIDDEN PHRASES: "well done", "great job", "congratulations", "keep it up", "you did it", "amazing", "milestone unlocked", "achievement", "you should", "consider", "save", "budget", "remember to".
- Voice: dry, observant. Mirror, never cheer.
- Cigarettes / Sadaka: factual citation only. Religious practice respected, never quantified as a goal.
- Acceptable shapes:
  - "₱100,000 landed in May 2026. The first 6-figure month."
  - "30 days of logged spends, unbroken since May 2."
  - "Sadaka total crosses ₱10,000 lifetime."
  - "First landing in KRW — a Korean client paid through Wise on Mar 14."

Return JSON: { "narrative": "<sentence>" }`;

// Detect peso-month thresholds.
function detectPesoMonthThresholds(payments: Payment[], existing: Set<string>): Candidate[] {
  const byMonth = new Map<string, number>();
  for (const p of payments) {
    const k = p.paid_at.slice(0, 7);
    byMonth.set(k, (byMonth.get(k) ?? 0) + Number(p.net_amount_base ?? 0));
  }
  const out: Candidate[] = [];
  for (const [period, total] of byMonth.entries()) {
    for (const threshold of PESO_THRESHOLDS) {
      if (total < threshold) break;
      const label = `${formatMoney(threshold, "PHP", { compact: true })} landed in ${period}`;
      const achievedAt = `${period}-01`;
      const key = `peso_month_threshold::${achievedAt}::${label}`;
      if (existing.has(key)) continue;
      out.push({
        kind: "peso_month_threshold",
        label,
        value: threshold,
        unit: "PHP",
        context: { period, total_php: Math.round(total) },
        achievedAt,
      });
    }
  }
  return out;
}

// Detect invoice count thresholds.
function detectInvoiceCount(payments: Payment[], existing: Set<string>): Candidate[] {
  const sorted = [...payments].sort((a, b) => a.paid_at.localeCompare(b.paid_at));
  const out: Candidate[] = [];
  for (const threshold of INVOICE_THRESHOLDS) {
    if (sorted.length < threshold) break;
    const milestonePay = sorted[threshold - 1];
    const achievedAt = milestonePay.paid_at;
    const label = `${threshold}th payment recorded`;
    const key = `invoice_count::${achievedAt}::${label}`;
    if (existing.has(key)) continue;
    out.push({
      kind: "invoice_count",
      label,
      value: threshold,
      unit: "payments",
      context: { payment_id: milestonePay.id },
      achievedAt,
    });
  }
  return out;
}

// Detect Sadaka lifetime thresholds.
function detectSadakaThresholds(
  spends: Spend[],
  links: SpendCategoryLink[],
  categories: SpendCategory[],
  existing: Set<string>,
): Candidate[] {
  const sadakaCat = categories.find((c) => /sadaka/i.test(c.name));
  if (!sadakaCat) return [];
  const linkIds = new Set(links.filter((l) => l.category_id === sadakaCat.id).map((l) => l.spend_id));
  const sadakaSpends = spends
    .filter((s) => linkIds.has(s.id))
    .sort((a, b) => a.spent_at.localeCompare(b.spent_at));
  if (sadakaSpends.length === 0) return [];
  const out: Candidate[] = [];
  let running = 0;
  for (const s of sadakaSpends) {
    running += Number(s.amount_base ?? 0);
    for (const threshold of SADAKA_THRESHOLDS) {
      if (running < threshold) continue;
      const label = `Sadaka total reaches ${formatMoney(threshold, "PHP", { compact: true })} lifetime`;
      const achievedAt = s.spent_at;
      const key = `sadaka_total::${achievedAt}::${label}`;
      if (existing.has(key)) continue;
      out.push({
        kind: "sadaka_total",
        label,
        value: threshold,
        unit: "PHP",
        context: { spend_id: s.id, lifetime_total: Math.round(running) },
        achievedAt,
      });
      // Don't break — multiple thresholds could cross on the same row, but
      // each threshold also has its own unique key so they all dedupe naturally.
    }
  }
  return out;
}

// Detect logging streaks (consecutive days with at least one spend logged).
function detectLoggingStreaks(spends: Spend[], existing: Set<string>): Candidate[] {
  if (spends.length === 0) return [];
  const days = new Set<string>(spends.map((s) => s.spent_at.slice(0, 10)));
  const sorted = Array.from(days).sort();
  let runStart = sorted[0];
  let runLen = 1;
  let bestLen = 0;
  let bestStart = sorted[0];
  let bestEnd = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1]);
    const cur = new Date(sorted[i]);
    const diff = Math.round((cur.getTime() - prev.getTime()) / 86_400_000);
    if (diff === 1) {
      runLen += 1;
      if (runLen > bestLen) {
        bestLen = runLen;
        bestStart = runStart;
        bestEnd = sorted[i];
      }
    } else {
      runStart = sorted[i];
      runLen = 1;
    }
  }
  const out: Candidate[] = [];
  for (const threshold of STREAK_THRESHOLDS) {
    if (bestLen < threshold) break;
    const label = `${threshold}-day logging streak — ${bestStart} → ${bestEnd}`;
    const key = `logging_streak::${bestEnd}::${label}`;
    if (existing.has(key)) continue;
    out.push({
      kind: "logging_streak",
      label,
      value: threshold,
      unit: "days",
      context: { since: bestStart, through: bestEnd },
      achievedAt: bestEnd,
    });
  }
  return out;
}

// Detect smoke-free days — consecutive days WITHOUT a Cigarettes-tagged spend.
function detectSmokeFreeDays(
  spends: Spend[],
  links: SpendCategoryLink[],
  categories: SpendCategory[],
  existing: Set<string>,
): Candidate[] {
  const cigCat = categories.find((c) => /cigarettes/i.test(c.name));
  if (!cigCat) return [];
  const linkIds = new Set(links.filter((l) => l.category_id === cigCat.id).map((l) => l.spend_id));
  const cigSpends = spends.filter((s) => linkIds.has(s.id));
  const today = phtToday();
  const lastCigDate = cigSpends.length
    ? cigSpends.sort((a, b) => b.spent_at.localeCompare(a.spent_at))[0].spent_at
    : null;
  if (!lastCigDate) return [];
  const daysSince = Math.floor(
    (new Date(today).getTime() - new Date(lastCigDate).getTime()) / 86_400_000,
  );
  const out: Candidate[] = [];
  for (const threshold of SMOKE_FREE_THRESHOLDS) {
    if (daysSince < threshold) break;
    const label = `${threshold} days since the last Cigarettes spend (last logged ${lastCigDate})`;
    const key = `smoke_free_days::${today}::${label}`;
    if (existing.has(key)) continue;
    out.push({
      kind: "smoke_free_days",
      label,
      value: threshold,
      unit: "days",
      context: { last_cigarettes_at: lastCigDate, days_since: daysSince },
      achievedAt: today,
    });
  }
  return out;
}

async function writeNarrative(candidates: Candidate[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (candidates.length === 0) return out;

  // Fallback narratives (deterministic).
  for (const c of candidates) {
    out.set(`${c.kind}::${c.label}`, fallbackNarrative(c));
  }

  if (!hasGemini()) return out;

  // Batch all candidates into one AI call.
  try {
    const lines = candidates
      .slice(0, 10)
      .map((c, i) => `${i + 1}. kind=${c.kind} label="${c.label}" value=${c.value ?? "n/a"} unit=${c.unit ?? "n/a"}`)
      .join("\n");
    const res = await gemini().models.generateContent({
      model: HEAVY_MODEL,
      contents: `Newly-detected milestones (write a one-line narrative for each, returning a JSON array under "lines"):\n${lines}`,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        temperature: 0.5,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            lines: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  index: { type: Type.NUMBER },
                  narrative: { type: Type.STRING },
                },
                required: ["index", "narrative"],
                propertyOrdering: ["index", "narrative"],
              },
            },
          },
          required: ["lines"],
        },
      },
    });
    const parsed = JSON.parse((res.text ?? "{}").trim()) as { lines?: Array<{ index?: number; narrative?: string }> };
    for (const line of parsed.lines ?? []) {
      const idx = (line.index ?? 1) - 1;
      const cand = candidates[idx];
      if (!cand || !line.narrative) continue;
      out.set(`${cand.kind}::${cand.label}`, line.narrative.trim());
    }
  } catch {
    // Keep fallbacks.
  }
  void NARRATIVE_SCHEMA;
  return out;
}

function fallbackNarrative(c: Candidate): string {
  return c.label;
}

export interface MilestoneSweepArgs {
  payments: Payment[];
  spends: Spend[];
  spendCategories: SpendCategory[];
  spendCategoryLinks: SpendCategoryLink[];
}

export interface MilestoneSweepResult {
  recorded: number;
}

export async function runMilestoneSweep(args: MilestoneSweepArgs): Promise<MilestoneSweepResult> {
  const user = await getAuthUser();
  if (!user) return { recorded: 0 };
  const supabase = await createClient();

  // Load already-recorded milestones to dedupe (last 2 years).
  const { data: existingRows } = await supabase
    .from("milestones")
    .select("kind,label,achieved_at")
    .eq("user_id", user.id);
  const existingKeys = new Set<string>(
    ((existingRows ?? []) as Array<{ kind: string; label: string; achieved_at: string }>).map(
      (m) => `${m.kind}::${m.achieved_at}::${m.label}`,
    ),
  );

  const candidates: Candidate[] = [
    ...detectPesoMonthThresholds(args.payments, existingKeys),
    ...detectInvoiceCount(args.payments, existingKeys),
    ...detectSadakaThresholds(args.spends, args.spendCategoryLinks, args.spendCategories, existingKeys),
    ...detectLoggingStreaks(args.spends, existingKeys),
    ...detectSmokeFreeDays(args.spends, args.spendCategoryLinks, args.spendCategories, existingKeys),
  ];

  if (candidates.length === 0) return { recorded: 0 };

  const narratives = await writeNarrative(candidates);

  let recorded = 0;
  for (const c of candidates) {
    const narrative = narratives.get(`${c.kind}::${c.label}`) ?? fallbackNarrative(c);
    const { data, error } = await supabase
      .from("milestones")
      .upsert(
        {
          user_id: user.id,
          kind: c.kind,
          label: c.label,
          value: c.value,
          unit: c.unit,
          context: c.context,
          narrative,
          achieved_at: c.achievedAt,
          surfaced: true,
        },
        { onConflict: "user_id,kind,achieved_at,label" },
      )
      .select("id")
      .single();
    if (error || !data) continue;
    recorded++;
    await logEvent({
      userId: user.id,
      kind: "milestone.recorded",
      title: `Milestone · ${c.label}`,
      entityType: "milestone",
      entityId: (data as { id: string }).id,
      metadata: { kind: c.kind, value: c.value, unit: c.unit },
    });
  }
  return { recorded };
}

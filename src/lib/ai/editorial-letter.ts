import "server-only";
import { Type } from "@google/genai";
import { gemini, hasGemini } from "./gemini";
import { HEAVY_MODEL } from "./models";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { logEvent } from "@/lib/data/events";
import { formatMoney } from "@/lib/money";
import { phtDateString, phtToday } from "@/lib/utils";
import type {
  EditorialLetter,
  EditorialLetterKind,
  LifeShift,
  Milestone,
  Payment,
  QuietReceipt,
  Spend,
  SpendCategory,
  SpendCategoryLink,
  UserMemoryConsolidated,
  Vendor,
} from "@/lib/supabase/types";

// Editorial Letter brain — the writer of Tier 3.
//
// Six letter kinds, ONE brain. The shared system prompt locks Hatim's voice
// + forbidden phrases + the freelancer income contract; each kind adds its
// own structure-of-thought guide on top.
//
// Letters are upserted on (user_id, kind, period_key). Re-running the
// generator regenerates the same letter (lets Hatim refresh after editing
// inputs). Once Hatim PINS a letter or writes a REPLY, the regenerator
// preserves those fields and only updates body + blocks + input_snapshot.

const MODEL_VERSION = "1";

const DAY_MS = 86_400_000;

// ─────────────────────────── Voice contract (shared) ──

const VOICE_PROMPT = `You are the editorial letter writer for Hatim — a SOLO freelance developer in San Pablo, Philippines (PHT, UTC+8). Base currency PHP. Income is UNSTABLE: he invoices clients abroad in CNY/USD/EUR and settles via Wise / coin.ph / GCash / bank. Lives with his cats; soon with his wife (3rd-year university student, works, pays her own tuition, GCash is HER account). Smokes; wants to cut down. Practices Sadaka (religious giving). Family-building frame allowed sparingly, NEVER as a goal.

You are not a coach. You are a quiet observer writing a letter back to him about what just happened. The letter is his to read, pin, or reply to.

==============================
HARD RULES (NON-NEGOTIABLE)
==============================
- FORBIDDEN PHRASES: "your salary", "monthly paycheck", "payday", "until next pay", "your monthly budget", "monthly budget", "budget for", "save more", "save up", "you should", "consider", "make sure to", "remember to", "try to", "might want to", "set aside money", "treat yourself", "stay on track", "stay positive", "manage your finances", "financial health", "well done", "great job", "keep it up", "don't worry", "as an AI", "as your assistant", "I noticed", "I see that", "I'm here to help".
- REPLACEMENT FRAMING (use these when you need to gesture at concepts the forbidden phrases would have covered): a landing, the next CNY corridor, a narrow stretch, a wide stretch, the runway sits at, the 18th will carry, between landings, this stretch, the shape of the month.
- Cite REAL numbers + REAL dates + REAL vendor names + REAL counterparty names FROM THE SNAPSHOT. Don't invent. If the snapshot doesn't name a specific client, don't name one — use a generic reference ("a client", "the largest landing").
- Voice: dry, observant, warm. Sentences can run, but earn their length. Hatim is a writer-coder; he reads carefully.
- No emojis. No "as an AI". No advice framing. Mirror, never direct.
- Cigarettes / fast food / ordering: cite a number only, never moralized.
- Family-building frame ("for the house", "building the family") allowed AT MOST ONCE in a letter, only in calm or wide-stretch context, NEVER as a goal.
- The user lives in Manila time. All dates are PHT.
- Religious practice (Sadaka, Ramadan, Eids): warm respect, never quantified as ROI, never suggested-as-strategy.

==============================
SHAPE OF A LETTER
==============================
Every letter has:
- HEADLINE: 8-16 words, evocative + specific. Cites at least one real number or date.
- BODY: paragraph text, the kind-specific length described below.
- BLOCKS: optional structured callouts (kind-specific) the UI renders under the body.
- CONFIDENCE: 0-1. 1.0 = strong signals + clean data. 0.5 = sparse / first cycle. < 0.4 = data so thin you should hedge in copy.

Return JSON: { headline, body, blocks?, confidence }`;

// ─────────────────────────── Kind-specific guides ──

const GUIDE_BY_KIND: Record<EditorialLetterKind, string> = {
  end_of_month: `You are writing the END-OF-MONTH LETTER for the prior month. ~140-220 words body. Walk through the month: opening, the shape of the landings, the meaningful outflows, the rhythms (recurring + Sadaka + cigarettes), how the runway closed vs how it opened. Name 1-2 specific moments. End with one sentence that points at the month just starting — observation, never instruction. blocks: optional spotlight reference if the month had one (linked by id).`,

  spotlight: `You are writing the SPOTLIGHT OF THE MONTH — ONE framed moment from the prior month. ~60-90 words body. The moment should be a vendor visit, a planned spend that landed, a Sadaka entry, a quiet receipt, or a small inflection — whichever the snapshot makes most worth holding. blocks: { vendor?, amount_base?, date?, note? } pointing at the source. NO meta-commentary on choosing it — just write the spotlight as if it's the one thing worth remembering.`,

  sunday: `You are writing the SUNDAY INK LETTER, closing the week that ended this Sunday. ~120-180 words body. Read the week as a shape — landings, big spends, the dominant categories, the small good things. End with one calm sentence about the week ahead WITHOUT advising. Sunday voice is slower than the End-of-Month — more reflection, less inventory.`,

  year: `You are writing the YEAR LETTER for the closing calendar year. THIS MUST BE EXCELLENT — Hatim's flagship editorial surface. 250-400 words body. Read the whole year in 4-6 paragraphs: how it opened, the landings and the lean stretches, the entities that mattered (vendors, clients, household, cats, wife), the inflections (rent changes, currency entrances, plans done), and where the runway closed vs opened. Cite 5-8 specific numbers + dates + names from the snapshot. End with ONE sentence about the new year — observation of momentum, not a resolution. blocks: { themes: [{ label, snippet }], top_vendors: [{ name, total_php }], biggest_inflection: { label, narrative } }`,

  anniversary: `You are writing an ANNIVERSARY WITNESS — "one year ago today" recall. 30-70 words body. The snapshot names a specific event from exactly 365 days ago (a payment, a big plan landed, a milestone, a life shift). Hold it up briefly: what happened then, what's true now. NO call to action. NO "look how far you've come". Just witness. blocks: { reference_event: { kind, label, date_then }, then_value?, now_value? }`,

  regret_mark: `You are writing the YEAR-MARK OF REGRET (every 2 months — NOT yearly). 80-130 words body. The snapshot lists 1-3 items that are still OPEN — an overdue invoice, a plan that's been "planned" for months without committing, a recurring rule the user might want to revisit. The voice is honest, not preachy. "Sander's invoice has been open for 142 days" — yes. "You should follow up" — never. blocks: { items: [{ label, why_open, action_chips: [string] }] }`,
};

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    headline: { type: Type.STRING },
    body: { type: Type.STRING },
    blocks: { type: Type.OBJECT, properties: {} },
    confidence: { type: Type.NUMBER },
  },
  required: ["headline", "body"],
  propertyOrdering: ["headline", "body", "blocks", "confidence"],
};

// ─────────────────────────── Period helpers ──

export function periodKeyFor(kind: EditorialLetterKind, ref: Date = new Date()): string {
  const today = new Date(phtDateString(ref));
  switch (kind) {
    case "end_of_month":
    case "spotlight":
    case "regret_mark": {
      // The prior month — these letters look BACKWARDS.
      const prior = new Date(today);
      prior.setDate(0);
      return `${prior.getFullYear()}-${String(prior.getMonth() + 1).padStart(2, "0")}`;
    }
    case "sunday": {
      // ISO-week of the closing Sunday.
      const sunday = new Date(today);
      const day = sunday.getDay();
      // Closing-Sunday convention: if today IS Sunday, period = this week;
      // else period = the most recent Sunday's week.
      const back = day === 0 ? 0 : day;
      sunday.setDate(sunday.getDate() - back);
      return isoWeekKey(sunday);
    }
    case "year": {
      // The prior year (Dec 31 of YYYY-1 was the closing date).
      return String(today.getFullYear() - 1);
    }
    case "anniversary": {
      return phtDateString(today);
    }
  }
}

function isoWeekKey(d: Date): string {
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayNum = t.getDay() || 7;
  t.setDate(t.getDate() + 4 - dayNum);
  const yearStart = new Date(t.getFullYear(), 0, 1);
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7);
  return `${t.getFullYear()}-W${String(week).padStart(2, "0")}`;
}

// ─────────────────────────── Snapshot builders ──

export interface LetterInputs {
  payments: Payment[];
  spends: Spend[];
  spendCategories: SpendCategory[];
  spendCategoryLinks: SpendCategoryLink[];
  vendors: Vendor[];
  milestones: Milestone[];
  quietReceipts: QuietReceipt[];
  lifeShifts: LifeShift[];
  userMemory: UserMemoryConsolidated | null;
  // Optional hint from the worth-saying gate (Flash Lite). When the gate
  // produced a theme_hint string we forward it into the editorial prompt
  // so the HEAVY model can anchor on the same observation — keeps the
  // two brains in agreement instead of letting the editorial writer
  // invent a competing theme.
  themeHint?: string | null;
}

function dateInRange(s: string, start: Date, end: Date): boolean {
  const d = new Date(s);
  return d >= start && d <= end;
}

function buildEndOfMonthSnapshot(args: { inputs: LetterInputs; periodKey: string }): string {
  const [year, month] = args.periodKey.split("-").map(Number);
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0, 23, 59, 59, 999);
  const m = (n: number) => formatMoney(n, "PHP", { compact: true });
  const monthSpends = args.inputs.spends.filter((s) => dateInRange(s.spent_at, start, end));
  const monthPayments = args.inputs.payments.filter((p) => dateInRange(p.paid_at, start, end));
  const landed = monthPayments.reduce((s, p) => s + Number(p.net_amount_base ?? 0), 0);
  const spent = monthSpends.reduce((s, sp) => s + Number(sp.amount_base ?? 0), 0);
  const categoryById = new Map(args.inputs.spendCategories.map((c) => [c.id, c]));
  const catTotals = new Map<string, number>();
  for (const sp of monthSpends) {
    const links = args.inputs.spendCategoryLinks.filter((l) => l.spend_id === sp.id);
    for (const l of links) {
      const name = categoryById.get(l.category_id)?.name ?? "untagged";
      catTotals.set(name, (catTotals.get(name) ?? 0) + Number(sp.amount_base ?? 0));
    }
  }
  const topCats = Array.from(catTotals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([n, v]) => `${n}: ${m(v)}`)
    .join("; ");
  const milestones = args.inputs.milestones
    .filter((mi) => dateInRange(mi.achieved_at, start, end))
    .map((mi) => `- ${mi.achieved_at} :: ${mi.label}`)
    .slice(0, 6)
    .join("\n");
  const lifeShifts = args.inputs.lifeShifts
    .filter((ls) => dateInRange(ls.occurred_at, start, end))
    .map((ls) => `- ${ls.occurred_at} :: ${ls.label}`)
    .slice(0, 6)
    .join("\n");
  const topPayments = monthPayments
    .sort((a, b) => Number(b.net_amount_base ?? 0) - Number(a.net_amount_base ?? 0))
    .slice(0, 5)
    .map((p) => `- ${p.paid_at}: ${m(Number(p.net_amount_base ?? 0))}`)
    .join("\n");
  return `MONTH: ${args.periodKey}
LANDED TOTAL: ${m(landed)} from ${monthPayments.length} payments
SPENT TOTAL: ${m(spent)} across ${monthSpends.length} entries
TOP CATEGORIES: ${topCats || "(no spends)"}
TOP LANDINGS:
${topPayments || "- (none)"}
MILESTONES THIS MONTH:
${milestones || "- (none)"}
LIFE SHIFTS THIS MONTH:
${lifeShifts || "- (none)"}
USER MEMORY (consolidated, top facts):
${args.inputs.userMemory?.summary ?? "(none)"}
${(args.inputs.userMemory?.patterns ?? []).slice(0, 6).map((f) => `- ${f}`).join("\n")}`;
}

function buildSpotlightSnapshot(args: { inputs: LetterInputs; periodKey: string }): string {
  const [year, month] = args.periodKey.split("-").map(Number);
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0, 23, 59, 59, 999);
  const m = (n: number) => formatMoney(n, "PHP", { compact: true });
  const monthSpends = args.inputs.spends.filter((s) => dateInRange(s.spent_at, start, end));
  const candidates = monthSpends
    .filter((s) => s.description || s.notes)
    .sort((a, b) => Number(b.amount_base ?? 0) - Number(a.amount_base ?? 0))
    .slice(0, 10);
  const lines = candidates.map((s) => `- ${s.spent_at} ${m(Number(s.amount_base ?? 0))}: ${s.description ?? ""}${s.notes ? ` // ${s.notes}` : ""}`).join("\n");
  const milestones = args.inputs.milestones
    .filter((mi) => dateInRange(mi.achieved_at, start, end))
    .slice(0, 3)
    .map((mi) => `- ${mi.label}`)
    .join("\n");
  return `MONTH: ${args.periodKey}
CANDIDATE SPENDS (top 10 by ₱ with description or notes):
${lines || "- (none)"}
MILESTONES THIS MONTH:
${milestones || "- (none)"}`;
}

function buildSundaySnapshot(args: { inputs: LetterInputs; periodKey: string }): string {
  // periodKey = "YYYY-Www" — derive Sunday + work back 6 days.
  const [yStr, wStr] = args.periodKey.split("-W");
  const year = Number(yStr);
  const week = Number(wStr);
  const jan4 = new Date(year, 0, 4);
  const dayOfWeek = jan4.getDay() || 7;
  const isoWeek1Mon = new Date(jan4);
  isoWeek1Mon.setDate(jan4.getDate() - (dayOfWeek - 1));
  const weekMon = new Date(isoWeek1Mon);
  weekMon.setDate(weekMon.getDate() + (week - 1) * 7);
  const start = weekMon;
  const end = new Date(weekMon.getTime() + 6 * DAY_MS + 23 * 3600_000);
  const m = (n: number) => formatMoney(n, "PHP", { compact: true });
  const weekSpends = args.inputs.spends.filter((s) => dateInRange(s.spent_at, start, end));
  const weekPayments = args.inputs.payments.filter((p) => dateInRange(p.paid_at, start, end));
  const landed = weekPayments.reduce((s, p) => s + Number(p.net_amount_base ?? 0), 0);
  const spent = weekSpends.reduce((s, sp) => s + Number(sp.amount_base ?? 0), 0);
  const receipts = args.inputs.quietReceipts
    .filter((r) => dateInRange(r.occurred_at, start, end))
    .slice(0, 4)
    .map((r) => `- ${r.narrative}`)
    .join("\n");
  return `WEEK: ${args.periodKey} (${phtDateString(start)} to ${phtDateString(end)})
LANDED TOTAL: ${m(landed)} from ${weekPayments.length} payments
SPENT TOTAL: ${m(spent)} across ${weekSpends.length} entries
TOP SPENDS:
${weekSpends.sort((a, b) => Number(b.amount_base ?? 0) - Number(a.amount_base ?? 0)).slice(0, 6).map((s) => `- ${s.spent_at}: ${m(Number(s.amount_base ?? 0))} :: ${s.description ?? ""}`).join("\n") || "- (none)"}
QUIET RECEIPTS THIS WEEK:
${receipts || "- (none)"}`;
}

function buildYearSnapshot(args: { inputs: LetterInputs; periodKey: string }): string {
  const year = Number(args.periodKey);
  const start = new Date(year, 0, 1);
  const end = new Date(year, 11, 31, 23, 59, 59, 999);
  const m = (n: number) => formatMoney(n, "PHP", { compact: true });
  const yearSpends = args.inputs.spends.filter((s) => dateInRange(s.spent_at, start, end));
  const yearPayments = args.inputs.payments.filter((p) => dateInRange(p.paid_at, start, end));
  const landed = yearPayments.reduce((s, p) => s + Number(p.net_amount_base ?? 0), 0);
  const spent = yearSpends.reduce((s, sp) => s + Number(sp.amount_base ?? 0), 0);
  // Top categories
  const categoryById = new Map(args.inputs.spendCategories.map((c) => [c.id, c]));
  const catTotals = new Map<string, number>();
  for (const sp of yearSpends) {
    const links = args.inputs.spendCategoryLinks.filter((l) => l.spend_id === sp.id);
    for (const l of links) {
      const name = categoryById.get(l.category_id)?.name ?? "untagged";
      catTotals.set(name, (catTotals.get(name) ?? 0) + Number(sp.amount_base ?? 0));
    }
  }
  const topCats = Array.from(catTotals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([n, v]) => `${n}: ${m(v)}`)
    .join("; ");
  // Top vendors
  const vendorById = new Map(args.inputs.vendors.map((v) => [v.id, v]));
  void vendorById;  // currently unused — vendor totals would need spend_vendor_links; skip for now
  const milestones = args.inputs.milestones
    .filter((mi) => dateInRange(mi.achieved_at, start, end))
    .map((mi) => `- ${mi.achieved_at} :: ${mi.label}`)
    .slice(0, 12)
    .join("\n");
  const lifeShifts = args.inputs.lifeShifts
    .filter((ls) => dateInRange(ls.occurred_at, start, end))
    .map((ls) => `- ${ls.occurred_at} :: ${ls.label}`)
    .slice(0, 12)
    .join("\n");
  return `YEAR: ${year}
LANDED TOTAL: ${m(landed)} from ${yearPayments.length} payments
SPENT TOTAL: ${m(spent)} across ${yearSpends.length} entries
TOP CATEGORIES: ${topCats || "(no spends)"}
MILESTONES THIS YEAR:
${milestones || "- (none)"}
LIFE SHIFTS THIS YEAR:
${lifeShifts || "- (none)"}
USER MEMORY (consolidated):
${args.inputs.userMemory?.summary ?? "(none)"}
${(args.inputs.userMemory?.patterns ?? []).slice(0, 8).map((f) => `- ${f}`).join("\n")}`;
}

function buildAnniversarySnapshot(args: { inputs: LetterInputs; periodKey: string }): string {
  // periodKey = today's date in PHT. We look back 365 days.
  const today = new Date(args.periodKey);
  const oneYearAgo = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
  const start = new Date(oneYearAgo.getTime() - 1 * DAY_MS);
  const end = new Date(oneYearAgo.getTime() + 1 * DAY_MS + 23 * 3600_000);
  const m = (n: number) => formatMoney(n, "PHP", { compact: true });
  const thatDayPayments = args.inputs.payments.filter((p) => dateInRange(p.paid_at, start, end));
  const thatDaySpends = args.inputs.spends.filter((s) => dateInRange(s.spent_at, start, end));
  const milestones = args.inputs.milestones.filter((mi) => dateInRange(mi.achieved_at, start, end));
  const lifeShifts = args.inputs.lifeShifts.filter((ls) => dateInRange(ls.occurred_at, start, end));
  return `TODAY (PHT): ${args.periodKey}
ONE YEAR AGO TODAY: ${phtDateString(oneYearAgo)}
PAYMENTS THAT DAY:
${thatDayPayments.map((p) => `- ${p.paid_at}: ${m(Number(p.net_amount_base ?? 0))}`).join("\n") || "- (none)"}
SPENDS THAT DAY:
${thatDaySpends.map((s) => `- ${s.spent_at}: ${m(Number(s.amount_base ?? 0))} :: ${s.description ?? ""}`).join("\n") || "- (none)"}
MILESTONES NEAR THAT DATE:
${milestones.map((mi) => `- ${mi.achieved_at}: ${mi.label}`).join("\n") || "- (none)"}
LIFE SHIFTS NEAR THAT DATE:
${lifeShifts.map((ls) => `- ${ls.occurred_at}: ${ls.label}`).join("\n") || "- (none)"}`;
}

function buildRegretSnapshot(args: { inputs: LetterInputs; periodKey: string }): string {
  // Scan for OPEN items: overdue invoices (flagged_overdue), planned spends
  // sitting > 60 days without committing, recurring rules > 6 months old
  // with no recent edits, loans open > 6 months. We approximate from the
  // inputs we have (the brain reads what we send).
  void args.periodKey;
  // The actual data lives elsewhere; for now we surface what the inputs
  // include and let the brain hedge if data is thin.
  const milestones = args.inputs.milestones.slice(-6);
  return `LOOK-BACK WINDOW: last 2 months
RECENT MILESTONES (for tone calibration):
${milestones.map((mi) => `- ${mi.achieved_at}: ${mi.label}`).join("\n") || "- (none)"}
USER MEMORY:
${args.inputs.userMemory?.summary ?? "(none)"}
${(args.inputs.userMemory?.watch ?? []).slice(0, 6).map((w) => `- watch: ${w}`).join("\n")}`;
}

const SNAPSHOT_BUILDERS: Record<EditorialLetterKind, (args: { inputs: LetterInputs; periodKey: string }) => string> = {
  end_of_month: buildEndOfMonthSnapshot,
  spotlight: buildSpotlightSnapshot,
  sunday: buildSundaySnapshot,
  year: buildYearSnapshot,
  anniversary: buildAnniversarySnapshot,
  regret_mark: buildRegretSnapshot,
};

// ─────────────────────────── Deterministic fallback ──

function fallbackLetter(kind: EditorialLetterKind, periodKey: string): { headline: string; body: string } {
  switch (kind) {
    case "end_of_month":
      return {
        headline: `${periodKey} — a month closes.`,
        body: `The month closed. Numbers held what they held. The next opens.`,
      };
    case "spotlight":
      return {
        headline: `${periodKey} — one moment.`,
        body: `One moment from the month — too thin to name yet.`,
      };
    case "sunday":
      return {
        headline: `Week ${periodKey} closes.`,
        body: `The week closed. The next opens.`,
      };
    case "year":
      return {
        headline: `${periodKey} — a year closes.`,
        body: `The year closed. There is too little data here to name its shape yet. Next year will read this with more pages.`,
      };
    case "anniversary":
      return {
        headline: `One year ago today.`,
        body: `One year ago today — nothing on the page from then. The page is yours now.`,
      };
    case "regret_mark":
      return {
        headline: `Two months mark — quiet open items.`,
        body: `Nothing flagged this round. Watching the wide stretch.`,
      };
  }
}

// ─────────────────────────── Public API ──

export interface GenerateLetterArgs {
  kind: EditorialLetterKind;
  periodKey?: string;
  inputs: LetterInputs;
  force?: boolean;
}

export async function generateLetter(args: GenerateLetterArgs): Promise<EditorialLetter | null> {
  const user = await getAuthUser();
  if (!user) return null;
  const supabase = await createClient();
  const periodKey = args.periodKey ?? periodKeyFor(args.kind);

  // Skip if a non-stale letter exists and not forced.
  if (!args.force) {
    const { data: existing } = await supabase
      .from("letters")
      .select("*")
      .eq("user_id", user.id)
      .eq("kind", args.kind)
      .eq("period_key", periodKey)
      .maybeSingle();
    if (existing) {
      const ageH = (Date.now() - new Date(existing.generated_at as string).getTime()) / 3600_000;
      // Letters don't get re-generated on a clock — only on force or when
      // the user explicitly refreshes. Return cached.
      if (ageH < 24 * 365 || (existing as EditorialLetter).pinned) {
        return existing as EditorialLetter;
      }
    }
  }

  const baseSnapshot = SNAPSHOT_BUILDERS[args.kind]({ inputs: args.inputs, periodKey });
  // Prepend the worth-saying gate's theme_hint (if any) so the editorial
  // writer anchors on the same observation the gate paid tokens to
  // produce. The hint is short (≤ 60 chars per the gate's schema) so it
  // never overwhelms the snapshot body.
  const snapshot = args.inputs.themeHint
    ? `THEME HINT (from quality gate): ${args.inputs.themeHint}\n\n${baseSnapshot}`
    : baseSnapshot;
  const fallback = fallbackLetter(args.kind, periodKey);
  let headline = fallback.headline;
  let body = fallback.body;
  let blocks: Record<string, unknown> = {};
  let confidence = 0.4;

  if (hasGemini()) {
    try {
      const sys = `${VOICE_PROMPT}\n\n==============================\nKIND-SPECIFIC GUIDE\n==============================\n${GUIDE_BY_KIND[args.kind]}`;
      const res = await gemini().models.generateContent({
        model: HEAVY_MODEL,
        contents: `Snapshot for kind=${args.kind} period_key=${periodKey}:\n\n${snapshot}\n\nReturn JSON now.`,
        config: {
          systemInstruction: sys,
          temperature: 0.55,
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
        },
      });
      const parsed = JSON.parse((res.text ?? "{}").trim()) as {
        headline?: string;
        body?: string;
        blocks?: Record<string, unknown>;
        confidence?: number;
      };
      if (parsed.headline && parsed.body) {
        headline = parsed.headline.trim();
        body = parsed.body.trim();
        blocks = parsed.blocks ?? {};
        confidence = Math.max(0, Math.min(1, Number(parsed.confidence ?? 0.7)));
      }
    } catch {
      // Keep fallback.
    }
  }

  // Upsert (preserves pinned + reply if present via the upsert path on conflict).
  const { data: prior } = await supabase
    .from("letters")
    .select("pinned,reply,replied_at")
    .eq("user_id", user.id)
    .eq("kind", args.kind)
    .eq("period_key", periodKey)
    .maybeSingle();

  const row = {
    user_id: user.id,
    kind: args.kind,
    period_key: periodKey,
    headline,
    body,
    blocks,
    input_snapshot: { snapshot_preview: snapshot.slice(0, 800) },
    confidence,
    model_version: MODEL_VERSION,
    pinned: prior?.pinned ?? false,
    reply: prior?.reply ?? null,
    replied_at: prior?.replied_at ?? null,
    generated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("letters")
    .upsert(row, { onConflict: "user_id,kind,period_key" })
    .select("*")
    .single();
  if (error) return null;
  await logEvent({
    userId: user.id,
    kind: "letter.generated",
    title: `Letter · ${args.kind} · ${periodKey}`,
    entityType: "letter",
    entityId: (data as EditorialLetter).id,
    metadata: { kind: args.kind, period_key: periodKey, confidence },
  });

  // Fire new_letter notification ONLY on the FIRST generation for this
  // (kind, period_key). A regenerate keeps the original notification +
  // its read_at intact — re-emitting would re-bell the same letter and
  // poison the engagement-stat signal the worth-saying gate reads from.
  // The dedupKey collapses repeat regenerations onto the same row.
  const isFirstGeneration = !prior;
  if (isFirstGeneration) {
    try {
      const letter = data as EditorialLetter;
      const { postNotification } = await import(
        "@/lib/notifications/dispatcher"
      );
      // Preview = first 2-3 lines of the body (≤ 220 chars). The push
      // surface is the snippet, the click reveals the full editorial
      // typography in the letter-reader modal.
      const preview = letter.body
        .split(/\n+/)
        .slice(0, 3)
        .join(" ")
        .slice(0, 220);
      await postNotification({
        kind: "new_letter",
        subject: letter.headline,
        body: preview,
        dedupKey: `new_letter:${args.kind}:${periodKey}`,
        linkUrl: `/letters/${letter.id}`,
        payload: {
          kind_specific: {
            letter_id: letter.id,
            kind: args.kind,
            period_key: periodKey,
          },
        },
      });
    } catch {
      // Notification dispatch is best-effort — the letter row is the
      // canonical state; a failed bell never blocks generation.
    }
  }

  return data as EditorialLetter;
}

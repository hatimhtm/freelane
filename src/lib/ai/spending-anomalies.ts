import "server-only";
import { Type } from "@google/genai";
import { gemini, hasGemini, HEAVY_MODEL } from "./models";
import { linksBySpend } from "@/lib/spends";
import { spendsByCategoryInRange } from "@/lib/dashboard-calc";
import { formatMoney } from "@/lib/money";
import type {
  Spend,
  SpendCategory,
  SpendCategoryLink,
} from "@/lib/supabase/types";

export type SpendingAnomalyKind =
  | "category_spike"
  | "vendor_spike"
  | "pace_warning"
  | "category_dip"
  | "note";

export interface SpendingAnomaly {
  kind: SpendingAnomalyKind;
  title: string;
  detail: string;
  refCategoryId?: string;
  refVendor?: string;
}

const MIN_THIS_MONTH_SPENDS = 5;
const MIN_TRAILING_SPENDS = 30;
const TOP_CATEGORIES = 10;
const TOP_VENDORS = 12;
const RECENT_NOTES = 12;
const VENDOR_TOKEN_MIN_LEN = 3;

const KNOWN_KINDS: readonly SpendingAnomalyKind[] = [
  "category_spike",
  "vendor_spike",
  "pace_warning",
  "category_dip",
  "note",
];

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    anomalies: {
      type: Type.ARRAY,
      minItems: 0,
      maxItems: 3,
      items: {
        type: Type.OBJECT,
        properties: {
          kind: { type: Type.STRING, enum: [...KNOWN_KINDS] },
          title: { type: Type.STRING },
          detail: { type: Type.STRING },
          refCategoryId: { type: Type.STRING, nullable: true },
          refVendor: { type: Type.STRING, nullable: true },
        },
        required: ["kind", "title", "detail"],
        propertyOrdering: ["kind", "title", "detail", "refCategoryId", "refVendor"],
      },
    },
  },
  required: ["anomalies"],
  propertyOrdering: ["anomalies"],
};

const SYSTEM_PROMPT = `You are a sharp spending analyst for a Filipino freelancer. You see this month's spends + the trailing 6mo baseline. Return 1-3 anomalies: real number-grounded observations only. Categories that surged or dropped vs typical. Vendors that look new or unusually frequent. Pacing concerns. Each anomaly cites a real number from the data. No vague advice. No preaching. No \`as an AI\`. Plain warm sharp.

HARD RULES:
- Each anomaly MUST cite a concrete peso amount, count, or percentage from the snapshot.
- title ≤ 8 words. detail ≤ 24 words.
- refCategoryId only when you reference a category that appears in the CATEGORIES block (use the exact id).
- refVendor only when you reference a vendor token that appears in the VENDORS block.
- Skip vague entries. Better to return fewer (or zero) than to invent.
- Plain, warm, sharp. No filler. No therapy. No "as an AI".

Return ONLY the JSON object.`;

function vendorToken(description: string | null | undefined): string | null {
  if (!description) return null;
  const cleaned = description.trim().toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, " ");
  const first = cleaned.split(/\s+/).find((w) => w.length >= VENDOR_TOKEN_MIN_LEN);
  return first ?? null;
}

interface VendorStat {
  token: string;
  count: number;
  total: number;
  lastSeenAt: string;
}

function vendorStats(spends: Spend[]): VendorStat[] {
  const byToken = new Map<string, VendorStat>();
  for (const sp of spends) {
    const token = vendorToken(sp.description);
    if (!token) continue;
    const amt = Number(sp.amount_base ?? 0);
    if (!Number.isFinite(amt) || amt <= 0) continue;
    const cur = byToken.get(token);
    if (!cur) {
      byToken.set(token, {
        token,
        count: 1,
        total: amt,
        lastSeenAt: sp.spent_at,
      });
    } else {
      cur.count += 1;
      cur.total += amt;
      if (sp.spent_at > cur.lastSeenAt) cur.lastSeenAt = sp.spent_at;
    }
  }
  return [...byToken.values()].sort((a, b) => b.total - a.total);
}

function snippet(text: string | null | undefined, max = 60): string | null {
  if (!text) return null;
  const t = text.trim().replace(/\s+/g, " ");
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function buildSnapshot(args: {
  spendsThisMonth: Spend[];
  spendsTrailing6mo: Spend[];
  categories: SpendCategory[];
  categoryLinks: SpendCategoryLink[];
}): string {
  const currency = "PHP" as const;
  const m = (n: number) => formatMoney(n, currency, { compact: true });

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const daysElapsed = Math.max(
    1,
    Math.floor((now.getTime() - startOfMonth.getTime()) / 86_400_000) + 1,
  );
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const trailingStart = new Date(now.getFullYear(), now.getMonth() - 6, 1);
  const trailingMonths = 6;

  const links = linksBySpend(args.categoryLinks);
  const catById = new Map(args.categories.map((c) => [c.id, c]));

  const thisMonthTotal = args.spendsThisMonth.reduce(
    (s, sp) => s + Number(sp.amount_base ?? 0),
    0,
  );
  const trailingTotal = args.spendsTrailing6mo.reduce(
    (s, sp) => s + Number(sp.amount_base ?? 0),
    0,
  );
  const trailingMonthlyAvg = trailingTotal / trailingMonths;
  const paceMultiple =
    trailingMonthlyAvg > 0
      ? (thisMonthTotal / daysElapsed) * daysInMonth / trailingMonthlyAvg
      : 0;

  const thisMonthCats = spendsByCategoryInRange(
    args.spendsThisMonth,
    links,
    startOfMonth,
    now,
  ).slice(0, TOP_CATEGORIES);

  const trailingCats = spendsByCategoryInRange(
    args.spendsTrailing6mo,
    links,
    trailingStart,
    startOfMonth,
  );
  const trailingCatAvg = new Map<string, number>();
  for (const row of trailingCats) {
    trailingCatAvg.set(row.categoryId, row.total / trailingMonths);
  }

  const catLines = thisMonthCats.map((row) => {
    const cat = catById.get(row.categoryId);
    const avg = trailingCatAvg.get(row.categoryId) ?? 0;
    const delta = avg > 0 ? ((row.total - avg) / avg) * 100 : null;
    const deltaStr =
      delta === null
        ? "no trailing baseline"
        : `${delta >= 0 ? "+" : ""}${delta.toFixed(0)}% vs typical ${m(avg)}`;
    return `- [id:${row.categoryId}] ${cat?.name ?? "untagged"}: ${m(row.total)} this month (${deltaStr})`;
  });

  // Surface categories that DROPPED hard too (present in trailing, absent or
  // tiny this month) — that's a `category_dip` signal.
  const dipLines: string[] = [];
  const thisMonthByCat = new Map(thisMonthCats.map((r) => [r.categoryId, r.total]));
  for (const [catId, avg] of trailingCatAvg.entries()) {
    if (avg < 200) continue;
    const cur = thisMonthByCat.get(catId) ?? 0;
    if (cur >= avg * 0.4) continue;
    const cat = catById.get(catId);
    if (!cat) continue;
    dipLines.push(
      `- [id:${catId}] ${cat.name}: only ${m(cur)} this month vs typical ${m(avg)}`,
    );
    if (dipLines.length >= 5) break;
  }

  const thisMonthVendors = vendorStats(args.spendsThisMonth).slice(0, TOP_VENDORS);
  const trailingVendors = new Map(
    vendorStats(args.spendsTrailing6mo).map((v) => [v.token, v]),
  );
  const vendorLines = thisMonthVendors.map((v) => {
    const trailing = trailingVendors.get(v.token);
    const isNew = !trailing;
    const trailingMonthlyCount = trailing ? trailing.count / trailingMonths : 0;
    const newFlag = isNew ? " · NEW (no trailing history)" : "";
    const freqFlag =
      !isNew && trailingMonthlyCount > 0 && v.count > trailingMonthlyCount * 2
        ? ` · ${v.count} visits vs typical ${trailingMonthlyCount.toFixed(1)}/mo`
        : "";
    return `- "${v.token}": ${v.count} visits, ${m(v.total)} total · avg ${m(v.total / v.count)}${newFlag}${freqFlag}`;
  });

  const recentNotes = args.spendsThisMonth
    .filter((sp) => (sp.notes ?? "").trim() || (sp.description ?? "").trim())
    .slice(0, RECENT_NOTES)
    .map((sp) => {
      const cats = (links.get(sp.id) ?? [])
        .map((id) => catById.get(id)?.name)
        .filter(Boolean)
        .join(", ");
      const note = snippet(sp.notes);
      const desc = snippet(sp.description);
      const label = [desc, note].filter(Boolean).join(" — ");
      return `- ${sp.spent_at.slice(0, 10)} ${m(Number(sp.amount_base ?? 0))}${cats ? ` [${cats}]` : ""}: ${label || "(no detail)"}`;
    });

  return `NOW: ${now.toISOString().slice(0, 10)}
Days elapsed this month: ${daysElapsed} of ${daysInMonth}.
Base currency: ${currency}.

THIS MONTH TOTAL: ${m(thisMonthTotal)} across ${args.spendsThisMonth.length} spends.
TRAILING 6MO TOTAL: ${m(trailingTotal)} across ${args.spendsTrailing6mo.length} spends (avg ${m(trailingMonthlyAvg)}/mo).
PROJECTED FULL MONTH at current pace: ${paceMultiple > 0 ? `${paceMultiple.toFixed(2)}× typical` : "n/a"}.

CATEGORIES this month (vs trailing 6mo monthly avg):
${catLines.join("\n") || "- none"}

CATEGORIES with notable DIPS (present in trailing, quiet this month):
${dipLines.join("\n") || "- none"}

VENDORS this month (top by total):
${vendorLines.join("\n") || "- none"}

RECENT NOTES (this month):
${recentNotes.join("\n") || "- none"}`;
}

export async function generateSpendingAnomalies(args: {
  spendsThisMonth: Spend[];
  spendsTrailing6mo: Spend[];
  categories: SpendCategory[];
  categoryLinks: SpendCategoryLink[];
}): Promise<SpendingAnomaly[]> {
  try {
    if (!hasGemini()) return [];
    if (args.spendsThisMonth.length < MIN_THIS_MONTH_SPENDS) return [];
    if (args.spendsTrailing6mo.length < MIN_TRAILING_SPENDS) return [];

    const knownCategoryIds = new Set(args.categories.map((c) => c.id));
    const knownVendors = new Set(
      [...args.spendsThisMonth, ...args.spendsTrailing6mo]
        .map((sp) => vendorToken(sp.description))
        .filter((v): v is string => !!v),
    );

    const snapshot = buildSnapshot(args);

    const res = await gemini().models.generateContent({
      model: HEAVY_MODEL,
      contents: `Snapshot:\n\n${snapshot}\n\nReturn the JSON object now.`,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        temperature: 0.3,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
      },
    });

    const parsed = JSON.parse((res.text ?? "{}").trim()) as {
      anomalies?: Array<{
        kind?: unknown;
        title?: unknown;
        detail?: unknown;
        refCategoryId?: unknown;
        refVendor?: unknown;
      }>;
    };

    const out: SpendingAnomaly[] = [];
    for (const raw of (parsed.anomalies ?? []).slice(0, 3)) {
      const title = typeof raw.title === "string" ? raw.title.trim() : "";
      const detail = typeof raw.detail === "string" ? raw.detail.trim() : "";
      if (!title || !detail) continue;
      const kind: SpendingAnomalyKind =
        typeof raw.kind === "string" &&
        (KNOWN_KINDS as readonly string[]).includes(raw.kind)
          ? (raw.kind as SpendingAnomalyKind)
          : "note";

      const refCategoryId =
        typeof raw.refCategoryId === "string" && knownCategoryIds.has(raw.refCategoryId)
          ? raw.refCategoryId
          : undefined;
      const refVendor =
        typeof raw.refVendor === "string" && knownVendors.has(raw.refVendor.toLowerCase())
          ? raw.refVendor.toLowerCase()
          : undefined;

      out.push({ kind, title, detail, refCategoryId, refVendor });
    }
    return out;
  } catch {
    return [];
  }
}

import "server-only";
import { phtDateString } from "@/lib/utils";
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
import { eidPrepWindows, type EidPrepWindow, EID_PREP_WINDOW_DAYS } from "@/lib/islamic-calendar";
import { formatMoney } from "@/lib/money";
import type {
  IslamicCalendarRow,
  PlannedSpend,
  Spend,
  SpendCategoryLink,
} from "@/lib/supabase/types";

// Eid Preparation Plan (G) — 60 days out, surfaces a prep card per upcoming
// Eid. Reads last year's same-Eid spending shape + suggests a parking amount
// + lists big-ticket reminders.
//
// Both Eids are covered (#7 expanded). The card has a free-text reply so
// Hatim can adjust the forecast inline.

const DAY_MS = 86_400_000;
const LAST_YEAR_WINDOW_DAYS = 14;  // ±14d around the same Eid date last year

export interface EidPrepRead {
  windows: EidPrepCard[];
}

export interface EidPrepCard {
  kind: "eid_al_fitr" | "eid_al_adha";
  label: string;
  date: string;
  daysUntil: number;
  hijriLabel: string | null;
  lastYearTotalBase: number;
  lastYearSpendCount: number;
  suggestedParkingBase: number;
  existingPlansBase: number;
  bigTicketReminders: string[];
  // AI prose written when GeminI is available.
  narrative: string;
  fromAi: boolean;
}

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    narrative: { type: Type.STRING },
    bigTicketReminders: { type: Type.ARRAY, maxItems: 4, items: { type: Type.STRING } },
  },
  required: ["narrative"],
  propertyOrdering: ["narrative", "bigTicketReminders"],
};

const SYSTEM_PROMPT = `You write the Eid preparation card for Hatim, a Muslim SOLO freelancer in San Pablo, Philippines. Income is UNSTABLE.

You receive: which Eid (al-Fitr or al-Adha), days until, last year's same-Eid spending shape, currently planned Eid spends, suggested parking amount.

Write ONE short paragraph (2-3 sentences, ≤ 70 words) that frames the prep. Tone: warm, anchored in last year's shape. Then 0-3 short big-ticket reminders.

HARD RULES (NON-NEGOTIABLE):
- FORBIDDEN PHRASES: "should", "consider", "save", "budget", "you might want to", "try to", "remember to", "make sure".
- Use REAL numbers from the snapshot.
- Voice: warm, Islamic practice respected. No moralizing.
- Family-building frame allowed once if data supports.
- Mention currency in pesos with ₱.

EXAMPLES:
{
  "narrative": "Eid al-Fitr arrives in 47 days. Last year you spent ₱6,200 across 9 entries on it — mostly gifts and a meal. Parking ₱5,000 in coin.ph between now and the day keeps the runway clean when the Eid week lands.",
  "bigTicketReminders": ["Eid clothes for wife (last year ₱1,800)", "Gifts for Lola + cousins", "Eid meal at home"]
}

Return JSON.`;

export async function getEidPrepCached(): Promise<CachedBrainPayload<EidPrepRead> | null> {
  return readBrainCache<EidPrepRead>(BRAIN_KEYS.EID_PREP);
}

export async function generateEidPrep(
  args: {
    islamic: IslamicCalendarRow[];
    spends: Spend[];
    spendCategoryLinks: SpendCategoryLink[];
    plannedSpends: PlannedSpend[];
    now?: Date;
  },
  opts: { force?: boolean } = {},
): Promise<EidPrepRead> {
  // EID_PREP keys off the Hijri calendar row ids — calendar-driven freshness,
  // not spend-driven. A fingerprint over calendar row ids + days-until window
  // is enough to bust the cache when a new Eid lands.
  const fingerprint = await fingerprintFromIds([
    ...args.islamic.map((r) => r.id),
    `now:${phtDateString(args.now ?? new Date())}`,
  ]);
  const result = await withBrainCache<EidPrepRead>({
    brainKey: BRAIN_KEYS.EID_PREP,
    fingerprint,
    force: opts.force,
    regen: () => generateEidPrepRegen(args),
  });
  if (result) return result.payload;
  return generateEidPrepRegen(args);
}

async function generateEidPrepRegen(args: {
  islamic: IslamicCalendarRow[];
  spends: Spend[];
  spendCategoryLinks: SpendCategoryLink[];
  plannedSpends: PlannedSpend[];
  now?: Date;
}): Promise<EidPrepRead> {
  const now = args.now ?? new Date();
  const windows = eidPrepWindows(args.islamic, args.plannedSpends, now);
  const cards: EidPrepCard[] = [];

  for (const w of windows) {
    const card = await buildEidPrepCard(w, args);
    cards.push(card);
  }

  return { windows: cards };
}

async function buildEidPrepCard(
  w: EidPrepWindow,
  args: { islamic: IslamicCalendarRow[]; spends: Spend[]; plannedSpends: PlannedSpend[]; now?: Date },
): Promise<EidPrepCard> {
  const label = w.kind === "eid_al_fitr" ? "Eid al-Fitr" : "Eid al-Adha";
  const lastYearDate = new Date(w.date.getFullYear() - 1, w.date.getMonth(), w.date.getDate());
  const lastYearStart = new Date(lastYearDate.getTime() - LAST_YEAR_WINDOW_DAYS * DAY_MS);
  const lastYearEnd = new Date(lastYearDate.getTime() + LAST_YEAR_WINDOW_DAYS * DAY_MS);
  const lastYearSpends = args.spends.filter((s) => {
    const d = new Date(s.spent_at);
    return d >= lastYearStart && d <= lastYearEnd;
  });
  const lastYearTotal = lastYearSpends.reduce((sum, s) => sum + Number(s.amount_base ?? 0), 0);
  const existingPlansBase = w.existingPlans.reduce(
    (sum, p) => sum + Number(p.committed_base ?? p.expected_base ?? 0),
    0,
  );
  // Suggested parking: last year's total minus what's already planned. Floor 0.
  const suggestedParking = Math.max(0, lastYearTotal - existingPlansBase);

  let narrative = fallbackEidNarrative(w, label, lastYearTotal, suggestedParking, lastYearSpends.length);
  let bigTicketReminders: string[] = fallbackReminders(lastYearSpends);
  let fromAi = false;

  if (hasGemini() && w.daysUntil <= EID_PREP_WINDOW_DAYS) {
    try {
      const snapshot = `eid=${w.kind} label="${label}" date=${phtDateString(w.date)} days_until=${w.daysUntil} hijri="${w.hijriLabel ?? ""}"\nlast_year_total_php=${lastYearTotal.toFixed(0)} last_year_spend_count=${lastYearSpends.length}\nexisting_plans_php=${existingPlansBase.toFixed(0)}\nsuggested_parking_php=${suggestedParking.toFixed(0)}\nlast_year_top_items=${topLastYearItems(lastYearSpends).join("; ")}`;
      const res = await gemini().models.generateContent({
        model: HEAVY_MODEL,
        contents: `Eid prep snapshot:\n${snapshot}\n\nReturn JSON.`,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          temperature: 0.5,
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
        },
      });
      const parsed = JSON.parse((res.text ?? "{}").trim()) as { narrative?: string; bigTicketReminders?: string[] };
      if (parsed.narrative?.trim()) {
        narrative = parsed.narrative.trim();
        fromAi = true;
      }
      if (parsed.bigTicketReminders?.length) {
        bigTicketReminders = parsed.bigTicketReminders.slice(0, 4);
      }
    } catch {
      // Keep deterministic.
    }
  }

  return {
    kind: w.kind,
    label,
    date: phtDateString(w.date),
    daysUntil: w.daysUntil,
    hijriLabel: w.hijriLabel,
    lastYearTotalBase: lastYearTotal,
    lastYearSpendCount: lastYearSpends.length,
    suggestedParkingBase: suggestedParking,
    existingPlansBase,
    bigTicketReminders,
    narrative,
    fromAi,
  };
}

function fallbackEidNarrative(
  w: EidPrepWindow,
  label: string,
  lastYearTotal: number,
  suggestedParking: number,
  lastYearCount: number,
): string {
  if (lastYearTotal === 0) {
    return `${label} lands in ${w.daysUntil} days (${phtDateString(w.date)}). No matching spending from last year to anchor on — opening signal.`;
  }
  return `${label} arrives in ${w.daysUntil} days. Last year you spent ${formatMoney(lastYearTotal, "PHP", { compact: true })} across ${lastYearCount} entries. Parking ${formatMoney(suggestedParking, "PHP", { compact: true })} in a holding wallet keeps the runway calm when the Eid week lands.`;
}

function fallbackReminders(_spends: Spend[]): string[] {
  return [];
}

function topLastYearItems(spends: Spend[]): string[] {
  return spends
    .filter((s) => s.description)
    .sort((a, b) => Number(b.amount_base ?? 0) - Number(a.amount_base ?? 0))
    .slice(0, 5)
    .map((s) => `${s.description}: ₱${Number(s.amount_base ?? 0).toFixed(0)}`);
}

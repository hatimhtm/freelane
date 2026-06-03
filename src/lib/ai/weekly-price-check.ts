import "server-only";

import { Type } from "@google/genai";
import { gemini, hasGemini, pickModel } from "./models";
import { scrubForbiddenPhrases } from "./voice-scrub";

// Pro brain — weekly vendor + item price-check sweep.
//
// Runs every Sunday morning (cron: weekly-price-check). For each user it
// digests the trailing 30 days of vendor_price_history into a single
// payload that lists every NOTEWORTHY change. Noteworthy floor (locked
// 2026-06-02 freelane-vendors-design):
//   |delta_pct| >= 0.10  AND  prior_4w_count >= 3
// Anything below either bar is omitted — single-observation drift or
// sub-10% moves aren't worth a Sunday-morning notification.
//
// external_context comes from the Pro model's training-data knowledge of
// typical PH prices. It is a ROUGH REFERENCE — the prompt frames it that
// way and the notification body repeats the disclaimer so the user does
// not treat the number as ground truth.

const CHANGE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    vendor_id: { type: Type.STRING },
    vendor_name: { type: Type.STRING },
    item_label: { type: Type.STRING },
    latest_amount: { type: Type.NUMBER },
    prior_4w_avg: { type: Type.NUMBER },
    // prior_4w_count is the gate the prompt mandates ("|delta_pct| >= 0.10
    // AND prior_4w_count >= 3"). Schema-side requirement so the model
    // cannot drop it; we validate the locked floor in runWeeklyPriceCheck
    // and drop the row if it's below 3.
    prior_4w_count: { type: Type.NUMBER },
    delta_pct: { type: Type.NUMBER },
    direction: { type: Type.STRING },
    internal_summary: { type: Type.STRING },
    external_context: { type: Type.STRING },
    noteworthy: { type: Type.BOOLEAN },
  },
  required: [
    "vendor_id",
    "vendor_name",
    "latest_amount",
    "prior_4w_avg",
    "prior_4w_count",
    "delta_pct",
    "direction",
    "noteworthy",
  ],
} as const;

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    changes: {
      type: Type.ARRAY,
      items: CHANGE_SCHEMA,
    },
  },
  required: ["changes"],
} as const;

const SYSTEM_PROMPT = `You analyze weekly vendor + item price observations for a Philippine freelancer's app.

Input is a JSON object of vendors + their last 30 days of price observations from finance.vendor_price_history. For each vendor + item_label pair you decide whether it deserves a quiet Sunday-morning notification.

NOTEWORTHY rule (you MUST evaluate every pair against this exact rule — do NOT relax it):
  - |delta_pct| >= 0.10 (absolute, latest vs prior 4-week avg) AND
  - prior_4w_count >= 3 observations (so the avg is stable)
If either bar fails, set noteworthy=false and EXCLUDE that pair from the output array entirely.

For noteworthy pairs, set:
  - latest_amount: the most recent observation's unit_amount
  - prior_4w_avg: mean unit_amount over the prior 4 weeks (excluding the latest)
  - delta_pct: (latest - prior_avg) / prior_avg
  - direction: "up" or "down" matching delta_pct sign
  - internal_summary: one sentence (≤ 120 chars) describing what changed using the user's OWN observations. Plain numbers, no marketing prose. Examples: "Jollibee burger meal jumped from ~₱180 to ₱205 over four visits." | "Mercury Drug paracetamol back down to ₱5 — promo running."
  - external_context: one sentence (≤ 120 chars) framing the move against typical PH prices from your training data. ALWAYS prefix with "Rough reference:" so the user knows it is not ground truth. Example: "Rough reference: ₱200 is normal for a Jollibee burger meal in 2026 — this is at the upper end."

HARD RULES:
- Output ONLY the JSON object {"changes": [...]}.
- NEVER fabricate a delta — only report pairs the math supports.
- NEVER write coaching prose ("you should", "consider", "I'd recommend").
- Skip pairs with prior_4w_count < 3.
- Cap output at 12 changes total — pick the most consequential by |delta_pct| × prior_4w_avg.
`;

const FORBIDDEN_LIST = [
  "you should",
  "i'd recommend",
  "i recommend",
  "consider switching",
  "consider buying",
  "consider trying",
];

function scrub(text: string | null | undefined, max = 120): string {
  if (!text) return "";
  let out = String(text).trim();
  for (const phrase of FORBIDDEN_LIST) {
    out = out.replace(new RegExp(phrase, "ig"), "");
  }
  out = scrubForbiddenPhrases(out).trim();
  return out.slice(0, max);
}

export type WeeklyPriceCheckObservation = {
  vendor_id: string;
  vendor_name: string;
  item_label: string | null;
  unit_amount: number;
  observed_at: string;
};

export type WeeklyPriceCheckInput = {
  observations: WeeklyPriceCheckObservation[];
};

export type WeeklyPriceCheckChange = {
  vendor_id: string;
  vendor_name: string;
  item_label: string | null;
  latest_amount: number;
  prior_4w_avg: number;
  prior_4w_count: number;
  delta_pct: number;
  direction: "up" | "down";
  internal_summary: string;
  external_context: string;
  noteworthy: boolean;
};

export type WeeklyPriceCheckResult = {
  changes: WeeklyPriceCheckChange[];
};

function emptyResult(): WeeklyPriceCheckResult {
  return { changes: [] };
}

// Brain that NEVER throws. The catalogue declares WEEKLY_PRICE_CHECK in
// BRAIN_KEYS / BRAIN_TTL so the FINANCIAL_INVALIDATION_EXEMPT list keeps
// per-user iteration parity, but the call site lives in a SERVICE-ROLE
// cron context (no auth.uid()) — so withBrainCache would not work here.
// Idempotency is ensured by the cron's once-a-week schedule + the
// notification dedup_key on the bundled vendor_price_check_weekly row.
export async function runWeeklyPriceCheck(
  _userId: string,
  input: WeeklyPriceCheckInput,
): Promise<WeeklyPriceCheckResult> {
  if (!hasGemini()) return emptyResult();
  const obs = input.observations ?? [];
  if (obs.length === 0) return emptyResult();

  try {
    const prompt = JSON.stringify({
      observations: obs.slice(0, 800),
    });
    const res = await gemini().models.generateContent({
      model: pickModel("heavy"),
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        temperature: 0.2,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
      },
    });
    const parsed = JSON.parse((res.text ?? "{}").trim()) as {
      changes?: Array<Partial<WeeklyPriceCheckChange>>;
    };
    const out: WeeklyPriceCheckChange[] = [];
    for (const ch of parsed.changes ?? []) {
      if (!ch.noteworthy) continue;
      const direction =
        ch.direction === "up" || ch.direction === "down"
          ? ch.direction
          : Number(ch.delta_pct ?? 0) >= 0
            ? "up"
            : "down";
      const delta = Number(ch.delta_pct ?? 0);
      if (!Number.isFinite(delta) || Math.abs(delta) < 0.1) continue;
      // Enforce the locked NOTEWORTHY rule in CODE, not prose. The brain
      // prompt mandates `prior_4w_count >= 3` but a model is free to drop
      // the constraint mid-generation; the rule belongs to the gate, not
      // the prompt.
      const priorCount = Math.max(0, Math.floor(Number(ch.prior_4w_count ?? 0)));
      if (priorCount < 3) continue;
      // Enforce the user-trust contract on external_context at the parse
      // boundary. The prompt mandates a "Rough reference:" prefix so the
      // user knows the line is a model-training-data estimate, not
      // ground truth — if the model dropped the prefix, re-add it so the
      // notification never presents an unhedged price claim as
      // authoritative.
      let externalContext = scrub(ch.external_context, 120);
      if (externalContext && !/^rough reference:/i.test(externalContext)) {
        externalContext = `Rough reference: ${externalContext}`.slice(0, 120);
      }
      out.push({
        vendor_id: String(ch.vendor_id ?? "").trim(),
        vendor_name: String(ch.vendor_name ?? "").trim(),
        item_label:
          ch.item_label && String(ch.item_label).trim().length > 0
            ? String(ch.item_label).trim()
            : null,
        latest_amount: Number(ch.latest_amount ?? 0),
        prior_4w_avg: Number(ch.prior_4w_avg ?? 0),
        prior_4w_count: priorCount,
        delta_pct: delta,
        direction: direction as "up" | "down",
        internal_summary: scrub(ch.internal_summary, 120),
        external_context: externalContext,
        noteworthy: true,
      });
    }
    // Sort by impact (|delta_pct| × prior_4w_avg) in CODE before the
    // top-12 slice. The prompt mandates the same ordering, but a model
    // is free to drop the constraint mid-generation — when it returns
    // 30 changes in random order, slicing first would keep the wrong
    // 12. Doing the rank in code is the user-trust belt.
    out.sort(
      (a, b) =>
        Math.abs(b.delta_pct) * b.prior_4w_avg -
        Math.abs(a.delta_pct) * a.prior_4w_avg,
    );
    return { changes: out.slice(0, 12) };
  } catch {
    return emptyResult();
  }
}

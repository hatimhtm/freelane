import "server-only";

import { Type } from "@google/genai";
import { gemini, hasGemini, pickModel } from "../models";
import { withBrainCache, fingerprintFromIds, scopedBrainKey } from "../cache";
import { BRAIN_KEYS } from "../cache-keys";
import { scrubForbiddenPhrases } from "../voice-scrub";

// Flash Lite brain — loan_proposal.
//
// Reads a recently-saved beneficiary spend (a spend with
// beneficiary_entity_id and a notes/description hint) and decides
// whether the user almost certainly LOANED money to the beneficiary
// rather than just spent on their behalf. Output drives the
// loan_proposal notification — the user accepts and a loan row gets
// created, or rejects and the spend is stamped non_loan to block
// re-proposals.
//
// Cache slot is per-spend (scopedBrainKey('spend', spendId)) +
// phtDayAnchored:true. The same spend re-fingerprinted on the same PHT
// day hits the cache; an edit to the spend regenerates fresh because
// the description/notes/amount are part of the fingerprint.
//
// HARD GUARDS:
//   - hasGemini() short-circuits to emptyResult() so the brain never
//     blocks save on missing creds.
//   - The dispatcher (src/lib/data/actions.ts inside createSpend) gates
//     on an AND of: beneficiary_entity_id present + amountBase >= 500 +
//     hasLoanishKeyword(description + notes). Earlier drafts of this
//     header described an OR gate (keyword OR beneficiary + amount);
//     that was the design intent but the shipped dispatcher is strict
//     AND for cost control. The brain trusts those inputs and stays
//     cheap; the result confidence threshold (>0.6) is the dispatcher's
//     tiebreak signal, intentionally a notch below the prompt's
//     "strong" 0.7 bar so the brain's marginal 0.6-0.7 hits still
//     surface a center modal asking the user.
//   - spends.non_loan acts as the reject memory beyond the inbox's 3-day
//     retention window: a "no, not a loan" answer stamps the spend so a
//     future re-save can't ask again.

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    is_loan_likely: { type: Type.BOOLEAN },
    suggested_direction: { type: Type.STRING },
    confidence: { type: Type.NUMBER },
    reasoning: { type: Type.STRING },
  },
  required: ["is_loan_likely", "confidence"],
} as const;

const SYSTEM_PROMPT = `You decide whether a freelancer's beneficiary spend is more likely a LOAN to that person than a regular spend on their behalf.

The user is a freelance dev in the Philippines. Filipino + Taglish keywords for loans:
- "pautang" / "uutang" / "utang" / "hiram" / "hihiram" — the money is being borrowed FROM the user.
- "lend" / "borrow" / "loan" — same.
- "balato" — a treat / one-off gift, NOT a loan (return is_loan_likely=false when the strongest cue is balato).

You see:
- description: ≤ 140 chars, the user's literal words on the spend.
- notes: ≤ 400 chars, additional context.
- amount_base: PHP amount.
- beneficiary_entity: name + relationship of the recipient.

Output JSON ONLY:
- is_loan_likely: true ONLY when the language strongly implies money owed back.
- suggested_direction: "given" (default — the user lent money to the beneficiary). "received" is rare here because beneficiary spends flow OUT, not in; use it only when the language explicitly says the beneficiary is paying back something already owed.
- confidence ∈ [0, 1]. 0.7+ when a keyword hit + amount > ₱500. 0.4-0.7 when only one signal. <0.4 means you're guessing.
- reasoning: ≤ 80 chars, plain user-facing line — what cue tipped you. No marketing prose.

HARD RULES:
- "balato" / "treat" / "gift" / "regalo" → is_loan_likely=false.
- "kahit anong oras lang" / "babayaran" / "I'll pay you back" → is_loan_likely=true.
- NEVER write coaching language ("great", "amazing", "I'd love to help").
`;

const FORBIDDEN_LIST = [
  "great question",
  "i'd love to help",
  "of course",
  "absolutely",
  "let me explain",
  "i understand",
  "i totally get",
];

function scrub(text: string | null | undefined, max = 80): string {
  if (!text) return "";
  let out = String(text).trim();
  for (const phrase of FORBIDDEN_LIST) {
    out = out.replace(new RegExp(phrase, "ig"), "");
  }
  out = scrubForbiddenPhrases(out).trim();
  return out.slice(0, max);
}

export type LoanProposalInput = {
  spendId: string;
  spendDescription: string | null;
  spendNotes: string | null;
  amountBase: number;
  beneficiaryEntityId: string;
  beneficiaryName: string;
  beneficiaryRelationship: string | null;
};

export type LoanProposalResult = {
  is_loan_likely: boolean;
  suggested_direction: "given" | "received";
  confidence: number;
  reasoning: string;
};

function emptyResult(): LoanProposalResult {
  return {
    is_loan_likely: false,
    suggested_direction: "given",
    confidence: 0,
    reasoning: "",
  };
}

// Cheap PH-keyword check used by the dispatcher to decide whether to
// even pay for the brain. Exported so the trigger site can keyword-gate
// before the (potentially) expensive Gemini call.
const POSITIVE_KEYWORDS = [
  "pautang",
  "uutang",
  "utang",
  "hiram",
  "hihiram",
  "lend",
  "borrow",
  "loan",
  "babayaran",
  "pay you back",
  "ibabalik",
];
const NEGATIVE_KEYWORDS = ["balato", "treat", "regalo", "gift"];

export function hasLoanishKeyword(text: string | null | undefined): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  if (NEGATIVE_KEYWORDS.some((k) => lower.includes(k))) return false;
  return POSITIVE_KEYWORDS.some((k) => lower.includes(k));
}

export async function proposeLoanFromSpend(
  input: LoanProposalInput,
): Promise<LoanProposalResult> {
  if (!hasGemini()) return emptyResult();
  if (!input.spendId) return emptyResult();
  if (!input.beneficiaryEntityId) return emptyResult();

  const fp = await fingerprintFromIds([
    "loan_proposal",
    input.spendId,
    String(Math.round(Number(input.amountBase ?? 0))),
    (input.spendDescription ?? "").toLowerCase(),
    (input.spendNotes ?? "").toLowerCase().slice(0, 200),
  ]);

  const cached = await withBrainCache<LoanProposalResult>({
    brainKey: scopedBrainKey(BRAIN_KEYS.LOAN_PROPOSAL, "spend", input.spendId),
    fingerprint: fp,
    phtDayAnchored: true,
    regen: async () => {
      try {
        const prompt = JSON.stringify({
          description: (input.spendDescription ?? "").slice(0, 140),
          notes: (input.spendNotes ?? "").slice(0, 400),
          amount_base: Math.round(Number(input.amountBase ?? 0)),
          beneficiary_entity: {
            name: input.beneficiaryName.slice(0, 40),
            relationship: input.beneficiaryRelationship ?? null,
          },
        });
        const res = await gemini().models.generateContent({
          model: pickModel("fast"),
          contents: prompt,
          config: {
            systemInstruction: SYSTEM_PROMPT,
            temperature: 0.2,
            responseMimeType: "application/json",
            responseSchema: RESPONSE_SCHEMA,
          },
        });
        const parsed = JSON.parse((res.text ?? "{}").trim()) as Partial<{
          is_loan_likely: boolean;
          suggested_direction: string;
          confidence: number;
          reasoning: string;
        }>;
        const dir =
          parsed.suggested_direction === "received" ? "received" : "given";
        const confidence = Math.max(0, Math.min(1, Number(parsed.confidence ?? 0)));
        return {
          is_loan_likely: !!parsed.is_loan_likely,
          suggested_direction: dir,
          confidence,
          reasoning: scrub(parsed.reasoning, 80),
        };
      } catch {
        return emptyResult();
      }
    },
  });

  return cached?.payload ?? emptyResult();
}

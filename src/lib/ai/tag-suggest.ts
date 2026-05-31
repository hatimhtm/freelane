import { Type } from "@google/genai";
import { pickModel, gemini, hasGemini } from "./models";
import type {
  PaymentMethod,
  Spend,
  SpendCategory,
  SpendCategoryLink,
} from "@/lib/supabase/types";

const STOPWORDS = new Set<string>([
  "the",
  "a",
  "an",
  "of",
  "and",
  "to",
  "for",
  "in",
  "on",
  "at",
  "with",
  "from",
  "by",
  "is",
  "it",
  "this",
  "that",
  "ng",
  "sa",
  "para",
  "ang",
  "mga",
  "ko",
  "mo",
  "na",
  "po",
  "yung",
  "ay",
]);

const MIN_TOKEN_LEN = 2;
const TOP_N = 3;
const COLD_VOCAB_MIN_TOKENS = 3;

export interface SuggestedTag {
  categoryId: string;
  confidence: number;
  source: "markov" | "ai" | "wallet_bias";
}

export interface TagSuggestHistory {
  spends: Spend[];
  links: SpendCategoryLink[];
  categories: SpendCategory[];
  methods: PaymentMethod[];
}

export function tokenize(description: string | null | undefined): string[] {
  if (!description) return [];
  return description
    .toLowerCase()
    .split(/[\s\p{P}\p{S}]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length >= MIN_TOKEN_LEN && !STOPWORDS.has(t) && !/^\d+$/.test(t));
}

// token → categoryId → co-occurrence count, mined from past spend descriptions
// joined to their tags. The Markov-lite scorer just sums these per-token.
export function buildTokenCategoryFrequency(
  spends: Spend[],
  links: SpendCategoryLink[],
): Map<string, Map<string, number>> {
  const linksBySpendId = new Map<string, string[]>();
  for (const l of links) {
    const arr = linksBySpendId.get(l.spend_id) ?? [];
    arr.push(l.category_id);
    linksBySpendId.set(l.spend_id, arr);
  }

  const table = new Map<string, Map<string, number>>();
  for (const s of spends) {
    const cats = linksBySpendId.get(s.id);
    if (!cats || cats.length === 0) continue;
    const tokens = tokenize(s.description);
    if (tokens.length === 0) continue;
    const uniqueTokens = new Set(tokens);
    for (const tok of uniqueTokens) {
      let perCat = table.get(tok);
      if (!perCat) {
        perCat = new Map<string, number>();
        table.set(tok, perCat);
      }
      for (const cid of cats) {
        perCat.set(cid, (perCat.get(cid) ?? 0) + 1);
      }
    }
  }
  return table;
}

// Per-wallet prior: which categories does this wallet historically hit? Used
// as a soft bias on top of the token signal (Cash → cigarettes/fast food,
// Bank → rent), without overriding strong description matches.
export function buildWalletBias(
  spends: Spend[],
  links: SpendCategoryLink[],
): Map<string, Map<string, number>> {
  const linksBySpendId = new Map<string, string[]>();
  for (const l of links) {
    const arr = linksBySpendId.get(l.spend_id) ?? [];
    arr.push(l.category_id);
    linksBySpendId.set(l.spend_id, arr);
  }

  const counts = new Map<string, Map<string, number>>();
  for (const s of spends) {
    if (!s.wallet_id) continue;
    const cats = linksBySpendId.get(s.id);
    if (!cats || cats.length === 0) continue;
    let perWallet = counts.get(s.wallet_id);
    if (!perWallet) {
      perWallet = new Map<string, number>();
      counts.set(s.wallet_id, perWallet);
    }
    for (const cid of cats) {
      perWallet.set(cid, (perWallet.get(cid) ?? 0) + 1);
    }
  }

  const normalized = new Map<string, Map<string, number>>();
  for (const [walletId, perCat] of counts) {
    let total = 0;
    for (const v of perCat.values()) total += v;
    if (total === 0) continue;
    const share = new Map<string, number>();
    for (const [cid, n] of perCat) share.set(cid, n / total);
    normalized.set(walletId, share);
  }
  return normalized;
}

export function suggestTagsLocal(
  description: string,
  walletId: string | null,
  categories: SpendCategory[],
  freqTable: Map<string, Map<string, number>>,
  walletBiasMap?: Map<string, Map<string, number>>,
): SuggestedTag[] {
  const tokens = tokenize(description);
  if (tokens.length === 0) return [];

  const allowed = new Set(categories.filter((c) => !c.archived).map((c) => c.id));
  if (allowed.size === 0) return [];

  const scores = new Map<string, number>();
  let totalHits = 0;
  for (const tok of tokens) {
    const perCat = freqTable.get(tok);
    if (!perCat) continue;
    for (const [cid, n] of perCat) {
      if (!allowed.has(cid)) continue;
      scores.set(cid, (scores.get(cid) ?? 0) + n);
      totalHits += n;
    }
  }

  if (totalHits === 0) return [];

  // Normalize Markov score to [0, 1] within this scoring pass.
  const maxScore = Math.max(...scores.values());

  const bias = walletId ? walletBiasMap?.get(walletId) : undefined;
  const combined = new Map<string, { score: number; source: SuggestedTag["source"] }>();
  for (const [cid, raw] of scores) {
    const markov = maxScore > 0 ? raw / maxScore : 0;
    const wb = bias?.get(cid) ?? 0;
    // Wallet bias is a soft additive nudge — caps at ~+0.25 so a strong
    // description always beats a generic wallet prior.
    const score = markov + Math.min(0.25, wb * 0.5);
    const source: SuggestedTag["source"] =
      markov === 0 && wb > 0 ? "wallet_bias" : "markov";
    combined.set(cid, { score, source });
  }

  const ranked = [...combined.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, TOP_N)
    .map(([categoryId, { score, source }]) => ({
      categoryId,
      confidence: Math.min(1, score),
      source,
    }));

  return ranked;
}

const AI_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    suggestions: {
      type: Type.ARRAY,
      maxItems: TOP_N,
      items: {
        type: Type.OBJECT,
        properties: {
          category_id: { type: Type.STRING },
          confidence: { type: Type.NUMBER },
        },
        required: ["category_id", "confidence"],
        propertyOrdering: ["category_id", "confidence"],
      },
    },
  },
  required: ["suggestions"],
  propertyOrdering: ["suggestions"],
};

const AI_SYSTEM_PROMPT = `You tag a single spend description with up to 3 categories from a fixed list. Return the category IDs verbatim — do not invent new ones. Confidence is 0..1, reflect real uncertainty. If nothing fits, return an empty array. No prose.`;

export async function suggestTagsAi(
  description: string,
  walletName: string | null,
  allCategories: SpendCategory[],
): Promise<SuggestedTag[]> {
  if (!hasGemini()) return [];
  const active = allCategories.filter((c) => !c.archived);
  if (active.length === 0) return [];

  const allowed = new Set(active.map((c) => c.id));
  const list = active.map((c) => `- ${c.id}: ${c.name}`).join("\n");
  const walletLine = walletName ? `\nWallet: ${walletName}` : "";
  const contents = `Categories (id: name):\n${list}\n\nDescription: ${description}${walletLine}\n\nReturn JSON.`;

  try {
    const res = await gemini().models.generateContent({
      model: pickModel("fast"),
      contents,
      config: {
        systemInstruction: AI_SYSTEM_PROMPT,
        temperature: 0.2,
        responseMimeType: "application/json",
        responseSchema: AI_RESPONSE_SCHEMA,
      },
    });
    const parsed = JSON.parse((res.text ?? "{}").trim()) as {
      suggestions?: Array<{ category_id?: string; confidence?: number }>;
    };
    const out: SuggestedTag[] = [];
    for (const s of parsed.suggestions ?? []) {
      if (!s.category_id || !allowed.has(s.category_id)) continue;
      const conf = Math.max(0, Math.min(1, Number(s.confidence ?? 0)));
      out.push({ categoryId: s.category_id, confidence: conf, source: "ai" });
      if (out.length >= TOP_N) break;
    }
    return out;
  } catch {
    return [];
  }
}

export async function suggestTagsForDescription(
  description: string,
  walletId: string | null,
  history: TagSuggestHistory,
): Promise<SuggestedTag[]> {
  const tokens = tokenize(description);
  if (tokens.length === 0) return [];

  const freqTable = buildTokenCategoryFrequency(history.spends, history.links);
  const walletBias = buildWalletBias(history.spends, history.links);

  const local = suggestTagsLocal(
    description,
    walletId,
    history.categories,
    freqTable,
    walletBias,
  );

  let merged: SuggestedTag[] = local;

  if (local.length === 0 && tokens.length >= COLD_VOCAB_MIN_TOKENS) {
    const walletName = walletId
      ? history.methods.find((m) => m.id === walletId)?.name ?? null
      : null;
    const ai = await suggestTagsAi(description, walletName, history.categories);
    merged = ai;
  }

  const seen = new Set<string>();
  const deduped: SuggestedTag[] = [];
  for (const s of merged) {
    if (seen.has(s.categoryId)) continue;
    seen.add(s.categoryId);
    deduped.push(s);
    if (deduped.length >= TOP_N) break;
  }
  return deduped;
}

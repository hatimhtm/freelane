import type {
  Spend,
  SpendCategory,
  SpendCategoryKind,
  SpendCategoryLink,
} from "@/lib/supabase/types";

// A single spend's kind is the strongest tag it carries:
//   any investment tag  → investment
//   else any consumption tag → consumption
//   else                → neutral
//
// Hatim's mental model: a laptop tagged Tech + Investment + Wife counts as
// investment (the most ambitious classification wins). This keeps the
// Investment vs Consumption Ledger honest — every multi-tagged ambitious
// spend lands on the investment side.
export function kindForSpend(
  spend: Pick<Spend, "id">,
  links: SpendCategoryLink[],
  categories: SpendCategory[],
): SpendCategoryKind {
  const catIds = new Set(
    links.filter((l) => l.spend_id === spend.id).map((l) => l.category_id),
  );
  const tags = categories.filter((c) => catIds.has(c.id));
  if (tags.length === 0) return "consumption";  // untagged defaults to consumption
  if (tags.some((c) => c.kind === "investment")) return "investment";
  if (tags.some((c) => c.kind === "consumption")) return "consumption";
  return "neutral";
}

export interface InvestmentConsumptionSplit {
  consumption: number;
  investment: number;
  neutral: number;
  // Percent of the discretionary spend that went to investment. Excludes
  // neutral (loan repayments, sadaka, forgotten, other) so the ratio reads
  // as "of what I chose, what fraction earns back?".
  investmentShare: number;
  // The longer the user's investment share stays above this floor in a given
  // window, the more confidently the Calm Weather brain narrates "you're
  // putting money to work."
  healthy: boolean;
}

const HEALTHY_INVESTMENT_SHARE = 0.12;  // 12% — calibration value

export function investmentConsumptionSplit(
  spends: Spend[],
  links: SpendCategoryLink[],
  categories: SpendCategory[],
): InvestmentConsumptionSplit {
  let consumption = 0;
  let investment = 0;
  let neutral = 0;
  for (const sp of spends) {
    const kind = kindForSpend(sp, links, categories);
    const amount = Number(sp.amount_base ?? 0);
    if (kind === "investment") investment += amount;
    else if (kind === "consumption") consumption += amount;
    else neutral += amount;
  }
  const discretionary = consumption + investment;
  const investmentShare = discretionary > 0 ? investment / discretionary : 0;
  return {
    consumption,
    investment,
    neutral,
    investmentShare,
    healthy: investmentShare >= HEALTHY_INVESTMENT_SHARE,
  };
}

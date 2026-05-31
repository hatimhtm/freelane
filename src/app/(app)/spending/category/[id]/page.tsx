import { notFound } from "next/navigation";
import { getSpendingData } from "@/lib/data/queries";
import { generateSpendingAnomalies } from "@/lib/ai/spending-anomalies";
import { BASE_CURRENCY_FALLBACK } from "@/lib/constants";
import { spendsByCategory } from "@/lib/spends";
import type { CurrencyCode, Spend } from "@/lib/supabase/types";
import { CategoryDetail, type CategorySpendRow } from "./_components/category-detail";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { spendCategories } = await getSpendingData();
  const cat = spendCategories.find((c) => c.id === id);
  return { title: cat ? `Spending · ${cat.name}` : "Category" };
}

export default async function SpendingCategoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const {
    spends,
    spendCategories,
    spendCategoryLinks,
    methods,
    settings,
  } = await getSpendingData();

  const category = spendCategories.find((c) => c.id === id);
  if (!category) notFound();

  const baseCurrency = (settings?.base_currency ?? BASE_CURRENCY_FALLBACK) as CurrencyCode;

  // category_id → spend_ids[] — the canonical inverse from lib/spends.
  const spendIdsByCat = spendsByCategory(spendCategoryLinks);
  const mineIds = new Set(spendIdsByCat.get(id) ?? []);
  const mineSpends: Spend[] = spends.filter((s) => mineIds.has(s.id));

  // This-month + trailing-6mo windows for the anomaly call. Anomalies need
  // the broader baseline, so we slice the full filtered list here on the
  // server (one HEAVY call max).
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const trailingStart = new Date(now.getFullYear(), now.getMonth() - 6, 1);
  const spendsThisMonth = mineSpends.filter(
    (s) => new Date(s.spent_at) >= startOfMonth,
  );
  const spendsTrailing6mo = mineSpends.filter((s) => {
    const d = new Date(s.spent_at);
    return d >= trailingStart && d < startOfMonth;
  });

  // Restrict category context to just this one — surfaces noise like
  // "spike vs typical" within the category itself.
  const anomalies = await generateSpendingAnomalies({
    spendsThisMonth,
    spendsTrailing6mo,
    categories: [category],
    categoryLinks: spendCategoryLinks.filter((l) => l.category_id === id),
  });

  const walletNameById = new Map(methods.map((m) => [m.id, m.name]));
  const rows: CategorySpendRow[] = mineSpends.map((s) => ({
    id: s.id,
    spentAt: s.spent_at,
    amount: Number(s.amount),
    currency: s.currency as CurrencyCode,
    amountBase: Number(s.amount_base ?? 0),
    description: s.description ?? null,
    walletId: s.wallet_id,
    walletName: walletNameById.get(s.wallet_id) ?? "Untagged",
    businessRelevant: !!s.business_relevant,
  }));

  return (
    <CategoryDetail
      category={category}
      rows={rows}
      spends={mineSpends}
      baseCurrency={baseCurrency}
      anomalies={anomalies}
    />
  );
}

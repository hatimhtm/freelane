import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getSpendingData } from "@/lib/data/queries";
import {
  extractVendorToken,
  vendorSlug,
} from "@/lib/spending/vendor-extract";
import { BASE_CURRENCY_FALLBACK } from "@/lib/constants";
import type { CurrencyCode, Spend } from "@/lib/supabase/types";
import { VendorDetail, type VendorSpendRow } from "./_components/vendor-detail";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { spends } = await getSpendingData();
  const match = matchVendor(spends, slug);
  return { title: match ? `Spending / ${match.vendor}` : "Vendor" };
}

export default async function VendorDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const {
    spends,
    spendCategories,
    spendCategoryLinks,
    methods,
    settings,
  } = await getSpendingData();
  const baseCurrency = (settings?.base_currency ?? BASE_CURRENCY_FALLBACK) as CurrencyCode;

  const match = matchVendor(spends, slug);
  if (!match || match.spends.length === 0) notFound();

  const walletNameById = new Map(methods.map((m) => [m.id, m.name]));
  const categoryNameById = new Map(spendCategories.map((c) => [c.id, c.name]));

  const tagsBySpend = new Map<string, string[]>();
  for (const link of spendCategoryLinks) {
    const arr = tagsBySpend.get(link.spend_id) ?? [];
    arr.push(link.category_id);
    tagsBySpend.set(link.spend_id, arr);
  }

  const mine = match.spends;
  // Newest first to match the global spend list ordering.
  mine.sort((a, b) => (a.spent_at < b.spent_at ? 1 : -1));

  const rows: VendorSpendRow[] = mine.map((s) => ({
    id: s.id,
    spentAt: s.spent_at,
    amount: Number(s.amount),
    currency: s.currency as CurrencyCode,
    amountBase: Number(s.amount_base ?? 0),
    description: s.description ?? null,
    walletName: walletNameById.get(s.wallet_id) ?? "Untagged",
    categoryNames: (tagsBySpend.get(s.id) ?? [])
      .map((id) => categoryNameById.get(id))
      .filter((n): n is string => !!n),
    businessRelevant: !!s.business_relevant,
  }));

  // Lifetime stats: visits, total, avg / biggest ticket, first + last visit.
  let total = 0;
  let biggestTicket = 0;
  let firstSeenAt = mine[0].spent_at;
  let lastSeenAt = mine[0].spent_at;
  for (const s of mine) {
    const amt = Number(s.amount_base ?? 0);
    total += amt;
    if (amt > biggestTicket) biggestTicket = amt;
    if (s.spent_at < firstSeenAt) firstSeenAt = s.spent_at;
    if (s.spent_at > lastSeenAt) lastSeenAt = s.spent_at;
  }
  const visits = mine.length;
  const avgTicket = visits > 0 ? total / visits : 0;

  // Last-12-months trend anchored on most recent spend; index 11 = anchor month.
  const monthly = buildMonthlyTrend(mine, lastSeenAt);

  // Top 3 categories user tags this vendor with, by share of base spend.
  // Multi-tag rows split evenly across their tags so totals stay honest.
  const catTally = new Map<string, number>();
  let taggedBase = 0;
  for (const s of mine) {
    const ids = tagsBySpend.get(s.id) ?? [];
    if (ids.length === 0) continue;
    const share = Number(s.amount_base ?? 0) / ids.length;
    for (const id of ids) {
      catTally.set(id, (catTally.get(id) ?? 0) + share);
      taggedBase += share;
    }
  }
  const topCategories = Array.from(catTally.entries())
    .map(([id, value]) => ({
      id,
      name: categoryNameById.get(id) ?? "Untagged",
      value,
      pct: taggedBase > 0 ? (value / taggedBase) * 100 : 0,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 3);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <Link
        href="/spending"
        className="inline-flex items-center gap-1 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" /> Spending
      </Link>
      <VendorDetail
        vendor={match.vendor}
        confidence={match.confidence}
        baseCurrency={baseCurrency}
        rows={rows}
        visits={visits}
        total={total}
        avgTicket={avgTicket}
        biggestTicket={biggestTicket}
        firstSeenAt={firstSeenAt}
        lastSeenAt={lastSeenAt}
        monthly={monthly}
        topCategories={topCategories}
      />
    </div>
  );
}

interface VendorMatch {
  vendor: string;
  confidence: "known" | "guessed";
  spends: Spend[];
}

function matchVendor(spends: Spend[], slug: string): VendorMatch | null {
  let vendor: string | null = null;
  let confidence: "known" | "guessed" | null = null;
  const mine: Spend[] = [];
  for (const s of spends) {
    const m = extractVendorToken(s.description ?? "");
    if (!m.vendor) continue;
    if (vendorSlug(m.vendor) !== slug) continue;
    mine.push(s);
    if (vendor === null) {
      vendor = m.vendor;
      confidence = m.confidence;
    } else if (confidence === "guessed" && m.confidence === "known") {
      // Prefer known-confidence label if any spend resolves it.
      confidence = "known";
    }
  }
  if (!vendor || !confidence) return null;
  return { vendor, confidence, spends: mine };
}

const MONTHLY_WINDOW = 12;

function buildMonthlyTrend(
  spends: Spend[],
  anchorIso: string,
): { month: string; total: number }[] {
  const anchor = new Date(anchorIso);
  const anchorY = anchor.getUTCFullYear();
  const anchorM = anchor.getUTCMonth();
  const buckets = new Array<number>(MONTHLY_WINDOW).fill(0);
  for (const s of spends) {
    const d = new Date(s.spent_at);
    const diff =
      (anchorY - d.getUTCFullYear()) * 12 + (anchorM - d.getUTCMonth());
    if (diff >= 0 && diff < MONTHLY_WINDOW) {
      buckets[MONTHLY_WINDOW - 1 - diff] += Number(s.amount_base ?? 0);
    }
  }
  return buckets.map((total, i) => {
    const monthsBack = MONTHLY_WINDOW - 1 - i;
    const d = new Date(Date.UTC(anchorY, anchorM - monthsBack, 1));
    const label = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
    return { month: label, total };
  });
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getEntityDetail } from "@/lib/data/queries";
import { BASE_CURRENCY_FALLBACK } from "@/lib/constants";
import { formatMoney } from "@/lib/money";
import type { CurrencyCode } from "@/lib/supabase/types";

export const metadata = { title: "Entity" };

export default async function EntityDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { entity, links, spends, settings } = await getEntityDetail(id);
  if (!entity) notFound();
  const baseCurrency = (settings?.base_currency ?? BASE_CURRENCY_FALLBACK) as CurrencyCode;
  const myLinkIds = new Set(links.map((l) => l.spend_id));
  const mySpends = spends.filter((s) => myLinkIds.has(s.id)).sort((a, b) => b.spent_at.localeCompare(a.spent_at));
  const total = mySpends.reduce((sum, s) => sum + Number(s.amount_base ?? 0), 0);

  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-5 p-4 sm:p-6">
      <Link
        href="/entities"
        className="inline-flex items-baseline gap-1 self-start text-[11px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" />
        Entities
      </Link>

      <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-border/40 pb-3">
        <div>
          <h1 className="font-display text-xl leading-tight">{entity.canonical_name}</h1>
          <p className="text-xs text-muted-foreground">
            {entity.kind}
            {entity.vague && " · vague"}
            {entity.short_description && ` · ${entity.short_description}`}
          </p>
        </div>
        <div className="text-right">
          <div className="font-display tabular text-base">
            {formatMoney(total, baseCurrency, { compact: true })}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            lifetime · {mySpends.length} spends
          </div>
        </div>
      </header>

      {entity.aliases && entity.aliases.length > 0 && (
        <section className="flex flex-wrap items-baseline gap-1.5">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Aliases</span>
          {entity.aliases.map((a, i) => (
            <span
              key={i}
              className="rounded-full border border-border/70 bg-muted/30 px-2 py-0.5 text-[11px] text-foreground/80"
            >
              {a}
            </span>
          ))}
        </section>
      )}

      {entity.memory_consolidated && Object.keys(entity.memory_consolidated).length > 0 && (
        <section className="rounded-[12px] border border-border/40 bg-card/30 p-3.5">
          <h2 className="font-display text-sm font-medium">What the AI knows</h2>
          {entity.memory_consolidated.summary && (
            <p className="mt-2 text-[13px] leading-snug text-foreground">{String(entity.memory_consolidated.summary)}</p>
          )}
          {entity.memory_consolidated.facts && Array.isArray(entity.memory_consolidated.facts) && entity.memory_consolidated.facts.length > 0 && (
            <ul className="mt-2 ml-4 list-disc text-[12px] text-foreground/80 marker:text-muted-foreground">
              {(entity.memory_consolidated.facts as string[]).map((f, i) => <li key={i}>{f}</li>)}
            </ul>
          )}
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="font-display text-sm font-medium">Recent spends</h2>
        {mySpends.length === 0 && (
          <p className="text-xs text-muted-foreground">No linked spends yet.</p>
        )}
        <ul className="flex flex-col divide-y divide-border/40 rounded-[10px] border border-border/50 bg-card/30">
          {mySpends.slice(0, 30).map((sp) => (
            <li key={sp.id} className="grid grid-cols-[1fr_auto] items-baseline gap-3 px-3 py-2 text-[12px]">
              <div className="min-w-0">
                <div className="truncate">{sp.description ?? "—"}</div>
                <div className="text-[10px] text-muted-foreground">{sp.spent_at}</div>
              </div>
              <div className="font-display tabular">
                {formatMoney(Number(sp.amount_base ?? 0), baseCurrency, { compact: true })}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {entity.notes && (
        <section className="rounded-[12px] border border-border/40 bg-muted/20 p-3 text-[12px] leading-relaxed text-foreground/80">
          {entity.notes}
        </section>
      )}
    </div>
  );
}

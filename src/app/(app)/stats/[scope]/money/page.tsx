import { PageHeader } from "@/components/app/page-header";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { formatMoney } from "@/lib/money";
import { BASE_CURRENCY_FALLBACK } from "@/lib/constants";
import type { CurrencyCode } from "@/lib/supabase/types";

export const metadata = { title: "Stats · Money" };

// Placeholder for the Stats workflow. The dynamic [scope] segment will
// later resolve to a real entity (me, client-<id>, year-<n>) and feed
// per-scope money stats into this surface.
//
// Entities workflow (2026-06-03) — adds the first concrete card:
// "Amount spent FOR others". Aggregates spends where
// is_for_someone_else=true grouped by beneficiary_entity_id. Falls back
// to an empty state when no beneficiary spends exist yet.
export default async function StatsMoneyPage({
  params,
}: {
  params: Promise<{ scope: string }>;
}) {
  const { scope } = await params;
  const user = await getAuthUser();
  const supabase = await createClient();
  // Recent Letters lives in the dedicated Letters subtab (single home,
  // per spec). The Money landing no longer duplicates the card.

  // Verifier fix: the dynamic [scope] segment was being shown in the
  // header while the underlying query was user-wide. Until per-scope
  // semantics ship, gate the per-entity card behind scope === 'me' so
  // 'client-xyz' / 'year-2025' never silently mis-attributes user-wide
  // beneficiary spends to a narrower scope. The card now also carries
  // the entity_id through the aggregate tuple so the React key never
  // collides on duplicate names or zero amounts.
  const scopeIsMe = scope === "me";

  let totalForOthersBase = 0;
  let perEntity: Array<{
    entityId: string;
    name: string;
    amount: number;
    count: number;
  }> = [];
  let baseCurrency: CurrencyCode = BASE_CURRENCY_FALLBACK as CurrencyCode;
  if (user) {
    const settingsRes = await supabase
      .from("settings")
      .select("base_currency")
      .eq("user_id", user.id)
      .maybeSingle();
    baseCurrency =
      ((settingsRes.data?.base_currency as string | null) ??
        BASE_CURRENCY_FALLBACK) as CurrencyCode;

    if (scopeIsMe) {
      const [spendsRes, entitiesRes] = await Promise.all([
        supabase
          .from("spends")
          .select("amount_base, beneficiary_entity_id, is_for_someone_else")
          .eq("user_id", user.id)
          .eq("is_for_someone_else", true),
        supabase
          .from("entities")
          .select("id, canonical_name")
          .eq("user_id", user.id),
      ]);
      const nameById = new Map(
        (entitiesRes.data ?? []).map((e) => [
          e.id as string,
          (e.canonical_name as string | null) ?? "Unknown",
        ]),
      );
      const agg = new Map<string, { amount: number; count: number }>();
      for (const s of spendsRes.data ?? []) {
        const eid =
          (s as { beneficiary_entity_id: string | null })
            .beneficiary_entity_id ?? "__untagged__";
        const amt = Number(
          (s as { amount_base: number | null }).amount_base ?? 0,
        );
        const prev = agg.get(eid) ?? { amount: 0, count: 0 };
        agg.set(eid, { amount: prev.amount + amt, count: prev.count + 1 });
        totalForOthersBase += amt;
      }
      perEntity = Array.from(agg.entries())
        .map(([eid, v]) => ({
          entityId: eid,
          name:
            eid === "__untagged__"
              ? "Unidentified beneficiary"
              : nameById.get(eid) ?? "Unknown",
          amount: v.amount,
          count: v.count,
        }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 8);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6 py-8 lg:px-10 lg:py-12">
      <PageHeader title="Money stats" description={`Scope: ${scope}`} />

      {scopeIsMe ? (
        <section className="mt-8 rounded-[14px] border border-foreground/10 bg-card/40 p-5">
          <div className="display-eyebrow text-muted-foreground">
            Spent for others
          </div>
          <p className="mt-2 text-[24px] tabular font-display leading-none">
            {formatMoney(totalForOthersBase, baseCurrency, { compact: true })}
          </p>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Across {perEntity.length} {perEntity.length === 1 ? "person" : "people"}.
          </p>
          {perEntity.length > 0 && (
            <ul className="mt-4 divide-y divide-foreground/10">
              {perEntity.map((p) => (
                <li
                  key={p.entityId}
                  className="grid grid-cols-[1fr_auto] gap-3 py-2 text-[13px]"
                >
                  <span className="truncate text-foreground/85">{p.name}</span>
                  <span className="tabular text-foreground/85">
                    {formatMoney(p.amount, baseCurrency, { compact: true })}{" "}
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      · {p.count}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {perEntity.length === 0 && (
            <p className="mt-3 text-[12px] text-muted-foreground">
              Nothing tagged "for someone else" yet. Flip the toggle on a spend to
              see this fill in.
            </p>
          )}
        </section>
      ) : (
        <section className="mt-8 rounded-[14px] border border-foreground/10 bg-card/40 p-5">
          <div className="display-eyebrow text-muted-foreground">
            Spent for others
          </div>
          <p className="mt-2 text-[12px] text-muted-foreground">
            Per-scope beneficiary stats aren't wired yet for scope "{scope}".
            Switch to the "me" scope to see the breakdown of who you've been
            sending money to.
          </p>
        </section>
      )}

      <div className="mt-6 rounded-[14px] border border-foreground/10 bg-card/40 p-5">
        <div className="display-eyebrow text-muted-foreground">Money</div>
        <p className="mt-2 text-[13px] text-foreground/85">
          Stats workflow ships next.
        </p>
        <p className="mt-1.5 text-[12px] text-muted-foreground">
          Per-scope income, fee, and spending stats will fill in here.
        </p>
      </div>
    </div>
  );
}

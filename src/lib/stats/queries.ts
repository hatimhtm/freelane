import "server-only";

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { phtDateString } from "@/lib/utils";

// ─────────────────────────── Stats workflow query helpers ──
//
// Single home for the scope-aware fetchers the /stats/[scope]/* surfaces
// call. Every helper accepts a resolved scope range (fromIso .. toIso),
// reads from existing tables (no migrations), and returns null/empty
// when the scope is empty — that signal drives the per-widget relevance
// gating (Apple-widget sparse grid; widget hidden when there's nothing
// to show).
//
// PHT discipline — bucketing helpers (heatmap, vendor frequency, life
// events) pass timestamps through phtDateString() before bucketing so
// midnight-rollover rows don't slide into the wrong day. Mixing UTC and
// PHT here would silently misplace data on day boundaries.

export type ResolvedScopeRange = {
  // ISO 8601 lower bound (inclusive) for event_at / spent_at filters.
  // Null = "no lower bound" (lifetime / all).
  fromIso: string | null;
  // ISO 8601 upper bound (inclusive) — null = "until now".
  toIso: string | null;
  // PHT-anchored start date string ("YYYY-MM-DD") for date-only columns.
  fromPht: string | null;
  toPht: string | null;
  // Human label for the scope header ("Last 30 days", "Lifetime", "2026").
  label: string;
  // Original scope token (preserved for AI dot card.key + chip URLs).
  token: string;
  // Quick predicate — true when the resolver returned an unbounded range.
  unbounded: boolean;
  // True when the scope token didn't match any documented grammar and the
  // resolver fell back to Lifetime. Surfaces let users (and notFound()
  // guards) tell a typo from "lifetime".
  isFallback: boolean;
};

// Resolve a /stats/[scope] segment into a date window.
//
// Grammar (extends parseLettersScope):
//   - "lifetime" / "all" / "me" → unbounded range
//   - "30d", "90d", "6m", "1y"  → trailing-N window ending now
//   - bare year "2026"          → PHT calendar year
//   - "year-2026"               → same, legacy alias
//   - "client-<id>"             → unbounded user scope (per-client filter
//                                  applied inside the widget query when
//                                  the data carries client_id)
//
// Verifier fix (low): unknown tokens used to silently degrade to a
// Lifetime read, so /stats/garbage rendered as if it were /stats/lifetime
// — confusing because the label said "Lifetime" but the URL didn't.
// We now keep the scope token in the label (e.g. "Lifetime (unknown
// scope: garbage)") so the surface is honest about the fallback. A
// dedicated banner would be richer but this preserves the no-crash
// guarantee without lying about the data shown.
export function resolveScopeRange(scope: string): ResolvedScopeRange {
  const now = new Date();
  const nowIso = now.toISOString();

  function windowed(days: number, label: string): ResolvedScopeRange {
    const from = new Date(now.getTime() - days * 86_400_000);
    return {
      fromIso: from.toISOString(),
      toIso: nowIso,
      fromPht: phtDateString(from),
      toPht: phtDateString(now),
      label,
      token: scope,
      unbounded: false,
      isFallback: false,
    };
  }

  function lifetime(label: string, isFallback = false): ResolvedScopeRange {
    return {
      fromIso: null,
      toIso: null,
      fromPht: null,
      toPht: null,
      label,
      token: scope,
      unbounded: true,
      isFallback,
    };
  }

  if (!scope || scope === "lifetime" || scope === "all" || scope === "me") {
    return lifetime("Lifetime");
  }
  if (scope === "30d") return windowed(30, "Last 30 days");
  if (scope === "90d") return windowed(90, "Last 90 days");
  if (scope === "6m") return windowed(182, "Last 6 months");
  if (scope === "1y") return windowed(365, "Last 12 months");

  const yearMatch = scope.match(/^(?:year-)?(\d{4})$/);
  if (yearMatch) {
    const year = Number(yearMatch[1]);
    // PHT-anchored calendar year. Use the explicit +08:00 offset so the
    // server (UTC) and the user (PHT) agree on which timestamps fall
    // inside this scope.
    const fromIso = `${year}-01-01T00:00:00+08:00`;
    const toIso = `${year}-12-31T23:59:59+08:00`;
    return {
      fromIso,
      toIso,
      fromPht: `${year}-01-01`,
      toPht: `${year}-12-31`,
      label: String(year),
      token: scope,
      unbounded: false,
      isFallback: false,
    };
  }

  if (scope.startsWith("client-")) {
    // Client scope is unbounded in time; the data layer applies the
    // client filter where the schema carries it (per-widget basis).
    return { ...lifetime("Lifetime · scoped"), token: scope, unbounded: true };
  }

  // Unknown — keep the surface alive but signal the fallback in the
  // label so users know they're looking at Lifetime data, not the scope
  // they typed. The isFallback flag lets the layout decide whether to
  // notFound() (verifier suggestion); we keep the lifetime data as a
  // safe baseline either way.
  return lifetime(`Lifetime (unknown scope: ${scope})`, true);
}

// PostgREST helper: apply scope's time bounds to a `event_at` column.
function applyEventAtBounds<T extends { gte: (col: string, v: string) => T; lte: (col: string, v: string) => T }>(
  query: T,
  range: ResolvedScopeRange,
  column: string,
): T {
  let q = query;
  if (range.fromIso) q = q.gte(column, range.fromIso);
  if (range.toIso) q = q.lte(column, range.toIso);
  return q;
}

// ─────────────────────────── Money section ──

// Monthly buckets of income vs outflow over the resolved scope. Returns
// null when there's no money_ledger activity in the window. Used by
// SpendVsIncomeTrendWidget on the Money page.
//
// Verifier fix (low): for unbounded (lifetime) scopes we cap the read at
// the last 24 months. The trend widget is a recency narrative; an
// unbounded read on a multi-year archive scales linearly with the
// money_ledger row count and the trailing-2y window covers every useful
// surface (year scopes are still bounded by `applyEventAtBounds`).
export const getSpendVsIncomeTrend = cache(
  async (range: ResolvedScopeRange): Promise<{
    buckets: Array<{ phtMonth: string; income: number; outflow: number }>;
    totalIncome: number;
    totalOutflow: number;
  } | null> => {
    const [supabase, user] = await Promise.all([createClient(), getAuthUser()]);
    if (!user) return null;
    let q = supabase
      .from("money_ledger")
      .select("event_at,amount_base,kind")
      .eq("user_id", user.id)
      .is("archived_at", null);
    if (range.unbounded) {
      // Cap unbounded reads to the trailing 24 months.
      const trailingFromIso = new Date(
        Date.now() - 730 * 86_400_000,
      ).toISOString();
      q = q.gte("event_at", trailingFromIso);
    } else {
      q = applyEventAtBounds(q, range, "event_at");
    }
    const { data } = await q;
    const rows = (data ?? []) as Array<{ event_at: string; amount_base: number; kind: string }>;
    if (rows.length === 0) return null;
    const map = new Map<string, { income: number; outflow: number }>();
    let totalIncome = 0;
    let totalOutflow = 0;
    for (const r of rows) {
      const phtDay = phtDateString(new Date(r.event_at));
      const phtMonth = phtDay.slice(0, 7);
      const bucket = map.get(phtMonth) ?? { income: 0, outflow: 0 };
      const amt = Number(r.amount_base ?? 0);
      if (amt >= 0) {
        bucket.income += amt;
        totalIncome += amt;
      } else {
        const abs = -amt;
        bucket.outflow += abs;
        totalOutflow += abs;
      }
      map.set(phtMonth, bucket);
    }
    const buckets = Array.from(map.entries())
      .map(([phtMonth, v]) => ({ phtMonth, ...v }))
      .sort((a, b) => a.phtMonth.localeCompare(b.phtMonth));
    return { buckets, totalIncome, totalOutflow };
  },
);

// Top vendors by base-spend within scope. Reads spends + spend_vendor_links
// + vendors so the widget can name-and-amount the leaderboard.
export const getTopVendors = cache(
  async (
    range: ResolvedScopeRange,
    limit = 5,
  ): Promise<Array<{ vendorId: string; name: string; amount: number; count: number }> | null> => {
    const [supabase, user] = await Promise.all([createClient(), getAuthUser()]);
    if (!user) return null;
    let q = supabase
      .from("spends")
      .select("id,amount_base,spent_at")
      .eq("user_id", user.id);
    q = applyEventAtBounds(q, range, "spent_at");
    const { data: spends } = await q;
    const rows = (spends ?? []) as Array<{ id: string; amount_base: number; spent_at: string }>;
    if (rows.length === 0) return null;
    const ids = rows.map((s) => s.id);
    const { data: links } = await supabase
      .from("spend_vendor_links")
      .select("spend_id,vendor_id")
      .in("spend_id", ids);
    const linkRows = (links ?? []) as Array<{ spend_id: string; vendor_id: string }>;
    if (linkRows.length === 0) return null;
    const vendorIds = Array.from(new Set(linkRows.map((l) => l.vendor_id)));
    // Drop archived vendors from the leaderboard entirely — the amount
    // tied to them shouldn't surface under an archived name. Spends
    // linked to archived vendors collapse out of the ranking; the link
    // is preserved in the spends table for history but the leaderboard
    // is a "live" view (mirrors the Vendors subview's archived filter).
    const { data: vendors } = await supabase
      .from("vendors")
      .select("id,canonical_name,archived")
      .in("id", vendorIds);
    const liveVendorIds = new Set(
      ((vendors ?? []) as Array<{ id: string; archived: boolean | null }>)
        .filter((v) => !v.archived)
        .map((v) => v.id),
    );
    const nameById = new Map(
      ((vendors ?? []) as Array<{ id: string; canonical_name: string | null; archived: boolean | null }>)
        .filter((v) => !v.archived)
        .map((v) => [v.id, v.canonical_name ?? "Unnamed vendor"]),
    );
    const amountBySpend = new Map(rows.map((r) => [r.id, Number(r.amount_base ?? 0)]));
    const agg = new Map<string, { amount: number; count: number }>();
    for (const link of linkRows) {
      if (!liveVendorIds.has(link.vendor_id)) continue; // skip archived
      const amt = amountBySpend.get(link.spend_id) ?? 0;
      const prev = agg.get(link.vendor_id) ?? { amount: 0, count: 0 };
      agg.set(link.vendor_id, { amount: prev.amount + amt, count: prev.count + 1 });
    }
    const ranked = Array.from(agg.entries())
      .map(([vendorId, v]) => ({
        vendorId,
        name: nameById.get(vendorId) ?? "Unnamed vendor",
        amount: v.amount,
        count: v.count,
      }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, limit);
    if (ranked.length === 0) return null;
    return ranked;
  },
);

// Top categories — same shape as vendors but joining spend_category_links.
export const getTopCategories = cache(
  async (
    range: ResolvedScopeRange,
    limit = 5,
  ): Promise<Array<{ categoryId: string; name: string; amount: number; count: number }> | null> => {
    const [supabase, user] = await Promise.all([createClient(), getAuthUser()]);
    if (!user) return null;
    let q = supabase
      .from("spends")
      .select("id,amount_base,spent_at")
      .eq("user_id", user.id);
    q = applyEventAtBounds(q, range, "spent_at");
    const { data: spends } = await q;
    const rows = (spends ?? []) as Array<{ id: string; amount_base: number; spent_at: string }>;
    if (rows.length === 0) return null;
    const ids = rows.map((s) => s.id);
    const { data: links } = await supabase
      .from("spend_category_links")
      .select("spend_id,category_id")
      .in("spend_id", ids);
    const linkRows = (links ?? []) as Array<{ spend_id: string; category_id: string }>;
    if (linkRows.length === 0) return null;
    const catIds = Array.from(new Set(linkRows.map((l) => l.category_id)));
    // Skip archived categories from the leaderboard (mirror Vendors).
    const { data: cats } = await supabase
      .from("spend_categories")
      .select("id,name,archived")
      .in("id", catIds);
    const liveCatIds = new Set(
      ((cats ?? []) as Array<{ id: string; archived: boolean | null }>)
        .filter((c) => !c.archived)
        .map((c) => c.id),
    );
    const nameById = new Map(
      ((cats ?? []) as Array<{ id: string; name: string | null; archived: boolean | null }>)
        .filter((c) => !c.archived)
        .map((c) => [c.id, c.name ?? "Untitled"]),
    );
    const amountBySpend = new Map(rows.map((r) => [r.id, Number(r.amount_base ?? 0)]));
    const agg = new Map<string, { amount: number; count: number }>();
    for (const link of linkRows) {
      if (!liveCatIds.has(link.category_id)) continue;
      const amt = amountBySpend.get(link.spend_id) ?? 0;
      const prev = agg.get(link.category_id) ?? { amount: 0, count: 0 };
      agg.set(link.category_id, { amount: prev.amount + amt, count: prev.count + 1 });
    }
    const ranked = Array.from(agg.entries())
      .map(([categoryId, v]) => ({
        categoryId,
        name: nameById.get(categoryId) ?? "Untitled",
        amount: v.amount,
        count: v.count,
      }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, limit);
    if (ranked.length === 0) return null;
    return ranked;
  },
);

// Savings rate = (income - outflow) / income. Reuses the spend-vs-income
// aggregator output; returns null when income is zero in scope (rate is
// undefined).
export const getSavingsRate = cache(
  async (range: ResolvedScopeRange): Promise<{
    rate: number;
    income: number;
    outflow: number;
    saved: number;
  } | null> => {
    const trend = await getSpendVsIncomeTrend(range);
    if (!trend || trend.totalIncome <= 0) return null;
    const saved = trend.totalIncome - trend.totalOutflow;
    return {
      rate: saved / trend.totalIncome,
      income: trend.totalIncome,
      outflow: trend.totalOutflow,
      saved,
    };
  },
);

// Runway = balance / daily burn (avg outflow per day in scope). Returns
// null when scope is unbounded (no clean daily-burn denominator) or when
// outflow is zero (infinite runway is not a useful number).
//
// Verifier fix (high): only render runway when the scope window ends at
// "now" — otherwise the ratio mixes a present-instant balance with a
// historical daily burn ("today's cash / 2025's burn"), a semantically
// muddled number. We gate via range.toPht == today (PHT-aware).
//
// Verifier fix (high): drop the is_holding filter when summing the
// balance. Spending wallets also hold real money; restricting the sum
// to holding wallets under-states the true cash position and reports
// runway days that are artificially low.
export const getRunway = cache(
  async (range: ResolvedScopeRange): Promise<{
    days: number;
    balance: number;
    dailyBurn: number;
  } | null> => {
    const [supabase, user] = await Promise.all([createClient(), getAuthUser()]);
    if (!user) return null;
    if (range.unbounded) return null;
    // Restrict to windows that end at "now" (PHT today). On a 2025 year
    // scope or any past-year window, the balance-as-of-now / past-burn
    // ratio is meaningless — hide the widget instead of misleading.
    const todayPht = phtDateString(new Date());
    if (range.toPht && range.toPht < todayPht) return null;
    // Daily burn from the scope's outflow side.
    let q = supabase
      .from("money_ledger")
      .select("amount_base")
      .eq("user_id", user.id)
      .is("archived_at", null)
      .lt("amount_base", 0);
    q = applyEventAtBounds(q, range, "event_at");
    const { data: outflowRows } = await q;
    let outflow = 0;
    for (const r of (outflowRows ?? []) as Array<{ amount_base: number }>) {
      outflow += -Number(r.amount_base ?? 0);
    }
    if (outflow <= 0 || !range.fromIso || !range.toIso) return null;
    const dayCount = Math.max(
      1,
      Math.round((new Date(range.toIso).getTime() - new Date(range.fromIso).getTime()) / 86_400_000),
    );
    const dailyBurn = outflow / dayCount;
    // Current balance = opening balance of every live wallet (holding +
    // spending) + the sum of every live ledger delta. Mirrors the
    // wallet-balance helper used by Payments so the two surfaces don't
    // diverge.
    const { data: methodsRes } = await supabase
      .from("payment_methods")
      .select("id,opening_balance_base")
      .eq("user_id", user.id)
      .eq("archived", false);
    const methods = (methodsRes ?? []) as Array<{ id: string; opening_balance_base: number | null }>;
    if (methods.length === 0) return null;
    const { data: balRows } = await supabase
      .from("money_ledger")
      .select("amount_base")
      .eq("user_id", user.id)
      .is("archived_at", null)
      .in("wallet_id", methods.map((m) => m.id));
    let balance = 0;
    for (const m of methods) balance += Number(m.opening_balance_base ?? 0);
    for (const r of (balRows ?? []) as Array<{ amount_base: number }>) {
      balance += Number(r.amount_base ?? 0);
    }
    if (dailyBurn <= 0) return null;
    return { days: balance / dailyBurn, balance, dailyBurn };
  },
);

// Biggest single spends within scope. Useful for the "what blew the
// budget" narrative; we show top 5 with description + vendor name if
// the link exists.
export const getBiggestSpends = cache(
  async (
    range: ResolvedScopeRange,
    limit = 5,
  ): Promise<Array<{
    id: string;
    amount: number;
    description: string | null;
    spentAt: string;
  }> | null> => {
    const [supabase, user] = await Promise.all([createClient(), getAuthUser()]);
    if (!user) return null;
    let q = supabase
      .from("spends")
      .select("id,amount_base,description,spent_at")
      .eq("user_id", user.id)
      .order("amount_base", { ascending: false })
      .limit(limit);
    q = applyEventAtBounds(q, range, "spent_at");
    const { data } = await q;
    const rows = (data ?? []) as Array<{ id: string; amount_base: number; description: string | null; spent_at: string }>;
    if (rows.length === 0) return null;
    return rows.map((r) => ({
      id: r.id,
      amount: Number(r.amount_base ?? 0),
      description: r.description,
      spentAt: r.spent_at,
    }));
  },
);

// Verifier fix (medium): getCycleProgress is REMOVED from /stats. The
// data this widget surfaces (current PHT month MTD vs prev-month-same-pct)
// is scope-agnostic — on /stats/2026 it would still show June MTD, not
// "2026 YTD". This is a redundant duplicate of the Dashboard cycle
// widget; the Dashboard is the right home for "right now" rhythm
// signals, /stats is for historical scope reads.
//
// Removed:
//   - getCycleProgress(range)
// Callers (StatsMoneyPage) no longer fetch / render CycleProgressWidget.

// ─────────────────────────── Behavior section ──

// Trailing-1y heat-map style day-counter. Returns a map of PHT date
// (YYYY-MM-DD) → spend count within scope. Heat-map widget renders a
// 7-row grid (Sunday..Saturday) across N columns of weeks.
export const getSpendFrequencyHeatmap = cache(
  async (range: ResolvedScopeRange): Promise<{
    countsByDay: Record<string, number>;
    maxCount: number;
    days: string[];
  } | null> => {
    const [supabase, user] = await Promise.all([createClient(), getAuthUser()]);
    if (!user) return null;
    let q = supabase.from("spends").select("spent_at").eq("user_id", user.id);
    q = applyEventAtBounds(q, range, "spent_at");
    const { data } = await q;
    const rows = (data ?? []) as Array<{ spent_at: string }>;
    if (rows.length === 0) return null;
    const counts = new Map<string, number>();
    for (const r of rows) {
      const phtDay = phtDateString(new Date(r.spent_at));
      counts.set(phtDay, (counts.get(phtDay) ?? 0) + 1);
    }
    const countsByDay: Record<string, number> = {};
    let max = 0;
    for (const [day, c] of counts.entries()) {
      countsByDay[day] = c;
      if (c > max) max = c;
    }
    const days = Array.from(counts.keys()).sort();
    return { countsByDay, maxCount: max, days };
  },
);

// Avg visits / week to the top vendor in scope. Returns null when
// fewer than 4 weeks of data exist in scope (signal too noisy).
export const getVendorVisitFrequency = cache(
  async (range: ResolvedScopeRange): Promise<{
    vendorName: string;
    visits: number;
    weeks: number;
    visitsPerWeek: number;
  } | null> => {
    const top = await getTopVendors(range, 1);
    if (!top || top.length === 0) return null;
    const winner = top[0];
    if (!range.fromIso || !range.toIso) {
      // Lifetime: derive weeks from the user's first spend date.
      const [supabase, user] = await Promise.all([createClient(), getAuthUser()]);
      if (!user) return null;
      const { data } = await supabase
        .from("spends")
        .select("spent_at")
        .eq("user_id", user.id)
        .order("spent_at", { ascending: true })
        .limit(1);
      const first = (data ?? [])[0] as { spent_at: string } | undefined;
      if (!first) return null;
      const weeks = Math.max(
        1,
        Math.round((Date.now() - new Date(first.spent_at).getTime()) / (7 * 86_400_000)),
      );
      if (weeks < 4) return null;
      return {
        vendorName: winner.name,
        visits: winner.count,
        weeks,
        visitsPerWeek: winner.count / weeks,
      };
    }
    const weeks = Math.max(
      1,
      Math.round((new Date(range.toIso).getTime() - new Date(range.fromIso).getTime()) / (7 * 86_400_000)),
    );
    if (weeks < 4) return null;
    return {
      vendorName: winner.name,
      visits: winner.count,
      weeks,
      visitsPerWeek: winner.count / weeks,
    };
  },
);

// Daily Safe hit rate — % of days within scope where the user stayed
// under their morning safe-to-spend snapshot. Returns null when no
// snapshots exist in scope.
//
// Verifier fix (low): previously the spends fetch re-applied
// range.fromIso/toIso, which is wider than the snapshot-day set
// (snapshots may be sparser than the scope window) and wasted bandwidth.
// We now bound spends to [min..max] of snapshot days then filter the
// per-day totals to the explicit snapshot set so the rate denominator
// matches the snapshot-day set exactly.
export const getDailySafeHitRate = cache(
  async (range: ResolvedScopeRange): Promise<{
    hitDays: number;
    totalDays: number;
    rate: number;
  } | null> => {
    const [supabase, user] = await Promise.all([createClient(), getAuthUser()]);
    if (!user) return null;
    let q = supabase
      .from("daily_safe_snapshots")
      .select("pht_date,initial_safe_base")
      .eq("user_id", user.id);
    if (range.fromPht) q = q.gte("pht_date", range.fromPht);
    if (range.toPht) q = q.lte("pht_date", range.toPht);
    const { data } = await q;
    const snaps = (data ?? []) as Array<{ pht_date: string; initial_safe_base: number }>;
    if (snaps.length === 0) return null;
    const daySet = new Set(snaps.map((s) => s.pht_date));
    const sortedDays = Array.from(daySet).sort();
    const minDay = sortedDays[0]!;
    const maxDay = sortedDays[sortedDays.length - 1]!;
    // Tight bounds on the spends fetch: only days covered by snapshots.
    // PHT day boundaries via explicit +08:00.
    const { data: spendsRows } = await supabase
      .from("spends")
      .select("spent_at,amount_base")
      .eq("user_id", user.id)
      .gte("spent_at", `${minDay}T00:00:00+08:00`)
      .lte("spent_at", `${maxDay}T23:59:59+08:00`);
    const totalByDay = new Map<string, number>();
    for (const r of (spendsRows ?? []) as Array<{ spent_at: string; amount_base: number }>) {
      const day = phtDateString(new Date(r.spent_at));
      if (!daySet.has(day)) continue; // only attribute spend to snapshot days
      totalByDay.set(day, (totalByDay.get(day) ?? 0) + Number(r.amount_base ?? 0));
    }
    let hit = 0;
    for (const s of snaps) {
      const spent = totalByDay.get(s.pht_date) ?? 0;
      if (spent <= Number(s.initial_safe_base ?? 0)) hit += 1;
    }
    const total = snaps.length;
    if (total === 0) return null;
    return { hitDays: hit, totalDays: total, rate: hit / total };
  },
);

// Plan completion rate — % of planned_spends in scope that flipped from
// committed → done within scope. Returns null when no plans exist.
export const getPlanCompletionRate = cache(
  async (range: ResolvedScopeRange): Promise<{
    completed: number;
    total: number;
    rate: number;
  } | null> => {
    const [supabase, user] = await Promise.all([createClient(), getAuthUser()]);
    if (!user) return null;
    let q = supabase
      .from("planned_spends")
      .select("id,status,done_at,bought_at,created_at")
      .eq("user_id", user.id);
    if (range.fromIso) q = q.gte("created_at", range.fromIso);
    if (range.toIso) q = q.lte("created_at", range.toIso);
    const { data } = await q;
    const rows = (data ?? []) as Array<{
      id: string;
      status: string;
      done_at: string | null;
      bought_at: string | null;
      created_at: string;
    }>;
    if (rows.length === 0) return null;
    const completed = rows.filter(
      (r) => r.status === "done" || !!r.done_at || !!r.bought_at,
    ).length;
    return { completed, total: rows.length, rate: completed / rows.length };
  },
);

// ─────────────────────────── Journey section ──

// Recent letters timeline — pulls up to N letters in scope (oldest →
// newest) so the widget can render a chronological strip. Different
// surface from the dedicated /letters subtab's short-list.
export const getLettersTimeline = cache(
  async (
    range: ResolvedScopeRange,
    limit = 12,
  ): Promise<Array<{
    id: string;
    headline: string;
    generated_at: string;
    kind: string;
  }> | null> => {
    const [supabase, user] = await Promise.all([createClient(), getAuthUser()]);
    if (!user) return null;
    let q = supabase
      .from("letters")
      .select("id,headline,generated_at,kind")
      .eq("user_id", user.id)
      .order("generated_at", { ascending: true });
    q = applyEventAtBounds(q, range, "generated_at");
    q = q.limit(limit);
    const { data } = await q;
    const rows = (data ?? []) as Array<{ id: string; headline: string; generated_at: string; kind: string }>;
    if (rows.length === 0) return null;
    return rows;
  },
);

// Life events — Tier 3 life_shifts + milestones unioned. PHT-bucketed
// by occurred_at / achieved_at and returned chronologically.
export const getLifeEvents = cache(
  async (
    range: ResolvedScopeRange,
    limit = 10,
  ): Promise<Array<{
    id: string;
    kind: "milestone" | "life_shift";
    label: string;
    occurredAt: string;
  }> | null> => {
    const [supabase, user] = await Promise.all([createClient(), getAuthUser()]);
    if (!user) return null;
    let mq = supabase
      .from("milestones")
      .select("id,label,achieved_at,kind")
      .eq("user_id", user.id)
      .order("achieved_at", { ascending: false })
      .limit(limit);
    if (range.fromIso) mq = mq.gte("achieved_at", range.fromIso);
    if (range.toIso) mq = mq.lte("achieved_at", range.toIso);
    let lq = supabase
      .from("life_shifts")
      .select("id,label,occurred_at,kind")
      .eq("user_id", user.id)
      .order("occurred_at", { ascending: false })
      .limit(limit);
    if (range.fromIso) lq = lq.gte("occurred_at", range.fromIso);
    if (range.toIso) lq = lq.lte("occurred_at", range.toIso);
    const [ms, ls] = await Promise.all([mq, lq]);
    const milestones = ((ms.data ?? []) as Array<{ id: string; label: string; achieved_at: string }>).map(
      (m) => ({ id: m.id, kind: "milestone" as const, label: m.label, occurredAt: m.achieved_at }),
    );
    const lifeShifts = ((ls.data ?? []) as Array<{ id: string; label: string; occurred_at: string }>).map(
      (s) => ({ id: s.id, kind: "life_shift" as const, label: s.label, occurredAt: s.occurred_at }),
    );
    const merged = [...milestones, ...lifeShifts]
      .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
      .slice(0, limit);
    if (merged.length === 0) return null;
    return merged;
  },
);

// Big plans archive — finished / cancelled is_big_plan rows. Returns the
// most-recent decided plans so the archive widget can show user follow-
// through.
//
// Verifier fix (low): scope filtering moved from updated_at to
// COALESCE(bought_at, done_at) — a plan whose status was edited recently
// but actually decided years prior used to leak into a 30d window. The
// widget claims "finished/cancelled within scope"; we now honour that
// promise via the decision timestamp. updated_at is a last-resort sort
// when both decision columns are null.
export const getBigPlansArchive = cache(
  async (
    range: ResolvedScopeRange,
    limit = 6,
  ): Promise<Array<{
    id: string;
    label: string;
    status: string;
    decidedAt: string | null;
    actualBase: number | null;
    plannedBase: number;
  }> | null> => {
    const [supabase, user] = await Promise.all([createClient(), getAuthUser()]);
    if (!user) return null;
    // Fetch the eligible rows unbounded by scope; we'll filter on the
    // computed decision timestamp client-side because PostgREST can't
    // COALESCE across two columns in a single .gte/.lte chain.
    const { data } = await supabase
      .from("planned_spends")
      .select("id,label,status,bought_at,done_at,bought_actual_price,expected_base,updated_at,is_big_plan")
      .eq("user_id", user.id)
      .eq("is_big_plan", true)
      .in("status", ["done", "cancelled"])
      .order("bought_at", { ascending: false, nullsFirst: false })
      .order("done_at", { ascending: false, nullsFirst: false })
      .order("updated_at", { ascending: false });
    const rows = (data ?? []) as Array<{
      id: string;
      label: string;
      status: string;
      bought_at: string | null;
      done_at: string | null;
      bought_actual_price: number | null;
      expected_base: number;
      updated_at: string | null;
    }>;
    const fromMs = range.fromIso ? new Date(range.fromIso).getTime() : -Infinity;
    const toMs = range.toIso ? new Date(range.toIso).getTime() : Infinity;
    const decided = rows
      .map((r) => ({
        ...r,
        decidedAt: r.bought_at ?? r.done_at ?? r.updated_at ?? null,
      }))
      .filter((r) => {
        if (!r.decidedAt) return false;
        const t = new Date(r.decidedAt).getTime();
        return t >= fromMs && t <= toMs;
      })
      .slice(0, limit);
    if (decided.length === 0) return null;
    return decided.map((r) => ({
      id: r.id,
      label: r.label,
      status: r.status,
      decidedAt: r.decidedAt,
      actualBase: r.bought_actual_price,
      plannedBase: Number(r.expected_base ?? 0),
    }));
  },
);

// Satisfaction averages — across planned_spends with a rating in scope.
// Returns null when no rated plans exist (typical for new users).
export const getSatisfactionAverages = cache(
  async (range: ResolvedScopeRange): Promise<{
    averageRating: number;
    sampleSize: number;
  } | null> => {
    const [supabase, user] = await Promise.all([createClient(), getAuthUser()]);
    if (!user) return null;
    let q = supabase
      .from("planned_spends")
      .select("satisfaction_rating,updated_at,bought_at")
      .eq("user_id", user.id)
      .not("satisfaction_rating", "is", null);
    if (range.fromIso) q = q.gte("updated_at", range.fromIso);
    if (range.toIso) q = q.lte("updated_at", range.toIso);
    const { data } = await q;
    const rows = (data ?? []) as Array<{ satisfaction_rating: number | null }>;
    const rated = rows.filter((r) => typeof r.satisfaction_rating === "number") as Array<{
      satisfaction_rating: number;
    }>;
    if (rated.length === 0) return null;
    const total = rated.reduce((s, r) => s + r.satisfaction_rating, 0);
    return { averageRating: total / rated.length, sampleSize: rated.length };
  },
);

// Cigarette translator total — base spend on the Cigarettes category
// within scope, plus the family-wallet-day translation Hatim's been
// reading on Today.
export const getCigaretteTranslatorTotal = cache(
  async (range: ResolvedScopeRange): Promise<{
    totalBase: number;
    spendCount: number;
    familyWalletDays: number;
  } | null> => {
    const [supabase, user] = await Promise.all([createClient(), getAuthUser()]);
    if (!user) return null;
    // Resolve the Cigarettes category id by name (no enum). Match
    // case-insensitively so user-renamed variants still flow in.
    const { data: cats } = await supabase
      .from("spend_categories")
      .select("id,name")
      .eq("user_id", user.id);
    const catRows = (cats ?? []) as Array<{ id: string; name: string | null }>;
    const matches = catRows.filter((c) => /cigarette/i.test(c.name ?? ""));
    if (matches.length === 0) return null;
    const catIds = matches.map((c) => c.id);
    const { data: links } = await supabase
      .from("spend_category_links")
      .select("spend_id")
      .in("category_id", catIds);
    const linkRows = (links ?? []) as Array<{ spend_id: string }>;
    if (linkRows.length === 0) return null;
    const spendIds = Array.from(new Set(linkRows.map((l) => l.spend_id)));
    let q = supabase
      .from("spends")
      .select("amount_base,spent_at")
      .eq("user_id", user.id)
      .in("id", spendIds);
    q = applyEventAtBounds(q, range, "spent_at");
    const { data: spendsRows } = await q;
    const rows = (spendsRows ?? []) as Array<{ amount_base: number; spent_at: string }>;
    if (rows.length === 0) return null;
    let total = 0;
    for (const r of rows) total += Number(r.amount_base ?? 0);
    if (total <= 0) return null;
    // Use the family-wallet-daily rate from the translator (₱100/day).
    const familyWalletDays = total / 100;
    return { totalBase: total, spendCount: rows.length, familyWalletDays };
  },
);

// Spent for others — per-beneficiary aggregation of spends.is_for_someone_else
// within scope. Returns null when nothing is tagged. Replaces the inline
// fetch the Money page used to do (verifier-medium fix).
export const getSpentForOthers = cache(
  async (
    range: ResolvedScopeRange,
    limit = 8,
  ): Promise<{
    totalBase: number;
    perEntity: Array<{ entityId: string; name: string; amount: number; count: number }>;
  } | null> => {
    const [supabase, user] = await Promise.all([createClient(), getAuthUser()]);
    if (!user) return null;
    let q = supabase
      .from("spends")
      .select("amount_base, beneficiary_entity_id, is_for_someone_else, spent_at")
      .eq("user_id", user.id)
      .eq("is_for_someone_else", true);
    q = applyEventAtBounds(q, range, "spent_at");
    const [{ data: spendsData }, { data: entitiesData }] = await Promise.all([
      q,
      // Drop archived entities — surfacing them under "Spent for others"
      // is misleading (the entity is no longer active in the user's life).
      supabase
        .from("entities")
        .select("id, canonical_name, archived")
        .eq("user_id", user.id),
    ]);
    const spendRows = (spendsData ?? []) as Array<{
      amount_base: number | null;
      beneficiary_entity_id: string | null;
    }>;
    if (spendRows.length === 0) return null;
    const liveEntityRows = ((entitiesData ?? []) as Array<{
      id: string;
      canonical_name: string | null;
      archived: boolean | null;
    }>).filter((e) => !e.archived);
    const nameById = new Map(
      liveEntityRows.map((e) => [e.id, e.canonical_name ?? "Unknown"]),
    );
    let totalBase = 0;
    const agg = new Map<string, { amount: number; count: number }>();
    for (const s of spendRows) {
      const eid = s.beneficiary_entity_id ?? "__untagged__";
      const amt = Number(s.amount_base ?? 0);
      const prev = agg.get(eid) ?? { amount: 0, count: 0 };
      agg.set(eid, { amount: prev.amount + amt, count: prev.count + 1 });
      totalBase += amt;
    }
    if (totalBase <= 0) return null;
    const perEntity = Array.from(agg.entries())
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
      .slice(0, limit);
    if (perEntity.length === 0) return null;
    return { totalBase, perEntity };
  },
);

// Settings-level base currency for amount formatting. Single round-trip;
// cache() dedupes across widgets on the same page render.
export const getBaseCurrency = cache(async (): Promise<string> => {
  const [supabase, user] = await Promise.all([createClient(), getAuthUser()]);
  if (!user) return "PHP";
  const { data } = await supabase
    .from("settings")
    .select("base_currency")
    .eq("user_id", user.id)
    .maybeSingle();
  return ((data?.base_currency as string | null) ?? "PHP");
});

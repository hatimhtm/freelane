import "server-only";

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import {
  mapSpend,
  mapWithdrawal,
  mapSadaka,
  mapPlannedSpendLifecycle,
  mapNotification,
  mapChatMessage,
  mapLetter,
  mapLoan,
  mapLoanReturn,
  mapLoanForgival,
  mapAiFact,
  mapVendor,
  mapEntity,
  mapMorningLog,
  mapWellbeing,
  mapDiary,
  type ActivityRow,
} from "./sources";
import { categoryForSource, type ActivityCategory } from "./categories";
import { requireSourceMeta } from "./sources-registry";

export type { ActivityRow };

// Cursor trust boundary
// ─────────────────────
// `cursor` (ISO timestamp) + `cursorId` (`<table>:<uuid>`) are spliced
// directly into a PostgREST `.or(...)` filter string inside
// `loadSource` below. PostgREST does not parameterize `.or()` clauses,
// so a value with commas, parens, or `and(...)` would let a caller
// inject sibling filter clauses.
//
// The values are SERVER-EMITTED today (round-tripped from
// `nextCursor` on the prior response), so the in-process trust
// boundary is intact. The PAGE LAYER (`src/app/(app)/activity/page.tsx`
// where URL `?cursor=` lands) is responsible for validating the shape
// before forwarding here — see `parseFeedCursor` in that file.
//
// If you add another entry point (e.g. an `/api/activity` route) you
// MUST validate cursor + cursorId there too; this module does NOT
// re-validate, by design (it would be a layering violation to assume
// the request-shape).
export type ActivityFeedArgs = {
  userId: string;
  // Composite cursor. `cursor` is the ISO timestamp of the LAST row on the
  // prior page; `cursorId` is its composite `<table>:<uuid>` id. The pair
  // travels together — paginating with just `cursor` may silently drop
  // rows that share its timestamp. Round-trip both from `nextCursor` and
  // the next request will skip exactly the boundary row.
  cursor?: string | null;
  cursorId?: string | null;
  // Hard cap per page. The virtual feed pulls up to (limit * 2) rows per
  // source then merge-sorts to surface the newest `limit`.
  limit?: number;
  // Category multi-select. When unspecified, all categories are returned.
  categories?: ActivityCategory[] | null;
  // Optional single-source filter. When set, only the matching source
  // table is queried (server-side narrowing — the limit then applies to
  // matching rows instead of being burnt on 15 unrelated sources).
  source?: string | null;
  // PHT day key ("YYYY-MM-DD"). When set, only rows whose timestamp falls
  // on that PHT day are returned (jump-to-day from the calendar popover).
  day?: string | null;
  // Whether to include rows whose actor is "ai". Defaults to FALSE per
  // freelane-activity-design (the Show AI activity toggle is off by
  // default).
  includeAi?: boolean;
};

export type ActivityFeedResult = {
  rows: ActivityRow[];
  // When the merge step trims rows past `limit`, expose the timestamp +
  // composite id of the LAST returned row so the caller can re-request
  // the next page with cursor=lastTs, cursorId=lastId. `id` is the SAME
  // composite (`<table>:<uuid>`) the rows expose — the next request must
  // pass it back verbatim.
  nextCursor: { timestamp: string; id: string } | null;
  // True when at least one per-source query threw. Surfaces in dev /
  // diagnostics so the feed silently degrading isn't invisible. Errors
  // are also console.error-logged with the offending table name.
  partial: boolean;
};

// Per-source pull cap. Pulling more than the page limit per source lets
// the merge-sort have headroom when one source dominates the recent
// window (e.g. a spend-heavy afternoon).
function perSourceLimit(limit: number) {
  return Math.max(50, limit * 2);
}

// Strict ISO-8601 timestamp shape: YYYY-MM-DDThh:mm:ss(.fraction)?(Z|±hh:mm).
// Rejects anything with PostgREST-meaningful characters (commas, parens,
// quotes, `and(`) so the value can safely splice into `.or(...)`.
// Exported so the page layer can re-use the exact same gate.
const CURSOR_TIMESTAMP_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
// Composite source id shape: `<lowercase_snake_table>:<uuid>` plus an
// optional `:<lifecycle>` suffix (planned_spends lifecycle rows expose
// e.g. `planned_spends:<uuid>:bought`). UUIDs are matched loosely (8-4-4-
// 4-12 hex) — looser would risk admitting commas / parens.
const CURSOR_ID_RE =
  /^[a-z_][a-z0-9_]*:[0-9a-fA-F-]{32,36}(?::[a-z]+)?$/;

export function isValidActivityCursorTimestamp(v: string | null | undefined): v is string {
  return typeof v === "string" && CURSOR_TIMESTAMP_RE.test(v);
}

export function isValidActivityCursorId(v: string | null | undefined): v is string {
  return typeof v === "string" && CURSOR_ID_RE.test(v);
}

// Compare two ISO-8601 timestamps as Unix millis. Lexical comparison
// silently reorders rows whose timestamps differ in OFFSET (e.g. a
// source returning `+08:00` strings adjacent to another source's `Z`
// strings would mis-sort across that boundary). Cost is negligible at
// limit≈50.
function tsCmp(a: string, b: string): number {
  return new Date(a).getTime() - new Date(b).getTime();
}

// PHT day bounds for a "YYYY-MM-DD" key. The end is an EXCLUSIVE upper
// bound (next-day PHT midnight) so we don't hand-craft a 23:59:59.999
// boundary that misses sub-millisecond timestamps. Pair with `.lt()` —
// `.lte()` here would re-introduce the half-open ambiguity.
function phtDayBounds(day: string): { startISO: string; endExclusiveISO: string } {
  const startISO = `${day}T00:00:00+08:00`;
  // Add one PHT day via UTC arithmetic so DST never bites (PHT has none,
  // but the helper stays generic).
  const [y, m, d] = day.split("-").map(Number);
  const next = new Date(Date.UTC(y, (m ?? 1) - 1, (d ?? 1) + 1));
  const ny = next.getUTCFullYear();
  const nm = String(next.getUTCMonth() + 1).padStart(2, "0");
  const nd = String(next.getUTCDate()).padStart(2, "0");
  return {
    startISO,
    endExclusiveISO: `${ny}-${nm}-${nd}T00:00:00+08:00`,
  };
}

// Generic source-table loader. Each source registers a (table, timestamp
// column, select projection, mapper) tuple. The loader handles cursor +
// day filtering uniformly so adding a new source is one new tuple. The
// `categories` field is pulled from SOURCE_REGISTRY at buildSpecs time
// so a missing registration throws — not silently lands in "system".
type SourceSpec<R> = {
  table: string;
  // Column the source row stores its activity timestamp on. The cursor
  // + day filter both operate on this column AND the mapper MUST set
  // ActivityRow.timestamp from the same column — drift between these
  // makes merge-sort + cursor pagination silently incoherent.
  timestampColumn: string;
  // Comma-separated select projection — keep it tight to limit payload.
  // Must include `timestampColumn` so the mapper has the value it claims
  // to read.
  select: string;
  // Maps a raw row to an ActivityRow.
  map: (row: R) => ActivityRow | ActivityRow[];
  // Which category bucket this source lands in (resolved from the
  // registry by buildSpecs — see requireSourceMeta). Used to skip the
  // per-source query entirely when the caller's category filter
  // excludes it. Some sources span buckets (sadaka_ledger) — both
  // categories appear here and overlap is checked with `.some(...)`.
  categories: ActivityCategory[];
  // True when the mapper ALWAYS emits actor="ai". Used to skip the
  // query when `includeAi=false`.
  aiOnly?: boolean;
};

async function loadSource<R>(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  spec: SourceSpec<R>,
  args: ActivityFeedArgs,
  limit: number,
): Promise<ActivityRow[]> {
  let query = supabase
    .from(spec.table)
    .select(spec.select)
    .eq("user_id", userId)
    .order(spec.timestampColumn, { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);

  if (args.cursor) {
    // Defense in depth: re-validate cursor + cursorId at the splice
    // point even though the page layer also validates. PostgREST does
    // not parameterize `.or(...)` so an invalid value here would either
    // 400 or (worse) inject sibling filter clauses. Drop silently —
    // the caller already round-trips server-emitted cursors, so a fail
    // here means tampered URL, not a real boundary.
    if (!isValidActivityCursorTimestamp(args.cursor)) {
      // Skip cursor application entirely. The page-1 result is the
      // safe fallback and the user simply re-lands at the top.
    } else if (args.cursorId) {
      if (!isValidActivityCursorId(args.cursorId)) {
        // Cursor timestamp valid but id is malformed — fall back to
        // timestamp-only paging. Rows on the boundary tick may
        // duplicate vs. the prior page, but the result is still safe.
        query = query.lt(spec.timestampColumn, args.cursor);
      } else {
        // Composite cursor pushed into the query — include rows whose
        // timestamp equals the cursor but whose id sorts strictly
        // before the cursor id. The post-merge filter then becomes
        // redundant safety, not the only line of defense.
        query = query.or(
          `${spec.timestampColumn}.lt.${args.cursor},and(${spec.timestampColumn}.eq.${args.cursor},id.lt.${args.cursorId})`,
        );
      }
    } else {
      query = query.lt(spec.timestampColumn, args.cursor);
    }
  }
  if (args.day) {
    const { startISO, endExclusiveISO } = phtDayBounds(args.day);
    query = query
      .gte(spec.timestampColumn, startISO)
      .lt(spec.timestampColumn, endExclusiveISO);
  }

  const { data, error } = await query;
  if (error || !data) {
    if (error) {
      // Surface schema drift / RLS denial so a silently-empty source
      // isn't invisible. Caller marks `partial=true` on the page result.
      console.error(
        `[activity] source query failed table=${spec.table}: ${error.message}`,
      );
      throw error;
    }
    return [];
  }
  const rows = data as unknown as R[];
  const out: ActivityRow[] = [];
  for (const r of rows) {
    const mapped = spec.map(r);
    if (Array.isArray(mapped)) {
      for (const m of mapped) out.push(m);
    } else {
      out.push(mapped);
    }
  }
  return out;
}

// Per-source spec table — adding a new source is a new tuple. Stays
// in-file so the registration list is the single point of audit when the
// schema grows.
//
// `categories` is NOT declared inline anymore — it's pulled from
// SOURCE_REGISTRY via requireSourceMeta so the two lists can never
// drift. Adding a source without registering it throws at startup.
type RawSpec<R> = Omit<SourceSpec<R>, "categories">;

function withRegistryCategories<R>(spec: RawSpec<R>): SourceSpec<R> {
  const meta = requireSourceMeta(spec.table);
  return { ...spec, categories: meta.categories };
}

function buildSpecs(): SourceSpec<Record<string, unknown>>[] {
  const raw: RawSpec<Record<string, unknown>>[] = [
    {
      table: "spends",
      timestampColumn: "spent_at",
      // Join the canonical vendor so the row summary can name the
      // vendor properly. spend_vendor_links.canonical_name short-cuts
      // the resolver — failing back to description when the link is
      // missing.
      select:
        "id,spent_at,amount_base,description,spend_vendor_links(vendors(canonical_name))",
      map: (r) =>
        mapSpend({
          id: r.id as string,
          spent_at: r.spent_at as string,
          amount_base: Number(r.amount_base ?? 0),
          description: (r.description as string | null) ?? null,
          vendor_name: extractVendorName(r),
        }),
    },
    {
      table: "withdrawals",
      timestampColumn: "withdrawn_at",
      // Keep the join projection lean — wallet names are looked up
      // post-query against `methods` already loaded by the feed page's
      // upstream context where available. Activity feed runs without
      // that context, so leave the from/to_method_name fields blank and
      // let the mapper fall back to the generic phrasing. This avoids
      // brittle PostgREST FK-name hints that diverge between dev/prod.
      select:
        "id,withdrawn_at,gross_base,net_base,from_method_id,to_method_id,notes",
      map: (r) =>
        mapWithdrawal({
          id: r.id as string,
          withdrawn_at: r.withdrawn_at as string,
          gross_base: Number(r.gross_base ?? 0),
          net_base: Number(r.net_base ?? 0),
          from_method_id: (r.from_method_id as string | null) ?? null,
          to_method_id: (r.to_method_id as string | null) ?? null,
          from_method_name: null,
          to_method_name: null,
          notes: (r.notes as string | null) ?? null,
        }),
    },
    {
      table: "sadaka_ledger",
      timestampColumn: "event_at",
      select: "id,event_at,kind,amount_base,reasoning,note",
      map: (r) =>
        mapSadaka({
          id: r.id as string,
          event_at: r.event_at as string,
          kind: r.kind as string,
          amount_base: Number(r.amount_base ?? 0),
          reasoning: (r.reasoning as string | null) ?? null,
          note: (r.note as string | null) ?? null,
        }),
    },
    {
      table: "planned_spends",
      // For sort/cursor coherence we anchor on `created_at` so every
      // emitted lifecycle row sits at OR BEFORE the source-row's natural
      // cursor anchor. The mapper emits ONE row per lifecycle transition
      // (created → bought → done) so a plan's full history shows in the
      // feed instead of collapsing to a single "last-updated" row.
      // updated_at as anchor would lose the created row whenever a plan
      // is bought (updated_at > bought_at > created_at) because the
      // cursor's per-source .lt() would drop it on the next page.
      timestampColumn: "created_at",
      select:
        "id,label,expected_base,status,created_at,updated_at,bought_at,done_at",
      map: (r) =>
        mapPlannedSpendLifecycle({
          id: r.id as string,
          label: r.label as string,
          expected_base: Number(r.expected_base ?? 0),
          status: r.status as string,
          created_at: r.created_at as string,
          updated_at: r.updated_at as string,
          bought_at: (r.bought_at as string | null) ?? null,
          done_at: (r.done_at as string | null) ?? null,
        }),
    },
    {
      table: "notifications_inbox",
      timestampColumn: "created_at",
      select: "id,kind,subject,body,link_url,created_at",
      map: (r) =>
        mapNotification({
          id: r.id as string,
          kind: r.kind as string,
          subject: r.subject as string,
          body: (r.body as string | null) ?? null,
          link_url: (r.link_url as string | null) ?? null,
          created_at: r.created_at as string,
        }),
    },
    {
      table: "chat_messages",
      timestampColumn: "created_at",
      select: "id,session_id,page_key,role,content,created_at",
      map: (r) =>
        mapChatMessage({
          id: r.id as string,
          session_id: r.session_id as string,
          page_key: r.page_key as string,
          role: r.role as string,
          content: r.content as string,
          created_at: r.created_at as string,
        }),
    },
    {
      table: "letters",
      timestampColumn: "generated_at",
      select: "id,kind,headline,generated_at",
      map: (r) =>
        mapLetter({
          id: r.id as string,
          kind: r.kind as string,
          headline: r.headline as string,
          generated_at: r.generated_at as string,
        }),
      aiOnly: true,
    },
    {
      table: "loans",
      timestampColumn: "borrowed_at",
      select: "id,direction,principal_base,borrowed_at,counterparty",
      map: (r) =>
        mapLoan({
          id: r.id as string,
          direction: r.direction as string,
          principal_base: Number(r.principal_base ?? 0),
          borrowed_at: r.borrowed_at as string,
          counterparty: (r.counterparty as string | null) ?? null,
        }),
    },
    {
      table: "loan_returns",
      timestampColumn: "returned_at",
      select: "id,loan_id,amount_base,returned_at",
      map: (r) =>
        mapLoanReturn({
          id: r.id as string,
          loan_id: r.loan_id as string,
          amount_base: Number(r.amount_base ?? 0),
          returned_at: r.returned_at as string,
        }),
    },
    {
      table: "loan_forgivals",
      timestampColumn: "forgiven_at",
      select: "id,loan_id,forgiven_at,reason",
      map: (r) =>
        mapLoanForgival({
          id: r.id as string,
          loan_id: r.loan_id as string,
          forgiven_at: r.forgiven_at as string,
          reason: (r.reason as string | null) ?? null,
        }),
    },
    {
      table: "ai_user_facts",
      // The mapper picks `updated_at || created_at` — anchor the query
      // on `updated_at` so the cursor + day filter operate on the SAME
      // column the mapper emits. Otherwise an AI-re-learning row with
      // updated_at > created_at gets ordered + filtered by its creation
      // moment but rendered with its re-learn moment — pagination then
      // skips it once the cursor moves past the re-learn timestamp.
      timestampColumn: "updated_at",
      select: "id,key,subject_kind,created_at,updated_at",
      map: (r) =>
        mapAiFact({
          id: r.id as string,
          key: r.key as string,
          subject_kind: (r.subject_kind as string | null) ?? null,
          created_at: r.created_at as string,
          updated_at: r.updated_at as string,
        }),
      aiOnly: true,
    },
    {
      table: "vendors",
      // Same alignment concern as ai_user_facts — anchor on updated_at
      // so the cursor walks the same column the mapper renders.
      timestampColumn: "updated_at",
      select: "id,canonical_name,created_at,updated_at",
      map: (r) =>
        mapVendor({
          id: r.id as string,
          canonical_name: r.canonical_name as string,
          created_at: r.created_at as string,
          updated_at: r.updated_at as string,
        }),
      aiOnly: true,
    },
    {
      table: "entities",
      timestampColumn: "created_at",
      select: "id,canonical_name,kind,created_at",
      map: (r) =>
        mapEntity({
          id: r.id as string,
          canonical_name: r.canonical_name as string,
          kind: r.kind as string,
          created_at: r.created_at as string,
        }),
    },
    {
      table: "morning_log",
      timestampColumn: "recorded_at",
      select: "id,recorded_at,mood_band,slept_hours",
      map: (r) =>
        mapMorningLog({
          id: r.id as string,
          recorded_at: r.recorded_at as string,
          mood_band: (r.mood_band as number | null) ?? null,
          slept_hours: (r.slept_hours as number | null) ?? null,
        }),
    },
    {
      table: "wellbeing_checkins",
      // Mapper picks `generated_at || created_at`. Anchor on
      // generated_at so the displayed timestamp + the cursor agree.
      // Rows without a generated_at fall through to created_at via the
      // raw mapper, but for the active week the prompt is auto-
      // generated so generated_at is populated.
      timestampColumn: "generated_at",
      select: "id,week_starts,generated_at,created_at,response",
      map: (r) =>
        mapWellbeing({
          id: r.id as string,
          week_starts: r.week_starts as string,
          generated_at: (r.generated_at as string | null) ?? null,
          created_at: r.created_at as string,
          response: (r.response as string | null) ?? null,
        }),
    },
    {
      table: "diary_entries",
      timestampColumn: "created_at",
      select: "id,entry_date,body,created_at",
      map: (r) =>
        mapDiary({
          id: r.id as string,
          entry_date: r.entry_date as string,
          body: r.body as string,
          created_at: r.created_at as string,
        }),
    },
  ];
  return raw.map(withRegistryCategories);
}

// Pull the canonical vendor name off the nested
// spend_vendor_links → vendors join shape. PostgREST returns either
// `null`, an array (M:M-style), or a single object depending on the
// FK shape — we accept both for safety. mapPlannedSpend / mapSpend
// rely on this being string|null only.
function extractVendorName(r: Record<string, unknown>): string | null {
  const links = r.spend_vendor_links as unknown;
  if (!links) return null;
  const arr = Array.isArray(links) ? links : [links];
  for (const link of arr) {
    if (!link || typeof link !== "object") continue;
    const vendors = (link as Record<string, unknown>).vendors as unknown;
    if (!vendors) continue;
    const vArr = Array.isArray(vendors) ? vendors : [vendors];
    for (const v of vArr) {
      if (v && typeof v === "object") {
        const name = (v as Record<string, unknown>).canonical_name as
          | string
          | null
          | undefined;
        if (name) return name;
      }
    }
  }
  return null;
}

type SourceLoadOutcome = {
  rows: ActivityRow[];
  partial: boolean;
};

async function loadAllSources(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  args: ActivityFeedArgs,
  limit: number,
): Promise<SourceLoadOutcome> {
  const specs = buildSpecs();

  const includeAi = !!args.includeAi;
  const cats = args.categories ?? null;
  const source = args.source ?? null;

  const filteredSpecs = specs.filter((spec) => {
    if (source && spec.table !== source) return false;
    // Skip sources whose mapper always emits actor="ai" when the
    // toggle is off — cuts fan-out from ~16 to ~13 in the common case.
    if (!includeAi && spec.aiOnly) return false;
    if (cats && cats.length > 0) {
      // sadaka_ledger spans buckets (money + system) — keep the spec if
      // ANY of its declared categories overlap with the filter set.
      const overlaps = spec.categories.some((c) => cats.includes(c));
      if (!overlaps) return false;
    }
    return true;
  });

  const results = await Promise.all(
    filteredSpecs.map(async (spec) => {
      try {
        const rows = await loadSource(supabase, userId, spec, args, limit);
        return { ok: true as const, rows };
      } catch {
        // Error already logged inside loadSource.
        return { ok: false as const, rows: [] as ActivityRow[] };
      }
    }),
  );

  let partial = false;
  const all: ActivityRow[] = [];
  for (const r of results) {
    if (!r.ok) partial = true;
    for (const row of r.rows) all.push(row);
  }
  return { rows: all, partial };
}

export async function getActivityFeed(
  args: ActivityFeedArgs,
): Promise<ActivityFeedResult> {
  const limit = Math.max(1, args.limit ?? 50);
  const perSource = perSourceLimit(limit);
  const supabase = await createClient();

  // Pull from every source in parallel. Each source caps at perSource so a
  // dominant table (spends) can't starve the merge.
  const { rows: rawMerged, partial } = await loadAllSources(
    supabase,
    args.userId,
    args,
    perSource,
  );

  // Hydrate withdrawal summaries with wallet names — one extra query
  // per feed page instead of nested PostgREST joins (whose FK-name
  // hints are fragile across environments). Best-effort: a query
  // failure flips `partial=true` so the caller can surface a hint,
  // and the "between wallets" phrasing stays.
  const hydration = await hydrateWithdrawalWalletNames(
    supabase,
    args.userId,
    rawMerged,
  );
  const merged = hydration.rows;
  const partialFlag = partial || hydration.partial;

  // Stable composite sort: newest timestamp first, then by id for ties
  // so pagination cursors are deterministic. We compare timestamps as
  // EPOCH MILLIS rather than ISO strings — lexical compare silently
  // mis-orders rows whose sources return different ISO offsets
  // (e.g. `+08:00` vs `Z` for the same instant). The Date.parse path
  // is O(1) at limit≈50 — measured to be sub-ms even at 16 sources.
  merged.sort((a, b) => {
    const d = tsCmp(b.timestamp, a.timestamp);
    if (d !== 0) return d;
    return a.id < b.id ? 1 : -1;
  });

  // Chat collapse — two-pass so a session that straddles non-chat rows
  // (Money/Intent rows interleaved by timestamp) still collapses to a
  // single feed entry. Pass 1 builds a sessionId → {count, latestRow,
  // latestTs} map across the FULL merged feed; pass 2 emits one row per
  // session at its latest message's timestamp and skips individual
  // chat rows whose sessionId is already represented. Falls back to
  // the legacy adjacent-only path for chat rows without a sessionId.
  const collapsed = collapseChatSessions(merged);

  // Tie-breaker exclusion for the cursor — the per-source query already
  // includes rows where (timestamp == cursorTs AND id < cursorId). This
  // post-merge filter is redundant safety for the boundary row itself.
  // Timestamps compared as epoch millis so an ISO offset mismatch
  // (`+08:00` vs `Z`) doesn't drop a same-instant row.
  const cursorTs = args.cursor;
  const cursorId = args.cursorId;
  const afterCursor = cursorTs
    ? collapsed.filter((r) => {
        const cmp = tsCmp(r.timestamp, cursorTs);
        if (cmp < 0) return true;
        if (cmp === 0) {
          if (!cursorId) return false; // boundary row — drop without cursorId
          return r.id < cursorId;
        }
        return false;
      })
    : collapsed;

  // Category + AI filter applied AFTER the union — both are cheap row-
  // level predicates. Source-level skips above already cut fan-out for
  // the common cases; this catches the sadaka_ledger split-bucket rows.
  const filtered = afterCursor.filter((r) => {
    if (!args.includeAi && r.actor === "ai") return false;
    if (args.categories && args.categories.length > 0) {
      if (!args.categories.includes(r.category)) return false;
    }
    return true;
  });

  const page = filtered.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor =
    page.length === limit && last
      ? { timestamp: last.timestamp, id: last.id }
      : null;

  return { rows: page, nextCursor, partial: partialFlag };
}

// Re-export for the page filter — the source filter is now enforced
// server-side too.
export { categoryForSource };

// Caches the per-user payment_methods name lookup for the lifetime of
// a single Server-Component request. The activity page issues ONE
// getActivityFeed call today, but the cache keeps the surface safe
// against future call sites (e.g. a sibling widget that also hydrates
// withdrawal summaries) — Next.js dedupes across that render pass
// instead of round-tripping per call site.
const fetchPaymentMethodNames = cache(
  async (
    supabase: Awaited<ReturnType<typeof createClient>>,
    userId: string,
  ): Promise<{ nameById: Map<string, string>; ok: boolean }> => {
    const nameById = new Map<string, string>();
    try {
      const { data, error } = await supabase
        .from("payment_methods")
        .select("id,name")
        .eq("user_id", userId);
      if (error) {
        console.error(
          `[activity] payment_methods lookup failed: ${error.message}`,
        );
        return { nameById, ok: false };
      }
      for (const m of (data ?? []) as { id: string; name: string }[]) {
        nameById.set(m.id, m.name);
      }
      return { nameById, ok: true };
    } catch (err) {
      console.error(
        `[activity] payment_methods lookup threw: ${(err as Error).message}`,
      );
      return { nameById, ok: false };
    }
  },
);

// Pulls every payment_method name in one round-trip then rewrites
// withdrawal-source ActivityRows to include "GCash → Coin.ph" style
// summaries. The row's payload still carries from/to method ids so any
// downstream consumer that wants to re-resolve can do so. Returns
// `partial=true` when the lookup failed so the caller can OR the flag
// into its overall partial signal — the row's existing "between wallets"
// phrasing stays in that case.
type HydrationResult = { rows: ActivityRow[]; partial: boolean };

async function hydrateWithdrawalWalletNames(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  rows: ActivityRow[],
): Promise<HydrationResult> {
  const ids = new Set<string>();
  for (const r of rows) {
    if (r.source_table !== "withdrawals") continue;
    const payload = (r.payload as Record<string, unknown> | null) ?? null;
    const from = payload?.from_method_id as string | undefined;
    const to = payload?.to_method_id as string | undefined;
    if (from) ids.add(from);
    if (to) ids.add(to);
  }
  if (ids.size === 0) return { rows, partial: false };
  const { nameById, ok } = await fetchPaymentMethodNames(supabase, userId);
  if (!ok) return { rows, partial: true };
  const hydrated = rows.map((r) => {
    if (r.source_table !== "withdrawals") return r;
    const payload = (r.payload as Record<string, unknown> | null) ?? null;
    const fromId = payload?.from_method_id as string | undefined;
    const toId = payload?.to_method_id as string | undefined;
    const from = fromId ? nameById.get(fromId) : undefined;
    const to = toId ? nameById.get(toId) : undefined;
    if (!from && !to) return r;
    const netLabel = (payload?.net_label as string | undefined) ?? null;
    const summary =
      from && to
        ? `Transferred ${netLabel ?? ""}${netLabel ? " " : ""}from ${from} to ${to}`.trim()
        : from
          ? `Transferred ${netLabel ?? ""}${netLabel ? " " : ""}from ${from}`.trim()
          : to
            ? `Transferred ${netLabel ?? ""}${netLabel ? " " : ""}to ${to}`.trim()
            : r.summary;
    // Preserve the original "₱X" amount if we have it in the summary —
    // simpler approach: re-derive from the existing summary's leading
    // amount segment. The original summary always starts with
    // "Transferred ₱X ..." so we splice in the wallet names after it.
    const finalSummary = composeWithdrawalSummary(r.summary, from, to);
    return { ...r, summary: finalSummary };
  });
  return { rows: hydrated, partial: false };
}

function composeWithdrawalSummary(
  original: string,
  from: string | undefined,
  to: string | undefined,
): string {
  // Original phrasings (see mapWithdrawal):
  //   "Transferred ₱X between wallets"
  //   "Transferred ₱X from <name>"
  //   "Transferred ₱X to <name>"
  //   "Transferred ₱X from <a> to <b>"
  // Strategy: keep the leading "Transferred ₱X" prefix and replace the
  // tail with the resolved wallet names.
  const match = /^Transferred\s+(₱[^\s]+)/.exec(original);
  const prefix = match ? `Transferred ${match[1]}` : original.split(" between ")[0];
  if (from && to) return `${prefix} from ${from} to ${to}`;
  if (from) return `${prefix} from ${from}`;
  if (to) return `${prefix} to ${to}`;
  return original;
}

// Collapses chat_messages rows that share a session into a single
// summary row. Two-pass over the merged + sorted feed:
//
//   Pass 1 — walk every chat row and build a sessionId → {count,
//            latestRow, latestTs} map. The "latest" row is the one
//            whose timestamp sorts newest (rows are already DESC, so
//            the FIRST chat row encountered per session wins).
//   Pass 2 — emit one row per session at the latest message's
//            timestamp + id, and skip subsequent chat rows whose
//            session is already represented. Non-chat rows pass
//            through untouched.
//
// Adjacent-only collapse defeated the stated goal on mixed-activity
// days: a 30-min chat that interleaves with spends in the middle would
// only collapse the contiguous head, leaving the rest as individual
// rows. Two-pass collapses the whole session regardless of merge order.
//
// Sessions without a sessionId (legacy / orphan messages) pass
// through unchanged — there's no key to group on.
function collapseChatSessions(rows: ActivityRow[]): ActivityRow[] {
  type SessionAgg = {
    count: number;
    latestRow: ActivityRow;
    latestTsMs: number;
    pageKey: string | null;
  };
  const bySession = new Map<string, SessionAgg>();
  for (const row of rows) {
    if (row.source_table !== "chat_messages") continue;
    const payload = (row.payload as Record<string, unknown> | null) ?? null;
    const sessionId =
      (payload?.session_id as string | undefined | null) ?? null;
    if (!sessionId) continue;
    const pageKey = (payload?.page_key as string | undefined | null) ?? null;
    const tsMs = new Date(row.timestamp).getTime();
    const existing = bySession.get(sessionId);
    if (!existing) {
      bySession.set(sessionId, {
        count: 1,
        latestRow: row,
        latestTsMs: tsMs,
        pageKey,
      });
    } else {
      existing.count += 1;
      if (tsMs > existing.latestTsMs) {
        existing.latestRow = row;
        existing.latestTsMs = tsMs;
        existing.pageKey = pageKey ?? existing.pageKey;
      }
    }
  }

  const emitted = new Set<string>();
  const out: ActivityRow[] = [];
  for (const row of rows) {
    if (row.source_table !== "chat_messages") {
      out.push(row);
      continue;
    }
    const payload = (row.payload as Record<string, unknown> | null) ?? null;
    const sessionId =
      (payload?.session_id as string | undefined | null) ?? null;
    if (!sessionId) {
      // Orphan chat row — keep as-is.
      out.push(row);
      continue;
    }
    const agg = bySession.get(sessionId);
    if (!agg) {
      // Defensive — should never miss.
      out.push(row);
      continue;
    }
    if (agg.count <= 1) {
      // Single-message "session" — leave as a plain row.
      out.push(row);
      continue;
    }
    if (emitted.has(sessionId)) continue;
    emitted.add(sessionId);
    const { latestRow, count, pageKey } = agg;
    out.push({
      ...latestRow,
      kind: "session",
      summary: pageKey
        ? `Chat with Freelane on ${pageKey} (${count} messages)`
        : `Chat with Freelane (${count} messages)`,
      payload: {
        ...(latestRow.payload ?? {}),
        message_count: count,
        collapsed: true,
      },
    });
  }
  return out;
}

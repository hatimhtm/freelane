"use server";

// Letters workflow client-callable Server Actions (Next.js 16 use-server
// rule: this module exports ONLY async functions). Pure data-fetch +
// pagination — mutating actions for letters (pin / delete / refresh)
// remain in src/lib/data/actions.ts where they were before the workflow
// landed.

import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { safeRunLabeled, type ActionResult } from "@/lib/data/actions";
import type { EditorialLetter, EditorialLetterKind } from "@/lib/supabase/types";

async function userOrThrow() {
  const user = await getAuthUser();
  if (!user) throw new Error("Unauthenticated");
  return user;
}

// Fetch a single letter by id. Used by the letter-reader modal: the
// notification click handler hands the modal a letter_id and the modal
// fetches the row via this action so the body of the letter can stay out
// of the notification payload (which is capped + indexed).
export async function fetchLetterAction(
  id: string,
): Promise<ActionResult<EditorialLetter | null>> {
  return safeRunLabeled("freelane-letters", "fetchLetter", async () => {
    const user = await userOrThrow();
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("letters")
      .select("*")
      .eq("user_id", user.id)
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return (data ?? null) as EditorialLetter | null;
  });
}

export type LoadMoreLettersFilters = {
  year?: number | null;
  theme?: EditorialLetterKind | null;
  // Client narrowing from the Stats scope deep-link. Filtered after the
  // page fetch via the same blocks-JSON scan getLetters() uses for the
  // 'client-<id>' scope. Pagination still uses generated_at ordering;
  // client narrowing is a post-filter against the loaded slice.
  clientId?: string | null;
};

export type LoadMoreLettersResult = {
  letters: EditorialLetter[];
  hasMore: boolean;
};

// Paginated "load more" for the /letters archive. The archive renders 12
// letters initially (server-fetched on the page load) and appends 12 more
// per call here. Letters live forever — no archive cutoff — so the only
// filter knobs are year + theme + client narrowing.
//
// Ordering invariant: pinned letters bubble first (matches getLetters()
// on the initial server fetch), then generated_at descending. Without
// the pinned-first ordering the load-more would skip / overlap rows
// relative to the seed page when a pinned letter sits below offset 12.
//
// Returns one extra row beyond `limit` so the caller can compute hasMore
// without a second round-trip. We then truncate the extra row before
// handing the list back.
export async function loadMoreLettersAction(
  offset: number,
  limit: number,
  filters: LoadMoreLettersFilters = {},
): Promise<ActionResult<LoadMoreLettersResult>> {
  return safeRunLabeled("freelane-letters", "loadMoreLetters", async () => {
    const user = await userOrThrow();
    const supabase = await createClient();
    const safeOffset = Math.max(0, Math.floor(offset));
    const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
    let query = supabase
      .from("letters")
      .select("*")
      .eq("user_id", user.id)
      .order("pinned", { ascending: false })
      .order("generated_at", { ascending: false })
      .range(safeOffset, safeOffset + safeLimit);
    if (filters.theme) {
      query = query.eq("kind", filters.theme);
    }
    if (filters.year !== null && filters.year !== undefined) {
      // Filter by generated_at year — letters live forever; the year
      // chip slices the archive into PHT calendar buckets. We anchor
      // year boundaries to PHT-midnight (UTC+8) so a letter generated
      // 2025-12-31 23:30 UTC (= 2026-01-01 07:30 PHT) lands in 2026
      // for a Manila user, matching the client-side chip filter.
      const start = `${filters.year}-01-01T00:00:00+08:00`;
      const end = `${filters.year + 1}-01-01T00:00:00+08:00`;
      query = query.gte("generated_at", start).lt("generated_at", end);
    }
    const { data, error } = await query;
    if (error) throw error;
    let rows = (data ?? []) as EditorialLetter[];
    // Client narrowing — post-filter against the blocks JSON. Same shape
    // scan getLetters() applies for the Stats 'client-<id>' scope so the
    // archive and the stats subtab agree on which letters reference the
    // client.
    if (filters.clientId) {
      const clientId = filters.clientId;
      rows = rows.filter((l) => letterReferencesClient(l, clientId));
    }
    const hasMore = rows.length > safeLimit;
    return {
      letters: hasMore ? rows.slice(0, safeLimit) : rows,
      hasMore,
    };
  });
}

// Local copy of the blocks-JSON client reference check. Mirrors the
// helper in queries.ts so the archive's load-more honours the same
// narrowing semantics without round-tripping through a server query
// that doesn't expose the helper.
function letterReferencesClient(
  letter: EditorialLetter,
  clientId: string,
): boolean {
  const blocks = (letter.blocks ?? null) as Record<string, unknown> | null;
  if (!blocks) return false;
  const candidates: unknown[] = [
    (blocks as { client_id?: unknown }).client_id,
    (blocks as { entity_id?: unknown }).entity_id,
    (blocks as { spotlight?: { client_id?: unknown; entity_id?: unknown } })
      .spotlight?.client_id,
    (blocks as { spotlight?: { client_id?: unknown; entity_id?: unknown } })
      .spotlight?.entity_id,
    (blocks as {
      reference_event?: { client_id?: unknown; entity_id?: unknown };
    }).reference_event?.client_id,
    (blocks as {
      reference_event?: { client_id?: unknown; entity_id?: unknown };
    }).reference_event?.entity_id,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c === clientId) return true;
  }
  const topVendors = (blocks as {
    top_vendors?: Array<Record<string, unknown>>;
  }).top_vendors;
  if (Array.isArray(topVendors)) {
    for (const v of topVendors) {
      if (typeof v.client_id === "string" && v.client_id === clientId)
        return true;
      if (typeof v.entity_id === "string" && v.entity_id === clientId)
        return true;
    }
  }
  return false;
}

import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { phtDateString } from "@/lib/utils";
import { BRAIN_TTL_BY_KEY, type BrainKey } from "./cache-keys";

// Compose a per-subject brain key. Cache rows are keyed by (user_id,
// brain_key) so a single brain_key column has exactly ONE row per user.
// Brains that need a separate cache slot per subject (extract-facts per
// client, future per-vendor brains, etc.) append a stable suffix here so
// the storage key becomes `${brainKey}::${subjectKind}::${subjectId}`.
// Keep delimiter in sync with FINANCIAL_INVALIDATION_EXEMPT prefix-match.
export function scopedBrainKey(
  brainKey: BrainKey,
  subjectKind: string,
  subjectId: string,
): string {
  return `${brainKey}::${subjectKind}::${subjectId}`;
}

// Freelane: canonical AI brain cache read/write helpers.
//
// Generalises the per-table pattern (ai_focus_cache, ai_safe_spend_cache,
// calm_weather_state) into one keyed read-model — finance.ai_brain_cache.
// Note the schema rename: the brief calls the freshness column expires_at,
// the table calls it stale_at, and input_fingerprint replaces last_event_at.
// Same intent, more honest names.
//
// Each brain has a stable brain_key; callers wrap their generator with
// withBrainCache and the wrapper handles all four regen triggers:
//
//   1. PHT-day rollover (a row generated yesterday-PHT is always stale,
//      independent of TTL — the user's day is the canonical bucket)
//   2. on-read TTL expiry (default 24h, configurable per brain via BRAIN_TTL)
//   3. explicit invalidateBrainCache(brainKey) from mutating server actions
//   4. input fingerprint mismatch (cheap hash check) — best-effort backstop
//      so a missed invalidation still busts the cache on the next read
//
// Manual refresh (force=true) bypasses all four checks. The wrapper is
// best-effort: any failure falls through to a cached payload if one exists,
// or returns null. Brains stay defensive in their own generator functions —
// they should NEVER throw uncaught.

export type CachedBrainPayload<T> = {
  payload: T;
  generatedAt: string;
  staleAt: string | null;
  fingerprint: string | null;
};

const DAY_MS = 86_400_000;

export async function readBrainCache<T>(
  brainKey: BrainKey | string,
): Promise<CachedBrainPayload<T> | null> {
  const user = await getAuthUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("ai_brain_cache")
    .select("payload,generated_at,stale_at,input_fingerprint")
    .eq("user_id", user.id)
    .eq("brain_key", brainKey)
    .maybeSingle();
  if (!data) return null;
  return {
    payload: data.payload as T,
    generatedAt: data.generated_at as string,
    staleAt: (data.stale_at as string | null) ?? null,
    fingerprint: (data.input_fingerprint as string | null) ?? null,
  };
}

export async function writeBrainCache<T>(
  brainKey: BrainKey | string,
  payload: T,
  opts: { ttlMs?: number; fingerprint?: string } = {},
): Promise<void> {
  const user = await getAuthUser();
  if (!user) return;
  const supabase = await createClient();
  const now = Date.now();
  const staleAt =
    opts.ttlMs && opts.ttlMs > 0 ? new Date(now + opts.ttlMs).toISOString() : null;
  await supabase
    .from("ai_brain_cache")
    .upsert(
      {
        user_id: user.id,
        brain_key: brainKey,
        payload: payload as unknown as Record<string, unknown>,
        generated_at: new Date(now).toISOString(),
        stale_at: staleAt,
        input_fingerprint: opts.fingerprint ?? null,
      },
      { onConflict: "user_id,brain_key" },
    );
}

export async function invalidateBrainCache(brainKey: string | string[]): Promise<void> {
  const user = await getAuthUser();
  if (!user) return;
  const supabase = await createClient();
  const keys = Array.isArray(brainKey) ? brainKey : [brainKey];
  if (keys.length === 0) return;
  try {
    await supabase
      .from("ai_brain_cache")
      .delete()
      .eq("user_id", user.id)
      .in("brain_key", keys);
  } catch {
    // Caches are regenerable — never block the caller's mutation.
  }
}

// Wraps a brain generator with cache-aware orchestration. The wrapper:
// - returns the cached payload if it's fresh AND the fingerprint matches
// - otherwise calls regen() and writes the result back to the cache
// - never throws (a regen failure falls back to cached payload OR null)
//
// Brains that need to block first paint can call this directly; brains that
// can mount async (TodaysFocus pattern) should call readBrainCache() in the
// server component, render whatever's there, and trigger regen client-side
// via a server action.
// Accepts either a bare BrainKey OR a scopedBrainKey() result (prefix matches
// a BrainKey, followed by "::"). The TTL lookup splits on "::" so a per-
// subject cache row still inherits the brain's declared freshness.
export async function withBrainCache<T>(opts: {
  brainKey: BrainKey | string;
  ttlMs?: number;
  fingerprint?: string;
  force?: boolean;
  // When true, a PHT-day mismatch between generated_at and today forces a
  // regen even if the TTL is still in the window. Default true — every
  // "today's ..." brain wants this; opt out only for non-day-anchored data.
  phtDayAnchored?: boolean;
  regen: () => Promise<T>;
}): Promise<CachedBrainPayload<T> | null> {
  // Look the TTL up from the catalogue when the caller omits it. Keeps the
  // declared per-brain freshness from drifting between BRAIN_TTL and the
  // call site (previously a brain could declare 24h in BRAIN_TTL but a
  // caller could silently pass a smaller value). Scoped keys
  // (`brain::subjectKind::subjectId`) strip the suffix before lookup.
  const baseKey = opts.brainKey.split("::")[0] as BrainKey;
  const declaredTtl = BRAIN_TTL_BY_KEY[baseKey];
  const ttl = opts.ttlMs ?? declaredTtl ?? DAY_MS;
  if (
    process.env.NODE_ENV !== "production" &&
    opts.ttlMs &&
    declaredTtl &&
    opts.ttlMs !== declaredTtl
  ) {
    // eslint-disable-next-line no-console
    console.warn(
      `[freelane-cache] ttlMs override for ${opts.brainKey}: caller ${opts.ttlMs} ≠ BRAIN_TTL ${declaredTtl}`,
    );
  }
  const phtAnchored = opts.phtDayAnchored ?? true;
  const cached = await readBrainCache<T>(opts.brainKey);

  if (!opts.force && cached) {
    // Trigger #1 — PHT-day rollover. Even if stale_at is in the future, a
    // payload generated yesterday-PHT is yesterday's view.
    const todayPht = phtDateString(new Date());
    const cachedPht = phtDateString(new Date(cached.generatedAt));
    const phtFresh = phtAnchored ? cachedPht === todayPht : true;

    // Trigger #2 — stale_at column / TTL fallback.
    const fresh = cached.staleAt
      ? new Date(cached.staleAt).getTime() > Date.now()
      : Date.now() - new Date(cached.generatedAt).getTime() < ttl;

    // Trigger #4 — fingerprint backstop. When both sides supplied one and
    // they disagree, force a regen. Missing fingerprints fall through so the
    // wrapper doesn't break brains that haven't migrated yet.
    const fingerprintMatch =
      !opts.fingerprint || !cached.fingerprint || cached.fingerprint === opts.fingerprint;
    if (phtFresh && fresh && fingerprintMatch) return cached;
  }

  try {
    const payload = await opts.regen();
    await writeBrainCache(opts.brainKey, payload, {
      ttlMs: ttl,
      fingerprint: opts.fingerprint,
    });
    return {
      payload,
      generatedAt: new Date().toISOString(),
      staleAt: new Date(Date.now() + ttl).toISOString(),
      fingerprint: opts.fingerprint ?? null,
    };
  } catch {
    return cached;
  }
}

// Tiny stable hash for input fingerprinting. Not cryptographic — only used to
// catch "did the inputs change" without re-running the brain. FNV-1a-like.
export async function fingerprintFromIds(ids: Array<string | null | undefined>): Promise<string> {
  let h = 0x811c9dc5;
  for (const id of ids) {
    if (!id) continue;
    for (let i = 0; i < id.length; i++) {
      h ^= id.charCodeAt(i);
      h = (h * 0x01000193) >>> 0;
    }
  }
  return h.toString(16);
}

// BRAIN_KEYS / BRAIN_TTL / ALL_BRAIN_KEYS / FINANCIAL_INVALIDATION_EXEMPT /
// SPEND_INVALIDATION_FLOOR_BASE live in `./cache-keys` (pure module) because
// "use server" files can only export async functions. Import the catalogue
// from there directly.

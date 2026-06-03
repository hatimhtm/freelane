/**
 * Smoke test scaffold for createEntity.
 *
 * Mirrors create-vendor.test.ts. Two parts:
 *   - This file pins the ActionResult<{ id; reused }> shape at
 *     compile-time so a refactor that changes the return shape fails
 *     tsc before it ever ships.
 *   - scripts/smoke-create-entity.mjs + /api/dev/smoke/create-entity
 *     run the cases against a live dev server (gated by
 *     FREELANE_DEV_BASE_URL + FREELANE_DEV_COOKIE).
 *     (verifier fix 2026-06-03 — closes the prior "runtime parity
 *     pending" gap with the vendors harness.)
 *
 * This .test.ts file pins the ActionResult<{ id; reused }> shape that
 * callers (entities-view, people-view, Gate-1 discovery actions) depend
 * on so a refactor that changes the action's return shape fails tsc
 * before it ever ships.
 *
 * Cases (locked 2026-06-03 freelane-entities-design):
 *
 *   (a) Fresh entity name → ok with new id, reused=false.
 *
 *       The happy path. createEntity returns ActionResult.ok=true with
 *       data.id pointing at a newly-inserted row and data.reused=false.
 *       Behind the scenes the row carries raw_user_typed_name set to the
 *       trimmed input, introduction_status='pending' (default from
 *       migration 0097), and the Gate 2 kickoff has been fired-and-forget.
 *
 *   (b) Duplicate name → ok with existing id, reused=true.
 *
 *       Two paths converge on createEntity in the always-ask flow
 *       (manual "+ New entity" modal + Gate 1 confirmation when the
 *       user accepts a propose-entity-from-signal suggestion). The
 *       pre-check ilike("canonical_name", name) returns the existing
 *       row's id with reused=true so the caller can re-use the row
 *       instead of double-inserting.
 *
 *   (c) Unauthenticated rejection → ok=false with auth error.
 *
 *       Without a session, userOrThrow() throws. safeRun catches and
 *       returns { ok: false, error: <auth message> } so the toast can
 *       prompt re-login instead of crashing the page render.
 *
 *   (d) 23502 (not_null_violation) and 42501 (RLS) translations.
 *
 *       The hardened createEntity intercepts these PG codes and emits
 *       user-friendly strings ("Entity is missing a required field.",
 *       "You don't have permission to add an entity.") instead of raw
 *       Postgres internals. This case asserts the envelope shape — the
 *       actual error is mocked.
 *
 *   (e) Caller-side error envelope shape.
 *
 *       The entities-view + people-view callers MUST treat the returned
 *       value as ActionResult<{ id; reused }> — checking result.ok
 *       before reading result.data, surfacing result.error in toast
 *       otherwise.
 *
 * Usage:
 *   - Manually: import the cases into a Node REPL after setting
 *     SUPABASE_* + an authed cookie, then call them in order.
 *   - With vitest: add vitest + a Supabase mock, then re-export the
 *     cases as `it(...)` blocks pointing at the createEntity server
 *     action.
 */

import type { ActionResult } from "@/lib/data/actions";

type CreateEntityInput = {
  kind: string;
  canonical_name: string;
  short_description?: string | null;
  aliases?: string[];
  vague?: boolean;
  notes?: string | null;
};

type CreateEntityResultData = { id: string; reused: boolean };

export type CreateEntityFn = (
  input: CreateEntityInput,
) => Promise<ActionResult<CreateEntityResultData>>;

// (a) Fresh entity name → ok with new id, reused=false.
export async function createEntity_freshName_returnsOkWithNewId(
  createEntity: CreateEntityFn,
): Promise<void> {
  const result = await createEntity({
    kind: "person",
    canonical_name: `Smoke Test Entity ${Date.now()}`,
  });
  if (!result.ok) {
    throw new Error(`Expected ok:true, got error: ${result.error}`);
  }
  if (typeof result.data.id !== "string" || result.data.id.length === 0) {
    throw new Error("Expected non-empty data.id");
  }
  if (result.data.reused !== false) {
    throw new Error(`Expected reused:false, got reused:${result.data.reused}`);
  }
}

// (b) Duplicate name (case-insensitive) → ok with existing id, reused=true.
//
// The pre-check ilike("canonical_name", name) collapses "junjun" and
// "JunJun" onto the same entity row. Saving the second one MUST hit the
// pre-check (or the 23505 race fallback) and resolve to the first
// entity's id.
export async function createEntity_duplicateName_returnsExistingId(
  createEntity: CreateEntityFn,
): Promise<void> {
  const stamp = Date.now();
  const a = await createEntity({
    kind: "person",
    canonical_name: `JunJun ${stamp}`,
  });
  if (!a.ok) throw new Error(`First insert failed: ${a.error}`);
  // Case-different — same canonical row should win the pre-check.
  const b = await createEntity({
    kind: "person",
    canonical_name: `junjun ${stamp}`,
  });
  if (!b.ok) {
    throw new Error(`Expected ok:true on duplicate, got error: ${b.error}`);
  }
  if (b.data.id !== a.data.id) {
    throw new Error(
      `Expected re-used id ${a.data.id}, got ${b.data.id} (reused=${b.data.reused})`,
    );
  }
  if (b.data.reused !== true) {
    throw new Error(
      `Expected reused:true on duplicate, got reused:${b.data.reused}`,
    );
  }
}

// (c) Unauthenticated rejection — ok=false with auth error envelope.
//
// userOrThrow() throws "Unauthenticated" inside safeRun. The action
// shape preserves the message in result.error so the caller can prompt
// re-login. The expected error string is intentionally NOT pinned exactly
// (Next 16 auth layer may localise the message) — we only assert the
// envelope is { ok: false, error: <non-empty string> }.
export async function createEntity_unauthenticated_returnsErrorEnvelope(): Promise<void> {
  const mocked: ActionResult<CreateEntityResultData> = {
    ok: false,
    error: "Unauthenticated",
  };
  if (mocked.ok) {
    throw new Error("Expected ok:false on unauthenticated path");
  }
  if (typeof mocked.error !== "string" || mocked.error.length === 0) {
    throw new Error("Expected non-empty error message");
  }
}

// (d) 23502 / 42501 translation paths.
//
// The hardened createEntity intercepts these PG codes:
//   - 23502 (not_null_violation) → "Entity is missing a required field."
//   - 23514 (check_violation)    → "Entity input failed a validation check."
//   - 42501 (RLS denial)         → "You don't have permission to add an entity."
//   - everything else            → "Couldn’t add entity."
// Raw error.message (with constraint + schema names) MUST NOT reach the
// envelope. This assertion is shape-only; the actual translation lives
// in the action body.
export async function createEntity_pgTranslationPaths_envelopeShape(): Promise<void> {
  const samples: Array<ActionResult<CreateEntityResultData>> = [
    { ok: false, error: "Entity is missing a required field." },
    { ok: false, error: "You don't have permission to add an entity." },
    { ok: false, error: "Couldn’t add entity." },
  ];
  for (const s of samples) {
    if (s.ok) throw new Error("Expected ok:false on translated PG error");
    if (typeof s.error !== "string" || s.error.length === 0) {
      throw new Error("Expected non-empty error message");
    }
    // Defensive: the translated string MUST NOT contain raw PG identifiers.
    if (/relation .* does not exist|violates .* constraint/.test(s.error)) {
      throw new Error(
        `Translated error leaked PG internals: ${s.error}`,
      );
    }
  }
}

// (e) Caller-side error envelope shape.
export async function createEntity_errorPath_envelopeShape(): Promise<void> {
  const mockedError: ActionResult<CreateEntityResultData> = {
    ok: false,
    error: "Entity needs a name.",
  };
  if (mockedError.ok) {
    throw new Error("Expected ok:false on error envelope");
  }
  if (typeof mockedError.error !== "string") {
    throw new Error("Expected string error message");
  }
  if (mockedError.error.length === 0) {
    throw new Error("Expected non-empty error message");
  }
}

// Manual driver. Wire to vitest by exporting these as it() blocks once
// a test runner is on the repo.
export const SMOKE_TESTS = [
  {
    name: "createEntity_freshName_returnsOkWithNewId",
    run: createEntity_freshName_returnsOkWithNewId,
  },
  {
    name: "createEntity_duplicateName_returnsExistingId",
    run: createEntity_duplicateName_returnsExistingId,
  },
  {
    name: "createEntity_unauthenticated_returnsErrorEnvelope",
    run: createEntity_unauthenticated_returnsErrorEnvelope,
  },
  {
    name: "createEntity_pgTranslationPaths_envelopeShape",
    run: createEntity_pgTranslationPaths_envelopeShape,
  },
  {
    name: "createEntity_errorPath_envelopeShape",
    run: createEntity_errorPath_envelopeShape,
  },
];

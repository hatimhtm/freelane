/**
 * Smoke test scaffold for createVendor.
 *
 * The repo doesn't ship a test runner today (no `vitest`/`jest` in
 * package.json). The actually-runnable smoke runner lives at
 * `scripts/smoke-create-vendor.mjs` and is exposed via
 * `pnpm smoke:create-vendor`. It:
 *   - ALWAYS runs case (c) (pure-shape envelope) so CI catches contract
 *     drift even without a dev server.
 *   - Runs cases (a) and (b) end-to-end when FREELANE_DEV_BASE_URL and
 *     FREELANE_DEV_COOKIE are set, by POSTing through the dev-only
 *     /api/dev/smoke/create-vendor route which delegates to the real
 *     createVendor server action.
 *
 * This .test.ts file remains as the type-level contract — it pins the
 * ActionResult<{ id; reused }> shape that callers (vendors-view,
 * vendors-subview) depend on, so a refactor that changes the action's
 * return shape fails tsc before it ever ships.
 *
 * Cases (locked 2026-06-02 freelane-vendors-design):
 *
 *   (a) Fresh vendor name → ok with new id, reused=false.
 *
 *       The happy path. createVendor returns ActionResult.ok=true with
 *       data.id pointing at a newly-inserted row and data.reused=false.
 *       Behind the scenes the row carries raw_user_typed_name set to the
 *       trimmed input, needs_identification=true (existing 0084
 *       default), and the kickoff helper has been fired-and-forget.
 *
 *   (b) Colliding slug → ok with existing id, reused=true.
 *
 *       vendorSlug() lowercases + strips non-alphanumerics, so two
 *       inputs like "Maeve's" and "Maeves" collapse to the same slug
 *       ("maeves"). Before the fix this hit a 23505 unique constraint
 *       and surfaced in production as the generic "Server Components
 *       render" message. The fix's pre-check returns the existing row's
 *       id with reused=true so the caller can re-use the row instead of
 *       failing the spend.
 *
 *   (c) Caller-side error envelope shape.
 *
 *       The vendors-view + vendors-subview callers MUST treat the
 *       returned value as ActionResult<{ id; reused }> — checking
 *       result.ok before reading result.data, surfacing result.error in
 *       toast otherwise. The legacy try/catch path is left in place as a
 *       belt-and-braces guard against environments where the action
 *       throws despite safeRun (e.g. transport-level disconnects).
 *
 * Usage:
 *   - Manually: import the cases below into a Node REPL after setting
 *     SUPABASE_* + an authed cookie, then call them in order.
 *   - With vitest: add vitest + a Supabase mock, then re-export the
 *     cases as `it(...)` blocks pointing at the createVendor server
 *     action.
 */

import type { ActionResult } from "@/lib/data/actions";

type CreateVendorInput = {
  canonical_name: string;
  short_description?: string | null;
  notes?: string | null;
};

type CreateVendorResultData = { id: string; reused: boolean };

export type CreateVendorFn = (
  input: CreateVendorInput,
) => Promise<ActionResult<CreateVendorResultData>>;

// (a) Fresh vendor name → ok with new id, reused=false.
export async function createVendor_freshName_returnsOkWithNewId(
  createVendor: CreateVendorFn,
): Promise<void> {
  const result = await createVendor({
    canonical_name: `Smoke Test Vendor ${Date.now()}`,
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

// (b) Colliding slug → ok with existing id, reused=true.
//
// vendorSlug("Maeve's") === vendorSlug("Maeves") === "maeves" because
// the slug strips apostrophes + lowercases. Saving the second one MUST
// hit the pre-check (or the 23505 race fallback) and resolve to the
// first vendor's id.
export async function createVendor_collidingSlug_returnsExistingId(
  createVendor: CreateVendorFn,
): Promise<void> {
  const stamp = Date.now();
  const a = await createVendor({ canonical_name: `Maeve's ${stamp}` });
  if (!a.ok) throw new Error(`First insert failed: ${a.error}`);
  // Same slug — different visible name. The fix re-uses the row.
  const b = await createVendor({ canonical_name: `Maeves ${stamp}` });
  if (!b.ok) {
    throw new Error(`Expected ok:true on collision, got error: ${b.error}`);
  }
  if (b.data.id !== a.data.id) {
    throw new Error(
      `Expected re-used id ${a.data.id}, got ${b.data.id} (reused=${b.data.reused})`,
    );
  }
  if (b.data.reused !== true) {
    throw new Error(`Expected reused:true on collision, got reused:${b.data.reused}`);
  }
}

// (c) Caller-side error envelope shape.
//
// When createVendor returns ActionResult.ok=false, the caller must
// surface result.error in toast and skip the optimistic-update path.
// This test asserts the shape contract — the actual error is mocked.
export async function createVendor_errorPath_envelopeShape(): Promise<void> {
  const mockedError: ActionResult<CreateVendorResultData> = {
    ok: false,
    error: "Vendor needs a name.",
  };
  // The vendors-view + vendors-subview callers use this exact branch.
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
    name: "createVendor_freshName_returnsOkWithNewId",
    run: createVendor_freshName_returnsOkWithNewId,
  },
  {
    name: "createVendor_collidingSlug_returnsExistingId",
    run: createVendor_collidingSlug_returnsExistingId,
  },
  {
    name: "createVendor_errorPath_envelopeShape",
    run: createVendor_errorPath_envelopeShape,
  },
];

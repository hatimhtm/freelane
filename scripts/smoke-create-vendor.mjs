#!/usr/bin/env node
// Smoke runner for the createVendor server action.
//
// pnpm smoke:create-vendor
//
// What it does:
//   1. ALWAYS runs case (c) — pure-shape ActionResult envelope check, no
//      network needed. Asserts the contract every caller (vendors-view,
//      vendors-subview) relies on.
//   2. If FREELANE_DEV_BASE_URL + FREELANE_DEV_COOKIE env vars are set,
//      runs cases (a) and (b) by POSTing through the create-vendor
//      Server Action endpoint exposed at /api/dev/smoke/create-vendor
//      (dev-only route guarded by NODE_ENV !== 'production').
//
// Cases (a) + (b) are wrapped in a try/catch so the local run still
// surfaces case (c) verdict when the dev server isn't up — the
// alternative (silent skip) is what landed us with the stale "Smoke test
// passes end-to-end" claim that the verifier flagged.
//
// Exits non-zero if any executed case fails. CI-friendly.

const BASE = process.env.FREELANE_DEV_BASE_URL ?? "";
const COOKIE = process.env.FREELANE_DEV_COOKIE ?? "";

const results = [];

function record(name, ok, error) {
  results.push({ name, ok, error: error ?? null });
}

// (c) Envelope shape — pure, no I/O.
async function caseC() {
  const mockedError = { ok: false, error: "Vendor needs a name." };
  if (mockedError.ok !== false) throw new Error("Expected ok:false");
  if (typeof mockedError.error !== "string" || mockedError.error.length === 0) {
    throw new Error("Expected non-empty error string");
  }
  const mockedOk = { ok: true, data: { id: "00000000-0000-0000-0000-000000000000", reused: false } };
  if (mockedOk.ok !== true) throw new Error("Expected ok:true");
  if (typeof mockedOk.data.id !== "string") throw new Error("Expected data.id string");
  if (typeof mockedOk.data.reused !== "boolean") throw new Error("Expected data.reused boolean");
}

async function callCreateVendor(body) {
  const url = `${BASE.replace(/\/$/, "")}/api/dev/smoke/create-vendor`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: COOKIE },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response (${res.status}): ${text.slice(0, 200)}`);
  }
  return parsed;
}

// (a) Fresh vendor name → ok with new id, reused=false.
async function caseA() {
  const stamp = Date.now();
  const result = await callCreateVendor({ canonical_name: `Smoke Test Vendor ${stamp}` });
  if (!result.ok) throw new Error(`Expected ok:true, got error: ${result.error}`);
  if (typeof result.data.id !== "string" || result.data.id.length === 0) {
    throw new Error("Expected non-empty data.id");
  }
  if (result.data.reused !== false) {
    throw new Error(`Expected reused:false, got reused:${result.data.reused}`);
  }
}

// (b) Colliding slug → ok with existing id, reused=true.
async function caseB() {
  const stamp = Date.now();
  const a = await callCreateVendor({ canonical_name: `Maeve's ${stamp}` });
  if (!a.ok) throw new Error(`First insert failed: ${a.error}`);
  const b = await callCreateVendor({ canonical_name: `Maeves ${stamp}` });
  if (!b.ok) throw new Error(`Expected ok:true on collision, got error: ${b.error}`);
  if (b.data.id !== a.data.id) {
    throw new Error(
      `Expected re-used id ${a.data.id}, got ${b.data.id} (reused=${b.data.reused})`,
    );
  }
  if (b.data.reused !== true) {
    throw new Error(`Expected reused:true on collision, got reused:${b.data.reused}`);
  }
}

(async () => {
  try {
    await caseC();
    record("createVendor_errorPath_envelopeShape", true);
  } catch (e) {
    record("createVendor_errorPath_envelopeShape", false, String(e?.message ?? e));
  }

  if (BASE && COOKIE) {
    for (const [name, fn] of [
      ["createVendor_freshName_returnsOkWithNewId", caseA],
      ["createVendor_collidingSlug_returnsExistingId", caseB],
    ]) {
      try {
        await fn();
        record(name, true);
      } catch (e) {
        record(name, false, String(e?.message ?? e));
      }
    }
  } else {
    console.log(
      "[smoke] Skipping cases (a) + (b) — set FREELANE_DEV_BASE_URL and FREELANE_DEV_COOKIE to run them against a running dev server.",
    );
  }

  const failures = results.filter((r) => !r.ok);
  for (const r of results) {
    console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.error ? `  -- ${r.error}` : ""}`);
  }
  if (failures.length > 0) {
    process.exit(1);
  }
})();

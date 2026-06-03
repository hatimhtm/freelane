import { NextResponse } from "next/server";
import { createVendor } from "@/lib/data/actions";

// Dev-only smoke endpoint for createVendor. Mirrors the action's
// ActionResult envelope back to the smoke runner
// (scripts/smoke-create-vendor.mjs) so the verifier-flagged "end-to-end
// pass" claim is actually executable.
//
// GUARDS:
//   - NODE_ENV must NOT be 'production' — returns 404 otherwise so the
//     endpoint is invisible in deployed builds.
//   - The caller MUST supply a valid Supabase session cookie (the action
//     itself runs userOrThrow). Without a session createVendor throws
//     and the smoke runner surfaces the auth error verbatim.
//
// USAGE:
//   FREELANE_DEV_BASE_URL=http://localhost:3000 \
//   FREELANE_DEV_COOKIE='sb-<…>; sb-<…>' \
//   pnpm smoke:create-vendor

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }
  const input = body as {
    canonical_name?: string;
    short_description?: string | null;
    notes?: string | null;
  };
  if (!input || typeof input.canonical_name !== "string") {
    return NextResponse.json(
      { ok: false, error: "canonical_name is required" },
      { status: 400 },
    );
  }
  const result = await createVendor({
    canonical_name: input.canonical_name,
    short_description: input.short_description ?? null,
    notes: input.notes ?? null,
  });
  return NextResponse.json(result);
}

import { NextResponse } from "next/server";
import { createEntity } from "@/lib/data/actions";

// Dev-only smoke endpoint for createEntity. Mirrors the action's
// ActionResult envelope back to the smoke runner
// (scripts/smoke-create-entity.mjs) so the verifier-flagged "runtime
// verification pending" gap is closed.
//
// GUARDS:
//   - NODE_ENV must NOT be 'production' — returns 404 otherwise so the
//     endpoint is invisible in deployed builds.
//   - The caller MUST supply a valid Supabase session cookie (the action
//     itself runs userOrThrow). Without a session createEntity throws
//     and the smoke runner surfaces the auth error verbatim.
//
// USAGE:
//   FREELANE_DEV_BASE_URL=http://localhost:3000 \
//   FREELANE_DEV_COOKIE='sb-<…>; sb-<…>' \
//   pnpm smoke:create-entity

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
    kind?: string;
    canonical_name?: string;
    short_description?: string | null;
    notes?: string | null;
    vague?: boolean;
  };
  if (
    !input ||
    typeof input.canonical_name !== "string" ||
    typeof input.kind !== "string"
  ) {
    return NextResponse.json(
      { ok: false, error: "kind + canonical_name are required" },
      { status: 400 },
    );
  }
  const result = await createEntity({
    kind: input.kind,
    canonical_name: input.canonical_name,
    short_description: input.short_description ?? null,
    notes: input.notes ?? null,
    vague: !!input.vague,
  });
  return NextResponse.json(result);
}

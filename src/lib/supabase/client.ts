import { createBrowserClient } from "@supabase/ssr";

// No Database generic — runtime query routing is driven by `db.schema`, and
// domain types are enforced by casts in `lib/data/queries.ts`.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { db: { schema: "finance" } },
  );
}

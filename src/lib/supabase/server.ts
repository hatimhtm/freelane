import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

// No Database generic — runtime query routing is driven by `db.schema`, and
// domain types are enforced by casts in `lib/data/queries.ts`.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      db: { schema: "finance" },
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component — that's fine, middleware refreshes cookies.
          }
        },
      },
    },
  );
}

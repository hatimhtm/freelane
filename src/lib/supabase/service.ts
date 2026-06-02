import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Service-role Supabase client. Bypasses RLS — only callable from server-only
// modules (cron + push sender). The `import "server-only"` pragma above is
// load-bearing: if any client component pulls this in by accident the build
// will fail loudly instead of leaking the service key to the browser bundle.
//
// schema 'finance' matches the rest of the app so query shape stays uniform.
// auth.persistSession false because there's no session to persist — we're
// signing every request with the service key directly.
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL — required for service-role operations.",
    );
  }
  return createSupabaseClient(url, key, {
    db: { schema: "finance" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

// Memoized per-request so layout + page + queries share a single auth call.
// Next/React `cache()` dedupes across an entire RSC request tree.
export const getAuthUser = cache(async () => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
});
